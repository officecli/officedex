import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import { NotImplementedError } from "../../shared/notImplemented";
import { SEED_ACTIVE_FILE_ID, seedModels } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";
import { resetComposerDrafts } from "./Composer";

afterEach(() => {
  cleanup();
  toast.destroy();
  // `drafts` is module state shared by every composer in this file. Without
  // this, one test's half-written message is the next one's starting value.
  resetComposerDrafts();
});

/** Toasts portal to the body, so notices are read from there. */
const notice = () => document.body.textContent ?? "";

async function agentHome() {
  const shell = await renderShell({ fastAgent: true });
  await shell.dispatch({ type: "go-home" });
  return shell;
}

async function taskColumn() {
  const shell = await renderShell({ fastAgent: true });
  await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
  return shell;
}

/**
 * The guard for the second half of decision 2.
 *
 * The prototype put a folder dropdown in the Agent Home header whose only job
 * was to pick what a task would touch — while the composer separately supported
 * `@folder` mentions that did the same thing. These assertions pin the merged
 * result: scope is a chip on the message, there is no second folder control,
 * and every placement of the composer offers the same one.
 */
describe("task scope is a composer chip", () => {
  it("defaults to the folder the sidebar has selected", async () => {
    const shell = await agentHome();
    await shell.dispatch({ type: "select-folder", folderId: "folder-research" });

    expect(shell.view.getByTitle("Scope: Customer research")).toBeInTheDocument();
  });

  it("falls back to the active file's folder when nothing is selected", async () => {
    const shell = await taskColumn();
    // `open-file` is the raw reducer action, so no folder gets selected: this is
    // exactly the case the fallback exists for.
    expect(shell.state().selectedFolderId).toBeNull();
    expect(shell.view.getByTitle("Scope: MO product launch")).toBeInTheDocument();
  });

  it("offers no folder control outside the composer", async () => {
    const shell = await agentHome();

    // The prototype's header dropdown is gone; the only folder picker is the
    // scope chip, and the sidebar selection that feeds it.
    const home = shell.view.container.querySelector<HTMLElement>(".shell-home")!;
    const banner = within(home).queryByRole("button", { name: /Switch folder/i });
    expect(banner).toBeNull();

    const scopeTriggers = shell.view.container.querySelectorAll(".shell-cx-scope");
    expect(scopeTriggers).toHaveLength(1);
  });

  it("changes scope from the chip and sends the new folder", async () => {
    const shell = await agentHome();

    await act(async () => {
      fireEvent.click(shell.view.getByTitle(/^Scope: /));
    });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("menuitemradio", { name: /Customer research/ }));
    });

    expect(shell.state().selectedFolderId).toBe("folder-research");

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("New task instructions"), {
        target: { value: "Summarise the interviews." },
      });
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    await waitFor(async () => {
      const task = await shell.port.agent.current("folder-research");
      if (!task) throw new Error("task not started in the chosen folder");
      expect(task.folderId).toBe("folder-research");
    });
  });

  it("is the same control in every placement", async () => {
    const shell = await taskColumn();

    // Docked column.
    expect(shell.view.getAllByTitle(/^Scope: /)).toHaveLength(1);

    // Floating panel.
    await shell.dispatch({ type: "set-placement", placement: "floating" });
    expect(shell.view.getAllByTitle(/^Scope: /)).toHaveLength(1);

    // Home hero.
    await shell.dispatch({ type: "go-home" });
    expect(shell.view.getAllByTitle(/^Scope: /)).toHaveLength(1);
  });
});

describe("mentions", () => {
  it("opens on @ and inserts a folder as a chip", async () => {
    const shell = await agentHome();
    const input = shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Use @" } });
    });

    const listbox = shell.view.getByRole("listbox", { name: "Files and folders" });
    expect(listbox).toBeInTheDocument();

    // Targeted by role: "Customer research" is also the location label on every
    // file that lives in it, so a bare text query is ambiguous.
    await act(async () => {
      fireEvent.click(within(listbox).getByRole("option", { name: /^Customer research/ }));
    });

    expect(input.value).toContain("@Customer research");
    expect(shell.view.container.querySelector(".shell-cx-chip.is-folder")?.textContent).toContain(
      "Customer research",
    );
  });

  it("filters as you type and mentions a file", async () => {
    const shell = await agentHome();
    const input = shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Check @forecast" } });
    });

    const listbox = shell.view.getByRole("listbox", { name: "Files and folders" });
    expect(within(listbox).getByText("MO sales forecast.xlsx")).toBeInTheDocument();
    // Unrelated files are filtered out.
    expect(within(listbox).queryByText("Interview notes.docx")).toBeNull();

    await act(async () => {
      fireEvent.click(within(listbox).getByText("MO sales forecast.xlsx"));
    });
    expect(shell.view.container.querySelector(".shell-cx-chip.is-file")).not.toBeNull();
  });

  it("removing a chip also removes its token from the text", async () => {
    const shell = await agentHome();
    const input = shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Use @" } });
    });
    await act(async () => {
      fireEvent.click(
        within(shell.view.getByRole("listbox", { name: "Files and folders" })).getByRole("option", {
          name: /^Customer research/,
        }),
      );
    });
    expect(input.value).toContain("@Customer research");

    await act(async () => {
      fireEvent.click(shell.view.getByLabelText("Remove Customer research"));
    });

    expect(input.value).not.toContain("@Customer research");
    expect(shell.view.container.querySelector(".shell-cx-chip.is-folder")).toBeNull();
  });

  it("sends the mentions alongside the text", async () => {
    const shell = await agentHome();
    const input = shell.view.getByLabelText("New task instructions");

    await act(async () => {
      fireEvent.change(input, { target: { value: "Compare @" } });
    });
    await act(async () => {
      fireEvent.click(
        within(shell.view.getByRole("listbox", { name: "Files and folders" })).getByText(
          "MO sales forecast.xlsx",
        ),
      );
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    /*
     * Found through the task list rather than through `state.selectedFolderId`.
     *
     * Reading the selection used to work by accident: sending from Home opened
     * a file, and opening a file selects its folder, so the selection happened
     * to name the folder the task went to. Home no longer opens a file it was
     * never told about, so the selection stays where the user left it and this
     * has to ask the port which folder actually received the run.
     */
    await waitFor(async () => {
      const [row] = await shell.port.agent.list();
      if (!row) throw new Error("no task recorded");
      const task = await shell.port.agent.current(row.folderId);
      if (!task?.messages.length) throw new Error("no message recorded");
      expect(task.messages[0].text).toContain("@MO sales forecast.xlsx");
    });
  });
});

describe("send button", () => {
  it("is disabled until there is text", async () => {
    const shell = await agentHome();
    const send = shell.view.getByTitle("Send message");
    expect(send).toBeDisabled();

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("New task instructions"), {
        target: { value: "Go" },
      });
    });
    expect(shell.view.getByTitle("Send message")).toBeEnabled();
  });

  it("switches to Stop while a task runs with an empty draft", async () => {
    const shell = await taskColumn();
    await act(async () => {
      await shell.port.agent.send({
        text: "Long task",
        folderId: "folder-launch",
        mentions: [],
        attachments: [],
        modelId: "gpt-6-astra",
        permission: "review",
        activeFileId: SEED_ACTIVE_FILE_ID,
      });
      await shell.port.agent.pause();
    });

    // Paused counts as running: the control has to offer a way out.
    await shell.dispatch({ type: "set-placement", placement: "docked" });
    expect(shell.view.queryByTitle("Send message")).toBeDisabled();
  });
});

/**
 * The model picker used to be a label.
 *
 * `SendInput.modelId` went out with every message and nothing read it —
 * `agent.send` ignores it and `GenerateInput` has no model field — so the one
 * thing that decides which provider a run uses is `models.select`. These pin
 * that the menu calls it, and that it does not claim a switch the port refused.
 */
describe("model choice", () => {
  it("makes the pick take effect instead of only labelling it", async () => {
    const shell = await agentHome();
    const chosen: string[] = [];
    const select = shell.port.models.select.bind(shell.port.models);
    shell.port.models.select = async (id) => {
      chosen.push(id);
      await select(id);
    };

    await act(async () => {
      fireEvent.click(shell.view.getByTitle(/^Model: /));
    });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("menuitemradio", { name: /GPT-5\.6 Sol/ }));
    });

    expect(chosen).toEqual(["gpt-5.6-sol"]);
    expect(shell.view.getByTitle("Model: GPT-5.6 Sol")).toBeInTheDocument();
  });

  it("keeps naming the old model when the port refuses the switch", async () => {
    const shell = await agentHome();
    shell.port.models.select = async () => {
      throw new NotImplementedError("models.select", "Switching models is not wired up yet.");
    };

    await act(async () => {
      fireEvent.click(shell.view.getByTitle(/^Model: /));
    });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("menuitemradio", { name: /^K3/ }));
    });

    await waitFor(() => expect(notice()).toContain("Not built yet"));
    // A button naming a model no task will run on is the same lie as a button
    // that changed nothing — so it does not move.
    expect(shell.view.getByTitle("Model: GPT-6 Astra")).toBeInTheDocument();
  });

  it("can edit a configured custom model", async () => {
    const shell = await renderShell({
      fastAgent: true,
      models: [
        ...seedModels(),
        {
          id: "custom-1",
          name: "Local Qwen",
          provider: "Custom",
          detail: "http://127.0.0.1:11434/v1",
          custom: true,
        },
      ],
    });
    await shell.dispatch({ type: "go-home" });

    await act(async () => {
      fireEvent.click(shell.view.getByTitle(/^Model: /));
    });
    // The update branch of CustomModelDialog was unreachable until this row
    // existed: `setEditing` was only ever called with "new".
    await act(async () => {
      fireEvent.click(shell.view.getByRole("menuitem", { name: /Edit Local Qwen/ }));
    });

    const dialog = within(document.body).getByRole("dialog");
    expect(within(dialog).getByText("Edit model")).toBeInTheDocument();
    // The endpoint is prefilled, so a rename cannot silently clear it.
    expect(within(dialog).getByLabelText(/Base URL/)).toHaveValue("http://127.0.0.1:11434/v1");

    fireEvent.change(within(dialog).getByLabelText("Display name"), {
      target: { value: "Qwen (work)" },
    });
    fireEvent.change(within(dialog).getByLabelText("Model ID"), { target: { value: "qwen3-max" } });
    await act(async () => {
      fireEvent.click(within(document.body).getByText("Save model"));
    });

    const saved = (await shell.port.models.list()).find((model) => model.id === "custom-1");
    expect(saved?.name).toBe("Qwen (work)");
  });

  it("warns that a second custom model replaces the first", async () => {
    const shell = await renderShell({
      fastAgent: true,
      models: [
        ...seedModels(),
        { id: "custom-1", name: "Local Qwen", provider: "Custom", custom: true },
      ],
    });
    await shell.dispatch({ type: "go-home" });

    await act(async () => {
      fireEvent.click(shell.view.getByTitle(/^Model: /));
    });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("menuitem", { name: /Replace custom model/ }));
    });

    expect(within(document.body).getByRole("dialog").textContent).toContain("Local Qwen");
  });
});

/**
 * Only Full access is real.
 *
 * `unsupportedParts()` in services/agent.ts downgrades review and custom to a
 * direct write, so the other two tiers promised a gate that does not exist.
 * They stay on screen and say so; what must not happen is the composer opening
 * on one of them.
 */
describe("permission tiers", () => {
  it("opens on the tier the runtime honours", async () => {
    const shell = await agentHome();
    expect(shell.view.getByTitle("Permission: Full access")).toBeInTheDocument();
  });

  it("says so rather than switching to a tier with nothing behind it", async () => {
    const shell = await agentHome();

    await act(async () => {
      fireEvent.click(shell.view.getByTitle(/^Permission: /));
    });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("menuitemradio", { name: /Review changes/ }));
    });

    await waitFor(() => expect(notice()).toContain("Not built yet"));
    expect(shell.view.getByTitle("Permission: Full access")).toBeInTheDocument();
    expect((await shell.port.settings.get()).permission).toBe("full");
  });

  it("sends full access, which is what the run will actually do", async () => {
    const shell = await agentHome();
    const sent: string[] = [];
    const send = shell.port.agent.send.bind(shell.port.agent);
    shell.port.agent.send = async (input) => {
      sent.push(input.permission);
      await send(input);
    };

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("New task instructions"), {
        target: { value: "Tidy the deck." },
      });
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    expect(sent).toEqual(["full"]);
  });
});

/**
 * A draft is the message, not the string.
 *
 * Text lived in a module-level map while mentions and attachments were plain
 * component state, so leaving the composer and coming back restored words that
 * read "@MO sales forecast.xlsx" with nothing attached to them.
 */
describe("drafts", () => {
  const attachTo = async (shell: Awaited<ReturnType<typeof agentHome>>, name: string) => {
    const picker = shell.view.container.querySelector<HTMLInputElement>(
      'input[type="file"]:not([webkitdirectory])',
    )!;
    await act(async () => {
      fireEvent.change(picker, { target: { files: [new File(["x"], name)] } });
    });
  };

  it("keeps the mentions and attachments, not just the words", async () => {
    const shell = await agentHome();
    const input = shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Check @" } });
    });
    await act(async () => {
      fireEvent.click(
        within(shell.view.getByRole("listbox", { name: "Files and folders" })).getByText(
          "MO sales forecast.xlsx",
        ),
      );
    });
    await attachTo(shell, "budget.csv");

    // Open a document and come back: Home's composer unmounts and a new one
    // mounts, which is the whole reason the draft store exists.
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await shell.dispatch({ type: "go-home" });

    const returned = shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement;
    expect(returned.value).toContain("@MO sales forecast.xlsx");
    expect(shell.view.getByLabelText("Remove MO sales forecast.xlsx")).toBeInTheDocument();
    expect(shell.view.getByLabelText("Remove budget.csv")).toBeInTheDocument();
  });

  it("still carries them when the restored draft is finally sent", async () => {
    const shell = await agentHome();

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("New task instructions"), {
        target: { value: "Compare @" } });
    });
    await act(async () => {
      fireEvent.click(
        within(shell.view.getByRole("listbox", { name: "Files and folders" })).getByText(
          "MO sales forecast.xlsx",
        ),
      );
    });
    await attachTo(shell, "notes.txt");

    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await shell.dispatch({ type: "go-home" });

    const sent: Array<{ mentions: number; attachments: number }> = [];
    const send = shell.port.agent.send.bind(shell.port.agent);
    shell.port.agent.send = async (input) => {
      sent.push({ mentions: input.mentions.length, attachments: input.attachments.length });
      await send(input);
    };
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    expect(sent).toEqual([{ mentions: 1, attachments: 1 }]);
  });

  it("clears the kept draft once the message goes out", async () => {
    const shell = await agentHome();

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("New task instructions"), {
        target: { value: "Go" },
      });
    });
    await attachTo(shell, "one.txt");
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await shell.dispatch({ type: "go-home" });

    expect(shell.view.getByLabelText("New task instructions")).toHaveValue("");
    expect(shell.view.queryByLabelText("Remove one.txt")).toBeNull();
  });
});

/**
 * Dictation used to run in the dark: no sign a recogniser was listening, no way
 * to call it off, and then a sentence appeared in the box.
 */
describe("dictation", () => {
  /** Stands in for the browser's SpeechRecognition, which jsdom has no. */
  class StubRecognition {
    static live: StubRecognition | null = null;
    lang = "";
    interimResults = false;
    maxAlternatives = 1;
    onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null =
      null;
    onerror: (() => void) | null = null;
    onend: (() => void) | null = null;
    stopped = false;
    start() {
      StubRecognition.live = this;
    }
    stop() {
      this.stopped = true;
      this.onend?.();
    }
  }

  const install = () => {
    StubRecognition.live = null;
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = StubRecognition;
    return () => {
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    };
  };

  it("shows that it is listening and can be called off", async () => {
    const uninstall = install();
    try {
      const shell = await agentHome();

      await act(async () => {
        fireEvent.click(shell.view.getByTitle("Dictate"));
      });
      const live = StubRecognition.live!;
      expect(live).toBeTruthy();
      expect(shell.view.getByLabelText("Stop dictation")).toHaveAttribute("aria-pressed", "true");

      // The second press reaches the same recogniser, rather than starting a
      // second one that nothing can stop.
      await act(async () => {
        fireEvent.click(shell.view.getByLabelText("Stop dictation"));
      });
      expect(live.stopped).toBe(true);
      expect(shell.view.getByTitle("Dictate")).toHaveAttribute("aria-pressed", "false");
    } finally {
      uninstall();
    }
  });

  it("stops looking busy when the recogniser ends without hearing anything", async () => {
    const uninstall = install();
    try {
      const shell = await agentHome();
      await act(async () => {
        fireEvent.click(shell.view.getByTitle("Dictate"));
      });
      // No `onresult` at all — a silence timeout. Clearing the state only on a
      // result would leave the button pulsing for good.
      await act(async () => {
        StubRecognition.live!.onend?.();
      });

      expect(shell.view.getByTitle("Dictate")).toHaveAttribute("aria-pressed", "false");
    } finally {
      uninstall();
    }
  });
});

describe("the scope menu makes folders as well as choosing them", () => {
  it("creates one and scopes the message to it", async () => {
    const shell = await agentHome();

    await act(async () => {
      fireEvent.click(shell.view.getByTitle(/^Scope: /));
    });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("menuitem", { name: /New folder/ }));
    });

    const dialog = within(document.body).getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Folder name"), {
      target: { value: "Q3 planning" },
    });
    await act(async () => {
      fireEvent.click(within(document.body).getByText("Save"));
    });

    await waitFor(() => {
      expect(shell.view.getByTitle("Scope: Q3 planning")).toBeInTheDocument();
    });
    expect((await shell.port.folders.list()).some((folder) => folder.name === "Q3 planning")).toBe(
      true,
    );
  });
});
