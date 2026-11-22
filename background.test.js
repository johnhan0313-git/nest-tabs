import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUrl } from "./lib/model.js";

Object.defineProperty(globalThis.navigator, "locks", {
  value: { request: (_name, fn) => fn() },
  configurable: true,
});

/**
 * background.js 顶层初始化冒烟测试：安装 chrome mock 后动态导入，
 * 捕获 console.error——初始化时序错误（如 TDZ）、监听注册失败、
 * storage.session 会话态恢复失败都会在这里暴露。
 */
function installChromeMock({ tabs = [], state = null } = {}) {
  const session = {
    data: {},
    async get(key) { return { [key]: session.data[key] }; },
    async set(obj) { Object.assign(session.data, obj); },
  };
  const local = {
    data: { state },
    async get(key) { return { [key]: local.data[key] }; },
    async set(obj) { Object.assign(local.data, obj); },
  };
  const recorder = () => {
    const fns = [];
    return { addListener(fn) { fns.push(fn); }, fns };
  };
  const updated = [];
  const created = [];
  const mock = {
    session,
    updated,
    created,
    storage: { session, local, onChanged: recorder() },
    sidePanel: { async setPanelBehavior() {} },
    alarms: { async create() {}, onAlarm: recorder() },
    tabs: {
      async query(query = {}) {
        let list = tabs.slice();
        if (query.active) list = list.filter((tab) => tab.active);
        if (query.currentWindow || query.lastFocusedWindow) list = list.filter((tab) => tab.windowId === 1);
        return structuredClone(list);
      },
      async update(id, props) {
        updated.push({ id, props });
        for (const tab of tabs) {
          if (tab.id === id && props.url) tab.url = props.url;
          if (props.active) tab.active = tab.id === id;
        }
        return { id };
      },
      async create({ url }) {
        created.push(url);
        return { id: 9, windowId: 1, url };
      },
      async remove() {},
      onCreated: recorder(),
      onRemoved: recorder(),
      onReplaced: recorder(),
      onUpdated: recorder(),
    },
    windows: {
      async getCurrent() { return { id: 1 }; },
      async update() {},
    },
    runtime: {
      onInstalled: recorder(),
      onStartup: recorder(),
      onMessage: recorder(),
    },
  };
  return mock;
}

function sendFocusOrOpen(listener, message) {
  return new Promise((resolve) => listener(message, {}, resolve));
}

let onMessage = null;

test("background.js 初始化无错误，且会话态恢复/回写生效", async () => {
  const mock = installChromeMock();
  const liveUrl = normalizeUrl("https://live.example");
  const goneUrl = normalizeUrl("https://gone.example");
  mock.session.data.swMem = {
    ownTabIds: [7],
    pendingUrls: { [liveUrl]: Date.now() + 60000, [goneUrl]: Date.now() - 1000 },
    tabPins: { 7: { pinId: "p7", origin: "https://a.example" } },
  };
  globalThis.chrome = mock;

  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  try {
    await import("./background.js");
    await new Promise((resolve) => setTimeout(resolve, 20)); // 等异步的 restoreSwMem

    // 恢复效果：ownTabIds 里有 7 → onUpdated 提前返回，不该走到 storage 写路径
    for (const fn of mock.tabs.onUpdated.fns) {
      fn(7, { title: "x" }, { id: 7, url: "https://a.example", windowId: 1 });
    }
    // 恢复效果：pendingUrls 里有 liveUrl → 命中抑制并回写；过期的 goneUrl 应被剪掉
    for (const fn of mock.tabs.onUpdated.fns) {
      fn(999, { title: "x" }, { id: 999, url: "https://live.example", windowId: 1 });
    }
    await new Promise((resolve) => setTimeout(resolve, 150)); // 等 persistSwMem 的合并写

    assert.deepEqual(errors, [], "初始化与恢复期间不应有 console.error");
    assert.deepEqual([...mock.session.data.swMem.ownTabIds].sort((a, b) => a - b), [7, 999]);
    assert.ok(mock.session.data.swMem.pendingUrls[liveUrl], "未过期的 pendingUrl 保留");
    assert.ok(!(goneUrl in mock.session.data.swMem.pendingUrls), "过期的 pendingUrl 被清理");
    assert.deepEqual(mock.session.data.swMem.tabPins[7], { pinId: "p7", origin: "https://a.example" }, "绑定关系被恢复");

    // 同一模块实例，复用这里注册的 onMessage 监听
    onMessage = mock.runtime.onMessage.fns[0];
  } finally {
    console.error = original;
    delete globalThis.chrome;
  }
});

test("点击固定项：已有相同地址的标签页时聚焦它并记录绑定", async () => {
  const mock = installChromeMock({
    tabs: [
      { id: 7, windowId: 1, url: "https://codeup.example/proj", active: true },
      { id: 8, windowId: 1, url: "https://other.example", active: false },
    ],
  });
  globalThis.chrome = mock;
  try {
    const response = await sendFocusOrOpen(onMessage, {
      type: "focus-or-open",
      url: "https://codeup.example/proj#tab=readme",
      pinId: "pin-proj",
    });
    assert.deepEqual(response, { ok: true });
    assert.deepEqual(mock.updated, [{ id: 7, props: { active: true } }]);
    assert.deepEqual(mock.created, []);
    assert.deepEqual(mock.session.data.swMem.tabPins[7], { pinId: "pin-proj", origin: "https://codeup.example" });
  } finally {
    delete globalThis.chrome;
  }
});

test("点击固定项：当前标签页同源时就地跳转，不再新开标签", async () => {
  const mock = installChromeMock({
    tabs: [
      { id: 5, windowId: 1, url: "https://codeup.example/proj-a/change/47", active: true },
      { id: 6, windowId: 1, url: "https://other.example", active: false },
    ],
  });
  globalThis.chrome = mock;
  try {
    const response = await sendFocusOrOpen(onMessage, {
      type: "focus-or-open",
      url: "https://codeup.example/proj-b",
      pinId: "pin-b",
    });
    assert.deepEqual(response, { ok: true });
    assert.deepEqual(mock.updated, [{ id: 5, props: { url: "https://codeup.example/proj-b", active: true } }]);
    assert.deepEqual(mock.created, [], "同站点不新开标签");
    assert.deepEqual(mock.session.data.swMem.tabPins[5], { pinId: "pin-b", origin: "https://codeup.example" });
  } finally {
    delete globalThis.chrome;
  }
});

test("点击固定项：当前标签页不同源时新开标签", async () => {
  const mock = installChromeMock({
    tabs: [{ id: 5, windowId: 1, url: "https://other.example", active: true }],
  });
  globalThis.chrome = mock;
  try {
    const response = await sendFocusOrOpen(onMessage, {
      type: "focus-or-open",
      url: "https://codeup.example/proj-b",
      pinId: "pin-b",
    });
    assert.deepEqual(response, { ok: true });
    assert.deepEqual(mock.updated, []);
    assert.deepEqual(mock.created, ["https://codeup.example/proj-b"]);
    assert.deepEqual(mock.session.data.swMem.tabPins[9], { pinId: "pin-b", origin: "https://codeup.example" });
  } finally {
    delete globalThis.chrome;
  }
});
