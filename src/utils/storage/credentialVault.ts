import { isElectron } from "react-device-detect";

declare const window: any;

export class CredentialVaultLockedError extends Error {
  constructor() {
    super("The local credential vault is locked. Unlock it before using data sources.");
    this.name = "CredentialVaultLockedError";
  }
}

const getIpcRenderer = () => {
  if (!isElectron || !window.require) {
    throw new Error("The local credential vault is available only in the desktop app.");
  }
  return window.require("electron").ipcRenderer;
};

const normalizeVaultError = (error: any): never => {
  if (
    error?.code === "LOCKED" ||
    String(error?.message || error).toLowerCase().includes("vault is locked")
  ) {
    throw new CredentialVaultLockedError();
  }
  throw error;
};

const credentialName = (service: string) => `datasource:${service}`;

export const unlockCredentialVault = async (passphrase: string) => {
  try {
    const result = await getIpcRenderer().invoke("credential-vault-unlock", {
      passphrase,
    });
    if (!result?.unlocked) {
      throw new CredentialVaultLockedError();
    }
    return result;
  } catch (error) {
    normalizeVaultError(error);
  }
};
const aiCredentialName = (modelKey: string) => `ai:model:${modelKey}`;

export interface VaultBackedAiModelConfig {
  apiKey?: string;
  credentialRef?: string;
  [key: string]: any;
}

export const setDataSourceCredential = async (service: string, value: any) => {
  let result: any;
  try {
    result = await getIpcRenderer().invoke("credential-vault-set", {
      name: credentialName(service),
      value,
    });
  } catch (error: any) {
    normalizeVaultError(error);
  }
  if (!result?.stored) {
    throw new CredentialVaultLockedError();
  }
};

export const getDataSourceCredential = async (service: string) => {
  let result: any;
  try {
    result = await getIpcRenderer().invoke("credential-vault-get", {
      name: credentialName(service),
    });
  } catch (error: any) {
    normalizeVaultError(error);
  }
  return result?.found ? result.value : null;
};

export const deleteDataSourceCredential = async (service: string) => {
  try {
    await getIpcRenderer().invoke("credential-vault-delete", {
      name: credentialName(service),
    });
  } catch (error: any) {
    normalizeVaultError(error);
  }
};

/**
 * Stores one model secret in the optional desktop vault. A null return means
 * that the app is running in a browser or the vault is currently locked; the
 * caller can then retain its legacy config value for compatibility.
 */
export const trySetAiModelCredential = async (
  modelKey: string,
  apiKey: string
): Promise<string | null> => {
  if (!isElectron || !window.require) return null;
  try {
    const result = await getIpcRenderer().invoke("credential-vault-set", {
      name: aiCredentialName(modelKey),
      value: { apiKey },
    });
    return result?.stored ? aiCredentialName(modelKey) : null;
  } catch (error: any) {
    if (error?.code === "LOCKED" || String(error?.message || error).toLowerCase().includes("vault is locked")) {
      return null;
    }
    throw error;
  }
};

export const getAiModelApiKey = async (credentialRef: string) => {
  if (!credentialRef) return "";
  let result: any;
  try {
    result = await getIpcRenderer().invoke("credential-vault-get", {
      name: credentialRef,
    });
  } catch (error: any) {
    normalizeVaultError(error);
  }
  if (!result?.found) return "";
  const value = result.value;
  return typeof value === "string" ? value : typeof value?.apiKey === "string" ? value.apiKey : "";
};

export const deleteAiModelCredential = async (modelKey: string) => {
  if (!isElectron || !window.require) return;
  try {
    await getIpcRenderer().invoke("credential-vault-delete", {
      name: aiCredentialName(modelKey),
    });
  } catch (error: any) {
    // Deleting a model must not be blocked by a vault which was locked after
    // the model had been configured. The encrypted orphan is harmless and can
    // be removed after the vault is unlocked.
    if (error?.code !== "LOCKED") throw error;
  }
};

export const resolveAiModelConfig = async <T extends VaultBackedAiModelConfig>(
  config: T
): Promise<T & { apiKey: string }> => {
  if (config?.apiKey) return { ...config, apiKey: config.apiKey };
  if (!config?.credentialRef) return { ...config, apiKey: "" };
  return { ...config, apiKey: await getAiModelApiKey(config.credentialRef) };
};
