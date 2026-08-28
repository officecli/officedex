import type { ThemeConfig } from "antd";

// 取值来源：交互原型的调色板（纯中性灰 + 翠绿强调）。
// 组件形态来自 weboffice-design，颜色由本文件与 ui/palette.ts 决定。
export const shimo = {
  primary: "#0285FF",
  primaryPressed: "#0070DD",
  primaryDeep: "#0070DD",
  primarySoft: "#E9F3FF",
  onPrimary: "#FFFFFF",
  brandNavy: "#1F2124",
  linkBlue: "#0070DD",
  secondary: "#0285FF",
  secondaryContainer: "#E9F3FF",
  canvas: "#FFFFFF",
  surface: "#F2F2F3",
  surfaceSoft: "#FAFAFB",
  paper: "#FFFFFF",
  white: "#FFFFFF",
  hairline: "#ECEDEF",
  hairlineSoft: "#F3F4F5",
  hairlineStrong: "#E0E2E5",
  ink: "#1F2124",
  charcoal: "#1F2124",
  slate: "#62656B",
  steel: "#9A9DA3",
  stone: "#9A9DA3",
  muted: "#9A9DA3",
  success: "#2A9D62",
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
    borderRadius: 8,
    fontFamily,
  },
  components: {
    Button: {
      controlHeight: 28,
      borderRadius: 999,
      primaryShadow: "none",
      fontWeight: 500,
    },
    Input: {
      borderRadius: 8,
      controlHeight: 32,
      activeShadow: `0 0 0 2px oklch(62.6% .205 254.947 / .16)`,
    },
    Select: {
      borderRadius: 8,
      controlHeight: 32,
    },
    Table: {
      headerBg: shimo.surface,
      borderColor: shimo.hairline,
    },
    Tag: {
      borderRadiusSM: 6,
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
