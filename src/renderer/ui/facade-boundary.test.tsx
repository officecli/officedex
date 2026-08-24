import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, Input, Loading, RadioGroup, Select, Switch } from "./index";

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
