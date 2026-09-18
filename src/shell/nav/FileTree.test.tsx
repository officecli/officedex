import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { seedFiles, seedFolders } from "../port/fake/seed";
import { FileTree, type FileTreeProps } from "./FileTree";

afterEach(cleanup);

const NOW = new Date("2026-09-17T12:00:00Z").getTime();

function props(overrides: Partial<FileTreeProps> = {}): FileTreeProps {
  return {
    density: "compact",
    grouping: "folder",
    folders: seedFolders(),
    files: seedFiles(NOW),
    activeFileId: null,
    selectedFolderId: null,
    // Everything expanded so the compact tree renders its files for comparison.
    expandedFolderIds: seedFolders().map((folder) => folder.id),
    revealedFolderIds: seedFolders().map((folder) => folder.id),
    onOpenFile: vi.fn(),
    onToggleFolder: vi.fn(),
    onToggleOverflow: vi.fn(),
    onSelectFolder: vi.fn(),
    onCreateFile: vi.fn(),
    onMoveFile: vi.fn(),
    onTogglePinned: vi.fn(),
    ...overrides,
  };
}

const compactStructure = (root: HTMLElement) =>
  [...root.querySelectorAll(".shell-tree-folder")].map((section) => ({
    folder: section.querySelector(".shell-tree-folder-row")?.getAttribute("data-drop-folder"),
    files: [...section.querySelectorAll(".shell-tree-file-open > span")].map((node) => node.textContent),
  }));

const comfortableStructure = (root: HTMLElement) =>
  [...root.querySelectorAll("tbody")].map((body) => ({
    folder: body.getAttribute("data-drop-folder"),
    files: [...body.querySelectorAll(".shell-list-file > span")].map((node) =>
      node.textContent?.replace(/\.(docx|xlsx|pptx)$/i, "") ?? null,
    ),
  }));

describe("FileTree densities (decision 2)", () => {
  it("renders the same folder structure at both densities", () => {
    const shared = props();
    const compact = render(<FileTree {...shared} density="compact" />);
    const comfortable = render(<FileTree {...shared} density="comfortable" />);

    const fromCompact = compactStructure(compact.container);
    // The comfortable list has no header tbody, so both sides read the same way.
    const fromComfortable = comfortableStructure(comfortable.container).filter(
      (group) => group.folder !== null,
    );

    expect(fromCompact.length).toBeGreaterThan(0);
    expect(fromComfortable).toEqual(fromCompact);
  });

  it("offers every real folder as a drop target at both densities", () => {
    const shared = props();
    const expected = seedFolders().map((folder) => folder.id);

    const compact = render(<FileTree {...shared} density="compact" />);
    expect(
      [...compact.container.querySelectorAll("[data-drop-folder]")].map((node) =>
        node.getAttribute("data-drop-folder"),
      ),
    ).toEqual(expected);

    cleanup();

    const comfortable = render(<FileTree {...shared} density="comfortable" />);
    expect(
      [...comfortable.container.querySelectorAll("[data-drop-folder]")].map((node) =>
        node.getAttribute("data-drop-folder"),
      ),
    ).toEqual(expected);
  });

  it("differs on empty folders by design: the sidebar keeps them, the page does not", () => {
    // An empty folder still has to be reachable in the sidebar (that is how you
    // put the first file in it), but a page-sized list should not spend a
    // heading on a folder with nothing under it.
    const folders = seedFolders();
    const files = seedFiles(NOW).filter((file) => file.folderId === folders[0].id);
    const shared = props({ folders, files });

    const compact = render(<FileTree {...shared} density="compact" />);
    expect(compact.container.querySelectorAll(".shell-tree-folder-row")).toHaveLength(folders.length);
    expect(compact.getAllByText("No files yet.")).toHaveLength(folders.length - 1);

    cleanup();

    const comfortable = render(<FileTree {...shared} density="comfortable" />);
    const headings = [...comfortable.container.querySelectorAll(".shell-list-group th")].map((th) =>
      th.childNodes[0]?.textContent?.trim(),
    );
    expect(headings).toEqual([folders[0].name]);
  });
});

describe("time grouping (decision 3)", () => {
  it("exposes no drop target, because a time bucket is not a location", () => {
    const view = render(<FileTree {...props({ density: "comfortable", grouping: "time" })} />);

    // Rows are present…
    expect(view.container.querySelectorAll(".shell-list-file").length).toBeGreaterThan(0);
    // …but nothing in the page will accept a dropped file.
    expect(view.container.querySelectorAll("[data-drop-folder]")).toHaveLength(0);
  });

  it("still labels each file with the real folder it lives in", () => {
    const view = render(<FileTree {...props({ density: "comfortable", grouping: "time" })} />);
    const locations = [...view.container.querySelectorAll("tbody tr:not(.shell-list-group) td:nth-child(2)")].map(
      (cell) => cell.textContent,
    );
    expect(locations.length).toBeGreaterThan(0);
    expect(locations).not.toContain("");
    expect(locations).not.toContain("Recent");
  });
});

describe("pinned filter", () => {
  it("narrows the same list rather than showing a different structure", () => {
    const files = seedFiles(NOW);
    const view = render(<FileTree {...props({ density: "comfortable", filter: "pinned" })} />);

    const names = [...view.container.querySelectorAll(".shell-list-file > span")].map((n) => n.textContent);
    const pinned = files.filter((file) => file.pinned).map((file) => file.name);
    expect(names).toEqual(pinned);
    expect(names.length).toBeGreaterThan(0);
  });

  it("shows a pinned-specific empty state when nothing is pinned", () => {
    const files = seedFiles(NOW).map((file) => ({ ...file, pinned: false }));
    const view = render(<FileTree {...props({ density: "comfortable", filter: "pinned", files })} />);
    expect(view.getByText("No pinned files")).toBeInTheDocument();
  });
});

describe("compact tree paging", () => {
  it("offers the overflow only when a folder has more than the first page", () => {
    const folders = seedFolders().slice(0, 1);
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...seedFiles(NOW)[0],
      id: `extra-${index}`,
      name: `Extra ${index}.docx`,
      folderId: folders[0].id,
    }));

    const view = render(
      <FileTree
        {...props({ density: "compact", folders, files: many, revealedFolderIds: [] })}
      />,
    );
    expect(view.getByText("Show 3 more")).toBeInTheDocument();

    cleanup();

    const few = render(
      <FileTree
        {...props({ density: "compact", folders, files: many.slice(0, 3), revealedFolderIds: [] })}
      />,
    );
    expect(few.queryByText(/Show \d+ more/)).toBeNull();
  });
});
