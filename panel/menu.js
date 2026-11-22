import { COPY } from "../lib/copy.js";
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
    menu.append(menuItem(COPY.menu.newFolder, () => {
      ui.menuId = null;
      void onCreateFolder(null);
    }));
  }
  if (kind === "folder") {
    menu.append(menuItem(COPY.menu.newSubfolder, () => {
      ui.menuId = null;
      void onCreateFolder(id);
    }));
    menu.append(menuItem(COPY.menu.rename, () => {
      ui.menuId = null;
      ui.editingId = id;
      render();
    }));
    menu.append(menuDivider());
    menu.append(menuItem(COPY.menu.delete, () => {
      ui.menuId = null;
      ui.confirm = { id, action: "delete-folder" };
      render();
    }, true));
  }
  if (kind === "pin" || kind === "temp") appendPageMenu(menu, id, kind);
  return menu;
}

function appendPageMenu(menu, id, kind) {
  menu.append(menuItem(COPY.menu.copyLink, () => void onCopyLink(id, kind)));
  menu.append(menuItem(COPY.menu.rename, () => {
    ui.menuId = null;
    ui.editingId = id;
    render();
  }));
  menu.append(menuItem(COPY.menu.duplicate, () => void onDuplicate(id, kind)));
  menu.append(menuDivider());
  if (kind === "pin") {
    menu.append(menuItem(COPY.menu.remove, () => {
      ui.menuId = null;
      ui.confirm = { id, action: "remove-pin" };
      render();
    }, true));
    return;
  }
  menu.append(menuItem(COPY.menu.close, () => void onCloseTemp(id), true));
}

function renderConfirm() {
  const box = document.createElement("div");
  box.className = "confirm";
  box.style.left = `${ui.menuX}px`;
  box.style.top = `${ui.menuY}px`;
  const text = document.createElement("p");
  const folder = ui.confirm.action === "delete-folder" ? locate(state.roots, ui.confirm.id)?.node : null;
  text.textContent = folder
    ? (folder.children.length ? COPY.confirm.deleteFolderWithChildren : COPY.confirm.deleteEmptyFolder)
    : COPY.confirm.removePin;
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "danger";
  yes.textContent = folder ? COPY.confirm.delete : COPY.confirm.remove;
  yes.addEventListener("click", (event) => {
    event.stopPropagation();
    const action = ui.confirm;
    ui.confirm = null;
    if (action.action === "delete-folder") void onDeleteFolder(action.id);
    else void onRemovePin(action.id);
  });
  const no = document.createElement("button");
  no.type = "button";
  no.textContent = COPY.confirm.cancel;
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
