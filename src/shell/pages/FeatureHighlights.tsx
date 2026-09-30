import { useT } from "../../renderer/i18n";
import projectPoster from "../assets/highlights/project.jpg";
import sheetPoster from "../assets/highlights/sheet.jpg";
import slidesPoster from "../assets/highlights/slides.jpg";
import wordPoster from "../assets/highlights/word.jpg";
import { Icon } from "../kit/Icon";
import { notBuiltYet } from "../port/reportPortFailure";
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
 * Four small 16:9 thumbnails, a title and a subtitle each on one line. A video
 * plays only when asked for, in a dialog, with its own controls; nothing
 * autoplays with sound. The X folds the whole section into the gift button
 * beside Settings, and Home does not keep a gap where it was.
 */
export function FeatureHighlights({ onHide }: { onHide?: () => void }) {
  const t = useT();
  const { dispatch } = useShell();

  // The introduction videos are not shipped with the app (they are 9MB of
  // media the repository does not carry), so a card says so rather than
  // opening a player with nothing in it.
  const play = () => notBuiltYet("features.video", t("dx.notBuilt.featureVideo"));

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
            <button
              key={highlight.id}
              type="button"
              className="dx-highlight"
              data-act="video"
              data-id={highlight.id}
              aria-label={t("dx.features.play", { title })}
              onClick={play}
            >
              <span className="dx-thumb">
                <img src={highlight.poster} alt="" />
                <span className="dx-play">
                  <Icon name="Play" />
                </span>
              </span>
              <span className="dx-title" title={title}>
                {title}
              </span>
              <span className="dx-subtitle">{t(highlight.subtitleKey)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
