import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, Form, Input, PasswordInput, TextArea } from "./index";

describe("local form primitives", () => {
  it("focuses the first invalid field and submits valid values", async () => {
    const onFinish = vi.fn();
    render(
      <Form initialValues={{ endpoint: "" }} onFinish={onFinish}>
        <Form.Item name="endpoint" label="Endpoint" rules={[{ required: true, message: "Required" }]}>
          <Input aria-label="Endpoint" />
        </Form.Item>
        <Button htmlType="submit">Save</Button>
      </Form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Required")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Endpoint"));

    fireEvent.change(screen.getByLabelText("Endpoint"), { target: { value: "https://api.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith({ endpoint: "https://api.example.com" }));
  });

  it("supports the imperative form methods used by OfficeDex", async () => {
    const onFinish = vi.fn();
    function Fixture() {
      const [form] = Form.useForm<{ name: string }>();
      return (
        <>
          <Form form={form} initialValues={{ name: "Initial" }} onFinish={onFinish}>
            <Form.Item name="name"><Input aria-label="Name" /></Form.Item>
          </Form>
          <button type="button" onClick={() => form.setFieldValue("name", "Updated")}>Update</button>
          <button type="button" onClick={() => form.submit()}>Submit</button>
          <button type="button" onClick={() => form.resetFields()}>Reset</button>
        </>
      );
    }
    render(<Fixture />);

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Updated");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith({ name: "Updated" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Initial");
  });

  it("toggles password visibility with an accessible control", () => {
    render(<PasswordInput aria-label="API key" value="secret" onChange={() => {}} />);
    const input = screen.getByLabelText("API key");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
  });

  it("does not submit a composing textarea on Enter", () => {
    const onSubmit = vi.fn();
    render(<TextArea aria-label="Prompt" onSubmit={onSubmit} />);
    const input = screen.getByLabelText("Prompt");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.compositionEnd(input);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
