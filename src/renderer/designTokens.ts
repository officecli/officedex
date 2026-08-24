import type { ThemeConfig } from "antd";

// 取值来源：交互原型的调色板（纯中性灰 + 翠绿强调）。
// 组件形态来自 weboffice-design，颜色由本文件与 ui/palette.ts 决定。
export const shimo = {
  primary: "#171717",
  primaryPressed: "#0A0A0A",
  primaryDeep: "#0A0A0A",
  primarySoft: "#F5F5F5",
  onPrimary: "#FFFFFF",
  brandNavy: "#171717",
  linkBlue: "#007A55",
  secondary: "#007A55",
  secondaryContainer: "#E5F9EF",
  canvas: "#FFFFFF",
  surface: "#F5F5F5",
  surfaceSoft: "#FAFAFA",
  paper: "#FFFFFF",
  white: "#FFFFFF",
  hairline: "#E5E5E5",
  hairlineSoft: "#F2F2F2",
  hairlineStrong: "#D4D4D4",
  ink: "#0A0A0A",
  charcoal: "#0A0A0A",
  slate: "#404040",
  steel: "#737373",
  stone: "#A1A1A1",
  muted: "#A1A1A1",
  success: "#007A55",
  warning: "#B45309",
  error: "#DC2626",
  tintPeach: "#FEF0E2",
  tintRose: "#FDE7E7",
  tintMint: "#E5F9EF",
  tintLavender: "#EFEAF9",
  tintSky: "#E4EFFA",
  tintYellow: "#FBF3DA",
  tintYellowBold: "#F5E4A8",
  tintGray: "#F5F5F5",
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
