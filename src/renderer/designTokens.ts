import type { ThemeConfig } from "antd";

// 取值来源：石墨 weboffice-design (`weboffice-design/theme`)。
// 名称沿用历史，待 --od-* 全面铺开后整体收敛。
export const shimo = {
  primary: "#41464B",
  primaryPressed: "#2C3033",
  primaryDeep: "#2C3033",
  primarySoft: "#F1F1F1",
  onPrimary: "#FFFFFF",
  brandNavy: "#41464B",
  linkBlue: "#5DA4E3",
  secondary: "#5DA4E3",
  secondaryContainer: "#F0FAFF",
  canvas: "#FFFFFF",
  surface: "#F7F7F7",
  surfaceSoft: "#F9F9F9",
  paper: "#FFFFFF",
  white: "#FFFFFF",
  hairline: "rgba(65,70,75,0.1)",
  hairlineSoft: "rgba(65,70,75,0.05)",
  hairlineStrong: "rgba(65,70,75,0.2)",
  ink: "#41464B",
  charcoal: "#2C3033",
  slate: "rgba(65,70,75,0.8)",
  steel: "rgba(65,70,75,0.6)",
  stone: "rgba(65,70,75,0.3)",
  muted: "rgba(65,70,75,0.3)",
  success: "#4FBD6C",
  warning: "#EDA14A",
  error: "#E86666",
  tintPeach: "#FFFAF0",
  tintRose: "#FFF2F0",
  tintMint: "#EDFCEF",
  tintLavender: "#F4EDFC",
  tintSky: "#F0FAFF",
  tintYellow: "#FFFFF0",
  tintYellowBold: "#FFFAB3",
  tintGray: "#F7F7F7",
} as const;

/** @deprecated 历史名称，请改用 `shimo`。 */
export const notion = shimo;

const fontFamily = "'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', -apple-system, system-ui, 'Segoe UI', sans-serif";
const fontFamilyHeading = "'Plus Jakarta Sans', -apple-system, system-ui, 'Segoe UI', 'PingFang SC', sans-serif";

export const theme: ThemeConfig = {
  token: {
    colorPrimary: shimo.primary,
    colorLink: shimo.secondary,
    colorLinkHover: shimo.primaryPressed,
    colorLinkActive: shimo.primaryDeep,
    colorSuccess: shimo.success,
    colorWarning: shimo.warning,
    colorError: shimo.error,
    colorText: shimo.charcoal,
    colorTextSecondary: shimo.slate,
    colorBorder: shimo.hairline,
    colorBgBase: shimo.surfaceSoft,
    colorBgContainer: shimo.canvas,
    borderRadius: 4,
    fontFamily,
  },
  components: {
    Button: {
      controlHeight: 32,
      borderRadius: 4,
      primaryShadow: "none",
      fontWeight: 500,
    },
    Input: {
      borderRadius: 4,
      controlHeight: 32,
      activeShadow: `0 0 0 2px rgba(93, 164, 227, 0.24)`,
    },
    Select: {
      borderRadius: 4,
      controlHeight: 32,
    },
    Table: {
      headerBg: shimo.surface,
      borderColor: shimo.hairline,
    },
    Tag: {
      borderRadiusSM: 4,
    },
    Tabs: {
      itemColor: shimo.steel,
      itemSelectedColor: shimo.charcoal,
      inkBarColor: shimo.charcoal,
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
