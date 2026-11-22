import assert from "node:assert/strict";
import test from "node:test";
import { rowKey, rowKind } from "./rowKey.js";

const NOW = 1800000000000;

function folder(partial = {}) {
  return { id: "f1", type: "folder", name: "组", collapsed: false, children: [], ...partial };
}

function pin(partial = {}) {
  return { id: "p1", type: "pin", url: "https://a.example/path", customName: "A", favIconUrl: "", ...partial };
}

function temp(partial = {}) {
  // 真实 temp 对象没有 type 字段（靠存在于 state.temps 隐式表意）
  return { id: "t1", tabId: 11, url: "https://b.example", liveTitle: "B", customName: "", favIconUrl: "", openedAt: NOW, ...partial };
}

function ctx(partial = {}) {
  return {
    editingId: null,
    draggingId: null,
    overlay: "",
    active: { id: 1, url: "https://current.example" },
    tabs: [{ id: 1, url: "https://current.example" }],
    tempTtlHours: 24,
    now: NOW,
    ...partial,
  };
}

test("rowKind routes folder / pin / typeless temp", () => {
  assert.equal(rowKind(folder()), "folder");
  assert.equal(rowKind(pin()), "pin");
  assert.equal(rowKind(temp()), "temp");
  // 回归：曾按 type === "temp" 判断，typeless temp 全被渲染成 pin
  assert.equal(rowKind({ id: "x", url: "https://a.example" }), "temp");
});

test("keys are stable across identical renders and distinct across kinds", () => {
  const base = ctx();
  assert.equal(rowKey(folder(), 0, base), rowKey(folder(), 0, { ...base }));
  assert.equal(rowKey(temp(), 0, base), rowKey(temp(), 0, { ...base }));
  const sameId = { id: "s" };
  const keys = [
    rowKey({ ...sameId, type: "folder", name: "组", children: [] }, 0, base),
    rowKey({ ...sameId, type: "pin", url: "https://a.example" }, 0, base),
    rowKey({ ...sameId, url: "https://a.example", tabId: 3, openedAt: NOW }, 0, base),
  ];
  assert.equal(new Set(keys).size, 3);
});

test("folder key covers depth / collapsed / name / editing / dragging / overlay", () => {
  const node = folder();
  const base = rowKey(node, 0, ctx());
  assert.notEqual(rowKey(node, 1, ctx()), base, "depth");
  assert.notEqual(rowKey({ ...node, collapsed: true }, 0, ctx()), base, "collapsed");
  assert.notEqual(rowKey({ ...node, name: "改名" }, 0, ctx()), base, "name");
  assert.notEqual(rowKey(node, 0, ctx({ editingId: "f1" })), base, "editing");
  assert.notEqual(rowKey(node, 0, ctx({ draggingId: "f1" })), base, "dragging");
  assert.notEqual(rowKey(node, 0, ctx({ overlay: ":m10,20" })), base, "overlay");
});

test("pin key covers current / live / name / url / icon", () => {
  const node = pin();
  const base = rowKey(node, 0, ctx());
  assert.notEqual(rowKey(node, 0, ctx({ active: { id: 2, url: "https://a.example/path" } })), base, "current");
  assert.notEqual(
    rowKey(node, 0, ctx({ tabs: [{ id: 1, url: "https://current.example" }, { id: 3, url: "https://a.example/path" }] })),
    base,
    "live",
  );
  assert.notEqual(rowKey({ ...node, customName: "改" }, 0, ctx()), base, "name");
  assert.notEqual(rowKey({ ...node, url: "https://a.example/other" }, 0, ctx()), base, "url");
  assert.notEqual(rowKey({ ...node, favIconUrl: "https://a.example/f.png" }, 0, ctx()), base, "icon");
});

test("temp key covers active tab / rebound tabId / countdown text", () => {
  const node = temp();
  const base = rowKey(node, 0, ctx());
  assert.notEqual(rowKey(node, 0, ctx({ active: { id: 11, url: "https://b.example" } })), base, "current");
  assert.notEqual(rowKey({ ...node, tabId: 12 }, 0, ctx()), base, "崩溃重绑定");
  assert.notEqual(rowKey(node, 0, ctx({ now: NOW + 3600000 })), base, "倒计时跨小时");
  // 同一文本内的时间流逝不应触发重建
  assert.equal(rowKey(node, 0, ctx({ now: NOW + 1000 })), base, "秒级流逝");
});

test("temp key ignores countdown when TTL is disabled", () => {
  const node = temp();
  const off = ctx({ tempTtlHours: 0 });
  assert.equal(rowKey(node, 0, off), rowKey(node, 0, ctx({ tempTtlHours: 0, now: NOW + 86400000 })));
});
