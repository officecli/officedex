/**
 * The five pages the content region shows — OD-UI-1.2 §09, §18, WORKSPACE-STANDARD §04.
 *
 * Driven through the shell rather than by mounting a page on its own, because
 * most of what these pages promise is about where they sit: Local has no
 * conversation beside it, Assets belongs to the project the open conversation is
 * in, and Home, Local and Settings keep a blank band where the document tabs go.
 *
 * The workspace is the approved prototype's sample data, so the row counts and
 * names below are the ones a reviewer sees side by side with the prototype.
 */
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetLayers } from "../kit/layers";
import {
  PROTOTYPE_CHAT_IDS,
  PROTOTYPE_FOLDER_IDS,
  prototypeFiles,
  prototypeFolders,
  prototypeTasks,
} from "../port/fake/prototypeSeed";
import { holdOnline } from "../state/useOnline";
import { renderShell } from "../test/renderShell";

afterEach(() => {
  holdOnline(null);
  resetLayers();
  cleanup();
});

/** The prototype's workspace, on Home. */
async function shell() {
  const now = Date.now();
  const harness = await renderShell({
    folders: prototypeFolders(),
    files: prototypeFiles(now),
    tasks: prototypeTasks().reverse(),
  });
  const find = <T extends HTMLElement>(selector: string) => harness.view.container.querySelector<T>(selector);
  const all = (selector: string) => [...harness.view.container.querySelectorAll<HTMLElement>(selector)];
  return { ...harness, find, all, text: () => harness.view.container.textContent ?? "" };
}

type Shell = Awaited<ReturnType<typeof shell>>;

/** The file and folder names My Files is listing, in order. */
const localRows = (view: Shell) =>
  view.all("#dx-local-results .dx-local-open-row .dx-local-file-name .dx-ellipsis").map((row) => row.textContent ?? "");

const assetRows = (view: Shell) =>
  view.all("#dx-file-results tbody [data-row] .dx-name-button .dx-ellipsis").map((row) => row.textContent ?? "");

describe("Home", () => {
  it("offers Quick start and Recent", async () => {
    const view = await shell();

    const quickStart = view.find(".dx-quick-new")!;
    expect(quickStart.textContent).toContain("Quick start");
    // The nine types of §18, each its own button with a name of its own.
    expect(view.all("[data-act=create-local]").map((button) => button.dataset.id)).toEqual([
      "docx",
      "xlsx",
      "pptx",
      "txt",
      "md",
      "rtf",
      "html",
      "pdf",
      "png",
    ]);

    expect(view.find(".dx-home-recent table")?.getAttribute("aria-label")).toBe("Recent files");
    // Eight rows at most, and no View all: Recent is a launch list, not a library.
    expect(view.all(".dx-home-recent tbody tr")).toHaveLength(8);
    expect(view.text()).not.toContain("View all");
    // Bulk selection belongs to Assets.
    expect(view.all(".dx-home-recent input[type=checkbox]")).toHaveLength(0);
  });

  /*
   * §16 keeps "一个主要输入" on Home — the heading is followed straight by the
   * task input, with the Templates button and the subtitle gone. The brief for
   * this test pass said Home had lost its composer; the design text and the page
   * both say otherwise, so what is asserted is that there is exactly one.
   */
  it("keeps one main input under the heading", async () => {
    const view = await shell();
    expect(view.find("h1")?.textContent).toBe("What would you like to work on?");
    expect(view.all(".dx-home .dx-composer")).toHaveLength(1);
  });

  it("opens a Recent row as Local, with no conversation beside it", async () => {
    const view = await shell();
    const row = view.all(".dx-home-recent tbody tr")[0];
    expect(row.textContent).toContain("MO launch plan.docx");

    fireEvent.click(row);
    await waitFor(() => {
      if (view.state().page !== "editor") throw new Error(`still on ${view.state().page}`);
    });
    expect(view.state().chat).toBeNull();
    expect(view.state().activeFileId).toBe("doc");
  });
});

describe("Local", () => {
  const openLocal = async () => {
    const view = await shell();
    await view.dispatch({ type: "go", page: "local" });
    return view;
  };

  it("lists folders first, then every file the workspace knows", async () => {
    const view = await openLocal();
    const rows = localRows(view);

    // Two projects; the default folder is not a project and is not listed.
    expect(rows.slice(0, 2)).toEqual(["MO product launch", "Quarterly review"]);
    expect(rows).toHaveLength(2 + prototypeFiles().length);
    // Newest first by default, whatever folder it is in.
    expect(rows[2]).toBe("MO launch plan.docx");
  });

  it("lists only its own files inside a folder", async () => {
    const view = await openLocal();
    fireEvent.click(view.find("[data-act=local-folder][data-id=launch]")!);

    const rows = localRows(view);
    expect(rows).toContain("MO launch plan.docx");
    // Documents' own files are somebody else's.
    expect(rows).not.toContain("Project brief.docx");
    expect(rows).not.toContain("MO product launch");
    // And the breadcrumb says where we are, with the way back.
    expect(view.find(".dx-local-breadcrumb h2")?.textContent).toBe("MO product launch");
  });

  it("filters My Files as you type, and leaves Recent alone", async () => {
    const view = await openLocal();
    const recentBefore = view.all(".dx-local-recent-card").map((card) => card.textContent ?? "");
    expect(recentBefore).toHaveLength(5);

    fireEvent.change(view.find("[data-local-search]")!, { target: { value: "budget" } });

    expect(localRows(view)).toEqual(["Launch budget.xlsx", "Archive budget.xls"]);
    // Recent is an access record, not a search result.
    expect(view.all(".dx-local-recent-card").map((card) => card.textContent ?? "")).toEqual(recentBefore);
  });

  it("says so when nothing matches, and offers to clear the search", async () => {
    const view = await openLocal();
    fireEvent.change(view.find("[data-local-search]")!, { target: { value: "nothing by this name" } });
    expect(view.find("#dx-local-results")?.textContent).toContain("No matching files");

    fireEvent.click(view.find("[data-act=local-clear]")!);
    expect(localRows(view).length).toBeGreaterThan(2);
  });

  it("sorts by name or by when a file changed", async () => {
    const view = await openLocal();
    expect(localRows(view)[2]).toBe("MO launch plan.docx");

    fireEvent.change(view.find("[data-local-sort]")!, { target: { value: "name" } });
    const byName = localRows(view).slice(2);
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));
    // Folders stay above the files whatever the sort is.
    expect(localRows(view).slice(0, 2)).toEqual(["MO product launch", "Quarterly review"]);

    fireEvent.change(view.find("[data-local-sort]")!, { target: { value: "modified" } });
    expect(localRows(view)[2]).toBe("MO launch plan.docx");
  });

  it("switches between the list and the grid", async () => {
    const view = await openLocal();
    expect(view.find(".dx-table-wrap")).not.toBeNull();
    expect(view.find("[data-act=local-layout][data-id=list]")?.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(view.find("[data-act=local-layout][data-id=grid]")!);
    expect(view.find(".dx-local-file-grid")).not.toBeNull();
    expect(view.find("#dx-local-results .dx-table-wrap")).toBeNull();
    expect(view.all(".dx-local-file-card")).toHaveLength(2 + prototypeFiles().length);

    fireEvent.click(view.find("[data-act=local-layout][data-id=list]")!);
    expect(view.find("#dx-local-results .dx-table-wrap")).not.toBeNull();
  });

  // Offline is a state of the workspace, not an error: local files stay usable
  // and the banner says what will wait.
  it("says the workspace is offline, without hiding the files", async () => {
    holdOnline(false);
    const view = await openLocal();

    const banner = view.find(".dx-banner")!;
    expect(banner.textContent).toContain("You’re offline");
    expect(banner.querySelector("[data-act=reconnect]")).not.toBeNull();
    expect(localRows(view).length).toBeGreaterThan(0);
  });

  it("has no banner with a connection", async () => {
    const view = await openLocal();
    expect(view.find(".dx-banner")).toBeNull();
  });
});

describe("Projects & conversations", () => {
  const openProjects = async () => {
    const view = await shell();
    await view.dispatch({ type: "go", page: "projects" });
    await waitFor(() => {
      if (view.all(".dx-project-card").length === 0) throw new Error("no project cards yet");
    });
    return view;
  };

  it("lists every project with the conversations in it", async () => {
    const view = await openProjects();
    const cards = view.all(".dx-project-card");

    expect(cards.map((card) => card.querySelector("h2")?.textContent)).toEqual([
      "MO product launch",
      "Quarterly review",
    ]);
    expect([...cards[0].querySelectorAll(".dx-project-chat")].map((chat) => chat.textContent)).toEqual([
      "Launch plan & copy",
      "Sales forecast review",
      "Launch presentation",
    ]);
    // A project with none says so rather than looking broken.
    expect(cards[1].textContent).toContain("No conversations yet.");
  });

  it("opens a conversation through the port", async () => {
    const view = await openProjects();
    const chat = view.all(".dx-project-card")[0].querySelector<HTMLElement>("[data-act=open-chat]")!;

    fireEvent.click(chat);
    await waitFor(() => {
      if (!view.state().chat) throw new Error("no conversation open");
    });
    expect(view.state().chat).toEqual({
      folderId: PROTOTYPE_FOLDER_IDS.launch,
      conversationId: PROTOTYPE_CHAT_IDS.plan,
    });
  });

  it("asks for a name before it creates a project", async () => {
    const view = await openProjects();
    fireEvent.click(view.find(".dx-page-header [data-act=new-project]")!);

    const dialog = document.querySelector("dialog#dx-modal")!;
    expect(dialog.querySelector("#dx-modal-title")?.textContent).toBe("New project");
    expect(dialog.textContent).toContain("Project name");
    expect(dialog.querySelector("input[name=name]")).not.toBeNull();
  });

  it("switches between active and archived", async () => {
    const view = await openProjects();
    expect(view.find("[data-act=project-view][data-id=active]")?.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(view.find("[data-act=project-view][data-id=archived]")!);
    expect(view.find("[data-act=project-view][data-id=archived]")?.getAttribute("aria-pressed")).toBe("true");
    // Nothing has been archived, so the archived view is empty rather than absent.
    expect(view.all(".dx-project-card")).toHaveLength(0);
    expect(view.find(".dx-empty")?.textContent).toContain("No projects here");

    fireEvent.click(view.find("[data-act=project-view][data-id=active]")!);
    expect(view.all(".dx-project-card")).toHaveLength(2);
  });
});

describe("a project's Assets", () => {
  const openAssets = async () => {
    const view = await shell();
    await view.dispatch({
      type: "open-chat",
      chat: { folderId: PROTOTYPE_FOLDER_IDS.launch, conversationId: PROTOTYPE_CHAT_IDS.plan },
    });
    await waitFor(() => {
      if (assetRows(view).length === 0) throw new Error("no asset rows yet");
    });
    return view;
  };

  it("lists the project's files, and names the project it belongs to", async () => {
    const view = await openAssets();
    expect(view.find(".dx-page-header h1")?.textContent).toBe("Assets");
    expect(view.find(".dx-page-header p")?.textContent).toBe("MO product launch");
    // Everything in the folder, and nothing from another one.
    expect(assetRows(view)).toHaveLength(7);
    expect(assetRows(view).join(" ")).not.toContain("Project brief.docx");
  });

  it("filters by type", async () => {
    const view = await openAssets();

    fireEvent.change(view.find("[data-filter=format]")!, { target: { value: "pdf" } });
    expect(assetRows(view)).toEqual(["Project handout.pdf"]);

    fireEvent.change(view.find("[data-filter=format]")!, { target: { value: "text" } });
    expect(assetRows(view)).toEqual(["Launch checklist.txt", "Project readme.md"]);

    fireEvent.change(view.find("[data-filter=format]")!, { target: { value: "all" } });
    expect(assetRows(view)).toHaveLength(7);
  });

  it("filters by status, and offers a way back when nothing matches", async () => {
    const view = await openAssets();

    fireEvent.change(view.find("[data-filter=taskFilter]")!, { target: { value: "saved" } });
    expect(assetRows(view)).toHaveLength(7);

    // Nothing is being worked on, so "Needs review" is empty — with the filters
    // named as the reason, and a button to drop them.
    fireEvent.change(view.find("[data-filter=taskFilter]")!, { target: { value: "review" } });
    expect(assetRows(view)).toHaveLength(0);
    expect(view.find("#dx-file-results")?.textContent).toContain("No matching files");

    fireEvent.click(view.find("[data-act=clear-filters]")!);
    expect(assetRows(view)).toHaveLength(7);
  });

  it("sorts by name or by when a file was last updated", async () => {
    const view = await openAssets();
    expect(assetRows(view)[0]).toBe("MO launch plan.docx");

    fireEvent.change(view.find("[data-filter=sort]")!, { target: { value: "name" } });
    const byName = assetRows(view);
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));

    fireEvent.change(view.find("[data-filter=sort]")!, { target: { value: "updated" } });
    expect(assetRows(view)[0]).toBe("MO launch plan.docx");
  });

  // Where a file came from is a column of its own: a project's library holds
  // files from several conversations and from the user's own disk.
  it("says which conversation each file came from", async () => {
    const view = await openAssets();
    const headers = view.all("#dx-file-results thead th").map((cell) => cell.textContent ?? "");
    expect(headers).toContain("From chat");

    const column = headers.indexOf("From chat");
    const first = view.all("#dx-file-results tbody [data-row]")[0];
    expect(first.children[column].textContent).toBe("Launch plan & copy");
  });

  it("switches between the list and the thumbnails", async () => {
    const view = await openAssets();
    fireEvent.click(view.find("[data-act=layout][data-id=grid]")!);
    expect(view.all(".dx-asset-card")).toHaveLength(7);

    fireEvent.click(view.find("[data-act=layout][data-id=list]")!);
    expect(view.all("#dx-file-results tbody [data-row]")).toHaveLength(7);
  });
});

describe("the document strip", () => {
  it("is a blank band on Home, Local and Settings", async () => {
    const view = await shell();
    for (const page of ["home", "local", "settings"] as const) {
      await view.dispatch({ type: "go", page });
      expect(view.find(".dx-home-top"), page).not.toBeNull();
      expect(view.find(".dx-tabs-strip"), page).toBeNull();
    }
  });

  it("is the tab strip on Projects, Assets, the image creator and a document", async () => {
    const view = await shell();

    await view.dispatch({ type: "go", page: "projects" });
    expect(view.find(".dx-tabs-strip")).not.toBeNull();

    await view.dispatch({ type: "go", page: "image" });
    expect(view.find(".dx-tabs-strip")).not.toBeNull();

    await view.dispatch({
      type: "open-chat",
      chat: { folderId: PROTOTYPE_FOLDER_IDS.launch, conversationId: PROTOTYPE_CHAT_IDS.plan },
    });
    expect(view.state().page).toBe("assets");
    expect(view.find(".dx-tabs-strip")).not.toBeNull();

    await view.dispatch({ type: "open-local-file", fileId: "doc" });
    expect(view.find(".dx-tabs-strip")).not.toBeNull();
    expect(view.find(".dx-home-top")).toBeNull();
  });
});
