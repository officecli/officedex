import { useCallback, useEffect, useRef, useState } from "react";
import { officecli } from "./bridge";
import type { UserSettings } from "../shared/types";

const FALLBACK: UserSettings = {
  version: 1,
  defaults: {
    documentType: "pptx",
    mode: "fast",
    runtimeMode: "hosted",
    enableImages: true,
    imageQuality: "standard",
  },
  outputDir: null,
  bridgeBinaryPath: null,
  llmProvider: null,
  onboardingCompletedAt: null,
};

export interface UseSettingsResult {
  settings: UserSettings;
  defaultWorkspaceDir: string;
  update: (patch: Partial<UserSettings>) => Promise<UserSettings>;
  loading: boolean;
  saving: boolean;
  error?: string;
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<UserSettings>(FALLBACK);
  const [defaultWorkspaceDir, setDefaultWorkspaceDir] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    Promise.all([officecli.getSettings(), officecli.getDefaultWorkspaceDir()])
      .then(([result, workspace]) => {
        if (!mountedRef.current) return;
        setSettings(result);
        setDefaultWorkspaceDir(workspace);
        setError(undefined);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setLoading(false);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const update = useCallback(async (patch: Partial<UserSettings>): Promise<UserSettings> => {
    setSaving(true);
    try {
      const next = await officecli.updateSettings(patch);
      if (mountedRef.current) {
        setSettings(next);
        setError(undefined);
      }
      return next;
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
      throw err;
    } finally {
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }, []);

  return { settings, defaultWorkspaceDir, update, loading, saving, error };
}
