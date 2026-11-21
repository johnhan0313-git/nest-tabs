import {
  TTL_OPTIONS,
  adoptOpenTabs,
  collectPins,
  collectTabGroups,
  createFolder,
  deleteFolder,
  describeTabGroupImport,
  importTabGroups,
  faviconFor,
  formatAgo,
  formatRemaining,
  hostOf,
  itemName,
  locate,
  normalizeUrl,
  moveNode,
  pinTemp,
  remainingMs,
  removePin,
  renameItem,
  sortedTemps,
  toNavigableUrl,
} from "./lib/model.js";
import { loadState, updateState } from "./lib/store.js";

const app = document.querySelector("#app");

const ui = {
  loading: true,
  fatal: "",
  error: "",
  status: "",
  statusTimer: 0,
  menuId: null,
  menuX: 0,
  menuY: 0,
  editingId: null,
  confirm: null,
  dirty: false,
  dragging: null,
  query: "",
  results: [],
  searchIndex: 0,
  searchToken: 0,
  peekId: null,
  peekQuery: "",
  peekTimes: {},
  peekToken: 0,
  peekTimer: 0,
  peekHideTimer: 0,
  foldingUntil: 0,
  importing: false,
};

let state = null;
let tabs = [];
let active = { id: null, url: "" };
let refreshTimer = 0;
let openTimer = 0;

document.addEventListener("pointerdown", (event) => {
  const input = app.querySelector(".rename");
  if (!input || !ui.editingId || event.target === input) return;
  void finishRename(ui.editingId, input.value, input.dataset.original || "");
}, true);

document.addEventListener("click", (event) => {
  if (event.target.closest(".menu, .confirm")) return;
  if (!ui.menuId && !ui.confirm) return;
  ui.menuId = null;
  ui.confirm = null;
  if (ui.editingId && app.querySelector(".rename")) {
    app.querySelectorAll(".menu, .confirm").forEach((node) => node.remove());
    return;
  }
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (ui.peekId && !ui.menuId && !ui.confirm && !ui.editingId) {
    closePeek();
    return;
  }
  if (!ui.menuId && !ui.confirm && !ui.editingId) return;
  ui.menuId = null;
  ui.confirm = null;
  ui.editingId = null;
  render();
});

chrome.storage.onChanged.addListener(() => scheduleRefresh());
chrome.tabs.onActivated.addListener(() => scheduleRefresh());
chrome.tabs.onUpdated.addListener(() => scheduleRefresh());
chrome.tabs.onRemoved.addListener(() => scheduleRefresh());
chrome.tabs.onCreated.addListener(() => scheduleRefresh());

await boot();
setInterval(() => {
  if (busy() || Date.now() < ui.foldingUntil) return;
  render();
}, 30000);

function busy() {
  const typing = document.activeElement?.classList?.contains("find") || document.activeElement?.classList?.contains("peek-find");
  return Boolean(ui.editingId || ui.confirm || ui.menuId || ui.dragging || typing);
}

function scheduleRefresh() {
  if (busy() || Date.now() < ui.foldingUntil) {
    ui.dirty = true;
    return;
  }
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refresh(), 80);
}

async function boot() {
  try {
    await refresh();
  } catch (error) {
    ui.loading = false;
    ui.fatal = "读不到已保存的标签。";
    console.error(error);
    render();
  }
}

async function refresh() {
  const [next, open, currentWindow] = await Promise.all([
    loadState(),
    chrome.tabs.query({}),
    chrome.windows.getCurrent(),
  ]);
  state = next;
  tabs = open;
  const current = open.find((tab) => tab.active && tab.windowId === currentWindow.id);
  active = { id: current?.id ?? null, url: current?.url || "" };
  ui.loading = false;
  ui.fatal = "";
  ui.dirty = false;
  render();
}

function flash(text) {
  ui.status = text;
  ui.error = "";
  clearTimeout(ui.statusTimer);
  ui.statusTimer = setTimeout(() => {
    ui.status = "";
    if (!busy()) render();
  }, 2200);
  render();
}

function fail(text) {
  ui.error = text;
  ui.status = "";
  render();
}

async function commit(mutator) {
  const result = await updateState(mutator);
  state = result.state;
  ui.dirty = false;
  return result.ok;
}

function render() {
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

function message(text) {
  const p = document.createElement("p");
  p.className = "center";
  p.textContent = text;
  return p;
}

function renderSearch() {
  const header = document.createElement("header");
  header.className = "top";
  const wrap = document.createElement("label");
  wrap.className = "find-wrap";
  wrap.append(searchIcon());
  const input = document.createElement("input");
  input.className = "find";
  input.type = "text";
  input.placeholder = "搜索或输入网址";
  input.setAttribute("aria-label", "搜索或输入网址");
  input.setAttribute("aria-controls", "hits");
  input.setAttribute("aria-autocomplete", "list");
  input.value = ui.query;
  input.spellcheck = false;
  let composing = false;
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    onQuery(input.value);
  });
  input.addEventListener("input", () => {
    if (!composing) onQuery(input.value);
  });
  input.addEventListener("keydown", (event) => onSearchKey(event));
  input.addEventListener("focus", () => paintResults());
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (document.activeElement?.classList?.contains("find")) return;
      paintResults();
      if (ui.dirty) void refresh();
    }, 120);
  });
  wrap.append(input);
  header.append(wrap);
  return header;
}

function renderNewTab() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "newtab";
  const plus = document.createElement("span");
  plus.className = "plus";
  plus.textContent = "+";
  const label = document.createElement("span");
  label.textContent = "新标签页";
  button.append(plus, label);
  button.addEventListener("click", () => void onNewTab());
  return button;
}

function renderHits() {
  const box = document.createElement("div");
  box.className = "hits";
  box.id = "hits";
  box.hidden = true;
  box.setAttribute("role", "listbox");
  box.setAttribute("aria-label", "搜索结果");
  return box;
}


function sectionTitle(text) {
  const head = document.createElement("div");
  head.className = "section-head";
  const title = document.createElement("h2");
  title.textContent = text;
  head.append(title);
  return head;
}

function sectionAction(text, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "section-action";
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

async function onImportTabGroups() {
  if (ui.importing) return;
  ui.importing = true;
  try {
    const [groups, openTabs] = await Promise.all([
      chrome.tabGroups.query({}),
      chrome.tabs.query({}),
    ]);
    const collected = collectTabGroups(groups, openTabs);
    if (!collected.length) {
      flash("没有可导入的标签组");
      return;
    }
    let result = null;
    const ok = await save((draft) => {
      result = importTabGroups(draft, collected);
      return result.changed ? draft : false;
    });
    if (result && (ok || !result.changed)) {
      flash(describeTabGroupImport(result));
      if (result.focusId) {
        app.querySelector(`.row[data-id="${CSS.escape(result.focusId)}"]`)?.scrollIntoView({ block: "nearest" });
      }
    }
  } catch (error) {
    console.error(error);
    fail("读不到标签组。再点一次。");
  } finally {
    ui.importing = false;
  }
}

function renderTemps() {
  const section = document.createElement("section");
  section.className = "temps";
  section.setAttribute("aria-label", "临时");
  const head = document.createElement("div");
  head.className = "section-head";
  const title = document.createElement("h2");
  title.textContent = "临时";
  head.append(title, renderTtl());
  section.append(head);

  const temps = sortedTemps(state.temps);
  if (!temps.length) section.append(hint("新打开的网页会先出现在这里。"));
  for (const temp of temps) section.append(renderTemp(temp));
  section.append(renderNewTab());
  return section;
}

function hint(text) {
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = text;
  return p;
}

function renderTtl() {
  const select = document.createElement("select");
  select.className = "ttl";
  select.setAttribute("aria-label", "临时标签关闭时间");
  for (const option of TTL_OPTIONS) {
    const node = document.createElement("option");
    node.value = String(option.hours);
    node.textContent = option.label;
    node.selected = option.hours === state.settings.tempTtlHours;
    select.append(node);
  }
  select.addEventListener("change", () => {
    const hours = Number(select.value);
    const label = TTL_OPTIONS.find((item) => item.hours === hours)?.label || "24 小时后关闭";
    void save((draft) => {
      draft.settings.tempTtlHours = hours;
      return draft;
    }, hours ? `已改为${label}` : "临时标签不再自动关闭");
  });
  return select;
}

function renderNodes(nodes, depth) {
  const wrap = document.createElement("div");
  for (const node of nodes) {
    wrap.append(node.type === "folder" ? renderFolder(node, depth) : renderPin(node, depth));
  }
  return wrap;
}

function renderFolder(folder, depth) {
  const block = document.createElement("div");
  const row = rowShell(folder, "folder", depth);
  if (ui.editingId === folder.id) {
    row.append(renameInput(folder, folder.name));
    appendOverlays(row, folder.id, "folder");
    block.append(row);
    return block;
  }
  const main = mainButton(folder, "folder");
  main.setAttribute("aria-expanded", folder.collapsed ? "false" : "true");
  main.append(folderIcon(!folder.collapsed), nameBlock(folder.name));
  const fold = document.createElement("div");
  fold.className = folder.collapsed ? "fold closed" : "fold";
  const clip = document.createElement("div");
  clip.className = "fold-clip";
  if (folder.collapsed) clip.inert = true;
  if (folder.children.length) clip.append(renderNodes(folder.children, depth + 1));
  fold.append(clip);
  bindActivate(main, folder, () => {
    closePeek();
    const closing = !folder.collapsed;
    folder.collapsed = closing;
    main.setAttribute("aria-expanded", closing ? "false" : "true");
    const icon = main.querySelector(".folder");
    if (icon) icon.replaceWith(folderIcon(!closing));
    if (!closing) clip.inert = false;
    slideFold(fold, clip, closing);
    void save((draft) => {
      const located = locate(draft.roots, folder.id);
      if (!located || located.node.type !== "folder") return false;
      located.node.collapsed = closing;
      return draft;
    }, undefined, { paint: false }).then((ok) => {
      if (ok) return;
      folder.collapsed = !closing;
      main.setAttribute("aria-expanded", closing ? "true" : "false");
      const nextIcon = main.querySelector(".folder");
      if (nextIcon) nextIcon.replaceWith(folderIcon(closing));
      slideFold(fold, clip, !closing);
    });
  }, false);
  row.append(main);
  bindFolderPeek(row, folder);
  appendOverlays(row, folder.id, "folder");
  block.append(row, fold);
  return block;
}

function renderPin(pin, depth) {
  const row = rowShell(pin, "pin", depth);
  const current = sameUrl(active.url, pin.url);
  if (current) row.classList.add("is-active");
  if (ui.editingId === pin.id) {
    row.append(renameInput(pin, itemName(pin)));
  } else {
    const main = mainButton(pin, "pin");
    main.append(favicon(pin.url, pin.favIconUrl), nameBlock(itemName(pin)));
    bindActivate(main, pin, () => void openUrl(pin.url));
    const live = tabs.some((tab) => sameUrl(tab.url, pin.url));
    row.append(main, hoverAction(
      live ? "关闭并保持固定" : "移除",
      live ? "minus" : "x",
      (event) => {
        if (live) {
          void closePinnedTabs(pin);
          return;
        }
        ui.menuId = null;
        ui.menuX = event.clientX;
        ui.menuY = event.clientY;
        ui.confirm = { id: pin.id, action: "remove-pin" };
        render();
      },
    ));
  }
  appendOverlays(row, pin.id, "pin");
  return row;
}

function renderTemp(temp) {
  const row = rowShell(temp, "temp", 0);
  const current = temp.tabId === active.id;
  if (current) row.classList.add("is-active");
  if (ui.editingId === temp.id) {
    row.append(renameInput(temp, itemName(temp)));
  } else {
    const main = mainButton(temp, "temp");
    main.append(favicon(temp.url, temp.favIconUrl), nameBlock(itemName(temp)));
    const remain = remainingMs(temp.openedAt, Date.now(), state.settings.tempTtlHours);
    if (remain != null) {
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = formatRemaining(remain);
      main.append(meta);
    }
    bindActivate(main, temp, () => void focusTab(temp.tabId, temp.url));
    row.append(main, hoverAction("关闭", "x", () => void onCloseTemp(temp.id)));
  }
  appendOverlays(row, temp.id, "temp");
  return row;
}

const foldMotions = new WeakMap();
let foldingCount = 0;

function slideFold(fold, clip, closing) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fromHeight = fold.getBoundingClientRect().height;
  const fromOpacity = Number.parseFloat(getComputedStyle(fold).opacity);
  const previous = foldMotions.get(fold);
  if (previous && !previous.settled) {
    previous.settled = true;
    clearTimeout(previous.timer);
    if (previous.animation) {
      previous.animation.onfinish = null;
      previous.animation.cancel();
    }
    if (previous.counted) foldingCount = Math.max(0, foldingCount - 1);
  }

  const motion = { settled: false, animation: null, timer: 0, counted: false };
  foldMotions.set(fold, motion);
  const finish = () => {
    if (motion.settled || foldMotions.get(fold) !== motion) return;
    motion.settled = true;
    clearTimeout(motion.timer);
    if (motion.animation) {
      motion.animation.onfinish = null;
      motion.animation.cancel();
    }
    fold.style.transition = "";
    fold.style.height = "";
    fold.style.opacity = "";
    fold.style.overflow = "";
    fold.classList.toggle("closed", closing);
    clip.inert = closing;
    if (motion.counted) foldingCount = Math.max(0, foldingCount - 1);
    if (foldingCount === 0) {
      ui.foldingUntil = 0;
      if (ui.dirty && !busy()) void refresh();
    }
  };
  fold.classList.remove("closed");
  const full = clip.scrollHeight;
  if (reduce || !full) {
    finish();
    return;
  }
  motion.counted = true;
  foldingCount += 1;
  ui.foldingUntil = Date.now() + 280;
  if (!closing) clip.inert = false;
  fold.style.overflow = "hidden";
  const animation = fold.animate(
    [
      { height: `${fromHeight}px`, opacity: Number.isFinite(fromOpacity) ? fromOpacity : 1 },
      { height: `${closing ? 0 : full}px`, opacity: closing ? 0 : 1 },
    ],
    { duration: 200, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
  );
  motion.animation = animation;
  animation.onfinish = finish;
  motion.timer = window.setTimeout(finish, 260);
}

function bindFolderPeek(row, folder) {
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

function closePeek() {
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

function renderPeek() {
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

function hoverAction(label, glyph, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-x";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(glyph === "minus" ? markIcon("M4 8h8") : markIcon("M4.5 4.5l7 7M11.5 4.5l-7 7"));
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(event);
  });
  return button;
}

function markIcon(d) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  svg.append(path);
  return svg;
}

async function closePinnedTabs(pin) {
  const ids = tabs.filter((tab) => sameUrl(tab.url, pin.url)).map((tab) => tab.id);
  if (!ids.length) {
    render();
    return;
  }
  try {
    await chrome.tabs.remove(ids);
  } catch (error) {
    console.error(error);
    fail("这个标签已经关掉了。");
    return;
  }
  tabs = tabs.filter((tab) => !ids.includes(tab.id));
  if (ids.includes(active.id)) active = { id: null, url: "" };
  render();
}

function rowShell(item, kind, depth) {
  const row = document.createElement("div");
  row.className = "row";
  row.dataset.id = item.id;
  row.dataset.kind = kind;
  row.style.paddingLeft = `${depth * 18}px`;
  if (ui.dragging?.id === item.id) row.classList.add("dragging");
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    closePeek();
    ui.menuId = item.id;
    ui.menuX = event.clientX;
    ui.menuY = event.clientY;
    ui.confirm = null;
    render();
  });
  row.addEventListener("dragover", (event) => onDragOver(event, row));
  row.addEventListener("dragleave", () => {
    row.classList.remove("drop-into", "drop-before", "drop-after");
  });
  row.addEventListener("drop", (event) => {
    event.stopPropagation();
    void onDrop(event, item.id);
  });
  return row;
}

function bindActivate(main, item, action, rename = true) {
  main.addEventListener("click", (event) => {
    if (!rename) {
      action();
      return;
    }
    if (event.detail > 1) return;
    clearTimeout(openTimer);
    openTimer = setTimeout(action, 220);
  });
  if (!rename) return;
  main.addEventListener("dblclick", (event) => {
    event.preventDefault();
    clearTimeout(openTimer);
    ui.menuId = null;
    ui.confirm = null;
    ui.editingId = item.id;
    render();
  });
}

function bindSectionDrop(section) {
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

function mainButton(item, kind) {
  const main = document.createElement("button");
  main.type = "button";
  main.className = "main";
  main.draggable = true;
  main.addEventListener("dragstart", (event) => {
    clearTimeout(openTimer);
    closePeek();
    ui.dragging = { kind, id: item.id };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    main.closest(".row")?.classList.add("dragging");
  });
  main.addEventListener("dragend", () => {
    ui.dragging = null;
    if (ui.dirty) void refresh();
    else render();
  });
  return main;
}

function nameBlock(name) {
  const copy = document.createElement("span");
  copy.className = "copy";
  const strong = document.createElement("span");
  strong.className = "name";
  strong.textContent = name;
  copy.append(strong);
  return copy;
}

function renameInput(item, name) {
  const input = document.createElement("input");
  input.className = "rename";
  input.value = name;
  input.dataset.original = name;
  input.setAttribute("aria-label", "名称");
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      ui.editingId = null;
      render();
    }
  });
  input.addEventListener("blur", () => void finishRename(item.id, input.value, name));
  return input;
}

async function finishRename(id, value, previous) {
  if (ui.editingId !== id) return;
  ui.editingId = null;
  if (value.trim() === previous.trim()) {
    if (ui.dirty) await refresh();
    else render();
    return;
  }
  try {
    const ok = await commit((draft) => (renameItem(draft, id, value) ? draft : false));
    if (!ok && value.trim()) fail("没保存上。再点一次。");
    else render();
  } catch (error) {
    console.error(error);
    fail("没保存上。再点一次。");
  }
  if (ui.dirty) await refresh();
}

function folderIcon(open) {
  const span = document.createElement("span");
  span.className = open ? "folder open" : "folder";
  if (open) {
    span.append(svgPaths([
      "M1.8 3.1h4.1l1.15 1.25H13.2c.55 0 1 .42 1 .95V6.3H1.8V3.1z",
      "M1.15 6.7h13.7l-1.45 6.2a1 1 0 0 1-.98.8H3.55a1 1 0 0 1-.98-.8L1.15 6.7z",
    ]));
  } else {
    span.append(svgPath("M2.05 4.35c0-.8.62-1.45 1.4-1.45h2.55l1.15 1.25h5.45c.78 0 1.4.65 1.4 1.45v6.15c0 .8-.62 1.45-1.4 1.45H3.45c-.78 0-1.4-.65-1.4-1.45V4.35z"));
  }
  return span;
}

function searchIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "7");
  circle.setAttribute("cy", "7");
  circle.setAttribute("r", "4.25");
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "currentColor");
  circle.setAttribute("stroke-width", "1.6");
  const handle = document.createElementNS("http://www.w3.org/2000/svg", "path");
  handle.setAttribute("d", "M10.2 10.2 13 13");
  handle.setAttribute("fill", "none");
  handle.setAttribute("stroke", "currentColor");
  handle.setAttribute("stroke-width", "1.6");
  handle.setAttribute("stroke-linecap", "round");
  svg.append(circle, handle);
  return svg;
}

function svgPaths(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "currentColor");
    svg.append(path);
  }
  return svg;
}

function svgPath(d, filled = true) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  if (filled) path.setAttribute("fill", "currentColor");
  else {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  }
  svg.append(path);
  return svg;
}

function favicon(url, favIconUrl) {
  const src = faviconFor(url, favIconUrl);
  if (!src) {
    const span = document.createElement("span");
    span.className = "favicon missing";
    return span;
  }
  const img = document.createElement("img");
  img.className = "favicon";
  img.alt = "";
  img.src = src;
  img.addEventListener("error", () => {
    const span = document.createElement("span");
    span.className = "favicon missing";
    img.replaceWith(span);
  });
  return img;
}

function appendOverlays(row, id, kind) {
  if (ui.menuId === id) row.append(renderMenu(id, kind));
  if (ui.confirm?.id === id) row.append(renderConfirm());
}

function renderMenu(id, kind) {
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.style.left = `${ui.menuX}px`;
  menu.style.top = `${ui.menuY}px`;
  if (kind === "blank") {
    menu.append(menuItem("新建文件夹", () => {
      ui.menuId = null;
      void onCreateFolder(null);
    }));
  }
  if (kind === "folder") {
    menu.append(menuItem("新建子文件夹", () => {
      ui.menuId = null;
      void onCreateFolder(id);
    }));
    menu.append(menuItem("重命名", () => {
      ui.menuId = null;
      ui.editingId = id;
      render();
    }));
    menu.append(menuDivider());
    menu.append(menuItem("删除", () => {
      ui.menuId = null;
      ui.confirm = { id, action: "delete-folder" };
      render();
    }, true));
  }
  if (kind === "pin" || kind === "temp") appendPageMenu(menu, id, kind);
  return menu;
}

function appendPageMenu(menu, id, kind) {
  menu.append(menuItem("复制链接", () => void onCopyLink(id, kind)));
  menu.append(menuItem("重命名", () => {
    ui.menuId = null;
    ui.editingId = id;
    render();
  }));
  menu.append(menuItem("复制标签页", () => void onDuplicate(id, kind)));
  menu.append(menuDivider());
  if (kind === "pin") {
    menu.append(menuItem("移除", () => {
      ui.menuId = null;
      ui.confirm = { id, action: "remove-pin" };
      render();
    }, true));
    return;
  }
  menu.append(menuItem("关闭", () => void onCloseTemp(id), true));
}

function pageOf(id, kind) {
  if (kind === "pin") {
    const located = locate(state.roots, id);
    return located?.node?.type === "pin" ? located.node : null;
  }
  return state.temps.find((item) => item.id === id) || null;
}

async function onCopyLink(id, kind) {
  const page = pageOf(id, kind);
  ui.menuId = null;
  if (!page?.url) {
    fail("这个页面还没有网址。");
    return;
  }
  try {
    await writeClipboard(page.url);
    flash("已复制链接");
  } catch (error) {
    console.error(error);
    fail("没复制上。再点一次。");
  }
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("copy failed");
  }
}

async function onDuplicate(id, kind) {
  const page = pageOf(id, kind);
  ui.menuId = null;
  render();
  if (!page?.url) {
    fail("这个页面还没有网址。");
    return;
  }
  const open = Number.isInteger(page.tabId)
    ? tabs.find((tab) => tab.id === page.tabId)
    : tabs.find((tab) => sameUrl(tab.url, page.url));
  try {
    if (open && chrome.tabs.duplicate) await chrome.tabs.duplicate(open.id);
    else await chrome.tabs.create({ url: page.url, active: true });
  } catch (error) {
    console.error(error);
    fail("没复制出新标签。");
  }
}

function menuDivider() {
  const gap = document.createElement("div");
  gap.className = "menu-gap";
  gap.setAttribute("role", "separator");
  return gap;
}

function menuItem(label, onClick, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (danger) button.className = "danger";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function renderConfirm() {
  const box = document.createElement("div");
  box.className = "confirm";
  box.style.left = `${ui.menuX}px`;
  box.style.top = `${ui.menuY}px`;
  const text = document.createElement("p");
  const folder = ui.confirm.action === "delete-folder" ? locate(state.roots, ui.confirm.id)?.node : null;
  text.textContent = folder
    ? (folder.children.length ? "里面的内容会移到上一级。" : "删除这个空文件夹？")
    : "移除后不再记住这个网址。";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "danger";
  yes.textContent = folder ? "删除" : "移除";
  yes.addEventListener("click", (event) => {
    event.stopPropagation();
    const action = ui.confirm;
    ui.confirm = null;
    if (action.action === "delete-folder") void onDeleteFolder(action.id);
    else void onRemovePin(action.id);
  });
  const no = document.createElement("button");
  no.type = "button";
  no.textContent = "取消";
  no.addEventListener("click", (event) => {
    event.stopPropagation();
    ui.confirm = null;
    render();
  });
  box.append(text, yes, no);
  return box;
}

function flipFloating() {
  const el = app.querySelector(".menu, .confirm");
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) el.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
  if (rect.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
}

async function save(mutator, success, options = {}) {
  try {
    const ok = await commit(mutator);
    if (!ok) {
      render();
      return false;
    }
    if (success) flash(success);
    else if (options.paint !== false) render();
    return true;
  } catch (error) {
    console.error(error);
    fail("没保存上。再点一次。");
    return false;
  }
}

async function onCreateFolder(parentId) {
  let createdId = "";
  const ok = await save((draft) => {
    const folder = createFolder("文件夹");
    createdId = folder.id;
    if (!parentId) {
      draft.roots.push(folder);
      return draft;
    }
    const parent = locate(draft.roots, parentId);
    if (!parent || parent.node.type !== "folder") return false;
    parent.node.collapsed = false;
    parent.node.children.push(folder);
    return draft;
  });
  if (!ok) return;
  ui.menuId = null;
  ui.editingId = createdId;
  render();
}

async function pinAt(tempId, parentId, index, folderName) {
  const temp = state.temps.find((item) => item.id === tempId);
  if (!temp?.url) {
    fail("这个页面还没有网址，先等它打开。");
    return false;
  }
  return save((draft) => {
    if (parentId) {
      const parent = locate(draft.roots, parentId);
      if (parent?.node?.type === "folder") parent.node.collapsed = false;
    }
    const pin = pinTemp(draft, tempId, parentId, index);
    return pin ? draft : false;
  }, folderName ? `已固定到「${folderName}」` : "已固定");
}

async function onCloseTemp(id) {
  const temp = state.temps.find((item) => item.id === id);
  ui.menuId = null;
  if (!temp) return;
  const ok = await save((draft) => {
    draft.temps = draft.temps.filter((item) => item.id !== id);
    return draft;
  }, "已关闭");
  if (ok && Number.isInteger(temp.tabId)) await chrome.tabs.remove(temp.tabId).catch(() => {});
}

async function onRemovePin(id) {
  await save((draft) => {
    const removed = removePin(draft.roots, id);
    if (!removed) return false;
    adoptOpenTabs(draft, removed.url, tabs, Date.now());
    return draft;
  }, "已移除");
}

async function onDeleteFolder(id) {
  await save((draft) => (deleteFolder(draft.roots, id) ? draft : false), "已删除");
}

async function openUrl(url) {
  try {
    if (chrome.runtime?.id) {
      const response = await chrome.runtime.sendMessage({ type: "focus-or-open", url });
      if (!response?.ok) throw new Error(response?.error || "打不开");
      return;
    }
    const match = tabs.find((tab) => sameUrl(tab.url, url));
    if (match) {
      await chrome.tabs.update(match.id, { active: true });
      await chrome.windows.update(match.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url, active: true });
    }
  } catch (error) {
    console.error(error);
    fail("打不开这个网址。");
  }
}

async function focusTab(tabId, url) {
  const match = tabs.find((tab) => tab.id === tabId);
  if (!match) {
    await openUrl(url);
    return;
  }
  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(match.windowId, { focused: true });
  } catch (error) {
    console.error(error);
    fail("这个标签已经关掉了。");
    await refresh();
  }
}

function onDragOver(event, row) {
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

async function onDrop(event, targetId) {
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

function onQuery(value) {
  ui.query = value;
  ui.searchIndex = 0;
  void runSearch();
}

function onSearchKey(event) {
  if (event.key === "ArrowDown" && ui.results.length) {
    event.preventDefault();
    ui.searchIndex = Math.min(ui.results.length - 1, ui.searchIndex + 1);
    paintResults();
  } else if (event.key === "ArrowUp" && ui.results.length) {
    event.preventDefault();
    ui.searchIndex = Math.max(0, ui.searchIndex - 1);
    paintResults();
  } else if (event.key === "Enter") {
    event.preventDefault();
    void activateResult(ui.searchIndex);
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    ui.query = "";
    ui.results = [];
    event.currentTarget.value = "";
    paintResults();
  }
}

async function runSearch() {
  const query = ui.query.trim();
  const token = ++ui.searchToken;
  if (!query) {
    ui.results = [];
    paintResults();
    return;
  }
  const items = collectLocal(query);
  if (chrome.history?.search) {
    try {
      const visits = await chrome.history.search({ text: query, maxResults: 12, startTime: 0 });
      if (token !== ui.searchToken) return;
      mergeHistory(items, visits);
    } catch (error) {
      console.error(error);
    }
  }
  if (token !== ui.searchToken) return;
  ui.results = items.slice(0, 8);
  if (ui.searchIndex > ui.results.length - 1) ui.searchIndex = 0;
  paintResults();
}

function collectLocal(query) {
  const q = query.toLowerCase();
  const items = [];
  const seen = new Set();
  const url = toNavigableUrl(query);
  if (url) {
    items.push({ key: `go:${url}`, title: query.trim(), subtitle: "打开网址", url, kind: "go" });
    seen.add(normalizeUrl(url));
  }
  walk(state?.roots || []);
  for (const temp of state?.temps || []) {
    addPage({
      title: itemName(temp),
      url: temp.url,
      favIconUrl: temp.favIconUrl,
      when: temp.openedAt,
      tabId: temp.tabId,
      kind: "temp",
    });
  }
  for (const tab of tabs) {
    addPage({
      title: tab.title || hostOf(tab.url),
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      tabId: tab.id,
      kind: "tab",
    });
  }

  function walk(nodes) {
    for (const node of nodes) {
      if (node.type === "folder") {
        if ((node.name || "").toLowerCase().includes(q)) {
          items.push({ key: node.id, title: node.name, subtitle: "文件夹", kind: "folder", id: node.id });
        }
        walk(node.children || []);
      } else {
        addPage({ title: itemName(node), url: node.url, favIconUrl: node.favIconUrl, kind: "pin" });
      }
    }
  }

  function addPage(page) {
    const blob = `${page.title || ""} ${page.url || ""}`.toLowerCase();
    if (!blob.includes(q)) return;
    const key = normalizeUrl(page.url);
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push({
      ...page,
      key,
      subtitle: page.when ? formatAgo(Date.now() - page.when) : hostOf(page.url),
    });
  }

  return items;
}

function mergeHistory(items, visits) {
  for (const visit of visits || []) {
    const key = normalizeUrl(visit.url);
    if (!key) continue;
    const ago = visit.lastVisitTime ? formatAgo(Date.now() - visit.lastVisitTime) : "";
    const existing = items.find((item) => item.url && normalizeUrl(item.url) === key);
    if (existing) {
      if (ago && existing.kind !== "go") existing.subtitle = ago;
      if (!existing.favIconUrl) existing.favIconUrl = "";
      continue;
    }
    if (items.length >= 8) continue;
    items.push({
      key,
      title: visit.title || hostOf(visit.url) || visit.url,
      subtitle: ago,
      url: visit.url,
      kind: "history",
    });
  }
}

function paintResults() {
  const box = app.querySelector(".hits");
  if (!box) return;
  const query = ui.query.trim();
  const visible = document.activeElement?.classList?.contains("find") && query;
  box.replaceChildren();
  if (!visible) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (!ui.results.length) {
    const empty = document.createElement("p");
    empty.className = "hits-empty";
    empty.textContent = "没有匹配的网页";
    box.append(empty);
    return;
  }
  ui.results.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = index === ui.searchIndex ? "hit on" : "hit";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", index === ui.searchIndex ? "true" : "false");
    button.append(item.kind === "folder" ? folderIcon(false) : favicon(item.url, item.favIconUrl));
    const copy = document.createElement("span");
    copy.className = "copy";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = item.title;
    copy.append(name);
    if (item.subtitle) {
      const ago = document.createElement("span");
      ago.className = "ago";
      ago.textContent = item.subtitle;
      copy.append(ago);
    }
    button.append(copy);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => void activateResult(index));
    box.append(button);
  });
}

async function activateResult(index) {
  const item = ui.results[index];
  const typed = toNavigableUrl(ui.query);
  ui.query = "";
  ui.results = [];
  ui.searchIndex = 0;
  const find = app.querySelector(".find");
  if (find) find.value = "";
  paintResults();
  if (!item) {
    if (typed) await openUrl(typed);
    return;
  }
  if (item.kind === "folder") {
    await save((draft) => {
      const located = locate(draft.roots, item.id);
      if (!located || located.node.type !== "folder") return false;
      located.node.collapsed = false;
      return draft;
    });
    return;
  }
  if (Number.isInteger(item.tabId)) await focusTab(item.tabId, item.url);
  else if (item.url) await openUrl(item.url);
}

async function onNewTab() {
  try {
    await chrome.tabs.create({ active: true });
  } catch (error) {
    console.error(error);
    fail("新标签页没打开。");
  }
}

function sameUrl(left, right) {
  if (!left || !right) return false;
  try {
    const a = new URL(left);
    const b = new URL(right);
    a.hash = "";
    b.hash = "";
    return a.toString() === b.toString();
  } catch {
    return left === right;
  }
}
