// 死链猎手 - Background Service Worker
// 负责实际发起请求检测链接状态

const CHECK_TIMEOUT = 12000; // 12秒超时
const CONCURRENT_LIMIT = 4;  // 适当降低并发，减少触发限流

/**
 * 状态码分类
 * - 真死链：404, 410（资源明确不存在）
 * - 服务器错误：500, 502, 503, 504（可能临时）
 * - 访问限制：401, 403（未必是死链，服务器可能拒绝爬虫但对浏览器正常）
 * - 不支持方法：405（HEAD 不支持，需降级 GET）
 * - 正常：2xx, 3xx
 */
const TRUE_DEAD_STATUSES = new Set([404, 410, 451]); // 确认资源不存在
const SERVER_ERROR_STATUSES = new Set([500, 502, 503, 504]); // 服务器错误
const ACCESS_DENIED_STATUSES = new Set([401, 403]); // 访问限制（不一定死链）
const METHOD_NOT_ALLOWED = new Set([405, 501]); // 不支持 HEAD，需降级 GET

/**
 * 构造请求头，尽量模拟浏览器行为
 */
function getBrowserHeaders() {
  return {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
    // 注意：Chrome 扩展 fetch 无法设置 User-Agent，但其他请求头仍然有帮助
  };
}

/**
 * 发起单次请求并返回结果
 */
async function doFetch(url, method, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-cache',
      headers: getBrowserHeaders()
    });
    clearTimeout(timeoutId);
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText || getStatusText(response.status),
      elapsed: Date.now() - startTime,
      finalUrl: response.url !== url ? response.url : null
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { ok: false, error: 'timeout', elapsed: timeout };
    }
    // CORS 错误、网络错误等
    return { ok: false, error: 'network', elapsed: Date.now() - startTime, errorMsg: err.message };
  }
}

/**
 * 智能检测单个 URL
 * 策略：HEAD → 如果失败/405/403 → 降级 GET → 综合判断
 */
async function checkUrl(url) {
  // ── 第一步：HEAD 请求 ──
  const headResult = await doFetch(url, 'HEAD', CHECK_TIMEOUT);

  if (headResult.ok) {
    const status = headResult.status;

    // 确认死链（404/410）
    if (TRUE_DEAD_STATUSES.has(status)) {
      return buildResult(url, status, true, 'dead', headResult);
    }

    // HEAD 不支持，降级 GET
    if (METHOD_NOT_ALLOWED.has(status)) {
      return await fallbackGet(url, 'method_not_allowed');
    }

    // 访问限制：服务器可能只对爬虫返回 403，对浏览器正常
    // 必须用 GET 进一步验证
    if (ACCESS_DENIED_STATUSES.has(status)) {
      return await fallbackGet(url, 'access_denied_head');
    }

    // 服务器错误：记录为疑似，但不立即标记死链
    if (SERVER_ERROR_STATUSES.has(status)) {
      return await fallbackGet(url, 'server_error_head');
    }

    // 2xx / 3xx 正常
    if (status >= 200 && status < 400) {
      return buildResult(url, status, false, 'live', headResult);
    }

    // 其他 4xx（400, 408, 429 等）→ 降级验证
    if (status >= 400) {
      return await fallbackGet(url, 'other_4xx');
    }

    // 兜底：认为正常
    return buildResult(url, status, false, 'live', headResult);
  }

  // ── HEAD 请求本身失败（网络错误/CORS）──
  if (headResult.error === 'timeout') {
    // 超时不等于死链，可能是网速慢
    return {
      url,
      status: 0,
      statusText: '请求超时',
      isDead: false,    // 超时不标记为死链
      confidence: 'uncertain',
      note: '连接超时，无法确认',
      elapsed: headResult.elapsed,
      error: 'timeout'
    };
  }

  // 网络错误（CORS 等）→ 降级 GET 再试一次
  return await fallbackGet(url, 'network_error');
}

/**
 * 降级到 GET 请求进行二次验证
 */
async function fallbackGet(url, reason) {
  const getResult = await doFetch(url, 'GET', CHECK_TIMEOUT);

  if (getResult.ok) {
    const status = getResult.status;

    // GET 也是 404/410 → 确认死链
    if (TRUE_DEAD_STATUSES.has(status)) {
      return buildResult(url, status, true, 'dead', getResult, reason);
    }

    // GET 返回 2xx/3xx → 明确可访问，不是死链
    if (status >= 200 && status < 400) {
      return buildResult(url, status, false, 'live', getResult, reason);
    }

    // GET 也返回 403/401：服务器限制，但不能确认死链
    // 对于 403，保守处理：标记为「访问受限」而非死链
    if (ACCESS_DENIED_STATUSES.has(status)) {
      return buildResult(url, status, false, 'restricted', getResult, reason, '服务器访问限制，浏览器可能可以正常访问');
    }

    // GET 也返回 5xx
    if (SERVER_ERROR_STATUSES.has(status)) {
      // 服务器错误：标记为疑似死链（confidence: uncertain）
      return buildResult(url, status, false, 'uncertain', getResult, reason, '服务器错误，可能是临时故障');
    }

    // GET 也是其他 4xx（400/429 等）
    if (status >= 400) {
      return buildResult(url, status, true, 'dead', getResult, reason);
    }

    return buildResult(url, status, false, 'live', getResult, reason);
  }

  // GET 也失败
  if (getResult.error === 'timeout') {
    return {
      url,
      status: 0,
      statusText: '请求超时',
      isDead: false,
      confidence: 'uncertain',
      note: '两次请求均超时，无法确认',
      elapsed: getResult.elapsed,
      error: 'timeout'
    };
  }

  // 两次都网络错误 → 可能是 CORS 跨域拦截，这种情况不能判断为死链
  // CORS 错误意味着服务器有响应（拒绝了跨域请求），所以链接实际上是活的
  return {
    url,
    status: 0,
    statusText: 'CORS 限制',
    isDead: false,       // CORS 错误 ≠ 死链，服务器是活的
    confidence: 'uncertain',
    note: '跨域限制，无法从扩展程序验证，建议手动检查',
    elapsed: getResult.elapsed,
    error: 'cors'
  };
}

/**
 * 构建标准化结果对象
 */
function buildResult(url, status, isDead, confidence, fetchResult, reason = null, note = null) {
  return {
    url,
    status,
    statusText: fetchResult.statusText || getStatusText(status),
    isDead,
    confidence, // 'dead' | 'live' | 'restricted' | 'uncertain'
    note,
    elapsed: fetchResult.elapsed || 0,
    finalUrl: fetchResult.finalUrl || null,
    fallbackReason: reason,
    error: null
  };
}

/**
 * 获取 HTTP 状态码描述
 */
function getStatusText(status) {
  const map = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: '永久重定向', 302: '临时重定向', 304: '未修改',
    400: '请求错误', 401: '未授权', 403: '禁止访问（服务器限制）',
    404: '页面不存在', 405: '方法不允许', 408: '请求超时',
    410: '资源已删除', 429: '请求过多', 451: '法律原因不可用',
    500: '服务器错误', 502: '网关错误', 503: '服务不可用',
    504: '网关超时', 0: '无法连接'
  };
  return map[status] || `HTTP ${status}`;
}

/**
 * 并发控制检测多个 URL（带取消支持）
 */
async function checkUrlsBatch(urls, onProgress) {
  const results = [];
  let completed = 0;

  for (let i = 0; i < urls.length; i += CONCURRENT_LIMIT) {
    const batch = urls.slice(i, i + CONCURRENT_LIMIT);
    const batchResults = await Promise.all(batch.map(url => checkUrl(url)));

    batchResults.forEach(result => {
      results.push(result);
      completed++;
      if (onProgress) {
        onProgress({ completed, total: urls.length, result });
      }
    });
  }

  return results;
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_CHECK') {
    handleStartCheck(message.tabId, message.options).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_STATUS') {
    sendResponse({ scanning: globalScanState.scanning });
    return true;
  }
  if (message.type === 'CANCEL_CHECK') {
    globalScanState.cancelled = true;
    globalScanState.scanning = false;
    sendResponse({ success: true });
    return true;
  }
});

// 全局扫描状态
const globalScanState = {
  scanning: false,
  cancelled: false
};

async function handleStartCheck(tabId, options = {}) {
  if (globalScanState.scanning) {
    return { success: false, error: '扫描进行中' };
  }

  globalScanState.scanning = true;
  globalScanState.cancelled = false;

  try {
    // 1. 注入 content script 并收集链接
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content.js']
    }).catch(() => {}); // 已注入时忽略错误

    const collectResult = await chrome.tabs.sendMessage(tabId, { type: 'COLLECT_LINKS' });

    if (!collectResult || !collectResult.success) {
      throw new Error('无法获取页面链接');
    }

    const allLinks = collectResult.links;
    const urls = allLinks.map(l => l.url);
    const uniqueUrls = [...new Set(urls)];

    // 2. 逐批检测
    const checkResults = {};
    let completed = 0;

    for (let i = 0; i < uniqueUrls.length; i += CONCURRENT_LIMIT) {
      if (globalScanState.cancelled) break;

      const batch = uniqueUrls.slice(i, i + CONCURRENT_LIMIT);
      const batchResults = await Promise.all(batch.map(url => checkUrl(url)));

      batchResults.forEach(result => {
        checkResults[result.url] = result;
        completed++;
      });

      // 发送进度更新
      try {
        chrome.runtime.sendMessage({
          type: 'PROGRESS',
          completed,
          total: uniqueUrls.length
        });
      } catch (e) { /* popup 可能已关闭 */ }
    }

    // 3. 合并结果
    const mergedResults = allLinks.map(link => {
      const check = checkResults[link.url] || { status: 0, statusText: '未检测', isDead: false, confidence: 'unknown' };
      return { ...link, ...check };
    });

    // isDead 只包含 confidence==='dead' 的链接，排除 restricted/uncertain
    const deadLinks = mergedResults.filter(r => r.isDead && r.confidence === 'dead');
    const restrictedLinks = mergedResults.filter(r => r.confidence === 'restricted');
    const uncertainLinks = mergedResults.filter(r => r.confidence === 'uncertain');
    const liveLinks = mergedResults.filter(r => !r.isDead && r.confidence !== 'restricted' && r.confidence !== 'uncertain');

    globalScanState.scanning = false;

    // 存储结果
    await chrome.storage.local.set({
      lastScanResult: {
        allLinks: mergedResults,
        deadLinks,
        restrictedLinks,
        uncertainLinks,
        liveLinks,
        total: mergedResults.length,
        deadCount: deadLinks.length,
        restrictedCount: restrictedLinks.length,
        uncertainCount: uncertainLinks.length,
        liveCount: liveLinks.length,
        scannedAt: new Date().toISOString(),
        cancelled: globalScanState.cancelled
      }
    });

    try {
      chrome.runtime.sendMessage({
        type: 'SCAN_COMPLETE',
        deadCount: deadLinks.length,
        restrictedCount: restrictedLinks.length,
        uncertainCount: uncertainLinks.length,
        total: mergedResults.length
      });
    } catch (e) { /* popup 可能已关闭 */ }

    return {
      success: true,
      deadCount: deadLinks.length,
      restrictedCount: restrictedLinks.length,
      uncertainCount: uncertainLinks.length,
      total: mergedResults.length
    };

  } catch (err) {
    globalScanState.scanning = false;
    return { success: false, error: err.message };
  }
}
