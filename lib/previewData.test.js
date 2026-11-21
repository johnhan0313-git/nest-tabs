import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewData } from "./previewData.js";
import { normalizeLoaded } from "./model.js";

function walk(nodes, depth, visits) {
  for (const node of nodes) {
    if (node.type === "folder") {
      assert.equal(typeof node.name, "string");
      assert.equal(typeof node.collapsed, "boolean");
      assert.ok(Array.isArray(node.children));
      visits.folders.push({ depth });
      walk(node.children, depth + 1, visits);
    } else if (node.type === "pin") {
      assert.equal(typeof node.url, "string");
      assert.ok(node.url.startsWith("http"));
      assert.equal(typeof node.customName, "string");
      visits.pins.push(node);
    } else {
      assert.fail(`unknown node type: ${node.type}`);
    }
  }
}

test("预览数据可被真实加载器读取且不丢结构", () => {
  const { state } = createPreviewData();
  const loaded = normalizeLoaded(state);
  assert.equal(loaded.settings.tempTtlHours, 24);
  assert.deepEqual(loaded, state);
});

test("预览树符合 folder/pin 约定并含嵌套", () => {
  const { state } = createPreviewData();
  const visits = { folders: [], pins: [] };
  walk(state.roots, 0, visits);
  assert.equal(visits.folders.length, 3);
  assert.equal(visits.pins.length, 4);
  assert.ok(visits.folders.some((item) => item.depth >= 1), "预览应展示嵌套文件夹");
});

test("预览临时标签绑定到存在的标签页", () => {
  const { state, tabs } = createPreviewData();
  assert.equal(state.temps.length, 2);
  for (const temp of state.temps) {
    assert.ok(Number.isInteger(temp.tabId));
    assert.ok(Number.isFinite(temp.openedAt));
    assert.ok(tabs.some((tab) => tab.id === temp.tabId));
  }
});

test("空态预览不含任何数据", () => {
  const { state, tabs, groups } = createPreviewData({ empty: true });
  assert.equal(state.roots.length, 0);
  assert.equal(state.temps.length, 0);
  assert.equal(tabs.length, 0);
  assert.equal(groups.length, 0);
  assert.equal(normalizeLoaded(state).settings.tempTtlHours, 24);
});
