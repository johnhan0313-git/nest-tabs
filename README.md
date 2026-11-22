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
sidepanel.html/css     侧边栏外壳与样式
sidepanel.js           入口：全局事件绑定、启动
panel/state.js         共享状态（ui/state/tabs/active）与刷新、闪提示、提交
panel/render.js        顶层渲染编排：持久 shell + 槽位对齐，只重建变化的行
panel/rows.js          树与临时标签行：行级键控复用（rowCache）、折叠动画、重命名
panel/dom.js           通用 DOM/SVG 小部件（图标、按钮、占位）与子节点对齐原语 reconcile
panel/menu.js          右键菜单、确认框、浮层翻转
panel/peek.js          折叠文件夹的 hover 预览卡片
panel/search.js        搜索框、结果列表（本地树 + 历史）
panel/actions.js       全部写操作：保存、打开/聚焦标签、复制、导入标签组
panel/dnd.js           拖放排序与「临时 → 固定」
panel/util.js          纯工具函数
lib/model.js           纯函数领域层：状态结构、树操作、URL 归一化、标签组导入
lib/store.js           storage 读写（Web Locks 互斥 + rev 版本号 + 内容无变化不落库）
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

测试覆盖 `lib/model.js` 的领域逻辑（树操作、URL 归一化、TTL 分区、标签重绑定、标签组导入、
图标取用顺序、损坏数据修剪）、`lib/store.js` 的写入策略与 `lib/previewData.js` 的结构契约，
当前 30 个用例。

## 架构说明

- **background.js**：监听 `tabs.onCreated/onUpdated/onRemoved/onReplaced` 维护 `temps`
  （标题/图标类更新跳过全量 `tabs.query`）；`alarms.sweep` 每分钟清扫过期标签
  （同时把 `chrome://` 等内部页面移出跟踪，但不关闭其标签）；
  用 `ownTabIds / pendingUrls / suppressNewTemps` 抑制自家打开的标签被误记为临时标签，
  其中 `ownTabIds / pendingUrls` 持久化到 `storage.session`（MV3 SW 空闲回收后不丢，
  浏览器重启自动清空；`pendingUrls` 用过期时间戳惰性判断，替代会随 SW 回收丢失的
  `setTimeout` 删除）；启动时轮询等到首个标签出现再收编（最多 5 秒），
  替代原先固定等待 1500ms。
- **图标取用**：`faviconSources()` 按 保存的真实图标 → Chrome 内置 `_favicon`
  （本地缓存，内网/离线可用，需 `favicon` 权限）→ Google s2 兜底 逐级回退，
  全部失败时显示占位块。
- **sidepanel**：按职责拆在 `panel/` 下（状态 / 渲染 / 行 / 菜单 / 预览 / 搜索 /
  动作 / 拖放 / DOM 小部件），模块间用 ESM live binding 共享 `state/tabs/active/ui`；
  监听 storage 与 tabs 变化做防抖刷新；编辑、拖拽、菜单等 `busy()` 状态下挂起刷新
  并标记 `dirty`，避免打断用户操作。
- **键控渲染（keyed diff）**：渲染不再整树重建。顶层 shell（搜索头 / 滚动区 / 状态 /
  已固定区 / 临时区 / 结果框）整块持久化，行级 `rowCache` 按「id → key」复用——
  key 覆盖构建时读取的全部输入（编辑/拖拽/菜单浮层坐标、折叠态、当前页匹配、
  剩余时间文本等），只有 key 变化的行才重建 DOM。收益：未变的行保留原元素与事件
  监听，焦点、滚动、IME 合成天然不丢，favicon 不随渲染重复请求；
  拖拽标记（`dragging`/`drop-*`）改由 `clearDragMarks()` 显式清理，
  搜索框聚焦时不回写 value（保护输入法）。注意：temp 对象没有 `type` 字段
  （靠存在于 `state.temps` 隐式表意），行路由按 `folder → pin → 其余即 temp` 判断。
- **lib/**：不依赖 Chrome API 的纯函数，是唯一可单测的层；UI 与 SW 只做编排。
  `normalizeLoaded` 会在加载时修剪损坏数据（未知节点、非法字段），保证渲染层永远拿到合法结构。
