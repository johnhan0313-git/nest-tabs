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
  pinIdByUrl,
  pinMatchForUrl,
  pinTemp,
  rebindTemps,
  remainingMs,
  removePin,
  renameItem,
  resolvePinId,
  sameOrigin,
  sameUrl,
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

test("sameUrl compares ignoring the hash and rejects empty input", () => {
  assert.equal(sameUrl("https://a.example/p#x", "https://a.example/p#y"), true);
  assert.equal(sameUrl("https://a.example/p", "https://a.example/p"), true);
  assert.equal(sameUrl("https://a.example/p", "https://b.example/p"), false);
  assert.equal(sameUrl("", ""), false);
  assert.equal(sameUrl(null, "https://a.example"), false);
});

test("sameUrl falls back to raw comparison when parsing fails", () => {
  assert.equal(sameUrl("not a url", "not a url"), true);
  assert.equal(sameUrl("not a url", "other"), false);
});

test("sameOrigin compares protocol + host + port", () => {
  assert.equal(sameOrigin("https://a.example/x", "https://a.example/y?z=1"), true);
  assert.equal(sameOrigin("https://a.example", "http://a.example"), false);
  assert.equal(sameOrigin("https://a.example:8443", "https://a.example"), false);
  assert.equal(sameOrigin("", "https://a.example"), false);
  assert.equal(sameOrigin("file:///a.html", "file:///b.html"), false);
});

test("pinMatchForUrl picks the longest same-origin path prefix, ignoring query and hash", () => {
  const folder = createFolder("支付组");
  folder.children.push(
    { type: "pin", id: "site", url: "https://codeup.aliyun.com/", customName: "Codeup", favIconUrl: "" },
    { type: "pin", id: "proj", url: "https://codeup.aliyun.com/g/devops-nacos-prod", customName: "项目", favIconUrl: "" },
  );
  const roots = [folder];
  assert.equal(pinMatchForUrl(roots, "https://codeup.aliyun.com/g/devops-nacos-prod/change/47/diffs?file=a#x"), "proj");
  assert.equal(pinMatchForUrl(roots, "https://codeup.aliyun.com/g/devops-k8s"), "site");
  assert.equal(pinMatchForUrl(roots, "https://other.example/g/devops-nacos-prod"), "");
  // 前缀必须落在 / 边界上
  assert.equal(pinMatchForUrl([{ type: "pin", id: "p", url: "https://a.example/foo" }], "https://a.example/foobar"), "");
  assert.equal(pinIdByUrl(roots, "https://codeup.aliyun.com/g/devops-nacos-prod#x"), "proj");
});

test("resolvePinId prefers exact url, then the tab binding, then the path prefix", () => {
  const roots = [
    { type: "pin", id: "a", url: "https://a.example/one", customName: "A", favIconUrl: "" },
    { type: "pin", id: "b", url: "https://b.example", customName: "B", favIconUrl: "" },
  ];
  assert.equal(resolvePinId(roots, "https://a.example/one#x", null), "a");
  // 页面内跳到更深/带查询串的地址，绑定仍然生效
  assert.equal(
    resolvePinId(roots, "https://a.example/one/change/47?file=x", { pinId: "a", origin: "https://a.example" }),
    "a",
  );
  // 换到别的站点：绑定失效，退化为 URL 前缀匹配
  assert.equal(resolvePinId(roots, "https://b.example/other", { pinId: "a", origin: "https://a.example" }), "b");
  // 固定项已被删除：绑定失效，无匹配
  assert.equal(resolvePinId(roots, "https://a.example/zzz", { pinId: "gone", origin: "https://a.example" }), "");
  assert.equal(resolvePinId(roots, "https://c.example", null), "");
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
  assert.equal(formatRemaining(0), "closing soon");
  assert.equal(formatRemaining(30 * 60000), "30 min");
  assert.equal(formatRemaining(2 * 3600000), "2 h");
  assert.equal(formatRemaining(3 * 86400000), "3 d");
  assert.equal(remainingMs(0, 3600000, 0), null);
});

test("search phrases a visit the way the result row does", () => {
  assert.equal(formatAgo(0), "just now");
  assert.equal(formatAgo(4 * 86400000), "4d ago");
  assert.equal(formatAgo(6 * 86400000), "6d ago");
  assert.equal(formatAgo(7 * 86400000), "1w ago");
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
  assert.equal(describeTabGroupImport(result), "Imported 1 folder and 1 page");
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
  assert.equal(describeTabGroupImport(again), "All pages are already here");
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
  assert.equal(describeTabGroupImport({ groups: 0, folders: 0, pins: 0 }), "No tab groups to import");
});

test("an empty tab group still becomes a folder", () => {
  const state = emptyState();
  const result = importTabGroups(state, [{ title: "", windowId: 1, index: 0, tabs: [] }]);
  assert.equal(result.folders, 1);
  assert.equal(state.roots[0].name, "Untitled group");
  assert.equal(describeTabGroupImport(result), "Imported 1 folder");
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

test("normalizeLoaded 丢弃损坏节点并修复字段类型", () => {
  const loaded = normalizeLoaded({
    rev: 3,
    settings: { tempTtlHours: 6 },
    roots: [
      null,
      { type: "mystery" },
      { type: "pin", id: "no-url" },
      { type: "pin", id: "p2", url: "https://a.example", customName: 42, favIconUrl: null },
      { type: "folder", id: "f1", name: "", collapsed: "yes", children: "oops" },
      { type: "folder", id: "", name: "组", children: [{ type: "pin", url: "https://b.example" }] },
    ],
    temps: [
      "junk",
      { id: "t1", tabId: "nope" },
      { id: "t2", tabId: 7, windowId: null, url: 123, openedAt: "x" },
      { id: "t2", tabId: 8 },
    ],
  });
  assert.equal(loaded.rev, 3);
  assert.equal(loaded.settings.tempTtlHours, 6);
  assert.equal(loaded.roots.length, 3);

  const [pin, folder, nested] = loaded.roots;
  assert.equal(pin.type, "pin");
  assert.equal(pin.customName, "");
  assert.equal(pin.favIconUrl, "");
  assert.equal(folder.name, "Folder");
  assert.equal(folder.collapsed, true);
  assert.deepEqual(folder.children, []);
  assert.equal(typeof nested.id, "string");
  assert.equal(nested.children.length, 1);

  // t2 保留（重复 id 去重），junk / 缺 tabId 的记录丢弃
  assert.equal(loaded.temps.length, 1);
  const temp = loaded.temps[0];
  assert.equal(temp.tabId, 7);
  assert.equal(temp.windowId, 0);
  assert.equal(temp.url, "");
  assert.ok(Number.isFinite(temp.openedAt));
});

test("normalizeLoaded 对合法数据无损往返", () => {
  const state = emptyState();
  state.rev = 5;
  state.settings.tempTtlHours = 72;
  const folder = createFolder("组");
  folder.collapsed = true;
  folder.children.push({ type: "pin", id: "p1", url: "https://a.example", customName: "A", favIconUrl: "https://a.example/f.png" });
  state.roots.push(folder);
  state.temps.push(createTemp({ id: 9, windowId: 2, url: "https://t.example", title: "T" }, 1000));
  assert.deepEqual(normalizeLoaded(state), state);
});
