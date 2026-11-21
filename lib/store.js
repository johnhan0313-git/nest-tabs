import { emptyState, normalizeLoaded } from "./model.js";

const KEY = "state";

function sameContent(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function loadState() {
  const data = await chrome.storage.local.get(KEY);
  return normalizeLoaded(data[KEY]);
}

export async function updateState(mutator) {
  return navigator.locks.request("nest-tabs-state", async () => {
    const current = await loadState();
    const draft = structuredClone(current);
    const returned = await mutator(draft);
    if (returned === false) return { ok: false, state: current, changed: false };
    const next = returned && typeof returned === "object" ? returned : draft;
    // 内容没变就不落库：避免 sweep 等周期任务每分钟空写一次 storage 唤醒监听方
    if (sameContent(current, next)) return { ok: true, state: current, changed: false };
    next.rev = (current.rev || 0) + 1;
    await chrome.storage.local.set({ [KEY]: next });
    return { ok: true, state: next, changed: true };
  });
}

export function blankState() {
  return emptyState();
}
