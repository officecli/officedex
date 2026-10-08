import type { DesktopAPI, UserSettings } from "../shared/types";
import type { PermissionMode, SettingsPort, ShellSettings } from "../shared/uiPort";
import { CUSTOM_MODEL_ID, OFFICIAL_MODEL } from "./models";

/**
 * Shell settings over the desktop's own.
 *
 * Only `selectedModelId` has a counterpart on disk today — it is derived from
 * the configured LLM provider. The other four are the new IA's and the desktop
 * has no field for them, so they live in localStorage under one key.
 *
 * That split is deliberate rather than lazy: `permission`, `enterToSend`,
 * `customInstructions` and `reduceMotion` are per-window UI preferences, and
 * the desktop's settings file is synced state that a running task reads. Mixing
 * them would make a checkbox invalidate a provider probe.
 */
const SHELL_SETTINGS_KEY = "officedex.shell.settings";

/**
 * The permission modes that mean something to the runtime — currently one.
 *
 * `unsupportedParts()` in agent.ts downgrades `review` and `custom` to a direct
 * write and mentions it in a notice *after* the message has gone out, so a
 * stored `review` promises a gate that never existed. `custom` is worse: no
 * screen in this app can write `customInstructions`, so choosing it has always
 * meant choosing no instructions.
 *
 * Enforced on read rather than migrated on write, because the set shrinks and
 * grows with what the runtime supports: a value stored by an older build, or by
 * a control elsewhere in the app, must not come back as a promise this layer
 * cannot keep.
 */
const SUPPORTED_PERMISSIONS: readonly PermissionMode[] = ["full"];

const DEFAULTS: ShellSettings = {
  permission: "full",
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
    if (isPermissionMode(parsed.permission) && SUPPORTED_PERMISSIONS.includes(parsed.permission)) {
      out.permission = parsed.permission;
    }
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

/**
 * Which model the desktop is on, in the id space `ModelPort.list` reports.
 *
 * Not `llmProvider.model`: that is the provider's own identifier
 * ("gpt-6-astra"), while the list reports the configured provider under the
 * fixed id `custom`. Returning the former made `selectedModelId` name a model
 * that was never in the list, so the composer fell back to the first row on
 * every load — and a patch then wrote the literal string "custom" into the
 * provider's model field.
 */
function selectedModelIdOf(settings: UserSettings): string {
  return settings.llmProvider ? CUSTOM_MODEL_ID : OFFICIAL_MODEL.id;
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

      /*
       * Every field here is local, `selectedModelId` included.
       *
       * It used to rewrite `llmProvider.model` from the patched value, which
       * was two mistakes at once: the value is a list id (`official` /
       * `custom`), not a provider model name, and repointing the provider is
       * `models.select`'s job. Recording the pick and making it take effect are
       * two calls on purpose — see `ModelPort.select`.
       */
      writeLocal(next);
      cached = next;
      return { ...cached };
    },
  };
}
