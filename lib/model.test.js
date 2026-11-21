import assert from "node:assert/strict";
import test from "node:test";
import {
  adoptOpenTabs,
  collectTabGroups,
  createFolder,
  createTemp,
  deleteFolder,
  describeTabGroupImport,
  emptyState,
  faviconSources,
  formatAgo,
  formatRemaining,
  importTabGroups,
  isIgnoredUrl,
  moveNode,
  normalizeLoaded,
  normalizeUrl,
  partitionExpired,
  pinTemp,
  rebindTemps,
  remainingMs,
  removePin,
  renameItem,
  toNavigableUrl,
  urlMatchesAnyPin,
} from "./model.js";

function temp(partial) {
  return {
    id: partial.id,
    tabId: partial.tabId,
    windowId: 1,
    url: partial.url,
    liveTitle: partial.liveTitle || partial.url,
    customName: partial.customName || "",
    favIconUrl: "",
    openedAt: partial.openedAt,
  };
}

test("normalizeUrl drops the hash and keeps the query", () => {
  assert.equal(normalizeUrl("https://a.example/path?q=1#section"), "https://a.example/path?q=1");
  assert.equal(normalizeUrl(""), "");
});

test("missing storage becomes the 24 hour default", () => {
  const state = normalizeLoaded(null);
  assert.equal(state.settings.tempTtlHours, 24);
  assert.deepEqual(state.roots, []);
  assert.equal(normalizeLoaded({ settings: { tempTtlHours: 3 } }).settings.tempTtlHours, 24);
  assert.equal(normalizeLoaded({ settings: { tempTtlHours: 0 } }).settings.tempTtlHours, 0);
});

test("pinning a temp keeps the custom name and leaves the folder", () => {
  const state = emptyState();
  const folder = createFolder("支付组", 0);
  state.roots.push(folder);
  state.temps.push(temp({ id: "t1", tabId: 1, url: "https://pay.example/docs", liveTitle: "文档", customName: "支付文档", openedAt: 1 }));
  const pin = pinTemp(state, "t1", folder.id, 0);
  assert.equal(state.temps.length, 0);
  assert.equal(folder.children.length, 1);
  assert.equal(pin.customName, "支付文档");
  assert.equal(pin.url, "https://pay.example/docs");
  assert.equal(pinTemp(state, "missing", folder.id, 0), false);
});

test("a temp with no url cannot be pinned", () => {
  const state = emptyState();
  const folder = createFolder("文件夹", 0);
  state.roots.push(folder);
  state.temps.push(temp({ id: "t1", tabId: 1, url: "", openedAt: 1 }));
  assert.equal(pinTemp(state, "t1", folder.id, 0), false);
  assert.equal(state.temps.length, 1);
});

test("move rejects putting a folder inside itself", () => {
  const roots = [];
  const parent = createFolder("父级", 0);
  const child = createFolder("子级", 1);
  parent.children.push(child);
  roots.push(parent);
  assert.equal(moveNode(roots, parent.id, child.id, 0), false);
  assert.equal(roots[0].id, parent.id);
  assert.equal(roots[0].children[0].id, child.id);
});

test("reorder in the same folder accounts for the removed index", () => {
  const roots = [createFolder("A", 0), createFolder("B", 1), createFolder("C", 2)];
  assert.equal(moveNode(roots, roots[0].id, null, 3), true);
  assert.deepEqual(roots.map((node) => node.name), ["B", "C", "A"]);
});

test("deleteFolder lifts children to the parent", () => {
  const parent = createFolder("父级", 0);
  const child = createFolder("子级", 1);
  const pin = { type: "pin", id: "p1", url: "https://a.example", customName: "制品库", favIconUrl: "" };
  child.children.push(pin);
  parent.children.push(child);
  const roots = [parent];
  assert.equal(deleteFolder(roots, child.id), true);
  assert.equal(parent.children[0].id, "p1");
});

test("expiry keeps tabs inside the window and releases the ttl switch", () => {
  const now = 10 * 3600000;
  const temps = [
    temp({ id: "fresh", tabId: 1, url: "https://a.example", openedAt: now - 3600000 }),
    temp({ id: "old", tabId: 2, url: "https://b.example", openedAt: now - 24 * 3600000 }),
  ];
  const result = partitionExpired(temps, now, 24);
  assert.deepEqual(result.keep.map((item) => item.id), ["fresh"]);
  assert.deepEqual(result.expired.map((item) => item.id), ["old"]);
  assert.deepEqual(partitionExpired(temps, now, 0).expired, []);
});

test("rebind keeps the opened time when Chrome restores a tab with a new id", () => {
  const temps = [temp({ id: "t1", tabId: 4, url: "https://a.example/docs", liveTitle: "旧标题", customName: "代码库", openedAt: 50 })];
  const rebound = rebindTemps(temps, [{ id: 9, windowId: 2, url: "https://a.example/docs#top", title: "新标题", favIconUrl: "https://a.example/icon.png" }]);
  assert.equal(rebound.length, 1);
  assert.equal(rebound[0].tabId, 9);
  assert.equal(rebound[0].openedAt, 50);
  assert.equal(rebound[0].customName, "代码库");
  assert.equal(rebound[0].liveTitle, "新标题");
  assert.equal(rebindTemps(temps, []).length, 0);
});

test("removing a pin turns a still-open tab into a temp only when no pin keeps that url", () => {
  const state = emptyState();
  const folder = createFolder("支付组", 0);
  folder.children.push(
    { type: "pin", id: "p1", url: "https://a.example", customName: "制品库", favIconUrl: "" },
    { type: "pin", id: "p2", url: "https://a.example", customName: "副本", favIconUrl: "" },
  );
  state.roots.push(folder);
  const removed = removePin(state.roots, "p1");
  adoptOpenTabs(state, removed.url, [{ id: 3, windowId: 1, url: "https://a.example", title: "制品库" }], 100);
  assert.equal(state.temps.length, 0);
  removePin(state.roots, "p2");
  adoptOpenTabs(state, "https://a.example", [{ id: 3, windowId: 1, url: "https://a.example", title: "制品库" }], 100);
  assert.equal(state.temps.length, 1);
  assert.equal(state.temps[0].openedAt, 100);
});

test("rename rejects a blank name and trims", () => {
  const state = emptyState();
  const folder = createFolder("支付组", 0);
  state.roots.push(folder);
  assert.equal(renameItem(state, folder.id, "   "), false);
  assert.equal(renameItem(state, folder.id, "  测试环境  "), true);
  assert.equal(folder.name, "测试环境");
});

test("saved pins are recognized by url without the hash", () => {
  const folder = createFolder("支付组", 0);
  folder.children.push({ type: "pin", id: "p1", url: "https://a.example/app", customName: "后台", favIconUrl: "" });
  assert.equal(urlMatchesAnyPin([folder], "https://a.example/app#home"), true);
  assert.equal(urlMatchesAnyPin([folder], "https://other.example"), false);
});

test("remaining time is phrased for the row", () => {
  assert.equal(formatRemaining(0), "即将关闭");
  assert.equal(formatRemaining(30 * 60000), "30 分钟后关");
  assert.equal(formatRemaining(2 * 3600000), "2 小时后关");
  assert.equal(formatRemaining(3 * 86400000), "3 天后关");
  assert.equal(remainingMs(0, 3600000, 0), null);
});

test("search phrases a visit the way the result row does", () => {
  assert.equal(formatAgo(0), "刚刚");
  assert.equal(formatAgo(4 * 86400000), "4天前");
  assert.equal(formatAgo(6 * 86400000), "6天前");
  assert.equal(formatAgo(7 * 86400000), "1周前");
  assert.equal(toNavigableUrl("baidu.com/s"), "https://baidu.com/s");
  assert.equal(toNavigableUrl("https://baidu.com/s#a"), "https://baidu.com/s#a");
  assert.equal(toNavigableUrl("支付组"), "");
});

test("chrome tab groups become folders and their pages become pins", () => {
  const state = emptyState();
  const existing = createFolder("生产环境");
  existing.collapsed = true;
  existing.children.push({ type: "pin", id: "p-ops", url: "https://ops.example.com", customName: "支付中台运营系统", favIconUrl: "" });
  state.roots.push(existing);
  state.temps.push(temp({ id: "t-graf", tabId: 15, url: "https://grafana.example.com", liveTitle: "应用监控-grafana", openedAt: 1 }));
  const collected = collectTabGroups(
    [
      { id: 8, windowId: 2, title: "生产环境" },
      { id: 7, windowId: 1, title: "  监控  " },
      { id: -1, windowId: 1, title: "忽略" },
    ],
    [
      { groupId: -1, index: 0, url: "https://loose.example.com", title: "未分组" },
      { groupId: 7, index: 3, url: "https://grafana.example.com/#board", title: "应用监控-grafana", favIconUrl: "https://grafana.example.com/icon.png" },
      { groupId: 7, index: 2, url: "chrome://newtab/", title: "新标签页" },
      { groupId: 7, index: 4, url: "https://grafana.example.com", title: "重复" },
      { groupId: 8, index: 1, url: "https://ops.example.com", title: "支付中台运营系统" },
      { groupId: 9, index: 0, url: "https://missing-group.example.com", title: "没有组" },
    ],
  );
  const result = importTabGroups(state, collected);
  assert.equal(describeTabGroupImport(result), "已导入 1 个文件夹、1 个网页");
  assert.equal(state.roots.map((node) => node.name).join(","), "生产环境,监控");
  const monitor = state.roots[1];
  assert.equal(monitor.collapsed, false);
  assert.equal(monitor.children.length, 1);
  assert.equal(monitor.children[0].url, "https://grafana.example.com/#board");
  assert.equal(monitor.children[0].customName, "应用监控-grafana");
  assert.equal(existing.collapsed, true);
  assert.equal(existing.children.length, 1);
  assert.equal(state.temps.length, 0);
  const again = importTabGroups(state, collected);
  assert.equal(again.changed, false);
  assert.equal(describeTabGroupImport(again), "标签组里的网页都已经在里面了");
  assert.equal(state.roots.length, 2);
});

test("a tab group whose pages are already pinned elsewhere does not add an empty folder", () => {
  const state = emptyState();
  const folder = createFolder("别的文件夹");
  folder.children.push({ type: "pin", id: "p1", url: "https://a.example", customName: "已有", favIconUrl: "" });
  state.roots.push(folder);
  const result = importTabGroups(state, [{
    title: "工作",
    windowId: 1,
    index: 0,
    tabs: [{ url: "https://a.example#top", title: "已有", index: 0 }],
  }]);
  assert.equal(result.folders, 0);
  assert.equal(result.pins, 0);
  assert.equal(state.roots.length, 1);
  assert.equal(describeTabGroupImport({ groups: 0, folders: 0, pins: 0 }), "没有可导入的标签组");
});

test("an empty tab group still becomes a folder", () => {
  const state = emptyState();
  const result = importTabGroups(state, [{ title: "", windowId: 1, index: 0, tabs: [] }]);
  assert.equal(result.folders, 1);
  assert.equal(state.roots[0].name, "未命名组");
  assert.equal(describeTabGroupImport(result), "已导入 1 个文件夹");
});

test("createTemp records when the tab became temporary", () => {
  const created = createTemp({ id: 7, windowId: 1, url: "https://a.example", pendingUrl: "", title: "文档" }, 42);
  assert.equal(created.tabId, 7);
  assert.equal(created.openedAt, 42);
  assert.equal(created.liveTitle, "文档");
});

test("isIgnoredUrl skips internal browser pages", () => {
  assert.equal(isIgnoredUrl("chrome://settings/appearance"), true);
  assert.equal(isIgnoredUrl("chrome://extensions"), true);
  assert.equal(isIgnoredUrl("chrome-extension://abc/page.html"), true);
  assert.equal(isIgnoredUrl("devtools://devtools/bundled/inspector.html"), true);
  assert.equal(isIgnoredUrl("https://example.com"), false);
  assert.equal(isIgnoredUrl(""), false);
});

test("faviconSources prefers saved icon, then Chrome local favicon, then Google", () => {
  const sources = faviconSources("https://a.example.com/x", "https://a.example.com/f.png");
  assert.equal(sources[0], "https://a.example.com/f.png");
  assert.ok(sources[1].includes("_favicon/?pageUrl=https%3A%2F%2Fa.example.com%2Fx&size=32"));
  assert.ok(sources[2].includes("google.com/s2/favicons?domain=a.example.com"));
});

test("faviconSources builds the _favicon URL through the given resolver", () => {
  const sources = faviconSources("https://a.example.com", "", (path) => `chrome-extension://id/${path}`);
  assert.equal(sources[0], "chrome-extension://id/_favicon/?pageUrl=https%3A%2F%2Fa.example.com&size=32");
  assert.equal(sources.length, 2);
});

test("faviconSources degrades to nothing without a url", () => {
  assert.deepEqual(faviconSources("", ""), []);
  assert.deepEqual(faviconSources("", "https://a.example/f.png"), ["https://a.example/f.png"]);
});
