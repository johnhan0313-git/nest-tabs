import { createFolder, createPin, createTemp, emptyState } from "./model.js";

const HOUR = 3600000;

function tabById(tabs, id) {
  const tab = tabs.find((item) => item.id === id);
  if (!tab) throw new Error(`preview: missing tab ${id}`);
  return tab;
}

/**
 * 预览页的 mock 数据。用真实模型函数（emptyState/createFolder/createPin/createTemp）
 * 构建，保证结构与线上 state 始终一致。
 */
export function createPreviewData({ empty = false, now = Date.now() } = {}) {
  const state = emptyState();
  state.rev = 1;

  const tabs = empty ? [] : [
    { id: 11, windowId: 1, index: 0, url: "https://docs.example.com/open", title: "支付中台开放平台", favIconUrl: "", active: true },
    { id: 12, windowId: 1, index: 1, url: "https://mq.example.com", title: "rocketmq", favIconUrl: "", active: false },
    { id: 13, windowId: 1, index: 2, url: "https://matrix.example.com", title: "Matrix Admin", favIconUrl: "", active: false },
    { id: 14, windowId: 1, index: 3, groupId: 7, url: "chrome://newtab/", title: "新标签页", favIconUrl: "", active: false },
    { id: 15, windowId: 1, index: 4, groupId: 7, url: "https://grafana.example.com", title: "应用监控-grafana", favIconUrl: "", active: false },
    { id: 16, windowId: 1, index: 5, groupId: 8, url: "https://ops.example.com", title: "支付中台运营系统", favIconUrl: "", active: false },
  ];

  if (!empty) {
    const pay = createFolder("支付组");
    pay.color = "#3d6dff";
    pay.children.push(
      createPin({ url: "https://artifacts.example.com", customName: "制品库" }),
      createPin({ url: "https://code.example.com", customName: "代码库" }),
    );
    const testEnv = createFolder("测试环境");
    testEnv.color = "#7c4dff";
    testEnv.children.push(createPin({ url: "https://matrix.example.com", customName: "Matrix Admin" }));
    pay.children.push(testEnv);

    const prod = createFolder("生产环境");
    prod.color = "#e84393";
    prod.collapsed = true;
    prod.children.push(createPin({ url: "https://ops.example.com", customName: "支付中台运营系统" }));

    state.roots.push(pay, prod);

    state.temps.push(
      createTemp(tabById(tabs, 11), now - 2 * HOUR),
      createTemp(tabById(tabs, 12), now - 23.2 * HOUR),
    );
  }

  const groups = empty ? [] : [
    { id: 7, windowId: 1, title: "监控", color: "cyan", collapsed: false },
    { id: 8, windowId: 1, title: "生产环境", color: "red", collapsed: true },
  ];

  return { state, tabs, groups, seq: 20 };
}
