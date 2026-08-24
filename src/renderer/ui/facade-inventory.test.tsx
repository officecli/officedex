import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Checkbox,
  Dialog,
  Dropdown,
  Empty,
  InputNumber,
  Menu,
  MessageBar,
  Tabs,
  Toast,
  Tooltip,
} from "./index";

/**
 * Guards the components the AntD migration depends on: a broken subpath or a
 * renamed export in a design-system upgrade fails here rather than in a screen.
 */
describe("ui facade inventory", () => {
  it("renders every migration-relevant component", () => {
    render(
      <div>
        <Checkbox ariaLabel="勾选" />
        <InputNumber aria-label="数量" value={1} />
        <Empty title="暂无内容" />
        <MessageBar>提示文案</MessageBar>
        <Tooltip content="说明">
          <button type="button">悬停</button>
        </Tooltip>
        <Menu items={[{ key: "a", label: "菜单项" }]} />
        <Tabs items={[{ key: "t", label: "标签页", content: null }]} />
        <Toast title="通知" />
        <Dropdown open={false} menu={[{ key: "d", label: "下拉项" }]}>
          <button type="button">更多</button>
        </Dropdown>
      </div>,
    );

    expect(screen.getByText("暂无内容")).toBeTruthy();
    expect(screen.getByText("提示文案")).toBeTruthy();
    expect(screen.getByRole("button", { name: "悬停" })).toBeTruthy();
    expect(screen.getByText("菜单项")).toBeTruthy();
    expect(screen.getByText("标签页")).toBeTruthy();
    expect(screen.getByText("通知")).toBeTruthy();
    expect(screen.getByRole("button", { name: "更多" })).toBeTruthy();
  });

  it("renders a dialog when open", () => {
    render(<Dialog open type="message" size="small" title="对话框" />);
    expect(screen.getByText("对话框")).toBeTruthy();
  });
});
