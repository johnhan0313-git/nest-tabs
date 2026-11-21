import { loadState, updateState } from "../lib/store.js";
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
export let active = { id: null, url: "" };
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
    ui.fatal = "读不到已保存的标签。";
    console.error(error);
    render();
  }
}

export async function refresh() {
  const [next, open, currentWindow] = await Promise.all([
    loadState(),
    chrome.tabs.query({}),
    chrome.windows.getCurrent(),
  ]);
  state = next;
  tabs = open;
  const current = open.find((tab) => tab.active && tab.windowId === currentWindow.id);
  active = { id: current?.id ?? null, url: current?.url || "" };
  ui.loading = false;
  ui.fatal = "";
  ui.dirty = false;
  render();
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
