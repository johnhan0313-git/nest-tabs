import { COPY } from "./lib/copy.js";
import {
  TTL_OPTIONS,
  collectTabGroups,
  describeTabGroupImport,
  importTabGroups,
} from "./lib/model.js";
import { loadState, updateState } from "./lib/store.js";

const app = document.querySelector("#app");

function message(text, kind = "") {
  const p = document.createElement("p");
  p.className = kind ? `status ${kind}` : "status";
  p.textContent = text;
  return p;
}

function sectionTitle(text) {
  const h2 = document.createElement("h2");
  h2.textContent = text;
  return h2;
}

async function saveSettings(mutator) {
  try {
    const result = await updateState(mutator);
    return result.ok;
  } catch (error) {
    console.error(error);
    return false;
  }
}

function renderTtlSection(state, statusEl) {
  const section = document.createElement("section");
  section.append(sectionTitle(COPY.options.behavior));
  const row = document.createElement("div");
  row.className = "row";
  const label = document.createElement("label");
  label.textContent = COPY.options.autoClose;
  label.setAttribute("for", "ttl");
  const select = document.createElement("select");
  select.id = "ttl";
  select.setAttribute("aria-label", COPY.ttl.ariaLabel);
  for (const option of TTL_OPTIONS) {
    const node = document.createElement("option");
    node.value = String(option.hours);
    node.textContent = option.label;
    node.selected = option.hours === state.settings.tempTtlHours;
    select.append(node);
  }
  select.addEventListener("change", async () => {
    const hours = Number(select.value);
    const saved = await saveSettings((draft) => {
      draft.settings.tempTtlHours = hours;
    });
    statusEl.textContent = saved
      ? (hours ? COPY.ttl.setTo(TTL_OPTIONS.find((o) => o.hours === hours)?.label || "") : COPY.ttl.disabled)
      : COPY.options.saveError;
    statusEl.className = saved ? "status ok" : "status error";
  });
  row.append(label, select);
  section.append(row);
  return section;
}

function renderDataSection(statusEl) {
  const section = document.createElement("section");
  section.append(sectionTitle(COPY.options.data));
  const row = document.createElement("div");
  row.className = "row";
  const label = document.createElement("span");
  label.textContent = COPY.options.importTabGroups;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-btn";
  button.textContent = COPY.actions.importTabGroups;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const [groups, openTabs] = await Promise.all([
        chrome.tabGroups.query({}),
        chrome.tabs.query({}),
      ]);
      const collected = collectTabGroups(groups, openTabs);
      if (!collected.length) {
        statusEl.textContent = COPY.status.noTabGroups;
        statusEl.className = "status ok";
        return;
      }
      let result = null;
      const saved = await saveSettings((draft) => {
        result = importTabGroups(draft, collected);
        return result.changed;
      });
      statusEl.textContent = saved || (result && !result.changed)
        ? describeTabGroupImport(result)
        : COPY.options.saveError;
      statusEl.className = saved || (result && !result.changed) ? "status ok" : "status error";
    } catch (error) {
      console.error(error);
      statusEl.textContent = COPY.status.readTabGroupsFailed;
      statusEl.className = "status error";
    } finally {
      button.disabled = false;
    }
  });
  row.append(label, button);
  section.append(row);
  return section;
}

function renderAboutSection() {
  const section = document.createElement("section");
  section.className = "about";
  section.append(sectionTitle(COPY.options.about));
  const version = document.createElement("p");
  version.textContent = COPY.options.version(chrome.runtime.getManifest().version);
  section.append(version);
  return section;
}

async function boot() {
  const state = await loadState();
  const statusEl = message("");

  const title = document.createElement("h1");
  title.textContent = COPY.options.title;

  app.append(
    title,
    renderTtlSection(state, statusEl),
    renderDataSection(statusEl),
    renderAboutSection(),
    statusEl,
  );
}

await boot();
