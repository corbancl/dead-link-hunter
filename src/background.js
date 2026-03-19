// 死链猎手 - Background Service Worker
// 职责：调度管理（不再自己发 fetch，避免 CORS 误报）
// 实际链接检测由 content script 在页面上下文中完成

const globalScanState = {
  scanning: false,
  cancelled: false,
  tabId: null
};

// ─────────────────────────────────────────
// 消息路由
// ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    case 'START_CHECK':
      handleStartCheck(message.tabId, message.options || {}).then(sendResponse);
      return true;

    case 'GET_STATUS':
      sendResponse({ scanning: globalScanState.scanning });
      return true;

    case 'CANCEL_CHECK':
      handleCancel().then(() => sendResponse({ success: true }));
      return true;

    // content script 上报进度 → 转发给 popup
    case 'PROGRESS':
      chrome.runtime.sendMessage({
        type: 'PROGRESS',
        completed: message.completed,
        total: message.total
      }).catch(() => {});
      return false;

    // content script 上报检测完成
    case 'CHECK_DONE':
      handleCheckDone(message.results).catch(() => {});
      return false;
  }
});

// ─────────────────────────────────────────
// 扫描流程
// ─────────────────────────────────────────
async function handleStartCheck(tabId, options) {
  if (globalScanState.scanning) {
    return { success: false, error: '扫描进行中' };
  }

  globalScanState.scanning = true;
  globalScanState.cancelled = false;
  globalScanState.tabId = tabId;

  try {
    // 1. 注入 content script（已注入则忽略错误）
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content.js']
    }).catch(() => {});

    // 2. 收集页面链接
    const collectResult = await chrome.tabs.sendMessage(tabId, { type: 'COLLECT_LINKS' });

    if (!collectResult || !collectResult.success) {
      throw new Error('无法获取页面链接，请刷新页面后重试');
    }

    const allLinks = collectResult.links;
    if (!allLinks || allLinks.length === 0) {
      globalScanState.scanning = false;
      return { success: false, error: '页面上没有找到有效链接' };
    }

    // 3. 将链接信息暂存，等 CHECK_DONE 时合并
    globalScanState.pendingLinks = allLinks;

    // 4. 把去重后的 URL 下发给 content script 在页面上下文中检测
    const uniqueUrls = [...new Set(allLinks.map(l => l.url))];

    await chrome.tabs.sendMessage(tabId, {
      type: 'CHECK_LINKS',
      urls: uniqueUrls
    });

    return { success: true, total: allLinks.length };

  } catch (err) {
    globalScanState.scanning = false;
    return { success: false, error: err.message };
  }
}

async function handleCancel() {
  globalScanState.cancelled = true;
  globalScanState.scanning = false;

  if (globalScanState.tabId) {
    await chrome.tabs.sendMessage(globalScanState.tabId, { type: 'ABORT_CHECK' }).catch(() => {});
  }
}

async function handleCheckDone(checkResults) {
  if (globalScanState.cancelled) return;

  const allLinks = globalScanState.pendingLinks || [];

  // 合并链接信息与检测结果
  const mergedResults = allLinks.map(link => {
    const check = checkResults[link.url] || {
      status: 0,
      statusText: '未检测',
      isDead: false,
      confidence: 'unknown'
    };
    return { ...link, ...check };
  });

  // 分类统计
  const deadLinks       = mergedResults.filter(r => r.confidence === 'dead');
  const restrictedLinks = mergedResults.filter(r => r.confidence === 'restricted');
  const uncertainLinks  = mergedResults.filter(r => r.confidence === 'uncertain');
  const liveLinks       = mergedResults.filter(r => r.confidence === 'live');

  globalScanState.scanning = false;

  // 持久化存储
  await chrome.storage.local.set({
    lastScanResult: {
      allLinks: mergedResults,
      deadLinks,
      restrictedLinks,
      uncertainLinks,
      liveLinks,
      total:          mergedResults.length,
      deadCount:      deadLinks.length,
      restrictedCount: restrictedLinks.length,
      uncertainCount: uncertainLinks.length,
      liveCount:      liveLinks.length,
      scannedAt:      new Date().toISOString(),
      cancelled:      globalScanState.cancelled
    }
  });

  // 通知 popup 完成
  chrome.runtime.sendMessage({
    type: 'SCAN_COMPLETE',
    deadCount:       deadLinks.length,
    restrictedCount: restrictedLinks.length,
    uncertainCount:  uncertainLinks.length,
    total:           mergedResults.length
  }).catch(() => {});
}
