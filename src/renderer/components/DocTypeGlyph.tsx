import type { ReactElement } from "react";

// Illustrated format marks: a miniature of the document itself. Used where the
// icon is large enough to carry the detail (file rows); smaller placements use
// the line icon in DocTypeIcon instead, where this artwork would turn to mush.

const PAPER = "#ffffff";
const EDGE = "#e3e6ea";
const FOLD = "#eef1f4";
const TEXT_LINE = "#dfe3e8";

/** Portrait sheet with a turned-down corner, shared by the page-like formats. */
function PortraitPage() {
  return (
    <>
      <path
        d="M11 7a2 2 0 0 1 2-2h15l9 9v25a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2z"
        fill={PAPER}
        stroke={EDGE}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M28 5v7a2 2 0 0 0 2 2h7z" fill={FOLD} stroke={EDGE} strokeWidth="1.2" strokeLinejoin="round" />
    </>
  );
}

/** Landscape card used by the presentation and spreadsheet marks. */
function LandscapeCard() {
  return <rect x="5" y="9" width="38" height="30" rx="3" fill={PAPER} stroke={EDGE} strokeWidth="1.2" />;
}

function DocxGlyph() {
  return (
    <>
      <PortraitPage />
      <text x="24" y="27" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="17" fill="var(--od-doc-docx)">W</text>
      <g fill={TEXT_LINE}>
        <rect x="16" y="31" width="16" height="1.6" rx=".8" />
        <rect x="18" y="34.5" width="12" height="1.6" rx=".8" />
      </g>
    </>
  );
}

function ImageGlyph() {
  return (
    <>
      <PortraitPage />
      <circle cx="29.5" cy="21" r="2.8" fill="var(--od-doc-img)" />
      <path d="M14 34l6.5-9 4.5 5.6 3.4-4.2L35 34z" fill="var(--od-doc-img)" />
    </>
  );
}

function PptxGlyph() {
  return (
    <>
      <LandscapeCard />
      <text x="12" y="27" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="15" fill="var(--od-doc-pptx)">P</text>
      <g fill="var(--od-doc-pptx)" opacity=".55">
        <rect x="25" y="26" width="4" height="8" rx="1" />
        <rect x="31" y="21" width="4" height="13" rx="1" />
        <rect x="37" y="16" width="4" height="18" rx="1" />
      </g>
      <g fill={TEXT_LINE}>
        <rect x="8" y="31" width="12" height="1.6" rx=".8" />
        <rect x="8" y="34.5" width="8" height="1.6" rx=".8" />
      </g>
    </>
  );
}

function XlsxGlyph() {
  return (
    <>
      <LandscapeCard />
      <path d="M5 12a3 3 0 0 1 3-3h32a3 3 0 0 1 3 3v4H5z" fill="var(--od-doc-xlsx)" opacity=".28" />
      <path d="M5 16h38M5 24h38M5 32h38M17 16v23M29 16v23" stroke="var(--od-doc-xlsx)" strokeOpacity=".32" strokeWidth="1.1" fill="none" />
      <rect x="5" y="16" width="6" height="23" fill="var(--od-doc-xlsx)" opacity=".1" />
    </>
  );
}

function GenericGlyph() {
  return (
    <>
      <PortraitPage />
      <g fill={TEXT_LINE}>
        <rect x="16" y="22" width="16" height="1.8" rx=".9" />
        <rect x="16" y="27" width="16" height="1.8" rx=".9" />
        <rect x="16" y="32" width="10" height="1.8" rx=".9" />
      </g>
    </>
  );
}

const GLYPHS: Record<string, () => ReactElement> = {
  pptx: PptxGlyph,
  docx: DocxGlyph,
  xlsx: XlsxGlyph,
  img: ImageGlyph,
  gif: ImageGlyph,
  report: GenericGlyph,
  generic: GenericGlyph,
};

export function DocTypeGlyph({ type }: { type: string }) {
  const Glyph = GLYPHS[type] ?? GenericGlyph;
  return (
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="presentation" focusable="false">
      <Glyph />
    </svg>
  );
}
