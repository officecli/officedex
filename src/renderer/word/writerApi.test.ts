import { describe, expect, it } from "vitest";
import { createWriterApi } from "./writerApi";
import type { WriterEmbedEvent, WriterHostCommand } from "../../shared/writerProtocol";

describe("WriterApi text replacement", () => {
  it("sends a structured replacement request and resolves the response", async () => {
    let listener: ((event: WriterEmbedEvent) => void) | undefined;
    let command: WriterHostCommand | undefined;
    const api = createWriterApi({ post: (value) => { command = value; }, onEvent: (next) => { listener = next; return () => { listener = undefined; }; } });
    const pending = api.replaceText("old", "new");
    expect(command).toMatchObject({ type: "writer:replace-text", query: "old", replacement: "new", scope: "document" });
    listener?.({ type: "writer:response", requestId: (command as Extract<WriterHostCommand, { type: "writer:replace-text" }>).requestId, ok: true, result: { replaced: 2 } });
    await expect(pending).resolves.toEqual({ replaced: 2 });
  });
});
