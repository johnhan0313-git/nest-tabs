export const TTL_OPTIONS = [
  { hours: 1, label: "1 小时后关闭" },
  { hours: 6, label: "6 小时后关闭" },
  { hours: 24, label: "24 小时后关闭" },
  { hours: 72, label: "3 天后关闭" },
  { hours: 168, label: "7 天后关闭" },
  { hours: 0, label: "不自动关闭" },
];

const FOLDER_COLOR = "#4c8dff";

const TTL_VALUES = new Set(TTL_OPTIONS.map((option) => option.hours));

export function emptyState() {
  return {
    version: 1,
    rev: 0,
    roots: [],
    temps: [],
    settings: { tempTtlHours: 24 },
  };
}

export function normalizeTtl(value) {
  return TTL_VALUES.has(value) ? value : 24;
}

export function normalizeLoaded(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== "object") return state;
  state.rev = Number.isFinite(raw.rev) ? raw.rev : 0;
  state.settings.tempTtlHours = normalizeTtl(raw.settings?.tempTtlHours);
  state.roots = Array.isArray(raw.roots) ? raw.roots : [];
  state.temps = Array.isArray(raw.temps) ? raw.temps : [];
  return state;
}

export function normalizeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isIgnoredUrl(url) {
  if (!url) return false;
  return url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("devtools://");
}

export function itemName(item) {
  if (!item) return "未命名";
  if (item.type === "folder") return item.name || "文件夹";
  if (item.type === "pin") return item.customName || hostOf(item.url) || "未命名";
  return item.customName || item.liveTitle || hostOf(item.url) || "未命名";
}

/**
 * 图标地址候选，按优先级返回，由调用方逐个尝试（加载失败则换下一个）：
 * ① 保存的真实图标 → ② Chrome 内置 _favicon（本地缓存，内网/离线可用）
 * → ③ Google s2 兜底（查不到时会返回默认地球图，仅作最后手段）。
 */
export function faviconSources(url, favIconUrl, resolve = (path) => path) {
  const sources = [];
  if (favIconUrl && /^https?:/i.test(favIconUrl)) sources.push(favIconUrl);
  if (url) sources.push(resolve(`_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`));
  const host = hostOf(url);
  if (host) sources.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`);
  return sources;
}

export function formatRemaining(ms) {
  if (ms <= 0) return "即将关闭";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟后关`;
  const hours = Math.ceil(ms / 3600000);
  if (hours < 48) return `${hours} 小时后关`;
  const days = Math.ceil(ms / 86400000);
  return `${days} 天后关`;
}

export function remainingMs(openedAt, now, ttlHours) {
  if (!ttlHours) return null;
  return openedAt + ttlHours * 3600000 - now;
}

export function formatAgo(ms) {
  const elapsed = Math.max(0, Number(ms) || 0);
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return "刚刚";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}分钟前`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}小时前`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}天前`;
  if (elapsed < 30 * day) return `${Math.floor(elapsed / (7 * day))}周前`;
  if (elapsed < 365 * day) return `${Math.floor(elapsed / (30 * day))}个月前`;
  return `${Math.floor(elapsed / (365 * day))}年前`;
}

export function toNavigableUrl(text) {
  const raw = String(text || "").trim();
  if (!raw || /\s/.test(raw)) return "";
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).toString();
    } catch {
      return "";
    }
  }
  if (/^[\w-]+(\.[\w-]+)+(?::\d+)?(\/\S*)?$/i.test(raw)) return `https://${raw}`;
  return "";
}

function canImportUrl(url) {
  if (!url || isIgnoredUrl(url)) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "file:";
  } catch {
    return false;
  }
}

function groupTitle(title) {
  const name = String(title ?? "").trim().slice(0, 80);
  return name || "未命名组";
}

export function collectTabGroups(groups, tabs) {
  const byId = new Map();
  for (const group of groups || []) {
    if (group == null || group.id == null || group.id === -1) continue;
    byId.set(group.id, {
      title: group.title || "",
      windowId: group.windowId ?? 0,
      index: Number.MAX_SAFE_INTEGER,
      tabs: [],
    });
  }
  for (const tab of tabs || []) {
    const bucket = byId.get(tab.groupId);
    if (!bucket) continue;
    const index = Number.isFinite(tab.index) ? tab.index : 0;
    if (index < bucket.index) bucket.index = index;
    bucket.tabs.push({
      url: tab.url || tab.pendingUrl || "",
      title: tab.title || "",
      favIconUrl: tab.favIconUrl || "",
      index,
    });
  }
  return [...byId.values()].sort((a, b) => a.windowId - b.windowId || a.index - b.index);
}

export function importTabGroups(state, groups) {
  const list = Array.isArray(groups) ? groups : [];
  let folders = 0;
  let pins = 0;
  let focusId = "";
  const ordered = list.slice().sort((a, b) => (a.windowId ?? 0) - (b.windowId ?? 0) || (a.index ?? 0) - (b.index ?? 0));
  for (const group of ordered) {
    const name = groupTitle(group.title);
    const pages = (Array.isArray(group.tabs) ? group.tabs : [])
      .filter((tab) => canImportUrl(tab.url))
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    let folder = state.roots.find((node) => node.type === "folder" && node.name === name);
    const fresh = pages.filter((tab) => !urlMatchesAnyPin(state.roots, tab.url));
    if (!folder) {
      if (!fresh.length && pages.length) continue;
      folder = createFolder(name);
      state.roots.push(folder);
      folders += 1;
      if (!focusId) focusId = folder.id;
    }
    for (const tab of fresh) {
      if (urlMatchesAnyPin(state.roots, tab.url)) continue;
      folder.children.push(createPin({
        url: tab.url,
        customName: String(tab.title ?? "").trim().slice(0, 80) || hostOf(tab.url) || "未命名",
        favIconUrl: tab.favIconUrl || "",
      }));
      pins += 1;
      folder.collapsed = false;
      if (!focusId) focusId = folder.id;
    }
  }
  const before = state.temps.length;
  state.temps = state.temps.filter((temp) => !temp.url || !urlMatchesAnyPin(state.roots, temp.url));
  return {
    groups: list.length,
    folders,
    pins,
    changed: folders > 0 || pins > 0 || state.temps.length !== before,
    focusId,
  };
}

export function describeTabGroupImport(result) {
  if (!result?.groups) return "没有可导入的标签组";
  if (!result.folders && !result.pins) return "标签组里的网页都已经在里面了";
  const parts = [];
  if (result.folders) parts.push(`${result.folders} 个文件夹`);
  if (result.pins) parts.push(`${result.pins} 个网页`);
  return `已导入 ${parts.join("、")}`;
}

export function createFolder(name) {
  return {
    type: "folder",
    id: crypto.randomUUID(),
    name: (name || "文件夹").trim() || "文件夹",
    color: FOLDER_COLOR,
    collapsed: false,
    children: [],
  };
}

export function createPin({ url, customName = "", favIconUrl = "" }) {
  return {
    type: "pin",
    id: crypto.randomUUID(),
    url,
    customName,
    favIconUrl,
  };
}

export function createTemp(tab, now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    tabId: tab.id,
    windowId: tab.windowId ?? 0,
    url: tab.url || tab.pendingUrl || "",
    liveTitle: tab.title || "",
    customName: "",
    favIconUrl: tab.favIconUrl || "",
    openedAt: now,
  };
}

export function flattenFolders(nodes, depth = 0, out = []) {
  for (const node of nodes) {
    if (node.type !== "folder") continue;
    out.push({ id: node.id, name: node.name, depth, color: node.color });
    flattenFolders(node.children, depth + 1, out);
  }
  return out;
}

export function locate(nodes, id, parentId = null) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.id === id) return { node, index, siblings: nodes, parentId };
    if (node.type === "folder") {
      const hit = locate(node.children, id, node.id);
      if (hit) return hit;
    }
  }
  return null;
}

export function isInside(nodes, ancestorId, nodeId) {
  const ancestor = locate(nodes, ancestorId);
  if (!ancestor || ancestor.node.type !== "folder") return false;
  return Boolean(locate(ancestor.node.children, nodeId));
}

export function urlMatchesAnyPin(nodes, url) {
  if (!url) return false;
  const norm = normalizeUrl(url);
  for (const node of nodes) {
    if (node.type === "pin" && normalizeUrl(node.url) === norm) return true;
    if (node.type === "folder" && urlMatchesAnyPin(node.children, url)) return true;
  }
  return false;
}

export function collectPins(nodes, out = []) {
  for (const node of nodes) {
    if (node.type === "pin") out.push(node);
    else if (node.type === "folder") collectPins(node.children, out);
  }
  return out;
}

export function moveNode(roots, nodeId, parentId, index) {
  const loc = locate(roots, nodeId);
  if (!loc) return false;
  if (loc.node.type === "folder" && parentId && (parentId === nodeId || isInside(roots, nodeId, parentId))) {
    return false;
  }
  if (parentId) {
    const parent = locate(roots, parentId);
    if (!parent || parent.node.type !== "folder") return false;
  }
  const sameParent = loc.parentId === parentId;
  let at = index;
  if (sameParent && loc.index < at) at -= 1;
  const [node] = loc.siblings.splice(loc.index, 1);
  const dest = parentId ? locate(roots, parentId).node.children : roots;
  at = Math.max(0, Math.min(at, dest.length));
  dest.splice(at, 0, node);
  return true;
}

export function pinTemp(state, tempId, parentId, index) {
  const tempIndex = state.temps.findIndex((temp) => temp.id === tempId);
  if (tempIndex < 0) return false;
  const temp = state.temps[tempIndex];
  if (!temp.url || isIgnoredUrl(temp.url)) return false;
  if (parentId) {
    const parent = locate(state.roots, parentId);
    if (!parent || parent.node.type !== "folder") return false;
  }
  state.temps.splice(tempIndex, 1);
  const pin = createPin({
    url: temp.url,
    customName: temp.customName || temp.liveTitle || hostOf(temp.url) || "未命名",
    favIconUrl: temp.favIconUrl || "",
  });
  const dest = parentId ? locate(state.roots, parentId).node.children : state.roots;
  const at = Math.max(0, Math.min(index ?? dest.length, dest.length));
  dest.splice(at, 0, pin);
  return pin;
}

export function deleteFolder(roots, folderId) {
  const loc = locate(roots, folderId);
  if (!loc || loc.node.type !== "folder") return false;
  loc.siblings.splice(loc.index, 1, ...loc.node.children);
  return true;
}

export function removePin(roots, pinId) {
  const loc = locate(roots, pinId);
  if (!loc || loc.node.type !== "pin") return null;
  loc.siblings.splice(loc.index, 1);
  return loc.node;
}

export function renameItem(state, id, raw) {
  const name = String(raw ?? "").trim().slice(0, 80);
  if (!name) return false;
  const temp = state.temps.find((item) => item.id === id);
  if (temp) {
    temp.customName = name;
    return true;
  }
  const loc = locate(state.roots, id);
  if (!loc) return false;
  if (loc.node.type === "folder") loc.node.name = name;
  else loc.node.customName = name;
  return true;
}

export function toggleCollapsed(roots, folderId) {
  const loc = locate(roots, folderId);
  if (!loc || loc.node.type !== "folder") return false;
  loc.node.collapsed = !loc.node.collapsed;
  return true;
}

export function partitionExpired(temps, now, ttlHours) {
  if (!ttlHours) return { keep: temps.slice(), expired: [] };
  const limit = ttlHours * 3600000;
  const keep = [];
  const expired = [];
  for (const temp of temps) {
    if (now - temp.openedAt >= limit) expired.push(temp);
    else keep.push(temp);
  }
  return { keep, expired };
}

export function rebindTemps(temps, tabs, { dropMissing = true } = {}) {
  const used = new Set();
  const next = [];
  for (const temp of temps) {
    let tab = tabs.find((item) => item.id === temp.tabId && !used.has(item.id));
    if (!tab && temp.url) {
      const norm = normalizeUrl(temp.url);
      tab = tabs.find((item) => !used.has(item.id) && normalizeUrl(item.url || item.pendingUrl || "") === norm);
    }
    if (!tab) {
      if (!dropMissing) next.push(temp);
      continue;
    }
    used.add(tab.id);
    next.push({
      ...temp,
      tabId: tab.id,
      windowId: tab.windowId ?? temp.windowId,
      url: tab.url || temp.url,
      liveTitle: tab.title || temp.liveTitle,
      favIconUrl: tab.favIconUrl || temp.favIconUrl,
    });
  }
  return next;
}

export function adoptOpenTabs(state, url, tabs, now) {
  if (!url || urlMatchesAnyPin(state.roots, url)) return;
  const norm = normalizeUrl(url);
  for (const tab of tabs) {
    if (normalizeUrl(tab.url || "") !== norm) continue;
    if (isIgnoredUrl(tab.url)) continue;
    if (state.temps.some((temp) => temp.tabId === tab.id)) continue;
    state.temps.push(createTemp(tab, now));
  }
}

export function sortedTemps(temps) {
  return temps.slice().sort((a, b) => b.openedAt - a.openedAt);
}
