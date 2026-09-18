import type { DesktopAPI, LlmProvider, LlmProviderType } from "../shared/types";
import type { CustomModelInput, Model, ModelPort } from "../shared/uiPort";

/**
 * Models over the desktop's single configured provider.
 *
 * The shapes disagree in a way worth stating plainly: `ModelPort` is a list of
 * models the user picks from, while the desktop stores **one** LLM provider
 * (type, baseUrl, apiKey, model). So "the list" is the built-in official model
 * plus, at most, the one custom provider that is configured.
 *
 * Adding a second custom model therefore replaces the first. That is the
 * desktop's actual capability, not a shortcut taken here; making the list real
 * means giving the desktop somewhere to keep several providers, which is
 * deferred scope in docs/uiport-scope.md.
 */

/** The bundled model, always present and never removable. */
const OFFICIAL_MODEL: Model = {
  id: "official",
  name: "OfficeDex",
  provider: "OfficeDex",
  detail: "Included with your plan",
};

/** The id the configured custom provider is reported under. */
const CUSTOM_MODEL_ID = "custom";

function providerType(value: string): LlmProviderType {
  const normalized = value.trim().toLowerCase();
  if (normalized === "openai" || normalized === "anthropic" || normalized === "azure") return normalized;
  return "custom";
}

function toModel(provider: LlmProvider): Model {
  return {
    id: CUSTOM_MODEL_ID,
    name: provider.model.trim() || provider.type,
    provider: provider.type,
    detail: provider.baseUrl.trim() || undefined,
    custom: true,
  };
}

function toProvider(input: CustomModelInput): LlmProvider {
  return {
    type: providerType(input.provider),
    baseUrl: input.baseUrl.trim(),
    // The contract leaves storage to the port. The desktop keeps the key in its
    // settings file, which is where a task's subprocess reads it from — there
    // is nowhere else it could live and still work.
    apiKey: input.apiKey?.trim() ?? "",
    model: input.modelId.trim() || input.name.trim(),
  };
}

export function createModelService(api: DesktopAPI): ModelPort {
  return {
    async list() {
      const settings = await api.getSettings();
      return settings.llmProvider ? [OFFICIAL_MODEL, toModel(settings.llmProvider)] : [OFFICIAL_MODEL];
    },

    async addCustom(input) {
      const provider = toProvider(input);
      await api.updateSettings({ llmProvider: provider });
      return toModel(provider);
    },

    async updateCustom(id, input) {
      if (id === OFFICIAL_MODEL.id) {
        throw new Error("The built-in model cannot be edited.");
      }
      const provider = toProvider(input);
      // An update with no key keeps the stored one: the UI never reads a key
      // back, so an edit that only changes the name would otherwise wipe it.
      if (!provider.apiKey) {
        const settings = await api.getSettings();
        provider.apiKey = settings.llmProvider?.apiKey ?? "";
      }
      await api.updateSettings({ llmProvider: provider });
      return toModel(provider);
    },

    async removeCustom(id) {
      if (id === OFFICIAL_MODEL.id) {
        throw new Error("The built-in model cannot be removed.");
      }
      await api.updateSettings({ llmProvider: null });
    },
  };
}

export { OFFICIAL_MODEL, CUSTOM_MODEL_ID };
