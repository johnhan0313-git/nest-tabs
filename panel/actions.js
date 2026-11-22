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
    fail("没保存上。再点一次。");
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
    if (!ok && value.trim()) fail("没保存上。再点一次。");
    else render();
  } catch (error) {
    console.error(error);
    fail("没保存上。再点一次。");
  }
  if (ui.dirty) await refresh();
}

export async function onCreateFolder(parentId) {
  let createdId = "";
  const ok = await save((draft) => {
    const folder = createFolder("文件夹");
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
    fail("这个页面还没有网址，先等它打开。");
    return false;
  }
  return save((draft) => {
    if (parentId) {
      const parent = locate(draft.roots, parentId);
      if (parent?.node?.type === "folder") parent.node.collapsed = false;
    }
    const pin = pinTemp(draft, tempId, parentId, index);
    return pin ? draft : false;
  }, folderName ? `已固定到「${folderName}」` : "已固定");
}

export async function onCloseTemp(id) {
  const temp = state.temps.find((item) => item.id === id);
  ui.menuId = null;
  if (!temp) return;
  const ok = await save((draft) => {
    draft.temps = draft.temps.filter((item) => item.id !== id);
    return draft;
  }, "已关闭");
  if (ok && Number.isInteger(temp.tabId)) await chrome.tabs.remove(temp.tabId).catch(() => {});
}

export async function onRemovePin(id) {
  await save((draft) => {
    const removed = removePin(draft.roots, id);
    if (!removed) return false;
    adoptOpenTabs(draft, removed.url, tabs, Date.now());
    return draft;
  }, "已移除");
}

export async function onDeleteFolder(id) {
  await save((draft) => (deleteFolder(draft.roots, id) ? draft : false), "已删除");
}

export async function openUrl(url, pinId = "") {
  try {
    if (chrome.runtime?.id) {
      const response = await chrome.runtime.sendMessage({ type: "focus-or-open", url, pinId });
      if (!response?.ok) throw new Error(response?.error || "打不开");
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
    fail("打不开这个网址。");
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
    fail("这个标签已经关掉了。");
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
    fail("这个标签已经关掉了。");
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
    fail("这个页面还没有网址。");
    return;
  }
  try {
    await writeClipboard(page.url);
    flash("已复制链接");
  } catch (error) {
    console.error(error);
    fail("没复制上。再点一次。");
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
    fail("这个页面还没有网址。");
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
    fail("没复制出新标签。");
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
      flash("没有可导入的标签组");
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
    fail("读不到标签组。再点一次。");
  } finally {
    ui.importing = false;
  }
}

export async function onNewTab() {
  try {
    await chrome.tabs.create({ active: true });
  } catch (error) {
    console.error(error);
    fail("新标签页没打开。");
  }
}
