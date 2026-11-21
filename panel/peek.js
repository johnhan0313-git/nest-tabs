import { collectPins, formatAgo, itemName, locate } from "../lib/model.js";
import { app, state, ui } from "./state.js";
import { favicon, searchIcon } from "./dom.js";
import { openUrl } from "./actions.js";

export function bindFolderPeek(row, folder) {
  row.addEventListener("mouseenter", () => {
    if (folder.collapsed === false || ui.dragging || ui.editingId || ui.menuId || ui.confirm) return;
    clearTimeout(ui.peekHideTimer);
    clearTimeout(ui.peekTimer);
    ui.peekTimer = setTimeout(() => openPeek(folder.id), 2000);
  });
  row.addEventListener("mouseleave", (event) => {
    clearTimeout(ui.peekTimer);
    if (event.relatedTarget?.closest?.(".peek")) return;
    schedulePeekHide();
  });
}

function openPeek(id) {
  const located = locate(state?.roots || [], id);
  if (!located || located.node.type !== "folder" || !located.node.collapsed) return;
  if (ui.peekId !== id) ui.peekQuery = "";
  ui.peekId = id;
  renderPeek();
}

export function closePeek() {
  clearTimeout(ui.peekTimer);
  clearTimeout(ui.peekHideTimer);
  ui.peekId = null;
  ui.peekQuery = "";
  app.querySelector(".peek")?.remove();
}

function schedulePeekHide() {
  clearTimeout(ui.peekHideTimer);
  ui.peekHideTimer = setTimeout(closePeek, 160);
}

export function renderPeek() {
  app.querySelector(".peek")?.remove();
  if (!ui.peekId || !state) return;
  const located = locate(state.roots, ui.peekId);
  if (!located || located.node.type !== "folder" || !located.node.collapsed) {
    ui.peekId = null;
    return;
  }
  const folder = located.node;
  const card = document.createElement("div");
  card.className = "peek";
  card.addEventListener("mouseenter", () => clearTimeout(ui.peekHideTimer));
  card.addEventListener("mouseleave", (event) => {
    if (event.relatedTarget?.closest?.(`.row[data-id="${folder.id}"]`)) return;
    schedulePeekHide();
  });

  const wrap = document.createElement("label");
  wrap.className = "peek-find-wrap";
  wrap.append(searchIcon());
  const input = document.createElement("input");
  input.className = "peek-find";
  input.type = "text";
  input.placeholder = `搜索${folder.name}`;
  input.setAttribute("aria-label", `搜索${folder.name}`);
  input.value = ui.peekQuery;
  input.spellcheck = false;
  input.addEventListener("input", () => {
    ui.peekQuery = input.value;
    paintPeekList(card, folder);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closePeek();
  });
  wrap.append(input);

  const list = document.createElement("div");
  list.className = "peek-list";
  card.append(wrap, list);
  (app.querySelector(".shell") || app).append(card);
  paintPeekList(card, folder);
  const row = app.querySelector(`.row[data-id="${CSS.escape(folder.id)}"]`);
  if (row) placePeek(card, row);
  void loadPeekTimes(folder);
}

function placePeek(card, row) {
  const rect = row.getBoundingClientRect();
  const width = Math.min(176, Math.max(140, window.innerWidth - 168));
  card.style.width = `${width}px`;
  card.style.left = `${Math.max(8, window.innerWidth - width - 8)}px`;
  const height = card.offsetHeight;
  const top = Math.min(rect.top, Math.max(8, window.innerHeight - height - 8));
  card.style.top = `${Math.max(8, top)}px`;
}

function paintPeekList(card, folder) {
  const list = card.querySelector(".peek-list");
  if (!list) return;
  list.replaceChildren();
  const query = ui.peekQuery.trim().toLowerCase();
  const pages = collectPins(folder.children).filter((pin) => {
    if (!query) return true;
    return `${itemName(pin)} ${pin.url}`.toLowerCase().includes(query);
  });
  if (!pages.length) {
    const empty = document.createElement("p");
    empty.className = "hits-empty";
    empty.textContent = collectPins(folder.children).length ? "没有匹配的网页" : "里面还没有网页";
    list.append(empty);
    return;
  }
  for (const pin of pages) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hit";
    button.title = itemName(pin);
    button.append(favicon(pin.url, pin.favIconUrl));
    const copy = document.createElement("span");
    copy.className = "copy";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = itemName(pin);
    copy.append(name);
    const when = ui.peekTimes[pin.url];
    if (when) {
      const ago = document.createElement("span");
      ago.className = "ago";
      ago.textContent = formatAgo(Date.now() - when);
      copy.append(ago);
    }
    button.append(copy);
    button.addEventListener("click", () => {
      closePeek();
      void openUrl(pin.url);
    });
    list.append(button);
  }
}

async function loadPeekTimes(folder) {
  if (!chrome.history?.getVisits) return;
  const token = ++ui.peekToken;
  const pins = collectPins(folder.children).filter((pin) => pin.url && ui.peekTimes[pin.url] == null);
  await Promise.all(pins.map(async (pin) => {
    try {
      const visits = await chrome.history.getVisits({ url: pin.url });
      const latest = (visits || []).reduce((max, visit) => Math.max(max, visit.visitTime || 0), 0);
      ui.peekTimes[pin.url] = latest;
    } catch {
      ui.peekTimes[pin.url] = 0;
    }
  }));
  if (token !== ui.peekToken || ui.peekId !== folder.id) return;
  const card = app.querySelector(".peek");
  const located = locate(state.roots, folder.id);
  if (card && located?.node?.type === "folder") {
    paintPeekList(card, located.node);
    const row = app.querySelector(`.row[data-id="${CSS.escape(folder.id)}"]`);
    if (row) placePeek(card, row);
  }
}
