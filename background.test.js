import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUrl } from "./lib/model.js";

/**
 * background.js 顶层初始化冒烟测试：安装 chrome mock 后动态导入，
 * 捕获 console.error——初始化时序错误（如 TDZ）、监听注册失败、
 * storage.session 会话态恢复失败都会在这里暴露。
 */
function installChromeMock() {
  const session = {
    data: {},
    async get(key) { return { [key]: session.data[key] }; },
    async set(obj) { Object.assign(session.data, obj); },
  };
  const recorder = () => {
    const fns = [];
    return { addListener(fn) { fns.push(fn); }, fns };
  };
  return {
    session,
    storage: { session, local: recorder(), onChanged: recorder() },
    sidePanel: { async setPanelBehavior() {} },
    alarms: { async create() {}, onAlarm: recorder() },
    tabs: {
      async query() { return []; },
      onCreated: recorder(),
      onRemoved: recorder(),
      onReplaced: recorder(),
      onUpdated: recorder(),
    },
    runtime: { onInstalled: recorder(), onStartup: recorder(), onMessage: recorder() },
  };
}

test("background.js 初始化无错误，且会话态恢复/回写生效", async () => {
  const mock = installChromeMock();
  const liveUrl = normalizeUrl("https://live.example");
  const goneUrl = normalizeUrl("https://gone.example");
  mock.session.data.swMem = {
    ownTabIds: [7],
    pendingUrls: { [liveUrl]: Date.now() + 60000, [goneUrl]: Date.now() - 1000 },
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
  } finally {
    console.error = original;
    delete globalThis.chrome;
  }
});
