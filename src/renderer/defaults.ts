import type { DocumentType, GenerateInput, ProxySettings } from "../shared/types";
import { DOCUMENT_TYPES, getCapability } from "../shared/types";

export type NavKey = "home" | "spreadsheet" | "dialogue" | "settings" | "login";

export const defaultGenerateInput: Partial<GenerateInput> = {
  documentType: "pptx",
  generationMode: "plan",
  enableImages: true,
  imageRatio: "square",
  fps: 16,
};

export const defaultProxySettings: ProxySettings = {
  enabled: false,
  url: "http://127.0.0.1:7890",
};

const PROXY_URL_PATTERN = /^(https?|socks5h?):\/\/[^\s/$.?#].[^\s]*$/i;

export function isValidProxyUrl(url: string): boolean {
  return PROXY_URL_PATTERN.test(url.trim());
}

const newGenerationDocumentTypes: DocumentType[] = DOCUMENT_TYPES.slice();

export function normalizeNewGenerationDocumentType(value: unknown): DocumentType {
  return newGenerationDocumentTypes.includes(value as DocumentType) ? (value as DocumentType) : "pptx";
}

export const documentTypeOptions: Array<{ value: DocumentType; label: string; icon: string }> = newGenerationDocumentTypes.map((type) => {
  const capability = getCapability(type);
  return { value: capability.type, label: capability.label, icon: capability.icon };
});
