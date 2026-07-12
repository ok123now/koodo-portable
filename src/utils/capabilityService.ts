import { ConfigService } from "../assets/lib/kookit-extra-browser.min";
import AiTaskService, { AiTask } from "./ai/aiTaskService";
import { getDataSourceCredential } from "./storage/credentialVault";

export type PortableCapability =
  | "fullTranslation"
  | "wordDefinition"
  | "roleAnalysis"
  | "chapterSummary"
  | "sync";

export interface CapabilityStatus {
  available: boolean;
  reason?: "model-not-configured" | "data-source-not-configured" | "vault-locked";
}

const AI_TASKS: Partial<Record<PortableCapability, AiTask>> = {
  fullTranslation: "translation",
  wordDefinition: "wordDefinition",
  roleAnalysis: "roleAnalysis",
  chapterSummary: "summary",
};

/**
 * Portable capabilities depend only on local configuration and credentials.
 * Account, subscription and Koodo server state are deliberately not inputs.
 */
export default class CapabilityService {
  static async get(capability: PortableCapability): Promise<CapabilityStatus> {
    const task = AI_TASKS[capability];
    if (task) {
      return (await AiTaskService.hasTaskModel(task))
        ? { available: true }
        : { available: false, reason: "model-not-configured" };
    }

    const service = ConfigService.getItem("defaultSyncOption");
    if (!service) {
      return { available: false, reason: "data-source-not-configured" };
    }
    try {
      return (await getDataSourceCredential(service))
        ? { available: true }
        : { available: false, reason: "data-source-not-configured" };
    } catch {
      return { available: false, reason: "vault-locked" };
    }
  }

  static async isAvailable(capability: PortableCapability): Promise<boolean> {
    return (await this.get(capability)).available;
  }
}
