// 死链猎手 - Content Script
// 负责：1) 收集页面链接  2) 在页面上下文中发起检测请求（规避 CORS）

const CHECK_TIMEOUT = 15000;
const CONCURRENT_LIMIT = 4;

// ─────────────────────────────────────────
// 链接收集
// ─────────────────────────────────────────
function collectAllLinks() {
  const links = document.querySelectorAll('a[href]');
  const result = [];
  const seen = new Set();

  links.forEach((link) => {
    const href = link.href;
    const text = (link.textContent || link.innerText || '').trim().substring(0, 100);
    const title = link.title || '';

    if (!href || seen.has(href)) return;
    if (href.startsWith('javascript:')) return;
    if (href.startsWith('mailto:')) return;
    if (href.startsWith('tel:')) return;
    if (href.startsWith('#')) return;
    if (href === 'about:blank') return;
    // 跳过 data: blob: 等非 http 链接
    if (!/^https?:\/\//i.test(href)) return;

    seen.add(href);

    result.push({
      url: href,
      text: text || title || href,
      title,
      tagName: link.tagName,
      isInternal: isSameOrigin(href),
      pageUrl: window.location.href,
      pageTitle: document.title
    });
  });

  return result;
}

function isSameOrigin(href) {
  try {
    return new URL(href).origin === window.location.origin;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────
// 请求检测（在页面上下文中执行，天然带 Origin/Referer）
// ─────────────────────────────────────────

const TRUE_DEAD_STATUSES    = new Set([404, 410, 451]);
const SERVER_ERROR_STATUSES = new Set([500, 502, 503, 504]);
const ACCESS_DENIED_STATUSES = new Set([401, 403]);
const METHOD_NOT_ALLOWED    = new Set([405, 501]);

/**
 * 单次 fetch，返回标准化结果
 */
async function doFetch(url, method) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), CHECK_TIMEOUT);
  const t0 = Date.now();

  try {
    const resp = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: 'follow',
      // 关键：不设置 credentials:'omit'，让浏览器携带当前站点 cookie
      // 这样对需要登录态才能访问的内链也能正确判断
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    clearTimeout(tid);
    return {
      ok: true,
      status: resp.status,
      statusText: resp.statusText || httpText(resp.status),
      elapsed: Date.now() - t0,
      finalUrl: resp.url !== url ? resp.url : null
    };
  } catch (err) {
    clearTimeout(tid);
    if (err.name === 'AbortError') {
      return { ok: false, error: 'timeout', elapsed: CHECK_TIMEOUT };
    }
    // TypeError: Failed to fetch → 网络不可达（真正的连接失败）
    // 注意：content script 内的 fetch CORS 失败会抛 TypeError，
    // 而不像 background 里那样能拿到状态码
    return { ok: false, error: 'network', elapsed: Date.now() - t0, msg: err.message };
  }
}

/**
 * 智能检测单个 URL
 *
 * 完整决策树：
 *   HEAD
 *   ├─ 2xx/3xx                  → live ✅
 *   ├─ 404/410/451              → fallbackGet (HEAD 404 未必真死链)
 *   ├─ 405/501                  → fallbackGet (服务器不支持 HEAD)
 *   ├─ 401/403                  → fallbackGet (服务器对非浏览器限制)
 *   ├─ 5xx                      → fallbackGet (服务器临时错误)
 *   ├─ 其他 4xx                 → fallbackGet
 *   ├─ timeout                  → uncertain ❓
 *   └─ network error            → fallbackGet
 *
 *   GET (fallback)
 *   ├─ 2xx/3xx                  → live ✅
 *   ├─ 404/410/451              → dead ❌
 *   ├─ 401/403                  → restricted 🔒
 *   ├─ 5xx                      → uncertain ❓
 *   ├─ 其他 4xx                 → dead ❌
 *   ├─ timeout                  → uncertain ❓
 *   └─ network error            → uncertain ❓（CORS/网络不可达，保守处理）
 */
async function checkUrl(url) {
  const head = await doFetch(url, 'HEAD');

  // HEAD 超时：不做第二次请求，直接标记为不确定
  if (!head.ok && head.error === 'timeout') {
    return buildResult(url, 0, false, 'uncertain', head, null, '请求超时，无法确认');
  }

  // HEAD 成功且是 2xx/3xx：直接认为正常，无需 GET
  if (head.ok && head.status >= 200 && head.status < 400) {
    return buildResult(url, head.status, false, 'live', head);
  }

  // 所有其他情况一律降级 GET 再验证
  // （包括 HEAD 返回 404 —— 因为有些服务器 HEAD 404 但 GET 200）
  return fallbackGet(url, head);
}

async function fallbackGet(url, headResult) {
  const get = await doFetch(url, 'GET');

  if (get.ok) {
    const s = get.status;

    if (s >= 200 && s < 400) {
      // GET 正常：无论 HEAD 返回什么，链接是活的
      return buildResult(url, s, false, 'live', get, headResult);
    }
    if (TRUE_DEAD_STATUSES.has(s)) {
      // HEAD 和 GET 都确认 404/410 → 真死链
      return buildResult(url, s, true, 'dead', get, headResult);
    }
    if (ACCESS_DENIED_STATUSES.has(s)) {
      // 两次都被服务器拒绝，但不等于资源不存在
      return buildResult(url, s, false, 'restricted', get, headResult, '服务器访问限制，浏览器直接访问可能正常');
    }
    if (SERVER_ERROR_STATUSES.has(s)) {
      return buildResult(url, s, false, 'uncertain', get, headResult, '服务器错误，可能是临时故障');
    }
    // 其他 4xx (400/429 等)
    return buildResult(url, s, true, 'dead', get, headResult);
  }

  // GET 也失败
  if (get.error === 'timeout') {
    return buildResult(url, 0, false, 'uncertain', get, headResult, '两次请求均超时，无法确认');
  }

  // network error：
  // 在 content script 里，这通常意味着：
  //   (a) 真正的网络不可达（DNS 失败、连接拒绝）→ 才是真死链
  //   (b) 服务器因某种原因中断连接
  // 与 background worker 不同，content script 里 CORS 失败也是 network error
  // 区分方式：同源链接的 network error 是真实连接失败；跨域 network error 可能是 CORS
  const isInternal = (() => {
    try { return new URL(url).origin === location.origin; } catch { return false; }
  })();

  if (isInternal) {
    // 内链 network error → 资源确实有问题
    return buildResult(url, 0, true, 'dead', get, headResult, '连接失败');
  } else {
    // 外链 network error → 可能是 CORS，保守标记为「无法确认」
    return buildResult(url, 0, false, 'uncertain', get, headResult, '跨域限制或网络不可达，建议手动验证');
  }
}

function buildResult(url, status, isDead, confidence, fetchResult, prevResult = null, note = null) {
  return {
    url,
    status,
    statusText: (fetchResult && fetchResult.statusText) || httpText(status),
    isDead,
    confidence,
    note,
    elapsed: (fetchResult && fetchResult.elapsed) || 0,
    finalUrl: (fetchResult && fetchResult.finalUrl) || null,
    headStatus: prevResult && prevResult.ok ? prevResult.status : null,
    error: null
  };
}

function httpText(s) {
  const m = {
    200:'OK',201:'Created',204:'No Content',
    301:'永久重定向',302:'临时重定向',304:'未修改',
    400:'请求错误',401:'未授权',403:'禁止访问',
    404:'页面不存在',405:'方法不允许',408:'请求超时',
    410:'资源已删除',429:'请求过多',451:'法律原因不可用',
    500:'服务器错误',502:'网关错误',503:'服务不可用',504:'网关超时',
    0:'无法连接'
  };
  return m[s] || `HTTP ${s}`;
}

// ─────────────────────────────────────────
// 并发控制
// ─────────────────────────────────────────
async function checkBatch(urls, onProgress) {
  const results = {};
  let completed = 0;

  for (let i = 0; i < urls.length; i += CONCURRENT_LIMIT) {
    const batch = urls.slice(i, i + CONCURRENT_LIMIT);
    const batchResults = await Promise.all(batch.map(u => checkUrl(u)));
    batchResults.forEach(r => {
      results[r.url] = r;
      completed++;
      onProgress && onProgress(completed, urls.length);
    });
  }

  return results;
}

// ─────────────────────────────────────────
// 消息处理
// ─────────────────────────────────────────
let scanAborted = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'COLLECT_LINKS') {
    try {
      const links = collectAllLinks();
      sendResponse({ success: true, links, count: links.length });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }

  if (message.type === 'CHECK_LINKS') {
    // background 将检测任务下发到 content script 执行
    scanAborted = false;
    const urls = message.urls;

    checkBatch(urls, (completed, total) => {
      if (scanAborted) return;
      // 发送进度回 background
      chrome.runtime.sendMessage({ type: 'PROGRESS', completed, total }).catch(() => {});
    }).then(results => {
      if (!scanAborted) {
        chrome.runtime.sendMessage({ type: 'CHECK_DONE', results }).catch(() => {});
      }
    });

    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'ABORT_CHECK') {
    scanAborted = true;
    sendResponse({ success: true });
    return true;
  }

  return true;
});
