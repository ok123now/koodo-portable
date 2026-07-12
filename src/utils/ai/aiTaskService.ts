import { isElectron } from "react-device-detect";
import {
  CommonTool,
  ConfigService,
} from "../../assets/lib/kookit-extra-browser.min";
import { resolveAiModelConfig } from "../storage/credentialVault";

declare var window: any;

export type AiTask = "translation" | "wordDefinition" | "roleAnalysis" | "summary";

export interface AiModelConfig {
  endpoint: string;
  modelId: string;
  apiKey?: string;
  credentialRef?: string;
  providerId?: string;
}

export interface WordDefinition {
  word?: string;
  simplified?: string;
  traditional?: string;
  meaning?: string;
  cn_meaning?: string;
  pronunciation?: string;
  pinyin?: string;
  furigana?: string;
  romaji?: string;
  level?: string;
}

const TASK_MODEL_KEYS: Record<AiTask, string[]> = {
  translation: ["aiFullTranslationModel", "aiTranslateModel"],
  wordDefinition: ["aiWordDefinitionModel", "aiDictModel", "aiTranslateModel"],
  roleAnalysis: ["aiRoleAnalysisModel", "aiAssistanceModel", "aiTranslateModel"],
  summary: ["aiAssistanceModel", "aiTranslateModel"],
};

const DEFAULT_TRANSLATION_PROMPT =
  "Translate every supplied passage faithfully into the requested target language. Preserve code, names, lists, and paragraph boundaries. Do not explain or omit text.";
const DEFAULT_WORD_PROMPT =
  "Select only useful vocabulary words from each passage and give concise learner-friendly definitions. Do not invent words that are not in the supplied passage.";
const DEFAULT_ROLE_PROMPT =
  "Classify each supplied sentence for audiobook reading. Use narrator unless the text clearly belongs to a male, female, or child speaker.";

/**
 * Runs the user's own OpenAI-compatible model for non-streaming, structured
 * reader tasks.  It deliberately never uses Koodo's ReaderRequest endpoints.
 */
class AiTaskService {
  private static memoryCache = new Map<string, string>();

  static async hasTaskModel(task: AiTask): Promise<boolean> {
    try {
      return Boolean(await this.getTaskModel(task));
    } catch (error) {
      console.warn("Unable to access local AI model credentials", error);
      return false;
    }
  }

  static async getTaskModel(task: AiTask): Promise<AiModelConfig | null> {
    for (const configKey of TASK_MODEL_KEYS[task]) {
      const modelKey = ConfigService.getReaderConfig(configKey);
      if (!modelKey) continue;
      const entry = ConfigService.getObjectConfig(modelKey, "aiModelConfig", null);
      const config = entry?.config as AiModelConfig | undefined;
      if (config?.endpoint && config?.modelId && config?.apiKey) {
        return config;
      }
      if (config?.endpoint && config?.modelId && config?.credentialRef) {
        const resolved = await resolveAiModelConfig(config);
        if (resolved.apiKey) return resolved;
      }
    }
    return null;
  }

  static async translateBatch(
    bookKey: string,
    texts: string[],
    targetLanguage: string
  ): Promise<string[]> {
    const model = await this.requireTaskModel("translation");
    const configuredPrompt = ConfigService.getReaderConfig(
      "aiFullTranslationPrompt"
    );
    const prompt = `${configuredPrompt || DEFAULT_TRANSLATION_PROMPT}\n\nReturn only a JSON object in exactly this form: {"translations":[{"id":0,"text":"..."}]}. The translations array must contain every input id exactly once.`;
    const result = new Array<string>(texts.length);
    const pending: { id: number; text: string; cacheKey: string }[] = [];

    for (let id = 0; id < texts.length; id++) {
      const text = texts[id];
      const cacheKey = await this.hash(
        JSON.stringify({
          version: 1,
          task: "translation",
          bookKey,
          text,
          targetLanguage,
          endpoint: this.normalizeEndpoint(model.endpoint),
          provider: model.providerId || "custom",
          model: model.modelId,
          prompt,
        })
      );
      const cached = await this.getCachedText("translation", cacheKey);
      if (cached) {
        result[id] = cached;
      } else {
        pending.push({ id, text, cacheKey });
      }
    }

    for (const batch of this.chunkByText(pending, 32, 6000)) {
      const response = await this.completeJson<{
        translations: { id: number; text: string }[];
      }>(model, prompt, {
        targetLanguage,
        items: batch.map(({ id, text }) => ({ id, text })),
      });
      const translations = response?.translations;
      this.assertExactIds(translations, batch.map((item) => item.id), "translations");
      const byId = new Map<number, string>();
      translations.forEach((item) => {
        if (typeof item.text !== "string" || !item.text.trim()) {
          throw new Error("Translation response contains an empty item");
        }
        byId.set(item.id, item.text.trim());
      });
      for (const item of batch) {
        const translation = byId.get(item.id);
        if (!translation) throw new Error("Translation response is incomplete");
        result[item.id] = translation;
        await this.setCachedText("translation", item.cacheKey, translation);
      }
    }

    if (result.some((item) => typeof item !== "string")) {
      throw new Error("Translation response is incomplete");
    }
    return result;
  }

  static async defineWords(
    texts: string[],
    lang: string,
    level: string
  ): Promise<{ text: string; words: WordDefinition[] }[]> {
    const model = await this.requireTaskModel("wordDefinition");
    const prompt = `${ConfigService.getReaderConfig("aiWordDefinitionPrompt") || DEFAULT_WORD_PROMPT}\n\nReturn only JSON: {"items":[{"id":0,"words":[{"word":"...","meaning":"..."}]}]}. Every input id must appear exactly once. For Chinese also use simplified/traditional/pinyin when useful; for Japanese use word/furigana/romaji when useful.`;
    const results: { text: string; words: WordDefinition[] }[] = texts.map(
      (text) => ({ text, words: [] })
    );
    const items: { id: number; text: string; cacheKey: string }[] = [];
    for (const [id, text] of texts.entries()) {
      const cacheKey = await this.hash(
        JSON.stringify({
          version: 1,
          task: "wordDefinition",
          text,
          lang,
          level,
          endpoint: this.normalizeEndpoint(model.endpoint),
          provider: model.providerId || "custom",
          model: model.modelId,
          prompt,
        })
      );
      const cached = await this.getCachedText("wordDefinition", cacheKey);
      if (cached) {
        try {
          results[id] = { text, words: JSON.parse(cached) };
          continue;
        } catch (_) {}
      }
      items.push({ id, text, cacheKey });
    }

    for (const batch of this.chunkByText(items, 24, 5500)) {
      const response = await this.completeJson<{
        items: { id: number; words: WordDefinition[] }[];
      }>(model, prompt, {
        language: lang,
        level,
        items: batch.map(({ id, text }) => ({ id, text })),
      });
      const returnedItems = response?.items;
      this.assertExactIds(returnedItems, batch.map((item) => item.id), "items");
      for (const item of returnedItems) {
        const source = texts[item.id] || "";
        const words = this.sanitizeDefinitions(item.words, source, lang);
        results[item.id] = {
          text: source,
          words,
        };
        const pending = batch.find((entry) => entry.id === item.id);
        if (pending) {
          await this.setCachedText(
            "wordDefinition",
            pending.cacheKey,
            JSON.stringify(words)
          );
        }
      }
    }
    return results;
  }

  static async assignSpeechRoles(
    items: { text: string; index: number }[]
  ): Promise<{ text: string; role: "narrator" | "male" | "female" | "child" }[]> {
    const model = await this.requireTaskModel("roleAnalysis");
    const prompt = `${ConfigService.getReaderConfig("aiRoleAnalysisPrompt") || DEFAULT_ROLE_PROMPT}\n\nReturn only JSON: {"roles":[{"id":0,"role":"narrator"}]}. Return every id exactly once. Allowed roles are narrator, male, female, child.`;
    const output: { text: string; role: "narrator" | "male" | "female" | "child" }[] = new Array(
      items.length
    );
    const indexed: { id: number; text: string; cacheKey: string }[] = [];
    for (const [id, item] of items.entries()) {
      const cacheKey = await this.hash(
        JSON.stringify({
          version: 1,
          task: "roleAnalysis",
          text: item.text,
          endpoint: this.normalizeEndpoint(model.endpoint),
          provider: model.providerId || "custom",
          model: model.modelId,
          prompt,
        })
      );
      const cached = await this.getCachedText("roleAnalysis", cacheKey);
      if (["narrator", "male", "female", "child"].includes(cached || "")) {
        output[id] = {
          text: item.text,
          role: cached as "narrator" | "male" | "female" | "child",
        };
      } else {
        indexed.push({ id, text: item.text, cacheKey });
      }
    }

    for (const batch of this.chunkByText(indexed, 80, 9000)) {
      const response = await this.completeJson<{
        roles: { id: number; role: string }[];
      }>(model, prompt, {
        items: batch.map(({ id, text }) => ({ id, text })),
      });
      const roles = response?.roles;
      this.assertExactIds(roles, batch.map((item) => item.id), "roles");
      for (const item of roles) {
        const role = ["narrator", "male", "female", "child"].includes(
          item.role
        )
          ? (item.role as "narrator" | "male" | "female" | "child")
          : "narrator";
        output[item.id] = { text: items[item.id].text, role };
        const pending = batch.find((entry) => entry.id === item.id);
        if (pending) {
          await this.setCachedText("roleAnalysis", pending.cacheKey, role);
        }
      }
    }
    return output;
  }

  static async summarize(
    bookKey: string,
    text: string,
    mode: "summary" | "outline"
  ): Promise<string> {
    const model = await this.requireTaskModel("summary");
    const systemPrompt =
      mode === "outline"
        ? "Create a faithful hierarchical outline of the supplied chapter. Preserve important names, concepts, arguments, and sequence. Do not add facts. Return only JSON: {\"content\":\"...\"}."
        : "Summarize the supplied chapter faithfully and concisely. Preserve its main claims, important facts, and conclusions. Do not add facts. Return only JSON: {\"content\":\"...\"}.";
    const cacheKey = await this.hash(
      JSON.stringify({
        version: 1,
        task: mode,
        bookKey,
        text,
        endpoint: this.normalizeEndpoint(model.endpoint),
        provider: model.providerId || "custom",
        model: model.modelId,
        prompt: systemPrompt,
      })
    );
    const cached = await this.getCachedText(mode, cacheKey);
    if (cached) return cached;
    const parts = text.match(/[\s\S]{1,12000}/g) || [text];
    const partials: string[] = [];
    for (const [index, part] of parts.entries()) {
      const response = await this.completeJson<{ content: string }>(
        model,
        systemPrompt,
        { part: index + 1, partCount: parts.length, text: part }
      );
      if (typeof response?.content !== "string" || !response.content.trim()) {
        throw new Error("AI summary response is empty");
      }
      partials.push(response.content.trim());
    }
    let content = partials[0];
    if (partials.length > 1) {
      const merged = await this.completeJson<{ content: string }>(
        model,
        `${systemPrompt}\nMerge the partial results without repetition and preserve their original order.`,
        { partials }
      );
      if (typeof merged?.content !== "string" || !merged.content.trim()) {
        throw new Error("AI summary response is empty");
      }
      content = merged.content.trim();
    }
    await this.setCachedText(mode, cacheKey, content);
    return content;
  }

  private static async requireTaskModel(task: AiTask): Promise<AiModelConfig & { apiKey: string }> {
    const model = await this.getTaskModel(task);
    if (!model) {
      throw new Error("Please configure an AI model for this feature first");
    }
    return model as AiModelConfig & { apiKey: string };
  }

  private static async completeJson<T>(
    model: AiModelConfig & { apiKey: string },
    systemPrompt: string,
    input: unknown
  ): Promise<T> {
    const endpoint = `${this.normalizeEndpoint(model.endpoint)}/chat/completions`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${model.apiKey}`,
          },
          body: JSON.stringify({
            model: model.modelId,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: JSON.stringify(input) },
            ],
            stream: false,
            temperature: 0.1,
            ...CommonTool.getDisableThinkingParams(model.providerId || ""),
          }),
        });
        clearTimeout(timeout);
        if (!response.ok) {
          const body = (await response.text()).slice(0, 500);
          const retryable = response.status === 429 || response.status >= 500;
          if (!retryable) {
            throw new Error(`AI request failed (HTTP ${response.status}): ${body}`);
          }
          lastError = new Error(`AI request failed (HTTP ${response.status}): ${body}`);
          const retryAfter = Number(response.headers.get("Retry-After"));
          await this.wait(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
          continue;
        }
        const data = await response.json();
        const content = this.getCompletionText(data);
        return this.parseJson(content) as T;
      } catch (error) {
        clearTimeout(timeout);
        const message = error instanceof Error ? error.message : String(error);
        lastError = new Error(
          error instanceof DOMException && error.name === "AbortError"
            ? "AI request timed out"
            : message === "The user aborted a request."
              ? "AI request timed out"
              : message
        );
        if (attempt === 2 || /HTTP (400|401|403|404)/.test(message)) break;
        await this.wait(1000 * 2 ** attempt);
      }
    }
    throw lastError || new Error("AI request failed");
  }

  private static getCompletionText(data: any): string {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof item === "string" ? item : item?.text || ""))
        .join("");
    }
    throw new Error("AI response did not contain a chat completion");
  }

  private static parseJson(content: string): unknown {
    const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return JSON.parse(trimmed);
    } catch {
      const first = trimmed.indexOf("{");
      const last = trimmed.lastIndexOf("}");
      if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
      throw new Error("AI returned invalid JSON");
    }
  }

  private static assertExactIds(
    values: { id: number }[] | undefined,
    expectedIds: number[],
    label: string
  ) {
    if (!Array.isArray(values) || values.length !== expectedIds.length) {
      throw new Error(`AI response has an invalid ${label} count`);
    }
    const expected = new Set(expectedIds);
    const seen = new Set<number>();
    for (const value of values) {
      if (!Number.isInteger(value?.id) || !expected.has(value.id) || seen.has(value.id)) {
        throw new Error(`AI response has invalid ${label} ids`);
      }
      seen.add(value.id);
    }
  }

  private static sanitizeDefinitions(
    words: WordDefinition[] | undefined,
    source: string,
    lang: string
  ): WordDefinition[] {
    if (!Array.isArray(words)) return [];
    return words
      .slice(0, 40)
      .map((word) => {
        const clean: WordDefinition = {};
        [
          "word",
          "simplified",
          "traditional",
          "meaning",
          "cn_meaning",
          "pronunciation",
          "pinyin",
          "furigana",
          "romaji",
          "level",
        ].forEach((key) => {
          const value = (word as any)?.[key];
          if (typeof value === "string" && value.trim()) {
            (clean as any)[key] = value.trim().slice(0, 500);
          }
        });
        return clean;
      })
      .filter((word) => {
        const token =
          lang === "zh"
            ? word.simplified || word.traditional
            : word.word;
        return Boolean(token && source.toLocaleLowerCase().includes(token.toLocaleLowerCase()));
      });
  }

  private static chunkByText<T extends { text: string }>(
    items: T[],
    maxItems: number,
    maxCharacters: number
  ): T[][] {
    const chunks: T[][] = [];
    let current: T[] = [];
    let size = 0;
    for (const item of items) {
      const itemSize = item.text.length;
      if (current.length && (current.length >= maxItems || size + itemSize > maxCharacters)) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(item);
      size += itemSize;
    }
    if (current.length) chunks.push(current);
    return chunks;
  }

  private static normalizeEndpoint(endpoint: string): string {
    return endpoint.trim().replace(/\/+$/, "");
  }

  private static wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10000)));
  }

  private static async hash(value: string): Promise<string> {
    try {
      const bytes = new TextEncoder().encode(value);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return `fnv-${(hash >>> 0).toString(16)}`;
    }
  }

  private static async getCachedText(task: string, key: string): Promise<string | null> {
    if (!isElectron || !window.require) return this.memoryCache.get(key) || null;
    try {
      const result = await window.require("electron").ipcRenderer.invoke(
        "ai-cache-get",
        { task, cacheKey: key }
      );
      return result?.hit && typeof result.payload?.text === "string"
        ? result.payload.text
        : null;
    } catch (error) {
      console.warn("Failed to read the portable AI cache", error);
      return null;
    }
  }

  private static async setCachedText(task: string, key: string, text: string) {
    if (!isElectron || !window.require) {
      this.memoryCache.set(key, text);
      return;
    }
    try {
      await window.require("electron").ipcRenderer.invoke("ai-cache-set", {
        task,
        cacheKey: key,
        payload: { text },
      });
    } catch (error) {
      console.warn("Failed to write the portable AI cache", error);
    }
  }
}

export default AiTaskService;
