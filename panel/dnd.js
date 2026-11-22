import { COPY } from "../lib/copy.js";
import { locate, moveNode } from "../lib/model.js";
import { dropModeFor, isSelfDrop } from "../lib/dnd.js";
import { fail, state, ui } from "./state.js";
import { render } from "./render.js";
import { pinAt, save } from "./actions.js";

/**
 * 拖拽期间的 dragging / drop-* 标记是命令式加到元素上的；
 * 行改为按键复用后不再靠整树重建清掉，拖拽结束时显式清理。
 */
export function clearDragMarks() {
  for (const el of document.querySelectorAll(".dragging, .drop-into, .drop-before, .drop-after")) {
    el.classList.remove("dragging", "drop-into", "drop-before", "drop-after");
  }
}

export function onDragOver(event, row) {
  if (!ui.dragging || ui.dragging.id === row.dataset.id) return;
  const rect = row.getBoundingClientRect();
  const ratio = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
  const mode = dropModeFor(ratio, row.dataset.kind, ui.dragging.kind);
  if (!mode) return;
  if (mode === "into" && isSelfDrop(state.roots, ui.dragging.id, row.dataset.id)) return;
  event.preventDefault();
  row.classList.remove("drop-into", "drop-before", "drop-after");
  row.classList.add(`drop-${mode}`);
  row.dataset.dropMode = mode;
}

export async function onDrop(event, targetId) {
  event.preventDefault();
  const drag = ui.dragging;
  const mode = event.currentTarget?.dataset.dropMode || "into";
  ui.dragging = null;
  clearDragMarks();
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
  if (!ok && !ui.error) fail(COPY.status.cannotDropHere);
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
    clearDragMarks();
    section.classList.remove("drop-into");
    if (drag?.kind === "temp") void pinAt(drag.id, null, Number.MAX_SAFE_INTEGER, "");
  });
}
