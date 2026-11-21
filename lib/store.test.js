import assert from "node:assert/strict";
import test from "node:test";
import { createFolder } from "./model.js";

const writes = [];
const store = {};

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return { [key]: store[key] };
      },
      async set(obj) {
        writes.push(structuredClone(obj));
        Object.assign(store, obj);
      },
    },
  },
};
Object.defineProperty(globalThis.navigator, "locks", {
  value: { request: (_name, fn) => fn() },
  configurable: true,
});

const { updateState } = await import("./store.js");

test("内容变化时写 storage 并递增 rev", async () => {
  const first = await updateState((draft) => {
    draft.settings.tempTtlHours = 6;
    return draft;
  });
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(first.state.rev, 1);
  assert.equal(writes.length, 1);

  const withFolder = await updateState((draft) => {
    draft.roots.push(createFolder("组"));
    return draft;
  });
  assert.equal(withFolder.changed, true);
  assert.equal(withFolder.state.rev, 2);
  assert.equal(writes.length, 2);
});

test("内容不变或返回 false 时不写 storage", async () => {
  const revBefore = store.state.rev;
  const countBefore = writes.length;

  // 重新克隆、重新赋同样的值：内容等价，应跳过写入
  const same = await updateState((draft) => {
    draft.settings.tempTtlHours = 6;
    return draft;
  });
  assert.equal(same.ok, true);
  assert.equal(same.changed, false);
  assert.equal(same.state.rev, revBefore);
  assert.equal(writes.length, countBefore);

  // 空 mutator（什么都不改）同样不写
  const noop = await updateState((draft) => draft);
  assert.equal(noop.changed, false);
  assert.equal(writes.length, countBefore);

  // 返回 false 表示中止
  const aborted = await updateState(() => false);
  assert.equal(aborted.ok, false);
  assert.equal(aborted.changed, false);
  assert.equal(writes.length, countBefore);
});
