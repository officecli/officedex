/**
 * What kind of file a request wants, when the request did not say.
 *
 * Keyword routing reads the type off words like 「表格」 or "deck", and has
 * nothing to go on when a request names none of them: 「给我详细介绍一下绝区零
 * 的剧情」 wants a document and says so in no word the routing knows. The
 * engine can ask a model instead. This module is the asking, and everything
 * that can go wrong with it — each of which ends the same way, with `null`
 * and the caller routing as it did before the classifier existed:
 *
 *  - the desktop host or the running engine predates the classifier;
 *  - the call fails (offline, signed out, upstream error);
 *  - the answer is slower than a user should wait for a send to start;
 *  - the model is not sure, or names a type this path does not make.
 */
import type { DesktopAPI, DocumentType } from "../shared/types";

/** Below this the model is guessing, and the keyword fallback guesses for free. */
export const OUTPUT_TYPE_MIN_CONFIDENCE = 0.6;

/**
 * How long a send waits for the answer. The engine gives up on its side too;
 * this is the bound the user feels, so it is the shorter one.
 */
export const OUTPUT_TYPE_TIMEOUT_MS = 5000;

const CLASSIFIABLE = new Set<DocumentType>(["docx", "xlsx", "pptx", "img", "gif"]);

export type OutputTypeOutcome =
  | { documentType: DocumentType; confidence: number; reason?: string }
  /** Why there is no answer, for the routing log. */
  | { documentType: null; why: "unsupported" | "failed" | "timeout" | "unsure" | "invalid" };

export async function classifyOutputType(
  api: Pick<DesktopAPI, "classifyOutputType">,
  prompt: string,
  timeoutMs = OUTPUT_TYPE_TIMEOUT_MS,
): Promise<OutputTypeOutcome> {
  if (!api.classifyOutputType) return { documentType: null, why: "unsupported" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const answer = await Promise.race([api.classifyOutputType(prompt), timedOut]);
    if (answer === "timeout") return { documentType: null, why: "timeout" };
    if (!answer?.available) return { documentType: null, why: "unsupported" };
    const documentType = String(answer.documentType ?? "").trim().toLowerCase() as DocumentType;
    const confidence = Number(answer.confidence);
    if (!CLASSIFIABLE.has(documentType) || !Number.isFinite(confidence)) return { documentType: null, why: "invalid" };
    if (confidence < OUTPUT_TYPE_MIN_CONFIDENCE) return { documentType: null, why: "unsure" };
    return { documentType, confidence, ...(answer.reason ? { reason: answer.reason } : {}) };
  } catch {
    return { documentType: null, why: "failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
