import { useCallback, useEffect, useState } from "react";
import { Tag, Tooltip } from "antd";
import { ThunderboltOutlined, CloudOutlined, ClockCircleOutlined } from "@ant-design/icons";
import { officecli } from "../bridge";
import { useT } from "../i18n";
import type { BridgeRuntimeSnapshot, UserSettings } from "../../shared/types";

const SETTINGS_UPDATED = "officedex:settings-updated";
const BRIDGE_EVENT = "bridge:event";

interface RuntimeChipProps {
  onClick?: () => void;
}

export function RuntimeChip({ onClick }: RuntimeChipProps) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<BridgeRuntimeSnapshot | null>(null);

  const refresh = useCallback(() => {
    officecli
      .getBridgeRuntimeSnapshot()
      .then((snap) => setSnapshot(snap))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const onSettings = (_: Event) => refresh();
    window.addEventListener(SETTINGS_UPDATED, onSettings);
    // Re-fetch when a task starts so the chip flips from pending → applied
    // without the user navigating away from this view.
    const unsubBridge = officecli.onBridgeEvent((event) => {
      if (event.type === "task.started") refresh();
    });
    return () => {
      window.removeEventListener(SETTINGS_UPDATED, onSettings);
      unsubBridge();
    };
  }, [refresh]);

  if (!snapshot) return null;

  if (snapshot.runtimeMode === "hosted") {
    return (
      <Tooltip title={t("runtime.chip.tooltip.official")}>
        <Tag
          color="success"
          icon={<CloudOutlined />}
          className="runtime-chip runtime-chip-hosted"
          onClick={onClick}
          style={onClick ? { cursor: "pointer" } : undefined}
        >
          {t("runtime.chip.official")}
        </Tag>
      </Tooltip>
    );
  }

  if (!snapshot.envApplied || !snapshot.provider) {
    return (
      <Tooltip title={t("runtime.chip.tooltip.pending")}>
        <Tag
          color="warning"
          icon={<ClockCircleOutlined />}
          className="runtime-chip runtime-chip-pending"
          onClick={onClick}
          style={onClick ? { cursor: "pointer" } : undefined}
        >
          {t("runtime.chip.pending")}
        </Tag>
      </Tooltip>
    );
  }

  const { provider } = snapshot;
  const label = provider.model
    ? t("runtime.chip.custom").replace("{model}", provider.model)
    : t("runtime.chip.customNoModel");
  const tooltip = t("runtime.chip.tooltip.custom").replace("{host}", provider.baseUrlHost || provider.type);
  return (
    <Tooltip title={tooltip}>
      <Tag
        color="processing"
        icon={<ThunderboltOutlined />}
        className="runtime-chip runtime-chip-custom"
        onClick={onClick}
        style={onClick ? { cursor: "pointer" } : undefined}
      >
        {label}
      </Tag>
    </Tooltip>
  );
}

// Re-export for tests that want to fabricate a snapshot.
export type { BridgeRuntimeSnapshot, UserSettings };
