import { Children, isValidElement, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { Popover } from "./Popover";
import { CheckOutlined } from "../icons";

export interface MenuItem {
  readonly key?: string;
  readonly label?: ReactNode;
  /** Secondary line, for choices whose difference is not obvious from the label. */
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  /**
   * Marks a menu that is a choice rather than a list of commands. Passing it at
   * all switches the item to a radio role, so assistive tech announces which
   * option is current instead of reading a list of unrelated actions.
   */
  readonly selected?: boolean;
  readonly type?: "divider" | "section";
}

export interface MenuClickInfo { readonly key: string; readonly domEvent: MouseEvent<HTMLButtonElement> }
export interface MenuProps { readonly items?: readonly MenuItem[]; readonly onClick?: (info: MenuClickInfo) => void }
export interface DropdownProps {
  readonly menu: MenuProps;
  readonly children: ReactElement;
  readonly trigger?: readonly ("click" | "hover")[];
  readonly placement?: "top" | "right" | "bottom" | "left" | "bottomRight";
}

export function Dropdown({ menu, children, placement = "bottom" }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const child = Children.only(children);
  if (!isValidElement(child)) return null;
  // A menu whose items carry a leading icon reserves the slot on every row, so
  // labels stay on one left edge instead of stepping in and out.
  const hasIcons = (menu.items ?? []).some((item) => item.icon);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement={placement === "bottomRight" ? "bottom" : placement}
      trigger={[]}
      content={
        <div className={`ui-menu${hasIcons ? " ui-menu--with-icons" : ""}`} role="menu">
          {(menu.items ?? []).map((item, index) => {
            if (item.type === "divider") return <div className="ui-menu__divider" key={`divider-${index}`} role="separator" />;
            if (item.type === "section") return <div className="ui-menu__section" key={`section-${index}`} role="presentation">{item.label}</div>;
            const choice = item.selected !== undefined;
            return (
              <button
                type="button"
                className="ui-menu__item"
                aria-checked={choice ? item.selected : undefined}
                aria-disabled={item.disabled ? "true" : undefined}
                data-danger={item.danger ? "true" : undefined}
                data-selected={item.selected ? "true" : undefined}
                disabled={item.disabled}
                key={item.key ?? index}
                role={choice ? "menuitemradio" : "menuitem"}
                onClick={(event) => {
                  menu.onClick?.({ key: item.key ?? "", domEvent: event });
                  if (!event.defaultPrevented) setOpen(false);
                }}
              >
                {hasIcons ? <span className="ui-menu__icon">{item.icon}</span> : null}
                <span className="ui-menu__body">
                  <span className="ui-menu__label">{item.label}</span>
                  {item.description ? <small className="ui-menu__description">{item.description}</small> : null}
                </span>
                {item.selected ? <CheckOutlined className="ui-menu__check" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      }
    >
      <span
        className="ui-dropdown-trigger"
        onClickCapture={() => setOpen((current) => !current)}
      >
        {child}
      </span>
    </Popover>
  );
}
