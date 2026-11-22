import { app, busy, scheduleRefresh, ui, boot } from "./panel/state.js";
import { render } from "./panel/render.js";
import { finishRename } from "./panel/actions.js";
import { closePeek } from "./panel/peek.js";

document.addEventListener("pointerdown", (event) => {
  const input = app.querySelector(".rename");
  if (!input || !ui.editingId || event.target === input) return;
  void finishRename(ui.editingId, input.value, input.dataset.original || "");
}, true);

function closeOverlays() {
  if (!ui.menuId && !ui.confirm) return;
  ui.menuId = null;
  ui.confirm = null;
  if (ui.editingId && app.querySelector(".rename")) {
    app.querySelectorAll(".menu, .confirm").forEach((node) => node.remove());
    return;
  }
  render();
}

document.addEventListener("click", (event) => {
  if (event.target.closest(".menu, .confirm")) return;
  closeOverlays();
});

window.addEventListener("blur", closeOverlays);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (ui.peekId && !ui.menuId && !ui.confirm && !ui.editingId) {
    closePeek();
    return;
  }
  if (!ui.menuId && !ui.confirm && !ui.editingId) return;
  ui.menuId = null;
  ui.confirm = null;
  ui.editingId = null;
  render();
});

chrome.storage.onChanged.addListener(() => scheduleRefresh());
chrome.tabs.onActivated.addListener(() => scheduleRefresh());
chrome.tabs.onUpdated.addListener(() => scheduleRefresh());
chrome.tabs.onRemoved.addListener(() => scheduleRefresh());
chrome.tabs.onCreated.addListener(() => scheduleRefresh());

await boot();
setInterval(() => {
  if (busy() || Date.now() < ui.foldingUntil) return;
  render();
}, 30000);
