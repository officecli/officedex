import { useT } from "../../renderer/i18n";
import { useShell } from "../state/ShellContext";

/**
 * A conversation with no document to show beside it — 1.0.12 §一, §四.
 *
 * Coming back to a chat restores the file it last showed. When that file is
 * gone and the chat's own runs left nothing that can be opened, the content
 * region is an empty editor area: not Assets, not another conversation's or
 * Local's file, and nothing is re-run to make one. Assets is one press away.
 */
export function ChatEmpty() {
  const t = useT();
  const { state, dispatch } = useShell();
  return (
    <section className="dx-page-scroll" data-ui-scope="officedex" data-view="chat-empty">
      <div className="dx-empty">
        <h2>{t("dx.chatEmpty.title")}</h2>
        <p>{t("dx.chatEmpty.body")}</p>
        <button
          type="button"
          className="dx-btn"
          data-act="show-assets"
          onClick={() => {
            if (state.chat) dispatch({ type: "open-chat", chat: state.chat });
          }}
        >
          {t("dx.chatEmpty.assets")}
        </button>
      </div>
    </section>
  );
}
