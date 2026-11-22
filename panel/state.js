import { loadState, updateState } from "../lib/store.js";
import { resolvePinId } from "../lib/model.js";
import { COPY } from "../lib/copy.js";
import { render } from "./render.js";

export const app = document.querySelector("#app");

export const ui = {
  loading: true,
  fatal: "",
  error: "",
  status: "",
  statusTimer: 0,
  menuId: null,
  menuX: 0,
  menuY: 0,
  editingId: null,
  confirm: null,
  dirty: false,
  dragging: null,
  query: "",
  results: [],
  searchIndex: 0,
  searchToken: 0,
  peekId: null,
  peekQuery: "",
  peekTimes: {},
  peekToken: 0,
  peekTimer: 0,
  peekHideTimer: 0,
  foldingUntil: 0,
  importing: false,
};

export let state = null;
export let tabs = [];
export let active = { id: null, url: "", pinId: "" };
let refreshTimer = 0;

export function setTabs(next) {
  tabs = next;
}

export function setActive(next) {
  active = next;
}

export function busy() {
  const typing = document.activeElement?.classList?.contains("find") || document.activeElement?.classList?.contains("peek-find");
  return Boolean(ui.editingId || ui.confirm || ui.menuId || ui.dragging || typing);
}

export function scheduleRefresh() {
  if (busy() || Date.now() < ui.foldingUntil) {
    ui.dirty = true;
    return;
  }
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refresh(), 80);
}

export async function boot() {
  try {
    await refresh();
  } catch (error) {
    ui.loading = false;
    ui.fatal = COPY.app.loadError;
    console.error(error);
    render();
  }
}

export async function refresh() {
  const [next, open, currentWindow, bindings] = await Promise.all([
    loadState(),
    chrome.tabs.query({}),
    chrome.windows.getCurrent(),
    readTabBindings(),
  ]);
  state = next;
  tabs = open;
  const current = open.find((tab) => tab.active && tab.windowId === currentWindow.id);
  const url = current?.url || "";
  active = {
    id: current?.id ?? null,
    url,
    pinId: resolvePinId(next.roots, url, current ? bindings[current.id] : null),
  };
  ui.loading = false;
  ui.fatal = "";
  ui.dirty = false;
  render();
}

/**
 * 后台把「由哪个固定项打开的标签」记在 storage.session 里。
 * 读不到（旧版本/预览页）时返回空表，高亮退化为 URL 匹配。
 */
async function readTabBindings() {
  try {
    const data = await chrome.storage.session?.get?.("swMem");
    return data?.swMem?.tabPins || {};
  } catch (error) {
    console.error(error);
    return {};
  }
}

export function flash(text) {
  ui.status = text;
  ui.error = "";
  clearTimeout(ui.statusTimer);
  ui.statusTimer = setTimeout(() => {
    ui.status = "";
    if (!busy()) render();
  }, 2200);
  render();
}

export function fail(text) {
  ui.error = text;
  ui.status = "";
  render();
}

export async function commit(mutator) {
  const result = await updateState(mutator);
  state = result.state;
  ui.dirty = false;
  return result.ok;
}
