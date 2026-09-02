import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  safeStorage,
  screen,
  Tray,
} from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  AI_PROVIDERS,
  downloadGlb,
  queryAiModel,
  serializeAiError,
  submitAiModel,
  testAiProvider,
} from "../shared/ai-providers.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "..");
const isDev = process.argv.includes("--dev");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "nienie-model",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let petWindow;
let tray;
let quitting = false;
let clickThrough = false;

function credentialStorePath() {
  return path.join(app.getPath("userData"), "ai-credentials.json");
}

async function readCredentialStore() {
  try {
    const content = await fs.readFile(credentialStorePath(), "utf8");
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("AI credential store could not be read.");
    return {};
  }
}

async function writeCredentialStore(store) {
  const destination = credentialStorePath();
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, destination);
}

function assertProvider(provider) {
  if (!AI_PROVIDERS.includes(provider)) throw new Error("暂不支持这个模型服务");
  return provider;
}

async function saveProviderKey(provider, apiKey) {
  assertProvider(provider);
  if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存 API Key");
  const store = await readCredentialStore();
  store[provider] = safeStorage.encryptString(apiKey.trim()).toString("base64");
  await writeCredentialStore(store);
}

async function readProviderKey(provider) {
  assertProvider(provider);
  const store = await readCredentialStore();
  const encrypted = store[provider];
  if (!encrypted || typeof encrypted !== "string") return "";
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return "";
  }
}

async function forgetProviderKey(provider) {
  assertProvider(provider);
  const store = await readCredentialStore();
  delete store[provider];
  await writeCredentialStore(store);
  return true;
}

async function credentialState() {
  const store = await readCredentialStore();
  return {
    canStoreSecurely: safeStorage.isEncryptionAvailable(),
    savedProviders: AI_PROVIDERS.filter((provider) => typeof store[provider] === "string"),
  };
}

async function resolveProviderRequest(input) {
  const provider = assertProvider(input?.provider);
  const enteredKey = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
  const apiKey = enteredKey || await readProviderKey(provider);
  if (!apiKey) throw new Error("请先填写 API Key");
  if (enteredKey && input?.remember) await saveProviderKey(provider, enteredKey);
  return { ...input, provider, apiKey };
}

async function persistGeneratedModel(sourceUrl, provider) {
  const buffer = await downloadGlb(sourceUrl, { fetchImpl: net.fetch });
  const directory = path.join(app.getPath("userData"), "models");
  const filename = `${provider}-${Date.now()}-${randomUUID()}.glb`;
  const destination = path.join(directory, filename);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(destination, buffer, { mode: 0o600 });
  return `nienie-model://local/${encodeURIComponent(filename)}`;
}

function registerModelProtocol() {
  protocol.handle("nienie-model", (request) => {
    const url = new URL(request.url);
    if (url.host !== "local") return new Response("Not found", { status: 404 });

    const filename = decodeURIComponent(url.pathname.slice(1));
    if (!/^[a-z0-9-]+\.glb$/i.test(filename) || path.basename(filename) !== filename) {
      return new Response("Invalid model path", { status: 400 });
    }

    const directory = path.resolve(app.getPath("userData"), "models");
    const destination = path.resolve(directory, filename);
    const relative = path.relative(directory, destination);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return new Response("Invalid model path", { status: 400 });
    }
    return net.fetch(pathToFileURL(destination).href);
  });
}

function registerSafeHandler(channel, handler) {
  ipcMain.handle(channel, async (_event, input) => {
    try {
      return await handler(input);
    } catch (error) {
      const serialized = serializeAiError(error);
      throw new Error(serialized.message === "模型服务发生未知错误" ? error?.message || serialized.message : serialized.message);
    }
  });
}

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
      preload: path.join(currentDirectory, "preload.cjs"),
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
  registerModelProtocol();
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

  registerSafeHandler("ai:get-credential-state", () => credentialState());
  registerSafeHandler("ai:forget-key", ({ provider }) => forgetProviderKey(provider));
  registerSafeHandler("ai:test-provider", async (input) => {
    const request = await resolveProviderRequest(input);
    return testAiProvider({ ...request, fetchImpl: net.fetch });
  });
  registerSafeHandler("ai:submit-model", async (input) => {
    const request = await resolveProviderRequest(input);
    return submitAiModel({ ...request, fetchImpl: net.fetch });
  });
  registerSafeHandler("ai:query-model", async (input) => {
    const request = await resolveProviderRequest(input);
    const result = await queryAiModel({ ...request, fetchImpl: net.fetch });
    if (result.status === "completed" && result.modelUrl) {
      result.modelUrl = await persistGeneratedModel(result.modelUrl, request.provider);
    }
    return result;
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
