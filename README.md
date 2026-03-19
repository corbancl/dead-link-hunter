# 死链猎手 - Chrome 扩展

<div align="center">

![死链猎手](icons/icon128.png)

**专业的网页死链检测与导出工具**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat&logo=googlechrome&logoColor=white)](https://github.com)
[![Version](https://img.shields.io/badge/version-1.0.0-00d2ff?style=flat)](https://github.com)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat)](LICENSE)

</div>

---

## ✨ 功能特性

- 🔍 **一键扫描** 当前页面所有链接（`<a href>` 标签）
- ⚡ **并发检测** 最大 5 路并发，快速完成大页面扫描
- 📊 **多维统计** 总数 / 死链数 / 正常数 / 内外链分布
- 🔎 **实时搜索** 按 URL 或链接文本即时筛选结果
- 💾 **多格式导出**：
  - `CSV` — 全量数据，Excel 友好（UTF-8 BOM）
  - `CSV（仅死链）` — 快速定位失效链接
  - `HTML 报告` — 精美可视化报告，可直接分享
  - `JSON` — 结构化数据，方便程序处理
- 🎨 **深色美观界面**，科技感十足

## 🖼️ 界面预览

| 首页 | 扫描中 | 结果页 |
|:---:|:---:|:---:|
| 点击开始扫描 | 实时进度显示 | 列表+筛选+导出 |

## 📦 安装方法

### 方法一：从源码安装（开发者模式）

1. 克隆或下载本项目：
   ```bash
   git clone https://github.com/YOUR_USERNAME/dead-link-hunter.git
   ```

2. 打开 Chrome 浏览器，访问 `chrome://extensions/`

3. 开启右上角的 **"开发者模式"**

4. 点击 **"加载已解压的扩展程序"**，选择项目根目录

5. 插件图标将出现在浏览器工具栏

### 方法二：Chrome Web Store（即将上架）

> 正在审核中，敬请期待...

## 🚀 使用方法

1. 打开任意网页
2. 点击浏览器工具栏中的 **死链猎手** 图标
3. 点击 **"开始扫描"** 按钮
4. 等待扫描完成，查看检测结果
5. 使用筛选器浏览 **死链 / 正常链接 / 内链 / 外链**
6. 点击 **"导出"** 按钮，选择需要的格式下载报告

## 🛠️ 技术实现

| 模块 | 说明 |
|------|------|
| `manifest.json` | Chrome MV3 扩展配置 |
| `src/content.js` | 注入页面，收集所有 `<a>` 链接 |
| `src/background.js` | Service Worker，并发 HTTP 检测 |
| `src/exporter.js` | 导出模块（CSV / JSON / HTML） |
| `src/popup.js` | Popup 控制器 |
| `popup.html` | 扩展弹窗 UI |

### 检测逻辑

1. 优先使用 `HEAD` 请求（减少带宽消耗）
2. 若 `HEAD` 失败，自动降级为 `GET` 请求
3. 超时时间：10 秒
4. HTTP 状态 ≥ 400 或网络错误均判定为死链
5. 跟踪重定向链，记录最终 URL

## 📋 状态码说明

| 状态 | 含义 | 是否死链 |
|------|------|:---:|
| 2xx | 正常可访问 | ❌ |
| 3xx | 重定向（正常） | ❌ |
| 400 | 请求错误 | ✅ |
| 401 | 未授权（需登录） | ✅ |
| 403 | 禁止访问 | ✅ |
| 404 | 页面不存在 | ✅ |
| 410 | 资源已永久删除 | ✅ |
| 5xx | 服务器错误 | ✅ |
| 0   | 超时/无法连接 | ✅ |

## 📄 许可证

[MIT License](LICENSE) © 2026

---

<div align="center">
  由 <strong>死链猎手</strong> 团队用 ❤️ 打造
</div>
