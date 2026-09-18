import { useCallback, useEffect, useState } from "react";

import { usePort } from "../port/PortContext";
import type { Model, ShellSettings } from "../port/types";

const FALLBACK: ShellSettings = {
  permission: "review",
  enterToSend: true,
  customInstructions: "",
  reduceMotion: false,
  selectedModelId: "",
};

/**
 * Composer-facing settings and model list.
 *
 * These live behind the port rather than in the shell's own persistence: which
 * model you use and how much the agent may do without asking are properties of
 * the workspace, not of this window, so they must survive a reinstall of the
 * UI and be readable by the service side.
 */
export function useComposerSettings() {
  const port = usePort();
  const [value, setValue] = useState<ShellSettings>(FALLBACK);
  const [models, setModels] = useState<Model[]>([]);

  const reloadModels = useCallback(async () => {
    setModels(await port.models.list());
  }, [port]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [settings, list] = await Promise.all([port.settings.get(), port.models.list()]);
      if (cancelled) return;
      setModels(list);
      // A settings payload can name a model that no longer exists (removed on
      // another device); fall back rather than showing an empty model button.
      setValue(
        list.some((model) => model.id === settings.selectedModelId)
          ? settings
          : { ...settings, selectedModelId: list[0]?.id ?? "" },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [port]);

  const patch = useCallback(
    async (next: Partial<ShellSettings>) => {
      setValue((current) => ({ ...current, ...next }));
      setValue(await port.settings.patch(next));
    },
    [port],
  );

  return { value, models, patch, reloadModels };
}
