import { useCallback, useRef } from "react";
import { ArrowUpRight } from "lucide-react";

import { useT } from "../../renderer/i18n";
import { useAgent } from "../agent/AgentContext";
import { Composer } from "../composer/Composer";
import type { FileType } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import "../home/home.css";

const IMAGE_PURPOSES = ["product", "marketing", "illustration", "social"].map((id) => ({
  id,
  label: `shell.hero.purpose.${id}.label`,
  prompt: `shell.hero.purpose.${id}.prompt`,
}));

/**
 * The image creator.
 *
 * OD-UI-1.2 keeps this surface as it was (§18: "AI image 保留既有图像创作界面"):
 * the brief, the reference pictures and the ratio / style / camera controls are
 * a purpose-built form rather than a fourth chat input, so the component and
 * its stylesheet are the ones that were already here. What changed is how it
 * is reached — New → AI image and Home's Quick start both open this page — and
 * where a request goes: into a conversation of its own, with the picture's
 * versions in the content region beside it.
 */
export function ImageCreatePage() {
  const t = useT();
  const { dispatch, defaultFolderId } = useShell();
  const agent = useAgent();
  const fill = useRef<((text: string, output?: FileType | "image") => void) | null>(null);
  const registerFill = useCallback((next: (text: string, output?: FileType | "image") => void) => {
    fill.current = next;
  }, []);

  return (
    <div className="dx-page-scroll dx-image-create">
      <div className="shell-hero" data-image-mode="true">
        <h1>{t("shell.hero.titleImage")}</h1>
        <p className="shell-hero-lede">{t("shell.hero.ledeImage")}</p>
        <div className="shell-hero-composer">
          <Composer
            placement="home"
            imageOnly
            busy={false}
            onRegisterFill={registerFill}
            onSend={async (submission) => {
              dispatch({ type: "open-chat", chat: { folderId: defaultFolderId, conversationId: null } });
              dispatch({ type: "enter-stage" });
              await agent.send({ ...submission, folderId: defaultFolderId, newConversation: true });
            }}
          />
        </div>
        <div className="shell-hero-purposes" role="group" aria-label={t("shell.hero.purposes")}>
          <span>{t("shell.hero.try")}</span>
          {IMAGE_PURPOSES.map((purpose) => (
            <button key={purpose.id} type="button" onClick={() => fill.current?.(t(purpose.prompt), "image")}>
              {t(purpose.label)}
              <ArrowUpRight size={11} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
