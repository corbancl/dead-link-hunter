// 死链猎手 - 导出功能模块

/**
 * 导出为 CSV 格式
 */
function exportToCSV(data) {
  const headers = ['URL', '链接文本', '状态码', '状态说明', '是否死链', '响应时间(ms)', '内外链', '所在页面'];
  const rows = data.map(item => [
    item.url,
    (item.text || '').replace(/"/g, '""'),
    item.status || 0,
    item.statusText || '',
    item.isDead ? '是' : '否',
    item.elapsed || 0,
    item.isInternal ? '内链' : '外链',
    item.pageUrl || ''
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  // 添加 UTF-8 BOM 确保 Excel 正确识别中文
  return '\uFEFF' + csvContent;
}

/**
 * 导出为 JSON 格式
 */
function exportToJSON(data, meta = {}) {
  const output = {
    tool: '死链猎手',
    version: '1.0.0',
    exportTime: new Date().toLocaleString('zh-CN'),
    summary: {
      total: data.length,
      dead: data.filter(d => d.isDead).length,
      live: data.filter(d => !d.isDead).length,
      internal: data.filter(d => d.isInternal).length,
      external: data.filter(d => !d.isInternal).length
    },
    ...meta,
    links: data.map(item => ({
      url: item.url,
      text: item.text || '',
      status: item.status || 0,
      statusText: item.statusText || '',
      isDead: item.isDead,
      elapsed: item.elapsed || 0,
      type: item.isInternal ? '内链' : '外链',
      pageUrl: item.pageUrl || '',
      finalUrl: item.finalUrl || null,
      error: item.error || null
    }))
  };
  return JSON.stringify(output, null, 2);
}

/**
 * 导出为 HTML 报告
 */
function exportToHTML(data, meta = {}) {
  const dead = data.filter(d => d.isDead);
  const live = data.filter(d => !d.isDead);
  const deadRate = data.length > 0 ? ((dead.length / data.length) * 100).toFixed(1) : 0;
  const exportTime = new Date().toLocaleString('zh-CN');

  const statusBadge = (status) => {
    if (status === 0) return `<span class="badge timeout">超时/无法访问</span>`;
    if (status >= 500) return `<span class="badge s5xx">${status}</span>`;
    if (status >= 400) return `<span class="badge s4xx">${status}</span>`;
    if (status >= 300) return `<span class="badge s3xx">${status}</span>`;
    return `<span class="badge s2xx">${status}</span>`;
  };

  const renderRows = (items, showAll = false) => items.slice(0, showAll ? Infinity : 500).map(item => `
    <tr class="${item.isDead ? 'dead-row' : 'live-row'}">
      <td class="url-cell">
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(truncate(item.url, 80))}</a>
        ${item.finalUrl ? `<br><small class="redirect">→ 重定向至: ${escapeHtml(truncate(item.finalUrl, 60))}</small>` : ''}
      </td>
      <td>${escapeHtml(truncate(item.text || '-', 40))}</td>
      <td>${statusBadge(item.status)}<br><small>${escapeHtml(item.statusText || '')}</small></td>
      <td><span class="type-badge ${item.isInternal ? 'internal' : 'external'}">${item.isInternal ? '内链' : '外链'}</span></td>
      <td>${item.elapsed ? item.elapsed + 'ms' : '-'}</td>
      <td class="status-icon">${item.isDead ? '❌' : '✅'}</td>
    </tr>
  `).join('');

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function truncate(str, len) {
    return str && str.length > len ? str.substring(0, len) + '…' : (str || '');
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>死链猎手 - 扫描报告</title>
<style>
  :root {
    --bg: #0f0f1a;
    --surface: #1a1a2e;
    --surface2: #16213e;
    --border: rgba(0,210,255,0.15);
    --primary: #00d2ff;
    --danger: #ff6b6b;
    --success: #51cf66;
    --warn: #fcc419;
    --text: #e8e8f0;
    --text-muted: #888aaa;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; padding: 32px; min-width: 900px; }
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--border); }
  .logo { width: 48px; height: 48px; background: linear-gradient(135deg, #00d2ff, #3a7bd5); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; }
  h1 { font-size: 28px; font-weight: 700; color: var(--primary); letter-spacing: -0.5px; }
  .subtitle { color: var(--text-muted); font-size: 14px; margin-top: 4px; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; }
  .stat-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .stat-value { font-size: 36px; font-weight: 700; line-height: 1; }
  .stat-value.danger { color: var(--danger); }
  .stat-value.success { color: var(--success); }
  .stat-value.primary { color: var(--primary); }
  .stat-value.warn { color: var(--warn); }
  .section { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 24px; overflow: hidden; }
  .section-header { padding: 16px 24px; background: var(--surface2); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
  .section-header h2 { font-size: 16px; font-weight: 600; }
  .section-header .count { background: rgba(0,210,255,0.15); color: var(--primary); padding: 2px 10px; border-radius: 20px; font-size: 13px; }
  .section-header .dead-count { background: rgba(255,107,107,0.15); color: var(--danger); padding: 2px 10px; border-radius: 20px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { padding: 12px 16px; text-align: left; font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
  td { padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  .dead-row:hover td { background: rgba(255,107,107,0.05); }
  .live-row:hover td { background: rgba(0,210,255,0.03); }
  .url-cell a { color: var(--primary); text-decoration: none; word-break: break-all; }
  .url-cell a:hover { text-decoration: underline; }
  .redirect { color: var(--text-muted); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; }
  .badge.s2xx { background: rgba(81,207,102,0.2); color: var(--success); }
  .badge.s3xx { background: rgba(252,196,25,0.2); color: var(--warn); }
  .badge.s4xx, .badge.timeout { background: rgba(255,107,107,0.2); color: var(--danger); }
  .badge.s5xx { background: rgba(255,107,107,0.3); color: #ff4040; }
  .type-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; }
  .type-badge.internal { background: rgba(0,210,255,0.15); color: var(--primary); }
  .type-badge.external { background: rgba(255,255,255,0.08); color: var(--text-muted); }
  .status-icon { font-size: 16px; text-align: center; }
  .footer { text-align: center; padding: 24px; color: var(--text-muted); font-size: 12px; }
  .progress-bar { height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; margin: 0 24px 16px; overflow: hidden; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, var(--danger), #ee0979); border-radius: 3px; }
  @media print { body { background: white; color: #333; } }
</style>
</head>
<body>
<div class="header">
  <div class="logo">🔗</div>
  <div>
    <h1>死链猎手 扫描报告</h1>
    <div class="subtitle">扫描页面：${escapeHtml(meta.pageUrl || '')} &nbsp;·&nbsp; 生成时间：${exportTime}</div>
  </div>
</div>

<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-label">总链接数</div>
    <div class="stat-value primary">${data.length}</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">死链数量</div>
    <div class="stat-value danger">${dead.length}</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">正常链接</div>
    <div class="stat-value success">${live.length}</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">死链比例</div>
    <div class="stat-value ${parseFloat(deadRate) > 20 ? 'danger' : parseFloat(deadRate) > 5 ? 'warn' : 'success'}">${deadRate}%</div>
  </div>
</div>

${dead.length > 0 ? `
<div class="section">
  <div class="section-header">
    <h2>⚠️ 死链列表</h2>
    <span class="dead-count">${dead.length} 条</span>
  </div>
  <div class="progress-bar"><div class="progress-fill" style="width:${deadRate}%"></div></div>
  <table>
    <thead><tr>
      <th>链接地址</th><th>链接文本</th><th>状态</th><th>类型</th><th>响应时间</th><th></th>
    </tr></thead>
    <tbody>${renderRows(dead)}</tbody>
  </table>
</div>
` : '<div class="section"><div class="section-header"><h2>✅ 未发现死链</h2></div><p style="padding:24px;color:var(--text-muted)">太棒了！当前页面所有链接均正常可访问。</p></div>'}

<div class="section">
  <div class="section-header">
    <h2>📋 全部链接</h2>
    <span class="count">${data.length} 条</span>
  </div>
  <table>
    <thead><tr>
      <th>链接地址</th><th>链接文本</th><th>状态</th><th>类型</th><th>响应时间</th><th>结果</th>
    </tr></thead>
    <tbody>${renderRows(data)}</tbody>
  </table>
</div>

<div class="footer">
  由 <strong>死链猎手</strong> Chrome 插件生成 &nbsp;·&nbsp; ${exportTime}
</div>

</body></html>`;
}

/**
 * 导出为 TXT 纯文本格式
 */
function exportToTXT(data, meta = {}) {
  const dead = data.filter(d => d.isDead);
  const live = data.filter(d => !d.isDead);
  const exportTime = new Date().toLocaleString('zh-CN');

  // 标题和摘要
  let txt = `════════════════════════════════════════════════════════════
                    死链猎手 - 扫描报告
════════════════════════════════════════════════════════════
扫描页面：${meta.pageUrl || '-'}
生成时间：${exportTime}

─────────── 统计摘要 ───────────
总链接数：${data.length}
确认死链：${dead.length}
正常链接：${live.length}
内链数量：${data.filter(d => d.isInternal).length}
外链数量：${data.filter(d => !d.isInternal).length}
`;

  // 死链列表
  if (dead.length > 0) {
    txt += `
════════════════════════════════════════════════════════════
                      ⚠️ 死链列表 (${dead.length} 条)
════════════════════════════════════════════════════════════
`;
    dead.forEach((item, i) => {
      txt += `
[${i + 1}] ${item.url}
    链接文本：${item.text || '-'}
    状态码：${item.status || '?'} ${item.statusText || ''}
    类型：${item.isInternal ? '内链' : '外链'}
`;
    });
  } else {
    txt += `
════════════════════════════════════════════════════════════
                    ✅ 未发现死链
════════════════════════════════════════════════════════════
太棒了！当前页面所有链接均正常可访问。

`;
  }

  // 全部链接列表
  txt += `
════════════════════════════════════════════════════════════
                    📋 全部链接列表 (${data.length} 条)
════════════════════════════════════════════════════════════
`;
  data.forEach((item, i) => {
    const icon = item.isDead ? '❌' : '✅';
    txt += `
[${i + 1}] ${icon} ${item.url}
    文本：${item.text || '-'} | 状态：${item.status || '?'} | ${item.isInternal ? '内链' : '外链'}
`;
  });

  txt += `
════════════════════════════════════════════════════════════
                    由 死链猎手 Chrome 插件生成
════════════════════════════════════════════════════════════
`;
  return txt;
}

// 供 popup.js 使用
if (typeof module !== 'undefined') {
  module.exports = { exportToCSV, exportToJSON, exportToHTML, exportToTXT };
}
