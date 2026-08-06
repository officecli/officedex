import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button as AntdButton } from "./backends/antd";

describe("ui kit facade", () => {
  it("renders the fixed AntD button contract", () => {
    render(<AntdButton type="primary">AntD action</AntdButton>);

    expect(screen.getByRole("button", { name: "AntD action" })).toBeTruthy();
  });
});
