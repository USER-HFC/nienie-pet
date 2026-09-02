const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", {
  getState: () => ipcRenderer.invoke("pet:get-state"),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("pet:set-always-on-top", enabled),
  setClickThrough: (enabled) => ipcRenderer.invoke("pet:set-click-through", enabled),
  hide: () => ipcRenderer.invoke("pet:hide"),
  quit: () => ipcRenderer.invoke("pet:quit"),
  getAiCredentialState: () => ipcRenderer.invoke("ai:get-credential-state"),
  forgetAiKey: (provider) => ipcRenderer.invoke("ai:forget-key", { provider }),
  testAiProvider: (input) => ipcRenderer.invoke("ai:test-provider", input),
  submitAiModel: (input) => ipcRenderer.invoke("ai:submit-model", input),
  queryAiModel: (input) => ipcRenderer.invoke("ai:query-model", input),
});
