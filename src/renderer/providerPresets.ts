import type { LlmProviderType } from "../shared/types";

export interface ProviderPreset {
  defaultBaseUrl: string;
  defaultModel: string;
}

export const providerPresets: Record<LlmProviderType, ProviderPreset> = {
  openai: {
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  anthropic: {
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-6",
  },
  azure: {
    defaultBaseUrl: "",
    defaultModel: "",
  },
  custom: {
    defaultBaseUrl: "",
    defaultModel: "",
  },
};
