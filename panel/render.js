import { app, boot, state, ui } from "./state.js";
import { COPY } from "../lib/copy.js";
import { message, reconcile, settingsIcon } from "./dom.js";
import { beginRowRender, pruneRowCache, renderTempsArea, rowFor } from "./rows.js";
import { flipFloating, renderMenu } from "./menu.js";
import { renderHits, renderSearch, paintResults } from "./search.js";
import { renderPeek } from "./peek.js";
import { bindSectionDrop } from "./dnd.js";

// 顶层结构整块持久化（shell/scroller/status/已固定区），每次渲染只做
// 槽位对齐 + 变化行重建：未变的行保留原元素，焦点与滚动天然不丢。
let shell = null;
let scroller = null;
let status = null;
let saved = null;
let savedWrap = null;
let footer = null;

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
  savedWrap = document.createElement("div");
  bindSectionDrop(saved);
  reconcile(scroller, [status, saved]);

  footer = document.createElement("footer");
  footer.className = "shell-footer";
  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "footer-btn";
  settingsBtn.title = COPY.actions.settings;
  settingsBtn.setAttribute("aria-label", COPY.actions.settings);
  settingsBtn.append(settingsIcon());
  settingsBtn.addEventListener("click", () => {
    if (chrome.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  });
  footer.append(settingsBtn);

  shell.append(renderSearch(), scroller, renderHits(), footer);
}

export function render() {
  if (ui.editingId && app.querySelector(".rename")) return;
  const typing = document.activeElement?.classList?.contains("find");
  const caret = typing ? document.activeElement.selectionStart : null;
  const peeking = document.activeElement?.classList?.contains("peek-find");
  const peekCaret = peeking ? document.activeElement.selectionStart : null;
  if (ui.loading) {
    app.replaceChildren(message(COPY.app.loading));
    return;
  }
  if (ui.fatal) {
    const wrap = message(ui.fatal);
    const retry = document.createElement("button");
    retry.className = "text-btn";
    retry.type = "button";
    retry.textContent = COPY.app.retry;
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
  reconcile(saved, state.roots.length ? [savedWrap] : []);

  const scrollerItems = [status, saved, renderTempsArea()];
  reconcile(scroller, scrollerItems);

  const shellItems = [renderSearch(), scroller, renderHits(), footer];
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
