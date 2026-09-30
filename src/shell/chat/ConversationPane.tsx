import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";

import { useT } from "../../renderer/i18n";
import { useAgent } from "../agent/AgentContext";
import { Composer } from "../composer/Composer";
import { DexFace } from "../dex/DexFace";
import { Icon } from "../kit/Icon";
import { ImageTranscript } from "../image/ImageTranscript";
import { logShellEvent } from "../port/shellLog";
import type { AgentMessage } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { AgentRun } from "./AgentRun";
import { CompactAssets } from "./CompactAssets";

/** How close to the bottom still counts as "following" (AGENT-STATE-STANDARD §07). */
const FOLLOW_THRESHOLD = 64;

/** Where each conversation's view was left, so switching back returns to it. */
const scrollMemory = new Map<string, number>();

/**
 * The second column: one conversation, or its project's Assets in compact form
 * — OD-CHAT-2026.09 §3.
 *
 * The 40px header holds the conversation's name on the left and, on the right,
 * the Assets switch and the float / dock switch. There are no Chat / Assets
 * tabs and no count: the folder button is pressed for Assets and released for
 * Chat. The project's name is not repeated here.
 *
 * The composer is fixed to the bottom and the messages scroll above it. New
 * content is followed only while the view is already at the bottom; someone
 * reading further up is left where they are, with "Latest update" to come back.
 *
 * Floating, the whole column becomes a panel of the same width, at most 600px
 * tall, dragged by its header and kept inside the window.
 */
export function ConversationPane() {
  const t = useT();
  const { state, dispatch, currentChat } = useShell();
  const agent = useAgent();
  const pane = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [behind, setBehind] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);

  const chat = state.chat;
  const key = `${chat?.folderId ?? ""}:${chat?.conversationId ?? ""}:${state.panel}`;
  const task = agent.task;
  const title = currentChat?.name ?? state.pendingChatName ?? task?.title ?? t("dx.chat.untitled");

  // Restore where this conversation was left; remember where the last one was.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const saved = scrollMemory.get(key);
    element.scrollTop = saved ?? element.scrollHeight;
    following.current = saved === undefined || element.scrollHeight - saved - element.clientHeight < FOLLOW_THRESHOLD;
    setBehind(false);
    return () => {
      scrollMemory.set(key, element.scrollTop);
    };
  }, [key]);

  // A task update: follow it, or say there is something new below.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || state.panel !== "chat") return;
    if (following.current) element.scrollTop = element.scrollHeight;
    else setBehind(true);
  }, [task, state.panel]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD;
    if (following.current) setBehind(false);
  };

  // A floating panel stays inside the window as the window changes.
  useEffect(() => {
    if (!state.chatFloating) {
      setPoint(null);
      return;
    }
    const clamp = () => setPoint((current) => (current ? { ...current } : current));
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [state.chatFloating]);

  const floatingStyle = (() => {
    if (!state.chatFloating) return undefined;
    const width = pane.current?.offsetWidth ?? state.chatWidth;
    const height = pane.current?.offsetHeight ?? 600;
    const start =
      state.chatPosition === "right" ? window.innerWidth - width - 16 : (state.navCollapsed ? 0 : 244) + 16;
    const x = Math.max(8, Math.min(point?.x ?? start, window.innerWidth - width - 8));
    const y = Math.max(48, Math.min(point?.y ?? window.innerHeight - height - 16, window.innerHeight - height - 8));
    return { left: x, top: y, right: "auto", bottom: "auto" } as const;
  })();

  const onHeaderPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!state.chatFloating || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const rect = pane.current!.getBoundingClientRect();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHeaderPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    setPoint({ x: current.left + event.clientX - current.x, y: current.top + event.clientY - current.y });
  };
  const endDrag = () => {
    drag.current = null;
  };

  if (!chat) return <section id="dx-conversation" data-ui-scope="officedex" ref={pane} />;

  const imageTask = task?.documentType === "img";

  return (
    <section id="dx-conversation" data-ui-scope="officedex" ref={pane} style={floatingStyle} aria-label={title}>
      <div
        className="dx-pane-top"
        title={state.chatFloating ? t("dx.chat.dragToMove") : undefined}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <h2 className="dx-conversation-title dx-ellipsis" title={title}>
          {title}
        </h2>
        <button
          type="button"
          className="dx-ib"
          aria-label={t("dx.assets.title")}
          title={t("dx.assets.title")}
          aria-pressed={state.panel === "assets"}
          data-act="toggle-assets"
          onClick={() => {
            const next = state.panel === "assets" ? "chat" : "assets";
            dispatch({ type: "set-panel", panel: next });
            logShellEvent("conversation_view_changed", { type: next });
          }}
        >
          <Icon name="Folder" />
        </button>
        <button
          type="button"
          className="dx-ib"
          aria-label={t(state.chatFloating ? "dx.chat.dock" : "dx.chat.float")}
          title={t(state.chatFloating ? "dx.chat.dock" : "dx.chat.float")}
          aria-pressed={state.chatFloating}
          data-act="toggle-chat-display"
          onClick={() => dispatch({ type: "toggle-chat-display" })}
        >
          <Icon name="Maximize2" />
        </button>
      </div>

      <div className="dx-chat-scroll" ref={scroller} onScroll={onScroll}>
        {state.panel === "assets" ? (
          <CompactAssets />
        ) : task && imageTask ? (
          <ImageTranscript agent={agent} />
        ) : task && (task.messages.length > 0 || task.status !== "idle") ? (
          <>
            {task.messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
            <AgentRun task={task} agent={agent} />
          </>
        ) : (
          <div className="dx-message">
            <div className="dx-author">
              <DexFace variant="tiny" />
              {t("settings.about.productName")}
            </div>
            {t("dx.chat.greeting")}
          </div>
        )}
      </div>

      {state.panel === "chat" ? (
      <div className="dx-chat-composer-wrap">
        {behind ? (
          <button
            type="button"
            className="dx-agent-jump"
            data-act="agent-latest"
            onClick={() => {
              const element = scroller.current;
              if (element) element.scrollTop = element.scrollHeight;
              following.current = true;
              setBehind(false);
            }}
          >
            {t("dx.chat.latest")}
          </button>
        ) : null}
        <Composer
          // A conversation's draft is its own; switching conversations switches drafts.
          key={`${chat.folderId}:${chat.conversationId ?? ""}`}
          draftKey={`${chat.folderId}:${chat.conversationId ?? ""}`}
          placement="task"
          busy={agent.busy}
          imageTask={imageTask}
          onSend={(submission) => agent.send({ ...submission, folderId: chat.folderId })}
          onStop={agent.stop}
        />
      </div>
      ) : null}
    </section>
  );
}

/**
 * A message — OD-CHAT §2, "用户消息紧凑气泡".
 *
 * The user's is a bubble that hugs its words: right-aligned, at most 90% wide,
 * 8 × 12 padding, 16px radius. What it quoted sits above the text and what it
 * referred to below, as metadata. The agent's is plain reading text under its
 * name — paragraphs are not boxed.
 */
function Message({ message }: { message: AgentMessage }) {
  const t = useT();
  if (message.role === "user") {
    return (
      <div className="dx-message dx-user">
        {message.reference?.text ? <blockquote>{message.reference.text}</blockquote> : null}
        {message.text}
        {message.reference ? <p className="dx-metadata">{message.reference.label}</p> : null}
      </div>
    );
  }
  return (
    <div className="dx-message">
      <div className="dx-author">
        <DexFace variant="tiny" />
        {t("settings.about.productName")}
      </div>
      {message.text}
    </div>
  );
}
