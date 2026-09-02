import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ComponentType,
  CSSProperties,
  ReactNode,
} from "react";

export interface ToolbarActionContext {
  readonly item?: ToolbarItemDescriptor;
  readonly itemId?: string;
  readonly value?: unknown;
  readonly event?: unknown;
}
export type ToolbarActionsConfig = Record<
  string,
  (context: ToolbarActionContext) => unknown
>;
export interface ToolbarItemDescriptor {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly hidden?: boolean;
  readonly icon?: unknown;
  readonly width?: string;
  readonly minWidth?: string;
  readonly dataset?: Record<string, unknown>;
  readonly props?: Record<string, unknown>;
  readonly meta?: Record<string, unknown>;
  readonly [key: string]: unknown;
}
export interface ToolbarSection {
  readonly id: string;
  readonly label?: string;
  readonly items: readonly ToolbarItemDescriptor[];
  readonly meta?: Record<string, unknown>;
}
export interface ToolbarSchema {
  readonly variant?: string;
  readonly sections: readonly ToolbarSection[];
  readonly [key: string]: unknown;
}
export interface ToolbarKitStore {
  getSchema(): ToolbarSchema | null;
  getActions(): ToolbarActionsConfig;
  setSchema(schema?: ToolbarSchema | null): void;
  setActions(actions?: ToolbarActionsConfig): void;
  updateItem(patches: Record<string, Record<string, unknown>>): void;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}
export interface ToolbarKitApi {
  readonly store?: ToolbarKitStore;
}
export type ToolbarCustomItemComponent = ComponentType<{
  readonly item: ToolbarItemDescriptor;
}>;
export type ToolbarCustomItemDescriptor = ToolbarItemDescriptor;
export type ToolbarCustomToolbarItems = Record<
  string,
  ToolbarCustomItemComponent
>;

export function createToolbarKitStore(options: {
  readonly schema?: ToolbarSchema | null;
  readonly actions?: ToolbarActionsConfig;
} = {}): ToolbarKitStore {
  let schema = options.schema ?? null;
  let actions = options.actions ?? {};
  let version = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    version += 1;
    for (const listener of listeners) listener();
  };
  return {
    getSchema: () => schema,
    getActions: () => actions,
    setSchema(next) {
      schema = next ?? null;
      emit();
    },
    setActions(next) {
      actions = next ?? {};
      emit();
    },
    updateItem(patches) {
      if (!schema) return;
      schema = {
        ...schema,
        sections: schema.sections.map((section) => ({
          ...section,
          items: section.items.map((item) => {
            const patch = patches[item.id];
            if (!patch) return item;
            return {
              ...item,
              ...patch,
              props:
                patch.props && typeof patch.props === "object"
                  ? { ...(item.props ?? {}), ...patch.props }
                  : item.props,
              meta:
                patch.meta && typeof patch.meta === "object"
                  ? { ...(item.meta ?? {}), ...patch.meta }
                  : item.meta,
            };
          }),
        })),
      };
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion: () => version,
  };
}

function bindItemActions(
  item: ToolbarItemDescriptor,
  actions: ToolbarActionsConfig,
): ToolbarItemDescriptor {
  const props = { ...(item.props ?? {}) };
  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== "string" || !actions[value]) continue;
    props[key] = (nextValue: unknown, event?: unknown) =>
      actions[value]({ item, itemId: item.id, value: nextValue, event });
  }
  return { ...item, props };
}

function ItemIcon({ item }: { readonly item: ToolbarItemDescriptor }) {
  const icon = item.icon as
    | { readonly type?: string; readonly component?: ComponentType }
    | undefined;
  const Icon = icon?.type === "svg" ? icon.component : undefined;
  return Icon ? <Icon /> : null;
}

function StandardItem({
  item,
  actions,
  onFloatingOpenChange,
}: {
  readonly item: ToolbarItemDescriptor;
  readonly actions: ToolbarActionsConfig;
  readonly onFloatingOpenChange?: (itemId: string, open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const props = item.props ?? {};
  const invoke = (value?: unknown, event?: unknown) => {
    const actionId =
      typeof props.onClick === "string"
        ? props.onClick
        : typeof props.onChange === "string"
          ? props.onChange
          : undefined;
    if (actionId) actions[actionId]?.({ item, itemId: item.id, value, event });
  };
  const style: CSSProperties = {
    width: item.width,
    minWidth: item.minWidth,
  };

  if (item.type === "select") {
    const options = Array.isArray(props.options)
      ? (props.options as Array<{ value?: unknown; label?: unknown }>)
      : [];
    return (
      <select
        aria-label={item.label}
        disabled={item.disabled}
        style={style}
        value={String(props.value ?? "")}
        onChange={(event) => invoke(event.target.value, event)}
      >
        {props.placeholder ? <option value="">{String(props.placeholder)}</option> : null}
        {options.map((option, index) => (
          <option key={String(option.value ?? index)} value={String(option.value ?? "")}>
            {String(option.label ?? option.value ?? "")}
          </option>
        ))}
      </select>
    );
  }
  if (item.type === "checkbox") {
    return (
      <label style={style}>
        <input
          type="checkbox"
          disabled={item.disabled}
          checked={props.checked === true}
          onChange={(event) => invoke(event.target.checked, event)}
        />
        {item.label}
      </label>
    );
  }
  if (item.type === "input-number") {
    return (
      <label style={style}>
        <span>{item.label}</span>
        <input
          type="number"
          disabled={item.disabled}
          value={typeof props.value === "number" ? props.value : ""}
          onChange={(event) => invoke(Number(event.target.value), event)}
        />
      </label>
    );
  }
  if (item.type === "color-picker") {
    return (
      <label style={style}>
        <span>{item.label}</span>
        <input
          type="color"
          disabled={item.disabled}
          value={typeof props.value === "string" ? props.value : "#000000"}
          onChange={(event) => invoke(event.target.value, event)}
        />
      </label>
    );
  }
  if (item.type === "divider") return <span role="separator" />;

  const isDropdown = item.type === "dropdown-button";
  const renderMenu = props.renderMenu as
    | ((context: { closeMenu: () => void }) => ReactNode)
    | undefined;
  return (
    <div className="officedex-presentation-toolbar__item" style={style}>
      <button
        type="button"
        disabled={item.disabled}
        aria-label={item.label}
        aria-expanded={isDropdown ? open : undefined}
        data-role="toolbar-item"
        data-item-id={item.id}
        onClick={(event) => {
          invoke(undefined, event);
          if (!isDropdown) return;
          const next = !open;
          setOpen(next);
          onFloatingOpenChange?.(item.id, next);
        }}
      >
        <ItemIcon item={item} />
        <span>{item.label}</span>
      </button>
      {open && renderMenu ? (
        <div className="officedex-presentation-toolbar__floating">
          {renderMenu({
            closeMenu: () => {
              setOpen(false);
              onFloatingOpenChange?.(item.id, false);
            },
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ToolbarKit(props: {
  readonly schema?: ToolbarSchema | null;
  readonly actions?: ToolbarActionsConfig;
  readonly store?: ToolbarKitStore;
  readonly customToolbarItems?: ToolbarCustomToolbarItems;
  readonly onReady?: (api: ToolbarKitApi) => void;
  readonly onItemFloatingOpenChange?: (itemId: string, open: boolean) => void;
}) {
  const fallbackStore = useMemo(() => createToolbarKitStore(), []);
  const store = props.store ?? fallbackStore;
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const schema = props.schema ?? store.getSchema();
  const actions = props.actions ?? store.getActions();

  useEffect(() => {
    props.onReady?.({ store });
  }, [props.onReady, store]);

  if (!schema) return null;
  return (
    <div
      className="officedex-presentation-toolbar"
      data-role="toolbar-viewport"
      role="toolbar"
    >
      {schema.sections.map((section) => (
        <section
          key={section.id}
          className="toolbar-section"
          data-role="toolbar-section"
          data-section-id={section.id}
          aria-label={section.label}
        >
          <div className="toolbar-section__body">
            {section.items
              .filter((item) => !item.hidden)
              .map((item) => {
                const resolved = bindItemActions(item, actions);
                const Custom = props.customToolbarItems?.[item.type];
                return Custom ? (
                  <Custom key={item.id} item={resolved} />
                ) : (
                  <StandardItem
                    key={item.id}
                    item={item}
                    actions={actions}
                    onFloatingOpenChange={props.onItemFloatingOpenChange}
                  />
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

