import { COPY } from "./copy.js";

export const TTL_OPTIONS = COPY.ttl.options;

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

function sanitizeId(value) {
  return typeof value === "string" && value ? value : crypto.randomUUID();
}

function sanitizeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

/**
 * 修剪损坏的树节点：丢弃未知类型/缺 url 的 pin，修复字段类型，
 * children 非数组时视为空——保证渲染层永远拿到合法结构。
 */
function sanitizeNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  const out = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.type === "folder") {
      out.push({
        type: "folder",
        id: sanitizeId(node.id),
        name: sanitizeString(node.name).trim() || COPY.fallback.folderName,
        color: sanitizeString(node.color, FOLDER_COLOR) || FOLDER_COLOR,
        collapsed: Boolean(node.collapsed),
        children: sanitizeNodes(node.children),
      });
    } else if (node.type === "pin") {
      if (typeof node.url !== "string" || !node.url) continue;
      out.push({
        type: "pin",
        id: sanitizeId(node.id),
        url: node.url,
        customName: sanitizeString(node.customName),
        favIconUrl: sanitizeString(node.favIconUrl),
      });
    }
  }
  return out;
}

function sanitizeTemp(temp) {
  if (!temp || typeof temp !== "object") return null;
  if (typeof temp.id !== "string" || !temp.id) return null;
  // 没有整数 tabId 的记录无法关闭对应标签，与 sweep 的过滤口径一致，直接丢弃
  if (!Number.isInteger(temp.tabId)) return null;
  return {
    id: temp.id,
    tabId: temp.tabId,
    windowId: Number.isInteger(temp.windowId) ? temp.windowId : 0,
    url: sanitizeString(temp.url),
    liveTitle: sanitizeString(temp.liveTitle),
    customName: sanitizeString(temp.customName),
    favIconUrl: sanitizeString(temp.favIconUrl),
    openedAt: Number.isFinite(temp.openedAt) ? temp.openedAt : Date.now(),
  };
}

function sanitizeTemps(temps) {
  if (!Array.isArray(temps)) return [];
  const out = [];
  const seen = new Set();
  for (const temp of temps) {
    const next = sanitizeTemp(temp);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
  }
  return out;
}

export function normalizeLoaded(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== "object") return state;
  state.rev = Number.isFinite(raw.rev) ? raw.rev : 0;
  state.settings.tempTtlHours = normalizeTtl(raw.settings?.tempTtlHours);
  state.roots = sanitizeNodes(raw.roots);
  state.temps = sanitizeTemps(raw.temps);
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

/** URL 相等性（忽略 hash）；任一为空则不相等，解析失败时退化为原始字符串比较。 */
export function sameUrl(left, right) {
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

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** 同源判定（协议 + 域名 + 端口），用于「同一站点内就地切换」。 */
export function sameOrigin(left, right) {
  const origin = originOf(left);
  // file:// 等非标准协议的 origin 是字符串 "null"，不能当成同一个站点
  return Boolean(origin) && origin !== "null" && origin === originOf(right);
}

/** URL 的 origin + path（忽略查询串与 hash），路径去掉尾部斜杠便于前缀比较。 */
function pathKey(url) {
  try {
    const parsed = new URL(url);
    return { origin: parsed.origin, path: parsed.pathname.replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

/** 固定项的路径是否为标签页路径的前缀（按 / 边界，站点根路径覆盖整个站点）。 */
function pathCovers(pinPath, tabPath) {
  if (!pinPath) return true;
  return tabPath === pinPath || tabPath.startsWith(`${pinPath}/`);
}

export function isIgnoredUrl(url) {
  if (!url) return false;
  return url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("devtools://");
}

export function itemName(item) {
  if (!item) return COPY.fallback.unnamed;
  if (item.type === "folder") return item.name || COPY.fallback.folderName;
  if (item.type === "pin") return item.customName || hostOf(item.url) || COPY.fallback.unnamed;
  return item.customName || item.liveTitle || hostOf(item.url) || COPY.fallback.unnamed;
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
  if (ms <= 0) return "closing soon";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.ceil(ms / 3600000);
  if (hours < 48) return `${hours} h`;
  const days = Math.ceil(ms / 86400000);
  return `${days} d`;
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
  if (elapsed < minute) return "just now";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}d ago`;
  if (elapsed < 30 * day) return `${Math.floor(elapsed / (7 * day))}w ago`;
  if (elapsed < 365 * day) return `${Math.floor(elapsed / (30 * day))}mo ago`;
  return `${Math.floor(elapsed / (365 * day))}y ago`;
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
  return name || COPY.fallback.unnamedGroup;
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
        customName: String(tab.title ?? "").trim().slice(0, 80) || hostOf(tab.url) || COPY.fallback.unnamed,
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
  if (!result?.groups) return COPY.status.noTabGroups;
  return COPY.status.tabGroupsImported(result);
}

export function createFolder(name) {
  return {
    type: "folder",
    id: crypto.randomUUID(),
    name: (name || COPY.fallback.folderName).trim() || COPY.fallback.folderName,
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

export function pinIdByUrl(nodes, url) {
  if (!url) return "";
  for (const pin of collectPins(nodes)) {
    if (sameUrl(pin.url, url)) return pin.id;
  }
  return "";
}

/**
 * 当前标签页所属的固定项：同源且固定项路径是标签页路径的前缀，取最长匹配。
 * 忽略查询串与 hash，所以页面内切换文件/标签页参数（SPA 常见）不会丢掉归属。
 */
export function pinMatchForUrl(nodes, url) {
  const target = pathKey(url);
  if (!target) return "";
  let bestId = "";
  let bestLength = -1;
  for (const pin of collectPins(nodes)) {
    const pinPath = pathKey(pin.url);
    if (!pinPath || pinPath.origin !== target.origin) continue;
    if (!pathCovers(pinPath.path, target.path)) continue;
    if (pinPath.path.length > bestLength) {
      bestLength = pinPath.path.length;
      bestId = pin.id;
    }
  }
  return bestId;
}

/**
 * 面板里该高亮哪一行固定项，优先级：
 * ① 当前 URL 与某个固定项完全相同 → 就是它
 * ② 该标签页由某个固定项打开（binding），且仍在同一站点 → 保持它
 * ③ 同源路径前缀最长匹配 → 重新打开面板等没有绑定信息时也能推断归属
 */
export function resolvePinId(nodes, url, binding) {
  if (!url) return "";
  const exact = pinIdByUrl(nodes, url);
  if (exact) return exact;
  if (binding?.pinId && sameOrigin(url, binding.origin)) {
    const located = locate(nodes, binding.pinId);
    if (located?.node?.type === "pin") return binding.pinId;
  }
  return pinMatchForUrl(nodes, url);
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
    customName: temp.customName || temp.liveTitle || hostOf(temp.url) || COPY.fallback.unnamed,
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
