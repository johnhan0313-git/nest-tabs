import { emptyState, normalizeLoaded } from "./model.js";

const KEY = "state";

export async function loadState() {
  const data = await chrome.storage.local.get(KEY);
  return normalizeLoaded(data[KEY]);
}

export async function updateState(mutator) {
  return navigator.locks.request("nest-tabs-state", async () => {
    const current = await loadState();
    const draft = structuredClone(current);
    const returned = await mutator(draft);
    if (returned === false) return { ok: false, state: current };
    const next = returned && typeof returned === "object" ? returned : draft;
    next.rev = (current.rev || 0) + 1;
    await chrome.storage.local.set({ [KEY]: next });
    return { ok: true, state: next };
  });
}

export function blankState() {
  return emptyState();
}
