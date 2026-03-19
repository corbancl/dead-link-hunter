"""
生成死链猎手图标 PNG 文件（16x16, 32x32, 48x48, 128x128）
需要 Pillow 库：pip install Pillow
"""
import struct
import zlib
import math
import os

def write_png(filename, width, height, pixels):
    """纯 Python 写 PNG，不依赖第三方库"""
    def pack_chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    # PNG signature
    sig = b'\x89PNG\r\n\x1a\n'
    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr = pack_chunk(b'IHDR', ihdr_data)
    # IDAT
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter type
        for x in range(width):
            r, g, b = pixels[y][x]
            raw_data += bytes([r, g, b])
    compressed = zlib.compress(raw_data, 9)
    idat = pack_chunk(b'IDAT', compressed)
    # IEND
    iend = pack_chunk(b'IEND', b'')
    with open(filename, 'wb') as f:
        f.write(sig + ihdr + idat + iend)

def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))

def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, int(v)))

def dist(x1, y1, x2, y2):
    return math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)

def render_icon(size):
    """渲染图标像素"""
    pixels = [[(15, 15, 26)] * size for _ in range(size)]  # 背景色 #0f0f1a

    s = size / 128.0  # 缩放因子

    # --- 背景渐变 ---
    for y in range(size):
        for x in range(size):
            # 圆角矩形裁剪
            r = 24 * s
            cx, cy = size / 2, size / 2
            # 简单圆角检测
            dx = max(abs(x - cx) - (size / 2 - r), 0)
            dy = max(abs(y - cy) - (size / 2 - r), 0)
            if math.sqrt(dx * dx + dy * dy) > r:
                pixels[y][x] = (0, 0, 0, 0) if False else (15, 15, 26)
                continue
            # 渐变背景
            tx = x / size
            ty = y / size
            bg = lerp_color((10, 10, 24), (26, 26, 46), (tx + ty) / 2)
            pixels[y][x] = bg

    def draw_line(x0, y0, x1, y1, color, thickness=1.0):
        """抗锯齿线段"""
        dx = x1 - x0; dy = y1 - y0
        length = math.sqrt(dx*dx + dy*dy)
        if length == 0: return
        for y in range(size):
            for x in range(size):
                # 点到线段距离
                t = ((x - x0) * dx + (y - y0) * dy) / (length * length)
                t = max(0, min(1, t))
                px = x0 + t * dx
                py = y0 + t * dy
                d = math.sqrt((x - px)**2 + (y - py)**2)
                alpha = max(0, 1 - max(0, d - thickness/2))
                if alpha > 0.01:
                    bg = pixels[y][x]
                    r = clamp(bg[0] * (1 - alpha) + color[0] * alpha)
                    g = clamp(bg[1] * (1 - alpha) + color[1] * alpha)
                    b = clamp(bg[2] * (1 - alpha) + color[2] * alpha)
                    pixels[y][x] = (r, g, b)

    def draw_circle(cx, cy, radius, color, thickness=1.5):
        for y in range(size):
            for x in range(size):
                d = abs(dist(x, y, cx, cy) - radius)
                alpha = max(0, 1 - max(0, d - thickness/2))
                if alpha > 0.01:
                    bg = pixels[y][x]
                    r = clamp(bg[0] * (1 - alpha) + color[0] * alpha)
                    g = clamp(bg[1] * (1 - alpha) + color[1] * alpha)
                    b = clamp(bg[2] * (1 - alpha) + color[2] * alpha)
                    pixels[y][x] = (r, g, b)

    def draw_filled_circle(cx, cy, radius, color):
        for y in range(size):
            for x in range(size):
                d = dist(x, y, cx, cy)
                alpha = max(0, 1 - max(0, d - radius + 1))
                if alpha > 0.01:
                    bg = pixels[y][x]
                    r = clamp(bg[0] * (1 - alpha) + color[0] * alpha)
                    g = clamp(bg[1] * (1 - alpha) + color[1] * alpha)
                    b = clamp(bg[2] * (1 - alpha) + color[2] * alpha)
                    pixels[y][x] = (r, g, b)

    # 颜色定义
    CYAN    = (0, 210, 255)
    BLUE    = (58, 123, 213)
    RED     = (255, 80, 100)
    RED2    = (238, 9, 121)
    CYAN_DIM = (0, 100, 130)

    # 链条圆弧左侧
    # 左链环：中心 (44, 59)，用两个圆弧表示
    lc_x, lc_y = 44 * s, 59 * s
    lc_r = 14 * s
    for angle_deg in range(200, 520, 2):
        angle = math.radians(angle_deg)
        cx2 = lc_x + lc_r * math.cos(angle)
        cy2 = lc_y + lc_r * math.sin(angle)
        color = lerp_color(CYAN, BLUE, (angle_deg - 200) / 320)
        draw_filled_circle(cx2, cy2, max(1.5, 2.5 * s), color)

    # 右链环
    rc_x, rc_y = 84 * s, 59 * s
    rc_r = 14 * s
    for angle_deg in range(-20, 300, 2):
        angle = math.radians(angle_deg)
        cx2 = rc_x + rc_r * math.cos(angle)
        cy2 = rc_y + rc_r * math.sin(angle)
        color = lerp_color(BLUE, CYAN, (angle_deg + 20) / 320)
        draw_filled_circle(cx2, cy2, max(1.5, 2.5 * s), color)

    # 断裂部分 - 左侧残端
    draw_line(48 * s, 59 * s, 56 * s, 59 * s, RED, max(2, 4 * s))
    # 断裂部分 - 右侧残端
    draw_line(72 * s, 59 * s, 80 * s, 59 * s, RED, max(2, 4 * s))

    # 中心 X
    x_size = 6 * s
    cx_mid = 64 * s
    cy_mid = 59 * s
    draw_line(cx_mid - x_size, cy_mid - x_size, cx_mid + x_size, cy_mid + x_size, RED, max(1.5, 3 * s))
    draw_line(cx_mid + x_size, cy_mid - x_size, cx_mid - x_size, cy_mid + x_size, RED, max(1.5, 3 * s))

    # 火花粒子
    sparks = [
        (64, 50, 2.5), (60, 56, 1.8), (68, 54, 1.5),
        (64, 68, 2.5), (62, 63, 1.5), (67, 65, 1.8)
    ]
    for sx, sy, sr in sparks:
        color = lerp_color(RED, RED2, 0.5)
        draw_filled_circle(sx * s, sy * s, max(1, sr * s), color)

    # 底部扫描线
    for i, (y_pos, opacity) in enumerate([(94, 0.3), (99, 0.2), (104, 0.1)]):
        x_start = (20 + i * 10) * s
        x_end = (108 - i * 10) * s
        line_color = tuple(int(c * opacity) for c in CYAN)
        draw_line(x_start, y_pos * s, x_end, y_pos * s, line_color, max(0.5, 1 * s))

    return pixels

# 生成各尺寸图标
output_dir = os.path.dirname(os.path.abspath(__file__))
sizes = [16, 32, 48, 128]

for sz in sizes:
    pixels = render_icon(sz)
    output_path = os.path.join(output_dir, 'icons', f'icon{sz}.png')
    write_png(output_path, sz, sz, pixels)
    print(f"Generated: icon{sz}.png")

print("All icons generated successfully!")
