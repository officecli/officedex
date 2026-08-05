import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImeInput, ImePasswordInput, ImePlainTextArea, ImeTextArea } from "./ImeInput";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", {
  value: ResizeObserverStub,
  writable: true,
  configurable: true,
});

describe("IME-safe inputs", () => {
  it("keeps textarea composition drafts local until the final committed text", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <ImeTextArea aria-label="description" value="初始" onValueChange={onValueChange} />,
    );
    const textarea = screen.getByLabelText("description") as HTMLTextAreaElement;

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: "chu shi ni" } });

    expect(textarea.value).toBe("chu shi ni");
    expect(onValueChange).not.toHaveBeenCalled();

    rerender(<ImeTextArea aria-label="description" value="外部刷新" onValueChange={onValueChange} />);

    expect(textarea.value).toBe("chu shi ni");
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: "初始你" } });
    fireEvent.compositionEnd(textarea);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("初始你");
  });

  it("defers single-line input changes while composing", () => {
    const onValueChange = vi.fn();
    render(<ImeInput aria-label="name" value="" onValueChange={onValueChange} />);
    const input = screen.getByLabelText("name") as HTMLInputElement;

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "zhong" } });
    fireEvent.change(input, { target: { value: "中文" } });
    fireEvent.compositionEnd(input);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("中文");
  });

  it("keeps password input composition behavior consistent with normal input", () => {
    const onValueChange = vi.fn();
    render(<ImePasswordInput aria-label="api key" value="" onValueChange={onValueChange} />);
    const input = screen.getByLabelText("api key") as HTMLInputElement;

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "mi ma" } });
    fireEvent.change(input, { target: { value: "密码" } });
    fireEvent.compositionEnd(input);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("密码");
  });

  it("keeps plain textarea composition local without AntD autosize wrappers", () => {
    const onValueChange = vi.fn();
    render(<ImePlainTextArea aria-label="follow up" value="" onValueChange={onValueChange} />);
    const textarea = screen.getByLabelText("follow up") as HTMLTextAreaElement;

    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.classList.contains("ui-textarea")).toBe(true);
    expect(textarea.closest(".ant-input-textarea")).toBeNull();

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: "zhong wen" } });
    expect(textarea.value).toBe("zhong wen");
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: "中文" } });
    fireEvent.compositionEnd(textarea);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("中文");
  });
});
