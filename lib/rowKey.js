import { formatRemaining, itemName, remainingMs, sameUrl } from "./model.js";

/**
 * 行的渲染路由。temp 对象没有 type 字段（靠存在于 state.temps 隐式表意），
 * 故 folder / pin 之外一律按 temp 处理——与历史行为一致，且可单测回归
 * （曾因按 `type === "temp"` 判断导致临时行被渲染成 pin）。
 */
export function rowKind(node) {
  if (node.type === "folder") return "folder";
  if (node.type === "pin") return "pin";
  return "temp";
}

/**
 * 行级键控渲染的 key：覆盖「构建这一行时读取过的全部输入」。
 * 只有 key 变化才重建 DOM——复用的前提是新旧对象在这些值上完全一致，
 * 闭包里捕获的旧对象与当前状态行为等价；写入类操作都按 id 落库，
 * 不依赖对象身份。
 *
 * ctx 由调用方从 UI 状态组装（纯函数入参，便于单测）：
 * - editingId / draggingId：编辑中 / 拖拽中的行
 * - overlay：菜单、确认框等跟随坐标的浮层（坐标变化也要重建该行）
 * - active：当前标签 { id, url }；tabs：存活标签（判定 pin 是否有活标签）
 * - tempTtlHours / now：临时行倒计时文本
 */
export function rowKey(node, depth, ctx) {
  const { editingId, draggingId, overlay = "", active, tabs, tempTtlHours, now } = ctx;
  const shared = `${node.id}:${depth}:${editingId === node.id ? 1 : 0}:${draggingId === node.id ? 1 : 0}${overlay}`;
  const kind = rowKind(node);
  if (kind === "folder") {
    return `f:${shared}:${node.collapsed ? 1 : 0}:${node.name}`;
  }
  if (kind === "pin") {
    const current = sameUrl(active.url, node.url) ? 1 : 0;
    const live = tabs.some((tab) => sameUrl(tab.url, node.url)) ? 1 : 0;
    return `p:${shared}:${current}:${live}:${itemName(node)}:${node.url}:${node.favIconUrl || ""}`;
  }
  const current = node.tabId === active.id ? 1 : 0;
  const remain = remainingMs(node.openedAt, now, tempTtlHours);
  const left = remain == null ? "" : formatRemaining(remain);
  // tabId 会因崩溃重绑定而变（url 不变），必须进 key
  return `t:${shared}:${current}:${node.tabId}:${itemName(node)}:${node.url}:${node.favIconUrl || ""}:${left}`;
}
