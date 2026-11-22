import { createPreviewData } from "./previewData.js";

/**
 * 预览页的 chrome API mock：把 createPreviewData 的数据装进内存，定义
 * storage / tabs / windows / tabGroups / history / runtime 的最小实现并挂到
 * globalThis.chrome，让 sidepanel.js 无需加载扩展即可运行。
 * 返回内存态（同时挂到 globalThis.__mem），供调试与断言观察。
 */
export function installPreviewChrome({ empty = false, now = Date.now() } = {}) {
  const { state, tabs, groups, seq } = createPreviewData({ empty, now });
  const mem = { seq, state, tabs, groups };
  const listeners = { storage: [], tabs: {} };
  function emit(name, arg) {
    for (const fn of listeners.tabs[name] || []) fn(arg);
  }

  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return { state: structuredClone(mem.state) };
        },
        async set(obj) {
          mem.state = structuredClone(obj.state);
          for (const fn of listeners.storage) fn({ state: { newValue: mem.state } }, "local");
        },
      },
      onChanged: { addListener(fn) { listeners.storage.push(fn); } },
    },
    tabs: {
      async query(query) {
        let list = mem.tabs.slice();
        if (query && query.active) list = list.filter((tab) => tab.active);
        if (query && query.currentWindow) list = list.filter((tab) => tab.windowId === 1);
        return structuredClone(list);
      },
      async update(id, props) {
        if (props.active) {
          for (const tab of mem.tabs) tab.active = tab.id === id;
        }
        emit("onActivated", { tabId: id, windowId: 1 });
        return mem.tabs.find((tab) => tab.id === id);
      },
      async create(props) {
        const tab = { id: ++mem.seq, windowId: 1, url: props.url, title: props.url, active: true };
        for (const item of mem.tabs) item.active = false;
        mem.tabs.push(tab);
        emit("onCreated", tab);
        return tab;
      },
      async remove(id) {
        const ids = Array.isArray(id) ? id : [id];
        mem.tabs = mem.tabs.filter((tab) => !ids.includes(tab.id));
        for (const item of ids) emit("onRemoved", item);
      },
      async duplicate(id) {
        const source = mem.tabs.find((tab) => tab.id === id);
        if (!source) throw new Error("missing");
        const tab = { ...source, id: ++mem.seq, active: true };
        for (const item of mem.tabs) item.active = false;
        mem.tabs.push(tab);
        emit("onCreated", tab);
        return tab;
      },
      onActivated: { addListener(fn) { (listeners.tabs.onActivated ||= []).push(fn); } },
      onUpdated: { addListener(fn) { (listeners.tabs.onUpdated ||= []).push(fn); } },
      onRemoved: { addListener(fn) { (listeners.tabs.onRemoved ||= []).push(fn); } },
      onCreated: { addListener(fn) { (listeners.tabs.onCreated ||= []).push(fn); } },
    },
    windows: {
      async getCurrent() { return { id: 1 }; },
      async update() {},
    },
    tabGroups: {
      async query() { return structuredClone(mem.groups || []); },
    },
    history: {
      async getVisits({ url }) {
        if (String(url).includes("matrix")) return [{ visitTime: now - 60000 }];
        if (String(url).includes("artifacts")) return [{ visitTime: now - 14 * 86400000 }];
        if (String(url).includes("code")) return [{ visitTime: now - 28 * 86400000 }];
        return [];
      },
      async search({ text }) {
        const all = [
          { url: "https://ops.example.com", title: "Payment Ops Console", lastVisitTime: now - 4 * 86400000 },
          { url: "https://mse.example.com", title: "MSE", lastVisitTime: now - 6 * 86400000 },
          { url: "https://k8s.example.com", title: "Kubernetes", lastVisitTime: now - 7 * 86400000 },
          { url: "https://grafana.example.com", title: "Monitoring - Grafana", lastVisitTime: now - 8 * 86400000 },
        ];
        const q = String(text || "").toLowerCase();
        return all.filter((item) => item.title.toLowerCase().includes(q) || item.url.includes(q));
      },
    },
    runtime: { getURL: (path) => path },
  };

  globalThis.__mem = mem;
  return mem;
}
