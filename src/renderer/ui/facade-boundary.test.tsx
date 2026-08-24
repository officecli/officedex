import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, Input, Loading, RadioGroup, Select, Switch, Tooltip, toTooltipPlacement } from "./index";

describe("ui facade backed by weboffice-design", () => {
  it("renders a primary button and forwards clicks", () => {
    const onClick = vi.fn();
    render(
      <Button type="primary" onClick={onClick}>
        执行
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "执行" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("maps legacy antd button props onto the design-system contract", () => {
    render(
      <Button type="text" size="small" danger loading>
        危险
      </Button>,
    );
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("renders a controlled input and reports changes as plain strings", () => {
    const onChange = vi.fn();
    render(<Input value="" aria-label="标题" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "a" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("renders a switch that reports checked state", () => {
    const onCheckedChange = vi.fn();
    render(<Switch ariaLabel="启用" checked={false} onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "启用" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it("renders a select with options", () => {
    render(
      <Select
        ariaLabel="模型"
        value="v2"
        options={[
          { value: "v2", label: "planner-v2" },
          { value: "v1", label: "planner-v1" },
        ]}
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /模型/ })).toBeTruthy();
  });

  it("renders a radio group and a loading indicator", () => {
    render(
      <>
        <RadioGroup ariaLabel="密度" value="comfort" onValueChange={vi.fn()}>
          <span />
        </RadioGroup>
        <Loading ariaLabel="生成中" />
      </>,
    );
    expect(screen.getByRole("radiogroup", { name: "密度" })).toBeTruthy();
  });
});

describe("ui facade button contract details", () => {
  it("forwards the native aria-label onto the design-system prop", () => {
    render(
      <Button aria-label="关闭横幅">
        <span aria-hidden="true">×</span>
      </Button>,
    );
    expect(screen.getByRole("button", { name: "关闭横幅" })).toBeTruthy();
  });

  it("stretches a block button to fill its container", () => {
    const { container } = render(<Button block>宽按钮</Button>);
    expect(container.querySelector("button")?.style.width).toBe("100%");
  });
});

describe("ui facade tooltip", () => {
  it("renders its trigger and accepts the legacy title prop", () => {
    render(
      <Tooltip title="保存草稿">
        <button type="button">保存</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
  });

  it("translates AntD placements onto the design-system alignment names", () => {
    expect(toTooltipPlacement("top")).toBe("topCenter");
    expect(toTooltipPlacement("bottom")).toBe("bottomCenter");
    expect(toTooltipPlacement("right")).toBe("rightCenter");
    expect(toTooltipPlacement("left")).toBe("leftCenter");
    expect(toTooltipPlacement("bottomRight")).toBe("bottomRight");
    expect(toTooltipPlacement(undefined)).toBeUndefined();
  });
});
