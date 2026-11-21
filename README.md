# 嵌套标签（nest-tabs）

Chrome 侧边栏扩展：用**可嵌套的文件夹**收纳标签并自定义名称；没放进文件夹的标签会在设定时间后**自动关闭**。

- Manifest V3，Chrome ≥ 116
- 无框架、无构建、无第三方依赖，原生 ES Modules
- 领域逻辑集中在 `lib/`，可用 Node 直接单测

## 功能

- **侧边栏面板**：点击扩展图标打开 side panel（`openPanelOnActionClick`）
- **嵌套文件夹**：文件夹可无限嵌套、重命名、折叠、拖拽排序，删除文件夹时子节点自动上提
- **临时标签**：未归档的标签按 TTL 自动关闭（1 / 6 / 24 / 72 / 168 小时，或不自动关闭），列表显示剩余时间
- **标签搜索**：合并本地树 + 浏览器历史记录，回车直接打开
- **文件夹预览**：hover 文件夹弹出内容卡片，支持在卡片内二次搜索
- **标签组导入**：把 Chrome 原生标签组一键导入为文件夹
- **右键菜单**：复制链接、重命名、删除、关闭已打开的固定标签等
- **打开即聚焦**：点击已收藏链接时优先聚焦已有标签页，不重复打开

## 目录结构

```
manifest.json          MV3 配置（权限、side panel、图标）
background.js          Service Worker：标签生命周期监听 + TTL 定时清扫
sidepanel.html/css/js  侧边栏 UI（渲染、交互、搜索、拖拽）
lib/model.js           纯函数领域层：状态结构、树操作、URL 归一化、标签组导入
lib/store.js           storage 读写（Web Locks 互斥 + rev 版本号）
lib/model.test.js      领域层单元测试（node:test）
lib/previewData.js     预览页 mock 数据（用真实模型函数构建，结构自动同步）
lib/previewData.test.js 预览数据结构契约测试
preview.html           UI 预览页（mock 数据，无需加载扩展）
icons/                 16 / 32 / 48 / 128 图标
```

## 数据模型

```js
state = {
  version: 1,
  rev: 0,                        // 每次写入递增
  roots: [Folder | Pin],         // 嵌套树
  temps: [Temp],                 // 未归档的临时标签（按 tabId 绑定）
  settings: { tempTtlHours: 24 },
}
```

- **Pin**：已收藏网页，URL 匹配时忽略 hash（`normalizeUrl`）
- **Temp**：临时标签，记录 `tabId / windowId / openedAt`，到期由 background 关闭
- 所有写操作经 `store.updateState()`，在 `navigator.locks` 临界区内完成

## 开发

### 加载扩展

1. 打开 `chrome://extensions`，开启「开发者模式」
2. 「加载已解压的扩展程序」，选择本目录
3. 点击扩展图标打开侧边栏

### 预览 UI（无需加载扩展）

直接用浏览器打开 `preview.html`：

- 默认展示带数据的完整界面
- `preview.html?empty=1` 查看空态

### 运行测试

```sh
npm test          # 等价于 node --test lib/*.test.js
```

测试覆盖 `lib/model.js` 的领域逻辑（树操作、URL 归一化、TTL 分区、标签重绑定、标签组导入等）
与 `lib/previewData.js` 的结构契约，当前 22 个用例。

## 架构说明

- **background.js**：监听 `tabs.onCreated/onUpdated/onRemoved/onReplaced` 维护 `temps`；
  `alarms.sweep` 每分钟清扫过期标签；用 `ownTabIds / pendingUrls / suppressNewTemps`
  抑制自家打开的标签被误记为临时标签；安装/启动时收编并重绑定现有标签。
- **sidepanel.js**：监听 storage 与 tabs 变化做防抖刷新；编辑、拖拽、菜单等
  `busy()` 状态下挂起刷新并标记 `dirty`，避免打断用户操作。
- **lib/**：不依赖 Chrome API 的纯函数，是唯一可单测的层；UI 与 SW 只做编排。
