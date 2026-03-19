// 死链猎手 - Background Service Worker
// 负责实际发起请求检测链接状态

const CHECK_TIMEOUT = 10000; // 10秒超时
const CONCURRENT_LIMIT = 5;  // 最大并发数

/**
 * 检测单个 URL 的状态
 */
async function checkUrl(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT);

  try {
    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-cache'
    });
    clearTimeout(timeoutId);

    const elapsed = Date.now() - startTime;
    const status = response.status;
    const isDead = status >= 400 || status === 0;

    return {
      url,
      status,
      statusText: response.statusText || getStatusText(status),
      isDead,
      elapsed,
      finalUrl: response.url !== url ? response.url : null, // 重定向
      error: null
    };
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      return { url, status: 0, statusText: '请求超时', isDead: true, elapsed: CHECK_TIMEOUT, error: 'timeout' };
    }

    // 尝试 GET 请求（部分服务器不支持 HEAD）
    try {
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), CHECK_TIMEOUT);
      const startTime = Date.now();

      const response = await fetch(url, {
        method: 'GET',
        signal: controller2.signal,
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-cache'
      });
      clearTimeout(timeoutId2);

      const elapsed = Date.now() - startTime;
      const status = response.status;
      return {
        url,
        status,
        statusText: response.statusText || getStatusText(status),
        isDead: status >= 400,
        elapsed,
        finalUrl: response.url !== url ? response.url : null,
        error: null
      };
    } catch (err2) {
      return {
        url,
        status: 0,
        statusText: '无法访问',
        isDead: true,
        elapsed: 0,
        error: err2.name === 'AbortError' ? 'timeout' : 'network_error'
      };
    }
  }
}

/**
 * 获取 HTTP 状态码描述
 */
function getStatusText(status) {
  const map = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: '永久重定向', 302: '临时重定向', 304: '未修改',
    400: '请求错误', 401: '未授权', 403: '禁止访问',
    404: '页面不存在', 405: '方法不允许', 408: '请求超时',
    410: '资源已删除', 429: '请求过多', 500: '服务器错误',
    502: '网关错误', 503: '服务不可用', 504: '网关超时', 0: '无法连接'
  };
  return map[status] || `HTTP ${status}`;
}

/**
 * 并发控制检测多个 URL
 */
async function checkUrlsBatch(urls, onProgress) {
  const results = [];
  let completed = 0;

  // 分批并发处理
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
      const check = checkResults[link.url] || { status: 0, statusText: '未检测', isDead: false };
      return { ...link, ...check };
    });

    const deadLinks = mergedResults.filter(r => r.isDead);
    const liveLinks = mergedResults.filter(r => !r.isDead);

    globalScanState.scanning = false;

    // 存储结果
    await chrome.storage.local.set({
      lastScanResult: {
        allLinks: mergedResults,
        deadLinks,
        liveLinks,
        total: mergedResults.length,
        deadCount: deadLinks.length,
        liveCount: liveLinks.length,
        scannedAt: new Date().toISOString(),
        cancelled: globalScanState.cancelled
      }
    });

    try {
      chrome.runtime.sendMessage({
        type: 'SCAN_COMPLETE',
        deadCount: deadLinks.length,
        total: mergedResults.length
      });
    } catch (e) { /* popup 可能已关闭 */ }

    return { success: true, deadCount: deadLinks.length, total: mergedResults.length };

  } catch (err) {
    globalScanState.scanning = false;
    return { success: false, error: err.message };
  }
}
