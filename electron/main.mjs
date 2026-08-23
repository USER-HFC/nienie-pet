import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "..");
const isDev = process.argv.includes("--dev");

let petWindow;
let tray;
let quitting = false;
let clickThrough = false;

function createPetWindow() {
  const display = screen.getPrimaryDisplay();
  const width = 430;
  const height = 540;
  const x = Math.round(display.workArea.x + display.workArea.width - width - 32);
  const y = Math.round(display.workArea.y + display.workArea.height - height - 28);

  petWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 320,
    minHeight: 380,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(currentDirectory, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev) {
    petWindow.loadURL("http://127.0.0.1:5173/?desktop=1");
  } else {
    petWindow.loadFile(path.join(projectRoot, "dist", "index.html"), {
      query: { desktop: "1" },
    });
  }

  petWindow.once("ready-to-show", () => petWindow?.show());
  petWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    petWindow?.hide();
  });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: petWindow?.isVisible() ? "隐藏桌宠" : "显示桌宠",
      click: () => toggleWindow(),
    },
    {
      label: "保持置顶",
      type: "checkbox",
      checked: petWindow?.isAlwaysOnTop() ?? true,
      click: (item) => setAlwaysOnTop(item.checked),
    },
    {
      label: "鼠标穿透",
      type: "checkbox",
      checked: clickThrough,
      click: (item) => setClickThrough(item.checked),
    },
    { type: "separator" },
    {
      label: "退出捏捏宠",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const iconPath = path.join(projectRoot, "public", "icon.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip("捏捏宠");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => toggleWindow());
  tray.on("right-click", () => tray?.setContextMenu(buildTrayMenu()));
}

function toggleWindow() {
  if (!petWindow) return;
  if (petWindow.isVisible()) {
    petWindow.hide();
  } else {
    petWindow.show();
    petWindow.focus();
  }
  tray?.setContextMenu(buildTrayMenu());
}

function setAlwaysOnTop(enabled) {
  petWindow?.setAlwaysOnTop(enabled, "floating");
  tray?.setContextMenu(buildTrayMenu());
  return enabled;
}

function setClickThrough(enabled) {
  clickThrough = enabled;
  petWindow?.setIgnoreMouseEvents(enabled, { forward: true });
  tray?.setContextMenu(buildTrayMenu());
  return enabled;
}

app.whenReady().then(() => {
  createPetWindow();
  createTray();

  globalShortcut.register("CommandOrControl+Alt+N", () => toggleWindow());

  ipcMain.handle("pet:get-state", () => ({
    alwaysOnTop: petWindow?.isAlwaysOnTop() ?? true,
    clickThrough,
  }));
  ipcMain.handle("pet:set-always-on-top", (_event, enabled) => setAlwaysOnTop(Boolean(enabled)));
  ipcMain.handle("pet:set-click-through", (_event, enabled) => setClickThrough(Boolean(enabled)));
  ipcMain.handle("pet:hide", () => petWindow?.hide());
  ipcMain.handle("pet:quit", () => {
    quitting = true;
    app.quit();
  });
});

app.on("activate", () => {
  if (!petWindow) createPetWindow();
  petWindow?.show();
});

app.on("before-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
