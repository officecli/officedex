import { Fragment, isValidElement } from "react";
import type { ReactNode } from "react";

export interface MenuNodeInput {
  readonly key: string;
  readonly type?: "group" | "divider";
  readonly label?: ReactNode;
  readonly desc?: ReactNode;
  readonly disabled?: boolean;
  readonly active?: boolean;
  readonly info?: ReactNode;
  readonly icon?: ReactNode;
  readonly items?: readonly MenuNodeInput[];
  readonly submenu?: { readonly items?: readonly MenuNodeInput[] };
  readonly onClick?: (event: unknown) => void;
  readonly render?: (context: {
    readonly active: boolean;
    readonly itemProps: Record<string, unknown>;
    readonly itemRef: null;
  }) => ReactNode;
}

function MenuNodes({ items }: { readonly items: readonly MenuNodeInput[] }) {
  return (
    <>
      {items.map((item) => {
        if (item.type === "divider") {
          return <hr key={item.key} role="separator" />;
        }
        if (item.type === "group") {
          return (
            <section key={item.key} className="officedex-presentation-menu__group">
              {item.label ? <div>{item.label}</div> : null}
              <MenuNodes items={item.items ?? []} />
            </section>
          );
        }
        if (item.render) {
          return (
            <Fragment key={item.key}>
              {item.render({
                active: item.active === true,
                itemProps: {
                  role: "menuitem",
                  "data-menu-item-key": item.key,
                },
                itemRef: null,
              })}
            </Fragment>
          );
        }
        const children = item.submenu?.items ?? [];
        return (
          <div key={item.key} className="officedex-presentation-menu__item">
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-pressed={item.active}
              onClick={item.onClick}
            >
              {isValidElement(item.icon) ? item.icon : null}
              <span>{item.label ?? item.key}</span>
              {item.info ? <small>{item.info}</small> : null}
            </button>
            {children.length > 0 ? <MenuNodes items={children} /> : null}
          </div>
        );
      })}
    </>
  );
}

export function Menu(props: {
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly items?: readonly MenuNodeInput[];
}) {
  return (
    <div
      role="menu"
      aria-label={props.ariaLabel}
      className={props.className}
      data-officedex-presentation-menu="true"
    >
      <MenuNodes items={props.items ?? []} />
    </div>
  );
}

export type MenuItemRenderContext = {
  readonly active: boolean;
  readonly itemProps: Record<string, unknown>;
  readonly itemRef: null;
};

