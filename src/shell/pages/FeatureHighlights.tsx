import { useT } from "../../renderer/i18n";
import projectPoster from "../assets/highlights/project.jpg";
import sheetPoster from "../assets/highlights/sheet.jpg";
import slidesPoster from "../assets/highlights/slides.jpg";
import wordPoster from "../assets/highlights/word.jpg";
import { Icon } from "../kit/Icon";
import { useShell } from "../state/ShellContext";

const HIGHLIGHTS = [
  { id: "word", poster: wordPoster, titleKey: "dx.features.word", subtitleKey: "dx.features.wordKind" },
  { id: "sheet", poster: sheetPoster, titleKey: "dx.features.sheet", subtitleKey: "dx.features.sheetKind" },
  { id: "slides", poster: slidesPoster, titleKey: "dx.features.slides", subtitleKey: "dx.features.slidesKind" },
  { id: "project", poster: projectPoster, titleKey: "dx.features.project", subtitleKey: "dx.features.projectKind" },
] as const;

/**
 * Hot and fresh features — OD-UI-1.2 §21.
 *
 * Four small 16:9 thumbnails, a title and a subtitle each on one line. This
 * version ships no videos, so the cards describe and do not offer to play. The X folds the whole section into the gift button
 * beside Settings, and Home does not keep a gap where it was.
 */
export function FeatureHighlights({ onHide }: { onHide?: () => void }) {
  const t = useT();
  const { dispatch } = useShell();

  // The introduction videos are not shipped with the app (they are 9MB of
  // media the repository does not carry), so the cards carry no play control.

  return (
    <section
      className="dx-home-section dx-feature-highlights"
      id="dx-feature-highlights"
      aria-label={t("dx.features.title")}
    >
      <div className="dx-section-heading">
        <h2>{t("dx.features.title")}</h2>
        <button
          type="button"
          className="dx-ib"
          aria-label={t("dx.features.close")}
          title={t("dx.features.close")}
          data-act="hide-features"
          onClick={() => (onHide ? onHide() : dispatch({ type: "set-features", visible: false }))}
        >
          <Icon name="X" />
        </button>
      </div>
      <div className="dx-highlights">
        {HIGHLIGHTS.map((highlight) => {
          const title = t(highlight.titleKey);
          return (
            // No video ships with the app, so a card is a description: no
            // play glyph, and nothing to press that would only say so.
            <div key={highlight.id} className="dx-highlight" data-id={highlight.id} role="group" aria-label={title}>
              <span className="dx-thumb">
                <img src={highlight.poster} alt="" />
              </span>
              <span className="dx-title" title={title}>
                {title}
              </span>
              <span className="dx-subtitle">{t(highlight.subtitleKey)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
