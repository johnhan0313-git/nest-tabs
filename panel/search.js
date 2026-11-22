import { formatAgo, hostOf, itemName, locate, normalizeUrl, toNavigableUrl } from "../lib/model.js";
import { app, refresh, state, tabs, ui } from "./state.js";
import { favicon, folderIcon, searchIcon } from "./dom.js";
import { focusTab, openUrl, save } from "./actions.js";

// 搜索头整块持久化：保住输入焦点/光标与 IME 合成状态，不再整块重建
let topEl = null;
let hitsEl = null;

export function renderSearch() {
  if (topEl) {
    const current = topEl.querySelector(".find");
    // 聚焦时不碰 value：IME 合成期间 ui.query 落后于输入框，写回会打断输入
    if (current && document.activeElement !== current && current.value !== ui.query) current.value = ui.query;
    return topEl;
  }
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
  topEl = header;
  return header;
}

export function renderHits() {
  if (hitsEl) return hitsEl;
  const box = document.createElement("div");
  box.className = "hits";
  box.id = "hits";
  box.hidden = true;
  box.setAttribute("role", "listbox");
  box.setAttribute("aria-label", "搜索结果");
  hitsEl = box;
  return box;
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
        addPage({ id: node.id, title: itemName(node), url: node.url, favIconUrl: node.favIconUrl, kind: "pin" });
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

export function paintResults() {
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
  else if (item.url) await openUrl(item.url, item.kind === "pin" ? item.id : "");
}
