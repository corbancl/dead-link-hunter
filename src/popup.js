// 死链猎手 - Popup 控制器

let currentResults = null;
let isScanning = false;
let currentTab = null;
let progressInterval = null;

// DOM 元素引用
const $ = id => document.getElementById(id);

const views = {
  idle: $('view-idle'),
  scanning: $('view-scanning'),
  result: $('view-result')
};

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // 更新页面信息
  $('page-url').textContent = truncate(tab.url || '', 50);
  $('page-title').textContent = truncate(tab.title || '', 40);

  // 尝试读取上次扫描结果
  const stored = await chrome.storage.local.get('lastScanResult');
  if (stored.lastScanResult) {
    const result = stored.lastScanResult;
    // 检查是否是同一页面的结果
    if (result.allLinks && result.allLinks[0]?.pageUrl === tab.url) {
      currentResults = result;
      showView('result');
      renderResults(result);
    }
  }

  // 绑定事件
  $('btn-scan').addEventListener('click', startScan);
  $('btn-rescan').addEventListener('click', startScan);
  $('btn-cancel').addEventListener('click', cancelScan);
  $('btn-export').addEventListener('click', showExportMenu);
  $('filter-all').addEventListener('click', () => filterResults('all'));
  $('filter-dead').addEventListener('click', () => filterResults('dead'));
  $('filter-live').addEventListener('click', () => filterResults('live'));
  $('filter-internal').addEventListener('click', () => filterResults('internal'));
  $('filter-external').addEventListener('click', () => filterResults('external'));
  $('search-input').addEventListener('input', onSearch);

  // 导出按钮
  document.querySelectorAll('.export-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const format = e.currentTarget.dataset.format;
      doExport(format);
      $('export-menu').classList.add('hidden');
    });
  });

  // 点击其他地方关闭导出菜单
  document.addEventListener('click', (e) => {
    if (!$('btn-export').contains(e.target) && !$('export-menu').contains(e.target)) {
      $('export-menu').classList.add('hidden');
    }
  });

  // 监听 background 消息
  chrome.runtime.onMessage.addListener(onMessage);
}

function onMessage(message) {
  if (message.type === 'PROGRESS') {
    updateProgress(message.completed, message.total);
  } else if (message.type === 'SCAN_COMPLETE') {
    loadAndShowResults();
  }
}

async function startScan() {
  if (isScanning) return;
  isScanning = true;

  showView('scanning');
  $('progress-bar-fill').style.width = '0%';
  $('progress-text').textContent = '0 / 0';
  $('scan-status').textContent = '正在收集页面链接...';

  // 清除上次结果
  await chrome.storage.local.remove('lastScanResult');

  const result = await chrome.runtime.sendMessage({
    type: 'START_CHECK',
    tabId: currentTab.id,
    options: {}
  });

  if (!result || !result.success) {
    isScanning = false;
    $('scan-status').textContent = '扫描失败：' + (result?.error || '未知错误');
    setTimeout(() => showView('idle'), 2000);
  }
}

function cancelScan() {
  chrome.runtime.sendMessage({ type: 'CANCEL_CHECK' });
  isScanning = false;
  showView('idle');
}

function updateProgress(completed, total) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  $('progress-bar-fill').style.width = pct + '%';
  $('progress-text').textContent = `${completed} / ${total}`;
  $('scan-status').textContent = `正在检测链接... (${pct}%)`;
}

async function loadAndShowResults() {
  isScanning = false;
  const stored = await chrome.storage.local.get('lastScanResult');
  if (stored.lastScanResult) {
    currentResults = stored.lastScanResult;
    showView('result');
    renderResults(currentResults);
  }
}

function renderResults(result) {
  const { allLinks, deadLinks, total, deadCount, liveCount, scannedAt } = result;

  // 统计数据
  $('stat-total').textContent = total;
  $('stat-dead').textContent = deadCount;
  $('stat-live').textContent = liveCount;
  $('stat-internal').textContent = allLinks.filter(l => l.isInternal).length;

  const deadRate = total > 0 ? ((deadCount / total) * 100).toFixed(1) : 0;
  $('stat-dead-rate').textContent = deadRate + '%';
  $('stat-dead-rate').className = parseFloat(deadRate) > 20 ? 'danger' : parseFloat(deadRate) > 5 ? 'warn' : 'success';

  if (scannedAt) {
    $('scan-time').textContent = '扫描于 ' + new Date(scannedAt).toLocaleString('zh-CN');
  }

  // 更新过滤器计数
  $('filter-all').querySelector('.badge').textContent = total;
  $('filter-dead').querySelector('.badge').textContent = deadCount;
  $('filter-live').querySelector('.badge').textContent = liveCount;
  $('filter-internal').querySelector('.badge').textContent = allLinks.filter(l => l.isInternal).length;
  $('filter-external').querySelector('.badge').textContent = allLinks.filter(l => !l.isInternal).length;

  // 默认显示全部，如果有死链则高亮死链 tab
  if (deadCount > 0) {
    filterResults('dead');
  } else {
    filterResults('all');
  }
}

let activeFilter = 'all';
let searchQuery = '';

function filterResults(filter) {
  activeFilter = filter;

  // 更新按钮状态
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === 'filter-' + filter);
  });

  renderTable();
}

function onSearch(e) {
  searchQuery = e.target.value.toLowerCase().trim();
  renderTable();
}

function renderTable() {
  if (!currentResults) return;

  let data = currentResults.allLinks;

  // 过滤
  if (activeFilter === 'dead') data = data.filter(l => l.isDead);
  else if (activeFilter === 'live') data = data.filter(l => !l.isDead);
  else if (activeFilter === 'internal') data = data.filter(l => l.isInternal);
  else if (activeFilter === 'external') data = data.filter(l => !l.isInternal);

  // 搜索
  if (searchQuery) {
    data = data.filter(l =>
      (l.url || '').toLowerCase().includes(searchQuery) ||
      (l.text || '').toLowerCase().includes(searchQuery) ||
      (l.statusText || '').toLowerCase().includes(searchQuery)
    );
  }

  $('result-count').textContent = `共 ${data.length} 条`;

  const tbody = $('links-tbody');
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">暂无数据</td></tr>`;
    return;
  }

  tbody.innerHTML = data.slice(0, 200).map(item => `
    <tr class="${item.isDead ? 'dead' : 'live'}">
      <td class="url-td">
        <div class="url-text" title="${escHtml(item.url)}">
          <a href="${escHtml(item.url)}" target="_blank" class="url-link">${escHtml(truncate(item.url, 55))}</a>
        </div>
        <div class="link-meta">${escHtml(truncate(item.text || '', 35))}</div>
      </td>
      <td class="center"><span class="status-badge s${Math.floor((item.status || 0) / 100)}xx">${item.status || '?'}</span></td>
      <td class="status-text">${escHtml(item.statusText || '')}</td>
      <td class="center"><span class="type-tag ${item.isInternal ? 'int' : 'ext'}">${item.isInternal ? '内' : '外'}</span></td>
      <td class="center result-icon">${item.isDead ? '❌' : '✅'}</td>
    </tr>
  `).join('');

  if (data.length > 200) {
    tbody.innerHTML += `<tr><td colspan="5" class="empty-row">仅显示前 200 条，请使用导出功能查看完整数据</td></tr>`;
  }
}

function showExportMenu() {
  $('export-menu').classList.toggle('hidden');
}

function doExport(format) {
  if (!currentResults) return;
  const data = currentResults.allLinks;
  const meta = { pageUrl: currentTab?.url || '', pageTitle: currentTab?.title || '' };

  let content, filename, mimeType;

  switch (format) {
    case 'csv':
      content = exportToCSV(data);
      filename = `死链猎手_${dateStr()}.csv`;
      mimeType = 'text/csv;charset=utf-8';
      break;
    case 'json':
      content = exportToJSON(data, meta);
      filename = `死链猎手_${dateStr()}.json`;
      mimeType = 'application/json';
      break;
    case 'html':
      content = exportToHTML(data, meta);
      filename = `死链猎手_${dateStr()}.html`;
      mimeType = 'text/html;charset=utf-8';
      break;
    case 'csv-dead':
      content = exportToCSV(data.filter(d => d.isDead));
      filename = `死链猎手_死链_${dateStr()}.csv`;
      mimeType = 'text/csv;charset=utf-8';
      break;
    default:
      return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  // 显示成功提示
  showToast(`已导出 ${filename}`);
}

function showView(name) {
  Object.keys(views).forEach(k => {
    views[k].classList.toggle('hidden', k !== name);
  });
}

function showToast(msg) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dateStr() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

// 等待 DOM 就绪
document.addEventListener('DOMContentLoaded', init);
