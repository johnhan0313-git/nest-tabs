export const COPY = {
  app: {
    title: "Nest Tabs",
    loading: "Loading…",
    loadError: "Could not load saved tabs.",
    retry: "Retry",
  },
  sections: {
    pinned: "Pinned",
    temporary: "Temporary",
  },
  actions: {
    importTabGroups: "Import tab groups",
    newTab: "New Tab",
    settings: "Settings",
  },
  options: {
    title: "Nest Tabs Settings",
    behavior: "Behavior",
    temporaryTabs: "Temporary tabs",
    autoClose: "Auto-close after",
    data: "Data",
    importTabGroups: "Import Chrome tab groups",
    about: "About",
    version(version) {
      return `Version ${version}`;
    },
    saveError: "Could not save settings. Try again.",
  },
  ttl: {
    ariaLabel: "Temporary tab auto-close time",
    options: [
      { hours: 1, label: "1 hour" },
      { hours: 6, label: "6 hours" },
      { hours: 24, label: "24 hours" },
      { hours: 72, label: "3 days" },
      { hours: 168, label: "7 days" },
      { hours: 0, label: "Never" },
    ],
    setTo(label) {
      return `Set to ${label}`;
    },
    disabled: "Temporary tabs will not auto-close.",
  },
  search: {
    placeholder: "Search or enter a URL",
    ariaLabel: "Search or enter a URL",
    resultsLabel: "Search results",
    openUrl: "Open URL",
    folder: "Folder",
    noResults: "No matching pages",
  },
  menu: {
    newFolder: "New folder",
    newSubfolder: "New subfolder",
    rename: "Rename",
    delete: "Delete",
    copyLink: "Copy link",
    duplicate: "Duplicate",
    remove: "Remove",
    close: "Close",
  },
  confirm: {
    deleteFolderWithChildren: "Its items will move up one level.",
    deleteEmptyFolder: "Delete this empty folder?",
    removePin: "It will be forgotten.",
    delete: "Delete",
    remove: "Remove",
    cancel: "Cancel",
  },
  tooltips: {
    close: "Close",
    closeKeepPin: "Close tab but keep pin",
    closeTemp(remaining) {
      return `Close (auto-closes in ${remaining})`;
    },
  },
  rename: {
    ariaLabel: "Name",
  },
  peek: {
    placeholder(name) {
      return `Search ${name}`;
    },
    ariaLabel(name) {
      return `Search ${name}`;
    },
    noMatches: "No matching pages",
    empty: "No pages yet",
  },
  status: {
    closed: "Closed.",
    removed: "Removed.",
    deleted: "Deleted.",
    copiedLink: "Link copied",
    noTabGroups: "No tab groups to import",
    tabGroupsImported({ folders, pins }) {
      if (!folders && !pins) return "All pages are already here";
      const parts = [];
      if (folders) parts.push(`${folders} folder${folders > 1 ? "s" : ""}`);
      if (pins) parts.push(`${pins} page${pins > 1 ? "s" : ""}`);
      return `Imported ${parts.join(" and ")}`;
    },
    allAlreadyHere: "All pages are already here",
    readTabGroupsFailed: "Could not read tab groups. Try again.",
    newTabFailed: "Could not open a new tab.",
    copyFailed: "Could not copy. Try again.",
    duplicateFailed: "Could not duplicate the tab.",
    openFailed: "Could not open this URL.",
    tabAlreadyClosed: "This tab has already been closed.",
    noUrlYet: "This page does not have a URL yet.",
    cannotDropHere: "Cannot drop here.",
    saveFailed: "Could not save. Try again.",
    pinSavedTo(name) {
      return `Pinned to “${name}”`;
    },
    pinned: "Pinned",
  },
  fallback: {
    folderName: "Folder",
    unnamed: "Untitled",
    unnamedGroup: "Untitled group",
  },
};
