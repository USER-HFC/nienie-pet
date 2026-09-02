function friendlyError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error || "请求失败");
  const message = raw
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  return new Error(message || "请求失败，请稍后重试");
}

async function postJson<T>(path: string, input: object): Promise<T> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `请求失败（HTTP ${response.status}）`);
    return payload as T;
  } catch (error) {
    throw friendlyError(error);
  }
}

export async function getAiCredentialState(): Promise<{
  canStoreSecurely: boolean;
  savedProviders: AiProvider[];
}> {
  if (!window.desktopPet) return { canStoreSecurely: false, savedProviders: [] };
  try {
    return await window.desktopPet.getAiCredentialState();
  } catch (error) {
    throw friendlyError(error);
  }
}

export async function forgetAiKey(provider: AiProvider): Promise<void> {
  if (!window.desktopPet) return;
  try {
    await window.desktopPet.forgetAiKey(provider);
  } catch (error) {
    throw friendlyError(error);
  }
}

export async function testProvider(input: AiProviderInput): Promise<AiProviderTestResult> {
  if (window.desktopPet) {
    try {
      return await window.desktopPet.testAiProvider(input);
    } catch (error) {
      throw friendlyError(error);
    }
  }
  return postJson<AiProviderTestResult>("/api/ai3d/test", input);
}

export async function submitModel(
  input: AiModelGenerationInput,
): Promise<AiModelSubmitResult> {
  if (window.desktopPet) {
    try {
      return await window.desktopPet.submitAiModel(input);
    } catch (error) {
      throw friendlyError(error);
    }
  }
  return postJson<AiModelSubmitResult>("/api/ai3d/submit", input);
}

export async function queryModel(
  input: AiProviderInput & { taskId: string; model: string },
): Promise<AiModelQueryResult> {
  if (window.desktopPet) {
    try {
      return await window.desktopPet.queryAiModel(input);
    } catch (error) {
      throw friendlyError(error);
    }
  }
  return postJson<AiModelQueryResult>("/api/ai3d/query", input);
}
