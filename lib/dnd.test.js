import assert from "node:assert/strict";
import test from "node:test";
import { dropModeFor, isSelfDrop } from "./dnd.js";

test("dropModeFor splits before/after by pointer ratio", () => {
  assert.equal(dropModeFor(0.6, "pin", "pin"), "after");
  assert.equal(dropModeFor(1, "pin", "folder"), "after");
  assert.equal(dropModeFor(0.4, "pin", "pin"), "before");
  assert.equal(dropModeFor(0, "folder", "pin"), "before");
  assert.equal(dropModeFor(0.5, "pin", "pin"), "before", "恰好 50% 算 before");
});

test("dropModeFor allows into only in a folder's middle band", () => {
  assert.equal(dropModeFor(0.5, "folder", "pin"), "into");
  assert.equal(dropModeFor(0.3, "folder", "pin"), "into");
  assert.equal(dropModeFor(0.28, "folder", "pin"), "before", "边界 28% 不算 into");
  assert.equal(dropModeFor(0.72, "folder", "pin"), "after", "边界 72% 不算 into");
  assert.equal(dropModeFor(0.5, "pin", "pin"), "before", "pin 永远不能 into");
});

test("dropModeFor temp drag lands as into on folder/pin only", () => {
  assert.equal(dropModeFor(0.1, "folder", "temp"), "into");
  assert.equal(dropModeFor(0.9, "pin", "temp"), "into");
  assert.equal(dropModeFor(0.5, "temp", "temp"), null, "temp 行不可作为落点");
  assert.equal(dropModeFor(0.5, "temp", "pin"), null, "普通拖拽也不落进 temp 行");
});

test("isSelfDrop detects self and descendants", () => {
  const roots = [
    {
      id: "f1", type: "folder", name: "组", children: [
        { id: "p1", type: "pin", url: "https://a.example" },
        { id: "f2", type: "folder", name: "子组", children: [
          { id: "p2", type: "pin", url: "https://b.example" },
        ] },
      ],
    },
    { id: "p3", type: "pin", url: "https://c.example" },
  ];
  assert.equal(isSelfDrop(roots, "f1", "f1"), true, "拖到自己");
  assert.equal(isSelfDrop(roots, "f1", "p1"), true, "拖到直接子节点");
  assert.equal(isSelfDrop(roots, "f1", "p2"), true, "拖到孙节点");
  assert.equal(isSelfDrop(roots, "f1", "p3"), false, "拖到无关节点");
  assert.equal(isSelfDrop(roots, "p3", "p3"), true, "同 id 恒为 true");
  assert.equal(isSelfDrop(roots, "p3", "f1"), false, "pin 没有子孙");
  assert.equal(isSelfDrop(roots, "missing", "f1"), false, "不存在的节点");
});
