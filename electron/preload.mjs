import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopPet", {
  getState: () => ipcRenderer.invoke("pet:get-state"),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("pet:set-always-on-top", enabled),
  setClickThrough: (enabled) => ipcRenderer.invoke("pet:set-click-through", enabled),
  hide: () => ipcRenderer.invoke("pet:hide"),
  quit: () => ipcRenderer.invoke("pet:quit"),
});
