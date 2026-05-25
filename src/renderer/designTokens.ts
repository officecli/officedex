import type { ThemeConfig } from "antd";

export const notion = {
  primary: "#5645d4",
  primaryPressed: "#4534b3",
  primaryDeep: "#3a2a99",
  onPrimary: "#ffffff",
  brandNavy: "#0a1530",
  linkBlue: "#0075de",
  canvas: "#ffffff",
  surface: "#f6f5f4",
  surfaceSoft: "#fafaf9",
  hairline: "#e5e3df",
  hairlineSoft: "#ede9e4",
  hairlineStrong: "#c8c4be",
  ink: "#1a1a1a",
  charcoal: "#37352f",
  slate: "#5d5b54",
  steel: "#787671",
  stone: "#a4a097",
  muted: "#bbb8b1",
  success: "#1aae39",
  warning: "#dd5b00",
  error: "#e03131",
  tintPeach: "#ffe8d4",
  tintRose: "#fde0ec",
  tintMint: "#d9f3e1",
  tintLavender: "#e6e0f5",
  tintSky: "#dcecfa",
  tintYellow: "#fef7d6",
  tintYellowBold: "#f9e79f",
  tintGray: "#f0eeec",
} as const;

const fontFamily = "'Plus Jakarta Sans', -apple-system, system-ui, 'Segoe UI', 'PingFang SC', sans-serif";
const fontFamilyHeading = "'DM Serif Display', Georgia, 'Times New Roman', serif";

export const theme: ThemeConfig = {
  token: {
    colorPrimary: notion.primary,
    colorLink: notion.primary,
    colorLinkHover: notion.primaryPressed,
    colorLinkActive: notion.primaryDeep,
    colorSuccess: notion.success,
    colorWarning: notion.warning,
    colorError: notion.error,
    colorText: notion.charcoal,
    colorTextSecondary: notion.slate,
    colorBorder: notion.hairline,
    colorBgBase: notion.surfaceSoft,
    colorBgContainer: notion.canvas,
    borderRadius: 8,
    fontFamily,
  },
  components: {
    Button: {
      controlHeight: 38,
      borderRadius: 8,
      primaryShadow: "none",
      fontWeight: 500,
    },
    Input: {
      borderRadius: 8,
      controlHeight: 44,
      activeShadow: `0 0 0 2px rgba(86, 69, 212, 0.12)`,
    },
    Select: {
      borderRadius: 8,
      controlHeight: 38,
    },
    Table: {
      headerBg: notion.surface,
      borderColor: notion.hairline,
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Tabs: {
      itemColor: notion.steel,
      itemSelectedColor: notion.charcoal,
      inkBarColor: notion.charcoal,
    },
  },
};

export { fontFamily, fontFamilyHeading };

export const pageMapping = [
  { page: "_1", mappedTo: "Dialogue running state: Bridge Events execution pipeline + docked composer" },
  { page: "_2", mappedTo: "New generation empty state: target artifact selection, mode, runtime, and bottom input" },
  { page: "_3", mappedTo: "Dialogue completed state: result card, open file, session artifacts/sources sidebar" },
  { page: "_4", mappedTo: "Dialogue confirmation state: questions needing user confirmation, quick options, task status sidebar" },
  { page: "_5", mappedTo: "Connection failure page: bridge unavailable notice, retry, open settings, diagnostics" },
  { page: "_6", mappedTo: "App settings page: generation defaults, OfficeCLI connection, workspace, appearance config" },
  { page: "_7", mappedTo: "Login page: email/password login, Google sign-in, workspace sync prompt" },
  { page: "_8", mappedTo: "Recent tasks page: task table, status filters, search, and actions" },
  { page: "_9", mappedTo: "Artifacts page: artifact card grid, format filters, preview/download actions, empty state" },
  { page: "_10", mappedTo: "Template center page: template categories and template cards" },
  { page: "_11", mappedTo: "Fluid new task page: sidebar, recommended generation cards, format chips, and input area" },
  { page: "_12", mappedTo: "Fluid running page: step progress flow, cancel task, and bottom composer" },
  { page: "_13", mappedTo: "Fluid completed state: success notice, artifact card, Open/Preview/Show in folder" },
  { page: "_14", mappedTo: "Fluid content library: file list, type tabs, and file detail inspector sidebar" },
  { page: "_15", mappedTo: "Fluid settings page: account profile, security, 2FA, and settings navigation" },
];
