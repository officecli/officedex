/**
 * Workspace function icons — OD-UI-1.2 §06.
 *
 * Generated from the approved prototype's icon sprite (`<symbol>` bodies, 24×24
 * view box). The paths are the prototype's own, not a re-import of an icon
 * package: the spec freezes the shapes, and a package upgrade would otherwise
 * be free to redraw them. Stroke, width and cap come from `.dx-icon` in
 * `kit/base.css`.
 *
 * Two entries are not in the sprite and are drawn inline by the prototype
 * (`A.icon` in v11/data.js): `Bookmark` and `ArrowLeftRight`.
 */
export const ICON_BODIES = {
  Plus: "<path d=\"M5 12h14\"></path><path d=\"M12 5v14\"></path>",
  Search: "<path d=\"m21 21-4.34-4.34\"></path><circle cx=\"11\" cy=\"11\" r=\"8\"></circle>",
  PanelLeft: "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"></rect><path d=\"M9 3v18\"></path>",
  PanelRight: "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"></rect><path d=\"M15 3v18\"></path>",
  MessageSquare: "<path d=\"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z\"></path>",
  ArrowUp: "<path d=\"m5 12 7-7 7 7\"></path><path d=\"M12 19V5\"></path>",
  ArrowUpRight: "<path d=\"M7 7h10v10\"></path><path d=\"M7 17 17 7\"></path>",
  ArrowLeft: "<path d=\"m12 19-7-7 7-7\"></path><path d=\"M19 12H5\"></path>",
  ChevronDown: "<path d=\"m6 9 6 6 6-6\"></path>",
  ChevronRight: "<path d=\"m9 18 6-6-6-6\"></path>",
  Check: "<path d=\"M20 6 9 17l-5-5\"></path>",
  CircleCheck: "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><path d=\"m9 12 2 2 4-4\"></path>",
  Clock3: "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><path d=\"M12 6v6h4\"></path>",
  Folder: "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\"></path>",
  FolderOpen: "<path d=\"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2\"></path>",
  FileText: "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\"></path><path d=\"M14 2v5a1 1 0 0 0 1 1h5\"></path><path d=\"M10 9H8\"></path><path d=\"M16 13H8\"></path><path d=\"M16 17H8\"></path>",
  Table2: "<path d=\"M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18\"></path>",
  Presentation: "<path d=\"M2 3h20\"></path><path d=\"M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3\"></path><path d=\"m7 21 5-5 5 5\"></path>",
  MoreHorizontal: "<circle cx=\"12\" cy=\"12\" r=\"1\"></circle><circle cx=\"19\" cy=\"12\" r=\"1\"></circle><circle cx=\"5\" cy=\"12\" r=\"1\"></circle>",
  Settings2: "<path d=\"M14 17H5\"></path><path d=\"M19 7h-9\"></path><circle cx=\"17\" cy=\"17\" r=\"3\"></circle><circle cx=\"7\" cy=\"7\" r=\"3\"></circle>",
  House: "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"></path><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"></path>",
  Mic: "<path d=\"M12 19v3\"></path><path d=\"M19 10v2a7 7 0 0 1-14 0v-2\"></path><rect x=\"9\" y=\"2\" width=\"6\" height=\"13\" rx=\"3\"></rect>",
  Paperclip: "<path d=\"m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551\"></path>",
  Pause: "<rect x=\"14\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\"></rect><rect x=\"5\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\"></rect>",
  Play: "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\"></path>",
  RotateCcw: "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"></path><path d=\"M3 3v5h5\"></path>",
  X: "<path d=\"M18 6 6 18\"></path><path d=\"m6 6 12 12\"></path>",
  Download: "<path d=\"M12 15V3\"></path><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><path d=\"m7 10 5 5 5-5\"></path>",
  Save: "<path d=\"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\"></path><path d=\"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7\"></path><path d=\"M7 3v4a1 1 0 0 0 1 1h7\"></path>",
  Undo2: "<path d=\"M9 14 4 9l5-5\"></path><path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11\"></path>",
  Redo2: "<path d=\"m15 14 5-5-5-5\"></path><path d=\"M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13\"></path>",
  Printer: "<path d=\"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\"></path><path d=\"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6\"></path><rect x=\"6\" y=\"14\" width=\"12\" height=\"8\" rx=\"1\"></rect>",
  Bold: "<path d=\"M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8\"></path>",
  Italic: "<line x1=\"19\" x2=\"10\" y1=\"4\" y2=\"4\"></line><line x1=\"14\" x2=\"5\" y1=\"20\" y2=\"20\"></line><line x1=\"15\" x2=\"9\" y1=\"4\" y2=\"20\"></line>",
  Underline: "<path d=\"M6 4v6a6 6 0 0 0 12 0V4\"></path><line x1=\"4\" x2=\"20\" y1=\"20\" y2=\"20\"></line>",
  AlignLeft: "<path d=\"M21 5H3\"></path><path d=\"M15 12H3\"></path><path d=\"M17 19H3\"></path>",
  AlignCenter: "<path d=\"M21 5H3\"></path><path d=\"M17 12H7\"></path><path d=\"M19 19H5\"></path>",
  AlignRight: "<path d=\"M21 5H3\"></path><path d=\"M21 12H9\"></path><path d=\"M21 19H7\"></path>",
  List: "<path d=\"M3 5h.01\"></path><path d=\"M3 12h.01\"></path><path d=\"M3 19h.01\"></path><path d=\"M8 5h13\"></path><path d=\"M8 12h13\"></path><path d=\"M8 19h13\"></path>",
  Link: "<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\"></path><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\"></path>",
  Image: "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\"></rect><circle cx=\"9\" cy=\"9\" r=\"2\"></circle><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\"></path>",
  ChartNoAxesCombined: "<path d=\"M12 16v5\"></path><path d=\"M16 14.639V21\"></path><path d=\"M20 10.656V21\"></path><path d=\"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15\"></path><path d=\"M4 18.463V21\"></path><path d=\"M8 14.656V21\"></path>",
  Type: "<path d=\"M12 4v16\"></path><path d=\"M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2\"></path><path d=\"M9 20h6\"></path>",
  Square: "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"></rect>",
  MousePointer2: "<path d=\"M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z\"></path>",
  LockKeyhole: "<circle cx=\"12\" cy=\"16\" r=\"1\"></circle><rect x=\"3\" y=\"10\" width=\"18\" height=\"12\" rx=\"2\"></rect><path d=\"M7 10V7a5 5 0 0 1 10 0v3\"></path>",
  WifiOff: "<path d=\"M12 20h.01\"></path><path d=\"M8.5 16.429a5 5 0 0 1 7 0\"></path><path d=\"M5 12.859a10 10 0 0 1 5.17-2.69\"></path><path d=\"M19 12.859a10 10 0 0 0-2.007-1.523\"></path><path d=\"M2 8.82a15 15 0 0 1 4.177-2.643\"></path><path d=\"M22 8.82a15 15 0 0 0-11.288-3.764\"></path><path d=\"m2 2 20 20\"></path>",
  HardDrive: "<path d=\"M10 16h.01\"></path><path d=\"M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\"></path><path d=\"M21.946 12.013H2.054\"></path><path d=\"M6 16h.01\"></path>",
  CircleHelp: "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\"></path><path d=\"M12 17h.01\"></path>",
  ArrowRight: "<path d=\"M5 12h14\"></path><path d=\"m12 5 7 7-7 7\"></path>",
  Maximize2: "<path d=\"M15 3h6v6\"></path><path d=\"m21 3-7 7\"></path><path d=\"m3 21 7-7\"></path><path d=\"M9 21H3v-6\"></path>",
  Scissors: "<circle cx=\"6\" cy=\"6\" r=\"3\"></circle><path d=\"M8.12 8.12 12 12\"></path><path d=\"M20 4 8.12 15.88\"></path><circle cx=\"6\" cy=\"18\" r=\"3\"></circle><path d=\"M14.8 14.8 20 20\"></path>",
  Copy: "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\"></rect><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\"></path>",
  Filter: "<path d=\"M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z\"></path>",
  Sigma: "<path d=\"M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2\"></path>",
  Minus: "<path d=\"M5 12h14\"></path>",
  GripVertical: "<circle cx=\"9\" cy=\"12\" r=\"1\"></circle><circle cx=\"9\" cy=\"5\" r=\"1\"></circle><circle cx=\"9\" cy=\"19\" r=\"1\"></circle><circle cx=\"15\" cy=\"12\" r=\"1\"></circle><circle cx=\"15\" cy=\"5\" r=\"1\"></circle><circle cx=\"15\" cy=\"19\" r=\"1\"></circle>",
  Bookmark: "<path d=\"M6 3h12v18l-6-4-6 4V3Z\"/>",
  ArrowLeftRight: "<path d=\"M8 3.5 3.5 8 8 12.5M3.5 8H20M16 11.5l4.5 4.5-4.5 4.5M20.5 16H4\"/>",
} as const;

export type IconName = keyof typeof ICON_BODIES;
