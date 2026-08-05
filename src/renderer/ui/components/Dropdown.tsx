import { Children, isValidElement, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { Popover } from "./Popover";

export interface MenuItem {
  readonly key?: string;
  readonly label?: ReactNode;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly type?: "divider";
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
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement={placement === "bottomRight" ? "bottom" : placement}
      trigger={[]}
      content={
        <div className="ui-menu" role="menu">
          {(menu.items ?? []).map((item, index) => item.type === "divider"
            ? <div className="ui-menu__divider" key={`divider-${index}`} role="separator" />
            : (
              <button
                type="button"
                className="ui-menu__item"
                aria-disabled={item.disabled ? "true" : undefined}
                data-danger={item.danger ? "true" : undefined}
                disabled={item.disabled}
                key={item.key ?? index}
                role="menuitem"
                onClick={(event) => {
                  menu.onClick?.({ key: item.key ?? "", domEvent: event });
                  if (!event.defaultPrevented) setOpen(false);
                }}
              >
                {item.icon}<span>{item.label}</span>
              </button>
            ))}
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
