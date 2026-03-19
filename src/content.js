// 死链猎手 - Content Script
// 负责在页面中收集所有链接

/**
 * 收集当前页面的所有链接
 */
function collectAllLinks() {
  const links = document.querySelectorAll('a[href]');
  const result = [];
  const seen = new Set();

  links.forEach((link) => {
    const href = link.href;
    const text = (link.textContent || link.innerText || '').trim().substring(0, 100);
    const title = link.title || '';

    // 过滤无效链接
    if (!href || seen.has(href)) return;
    if (href.startsWith('javascript:')) return;
    if (href.startsWith('mailto:')) return;
    if (href.startsWith('tel:')) return;
    if (href.startsWith('#')) return;
    if (href === 'about:blank') return;

    seen.add(href);

    // 获取链接在页面中的位置信息
    const rect = link.getBoundingClientRect();
    const xpath = getXPath(link);

    result.push({
      url: href,
      text: text || title || href,
      title: title,
      xpath: xpath,
      tagName: link.tagName,
      isInternal: isSameOrigin(href),
      pageUrl: window.location.href,
      pageTitle: document.title
    });
  });

  return result;
}

/**
 * 判断是否同源链接
 */
function isSameOrigin(href) {
  try {
    const url = new URL(href);
    return url.origin === window.location.origin;
  } catch (e) {
    return false;
  }
}

/**
 * 获取元素的简化 XPath
 */
function getXPath(element) {
  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 0;
    let sibling = current.previousSibling;
    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === current.tagName) {
        index++;
      }
      sibling = sibling.previousSibling;
    }
    const tagName = current.tagName.toLowerCase();
    const part = index > 0 ? `${tagName}[${index + 1}]` : tagName;
    parts.unshift(part);
    current = current.parentNode;
    if (parts.length > 5) break; // 限制深度
  }
  return '/' + parts.join('/');
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'COLLECT_LINKS') {
    try {
      const links = collectAllLinks();
      sendResponse({ success: true, links, count: links.length });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }
  return true;
});
