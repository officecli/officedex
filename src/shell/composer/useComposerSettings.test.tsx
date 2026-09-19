/**
 * The root-cause gate for W2-G.
 *
 * `useComposerSettings` is called from five places in five different subtrees.
 * It used to give each of them a private `useState`, so a preference changed in
 * one was invisible to the other four until they happened to remount — the
 * sidebar menu and the composer menu, both on screen, showing opposite answers
 * for "Enter sends" (audit S7-002), and the Reduced motion switch not reaching
 * the carousel that reads it (S7-003).
 *
 * The e2e spec (`e2e/fix-w2g.spec.ts`) proves the two real menus now agree.
 * This proves the thing underneath, which is the part that can regress without
 * anyone touching a menu: two callers of the hook are two views of one value.
 */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast, ToastHost } from "../../renderer/ui";
import type { ShellSettings, UiPort } from "../../shared/uiPort";
import { PortProvider } from "../port/PortContext";
import { createFakePort } from "../port/fake/createFakePort";
import { useComposerSettings, useReduceMotion } from "./useComposerSettings";

afterEach(() => {
  cleanup();
  toast.destroy();
});

/**
 * Two independent callers of the hook, mounted as siblings.
 *
 * Siblings rather than parent and child on purpose: a parent passing the value
 * down would prove nothing, because that arrangement was never broken. The bug
 * was that two branches of the tree each asked the hook for themselves.
 */
function renderTwoCallers(port: UiPort) {
  const writer: { patch?: (next: Partial<ShellSettings>) => Promise<boolean> } = {};
  const reader: { value?: ShellSettings; models?: number; reduceMotion?: boolean } = {};

  function Writer() {
    const settings = useComposerSettings();
    writer.patch = settings.patch;
    return <span data-testid="writer">{String(settings.value.enterToSend)}</span>;
  }

  function Reader() {
    const settings = useComposerSettings();
    reader.value = settings.value;
    reader.models = settings.models.length;
    return <span data-testid="reader">{String(settings.value.enterToSend)}</span>;
  }

  /** A third caller that subscribes to one field only. */
  function MotionReader() {
    reader.reduceMotion = useReduceMotion();
    return null;
  }

  const view = render(
    <PortProvider port={port}>
      <Writer />
      <Reader />
      <MotionReader />
      {/* Failures are reported through the toast service, so the surface that
          shows them has to be in the tree for the assertion to be about what
          the user sees rather than about a call having been made. */}
      <ToastHost />
    </PortProvider>,
  );

  return { view, writer, reader };
}

/** Waits until the port's initial read has landed in both callers. */
async function loaded(reader: { models?: number }) {
  await waitFor(() => {
    if (!reader.models) throw new Error("the settings store has not loaded yet");
  });
}

describe("one settings store per port", () => {
  it("shows a patch from one caller in another, with no remount", async () => {
    const port = createFakePort();
    const { view, writer, reader } = renderTwoCallers(port);
    await loaded(reader);

    expect(view.getByTestId("writer").textContent).toBe("true");
    expect(view.getByTestId("reader").textContent).toBe("true");

    await act(async () => {
      await writer.patch?.({ enterToSend: false });
    });

    // The assertion S7-002 would have failed: the caller that did not press
    // anything is showing the new value, in the same mount.
    expect(view.getByTestId("reader").textContent).toBe("false");
    expect(view.getByTestId("writer").textContent).toBe("false");
    expect(reader.value?.enterToSend).toBe(false);
  });

  it("reaches a caller that subscribed to one field only", async () => {
    const port = createFakePort();
    const { writer, reader } = renderTwoCallers(port);
    await loaded(reader);

    expect(reader.reduceMotion).toBe(false);

    await act(async () => {
      await writer.patch?.({ reduceMotion: true });
    });

    // This is the shape of S7-003 and S7-004: the switch lives in the sidebar
    // and the thing that animates is somewhere else entirely.
    expect(reader.reduceMotion).toBe(true);
  });

  it("reads the port once however many callers there are", async () => {
    const port = createFakePort();
    let reads = 0;
    const counted: UiPort = {
      ...port,
      settings: {
        get: async () => {
          reads += 1;
          return port.settings.get();
        },
        patch: (next) => port.settings.patch(next),
      },
    };

    const { reader } = renderTwoCallers(counted);
    await loaded(reader);

    // Three callers, one read. The old hook made one per call site, which is
    // also why the five copies could disagree in the first place.
    expect(reads).toBe(1);
  });

  it("keeps two ports apart", async () => {
    const first = createFakePort();
    const second = createFakePort();

    const a = renderTwoCallers(first);
    await loaded(a.reader);
    await act(async () => {
      await a.writer.patch?.({ enterToSend: false });
    });
    expect(a.reader.value?.enterToSend).toBe(false);
    cleanup();

    const b = renderTwoCallers(second);
    await loaded(b.reader);
    // A different workspace connection is a different store. If this ever goes
    // red, the store has become a process-wide singleton and one test's
    // preferences are leaking into the next.
    expect(b.reader.value?.enterToSend).toBe(true);
  });
});

describe("a patch the port refuses", () => {
  function refusingPort(): UiPort {
    const port = createFakePort();
    return {
      ...port,
      settings: {
        get: () => port.settings.get(),
        patch: async () => {
          throw new Error("the settings file is read-only");
        },
      },
    };
  }

  it("rolls the control back rather than leaving the optimistic value on screen", async () => {
    const { view, writer, reader } = renderTwoCallers(refusingPort());
    await loaded(reader);

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await writer.patch?.({ enterToSend: false });
    });

    expect(accepted).toBe(false);
    // A control showing "off" for a setting the port never stored is the same
    // failure as S7-002, arrived at from the other direction.
    expect(view.getByTestId("reader").textContent).toBe("true");
    expect(view.getByTestId("writer").textContent).toBe("true");
  });

  it("says so, instead of swallowing it", async () => {
    const { writer, reader } = renderTwoCallers(refusingPort());
    await loaded(reader);

    await act(async () => {
      await writer.patch?.({ reduceMotion: true });
    });

    expect(document.body.textContent).toContain("the settings file is read-only");
  });

  it("rolls back only the field it tried to change", async () => {
    const port = createFakePort();
    const half: UiPort = {
      ...port,
      settings: {
        get: () => port.settings.get(),
        patch: async (next) => {
          if ("enterToSend" in next) throw new Error("not that one");
          return port.settings.patch(next);
        },
      },
    };

    const { writer, reader } = renderTwoCallers(half);
    await loaded(reader);

    await act(async () => {
      // Two toggles in flight at once, one of which fails. A blanket restore of
      // the pre-patch snapshot would silently undo the one that worked.
      await Promise.all([
        writer.patch?.({ reduceMotion: true }),
        writer.patch?.({ enterToSend: false }),
      ]);
    });

    expect(reader.value?.reduceMotion).toBe(true);
    expect(reader.value?.enterToSend).toBe(true);
  });
});
