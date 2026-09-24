import type { DesktopAPI, LlmProvider, LlmProviderType } from "../shared/types";
import type { CustomModelInput, Model, ModelPort } from "../shared/uiPort";
import { translate } from "../renderer/i18n";

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
      const official = { ...OFFICIAL_MODEL, detail: translate("shell.service.model.officialDetail") };
      return settings.llmProvider ? [official, toModel(settings.llmProvider)] : [official];
    },

    async addCustom(input) {
      const provider = toProvider(input);
      await api.updateSettings({ llmProvider: provider });
      return toModel(provider);
    },

    async updateCustom(id, input) {
      if (id === OFFICIAL_MODEL.id) {
        throw new Error(translate("shell.service.model.builtinNotEditable"));
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

    /**
     * Makes a model the one tasks actually run on.
     *
     * With a single stored provider this is not a choice between rows, it is
     * whether `llmProvider` is set at all: the official model *is* the absence
     * of a configured provider — the same write `removeCustom` makes — and the
     * custom entry is whatever is already stored.
     *
     * So selecting the custom entry has nothing to write, and the mistake to
     * avoid is writing anyway. A provider rebuilt here would have to come from
     * a `CustomModelInput` this call does not receive, which means guessing the
     * base URL and dropping the stored key.
     *
     * An unknown id throws rather than quietly doing nothing. The picker spent
     * its whole life renaming a button while every run used the configured
     * provider regardless; a silent no-op would put that back with extra steps.
     */
    async select(id) {
      if (id === OFFICIAL_MODEL.id) {
        await api.updateSettings({ llmProvider: null });
        return;
      }
      if (id !== CUSTOM_MODEL_ID) {
        throw new Error(`Unknown model: ${id}`);
      }
      const settings = await api.getSettings();
      if (!settings.llmProvider) {
        throw new Error(translate("shell.service.model.notConfigured"));
      }
    },

    async removeCustom(id) {
      if (id === OFFICIAL_MODEL.id) {
        throw new Error(translate("shell.service.model.builtinNotRemovable"));
      }
      await api.updateSettings({ llmProvider: null });
    },
  };
}

export { OFFICIAL_MODEL, CUSTOM_MODEL_ID };
