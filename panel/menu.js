import { locate } from "../lib/model.js";
import { app, state, ui } from "./state.js";
import { render } from "./render.js";
import { menuDivider, menuItem } from "./dom.js";
import { onCreateFolder, onCloseTemp, onCopyLink, onDeleteFolder, onDuplicate, onRemovePin } from "./actions.js";

export function appendOverlays(row, id, kind) {
  if (ui.menuId === id) row.append(renderMenu(id, kind));
  if (ui.confirm?.id === id) row.append(renderConfirm());
}

export function renderMenu(id, kind) {
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.style.left = `${ui.menuX}px`;
  menu.style.top = `${ui.menuY}px`;
  if (kind === "blank") {
    menu.append(menuItem("新建文件夹", () => {
      ui.menuId = null;
      void onCreateFolder(null);
    }));
  }
  if (kind === "folder") {
    menu.append(menuItem("新建子文件夹", () => {
      ui.menuId = null;
      void onCreateFolder(id);
    }));
    menu.append(menuItem("重命名", () => {
      ui.menuId = null;
      ui.editingId = id;
      render();
    }));
    menu.append(menuDivider());
    menu.append(menuItem("删除", () => {
      ui.menuId = null;
      ui.confirm = { id, action: "delete-folder" };
      render();
    }, true));
  }
  if (kind === "pin" || kind === "temp") appendPageMenu(menu, id, kind);
  return menu;
}

function appendPageMenu(menu, id, kind) {
  menu.append(menuItem("复制链接", () => void onCopyLink(id, kind)));
  menu.append(menuItem("重命名", () => {
    ui.menuId = null;
    ui.editingId = id;
    render();
  }));
  menu.append(menuItem("复制标签页", () => void onDuplicate(id, kind)));
  menu.append(menuDivider());
  if (kind === "pin") {
    menu.append(menuItem("移除", () => {
      ui.menuId = null;
      ui.confirm = { id, action: "remove-pin" };
      render();
    }, true));
    return;
  }
  menu.append(menuItem("关闭", () => void onCloseTemp(id), true));
}

function renderConfirm() {
  const box = document.createElement("div");
  box.className = "confirm";
  box.style.left = `${ui.menuX}px`;
  box.style.top = `${ui.menuY}px`;
  const text = document.createElement("p");
  const folder = ui.confirm.action === "delete-folder" ? locate(state.roots, ui.confirm.id)?.node : null;
  text.textContent = folder
    ? (folder.children.length ? "里面的内容会移到上一级。" : "删除这个空文件夹？")
    : "移除后不再记住这个网址。";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "danger";
  yes.textContent = folder ? "删除" : "移除";
  yes.addEventListener("click", (event) => {
    event.stopPropagation();
    const action = ui.confirm;
    ui.confirm = null;
    if (action.action === "delete-folder") void onDeleteFolder(action.id);
    else void onRemovePin(action.id);
  });
  const no = document.createElement("button");
  no.type = "button";
  no.textContent = "取消";
  no.addEventListener("click", (event) => {
    event.stopPropagation();
    ui.confirm = null;
    render();
  });
  box.append(text, yes, no);
  return box;
}

export function flipFloating() {
  const el = app.querySelector(".menu, .confirm");
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) el.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
  if (rect.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
}
