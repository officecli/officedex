import { useCallback, useState } from "react";

import type { Artifact, DesktopAPI, PreviewGrant } from "../shared/types";

/**
 * The document session, reduced to what the live pptx draft needs.
 *
 * `usePptxLiveDraft` was written against the old app's `DocumentSessionController`
 * and reads four of its members — `grant`, `artifact`, `open`, `adopt`. The
 * other three (`close`, `openRevision`, `reportOpened`) exist to drive the old
 * shell's task rail, which this IA does not have.
 *
 * So rather than drag that controller across, this is the same four members and
 * nothing else: a token and the artifact it was issued for. `adopt` is the one
 * that matters here — a live draft issues its own token against a file the
 * runtime is still drawing into, so it arrives already open instead of being
 * opened from an artifact.
 */
export interface CanvasSession {
  readonly grant: PreviewGrant | null;
  readonly artifact: Artifact | null;
  readonly openRevision: number;
  readonly open: (artifact: Artifact) => Promise<void>;
  readonly close: () => Promise<void>;
  readonly reportOpened: () => void;
  readonly adopt: (grant: PreviewGrant, artifact: Artifact) => void;
}

export function useCanvasSession(api: DesktopAPI): CanvasSession {
  const [state, setState] = useState<{ grant: PreviewGrant | null; artifact: Artifact | null }>({
    grant: null,
    artifact: null,
  });
  const [openRevision, setOpenRevision] = useState(0);

  const open = useCallback(
    async (artifact: Artifact) => {
      const grant = await api.issuePreviewToken(artifact);
      setState({ grant, artifact });
      setOpenRevision((current) => current + 1);
    },
    [api],
  );

  const adopt = useCallback((grant: PreviewGrant, artifact: Artifact) => {
    setState({ grant, artifact });
    setOpenRevision((current) => current + 1);
  }, []);

  const close = useCallback(async () => {
    setState({ grant: null, artifact: null });
  }, []);

  const reportOpened = useCallback(() => setOpenRevision((current) => current + 1), []);

  return { grant: state.grant, artifact: state.artifact, openRevision, open, close, reportOpened, adopt };
}
