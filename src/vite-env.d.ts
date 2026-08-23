/// <reference types="vite/client" />

interface DesktopPetApi {
  getState(): Promise<{ alwaysOnTop: boolean; clickThrough: boolean }>;
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
  setClickThrough(enabled: boolean): Promise<boolean>;
  hide(): Promise<void>;
  quit(): Promise<void>;
}

interface Window {
  desktopPet?: DesktopPetApi;
}
