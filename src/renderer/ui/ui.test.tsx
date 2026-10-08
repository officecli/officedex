import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, Input, Loading, RadioGroup, Select, Switch } from "./index";

describe("single UI facade", () => {
  it("exposes explicit variants for visible button states", () => {
    render(
      <>
        <Button variant="secondary">Cancel</Button>
        <Button variant="danger">Delete</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("data-variant", "secondary");
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("data-variant", "danger");
  });

  it("exports the WebOffice controls used by business code", () => {
    render(
      <>
        <Button ariaLabel="Continue">Continue</Button>
        <Input aria-label="Topic" value="" onChange={() => {}} />
        <Select
          ariaLabel="Type"
          value="pptx"
          options={[{ value: "pptx", label: "PPT" }]}
          onValueChange={() => {}}
        />
        <Switch ariaLabel="Images" checked onCheckedChange={() => {}} />
        <RadioGroup ariaLabel="Mode" value="plan" onValueChange={() => {}}>
          <RadioGroup.Item value="plan">Plan</RadioGroup.Item>
        </RadioGroup>
        <Loading ariaLabel="Loading" />
      </>,
    );

    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByLabelText("Topic")).toBeTruthy();
    expect(screen.getByLabelText("Type")).toBeTruthy();
    expect(screen.getByLabelText("Images")).toBeTruthy();
    expect(screen.getByLabelText("Mode")).toBeTruthy();
    expect(screen.getByLabelText("Loading")).toBeTruthy();
  });
});
