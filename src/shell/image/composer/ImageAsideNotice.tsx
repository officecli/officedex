import { ImageIcon } from "lucide-react";

import { useT } from "../../../renderer/i18n";
import { FileTypeIcon } from "../../chrome/FileTypeIcon";
import { useLibraryActions } from "../../nav/useLibraryActions";
import { useImageBlobUrl } from "../useImageBlobUrl";
import type { ImageBesideDocument } from "../useImageEditTarget";

/**
 * "This message changes ‹document›", above a composer whose panel is a
 * picture's conversation — and the way over to the picture.
 *
 * The switch opens the version on the canvas rather than flipping a mode in
 * place: once the picture is on screen the composer is already "Editing
 * Version N", with its thumbnail, and the user is looking at the thing the
 * message will change. The document stays open in its tab.
 */
export function ImageAsideNotice({ aside }: { aside: ImageBesideDocument }) {
  const t = useT();
  const actions = useLibraryActions();
  const thumb = useImageBlobUrl(aside.fileId);

  return (
    <div className="shell-ig-aside" role="note">
      <span className="shell-ig-aside-text">
        <FileTypeIcon type={aside.documentType} size={13} />
        <span>{t("shell.imageTool.asideNotice", { name: aside.documentName })}</span>
      </span>
      <button
        type="button"
        className="shell-ig-aside-switch"
        title={t("shell.imageTool.asideSwitchTitle", { version: aside.version })}
        onClick={() => void actions.openFile(aside.fileId)}
      >
        {thumb ? (
          <img className="shell-ig-aside-thumb" src={thumb} alt="" draggable={false} />
        ) : (
          <ImageIcon size={12} strokeWidth={1.7} aria-hidden="true" />
        )}
        {t("shell.imageTool.asideSwitch", { version: aside.version })}
      </button>
    </div>
  );
}
