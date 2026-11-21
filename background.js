import {
  collectPins,
  createTemp,
  isIgnoredUrl,
  normalizeUrl,
  partitionExpired,
  rebindTemps,
  urlMatchesAnyPin,
} from "./lib/model.js";
import { updateState } from "./lib/store.js";

const ownTabIds = new Set();
const pendingUrls = new Set();
let suppressNewTemps = 0;

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
    Promise.resolve(fn(...args)).catch((error) => console.error("[嵌套标签]", error));
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
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await reconcile();
  await sweep();
}));

chrome.alarms.onAlarm.addListener(guard(async (alarm) => {
  if (alarm.name === "sweep") await sweep();
}));

chrome.tabs.onCreated.addListener(guard(async (tab) => {
  if (suppressNewTemps > 0 || ownTabIds.has(tab.id)) {
    ownTabIds.add(tab.id);
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
  ownTabIds.delete(tabId);
  await updateState((state) => {
    state.temps = state.temps.filter((temp) => temp.tabId !== tabId);
    return state;
  });
}));

chrome.tabs.onReplaced.addListener(guard(async (added, removed) => {
  if (ownTabIds.has(removed)) {
    ownTabIds.delete(removed);
    ownTabIds.add(added);
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
  if (ownTabIds.has(tabId) || pendingUrls.has(normalizeUrl(url))) {
    ownTabIds.add(tabId);
    return;
  }
  const liveTabs = await chrome.tabs.query({});
  const live = new Set(liveTabs.map((item) => item.id));
  await updateState((state) => {
    const temp = state.temps.find((item) => item.tabId === tabId);
    if (temp) {
      if (url) temp.url = url;
      if (tab.title) temp.liveTitle = tab.title;
      if (tab.favIconUrl) temp.favIconUrl = tab.favIconUrl;
      temp.windowId = tab.windowId;
      if (url) {
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
    if (!url || urlMatchesAnyPin(state.roots, url)) {
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
  focusOrOpen(message.url)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "打不开这个网址" }));
  return true;
});

async function focusOrOpen(url) {
  if (!url) throw new Error("没有网址");
  const norm = normalizeUrl(url);
  const tabs = await chrome.tabs.query({});
  const match = tabs.find((tab) => normalizeUrl(tab.url || "") === norm);
  if (match) {
    await chrome.tabs.update(match.id, { active: true });
    await chrome.windows.update(match.windowId, { focused: true });
    return;
  }
  pendingUrls.add(norm);
  suppressNewTemps += 1;
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    ownTabIds.add(tab.id);
    await updateState((state) => {
      state.temps = state.temps.filter((temp) => temp.tabId !== tab.id);
      return state;
    });
  } finally {
    suppressNewTemps -= 1;
    setTimeout(() => pendingUrls.delete(norm), 3000);
  }
}

void init().catch((error) => console.error("[嵌套标签]", error));
