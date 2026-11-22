import { locate } from "./model.js";

/**
 * 拖放落点判定（纯几何 + 种类规则），返回 "into" | "before" | "after"；
 * null 表示该行不允许作为落点。
 * - temp 拖入：只允许落进文件夹/网页行，统一为 into
 * - 其余拖拽：按指针在行内的比例分 before/after（恰好 50% 算 before），
 *   文件夹中段（28% ~ 72%）为 into
 */
export function dropModeFor(ratio, targetKind, dragKind) {
  if (dragKind === "temp") {
    return targetKind === "folder" || targetKind === "pin" ? "into" : null;
  }
  if (targetKind === "temp") return null;
  if (targetKind === "folder" && ratio > 0.28 && ratio < 0.72) return "into";
  return ratio > 0.5 ? "after" : "before";
}

/** 拖到自己或自己的子孙上没有意义：folder 命中自身或其子孙返回 true */
export function isSelfDrop(roots, nodeId, targetId) {
  if (nodeId === targetId) return true;
  const loc = locate(roots, nodeId);
  if (!loc || loc.node.type !== "folder") return false;
  return Boolean(locate(loc.node.children, targetId));
}
