// Exposes the same "Reaper" bridge the Fire TV app provides, backed by the Windows main process.
const { contextBridge, ipcRenderer } = require("electron");

const sync = (name) => (...args) => ipcRenderer.sendSync("reaper-sync", name, args);
const async = (name) => (...args) => { ipcRenderer.send("reaper-async", name, args); };

contextBridge.exposeInMainWorld("Reaper", {
  // answered immediately
  deviceInfo: sync("deviceInfo"),
  getApps: sync("getApps"),
  getSteamGames: sync("getSteamGames"),
  installedVersion: sync("installedVersion"),
  launch: sync("launch"),
  canInstall: () => true,
  playInRetroArch: sync("playInRetroArch"),
  getLoginItem: sync("getLoginItem"),
  readRom: sync("readRom"),
  hasMediaPermission: () => true,
  listMedia: sync("listMedia"),
  getPlayerOption: sync("getPlayerOption"),
  // answered later through window.reaper* callbacks
  requestIcon: async("requestIcon"),
  fetch: async("fetch"),
  install: async("install"),
  uninstall: async("uninstall"),
  upgradeAll: async("upgradeAll"),
  saveGame: async("saveGame"),
  openUrl: async("openUrl"),
  openSettings: async("openSettings"),
  openAppstore: async("openAppstore"),
  checkForUpdates: async("checkForUpdates"),
  installUpdate: async("installUpdate"),
  setLoginItem: async("setLoginItem"),
  openWeb: async("openWeb"),
  requestMediaPermission: async("requestMediaPermission"),
  playMedia: async("playMedia"),
  setPlayerOption: async("setPlayerOption"),
  quit: async("quit")
});
