import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  Cable,
  Clock3,
  LayoutGrid,
  Loader2,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Star,
  Wallet,
  X,
} from "lucide-react";

import { Modal, toast } from "../../renderer/ui";
import { useT } from "../../renderer/i18n";
import { useDesktopApi } from "../../renderer/services/desktopApi";
import { useSettings } from "../../renderer/useSettings";
import { errorMessage } from "../../renderer/utils/values";
import type { CreditStatus, GenerateDefaults, InviteInfo, WhoAmIResult } from "../../shared/types";
import {
  ActivitySection,
  AppearanceSection,
  GenerationSection,
  NotificationsSection,
  ResetSection,
  SettingsError,
} from "./SettingsSections";
import { ConnectionSection } from "./ConnectionSection";
import { SubscriptionSection } from "./SubscriptionSection";
import { AdvancedSection } from "./AdvancedSection";
import { AboutSection } from "./AboutSection";
import "./settings.css";

/**
 * The settings page — the shell's second full-page surface, after the account
 * page, and the one the shell was missing entirely.
 *
 * **Why a page and not a panel.** Every full-page rule the account page states
 * applies here, for the same reason: the cover is a sibling of every region, so
 * opening it does not unmount the workspace, and closing it puts the user back
 * exactly where they were. That is decision 4 in `App.tsx`, and a settings page
 * that tore the open document's editor down would be the one screen that
 * breaks it. The cover is opaque, at `--shell-z-gate`, and the shell's own
 * menus are below it.
 *
 * **What "content consistent with legacy" means here.** The nine sections,
 * their order, their copy and every write are the ones
 * `renderer/screens/SettingsScreen.tsx` had. The copy is not re-typed: all of
 * it already lives in `renderer/i18n/{en,zh}.ts` under `settings.*`, and this
 * page routes every string through `t()` — which is also what keeps
 * `test/copyRatchet.test.ts` from counting one new untranslated string.
 *
 * Three details are deliberately *not* carried over, and each is a decision
 * rather than an omission:
 *
 * 1. The row legacy rendered for `settings.row.imageQuality.*` never had a
 *    control in either renderer (`defaults.imageQuality` is written by the
 *    backend and read by nothing). Drawing one here would invent a setting.
 * 2. `Review changes`, the sidebar menu's third row, is not a setting: it is a
 *    permission tier that lives in the composer's own menu and answers there
 *    with "not available yet". Copying a known-inert switch onto a page whose
 *    whole purpose is to be the honest list of what can be changed would make
 *    this page worse than the menu it replaces.
 * 3. The `activity` slot is not a prop from a parent shell, because this shell
 *    has no task store to pass one from. `ActivitySection` reads the port's own
 *    run list instead — see the note there.
 */
type SectionKey =
  | "generation"
  | "notifications"
  | "appearance"
  | "connection"
  | "subscription"
  | "activity"
  | "advanced"
  | "reset"
  | "about";

const SECTION_ORDER: readonly SectionKey[] = [
  "generation",
  "notifications",
  "appearance",
  "connection",
  "subscription",
  "activity",
  "advanced",
  "reset",
  "about",
];

export function SettingsPage({
  onClose,
  onOpenLogin,
}: {
  onClose: () => void;
  /**
   * Opens the account page. The provider section offers a sign-in link when a
   * custom endpoint is locked behind being signed in, and this shell's sign-in
   * surface is the account page — one full-page flow, not a second one.
   */
  onOpenLogin?: () => void;
}) {
  const api = useDesktopApi();
  const t = useT();
  const { settings, update: rawUpdate, loading, saving, error } = useSettings();
  const [section, setSection] = useState<SectionKey>("generation");
  const [whoami, setWhoami] = useState<WhoAmIResult | null>(null);
  const [creditStatus, setCreditStatus] = useState<CreditStatus | null>(null);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  /*
   * `whoami`, the credit snapshot and the invite code are three reads of the
   * same sign-in state, asked once each. None of them polls: they change when
   * the user signs in or out, and that happens on the account page this one
   * links to — not while this page sits open.
   */
  useEffect(() => {
    let cancelled = false;
    api
      .whoami()
      .then((result) => {
        if (!cancelled) setWhoami(result);
      })
      .catch(() => {
        if (!cancelled) setWhoami({ mode: "anonymous" });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const refreshCredit = useCallback(() => {
    api
      .getCreditStatus()
      .then(setCreditStatus)
      .catch(() => setCreditStatus(null));
  }, [api]);

  useEffect(() => {
    refreshCredit();
  }, [refreshCredit]);

  useEffect(() => {
    if (whoami?.mode !== "logged_in") {
      setInviteInfo(null);
      setInviteError(null);
      setInviteLoading(false);
      return;
    }
    let cancelled = false;
    setInviteLoading(true);
    setInviteError(null);
    api
      .getInviteInfo()
      .then((result) => {
        if (!cancelled) setInviteInfo(result);
      })
      .catch((reason) => {
        if (!cancelled) setInviteError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setInviteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, whoami]);

  /*
   * Escape leaves the page, unless an overlay owns it first.
   *
   * This listens in the **capture** phase on `window`, and that is load-bearing
   * rather than stylistic. The shared overlays dismiss themselves in a bubble
   * listener on `document` (`services/dialog.tsx`, `Popover.tsx`), which runs
   * before a bubble listener on `window` does — and React flushes a discrete
   * event like `keydown` synchronously, so by the time a bubble listener here
   * looked, the confirmation's mask was already out of the DOM and the page
   * closed as well. Measured, not theorised: one Escape with the reset
   * confirmation open left `page: 0, dialog: 0`, when it must leave the page up.
   *
   * Window capture runs before `document` bubble, so the overlay is still
   * mounted when this decides. `useModalBehaviour` also uses capture, on
   * `document`, which is likewise later than this.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".od-dialog-mask") || document.querySelector(".od-popover")) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  /** Every write announces itself once, under one toast key, as legacy did. */
  const update = useCallback(
    async (patch: Parameters<typeof rawUpdate>[0]) => {
      const next = await rawUpdate(patch);
      void toast.success({ content: t("settings.toast.autoSaved"), key: "settings-auto-saved", duration: 2 });
      return next;
    },
    [rawUpdate, t],
  );

  const updateDefaults = useCallback(
    (patch: Partial<GenerateDefaults>) => {
      void update({ defaults: { ...settings.defaults, ...patch } }).catch(() => undefined);
    },
    [settings.defaults, update],
  );

  const rerunOnboarding = useCallback(() => {
    Modal.confirm({
      title: t("settings.row.onboarding.confirmTitle"),
      content: t("settings.row.onboarding.confirmBody"),
      okText: t("settings.row.onboarding.confirmOk"),
      cancelText: t("settings.common.cancel"),
      onOk: () => void update({ onboardingCompletedAt: null }).catch(() => undefined),
    });
  }, [t, update]);

  const resetAll = useCallback(() => {
    Modal.confirm({
      title: t("settings.row.reset.confirmTitle"),
      content: t("settings.row.reset.confirmBody"),
      okText: t("settings.row.reset.button"),
      okButtonProps: { danger: true },
      cancelText: t("settings.common.cancel"),
      onOk: () =>
        void update({
          defaults: { documentType: "pptx", enableImages: true, enableWebSearch: false, imageQuality: "premium" },
          workspaceDir: null,
          outputDir: null,
          llmProvider: null,
          onboardingCompletedAt: null,
          imageWatermark: { showWatermark: true, preferenceSource: "system" },
        }).catch(() => undefined),
    });
  }, [t, update]);

  const sections: Record<SectionKey, { label: string; icon: ReactNode }> = {
    generation: { label: t("settings.group.generation"), icon: <Star size={16} strokeWidth={1.7} aria-hidden="true" /> },
    notifications: { label: t("settings.group.notifications"), icon: <Bell size={16} strokeWidth={1.7} aria-hidden="true" /> },
    appearance: { label: t("settings.group.appearance"), icon: <Palette size={16} strokeWidth={1.7} aria-hidden="true" /> },
    connection: { label: t("settings.group.connection"), icon: <Cable size={16} strokeWidth={1.7} aria-hidden="true" /> },
    subscription: { label: t("settings.group.subscription"), icon: <Wallet size={16} strokeWidth={1.7} aria-hidden="true" /> },
    activity: { label: t("settings.group.activity"), icon: <Clock3 size={16} strokeWidth={1.7} aria-hidden="true" /> },
    advanced: {
      label: t("settings.group.advanced"),
      icon: <SlidersHorizontal size={16} strokeWidth={1.7} aria-hidden="true" />,
    },
    reset: { label: t("settings.group.reset"), icon: <RotateCcw size={16} strokeWidth={1.7} aria-hidden="true" /> },
    about: { label: t("settings.group.about"), icon: <LayoutGrid size={16} strokeWidth={1.7} aria-hidden="true" /> },
  };

  const renderSection = () => {
    switch (section) {
      case "generation":
        return <GenerationSection settings={settings} onDefaults={updateDefaults} />;
      case "notifications":
        return <NotificationsSection />;
      case "appearance":
        return <AppearanceSection />;
      case "connection":
        return <ConnectionSection />;
      case "subscription":
        return (
          <SubscriptionSection
            whoami={whoami}
            inviteInfo={inviteInfo}
            inviteError={inviteError}
            inviteLoading={inviteLoading}
            onCreditRefresh={refreshCredit}
          />
        );
      case "activity":
        return <ActivitySection />;
      case "advanced":
        return (
          <AdvancedSection
            settings={settings}
            update={update}
            creditStatus={creditStatus}
            whoami={whoami}
            onOpenLogin={onOpenLogin}
            onRerunOnboarding={rerunOnboarding}
          />
        );
      case "reset":
        return <ResetSection onReset={resetAll} />;
      case "about":
        return <AboutSection />;
      default:
        return null;
    }
  };

  return (
    <div className="shell-settings" role="dialog" aria-modal="true" aria-label={t("settings.page.title")}>
      <div className="shell-settings-page">
        <div className="shell-settings-head">
          <div className="shell-settings-heading">
            <p className="shell-settings-eyebrow">{t("ui.copy.OFFICEDEXSETTINGS")}</p>
            <h1 className="shell-settings-title">{t("settings.page.title")}</h1>
            <p className="shell-settings-subtitle">{t("settings.page.subtitle")}</p>
          </div>
          <div className="shell-settings-head-actions">
            <span className="shell-settings-save" data-state={saving ? "saving" : "saved"}>
              <span aria-hidden="true" />
              {saving ? t("settings.tag.saving") : t("settings.tag.autoSaved")}
            </span>
            <button
              type="button"
              className="shell-settings-close"
              onClick={onClose}
              aria-label={t("login.button.return")}
              title={t("login.button.return")}
            >
              <X size={15} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="shell-settings-layout">
          <nav className="shell-settings-nav" aria-label={t("settings.secondaryMenu.label")}>
            {SECTION_ORDER.map((key) => (
              <Fragment key={key}>
                {key === "activity" ? <div className="shell-settings-nav-sep" aria-hidden="true" /> : null}
                <button
                  type="button"
                  className="shell-settings-nav-item"
                  aria-current={section === key ? "page" : undefined}
                  aria-label={sections[key].label}
                  onClick={() => setSection(key)}
                >
                  <span className="shell-settings-nav-icon" aria-hidden="true">
                    {sections[key].icon}
                  </span>
                  <span className="shell-settings-nav-label">{sections[key].label}</span>
                </button>
              </Fragment>
            ))}
          </nav>

          <section className="shell-settings-content" aria-label={sections[section].label}>
            {error ? <SettingsError message={error} /> : null}
            {loading ? (
              <div className="shell-settings-loading">
                <Loader2 className="shell-settings-spin" size={15} aria-hidden="true" />
                <span>{t("settings.loading")}</span>
              </div>
            ) : (
              renderSection()
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
