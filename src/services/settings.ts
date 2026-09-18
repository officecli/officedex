import type { DesktopAPI, UserSettings } from "../shared/types";
import type { PermissionMode, SettingsPort, ShellSettings } from "../shared/uiPort";

/**
 * Shell settings over the desktop's own.
 *
 * Only `selectedModelId` has a counterpart on disk today — it is the configured
 * LLM provider's model. The other four are the new IA's and the desktop has no
 * field for them, so they live in localStorage under one key.
 *
 * That split is deliberate rather than lazy: `permission`, `enterToSend`,
 * `customInstructions` and `reduceMotion` are per-window UI preferences, and
 * the desktop's settings file is synced state that a running task reads. Mixing
 * them would make a checkbox invalidate a provider probe.
 */
const SHELL_SETTINGS_KEY = "officedex.shell.settings";

const DEFAULTS: ShellSettings = {
  permission: "review",
  enterToSend: true,
  customInstructions: "",
  reduceMotion: false,
  selectedModelId: "",
};

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "review" || value === "full" || value === "custom";
}

/** Reads the locally stored half, ignoring anything it does not recognise. */
function readLocal(): Partial<ShellSettings> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(SHELL_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<ShellSettings> = {};
    if (isPermissionMode(parsed.permission)) out.permission = parsed.permission;
    if (typeof parsed.enterToSend === "boolean") out.enterToSend = parsed.enterToSend;
    if (typeof parsed.customInstructions === "string") out.customInstructions = parsed.customInstructions;
    if (typeof parsed.reduceMotion === "boolean") out.reduceMotion = parsed.reduceMotion;
    return out;
  } catch {
    // A corrupt value is not worth failing a settings read over; the defaults
    // are all usable.
    return {};
  }
}

function writeLocal(settings: ShellSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({
      permission: settings.permission,
      enterToSend: settings.enterToSend,
      customInstructions: settings.customInstructions,
      reduceMotion: settings.reduceMotion,
    }));
  } catch {
    // Private mode or a full quota: the in-memory choice still applies for
    // this session.
  }
}

/** The desktop's configured model, which is what `selectedModelId` names. */
function selectedModelIdOf(settings: UserSettings): string {
  return settings.llmProvider?.model?.trim() ?? "";
}

export function createSettingsService(api: DesktopAPI): SettingsPort {
  let cached: ShellSettings | null = null;

  async function load(): Promise<ShellSettings> {
    const desktop = await api.getSettings();
    return { ...DEFAULTS, ...readLocal(), selectedModelId: selectedModelIdOf(desktop) };
  }

  return {
    async get() {
      cached ??= await load();
      return { ...cached };
    },

    async patch(patch) {
      const current = cached ?? (await load());
      const next: ShellSettings = { ...current, ...patch };

      // Choosing a model rewrites the desktop's provider; the rest is local.
      if (patch.selectedModelId !== undefined && patch.selectedModelId !== current.selectedModelId) {
        const desktop = await api.getSettings();
        if (desktop.llmProvider) {
          await api.updateSettings({
            llmProvider: { ...desktop.llmProvider, model: patch.selectedModelId },
          });
        }
        // With no custom provider configured the app is on the official one and
        // there is no model field to write. The choice is still remembered for
        // this session so the UI does not silently revert the user's click.
      }
      writeLocal(next);
      cached = next;
      return { ...cached };
    },
  };
}
