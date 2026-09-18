import { ChevronDown, Plus, Zap } from "lucide-react";
import { useMemo, useState } from "react";

import { Input, Modal } from "../../renderer/ui";
import { Menu } from "../chrome/Menu";
import { usePort } from "../port/PortContext";
import type { CustomModelInput, Model } from "../port/types";

export interface ModelMenuProps {
  models: Model[];
  selectedId: string;
  onSelect: (id: string) => void;
  onModelsChanged: () => Promise<void> | void;
}

/**
 * Model choice, plus bring-your-own-model.
 *
 * The API key field is write-only here on purpose: `UiPort.models.addCustom`
 * documents that storage is the port's decision, and the shell never reads a
 * key back or puts one in its own persistence.
 */
export function ModelMenu({ models, selectedId, onSelect, onModelsChanged }: ModelMenuProps) {
  const [editing, setEditing] = useState<Model | "new" | null>(null);
  const selected = models.find((model) => model.id === selectedId) ?? models[0];

  const items = useMemo(
    () => [
      ...models.map((model) => ({
        id: model.id,
        label: model.name,
        description: [model.provider, model.detail].filter(Boolean).join(" · "),
        checked: model.id === selected?.id,
        onSelect: () => onSelect(model.id),
      })),
      {
        id: "add-model",
        label: "Add model…",
        description: "Point the shell at your own endpoint",
        icon: <Plus size={16} strokeWidth={1.8} aria-hidden="true" />,
        onSelect: () => setEditing("new"),
      },
    ],
    [models, selected?.id, onSelect],
  );

  return (
    <>
      <Menu label="Model" items={items} align="end" width={280}>
        {(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            className="shell-cx-button shell-cx-model"
            title={`Model: ${selected?.name ?? "none"}`}
          >
            <Zap size={13} strokeWidth={1.7} aria-hidden="true" />
            <span className="shell-cx-model-name">{selected?.name ?? "No model"}</span>
            <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
      </Menu>

      {editing ? (
        <CustomModelDialog
          model={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onModelsChanged}
        />
      ) : null}
    </>
  );
}

const PROVIDERS = ["OpenAI", "Anthropic", "Kimi", "DeepSeek", "Custom"];

function CustomModelDialog({
  model,
  onClose,
  onSaved,
}: {
  model: Model | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const port = usePort();
  const [form, setForm] = useState<CustomModelInput>({
    name: model?.name ?? "",
    modelId: "",
    provider: model?.provider ?? "Custom",
    baseUrl: "",
    apiKey: "",
  });
  const [error, setError] = useState("");

  const patch = (next: Partial<CustomModelInput>) => {
    setForm((current) => ({ ...current, ...next }));
    setError("");
  };

  const save = async () => {
    if (!form.name.trim()) return setError("Enter a display name.");
    if (!form.modelId.trim()) return setError("Enter the model ID from your provider.");
    if (/\s/.test(form.modelId.trim())) return setError("Model ID cannot contain spaces.");
    if (form.baseUrl.trim()) {
      try {
        const url = new URL(form.baseUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.search) throw new Error();
      } catch {
        return setError("Use an http or https URL without credentials or query parameters.");
      }
    }
    if (model) await port.models.updateCustom(model.id, form);
    else await port.models.addCustom(form);
    await onSaved();
    onClose();
  };

  return (
    <Modal
      open
      title={model ? "Edit model" : "Add model"}
      okText="Save model"
      onOk={save}
      onCancel={onClose}
      width={480}
    >
      <p className="shell-dialog-note">
        The shell only records which model you picked. Where the key is kept is the desktop app’s
        decision — nothing is stored in this window.
      </p>

      <label className="shell-dialog-label" htmlFor="shell-model-name">
        Display name
      </label>
      <Input
        id="shell-model-name"
        value={form.name}
        autoFocus
        onChange={(event) => patch({ name: event.target.value })}
      />

      <label className="shell-dialog-label" htmlFor="shell-model-id">
        Model ID
      </label>
      <Input
        id="shell-model-id"
        value={form.modelId}
        placeholder="gpt-6-astra"
        onChange={(event) => patch({ modelId: event.target.value })}
      />

      <label className="shell-dialog-label" htmlFor="shell-model-provider">
        Provider
      </label>
      <select
        id="shell-model-provider"
        className="shell-dialog-select"
        value={form.provider}
        onChange={(event) => patch({ provider: event.target.value })}
      >
        {PROVIDERS.map((provider) => (
          <option key={provider} value={provider}>
            {provider}
          </option>
        ))}
      </select>

      <label className="shell-dialog-label" htmlFor="shell-model-base">
        Base URL <span>optional</span>
      </label>
      <Input
        id="shell-model-base"
        value={form.baseUrl}
        placeholder="https://api.example.com/v1"
        onChange={(event) => patch({ baseUrl: event.target.value })}
      />

      <label className="shell-dialog-label" htmlFor="shell-model-key">
        API key <span>not stored by this window</span>
      </label>
      <Input
        id="shell-model-key"
        type="password"
        value={form.apiKey ?? ""}
        onChange={(event) => patch({ apiKey: event.target.value })}
      />

      <p className="shell-dialog-error" role="alert">
        {error}
      </p>
    </Modal>
  );
}
