import { useMemo, type KeyboardEvent } from "react";

import { useT } from "../../renderer/i18n";
import { useAgent } from "../agent/AgentContext";
import { useCanvas } from "../canvas/CanvasContext";
import { useChatEntry } from "../chrome/useChatEntry";
import { statusKeyOf, useFileActions } from "../chrome/useFileActions";
import { useWorkspaceMenus } from "../chrome/useWorkspaceMenus";
import { Composer } from "../composer/Composer";
import { formatDateTime } from "../kit/format";
import { FileIcon, Icon, extensionOf } from "../kit/Icon";
import { openMenu } from "../kit/layers";
import { useLibraryActions } from "../nav/useLibraryActions";
import { notBuiltYet } from "../port/reportPortFailure";
import type { FileMeta } from "../../shared/uiPort";
import { openSkills } from "../skills/templateLibrary";
import { useShell, type Project } from "../state/ShellContext";
import { FeatureHighlights } from "./FeatureHighlights";
import { CREATABLE, NEW_GROUPS, recentFiles, type NewType } from "./fileRows";

/** Home's Recent has no run beside it, so nothing is working or under review. */
const NONE: ReadonlySet<string> = new Set();

/** Home's Recent is a launch list, not a library: eight rows, no View all (§09). */
const RECENT_LIMIT = 8;

/**
 * Home — OD-UI-1.2 §09, §18, §20.
 *
 * One heading, one input, then three ways in: Quick start (straight to a Local
 * editor, no conversation), Hot and fresh features, and Recent. There is no
 * subtitle. The template library opens a separate generation flow.
 *
 * Above the input there is only the project picker (1.0.12 UI-07): no "This
 * Mac", no input-settings button. Home's input is where every new chat begins
 * (§一) — a project's New chat and a new project land here with the project
 * chosen, and the conversation workspace opens only when a message is sent.
 */
export function Home({ onQuickStart }: { onQuickStart: (type: NewType) => void }) {
  const t = useT();
  const { state, dispatch, files, projects, defaultFolderId, setChatMeta } = useShell();
  const agent = useAgent();
  const canvas = useCanvas();
  const recent = useMemo(() => recentFiles(files, RECENT_LIMIT), [files]);
  const homeChat = state.homeChat;
  const project = homeChat ? (projects.find((entry) => entry.id === homeChat.folderId && !entry.archived) ?? null) : null;
  // A draft chat whose project went away falls back to Home's own draft.
  const bound = homeChat && project && homeChat.conversationId ? homeChat : null;

  return (
    <div className="dx-page-scroll" data-ui-scope="officedex">
      <section className="dx-home">
        <h1>{t("dx.home.title")}</h1>
        <div className="dx-home-composer">
          <HomeProjectPicker project={project} />
          <Composer
            // One composer per draft chat: its words and references come back
            // with it, and never show up in another chat's draft.
            key={bound?.conversationId ?? ""}
            placement="home"
            draftKey={bound?.conversationId ?? ""}
            busy={false}
            onSend={async (submission) => {
              // With an editor to draw on, the run's stage is what the content
              // region shows; without one the project's Assets stay.
              if (bound?.conversationId) {
                // The project's draft chat becomes a conversation under the id
                // it has had since New chat; its first message names it.
                const conversationId = bound.conversationId;
                setChatMeta(conversationId, { draft: false });
                dispatch({ type: "open-chat", chat: bound });
                if (canvas) dispatch({ type: "enter-stage" });
                await agent.send({ ...submission, folderId: bound.folderId, conversationId });
                return;
              }
              // Home's own draft: a conversation of its own, in no project.
              dispatch({ type: "open-chat", chat: { folderId: defaultFolderId, conversationId: null } });
              if (canvas) dispatch({ type: "enter-stage" });
              await agent.send({ ...submission, folderId: defaultFolderId, newConversation: true });
            }}
          />
        </div>

        <div className="dx-quick-start">
          {/* The template library is a skill now (1.0.12 §五): this opens its page. */}
          <button
            type="button"
            className="dx-btn"
            data-act="pptx-templates"
            onClick={() => openSkills(state, dispatch, "ppt-templates")}
          >
            {t("home.localTemplates")}
          </button>
          <div className="dx-quick-new" role="group" aria-label={t("dx.home.quickStart")}>
            <span className="dx-quick-start-label">{t("dx.home.quickStart")}</span>
            <span className="dx-quick-separator" role="separator" aria-orientation="vertical" />
            {NEW_GROUPS.map((group, index) => (
              <QuickGroup key={group.id} separated={index > 0} types={group.types} onPick={onQuickStart} />
            ))}
          </div>
        </div>

        {state.featuresVisible ? <FeatureHighlights /> : null}

        <div className="dx-home-section">
          <div className="dx-section-heading">
            <h2>{t("dx.home.recent")}</h2>
          </div>
          <HomeRecent files={recent} />
        </div>
      </section>
    </div>
  );
}

/**
 * Which project a new chat goes into — the one control above Home's input.
 *
 * Choosing a project picks up that project's unsent draft, if it has one,
 * rather than carrying the current message across; "No project" is Home's own
 * draft. New project creates one and comes back here with it chosen.
 */
function HomeProjectPicker({ project }: { project: Project | null }) {
  const t = useT();
  const { projects } = useShell();
  const entry = useChatEntry();
  const menus = useWorkspaceMenus();
  const label = project?.name ?? t("dx.home.chooseProject");
  return (
    <div className="dx-home-context-bar" role="group" aria-label={t("dx.home.chatContext")}>
      <button
        type="button"
        className="dx-btn dx-home-project-picker"
        data-act="home-project-picker"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-label={t("dx.home.chooseProjectAria", { name: project?.name ?? t("dx.home.noProject") })}
        title={label}
        onClick={(event) =>
          openMenu(
            event.currentTarget,
            [
              { label: t("dx.home.noProject"), checked: project === null, onSelect: () => entry.resumeProjectDraft(null) },
              ...projects
                .filter((entry) => !entry.archived)
                .map((option) => ({
                  label: option.name,
                  checked: option.id === project?.id,
                  onSelect: () => entry.resumeProjectDraft(option.id),
                })),
              "-",
              { label: t("dx.project.new"), onSelect: menus.newProject },
            ],
            { className: "dx-home-context-menu", label: t("dx.home.chooseProject") },
          )
        }
      >
        <Icon name="Folder" size={18} />
        <span className="dx-ellipsis">{label}</span>
        <Icon name="ChevronDown" size={12} />
      </button>
    </div>
  );
}

function QuickGroup({
  separated,
  types,
  onPick,
}: {
  separated: boolean;
  types: readonly NewType[];
  onPick: (type: NewType) => void;
}) {
  const t = useT();
  return (
    <>
      {separated ? <span className="dx-quick-separator" role="separator" /> : null}
      <div className="dx-quick-group">
        {types.map((type) => {
          const kind = t(`dx.type.${type}`);
          return (
            <button
              key={type}
              type="button"
              className="dx-ib"
              data-act="create-local"
              data-id={type}
              disabled={!CREATABLE[type] && type !== "png"}
              title={!CREATABLE[type] && type !== "png" ? t("dx.new.unsupported") : undefined}
              aria-label={t("dx.home.newOfType", { type: kind })}
              data-tooltip={t(type === "png" ? "dx.home.tipImage" : "dx.home.tipEditor", { type: kind, ext: type })}
              onClick={() => onPick(type)}
            >
              <FileIcon ext={type} size={20} />
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * Recent: the whole row opens the file as Local. Icon, name, type, time, status
 * and the blank space between them are all the same click; Enter and Space do
 * the same; arrow keys only move focus. "More" is the one independent control,
 * and there are no checkboxes — bulk selection belongs to Assets (§18 r7).
 */
function HomeRecent({ files }: { files: FileMeta[] }) {
  const t = useT();
  const library = useLibraryActions();
  const fileActions = useFileActions();

  if (files.length === 0) {
    return (
      <div className="dx-empty">
        <h2>{t("dx.home.recentEmpty")}</h2>
        <p>{t("dx.home.recentEmptyHint")}</p>
        <button type="button" className="dx-btn dx-primary" data-act="open-picker" onClick={() => void library.openFromDisk()}>
          {t("dx.action.open")}
        </button>
      </div>
    );
  }

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, file: FileMeta) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void library.openLocalFile(file.id);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const rows = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
      const index = rows.indexOf(event.currentTarget);
      rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
    }
  };

  return (
    <div className="dx-table-wrap dx-home-recent">
      <table aria-label={t("dx.home.recentAria")}>
        <thead>
          <tr>
            <th>{t("dx.column.name")}</th>
            <th className="dx-source-col">{t("dx.column.type")}</th>
            <th className="dx-time-col">{t("dx.column.lastOpened")}</th>
            <th>{t("dx.column.status")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr
              key={file.id}
              className="dx-file-row dx-open-row"
              tabIndex={0}
              data-row={file.id}
              data-act="open-local"
              data-id={file.id}
              aria-label={t("dx.file.openAria", { name: file.name })}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button,input,a,label,select,textarea")) return;
                void library.openLocalFile(file.id);
              }}
              onKeyDown={(event) => onRowKeyDown(event, file)}
            >
              <td className="dx-name-col">
                <span className="dx-recent-file-name" title={file.name}>
                  <FileIcon ext={extensionOf(file)} />
                  <span className="dx-ellipsis">{file.name}</span>
                  {file.pinned ? <Icon name="Bookmark" /> : null}
                </span>
              </td>
              <td className="dx-source-col dx-metadata">{extensionOf(file).toUpperCase()}</td>
              <td className="dx-time-col dx-metadata">{formatDateTime(file.lastOpenedAt)}</td>
              <td className="dx-metadata" data-status={fileActions.statusOf(file, NONE, NONE)}>
                {t(statusKeyOf(fileActions.statusOf(file, NONE, NONE), file, true))}
              </td>
              <td>
                <button
                  type="button"
                  className="dx-ib"
                  aria-label={t("dx.file.optionsFor", { name: file.name })}
                  title={t("dx.file.optionsFor", { name: file.name })}
                  data-act="file-menu"
                  data-id={file.id}
                  onClick={(event) =>
                    fileActions.fileMenu(file, event.currentTarget, {
                      open: () => void library.openLocalFile(file.id),
                    })
                  }
                >
                  <Icon name="MoreHorizontal" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What choosing a type does, from New and from Quick start alike: the three
 * Office types open a blank Local document; AI image opens the image creator;
 * the rest have no editor behind them yet and say so.
 */
export function useCreateOfType() {
  const t = useT();
  const { dispatch } = useShell();
  const library = useLibraryActions();
  return (type: NewType) => {
    if (type === "png") {
      dispatch({ type: "go", page: "image" });
      return;
    }
    const creatable = CREATABLE[type];
    if (creatable) {
      void library.createLocalFile(creatable);
      return;
    }
    notBuiltYet(`new.${type}`, t("dx.notBuilt.newType", { type: t(`dx.type.${type}`) }));
  };
}
