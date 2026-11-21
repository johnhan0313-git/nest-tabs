import { app, boot, state, ui } from "./state.js";
import { hint, message, sectionAction, sectionTitle } from "./dom.js";
import { renderNodes, renderTemps } from "./rows.js";
import { flipFloating, renderMenu } from "./menu.js";
import { renderHits, renderSearch, paintResults } from "./search.js";
import { renderPeek } from "./peek.js";
import { bindSectionDrop } from "./dnd.js";
import { onImportTabGroups } from "./actions.js";

export function render() {
  if (ui.editingId && app.querySelector(".rename")) return;
  const typing = document.activeElement?.classList?.contains("find");
  const caret = typing ? document.activeElement.selectionStart : null;
  const peeking = document.activeElement?.classList?.contains("peek-find");
  const peekCaret = peeking ? document.activeElement.selectionStart : null;
  const scrollTop = app.querySelector(".scroller")?.scrollTop || 0;
  app.replaceChildren();
  if (ui.loading) {
    app.append(message("正在读取"));
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
    app.append(wrap);
    return;
  }

  const shell = document.createElement("div");
  shell.className = "shell";
  const scroller = document.createElement("div");
  scroller.className = "scroller";
  if (ui.error || ui.status) {
    const note = document.createElement("p");
    note.className = ui.error ? "status error" : "status";
    note.setAttribute("role", "status");
    note.textContent = ui.error || ui.status;
    scroller.append(note);
  }

  const saved = document.createElement("section");
  saved.className = "tree";
  saved.setAttribute("aria-label", "已固定");
  const savedHead = sectionTitle("已固定");
  savedHead.append(sectionAction("导入标签组", () => void onImportTabGroups()));
  saved.append(savedHead);
  if (state.roots.length) saved.append(renderNodes(state.roots, 0));
  else saved.append(hint(state.temps.length ? "把下面的网页拖到这里，或在空白处右键新建文件夹。" : "在空白处右键新建文件夹。"));
  bindSectionDrop(saved);
  scroller.append(saved, renderTemps());
  scroller.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".row, .menu, .confirm, select, input, button")) return;
    event.preventDefault();
    ui.menuId = "__blank__";
    ui.menuX = event.clientX;
    ui.menuY = event.clientY;
    ui.confirm = null;
    render();
  });
  shell.append(renderSearch(), scroller, renderHits());
  if (ui.menuId === "__blank__") shell.append(renderMenu(null, "blank"));
  app.append(shell);
  if (scrollTop) scroller.scrollTop = scrollTop;

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
