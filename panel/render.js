import { app, boot, state, ui } from "./state.js";
import { hint, importIcon, message, reconcile, sectionIconAction, sectionTitle } from "./dom.js";
import { beginRowRender, pruneRowCache, renderTemps, rowFor } from "./rows.js";
import { flipFloating, renderMenu } from "./menu.js";
import { renderHits, renderSearch, paintResults } from "./search.js";
import { renderPeek } from "./peek.js";
import { bindSectionDrop } from "./dnd.js";
import { onImportTabGroups } from "./actions.js";

// 顶层结构整块持久化（shell/scroller/status/已固定区），每次渲染只做
// 槽位对齐 + 变化行重建：未变的行保留原元素，焦点与滚动天然不丢。
let shell = null;
let scroller = null;
let status = null;
let saved = null;
let savedHead = null;
let savedWrap = null;
let savedHint = null;

function ensureShell() {
  if (shell) return;
  shell = document.createElement("div");
  shell.className = "shell";
  scroller = document.createElement("div");
  scroller.className = "scroller";
  scroller.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".row, .menu, .confirm, select, input, button")) return;
    event.preventDefault();
    ui.menuId = "__blank__";
    ui.menuX = event.clientX;
    ui.menuY = event.clientY;
    ui.confirm = null;
    render();
  });
  status = document.createElement("p");
  status.setAttribute("role", "status");
  status.hidden = true;
  saved = document.createElement("section");
  saved.className = "tree";
  saved.setAttribute("aria-label", "已固定");
  savedHead = sectionTitle("已固定");
  savedHead.append(sectionIconAction(importIcon(), "导入标签组", () => void onImportTabGroups()));
  savedWrap = document.createElement("div");
  savedHint = hint("");
  bindSectionDrop(saved);
  reconcile(scroller, [status, saved]);
  shell.append(renderSearch(), scroller, renderHits());
}

export function render() {
  if (ui.editingId && app.querySelector(".rename")) return;
  const typing = document.activeElement?.classList?.contains("find");
  const caret = typing ? document.activeElement.selectionStart : null;
  const peeking = document.activeElement?.classList?.contains("peek-find");
  const peekCaret = peeking ? document.activeElement.selectionStart : null;
  if (ui.loading) {
    app.replaceChildren(message("正在读取"));
    return;
  }
  if (ui.fatal) {
    const wrap = message(ui.fatal);
    const retry = document.createElement("button");
    retry.className = "text-btn";
    retry.type = "button";
    retry.textContent = "重试";
    retry.addEventListener("click", () => void boot());
    wrap.append(retry);
    app.replaceChildren(wrap);
    return;
  }
  ensureShell();

  const text = ui.error || ui.status;
  status.hidden = !text;
  if (text) {
    status.textContent = text;
    status.className = ui.error ? "status error" : "status";
  }

  beginRowRender();
  reconcile(savedWrap, state.roots.map((node) => rowFor(node, 0)));
  if (state.roots.length) {
    reconcile(saved, [savedHead, savedWrap]);
  } else {
    savedHint.textContent = state.temps.length
      ? "拖入网页，或右键新建文件夹。"
      : "右键新建文件夹。";
    reconcile(saved, [savedHead, savedHint]);
  }

  reconcile(scroller, [status, saved, renderTemps()]);

  const shellItems = [renderSearch(), scroller, renderHits()];
  if (ui.menuId === "__blank__") shellItems.push(renderMenu(null, "blank"));
  reconcile(shell, shellItems);
  if (app.childElementCount !== 1 || app.firstElementChild !== shell) app.replaceChildren(shell);
  pruneRowCache();

  const input = app.querySelector(".rename");
  if (input) {
    input.focus();
    input.select();
  } else if (typing) {
    const find = app.querySelector(".find");
    find.focus();
    if (caret != null) find.setSelectionRange(caret, caret);
  }
  paintResults();
  renderPeek();
  if (peeking) {
    const peekInput = app.querySelector(".peek-find");
    peekInput?.focus();
    if (peekCaret != null && peekInput) peekInput.setSelectionRange(peekCaret, peekCaret);
  }
  requestAnimationFrame(flipFloating);
}
