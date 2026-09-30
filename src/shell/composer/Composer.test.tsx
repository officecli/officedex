import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import { NotImplementedError } from "../../shared/notImplemented";
import type { SendInput } from "../../shared/uiPort";
import { resetLayers } from "../kit/layers";
import { SEED_ACTIVE_FILE_ID, SEED_FOLDER_ID } from "../port/fake/seed";
import { renderShell, type RenderShellOptions } from "../test/renderShell";
import { resetComposerDrafts } from "./Composer";
import { settingsStoreFor } from "./settingsStore";

afterEach(() => {
  cleanup();
  toast.destroy();
  // The menu, dialog and notice slots are module state shared by every render.
  resetLayers();
  // `drafts` is module state shared by every composer in this file. Without
  // this, one test's half-written message is the next one's starting value.
  resetComposerDrafts();
});

/** Toasts portal to the body, so notices are read from there. */
const notice = () => document.body.textContent ?? "";

type Shell = Awaited<ReturnType<typeof renderShell>>;

/**
 * Where unfiled conversations live — the seed's default folder.
 *
 * Home's messages go here, because Home starts work that belongs to no project
 * yet. It is not exported by the seed, so it is named once, here.
 */
const DEFAULT_FOLDER_ID = "folder-inbox";

/**
 * The composer in the conversation column.
 *
 * `open-chat` with no conversation id is a chat that has been started and not
 * yet spoken in — the state most messages in these tests begin from.
 */
async function conversation(folderId = SEED_FOLDER_ID, options: RenderShellOptions = {}): Promise<Shell> {
  const shell = await renderShell({ fastAgent: true, ...options });
  await shell.dispatch({ type: "open-chat", chat: { folderId, conversationId: null } });
  return shell;
}

/** The Dex panel over a Local document, opened from its bubble. */
async function dexPanel(fileId = SEED_ACTIVE_FILE_ID, options: RenderShellOptions = {}): Promise<Shell> {
  const shell = await renderShell({ fastAgent: true, ...options });
  await shell.dispatch({ type: "open-local-file", fileId });
  await act(async () => {
    fireEvent.click(shell.view.container.querySelector<HTMLElement>("button.dx-dex[data-act=dex]")!);
  });
  return shell;
}

const chatInput = (shell: Shell) => shell.view.getByLabelText("Message OfficeDex") as HTMLTextAreaElement;
const dexInput = (shell: Shell) => shell.view.getByLabelText("Message Dex about this document") as HTMLTextAreaElement;
/** Home's one main input. A fresh render starts on Home, so no dispatch is needed. */
const homeInput = (shell: Shell) => shell.view.getByLabelText("Describe your task") as HTMLTextAreaElement;

/** Every message the shell handed the port, in order. */
function watchSends(shell: Shell): SendInput[] {
  const sent: SendInput[] = [];
  const send = shell.port.agent.send.bind(shell.port.agent);
  shell.port.agent.send = async (input) => {
    sent.push(input);
    await send(input);
  };
  return sent;
}

const type = (input: HTMLElement, value: string) =>
  act(async () => {
    fireEvent.change(input, { target: { value } });
  });

const press = (element: HTMLElement) =>
  act(async () => {
    fireEvent.click(element);
  });

/** The composer's hidden file picker, which stands in for the system one. */
const filePicker = (shell: Shell) =>
  shell.view.container.querySelector<HTMLInputElement>(
    '.dx-composer input[type="file"]:not([webkitdirectory])',
  )!;

const attach = (shell: Shell, name: string) =>
  act(async () => {
    fireEvent.change(filePicker(shell), { target: { files: [new File(["x"], name)] } });
  });

/**
 * Where a message goes, now that nothing in the composer chooses it.
 *
 * The old composer carried a folder chip and a folder menu; scope is now the
 * conversation the message was typed in, or — in the Dex panel — the folder of
 * the document on screen. These pin that the run lands there, and that the
 * conversation the shell was left holding is the one the run named.
 */
describe("a message starts a run where it was typed", () => {
  it("sends it to the conversation's project", async () => {
    const shell = await conversation("folder-research");
    const sent = watchSends(shell);

    await type(chatInput(shell), "Summarise the interviews.");
    await press(shell.view.getByTitle("Send message"));

    expect(sent).toHaveLength(1);
    expect(sent[0].folderId).toBe("folder-research");
    await waitFor(async () => {
      const task = await shell.port.agent.current("folder-research");
      if (!task?.messages.length) throw new Error("no message recorded in the chosen project");
      expect(task.messages[0].text).toBe("Summarise the interviews.");
    });
  });

  it("adopts the conversation id the first run gives it", async () => {
    const shell = await conversation();
    expect(shell.state().chat).toEqual({ folderId: SEED_FOLDER_ID, conversationId: null });

    await type(chatInput(shell), "Draft the launch checklist.");
    await press(shell.view.getByTitle("Send message"));

    // Until the run names it there is nothing to call this conversation, so a
    // second message must not start a second one.
    await waitFor(() => expect(shell.state().chat?.conversationId).toBeTruthy());
    expect(shell.state().chat?.folderId).toBe(SEED_FOLDER_ID);
  });

  it("is disabled until there is text", async () => {
    const shell = await conversation();
    expect(shell.view.getByTitle("Send message")).toBeDisabled();

    await type(chatInput(shell), "Go");
    expect(shell.view.getByTitle("Send message")).toBeEnabled();
  });

  /*
   * The Dex panel's composer is about the document it sits over. `activeFileId`
   * is not a hint — the service layer treats its presence as the whole routing
   * decision — so the file has to travel with the message.
   */
  it("aims a message from the Dex panel at the document on screen", async () => {
    const shell = await dexPanel();
    const sent = watchSends(shell);

    await type(dexInput(shell), "Tighten the opening paragraph.");
    await press(shell.view.getByTitle("Send message"));

    expect(sent).toHaveLength(1);
    expect(sent[0].activeFileId).toBe(SEED_ACTIVE_FILE_ID);
    expect(sent[0].folderId).toBe(SEED_FOLDER_ID);
  });
});

/**
 * Home keeps one main input (§20, "Home 保留一个主要输入"), and everything about
 * it says "this is new work".
 *
 * It belongs to no project and no open file: `placement === "home"` refuses to
 * read the workspace three separate times in `Composer` — `reference`,
 * `targetFileId` and `busy` — and Home's own `onSend` opens a conversation of
 * its own in the default folder. `activeFileId` is not a hint; the service layer
 * treats its presence as the whole routing decision, so a new deck asked for
 * from Home with a document behind it used to rewrite that document.
 */
describe("Home's composer", () => {
  it("starts a new conversation in the default folder, aimed at no open file", async () => {
    const shell = await renderShell({ fastAgent: true });
    const sent = watchSends(shell);
    expect(shell.state().chat).toBeNull();

    // A document is open behind Home; the message must not be about it.
    await shell.dispatch({ type: "open-local-file", fileId: SEED_ACTIVE_FILE_ID });
    await shell.dispatch({ type: "go", page: "home" });

    await type(homeInput(shell), "Draft a project plan");
    await press(shell.view.getByTitle("Send message"));

    expect(sent).toHaveLength(1);
    expect(sent[0].folderId).toBe(DEFAULT_FOLDER_ID);
    expect(sent[0].newConversation).toBe(true);
    expect(sent[0].activeFileId).toBeNull();

    // The conversation it opened is the one on screen, and the document it was
    // never about keeps its tab.
    await waitFor(() => expect(shell.state().chat?.conversationId).toBeTruthy());
    expect(shell.state().chat?.folderId).toBe(DEFAULT_FOLDER_ID);
    expect(shell.state().openFileIds).toContain(SEED_ACTIVE_FILE_ID);
  });

  it("never continues the conversation that was focused before", async () => {
    const shell = await renderShell({ fastAgent: true });
    const sent = watchSends(shell);

    await shell.dispatch({ type: "open-chat", chat: { folderId: SEED_FOLDER_ID, conversationId: null } });
    await type(chatInput(shell), "About the launch");
    await press(shell.view.getByTitle("Send message"));
    await waitFor(() => expect(shell.state().chat?.conversationId).toBeTruthy());
    const project = shell.state().chat!.conversationId;

    await shell.dispatch({ type: "go", page: "home" });
    await type(homeInput(shell), "Something else entirely");
    await press(shell.view.getByTitle("Send message"));

    expect(sent[1].folderId).toBe(DEFAULT_FOLDER_ID);
    expect(sent[1].newConversation).toBe(true);
    await waitFor(() => expect(shell.state().chat?.conversationId).toBeTruthy());
    expect(shell.state().chat?.conversationId).not.toBe(project);

    // And the project's conversation did not gain a message it never heard.
    const before = await shell.port.agent.current(SEED_FOLDER_ID);
    expect(before?.messages.filter((message) => message.role === "user").map((message) => message.text)).toEqual([
      "About the launch",
    ]);
  });

  /**
   * `busy` is the scope folder's task, not one this composer started, so a run
   * going anywhere in the default folder turned Home's main button into Stop the
   * moment the box was empty: a destructive action, no confirmation, on the
   * first control a new user sees, cancelling work they may not know exists.
   */
  it("never turns its main button into Stop while a run goes elsewhere", async () => {
    const shell = await renderShell({
      tasks: [
        {
          id: "task-live",
          title: "Draft the launch checklist",
          // The folder Home's own messages go to — the case that used to flip it.
          folderId: DEFAULT_FOLDER_ID,
          status: "writing",
          phase: "Preparing suggested changes",
          steps: [],
          messages: [],
          suggestion: null,
          question: null,
        },
      ],
    });

    expect(homeInput(shell)).toHaveValue("");
    expect(shell.view.queryByLabelText("Stop task")).toBeNull();
    expect(shell.view.getByLabelText("Send message")).toBeDisabled();
  });

  /**
   * What the old permission-chip test protected: the toolbar carries what the
   * design gives it and nothing more. Scope, permission and the output-type
   * menu are gone from every placement; output type moved into Task context.
   */
  it("offers only the four r10 tools", async () => {
    const shell = await renderShell({ fastAgent: true });
    const composer = shell.view.container.querySelector<HTMLElement>(".dx-home-composer .dx-composer")!;

    expect([...composer.querySelectorAll("[data-act]")].map((control) => control.getAttribute("data-act"))).toEqual([
      "context",
      "model-picker",
      "voice",
      "send",
    ]);
    expect(within(composer).queryByTitle(/^Scope: /)).toBeNull();
    expect(within(composer).queryByTitle(/^Permission: /)).toBeNull();
    expect(within(composer).queryByTitle("Generate image")).toBeNull();
  });
});

/**
 * Enter is the send key, unless the user said otherwise.
 *
 * Shift + Enter is always a new line, and with the preference off Enter alone
 * types a line too — the modifier chord is then the only way out, so it has to
 * keep working.
 */
describe("Enter sends", () => {
  it("sends on a plain Enter", async () => {
    const shell = await conversation();
    const sent = watchSends(shell);
    const input = chatInput(shell);

    await type(input, "Write the launch memo");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(sent.map((input) => input.text)).toEqual(["Write the launch memo"]);
  });

  it("adds a line on Shift + Enter instead", async () => {
    const shell = await conversation();
    const sent = watchSends(shell);
    const input = chatInput(shell);

    await type(input, "First line");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    });

    expect(sent).toEqual([]);
    // The keystroke was not swallowed either: the words are still there to
    // carry on typing after.
    expect(input.value).toBe("First line");
  });

  it("leaves Enter alone when the preference is off, and sends on Cmd + Enter", async () => {
    const shell = await conversation();
    const sent = watchSends(shell);
    // The switch itself lives in Settings → General; this is the call it makes.
    await act(async () => {
      await settingsStoreFor(shell.port).patch({ enterToSend: false });
    });
    const input = chatInput(shell);

    await type(input, "Half a thought");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(sent).toEqual([]);
    expect(input.value).toBe("Half a thought");

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    });
    expect(sent.map((input) => input.text)).toEqual(["Half a thought"]);
  });

  /* Home is the same control at a different width, and the keys are the same. */
  it("behaves the same on Home", async () => {
    const shell = await renderShell({ fastAgent: true });
    const sent = watchSends(shell);

    await type(homeInput(shell), "Write the launch memo");
    await act(async () => {
      fireEvent.keyDown(homeInput(shell), { key: "Enter", shiftKey: true });
    });
    expect(sent).toEqual([]);
    expect(homeInput(shell).value).toBe("Write the launch memo");

    await act(async () => {
      fireEvent.keyDown(homeInput(shell), { key: "Enter" });
    });
    expect(sent.map((input) => input.text)).toEqual(["Write the launch memo"]);
  });
});

/**
 * The `@` list offers the workspace's files, and picking one puts a reference
 * on the message rather than only a word in the text.
 */
describe("mentions", () => {
  const list = (shell: Shell) => shell.view.getByRole("listbox", { name: "Files to add to this message" });

  it("opens on @ and inserts a file reference", async () => {
    const shell = await conversation();
    const input = chatInput(shell);

    await type(input, "Check @");

    await press(within(list(shell)).getByText("MO sales forecast.xlsx"));

    expect(input.value).toContain("@MO sales forecast.xlsx");
    expect(shell.view.getByLabelText("Remove MO sales forecast.xlsx")).toBeInTheDocument();
  });

  it("filters as you type, and says when nothing matches", async () => {
    const shell = await conversation();
    const input = chatInput(shell);

    await type(input, "Check @forecast");
    expect(within(list(shell)).getByText("MO sales forecast.xlsx")).toBeInTheDocument();
    // Unrelated files are filtered out.
    expect(within(list(shell)).queryByText("Interview notes.docx")).toBeNull();

    // A list with nothing to offer says so rather than vanishing, which would
    // look like the feature had broken.
    await type(input, "Check @zzzz");
    expect(within(list(shell)).getByText("No matching files")).toBeInTheDocument();
  });

  it("closes on Escape without sending or inserting anything", async () => {
    const shell = await conversation();
    const input = chatInput(shell);

    await type(input, "Compare @");
    expect(list(shell)).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(shell.view.queryByRole("listbox", { name: "Files to add to this message" })).toBeNull();
    expect(input.value).toBe("Compare @");
  });

  it("removing a chip also removes its token from the text", async () => {
    const shell = await conversation();
    const input = chatInput(shell);

    await type(input, "Use @");
    await press(within(list(shell)).getByText("MO sales forecast.xlsx"));
    expect(input.value).toContain("@MO sales forecast.xlsx");

    await press(shell.view.getByLabelText("Remove MO sales forecast.xlsx"));

    expect(input.value).not.toContain("@MO sales forecast.xlsx");
    expect(shell.view.queryByLabelText("Remove MO sales forecast.xlsx")).toBeNull();
  });

  it("sends the mentions alongside the text", async () => {
    const shell = await conversation();
    const sent = watchSends(shell);

    await type(chatInput(shell), "Compare @");
    await press(within(list(shell)).getByText("MO sales forecast.xlsx"));
    await press(shell.view.getByTitle("Send message"));

    expect(sent).toHaveLength(1);
    expect(sent[0].mentions).toEqual([
      { kind: "file", id: "file-forecast", label: "MO sales forecast.xlsx" },
    ]);
    expect(sent[0].text).toContain("@MO sales forecast.xlsx");
  });

  it("offers the same list on Home, and sends what was picked", async () => {
    const shell = await renderShell({ fastAgent: true });
    const sent = watchSends(shell);

    await type(homeInput(shell), "Compare @forecast");
    await press(within(list(shell)).getByText("MO sales forecast.xlsx"));
    expect(homeInput(shell).value).toContain("@MO sales forecast.xlsx");

    await press(shell.view.getByTitle("Send message"));
    expect(sent[0].mentions).toEqual([
      { kind: "file", id: "file-forecast", label: "MO sales forecast.xlsx" },
    ]);
  });
});

/** An attached file is visible on the message, and can be taken off again. */
describe("attachments", () => {
  it("shows one as a chip, removes it, and sends the ones that are left", async () => {
    const shell = await conversation();
    const sent = watchSends(shell);

    await attach(shell, "budget.csv");
    await attach(shell, "notes.txt");
    expect(shell.view.getByLabelText("Remove budget.csv")).toBeInTheDocument();

    await press(shell.view.getByLabelText("Remove budget.csv"));
    expect(shell.view.queryByLabelText("Remove budget.csv")).toBeNull();

    await type(chatInput(shell), "Summarise this.");
    await press(shell.view.getByTitle("Send message"));

    expect(sent[0].attachments.map((attachment) => attachment.name)).toEqual(["notes.txt"]);
  });
});

/**
 * The model picker decides which provider a run uses.
 *
 * It is the workspace preference `selectedModelId` that does it — `useAgentTask`
 * reads it for every message — so the assertions follow the id onto the message
 * rather than onto a label. The button says only "Model"; the menu is where the
 * choice shows.
 */
describe("model choice", () => {
  it("lists the models and sends the one that was picked", async () => {
    const shell = await conversation();
    const sent = watchSends(shell);

    await press(shell.view.getByTitle("Choose model"));
    const menu = shell.view.getByRole("menu");
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(4);
    expect(within(menu).getByRole("menuitemradio", { name: /GPT-6 Astra/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await press(within(menu).getByRole("menuitemradio", { name: /GPT-5\.6 Sol/ }));

    await waitFor(async () => {
      expect((await shell.port.settings.get()).selectedModelId).toBe("gpt-5.6-sol");
    });

    await type(chatInput(shell), "Tidy the deck.");
    await press(shell.view.getByTitle("Send message"));
    expect(sent[0].modelId).toBe("gpt-5.6-sol");
  });

  it("says so and keeps the half-written message when the port refuses the switch", async () => {
    const shell = await conversation();
    const sent = watchSends(shell);
    shell.port.settings.patch = async () => {
      throw new NotImplementedError("settings.patch", "Switching models is not wired up yet.");
    };

    await type(chatInput(shell), "Tidy the deck.");
    await press(shell.view.getByTitle("Choose model"));
    await press(shell.view.getByRole("menuitemradio", { name: /^K3/ }));

    await waitFor(() => expect(notice()).toContain("Switching models is not wired up yet."));
    // A refused switch must not cost the user what they were writing.
    expect(chatInput(shell).value).toBe("Tidy the deck.");

    // And a menu claiming a model no run will use is the same lie as a switch
    // that changed nothing, so it goes back.
    await press(shell.view.getByTitle("Choose model"));
    expect(shell.view.getByRole("menuitemradio", { name: /GPT-6 Astra/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    resetLayers();

    await press(shell.view.getByTitle("Send message"));
    expect(sent[0].modelId).toBe("gpt-6-astra");
  });
});

/**
 * A draft is the message, not the string, and it belongs to one object.
 *
 * Text lived in a module-level map while mentions and attachments were plain
 * component state, so leaving the composer and coming back restored words that
 * read "@MO sales forecast.xlsx" with nothing attached to them. Drafts are kept
 * per placement and `draftKey` (OD-UI-1.2 §02), so one conversation's
 * half-written message never turns up in another.
 */
describe("drafts", () => {
  const leaveAndReturn = async (shell: Shell, folderId = SEED_FOLDER_ID) => {
    await shell.dispatch({ type: "go", page: "home" });
    await shell.dispatch({ type: "open-chat", chat: { folderId, conversationId: null } });
  };

  it("keeps the mentions and attachments, not just the words", async () => {
    const shell = await conversation();

    await type(chatInput(shell), "Check @");
    await press(
      within(shell.view.getByRole("listbox", { name: "Files to add to this message" })).getByText(
        "MO sales forecast.xlsx",
      ),
    );
    await attach(shell, "budget.csv");

    // Going to Home unmounts this composer and coming back mounts another,
    // which is the whole reason the draft store exists.
    await leaveAndReturn(shell);

    expect(chatInput(shell).value).toContain("@MO sales forecast.xlsx");
    expect(shell.view.getByLabelText("Remove MO sales forecast.xlsx")).toBeInTheDocument();
    expect(shell.view.getByLabelText("Remove budget.csv")).toBeInTheDocument();
  });

  it("still carries them when the restored draft is finally sent", async () => {
    const shell = await conversation();

    await type(chatInput(shell), "Compare @");
    await press(
      within(shell.view.getByRole("listbox", { name: "Files to add to this message" })).getByText(
        "MO sales forecast.xlsx",
      ),
    );
    await attach(shell, "notes.txt");
    await leaveAndReturn(shell);

    const sent = watchSends(shell);
    await press(shell.view.getByTitle("Send message"));

    expect(sent).toHaveLength(1);
    expect(sent[0].mentions).toHaveLength(1);
    expect(sent[0].attachments).toHaveLength(1);
  });

  it("clears the kept draft once the message goes out", async () => {
    const shell = await conversation();

    await type(chatInput(shell), "Go");
    await attach(shell, "one.txt");
    await press(shell.view.getByTitle("Send message"));

    await leaveAndReturn(shell);

    // A sent message offered back for sending again is the draft store handing
    // over work the user already gave away.
    expect(chatInput(shell)).toHaveValue("");
    expect(shell.view.queryByLabelText("Remove one.txt")).toBeNull();
  });

  /* The same guarantee for the Dex panel, whose draft is keyed by the file. */
  it("clears it in the Dex panel too", async () => {
    const shell = await dexPanel();

    await type(dexInput(shell), "Go");
    await attach(shell, "one.txt");
    await press(shell.view.getByTitle("Send message"));

    await shell.dispatch({ type: "set-dex-open", open: false });
    await press(shell.view.container.querySelector<HTMLElement>("button.dx-dex[data-act=dex]")!);

    expect(dexInput(shell)).toHaveValue("");
    expect(shell.view.queryByLabelText("Remove one.txt")).toBeNull();
  });

  /**
   * Home's draft is its own, and it outlives a trip elsewhere.
   *
   * Home is the placement the composer's own notes single out: the commonest
   * half-written message is the one begun there, and going to a project or a
   * document unmounts that composer entirely.
   */
  it("keeps Home's words, mentions and attachments across a trip away", async () => {
    const shell = await renderShell({ fastAgent: true });

    await type(homeInput(shell), "Draft a plan for @forecast");
    await press(
      within(shell.view.getByRole("listbox", { name: "Files to add to this message" })).getByText(
        "MO sales forecast.xlsx",
      ),
    );
    await attach(shell, "budget.csv");

    // A conversation's composer must not show Home's half-written message…
    await shell.dispatch({ type: "open-chat", chat: { folderId: SEED_FOLDER_ID, conversationId: null } });
    expect(chatInput(shell)).toHaveValue("");

    // …and Home must still have it when it comes back.
    await shell.dispatch({ type: "go", page: "home" });
    expect(homeInput(shell).value).toContain("@MO sales forecast.xlsx");
    expect(shell.view.getByLabelText("Remove MO sales forecast.xlsx")).toBeInTheDocument();
    expect(shell.view.getByLabelText("Remove budget.csv")).toBeInTheDocument();
  });

  it("clears Home's draft once the message goes out", async () => {
    const shell = await renderShell({ fastAgent: true });

    await type(homeInput(shell), "Go");
    await attach(shell, "one.txt");
    await press(shell.view.getByTitle("Send message"));

    // Sending from Home hands over to the conversation it opened, so Home is
    // gone; coming back must not offer the sent message again.
    await shell.dispatch({ type: "go", page: "home" });
    expect(homeInput(shell)).toHaveValue("");
    expect(shell.view.queryByLabelText("Remove one.txt")).toBeNull();
  });

  it("keeps one draft per conversation", async () => {
    const shell = await conversation("folder-launch");
    await type(chatInput(shell), "About the launch");

    await shell.dispatch({ type: "open-chat", chat: { folderId: "folder-research", conversationId: null } });
    // A message begun in one conversation must never show up in another.
    expect(chatInput(shell)).toHaveValue("");
    await type(chatInput(shell), "About the interviews");

    await shell.dispatch({ type: "open-chat", chat: { folderId: "folder-launch", conversationId: null } });
    expect(chatInput(shell)).toHaveValue("About the launch");
  });
});

/**
 * Dictation used to run in the dark: no sign a recogniser was listening, no way
 * to call it off, and then a sentence appeared in the box.
 */
describe("dictation", () => {
  /** Stands in for the browser's SpeechRecognition, which jsdom has not. */
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
      const shell = await conversation();

      await press(shell.view.getByLabelText("Voice input"));
      const live = StubRecognition.live!;
      expect(live).toBeTruthy();
      expect(shell.view.getByLabelText("Stop dictation")).toHaveAttribute("aria-pressed", "true");

      // The second press reaches the same recogniser, rather than starting a
      // second one that nothing can stop.
      await press(shell.view.getByLabelText("Stop dictation"));
      expect(live.stopped).toBe(true);
      expect(shell.view.getByLabelText("Voice input")).toHaveAttribute("aria-pressed", "false");
    } finally {
      uninstall();
    }
  });

  it("stops looking busy when the recogniser ends without hearing anything", async () => {
    const uninstall = install();
    try {
      const shell = await conversation();
      await press(shell.view.getByLabelText("Voice input"));
      // No `onresult` at all — a silence timeout. Clearing the state only on a
      // result would leave the button pulsing for good.
      await act(async () => {
        StubRecognition.live!.onend?.();
      });

      expect(shell.view.getByLabelText("Voice input")).toHaveAttribute("aria-pressed", "false");
    } finally {
      uninstall();
    }
  });
});

/**
 * An Enter pressed too early, and then Stop.
 *
 * The message used to be gone from the input the moment it was sent, so the
 * only way to fix a typo in it was to type the whole thing again. Stop now
 * hands it back. The runs here use the fake agent's real delays — `fastAgent`
 * would finish them before Stop could be pressed.
 */
describe("Stop hands the message back for editing", () => {
  /*
   * The input is re-queried after every step rather than held.
   *
   * The first run gives the conversation its id, which changes the key
   * `ConversationPane` gives the composer — so the composer holding Stop is a
   * different mount from the one the message was typed into, under a different
   * draft key. That is exactly why the sent message is kept in module state.
   */
  it("puts the message back into the conversation's input", async () => {
    const shell = await conversation(SEED_FOLDER_ID, { fastAgent: false });

    await type(chatInput(shell), "Tighten the intro paragarph");
    await act(async () => {
      fireEvent.keyDown(chatInput(shell), { key: "Enter" });
    });
    await waitFor(() => expect(chatInput(shell).value).toBe(""));
    await waitFor(() => expect(shell.view.getByLabelText("Stop task")).toBeEnabled());

    await press(shell.view.getByLabelText("Stop task"));

    await waitFor(() => expect(chatInput(shell).value).toBe("Tighten the intro paragarph"));
    expect(shell.view.getByLabelText("Send message")).toBeEnabled();
  });

  /**
   * A message sent from Home is stopped from somewhere else entirely.
   *
   * Home hands over to the conversation it opened, so the composer holding Stop
   * is not the one the message was typed into — a different placement and a
   * different draft key. The sent message is module state for exactly this.
   */
  it("brings back a message sent from Home in the conversation's composer", async () => {
    const shell = await renderShell();

    await type(homeInput(shell), "Write the launch memo for");
    await act(async () => {
      fireEvent.keyDown(homeInput(shell), { key: "Enter" });
    });
    await waitFor(() => expect(shell.view.getByLabelText("Stop task")).toBeEnabled());
    expect(shell.view.queryByLabelText("Describe your task")).toBeNull();

    await press(shell.view.getByLabelText("Stop task"));

    await waitFor(() => expect(chatInput(shell).value).toBe("Write the launch memo for"));
  });

  it("leaves the input empty when the run could not be stopped", async () => {
    const shell = await conversation(SEED_FOLDER_ID, { fastAgent: false });

    await type(chatInput(shell), "Tighten the intro");
    await act(async () => {
      fireEvent.keyDown(chatInput(shell), { key: "Enter" });
    });
    await waitFor(() => expect(shell.view.getByLabelText("Stop task")).toBeEnabled());

    shell.port.agent.finish = async () => {
      throw new Error("runtime unreachable");
    };
    await press(shell.view.getByLabelText("Stop task"));

    // Still running: a full input would turn Stop into Send beside a live run.
    expect(chatInput(shell).value).toBe("");
    expect(shell.view.getByLabelText("Stop task")).toBeEnabled();
  });

  /*
   * The run is seeded rather than started, because `fastAgent` collapses the
   * scripted delays to ~1ms — a live run is past `working` before `waitFor`
   * gets its first look, so asserting on one would be asserting on a race.
   */
  it("offers Stop in the composer beside the run, with an empty input", async () => {
    const shell = await conversation(SEED_FOLDER_ID, {
      tasks: [
        {
          id: "task-live",
          title: "Draft the launch checklist",
          folderId: SEED_FOLDER_ID,
          status: "writing",
          phase: "Preparing suggested changes",
          steps: [],
          messages: [],
          suggestion: null,
          question: null,
        },
      ],
    });

    await waitFor(() => expect(shell.view.getByLabelText("Stop task")).toBeEnabled());
    expect(shell.view.queryByLabelText("Send message")).toBeNull();

    // Typing takes the send button back: the run is still going, but the thing
    // the button would do now is send this.
    await type(chatInput(shell), "Actually, make it shorter");
    expect(shell.view.getByLabelText("Send message")).toBeEnabled();
    expect(shell.view.queryByLabelText("Stop task")).toBeNull();
  });
});

/**
 * The image creator keeps the interface it already had (§18), and this is the
 * one surface that starts in image mode. What it sends has to be an explicit
 * image request rather than a sentence the runtime has to guess at.
 */
describe("the image creator", () => {
  it("collects the image settings and sends an explicit image payload", async () => {
    const shell = await renderShell({ fastAgent: true });
    await shell.dispatch({ type: "go", page: "image" });
    const sent = watchSends(shell);

    await type(shell.view.getByLabelText("New task instructions"), "A calm workspace at sunrise");

    // The settings live in a panel anchored to the tool, not in inline selects.
    await press(shell.view.getByRole("button", { name: "Image settings" }));
    const panel = shell.view.getByRole("dialog", { name: "Image settings" });
    await press(within(panel).getByRole("radio", { name: "16:9" }));
    await press(within(panel).getByRole("radio", { name: "4K" }));

    await press(shell.view.getByTitle("Send message"));

    expect(sent).toHaveLength(1);
    expect(sent[0].imageGeneration).toMatchObject({
      prompt: "A calm workspace at sunrise",
      ratio: "16:9",
      resolution: "4K",
      count: 1,
    });
    expect(sent[0].documentType).toBe("img");
    // A picture is a new file, never an edit of whatever tab was open.
    expect(sent[0].activeFileId).toBeNull();
  });
});
