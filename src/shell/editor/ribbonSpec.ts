/**
 * The ribbon's content, as data.
 *
 * The prototype could not be copied here: its toolbar is a traced SVG image
 * with invisible hit targets on top, not a component tree. So the ribbon is
 * rebuilt as real controls, with the tab sets taken from the prototype and the
 * metrics from its stylesheet layer (25px buttons, 54px group bodies, 10px
 * group labels under a 76px tool strip).
 *
 * Nothing here talks to a document: a control reports its command id and the
 * canvas adapter decides what that means. Until integration there is no
 * adapter, so commands are inert by design rather than by omission.
 */

import type { FileType } from "../../shared/uiPort";

export type ToolKind = "icon" | "label" | "big" | "select" | "gallery" | "toggle";

export interface RibbonTool {
  id: string;
  /** Lucide icon name, resolved by Ribbon.tsx's allow-list. */
  icon?: string;
  label?: string;
  kind: ToolKind;
  /** For `select`: the options, first one shown. */
  options?: string[];
  width?: number;
  /** For `toggle`: whether it renders pressed. Purely presentational for now. */
  pressed?: boolean;
}

export interface RibbonGroup {
  id: string;
  label: string;
  /** Rows of tools; each row is 26px tall inside a 54px body. */
  rows: RibbonTool[][];
}

export interface RibbonTab {
  id: string;
  label: string;
  groups: RibbonGroup[];
}

const UNDO_GROUP: RibbonGroup = {
  id: "history",
  label: "Undo",
  rows: [[{ id: "undo", icon: "Undo2", kind: "icon" }, { id: "redo", icon: "Redo2", kind: "icon" }]],
};

const CLIPBOARD_GROUP: RibbonGroup = {
  id: "clipboard",
  label: "Clipboard",
  rows: [
    [
      { id: "paste", icon: "ClipboardPaste", label: "Paste", kind: "big" },
      { id: "cut", icon: "Scissors", kind: "icon" },
      { id: "copy", icon: "Copy", kind: "icon" },
      { id: "format-painter", icon: "Brush", kind: "icon" },
    ],
  ],
};

const FONT_GROUP: RibbonGroup = {
  id: "font",
  label: "Font",
  rows: [
    [
      { id: "font-family", kind: "select", options: ["Georgia", "Arial", "PingFang SC", "Times New Roman"], width: 150 },
      { id: "font-size", kind: "select", options: ["11", "12", "14", "16", "18", "24"], width: 60 },
      { id: "font-grow", icon: "AArrowUp", kind: "icon" },
      { id: "font-shrink", icon: "AArrowDown", kind: "icon" },
    ],
    [
      { id: "bold", icon: "Bold", kind: "toggle" },
      { id: "italic", icon: "Italic", kind: "toggle" },
      { id: "underline", icon: "Underline", kind: "toggle" },
      { id: "strike", icon: "Strikethrough", kind: "toggle" },
      { id: "fore-color", icon: "Baseline", kind: "icon" },
      { id: "highlight", icon: "Highlighter", kind: "icon" },
    ],
  ],
};

const PARAGRAPH_GROUP: RibbonGroup = {
  id: "paragraph",
  label: "Paragraph",
  rows: [
    [
      { id: "bullets", icon: "List", kind: "icon" },
      { id: "numbers", icon: "ListOrdered", kind: "icon" },
      { id: "outdent", icon: "IndentDecrease", kind: "icon" },
      { id: "indent", icon: "IndentIncrease", kind: "icon" },
    ],
    [
      { id: "align-left", icon: "AlignLeft", kind: "toggle", pressed: true },
      { id: "align-center", icon: "AlignCenter", kind: "toggle" },
      { id: "align-right", icon: "AlignRight", kind: "toggle" },
      { id: "align-justify", icon: "AlignJustify", kind: "toggle" },
      { id: "line-spacing", icon: "Rows3", kind: "icon" },
    ],
  ],
};

const STYLES_GROUP: RibbonGroup = {
  id: "styles",
  label: "Styles",
  rows: [[{ id: "style-gallery", kind: "gallery" }]],
};

const INSERT_GROUP: RibbonGroup = {
  id: "insert",
  label: "Insert",
  rows: [
    [
      { id: "insert-table", icon: "Table2", label: "Table", kind: "big" },
      { id: "insert-image", icon: "Image", label: "Image", kind: "big" },
      { id: "insert-shape", icon: "Square", label: "Shape", kind: "big" },
      { id: "insert-link", icon: "Link", label: "Link", kind: "big" },
      { id: "insert-textbox", icon: "Type", label: "Text box", kind: "big" },
    ],
  ],
};

const REVIEW_GROUP: RibbonGroup = {
  id: "review",
  label: "Review",
  rows: [
    [
      { id: "comment", icon: "MessageSquare", label: "Comment", kind: "big" },
      { id: "find", icon: "Search", label: "Find", kind: "big" },
      { id: "track-changes", icon: "GitCompare", label: "Changes", kind: "big" },
    ],
  ],
};

const VIEW_GROUP: RibbonGroup = {
  id: "view",
  label: "View",
  rows: [
    [
      { id: "fit", icon: "Maximize2", label: "Fit", kind: "big" },
      { id: "zoom-in", icon: "ZoomIn", label: "Zoom in", kind: "big" },
      { id: "zoom-out", icon: "ZoomOut", label: "Zoom out", kind: "big" },
    ],
  ],
};

const HELP_GROUP: RibbonGroup = {
  id: "help",
  label: "Help",
  rows: [[{ id: "shortcuts", icon: "CircleHelp", label: "Shortcuts", kind: "big" }]],
};

const DOC_TABS: RibbonTab[] = [
  { id: "home", label: "Home", groups: [UNDO_GROUP, CLIPBOARD_GROUP, FONT_GROUP, PARAGRAPH_GROUP, STYLES_GROUP] },
  { id: "insert", label: "Insert", groups: [INSERT_GROUP] },
  {
    id: "layout",
    label: "Layout",
    groups: [
      {
        id: "page",
        label: "Page setup",
        rows: [
          [
            { id: "orientation", icon: "RectangleHorizontal", label: "Orientation", kind: "big" },
            { id: "margins", icon: "PanelsTopLeft", label: "Margins", kind: "big" },
            { id: "columns", icon: "Columns3", label: "Columns", kind: "big" },
            { id: "page-break", icon: "SeparatorHorizontal", label: "Break", kind: "big" },
          ],
        ],
      },
    ],
  },
  {
    id: "references",
    label: "References",
    groups: [
      {
        id: "refs",
        label: "References",
        rows: [
          [
            { id: "toc", icon: "ListTree", label: "Contents", kind: "big" },
            { id: "footnote", icon: "StickyNote", label: "Footnote", kind: "big" },
            { id: "citation", icon: "Quote", label: "Citation", kind: "big" },
          ],
        ],
      },
    ],
  },
  { id: "review", label: "Review", groups: [REVIEW_GROUP] },
  { id: "view", label: "View", groups: [VIEW_GROUP] },
  { id: "help", label: "Help", groups: [HELP_GROUP] },
];

const SHEET_TABS: RibbonTab[] = [
  {
    id: "home",
    label: "Home",
    groups: [
      UNDO_GROUP,
      CLIPBOARD_GROUP,
      FONT_GROUP,
      {
        id: "alignment",
        label: "Alignment",
        rows: [
          [
            { id: "align-top", icon: "AlignVerticalJustifyStart", kind: "icon" },
            { id: "align-middle", icon: "AlignVerticalJustifyCenter", kind: "icon" },
            { id: "align-bottom", icon: "AlignVerticalJustifyEnd", kind: "icon" },
            { id: "merge", icon: "TableCellsMerge", label: "Merge", kind: "label" },
          ],
          [
            { id: "align-left", icon: "AlignLeft", kind: "toggle", pressed: true },
            { id: "align-center", icon: "AlignCenter", kind: "toggle" },
            { id: "align-right", icon: "AlignRight", kind: "toggle" },
            { id: "wrap", icon: "WrapText", label: "Wrap", kind: "label" },
          ],
        ],
      },
      {
        id: "number",
        label: "Number",
        rows: [
          [{ id: "number-format", kind: "select", options: ["General", "Number", "Currency", "Percent", "Date"], width: 130 }],
          [
            { id: "currency", icon: "DollarSign", kind: "icon" },
            { id: "percent", icon: "Percent", kind: "icon" },
            { id: "comma", icon: "Hash", kind: "icon" },
            { id: "decimal-more", icon: "ChevronRight", kind: "icon" },
          ],
        ],
      },
      {
        id: "cells",
        label: "Cells",
        rows: [
          [
            { id: "conditional", icon: "Filter", label: "Conditional", kind: "big" },
            { id: "as-table", icon: "Table", label: "Format as table", kind: "big" },
          ],
        ],
      },
    ],
  },
  { id: "insert", label: "Insert", groups: [{ ...INSERT_GROUP, rows: [[...INSERT_GROUP.rows[0], { id: "insert-chart", icon: "ChartNoAxesCombined", label: "Chart", kind: "big" }]] }] },
  {
    id: "page-layout",
    label: "Page Layout",
    groups: [
      {
        id: "sheet-page",
        label: "Page setup",
        rows: [
          [
            { id: "print-area", icon: "Printer", label: "Print area", kind: "big" },
            { id: "gridlines", icon: "Grid3x3", label: "Gridlines", kind: "big" },
            { id: "headers", icon: "Heading", label: "Headers", kind: "big" },
          ],
        ],
      },
    ],
  },
  {
    id: "formulas",
    label: "Formulas",
    groups: [
      {
        id: "function",
        label: "Functions",
        rows: [
          [
            { id: "autosum", icon: "Sigma", label: "AutoSum", kind: "big" },
            { id: "average", icon: "ChartNoAxesColumn", label: "Average", kind: "big" },
            { id: "formula-help", icon: "CircleHelp", label: "Help", kind: "big" },
          ],
        ],
      },
    ],
  },
  {
    id: "data",
    label: "Data",
    groups: [
      {
        id: "sort",
        label: "Sort and filter",
        rows: [
          [
            { id: "sort-asc", icon: "ArrowUpNarrowWide", label: "Sort A→Z", kind: "big" },
            { id: "sort-desc", icon: "ArrowDownWideNarrow", label: "Sort Z→A", kind: "big" },
            { id: "filter", icon: "Filter", label: "Filter", kind: "big" },
          ],
        ],
      },
    ],
  },
  { id: "review", label: "Review", groups: [REVIEW_GROUP] },
  { id: "view", label: "View", groups: [VIEW_GROUP] },
  { id: "help", label: "Help", groups: [HELP_GROUP] },
];

const SLIDES_TABS: RibbonTab[] = [
  {
    id: "home",
    label: "Home",
    groups: [
      UNDO_GROUP,
      {
        id: "slides",
        label: "Slides",
        rows: [
          [
            { id: "new-slide", icon: "Plus", label: "New slide", kind: "big" },
            { id: "layout", icon: "LayoutTemplate", label: "Layout", kind: "big" },
            { id: "reset", icon: "RotateCcw", label: "Reset", kind: "big" },
          ],
        ],
      },
      FONT_GROUP,
      PARAGRAPH_GROUP,
    ],
  },
  { id: "insert", label: "Insert", groups: [INSERT_GROUP] },
  {
    id: "transitions",
    label: "Transitions",
    groups: [
      {
        id: "transition",
        label: "Transition",
        rows: [
          [
            { id: "transition-kind", kind: "select", options: ["None", "Fade", "Slide", "Push"], width: 140 },
            { id: "preview", icon: "Play", label: "Preview", kind: "label" },
          ],
        ],
      },
    ],
  },
  {
    id: "slide-show",
    label: "Slide Show",
    groups: [
      {
        id: "present",
        label: "Present",
        rows: [
          [
            { id: "from-start", icon: "Play", label: "From start", kind: "big" },
            { id: "from-current", icon: "SkipForward", label: "From current", kind: "big" },
            { id: "notes", icon: "FileText", label: "Notes", kind: "big" },
          ],
        ],
      },
    ],
  },
  { id: "review", label: "Review", groups: [REVIEW_GROUP] },
  { id: "view", label: "View", groups: [VIEW_GROUP] },
  { id: "help", label: "Help", groups: [HELP_GROUP] },
];

const TABS: Record<FileType, RibbonTab[]> = {
  doc: DOC_TABS,
  sheet: SHEET_TABS,
  slides: SLIDES_TABS,
};

export function ribbonTabs(type: FileType): RibbonTab[] {
  return TABS[type];
}

export const STYLE_TILES = ["Normal", "Heading 1", "Heading 2", "Quote"];
