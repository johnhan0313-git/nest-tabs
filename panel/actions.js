import { COPY } from "../lib/copy.js";
import {
  adoptOpenTabs,
  collectTabGroups,
  createFolder,
  deleteFolder,
  describeTabGroupImport,
  importTabGroups,
  locate,
  pinTemp,
  removePin,
  renameItem,
  sameUrl,
} from "../lib/model.js";
import { active, app, commit, fail, flash, refresh, setActive, setTabs, state, tabs, ui } from "./state.js";
import { render } from "./render.js";

export async function save(mutator, success, options = {}) {
  try {
    const ok = await commit(mutator);
    if (!ok) {
      render();
      return false;
    }
    if (success) flash(success);
    else if (options.paint !== false) render();
    return true;
  } catch (error) {
    console.error(error);
    fail(COPY.status.saveFailed);
    return false;
  }
}

export async function finishRename(id, value, previous) {
  if (ui.editingId !== id) return;
  ui.editingId = null;
  if (value.trim() === previous.trim()) {
    if (ui.dirty) await refresh();
    else render();
    return;
  }
  try {
    const ok = await commit((draft) => (renameItem(draft, id, value) ? draft : false));
    if (!ok && value.trim()) fail(COPY.status.saveFailed);
    else render();
  } catch (error) {
    console.error(error);
    fail(COPY.status.saveFailed);
  }
  if (ui.dirty) await refresh();
}

export async function onCreateFolder(parentId) {
  let createdId = "";
  const ok = await save((draft) => {
    const folder = createFolder(COPY.fallback.folderName);
    createdId = folder.id;
    if (!parentId) {
      draft.roots.push(folder);
      return draft;
    }
    const parent = locate(draft.roots, parentId);
    if (!parent || parent.node.type !== "folder") return false;
    parent.node.collapsed = false;
    parent.node.children.push(folder);
    return draft;
  });
  if (!ok) return;
  ui.menuId = null;
  ui.editingId = createdId;
  render();
}

export async function pinAt(tempId, parentId, index, folderName) {
  const temp = state.temps.find((item) => item.id === tempId);
  if (!temp?.url) {
    fail(COPY.status.noUrlYet);
    return false;
  }
  return save((draft) => {
    if (parentId) {
      const parent = locate(draft.roots, parentId);
      if (parent?.node?.type === "folder") parent.node.collapsed = false;
    }
    const pin = pinTemp(draft, tempId, parentId, index);
    return pin ? draft : false;
  }, folderName ? COPY.status.pinSavedTo(folderName) : COPY.status.pinned);
}

export async function onCloseTemp(id) {
  const temp = state.temps.find((item) => item.id === id);
  ui.menuId = null;
  if (!temp) return;
  const ok = await save((draft) => {
    draft.temps = draft.temps.filter((item) => item.id !== id);
    return draft;
  }, COPY.status.closed);
  if (ok && Number.isInteger(temp.tabId)) await chrome.tabs.remove(temp.tabId).catch(() => {});
}

export async function onRemovePin(id) {
  await save((draft) => {
    const removed = removePin(draft.roots, id);
    if (!removed) return false;
    adoptOpenTabs(draft, removed.url, tabs, Date.now());
    return draft;
  }, COPY.status.removed);
}

export async function onDeleteFolder(id) {
  await save((draft) => (deleteFolder(draft.roots, id) ? draft : false), COPY.status.deleted);
}

export async function openUrl(url, pinId = "") {
  try {
    if (chrome.runtime?.id) {
      const response = await chrome.runtime.sendMessage({ type: "focus-or-open", url, pinId });
      if (!response?.ok) throw new Error(response?.error || COPY.status.openFailed);
      await refresh();
      return;
    }
    const match = tabs.find((tab) => sameUrl(tab.url, url));
    if (match) {
      await chrome.tabs.update(match.id, { active: true });
      await chrome.windows.update(match.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url, active: true });
    }
  } catch (error) {
    console.error(error);
    fail(COPY.status.openFailed);
  }
}

export async function focusTab(tabId, url) {
  const match = tabs.find((tab) => tab.id === tabId);
  if (!match) {
    await openUrl(url);
    return;
  }
  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(match.windowId, { focused: true });
  } catch (error) {
    console.error(error);
    fail(COPY.status.tabAlreadyClosed);
    await refresh();
  }
}

export async function closePinnedTabs(pin) {
  const ids = tabs.filter((tab) => sameUrl(tab.url, pin.url)).map((tab) => tab.id);
  if (!ids.length) {
    render();
    return;
  }
  try {
    await chrome.tabs.remove(ids);
  } catch (error) {
    console.error(error);
    fail(COPY.status.tabAlreadyClosed);
    return;
  }
  setTabs(tabs.filter((tab) => !ids.includes(tab.id)));
  if (ids.includes(active.id)) setActive({ id: null, url: "", pinId: "" });
  render();
}

export function pageOf(id, kind) {
  if (kind === "pin") {
    const located = locate(state.roots, id);
    return located?.node?.type === "pin" ? located.node : null;
  }
  return state.temps.find((item) => item.id === id) || null;
}

export async function onCopyLink(id, kind) {
  const page = pageOf(id, kind);
  ui.menuId = null;
  if (!page?.url) {
    fail(COPY.status.noUrlYet);
    return;
  }
  try {
    await writeClipboard(page.url);
    flash(COPY.status.copiedLink);
  } catch (error) {
    console.error(error);
    fail(COPY.status.copyFailed);
  }
}

export async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("copy failed");
  }
}

export async function onDuplicate(id, kind) {
  const page = pageOf(id, kind);
  ui.menuId = null;
  render();
  if (!page?.url) {
    fail(COPY.status.noUrlYet);
    return;
  }
  const open = Number.isInteger(page.tabId)
    ? tabs.find((tab) => tab.id === page.tabId)
    : tabs.find((tab) => sameUrl(tab.url, page.url));
  try {
    if (open && chrome.tabs.duplicate) await chrome.tabs.duplicate(open.id);
    else await chrome.tabs.create({ url: page.url, active: true });
  } catch (error) {
    console.error(error);
    fail(COPY.status.duplicateFailed);
  }
}

export async function onImportTabGroups() {
  if (ui.importing) return;
  ui.importing = true;
  try {
    const [groups, openTabs] = await Promise.all([
      chrome.tabGroups.query({}),
      chrome.tabs.query({}),
    ]);
    const collected = collectTabGroups(groups, openTabs);
    if (!collected.length) {
      flash(COPY.status.noTabGroups);
      return;
    }
    let result = null;
    const ok = await save((draft) => {
      result = importTabGroups(draft, collected);
      return result.changed ? draft : false;
    });
    if (result && (ok || !result.changed)) {
      flash(describeTabGroupImport(result));
      if (result.focusId) {
        app.querySelector(`.row[data-id="${CSS.escape(result.focusId)}"]`)?.scrollIntoView({ block: "nearest" });
      }
    }
  } catch (error) {
    console.error(error);
    fail(COPY.status.readTabGroupsFailed);
  } finally {
    ui.importing = false;
  }
}

export async function onNewTab() {
  try {
    await chrome.tabs.create({ active: true });
  } catch (error) {
    console.error(error);
    fail(COPY.status.newTabFailed);
  }
}

export async function onClearTemps() {
  const ids = state.temps.map((temp) => temp.tabId).filter(Number.isInteger);
  const ok = await save((draft) => {
    draft.temps = [];
    return draft;
  }, COPY.status.cleared);
  if (ok && ids.length) {
    await chrome.tabs.remove(ids).catch(() => {});
  }
}
