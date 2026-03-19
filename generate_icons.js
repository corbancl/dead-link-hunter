/**
 * 死链猎手 - 纯 Node.js 图标生成器（无第三方依赖）
 * 生成 16/32/48/128 尺寸 PNG
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ===== PNG 编码器 =====
function writePNG(width, height, pixels) {
  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const buf = Buffer.concat([typeBytes, data]);
    const crc = crc32(buf);
    const out = Buffer.allocUnsafe(4 + 4 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    typeBytes.copy(out, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc >>> 0, 8 + data.length);
    return out;
  }

  // IHDR
  const ihdrData = Buffer.allocUnsafe(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // RGBA
  ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;

  // IDAT - raw image data
  const rawData = Buffer.allocUnsafe(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const px = pixels[y * width + x];
      rawData[offset++] = (px >> 24) & 0xff; // R
      rawData[offset++] = (px >> 16) & 0xff; // G
      rawData[offset++] = (px >> 8)  & 0xff; // B
      rawData[offset++] = px & 0xff;          // A
    }
  }
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ===== 颜色工具 =====
function rgba(r, g, b, a = 255) {
  return ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function blendRGBA(bg, fr, fa) {
  const bgR = (bg >> 24) & 0xff, bgG = (bg >> 16) & 0xff, bgB = (bg >> 8) & 0xff;
  const a = fa / 255;
  return rgba(
    Math.round(bgR * (1 - a) + fr[0] * a),
    Math.round(bgG * (1 - a) + fr[1] * a),
    Math.round(bgB * (1 - a) + fr[2] * a),
    255
  );
}

// ===== 绘图函数 =====
function drawPixel(pixels, w, h, x, y, color, alpha) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || xi >= w || yi < 0 || yi >= h) return;
  const idx = yi * w + xi;
  if (alpha >= 1) {
    pixels[idx] = color;
  } else if (alpha > 0) {
    pixels[idx] = blendRGBA(pixels[idx], [
      (color >> 24) & 0xff, (color >> 16) & 0xff, (color >> 8) & 0xff
    ], Math.round(alpha * 255));
  }
}

function drawFilledCircle(pixels, w, h, cx, cy, r, color) {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const alpha = Math.max(0, Math.min(1, r - d + 1));
      if (alpha > 0) {
        pixels[y * w + x] = blendRGBA(pixels[y * w + x], [
          (color >> 24) & 0xff, (color >> 16) & 0xff, (color >> 8) & 0xff
        ], Math.round(alpha * 255));
      }
    }
  }
}

function drawLine(pixels, w, h, x0, y0, x1, y1, color, thickness) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const steps = Math.ceil(len * 2);
  const halfT = thickness / 2;
  const px0 = Math.max(0, Math.floor(Math.min(x0, x1) - halfT - 1));
  const px1 = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + halfT + 1));
  const py0 = Math.max(0, Math.floor(Math.min(y0, y1) - halfT - 1));
  const py1 = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + halfT + 1));
  const len2 = dx * dx + dy * dy;
  for (let y = py0; y <= py1; y++) {
    for (let x = px0; x <= px1; x++) {
      let t = ((x - x0) * dx + (y - y0) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const npx = x0 + t * dx, npy = y0 + t * dy;
      const d = Math.hypot(x - npx, y - npy);
      const alpha = Math.max(0, Math.min(1, halfT - d + 1));
      if (alpha > 0) {
        pixels[y * w + x] = blendRGBA(pixels[y * w + x], [
          (color >> 24) & 0xff, (color >> 16) & 0xff, (color >> 8) & 0xff
        ], Math.round(alpha * 255));
      }
    }
  }
}

// ===== 图标渲染 =====
function renderIcon(size) {
  const s = size / 128;
  const pixels = new Int32Array(size * size);

  // 背景
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r2 = 24 * s;
      const cx = size / 2, cy = size / 2;
      const dx = Math.max(Math.abs(x - cx) - (size / 2 - r2), 0);
      const dy = Math.max(Math.abs(y - cy) - (size / 2 - r2), 0);
      if (Math.hypot(dx, dy) > r2) {
        // 圆角外 → 透明
        pixels[y * size + x] = rgba(0, 0, 0, 0);
        continue;
      }
      // 渐变背景
      const tx = x / size, ty = y / size;
      const t = (tx + ty) / 2;
      pixels[y * size + x] = rgba(
        Math.round(lerp(10, 15, t)),
        Math.round(lerp(10, 15, t)),
        Math.round(lerp(24, 36, t)),
        255
      );
    }
  }

  const CYAN = rgba(0, 210, 255, 255);
  const BLUE = rgba(58, 123, 213, 255);
  const RED  = rgba(255, 70, 100, 255);
  const RED2 = rgba(238, 9, 121, 255);

  // 左链环
  const lcx = 44 * s, lcy = 59 * s, lcr = 14 * s;
  for (let deg = 195; deg <= 520; deg += 2) {
    const angle = deg * Math.PI / 180;
    const t = (deg - 195) / 325;
    const cr = Math.round(lerp(0, 58, t));
    const cg = Math.round(lerp(210, 123, t));
    const cb = Math.round(lerp(255, 213, t));
    const c = rgba(cr, cg, cb, 255);
    drawFilledCircle(pixels, size, size,
      lcx + lcr * Math.cos(angle),
      lcy + lcr * Math.sin(angle),
      Math.max(1.2, 2.8 * s), c);
  }

  // 右链环
  const rcx = 84 * s, rcy = 59 * s, rcr = 14 * s;
  for (let deg = -25; deg <= 300; deg += 2) {
    const angle = deg * Math.PI / 180;
    const t = (deg + 25) / 325;
    const cr = Math.round(lerp(58, 0, t));
    const cg = Math.round(lerp(123, 210, t));
    const cb = Math.round(lerp(213, 255, t));
    const c = rgba(cr, cg, cb, 255);
    drawFilledCircle(pixels, size, size,
      rcx + rcr * Math.cos(angle),
      rcy + rcr * Math.sin(angle),
      Math.max(1.2, 2.8 * s), c);
  }

  // 断裂残端
  const thick = Math.max(2, 4.5 * s);
  drawLine(pixels, size, size, 48*s, 59*s, 56*s, 59*s, RED, thick);
  drawLine(pixels, size, size, 72*s, 59*s, 80*s, 59*s, RED, thick);

  // X
  const xs = 6 * s;
  const xth = Math.max(1.5, 3 * s);
  drawLine(pixels, size, size, 64*s-xs, 59*s-xs, 64*s+xs, 59*s+xs, RED, xth);
  drawLine(pixels, size, size, 64*s+xs, 59*s-xs, 64*s-xs, 59*s+xs, RED, xth);

  // 火花
  [[64,50,2.5],[60,56,1.8],[68,54,1.5],[64,68,2.5],[62,63,1.5],[67,65,1.8]].forEach(([sx,sy,sr]) => {
    drawFilledCircle(pixels, size, size, sx*s, sy*s, Math.max(0.8, sr*s), RED);
  });

  // 底部装饰线
  [[94,0.25],[99,0.15],[104,0.08]].forEach(([yy, op], i) => {
    const xs2 = (20 + i*10)*s, xe = (108-i*10)*s;
    const c = rgba(0, Math.round(210*op), Math.round(255*op), 255);
    drawLine(pixels, size, size, xs2, yy*s, xe, yy*s, c, Math.max(0.5, 1*s));
  });

  return pixels;
}

// ===== 主程序 =====
const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

[16, 32, 48, 128].forEach(sz => {
  const pixels = renderIcon(sz);
  const pngBuffer = writePNG(sz, sz, pixels);
  const outPath = path.join(outDir, `icon${sz}.png`);
  fs.writeFileSync(outPath, pngBuffer);
  console.log(`✅ Generated: icon${sz}.png (${pngBuffer.length} bytes)`);
});

console.log('\n🎉 All icons generated!');
