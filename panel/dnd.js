import { locate, moveNode } from "../lib/model.js";
import { fail, state, ui } from "./state.js";
import { render } from "./render.js";
import { pinAt, save } from "./actions.js";

export function onDragOver(event, row) {
  if (!ui.dragging || ui.dragging.id === row.dataset.id) return;
  const kind = row.dataset.kind;
  if (kind === "temp") return;
  const rect = row.getBoundingClientRect();
  const ratio = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
  let mode = "into";
  if (ui.dragging.kind !== "temp") {
    mode = ratio > 0.5 ? "after" : "before";
    if (kind === "folder" && ratio > 0.28 && ratio < 0.72) mode = "into";
    if (mode === "into" && isSelfDrop(ui.dragging.id, row.dataset.id)) return;
  } else if (kind !== "folder" && kind !== "pin") {
    return;
  }
  event.preventDefault();
  row.classList.remove("drop-into", "drop-before", "drop-after");
  row.classList.add(ui.dragging.kind === "temp" ? "drop-into" : `drop-${mode}`);
  row.dataset.dropMode = ui.dragging.kind === "temp" ? "into" : mode;
}

function isSelfDrop(nodeId, targetId) {
  if (nodeId === targetId) return true;
  const loc = locate(state.roots, nodeId);
  if (!loc || loc.node.type !== "folder") return false;
  return Boolean(locate(loc.node.children, targetId));
}

export async function onDrop(event, targetId) {
  event.preventDefault();
  const drag = ui.dragging;
  const mode = event.currentTarget?.dataset.dropMode || "into";
  ui.dragging = null;
  if (!drag || drag.id === targetId) {
    render();
    return;
  }
  if (drag.kind === "temp") {
    const target = locate(state.roots, targetId);
    if (!target) return;
    if (target.node.type === "folder") {
      await pinAt(drag.id, targetId, Number.MAX_SAFE_INTEGER, target.node.name);
      return;
    }
    const parent = target.parentId ? locate(state.roots, target.parentId)?.node : null;
    await pinAt(drag.id, target.parentId, target.index, parent?.name || "");
    return;
  }
  const ok = await save((draft) => {
    const target = locate(draft.roots, targetId);
    if (!target) return false;
    if (mode === "into") {
      if (target.node.type !== "folder") return false;
      return moveNode(draft.roots, drag.id, targetId, target.node.children.length) ? draft : false;
    }
    const index = target.index + (mode === "after" ? 1 : 0);
    return moveNode(draft.roots, drag.id, target.parentId, index) ? draft : false;
  });
  if (!ok && !ui.error) fail("不能放到这里。");
}

export function bindSectionDrop(section) {
  section.addEventListener("dragover", (event) => {
    if (ui.dragging?.kind !== "temp" || event.target.closest(".row")) return;
    event.preventDefault();
    section.classList.add("drop-into");
  });
  section.addEventListener("dragleave", (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    section.classList.remove("drop-into");
  });
  section.addEventListener("drop", (event) => {
    if (event.target.closest(".row")) return;
    event.preventDefault();
    const drag = ui.dragging;
    ui.dragging = null;
    section.classList.remove("drop-into");
    if (drag?.kind === "temp") void pinAt(drag.id, null, Number.MAX_SAFE_INTEGER, "");
  });
}
