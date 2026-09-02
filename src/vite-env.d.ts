/// <reference types="vite/client" />

type AiProvider = "tencent" | "tripo";
type AiGenerationInputType = "text" | "image";
type AiGenerationStatus = "queued" | "running" | "completed" | "failed";

interface AiProviderInput {
  provider: AiProvider;
  apiKey?: string;
  remember?: boolean;
}

interface AiProviderTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  balance?: number;
  models?: string[];
}

interface AiModelSubmitResult {
  taskId: string;
  model: string;
  status: string;
}

interface AiModelGenerationInput extends AiProviderInput {
  inputType: AiGenerationInputType;
  prompt?: string;
  imageData?: string;
  imageName?: string;
}

interface AiModelQueryResult {
  status: AiGenerationStatus;
  progress?: number;
  modelUrl?: string;
  previewUrl?: string;
  message?: string;
}

interface DesktopPetApi {
  getState(): Promise<{ alwaysOnTop: boolean; clickThrough: boolean }>;
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
  setClickThrough(enabled: boolean): Promise<boolean>;
  hide(): Promise<void>;
  quit(): Promise<void>;
  getAiCredentialState(): Promise<{
    canStoreSecurely: boolean;
    savedProviders: AiProvider[];
  }>;
  forgetAiKey(provider: AiProvider): Promise<boolean>;
  testAiProvider(input: AiProviderInput): Promise<AiProviderTestResult>;
  submitAiModel(input: AiModelGenerationInput): Promise<AiModelSubmitResult>;
  queryAiModel(
    input: AiProviderInput & { taskId: string; model: string },
  ): Promise<AiModelQueryResult>;
}

interface Window {
  desktopPet?: DesktopPetApi;
}
