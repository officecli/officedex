import { ChevronDown, Pencil, Plus, Zap } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Input, Modal } from "../../renderer/ui";
import { useT } from "../../renderer/i18n";
import { Menu } from "../chrome/Menu";
import { usePort } from "../port/PortContext";
import { attempt } from "../port/reportPortFailure";
import type { CustomModelInput, Model } from "../../shared/uiPort";

export interface ModelMenuProps {
  models: Model[];
  selectedId: string;
  /** Records the pick. Making it take effect is `models.select`, below. */
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
  const t = useT();
  const port = usePort();
  const [editing, setEditing] = useState<Model | "new" | null>(null);
  const selected = models.find((model) => model.id === selectedId) ?? models[0];

  /**
   * The one custom model, if there is one.
   *
   * Singular because the desktop stores a single provider — services/models.ts
   * says so in its file comment, and it is why Add replaces rather than appends.
   */
  const configuredCustom = models.find((model) => model.custom) ?? null;

  /*
   * Two calls, in this order, doing two different jobs. `select` makes the pick
   * take effect — on the desktop it decides which provider a run is launched
   * against — and `onSelect` records what the user chose.
   *
   * Only the record existed. Every message carried a `modelId` that
   * `agent.send` never read and `GenerateInput` has no field for, so picking a
   * model renamed a button and every task kept running on whatever provider was
   * configured. Recording only once `select` resolves is the other half of
   * that: a button naming a model no run will use is the same lie in reverse.
   */
  const choose = useCallback(
    async (id: string) => {
      if (await attempt(() => port.models.select(id))) onSelect(id);
    },
    [port, onSelect],
  );

  const items = useMemo(
    () => [
      ...models.map((model) => ({
        id: model.id,
        label: model.name,
        description: [model.provider, model.detail].filter(Boolean).join(" · "),
        checked: model.id === selected?.id,
        onSelect: () => void choose(model.id),
      })),
      /*
       * Edit is a row of its own because `setEditing` was only ever called with
       * "new": `CustomModelDialog`'s whole update branch — `models.updateCustom`
       * — was unreachable, so a rotated key or a moved endpoint could only be
       * fixed by adding the model over again.
       *
       * A row rather than a pencil inside the model's own row: `Menu` renders
       * exactly one action per item, and a second control in one would mean
       * teaching the shell's only menu primitive a concept it does not have.
       */
      ...(configuredCustom
        ? [
            {
              id: `edit-${configuredCustom.id}`,
              label: t("shell.modelMenu.edit", { name: configuredCustom.name }),
              description: t("shell.modelMenu.editDescription"),
              icon: <Pencil size={16} strokeWidth={1.8} aria-hidden="true" />,
              onSelect: () => setEditing(configuredCustom),
            },
          ]
        : []),
      {
        id: "add-model",
        label: configuredCustom ? t("shell.modelMenu.replace") : t("shell.modelMenu.add"),
        description: configuredCustom
          ? t("shell.modelMenu.replaceDescription", { name: configuredCustom.name })
          : t("shell.modelMenu.addDescription"),
        icon: <Plus size={16} strokeWidth={1.8} aria-hidden="true" />,
        onSelect: () => setEditing("new"),
      },
    ],
    [models, selected?.id, configuredCustom, choose, t],
  );

  return (
    <>
      <Menu label={t("shell.modelMenu.menu")} items={items} align="end" width={280}>
        {(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            className="shell-cx-button shell-cx-model"
            title={t("shell.modelMenu.title", { name: selected?.name ?? t("shell.modelMenu.none") })}
          >
            <Zap size={13} strokeWidth={1.7} aria-hidden="true" />
            <span className="shell-cx-model-name">{selected?.name ?? t("shell.modelMenu.noModel")}</span>
            <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
      </Menu>

      {editing ? (
        <CustomModelDialog
          model={editing === "new" ? null : editing}
          /*
           * What adding costs, said before it happens rather than discovered
           * afterwards. One stored provider means a second custom model
           * overwrites the first, and the dialog used to let that happen in
           * silence: the previous entry simply stopped being in the menu.
           */
          replaces={editing === "new" ? configuredCustom : null}
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
  replaces,
  onClose,
  onSaved,
}: {
  model: Model | null;
  replaces: Model | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const t = useT();
  const port = usePort();
  const [form, setForm] = useState<CustomModelInput>({
    name: model?.name ?? "",
    /*
     * `Model` carries no provider-side id. The desktop reports the configured
     * provider's model *as* the display name (services/models.ts `toModel`),
     * which is the only place an edit can recover it from — and recovering it
     * matters, because `updateCustom` writes whatever this form holds. A name
     * with whitespace in it is a label from some other port rather than an id,
     * so it is left blank instead of prefilling a value that would then fail
     * this dialog's own validation.
     */
    modelId: model && !/\s/.test(model.name) ? model.name : "",
    // Case-insensitive because the desktop stores the type lowercased; an exact
    // match would leave the select showing the wrong provider on every edit.
    provider:
      PROVIDERS.find((entry) => entry.toLowerCase() === model?.provider.toLowerCase()) ?? "Custom",
    // `detail` is the base URL. Prefilled so an edit that only renames the model
    // does not quietly clear the endpoint it is pointed at.
    baseUrl: model?.detail ?? "",
    apiKey: "",
  });
  const [error, setError] = useState("");

  const patch = (next: Partial<CustomModelInput>) => {
    setForm((current) => ({ ...current, ...next }));
    setError("");
  };

  const save = async () => {
    if (!form.name.trim()) return setError(t("shell.modelMenu.errorName"));
    if (!form.modelId.trim()) return setError(t("shell.modelMenu.errorModelId"));
    if (/\s/.test(form.modelId.trim())) return setError(t("shell.modelMenu.errorModelIdSpaces"));
    if (form.baseUrl.trim()) {
      try {
        const url = new URL(form.baseUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.search) throw new Error();
      } catch {
        return setError(t("shell.modelMenu.errorBaseUrl"));
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
      title={model ? t("shell.modelMenu.dialogEdit") : t("shell.modelMenu.dialogAdd")}
      okText={t("shell.modelMenu.save")}
      onOk={save}
      onCancel={onClose}
      width={480}
    >
      <p className="shell-dialog-note">
        {t("shell.modelMenu.note")}
      </p>

      {replaces ? (
        <p className="shell-dialog-warning">
          {t("shell.modelMenu.replacesLead")} <strong>{replaces.name}</strong>{t("shell.modelMenu.replacesTail")}
        </p>
      ) : null}

      <label className="shell-dialog-label" htmlFor="shell-model-name">
        {t("shell.modelMenu.name")}
      </label>
      <Input
        id="shell-model-name"
        value={form.name}
        autoFocus
        onChange={(event) => patch({ name: event.target.value })}
      />

      <label className="shell-dialog-label" htmlFor="shell-model-id">
        {t("shell.modelMenu.modelId")}
      </label>
      <Input
        id="shell-model-id"
        value={form.modelId}
        placeholder="gpt-6-astra"
        onChange={(event) => patch({ modelId: event.target.value })}
      />

      <label className="shell-dialog-label" htmlFor="shell-model-provider">
        {t("shell.modelMenu.provider")}
      </label>
      <select
        id="shell-model-provider"
        className="shell-dialog-select"
        value={form.provider}
        onChange={(event) => patch({ provider: event.target.value })}
      >
        {PROVIDERS.map((provider) => (
          <option key={provider} value={provider}>
            {provider === "Custom" ? t("shell.cx.permission.custom") : provider}
          </option>
        ))}
      </select>

      <label className="shell-dialog-label" htmlFor="shell-model-base">
        {t("shell.modelMenu.baseUrl")} <span>{t("shell.modelMenu.optional")}</span>
      </label>
      <Input
        id="shell-model-base"
        value={form.baseUrl}
        placeholder="https://api.example.com/v1"
        onChange={(event) => patch({ baseUrl: event.target.value })}
      />

      <label className="shell-dialog-label" htmlFor="shell-model-key">
        {t("shell.modelMenu.apiKey")} <span>{t("shell.modelMenu.apiKeyHint")}</span>
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
