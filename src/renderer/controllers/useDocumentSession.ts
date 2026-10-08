import { useCallback, useEffect, useState } from "react";
import type { Artifact, PreviewGrant } from "../../shared/types";
import { useDesktopApi } from "../services/desktopApi";
import { toast } from "../ui";

export interface DocumentSessionDeps {
  /**
   * Opens a workbook. XLSX has a dedicated editable workspace with the Sheet
   * SDK, an agent conversation and workbook-to-deck actions, so it never goes
   * through the read-only preview overlay (R-D-01). What that workspace needs
   * to mount is the caller's business; the split itself is ours.
   *
   * Returns false when the open did not happen — the unsaved-changes gate can
   * refuse it (R-G-01), and a refused open must not report itself as one.
   */
  readonly onWorkbook: (artifact: Artifact) => Promise<boolean>;
  /** Called after the overlay closes — the pptx surface uses it to remember. */
  readonly onClosed?: () => void;
}

export interface DocumentSessionController {
  readonly grant: PreviewGrant | null;
  readonly artifact: Artifact | null;
  /**
   * Bumped only after a document has actually opened. Consumers collapse the
   * task rail on it: entering the workbench is the document step, and that step
   * owns the window (R-D-02).
   */
  readonly openRevision: number;
  readonly open: (artifact: Artifact) => Promise<void>;
  readonly close: () => Promise<void>;
  /**
   * Reports an open that did not go through `grant` — a workbook, which lands
   * in the spreadsheet workspace instead. Without this the rail rule above
   * cannot see it.
   */
  readonly reportOpened: () => void;
  /**
   * Installs a session the caller already created. The live pptx draft issues
   * its own token against a file the runtime is still drawing into, so it
   * arrives already open rather than being opened from an artifact.
   */
  readonly adopt: (grant: PreviewGrant, artifact: Artifact) => void;
}

function isWorkbook(artifact: Artifact): boolean {
  return artifact.documentType.toLowerCase() === "xlsx" || artifact.fileName.toLowerCase().endsWith(".xlsx");
}

/**
 * The document currently open on the preview surface, and its access token.
 *
 * `grant` is the one piece of state the old root component used for three
 * different jobs at once: the preview token, the "am I editing a document"
 * mode flag, and the trigger for collapsing the sidebar. The first is the real
 * one; the second belongs to routing and the third is `openRevision`, which is
 * separate precisely so an open that bypasses the token can still report
 * itself.
 */
export function useDocumentSession({ onWorkbook, onClosed }: DocumentSessionDeps): DocumentSessionController {
  const api = useDesktopApi();
  const [grant, setGrant] = useState<PreviewGrant | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [openRevision, setOpenRevision] = useState(0);

  const reportOpened = useCallback(() => setOpenRevision((revision) => revision + 1), []);

  // Only a grant appearing counts. Closing must not drive the rail again, which
  // is why this returns early rather than depending on truthiness.
  useEffect(() => {
    if (!grant) return;
    reportOpened();
  }, [grant, reportOpened]);

  const open = useCallback(async (next: Artifact) => {
    if (isWorkbook(next)) {
      // A workbook never lands in `grant`, so the effect above cannot see it:
      // report it here, and only if it actually opened.
      if (await onWorkbook(next)) {
        // The overlay gives way to the workspace; leaving it mounted would
        // stack a read-only preview behind an editable sheet.
        setGrant(null);
        setArtifact(null);
        reportOpened();
      }
      return;
    }
    if (grant) {
      await api.revokePreviewToken(grant.token).catch(() => {});
    }
    try {
      const issued = await api.issuePreviewToken(next);
      setGrant(issued);
      setArtifact(next);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      toast.error(`Preview unavailable: ${text}`);
    }
  }, [api, grant, onWorkbook, reportOpened]);

  const close = useCallback(async () => {
    if (grant) {
      await api.revokePreviewToken(grant.token).catch(() => {});
    }
    setGrant(null);
    setArtifact(null);
    onClosed?.();
  }, [api, grant, onClosed]);

  const adopt = useCallback((nextGrant: PreviewGrant, nextArtifact: Artifact) => {
    setGrant(nextGrant);
    setArtifact(nextArtifact);
  }, []);

  return { grant, artifact, openRevision, open, close, reportOpened, adopt };
}
