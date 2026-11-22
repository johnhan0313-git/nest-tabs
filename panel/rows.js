import {
  TTL_OPTIONS,
  formatRemaining,
  itemName,
  locate,
  remainingMs,
  sameUrl,
  sortedTemps,
} from "../lib/model.js";
import { rowKey, rowKind } from "../lib/rowKey.js";
import { active, busy, refresh, state, tabs, ui } from "./state.js";
import { render } from "./render.js";
import { favicon, folderIcon, hint, hoverAction, nameBlock, reconcile } from "./dom.js";
import { appendOverlays } from "./menu.js";
import { bindFolderPeek, closePeek } from "./peek.js";
import { clearDragMarks, onDragOver, onDrop } from "./dnd.js";
import { finishRename, focusTab, onCloseTemp, onNewTab, openUrl, save, closePinnedTabs } from "./actions.js";

const foldMotions = new WeakMap();
let foldingCount = 0;
let openTimer = 0;

// 行级键控缓存：id -> { key, gen, wrap, el }。
// 每次渲染重新计算 key，只有 key 变化的行才重建 DOM——
// 未变的行保留原元素（含事件监听与 <img>，不再重复请求 favicon）。
const rowCache = new Map();
let rowGen = 0;

export function beginRowRender() {
  rowGen += 1;
}

export function pruneRowCache() {
  for (const [id, entry] of rowCache) {
    if (entry.gen !== rowGen) rowCache.delete(id);
  }
}

function overlayKey(id) {
  // 菜单/确认框挂在行内且跟随坐标定位：坐标变化也要重建这一行
  if (ui.menuId === id) return `:m${ui.menuX},${ui.menuY}`;
  if (ui.confirm?.id === id) return `:c${ui.menuX},${ui.menuY}`;
  return "";
}

/** 从 UI 状态组装 rowKey 的纯函数入参 */
function keyCtx(node) {
  return {
    editingId: ui.editingId,
    draggingId: ui.dragging?.id,
    overlay: overlayKey(node.id),
    active,
    activePinId: active.pinId,
    tabs,
    tempTtlHours: state.settings.tempTtlHours,
    now: Date.now(),
  };
}

export function rowFor(node, depth) {
  const key = rowKey(node, depth, keyCtx(node));
  const hit = rowCache.get(node.id);
  if (hit && hit.key === key) {
    hit.gen = rowGen;
    if (node.type === "folder") syncFolderChildren(hit, node, depth);
    return hit.el;
  }
  const entry = { key, gen: rowGen, wrap: null };
  const kind = rowKind(node);
  entry.el = kind === "folder"
    ? renderFolder(node, depth, entry)
    : kind === "pin"
      ? renderPin(node, depth)
      : renderTemp(node);
  rowCache.set(node.id, entry);
  return entry.el;
}

function syncFolderChildren(entry, folder, depth) {
  // 折叠中的内容不可见：跳过，展开时 collapsed 变化会触发整块重建
  if (folder.collapsed || !entry.wrap) return;
  reconcile(entry.wrap, folder.children.map((child) => rowFor(child, depth + 1)));
}

function renderFolder(folder, depth, entry) {
  const block = document.createElement("div");
  const row = rowShell(folder, "folder", depth);
  if (ui.editingId === folder.id) {
    row.append(renameInput(folder, folder.name));
    appendOverlays(row, folder.id, "folder");
    block.append(row);
    return block;
  }
  const main = mainButton(folder, "folder");
  main.setAttribute("aria-expanded", folder.collapsed ? "false" : "true");
  main.append(folderIcon(!folder.collapsed), nameBlock(folder.name));
  const fold = document.createElement("div");
  fold.className = folder.collapsed ? "fold closed" : "fold";
  const clip = document.createElement("div");
  clip.className = "fold-clip";
  if (folder.collapsed) clip.inert = true;
  const wrap = document.createElement("div");
  clip.append(wrap);
  fold.append(clip);
  reconcile(wrap, folder.children.map((child) => rowFor(child, depth + 1)));
  entry.wrap = wrap;
  bindActivate(main, folder, () => {
    closePeek();
    const closing = !folder.collapsed;
    folder.collapsed = closing;
    main.setAttribute("aria-expanded", closing ? "false" : "true");
    const icon = main.querySelector(".folder");
    if (icon) icon.replaceWith(folderIcon(!closing));
    if (!closing) clip.inert = false;
    slideFold(fold, clip, closing);
    void save((draft) => {
      const located = locate(draft.roots, folder.id);
      if (!located || located.node.type !== "folder") return false;
      located.node.collapsed = closing;
      return draft;
    }, undefined, { paint: false }).then((ok) => {
      if (ok) return;
      folder.collapsed = !closing;
      main.setAttribute("aria-expanded", closing ? "true" : "false");
      const nextIcon = main.querySelector(".folder");
      if (nextIcon) nextIcon.replaceWith(folderIcon(closing));
      slideFold(fold, clip, !closing);
    });
  }, false);
  row.append(main);
  bindFolderPeek(row, folder);
  appendOverlays(row, folder.id, "folder");
  block.append(row, fold);
  return block;
}

function renderPin(pin, depth) {
  const row = rowShell(pin, "pin", depth);
  const current = active.pinId === pin.id;
  if (current) row.classList.add("is-active");
  if (ui.editingId === pin.id) {
    row.append(renameInput(pin, itemName(pin)));
  } else {
    const main = mainButton(pin, "pin");
    main.append(favicon(pin.url, pin.favIconUrl), nameBlock(itemName(pin)));
    bindActivate(main, pin, () => void openUrl(pin.url, pin.id));
    const live = tabs.some((tab) => sameUrl(tab.url, pin.url));
    row.append(main, hoverAction(
      live ? "关闭并保持固定" : "移除",
      live ? "minus" : "x",
      (event) => {
        if (live) {
          void closePinnedTabs(pin);
          return;
        }
        ui.menuId = null;
        ui.menuX = event.clientX;
        ui.menuY = event.clientY;
        ui.confirm = { id: pin.id, action: "remove-pin" };
        render();
      },
    ));
  }
  appendOverlays(row, pin.id, "pin");
  return row;
}

function renderTemp(temp) {
  const row = rowShell(temp, "temp", 0);
  const current = temp.tabId === active.id;
  if (current) row.classList.add("is-active");
  if (ui.editingId === temp.id) {
    row.append(renameInput(temp, itemName(temp)));
  } else {
    const main = mainButton(temp, "temp");
    main.append(favicon(temp.url, temp.favIconUrl), nameBlock(itemName(temp)));
    bindActivate(main, temp, () => void focusTab(temp.tabId, temp.url));
    const remain = remainingMs(temp.openedAt, Date.now(), state.settings.tempTtlHours);
    const closeTitle = remain == null ? "关闭" : `关闭（${formatRemaining(remain)}）`;
    row.append(main, hoverAction(closeTitle, "x", () => void onCloseTemp(temp.id)));
  }
  appendOverlays(row, temp.id, "temp");
  return row;
}

// 临时区整节持久化：head / 提示 / 新标签按钮只建一次，行按键复用。
let tempsSection = null;
let tempsHead = null;
let ttlSelect = null;
let tempsHint = null;
let newtabButton = null;

export function renderTemps() {
  if (!tempsSection) {
    tempsSection = document.createElement("section");
    tempsSection.className = "temps";
    tempsSection.setAttribute("aria-label", "临时");
    tempsHead = document.createElement("div");
    tempsHead.className = "section-head";
    const title = document.createElement("h2");
    title.textContent = "临时";
    ttlSelect = renderTtl();
    tempsHead.append(title, ttlSelect);
    tempsHint = hint("新网页会出现在这里。");
    newtabButton = renderNewTab();
  }
  const ttl = state.settings.tempTtlHours;
  if (document.activeElement !== ttlSelect && ttlSelect.value !== String(ttl)) ttlSelect.value = String(ttl);

  const temps = sortedTemps(state.temps);
  const items = [tempsHead];
  for (const temp of temps) items.push(rowFor(temp, 0));
  if (!temps.length) items.push(tempsHint);
  items.push(newtabButton);
  reconcile(tempsSection, items);
  return tempsSection;
}

function renderTtl() {
  const select = document.createElement("select");
  select.className = "ttl";
  select.setAttribute("aria-label", "临时标签关闭时间");
  for (const option of TTL_OPTIONS) {
    const node = document.createElement("option");
    node.value = String(option.hours);
    node.textContent = option.label;
    node.selected = option.hours === state.settings.tempTtlHours;
    select.append(node);
  }
  select.addEventListener("change", () => {
    const hours = Number(select.value);
    const label = TTL_OPTIONS.find((item) => item.hours === hours)?.label || "24 小时";
    void save((draft) => {
      draft.settings.tempTtlHours = hours;
      return draft;
    }, hours ? `已设为 ${label}` : "临时标签不再自动关闭");
  });
  return select;
}

function renderNewTab() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "newtab";
  const plus = document.createElement("span");
  plus.className = "plus";
  plus.textContent = "+";
  const label = document.createElement("span");
  label.textContent = "新标签";
  button.append(plus, label);
  button.addEventListener("click", () => void onNewTab());
  return button;
}

function slideFold(fold, clip, closing) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fromHeight = fold.getBoundingClientRect().height;
  const fromOpacity = Number.parseFloat(getComputedStyle(fold).opacity);
  const previous = foldMotions.get(fold);
  if (previous && !previous.settled) {
    previous.settled = true;
    clearTimeout(previous.timer);
    if (previous.animation) {
      previous.animation.onfinish = null;
      previous.animation.cancel();
    }
    if (previous.counted) foldingCount = Math.max(0, foldingCount - 1);
  }

  const motion = { settled: false, animation: null, timer: 0, counted: false };
  foldMotions.set(fold, motion);
  const finish = () => {
    if (motion.settled || foldMotions.get(fold) !== motion) return;
    motion.settled = true;
    clearTimeout(motion.timer);
    if (motion.animation) {
      motion.animation.onfinish = null;
      motion.animation.cancel();
    }
    fold.style.transition = "";
    fold.style.height = "";
    fold.style.opacity = "";
    fold.style.overflow = "";
    fold.classList.toggle("closed", closing);
    clip.inert = closing;
    if (motion.counted) foldingCount = Math.max(0, foldingCount - 1);
    if (foldingCount === 0) {
      ui.foldingUntil = 0;
      if (ui.dirty && !busy()) void refresh();
    }
  };
  fold.classList.remove("closed");
  const full = clip.scrollHeight;
  if (reduce || !full) {
    finish();
    return;
  }
  motion.counted = true;
  foldingCount += 1;
  ui.foldingUntil = Date.now() + 280;
  if (!closing) clip.inert = false;
  fold.style.overflow = "hidden";
  const animation = fold.animate(
    [
      { height: `${fromHeight}px`, opacity: Number.isFinite(fromOpacity) ? fromOpacity : 1 },
      { height: `${closing ? 0 : full}px`, opacity: closing ? 0 : 1 },
    ],
    { duration: 200, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
  );
  motion.animation = animation;
  animation.onfinish = finish;
  motion.timer = window.setTimeout(finish, 260);
}

function rowShell(item, kind, depth) {
  const row = document.createElement("div");
  row.className = "row";
  row.dataset.id = item.id;
  row.dataset.kind = kind;
  row.style.paddingLeft = `${depth * 18}px`;
  if (ui.dragging?.id === item.id) row.classList.add("dragging");
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    closePeek();
    ui.menuId = item.id;
    ui.menuX = event.clientX;
    ui.menuY = event.clientY;
    ui.confirm = null;
    render();
  });
  row.addEventListener("dragover", (event) => onDragOver(event, row));
  row.addEventListener("dragleave", () => {
    row.classList.remove("drop-into", "drop-before", "drop-after");
  });
  row.addEventListener("drop", (event) => {
    event.stopPropagation();
    void onDrop(event, item.id);
  });
  return row;
}

function bindActivate(main, item, action, rename = true) {
  main.addEventListener("click", (event) => {
    if (!rename) {
      action();
      return;
    }
    if (event.detail > 1) return;
    clearTimeout(openTimer);
    openTimer = setTimeout(action, 220);
  });
  if (!rename) return;
  main.addEventListener("dblclick", (event) => {
    event.preventDefault();
    clearTimeout(openTimer);
    ui.menuId = null;
    ui.confirm = null;
    ui.editingId = item.id;
    render();
  });
}

function mainButton(item, kind) {
  const main = document.createElement("button");
  main.type = "button";
  main.className = "main";
  main.draggable = true;
  main.addEventListener("dragstart", (event) => {
    clearTimeout(openTimer);
    closePeek();
    ui.dragging = { kind, id: item.id };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    main.closest(".row")?.classList.add("dragging");
  });
  main.addEventListener("dragend", () => {
    ui.dragging = null;
    // 行不再整树重建：拖拽标记（dragging/drop-*）由命令式添加，需显式清理
    clearDragMarks();
    if (ui.dirty) void refresh();
    else render();
  });
  return main;
}

function renameInput(item, name) {
  const input = document.createElement("input");
  input.className = "rename";
  input.value = name;
  input.dataset.original = name;
  input.setAttribute("aria-label", "名称");
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      ui.editingId = null;
      render();
    }
  });
  input.addEventListener("blur", () => void finishRename(item.id, input.value, name));
  return input;
}
