import {
  collectPins,
  createTemp,
  isIgnoredUrl,
  normalizeUrl,
  originOf,
  partitionExpired,
  rebindTemps,
  sameOrigin,
  urlMatchesAnyPin,
} from "./lib/model.js";
import { loadState, updateState } from "./lib/store.js";

// MV3 SW 会被空闲回收，抑制态持久化到 storage.session（浏览器重启自动清空），
// 重启后自家打开的标签不会被误记为临时标签。pendingUrls 用过期时间戳替代
// setTimeout 删除——SW 被回收时 setTimeout 会丢，时间戳读取时惰性判断即可。
const ownTabIds = new Set();
const pendingUrls = new Map(); // 归一化 url -> 过期时间戳
// tabId -> { pinId, origin }：记录「这个标签是从哪个固定项打开的」。
// 页面内跳转（SPA 改 URL）后仍能高亮原来那一行，也能避免同站点重复开标签。
const tabPins = new Map();
let suppressNewTemps = 0; // 仅在单次 focusOrOpen 调用内非零，无需持久化

const SW_MEM_KEY = "swMem";

async function restoreSwMem() {
  try {
    const stored = await chrome.storage.session.get(SW_MEM_KEY);
    const mem = stored[SW_MEM_KEY];
    if (!mem) return;
    if (Array.isArray(mem.ownTabIds)) for (const id of mem.ownTabIds) ownTabIds.add(id);
    for (const [id, binding] of Object.entries(mem.tabPins || {})) {
      const tabId = Number(id);
      if (!Number.isInteger(tabId) || !binding || typeof binding.pinId !== "string") continue;
      tabPins.set(tabId, { pinId: binding.pinId, origin: String(binding.origin || "") });
    }
    const now = Date.now();
    for (const [url, expiresAt] of Object.entries(mem.pendingUrls || {})) {
      if (expiresAt > now) pendingUrls.set(url, expiresAt);
    }
  } catch (error) {
    console.error("[嵌套标签] 恢复会话态失败", error);
  }
}

// 模块加载时启动恢复；事件 handler 经 guard 等它完成后才变异
const swMemReady = restoreSwMem();

let swMemWriteTimer = 0;

function swMemSnapshot() {
  const now = Date.now();
  for (const [url, expiresAt] of pendingUrls) {
    if (expiresAt <= now) pendingUrls.delete(url);
  }
  return {
    ownTabIds: [...ownTabIds],
    pendingUrls: Object.fromEntries(pendingUrls),
    tabPins: Object.fromEntries(tabPins),
  };
}

function writeSwMem() {
  return chrome.storage.session
    .set({ [SW_MEM_KEY]: swMemSnapshot() })
    .catch((error) => console.error("[嵌套标签] 保存会话态失败", error));
}

function persistSwMem() {
  if (swMemWriteTimer) return;
  swMemWriteTimer = setTimeout(() => {
    swMemWriteTimer = 0;
    void writeSwMem();
  }, 100);
}

/** 绑定关系要立刻落库：面板随后会读取它决定高亮，不能等防抖。 */
function persistSwMemNow() {
  clearTimeout(swMemWriteTimer);
  swMemWriteTimer = 0;
  return writeSwMem();
}

function bindTabPin(tabId, pinId, url) {
  if (!Number.isInteger(tabId) || !pinId) return Promise.resolve();
  const origin = originOf(url);
  const previous = tabPins.get(tabId);
  if (previous && previous.pinId === pinId && previous.origin === origin) return Promise.resolve();
  tabPins.set(tabId, { pinId, origin });
  return persistSwMemNow();
}

/** 已经是临时标签的页签由 temp.tabId 自己跟踪高亮，不再绑定固定项，避免两行同时选中。 */
async function isTrackedTemp(tabId) {
  const state = await loadState();
  return state.temps.some((temp) => temp.tabId === tabId);
}

function pendingUrlActive(norm) {
  const expiresAt = pendingUrls.get(norm);
  if (expiresAt == null) return false;
  if (expiresAt <= Date.now()) {
    pendingUrls.delete(norm);
    return false;
  }
  return true;
}

async function init() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.alarms.create("sweep", { periodInMinutes: 1 });
}

async function importOpenTabs() {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  await updateState((state) => {
    for (const tab of tabs) {
      const url = tab.url || tab.pendingUrl || "";
      if (isIgnoredUrl(url)) continue;
      if (state.temps.some((temp) => temp.tabId === tab.id)) continue;
      if (url && urlMatchesAnyPin(state.roots, url)) continue;
      state.temps.push(createTemp(tab, now));
    }
    return state;
  });
}

async function reconcile() {
  const tabs = await chrome.tabs.query({});
  const live = new Set(tabs.map((tab) => tab.id));
  let pruned = false;
  for (const tabId of [...tabPins.keys()]) {
    if (live.has(tabId)) continue;
    tabPins.delete(tabId);
    pruned = true;
  }
  if (pruned) await persistSwMemNow();
  await updateState((state) => {
    state.temps = rebindTemps(state.temps, tabs, { dropMissing: false });
    return state;
  });
}

async function sweep() {
  const now = Date.now();
  let expiredIds = [];
  await updateState((state) => {
    // chrome:// 等内部页面不再跟踪（只从列表移除，不关闭标签）
    state.temps = state.temps.filter((temp) => !isIgnoredUrl(temp.url));
    const { keep, expired } = partitionExpired(state.temps, now, state.settings.tempTtlHours);
    expiredIds = expired.map((temp) => temp.tabId).filter((id) => Number.isInteger(id));
    state.temps = keep;
    return state;
  });
  if (expiredIds.length) {
    await chrome.tabs.remove(expiredIds).catch(() => {});
  }
}

function guard(fn) {
  return (...args) => {
    // 先等会话态恢复：未恢复就变异并写回会把旧快照覆盖上去
    return Promise.resolve()
      .then(() => swMemReady)
      .then(() => fn(...args))
      .catch((error) => console.error("[嵌套标签]", error));
  };
}

chrome.runtime.onInstalled.addListener(guard(async (details) => {
  await init();
  if (details.reason === "install") await importOpenTabs();
  else {
    await reconcile();
    await importOpenTabs();
  }
  await sweep();
}));

chrome.runtime.onStartup.addListener(guard(async () => {
  await init();
  await waitForFirstTab();
  await reconcile();
  await sweep();
}));

/**
 * 启动早期窗口/标签可能还没恢复，轮询等到出现至少一个标签再收编，
 * 替代原先固定等待 1500ms（快则立刻返回，最多等 5 秒后放弃）。
 */
async function waitForFirstTab() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await chrome.tabs.query({})).length) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

chrome.alarms.onAlarm.addListener(guard(async (alarm) => {
  if (alarm.name === "sweep") await sweep();
}));

chrome.tabs.onCreated.addListener(guard(async (tab) => {
  if (suppressNewTemps > 0 || ownTabIds.has(tab.id)) {
    if (!ownTabIds.has(tab.id)) {
      ownTabIds.add(tab.id);
      persistSwMem();
    }
    return;
  }
  const url = tab.url || tab.pendingUrl || "";
  if (isIgnoredUrl(url)) return;
  const all = await chrome.tabs.query({});
  await updateState((state) => {
    if (state.temps.some((temp) => temp.tabId === tab.id)) return state;
    const live = new Set(all.map((item) => item.id));
    if (url && urlMatchesAnyPin(state.roots, url)) return state;
    const orphan = state.temps.find((temp) => (
      temp.tabId !== tab.id
      && !live.has(temp.tabId)
      && url
      && normalizeUrl(temp.url) === normalizeUrl(url)
    ));
    if (orphan) {
      orphan.tabId = tab.id;
      orphan.windowId = tab.windowId;
      if (tab.title) orphan.liveTitle = tab.title;
      if (tab.favIconUrl) orphan.favIconUrl = tab.favIconUrl;
      return state;
    }
    state.temps.push(createTemp(tab, Date.now()));
    return state;
  });
}));

chrome.tabs.onRemoved.addListener(guard(async (tabId) => {
  if (ownTabIds.delete(tabId)) persistSwMem();
  if (tabPins.delete(tabId)) persistSwMem();
  await updateState((state) => {
    state.temps = state.temps.filter((temp) => temp.tabId !== tabId);
    return state;
  });
}));

chrome.tabs.onReplaced.addListener(guard(async (added, removed) => {
  if (ownTabIds.has(removed)) {
    ownTabIds.delete(removed);
    ownTabIds.add(added);
    persistSwMem();
  }
  const binding = tabPins.get(removed);
  if (binding) {
    tabPins.delete(removed);
    tabPins.set(added, binding);
    persistSwMem();
  }
  await updateState((state) => {
    const temp = state.temps.find((item) => item.tabId === removed);
    if (temp) temp.tabId = added;
    return state;
  });
}));

chrome.tabs.onUpdated.addListener(guard(async (tabId, change, tab) => {
  if (!change.url && !change.title && !change.favIconUrl) return;
  const url = tab.url || "";
  if (isIgnoredUrl(url)) return;
  // 绑定在固定项上的标签离开该站点后解除绑定，之后按普通标签重新收编
  if (change.url && tabPins.has(tabId) && !sameOrigin(url, tabPins.get(tabId).origin)) {
    tabPins.delete(tabId);
    persistSwMem();
  }
  if (ownTabIds.has(tabId) || pendingUrlActive(normalizeUrl(url))) {
    if (!ownTabIds.has(tabId)) {
      ownTabIds.add(tabId);
      persistSwMem();
    }
    return;
  }
  // 标题/图标更新不带 url：跳过全量 tabs.query（页面加载期这类事件最频繁）
  const live = change.url ? new Set((await chrome.tabs.query({})).map((item) => item.id)) : null;
  await updateState((state) => {
    const temp = state.temps.find((item) => item.tabId === tabId);
    if (temp) {
      if (url) temp.url = url;
      if (tab.title) temp.liveTitle = tab.title;
      if (tab.favIconUrl) temp.favIconUrl = tab.favIconUrl;
      temp.windowId = tab.windowId;
      if (url && live) {
        const dead = state.temps.find((item) => (
          item.id !== temp.id
          && !live.has(item.tabId)
          && normalizeUrl(item.url) === normalizeUrl(url)
        ));
        if (dead) {
          if (!temp.customName) temp.customName = dead.customName;
          temp.openedAt = Math.min(temp.openedAt, dead.openedAt);
          state.temps = state.temps.filter((item) => item.id !== dead.id);
        }
      }
      return state;
    }
    if (!url || urlMatchesAnyPin(state.roots, url) || tabPins.has(tabId)) {
      if (change.favIconUrl) {
        for (const pin of collectPins(state.roots)) {
          if (normalizeUrl(pin.url) === normalizeUrl(url) && !pin.favIconUrl) pin.favIconUrl = change.favIconUrl;
        }
      }
      return state;
    }
    state.temps.push(createTemp(tab, Date.now()));
    return state;
  });
}));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "focus-or-open") return false;
  focusOrOpen(message.url, message.pinId)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "打不开这个网址" }));
  return true;
});

/**
 * 固定页里点 target="_blank" / window.open() 时，Chrome 会新建标签。
 * 如果来源标签绑定着固定项，且目标仍在同一站点，就关掉新标签、把跳转拉回原标签，
 * 这样「在项目里点菜单」不会新开一页，自定义命名和固定项归属也不变。
 * 跨域链接放行：那本来就是用户想离开这个站点。
 */
chrome.webNavigation.onCreatedNavigationTarget.addListener(guard(async (details) => {
  const sourceId = details?.sourceTabId;
  const newTabId = details?.tabId;
  if (!Number.isInteger(sourceId) || sourceId < 0 || !Number.isInteger(newTabId)) return;
  const binding = tabPins.get(sourceId);
  if (!binding) return;
  await swMemReady;

  let url = details.url || "";
  if (!url) {
    // 没有 host 权限时 details.url 可能为空；tabs 权限足够从新标签读到地址
    try {
      const tab = await chrome.tabs.get(newTabId);
      url = tab.pendingUrl || tab.url || "";
    } catch {
      return;
    }
  }
  if (!url || isIgnoredUrl(url) || !sameOrigin(url, binding.origin)) return;

  await chrome.tabs.remove(newTabId).catch(() => {});
  await chrome.tabs.update(sourceId, { url, active: true }).catch((error) => {
    console.error("[嵌套标签] 把弹窗拉回原标签失败", error);
  });
}));

async function focusOrOpen(url, pinId = "") {
  if (!url) throw new Error("没有网址");
  await swMemReady;
  const norm = normalizeUrl(url);
  const tabs = await chrome.tabs.query({});
  const match = tabs.find((tab) => normalizeUrl(tab.url || "") === norm);
  if (match) {
    if (pinId && !(await isTrackedTemp(match.id))) await bindTabPin(match.id, pinId, url);
    await chrome.tabs.update(match.id, { active: true });
    await chrome.windows.update(match.windowId, { focused: true });
    return;
  }
  // 点击固定项时，如果当前标签页已经在这个站点上，就直接在当前标签页打开，
  // 不再为同一站点开第二个标签（例如在 Codeup 里切换项目）。
  if (pinId) {
    const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (current && current.id != null && !isIgnoredUrl(current.url || "") && sameOrigin(current.url, url)) {
      if (!(await isTrackedTemp(current.id))) await bindTabPin(current.id, pinId, url);
      await chrome.tabs.update(current.id, { url, active: true });
      await chrome.windows.update(current.windowId, { focused: true });
      return;
    }
  }
  pendingUrls.set(norm, Date.now() + 3000);
  persistSwMem();
  suppressNewTemps += 1;
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    if (!ownTabIds.has(tab.id)) {
      ownTabIds.add(tab.id);
      persistSwMem();
    }
    if (pinId) await bindTabPin(tab.id, pinId, url);
    await updateState((state) => {
      state.temps = state.temps.filter((temp) => temp.tabId !== tab.id);
      return state;
    });
  } finally {
    suppressNewTemps -= 1;
  }
}

void init().catch((error) => console.error("[嵌套标签]", error));
