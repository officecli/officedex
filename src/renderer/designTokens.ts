export const notion = {
  primary: "#05101a",
  primaryPressed: "#1a2530",
  primaryDeep: "#05101a",
  primarySoft: "#f0eee6",
  onPrimary: "#ffffff",
  brandNavy: "#05101a",
  linkBlue: "#006876",
  secondary: "#006876",
  secondaryContainer: "#9fecfc",
  canvas: "#ffffff",
  surface: "#f0eee6",
  surfaceSoft: "#fcfaf2",
  paper: "#ffffff",
  white: "#ffffff",
  hairline: "#e6e4d8",
  hairlineSoft: "#eae8e0",
  hairlineStrong: "#c4c6cc",
  ink: "#1a2530",
  charcoal: "#1b1c17",
  slate: "#44474b",
  steel: "#74777c",
  stone: "#c4c6cc",
  muted: "#c4c6cc",
  success: "#1aae39",
  warning: "#dd5b00",
  error: "#ba1a1a",
  tintPeach: "#ffe8d4",
  tintRose: "#fde0ec",
  tintMint: "#d9f3e1",
  tintLavender: "#e6e0f5",
  tintSky: "#dcecfa",
  tintYellow: "#fef7d6",
  tintYellowBold: "#f9e79f",
  tintGray: "#f0eee6",
} as const;

const fontFamily = "'Inter', -apple-system, system-ui, 'Segoe UI', 'PingFang SC', sans-serif";
const fontFamilyHeading = "'Plus Jakarta Sans', -apple-system, system-ui, 'Segoe UI', 'PingFang SC', sans-serif";

export const theme = {
  token: {
    colorPrimary: notion.primary,
    colorLink: notion.secondary,
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
      activeShadow: `0 0 0 2px rgba(5, 16, 26, 0.08)`,
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
  { page: "_1", mappedTo: "Document running state: execution pipeline + docked intent controls" },
  { page: "_2", mappedTo: "New generation empty state: target artifact selection, mode, runtime, and bottom input" },
  { page: "_3", mappedTo: "Document completed state: artifact preview and file actions" },
  { page: "_4", mappedTo: "Document confirmation state: inline questions, quick options, and run status" },
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
