import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Alert, Empty, Image, Progress, Result, Space, Table, Tag, Timeline, Typography } from "./index";

describe("local data display components", () => {
  it("renders table cells, row actions, and the empty state", () => {
    const onClick = vi.fn();
    const columns = [{ key: "name", title: "Name", dataIndex: "name" as const }];
    const { rerender } = render(
      <Table rowKey="name" columns={columns} dataSource={[{ name: "Deck" }]} onRow={() => ({ onClick })} />,
    );
    fireEvent.click(screen.getByText("Deck"));
    expect(onClick).toHaveBeenCalledOnce();
    rerender(<Table rowKey="name" columns={columns} dataSource={[]} emptyText="No files" />);
    expect(screen.getByText("No files")).toBeTruthy();
  });

  it("clamps progress and exposes its value", () => {
    render(<Progress percent={140} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("renders removable tags and closable alerts", () => {
    const onTagClose = vi.fn();
    const onAlertClose = vi.fn();
    render(
      <>
        <Tag closable onClose={onTagClose}>Draft</Tag>
        <Alert title="Proxy required" description="Configure a proxy." closable onClose={onAlertClose} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Close alert" }));
    expect(onTagClose).toHaveBeenCalledOnce();
    expect(onAlertClose).toHaveBeenCalledOnce();
  });

  it("renders image fallback, timeline, result, spacing, and typography", () => {
    render(
      <>
        <Image src="missing.png" alt="Preview" fallback={<span>Image unavailable</span>} />
        <Timeline items={[{ color: "green", content: "Generated" }]} />
        <Result status="error" title="Failed" subTitle="Try again" extra={<button>Retry</button>} />
        <Space wrap><span>One</span><span>Two</span></Space>
        <Typography.Title level={2} ellipsis>Recent files</Typography.Title>
        <Empty description="Nothing here" />
      </>,
    );
    fireEvent.error(screen.getByAltText("Preview"));
    expect(screen.getByText("Image unavailable")).toBeTruthy();
    expect(screen.getByText("Generated")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Failed" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Recent files" })).toBeTruthy();
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });
});
