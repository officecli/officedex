import { describe, it, expect } from "vitest";
import { inferHomeTaskRoute, requestedFileName, requestsNewFile } from "./homeIntake";
const requests = [
  {
    "id": "ppt-exact",
    "kind": "Send",
    "prompt": "[OD15-PPT-01] Create a NEW PowerPoint file named exactly OD15-agent-slides.pptx. Exactly 3 slides. Each slide must contain ONLY one text box: slide 1 Alpha, slide 2 Beta, slide 3 Gamma. No other text, no document title, no descriptions, no page numbers, no speaker notes, no images. Do not edit any existing file. This is a fictional QA acceptance test.",
    "time": "2026-10-09T07:56:51.182Z"
  },
  {
    "id": "txt-new",
    "kind": "Send",
    "prompt": "[OD15-TXT-02] Create a NEW plain-text file named OD15-only.txt with exactly three lines: Alpha, Beta, Gamma. This is a separate new file, not an edit to the previous PPT. If TXT output is unsupported, explicitly tell me that and do not generate or modify any Office file.",
    "time": "2026-10-09T07:57:36.386Z"
  },
  {
    "id": "review-first",
    "kind": "Send",
    "prompt": "[OD15-REVIEW-03] Use ONLY the attached OD15-review.docx. Propose changing the exact sentence \"Beta fifteen.\" to \"Gamma fifteen.\". Keep all other paragraphs unchanged. Show the proposed change for review and WAIT for my explicit approval. Do not apply changes or save a modified file yet. Do not create a PPT or touch the previous task.",
    "time": "2026-10-09T07:58:39.278Z"
  },
  {
    "id": "review-isolated",
    "kind": "Send",
    "prompt": "[OD15-REVIEW-04] Use ONLY attached OD15-review.docx. Propose changing exactly \"Beta fifteen.\" to \"Gamma fifteen.\" and keep all other paragraphs unchanged. Show the proposed change and WAIT for my explicit approval. Do not apply or save changes yet. Do not create another document or presentation.",
    "time": "2026-10-09T07:59:51.974Z"
  },
  {
    "id": "doc-exact",
    "kind": "Send",
    "prompt": "[OD15-DOC-05] Create a NEW Word DOCX file. Filename: OD15-exact.docx. Exactly six paragraphs, in this order: OD15 Exact / Alpha fifteen. / Beta fifteen. / Gamma fifteen. / Delta fifteen. / Epsilon fifteen. Use each text once only. The slashes separate paragraphs and must not appear in the file. No extra paragraphs, subtitle, explanation, table or image. Do not edit any existing file.",
    "time": "2026-10-09T08:01:09.277Z"
  },
  {
    "id": "open-doc-review",
    "kind": "Send",
    "prompt": "[OD15-REVIEW-06] In the current OD15-review.docx, propose replacing the exact sentence \"Beta fifteen.\" with \"Gamma fifteen.\". Keep all other text unchanged. Show the proposed change for review and wait for my approval before applying it.",
    "time": "2026-10-09T08:02:59.751Z"
  },
  {
    "id": "open-doc-review-apply",
    "kind": "Send",
    "prompt": "[OD15-REVIEW-07] In the current OD15-review.docx, propose replacing exactly \"Beta fifteen.\" with \"Gamma fifteen.\". Preserve all other text. Show the proposed change and wait for approval before applying.",
    "time": "2026-10-09T08:03:30.952Z"
  },
  {
    "id": "doc-explicit-format",
    "kind": "Send",
    "prompt": "[OD15-DOC-08] Create a new file named \"OD15-exact.docx\". Its complete content must be exactly these six paragraphs, with each line occurring once:\nOD15 Exact\nAlpha fifteen.\nBeta fifteen.\nGamma fifteen.\nDelta fifteen.\nEpsilon fifteen.\nDo not add any other content.",
    "time": "2026-10-09T08:05:41.304Z"
  },
  {
    "id": "stop-resume",
    "kind": "Send",
    "prompt": "OD15-STOP-09: new OD15-stop-resume.pptx, 12 slides, 3-row tables and 100 word notes",
    "time": "2026-10-09T08:06:23.163Z"
  },
  {
    "id": "queue-after-stop",
    "kind": "Send",
    "prompt": "OD15-QUEUE-10: separate new OD15-queued.pptx, 2 slides Queue Alpha/Beta",
    "time": "2026-10-09T08:06:33.886Z"
  },
  {
    "id": "external-approved",
    "kind": "Send",
    "prompt": "[OD15-EDIT-11] Edit the attached OD15-review.docx now. I approve replacing exactly \"Beta fifteen.\" with \"Gamma fifteen.\". Keep the title and all other paragraphs and formatting unchanged. Save the modified DOCX and provide an openable result.",
    "time": "2026-10-09T08:09:34.905Z"
  },
  {
    "id": "ppt-precise-edit",
    "kind": "Send",
    "prompt": "[OD15-PPT-EDIT-12] On slide 1 of the current presentation, change ONLY the exact text box \"Alpha\" to \"Alpha Revised\". Do not change the deck title or any other text box, slide, notes or layout. I approve this exact edit.",
    "time": "2026-10-09T08:11:25.842Z"
  },
  {
    "id": "multi-file",
    "kind": "Send",
    "prompt": "[OD15-PARTIAL-13] Process each attached DOCX independently. In each file, replace exactly \"Beta fifteen.\" with \"Gamma fifteen.\" and preserve all other text. Save each successful result as a separate modified DOCX copy. If a file is invalid, report that file as failed while keeping any valid result. Offer retry only for the failed file. Do not create a summary or presentation.",
    "time": "2026-10-09T08:14:42.694Z"
  },
  {
    "id": "natural-queue-first",
    "kind": "Send",
    "prompt": "[OD15-QUEUE-14] Create a NEW PowerPoint named \"OD15-natural-first.pptx\". Make exactly 12 slides about a fictional QA checklist, one unique heading and 5 concise bullets per slide, with one sentence of speaker notes each. Do not edit existing files.",
    "time": "2026-10-09T08:45:51.575Z"
  },
  {
    "id": "natural-queue-next",
    "kind": "Send",
    "prompt": "[OD15-QUEUE-15] After the current task completes, create a separate NEW PowerPoint named \"OD15-natural-next.pptx\". Exactly 2 slides: First and Second. Do not edit existing files.",
    "time": "2026-10-09T08:45:56.410Z"
  },
  {
    "id": "natural-first-isolated",
    "kind": "Send",
    "prompt": "[OD15-QUEUE-16] Create a NEW presentation named \"OD15-natural-first.pptx\". Exactly 12 slides on fictional office QA. Each slide has one title, five bullets and 100 words of notes. Keep all existing files unchanged.",
    "time": "2026-10-09T08:46:50.745Z"
  },
  {
    "id": "natural-next-isolated",
    "kind": "Send",
    "prompt": "[OD15-QUEUE-17] Create a separate NEW presentation named \"OD15-natural-next.pptx\". Exactly two slides titled First and Second. Do not edit any existing file.",
    "time": "2026-10-09T08:47:01.546Z"
  },
  {
    "id": "image-explicit",
    "kind": "Send",
    "prompt": "[OD15-IMAGE-18] Create one simple blue circle centered on a plain white background. No text. This is a fictional QA test.",
    "time": "2026-10-09T08:50:28.510Z"
  }
];
describe("1.0.15 original acceptance prompts", () => {
  for (const id of ["doc-exact", "doc-explicit-format", "ppt-exact", "stop-resume", "queue-after-stop", "natural-queue-first", "natural-queue-next", "natural-first-isolated", "natural-next-isolated"]) {
    it(`routes ${id} as an independent file of the named type`, () => {
      const prompt = requests.find(x => x.id === id)!.prompt;
      expect(requestsNewFile(prompt)).toBe(true);
      const type = id.startsWith("doc-") ? "docx" : "pptx";
      expect(inferHomeTaskRoute({prompt})).toMatchObject({kind: "generate", documentType: type});
      expect(requestedFileName(prompt)).toMatch(new RegExp(`^OD15-[a-z-]+\\.${type}$`));
    });
  }
  for (const id of ["review-first", "review-isolated", "external-approved", "multi-file", "ppt-precise-edit"]) {
    it(`keeps ${id} on the referenced source`, () => {
      expect(requestsNewFile(requests.find(x => x.id === id)!.prompt)).toBe(false);
    });
  }
});
