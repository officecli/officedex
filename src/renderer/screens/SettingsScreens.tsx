import { Avatar, Button, Form, Input, Modal, Radio, Select, Space, Spin, Switch, Tabs, Tag, message } from "antd";
import {
  CheckCircleFilled,
  CopyOutlined,
  ExclamationCircleFilled,
  FolderOpenOutlined,
  GlobalOutlined,
  Loading3QuartersOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  UploadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { MaterialSymbol, StatusDot } from "../components/Shell";
import { officecli } from "../bridge";
import { useSettings } from "../useSettings";
import { ProviderForm } from "./OnboardingScreen";
import type { AuthEvent, DocumentType, GenerateDefaults, LlmProvider, WhoAmIResult } from "../../shared/types";

export function SettingsScreen({ fluid }: { fluid: boolean }) {
  if (fluid) {
    return <FluidSettings />;
  }
  const { settings, defaultWorkspaceDir, update, loading, saving, error } = useSettings();

  const updateDefaults = useCallback(
    (patch: Partial<GenerateDefaults>) => {
      update({ defaults: { ...settings.defaults, ...patch } }).catch(() => undefined);
    },
    [settings.defaults, update],
  );

  const pickOutputDir = useCallback(async () => {
    const picked = await officecli.openFileDialog();
    if (picked) {
      await update({ outputDir: picked }).catch(() => undefined);
    }
  }, [update]);

  const pickBridgeBinary = useCallback(async () => {
    const picked = await officecli.openFileDialog({ filters: [{ name: "All Files", extensions: ["*"] }] });
    if (picked) {
      await update({ bridgeBinaryPath: picked }).catch(() => undefined);
    }
  }, [update]);

  const rerunOnboarding = useCallback(() => {
    Modal.confirm({
      title: "Show onboarding wizard again?",
      content: "The 3-step wizard will appear next time you open OfficeDex. Your current settings are kept.",
      okText: "Show wizard",
      cancelText: "Cancel",
      onOk: () => update({ onboardingCompletedAt: null }).catch(() => undefined),
    });
  }, [update]);

  const resetAll = useCallback(() => {
    Modal.confirm({
      title: "Reset all settings to defaults?",
      content: "This clears the document type, mode, runtime, output directory, bridge binary path, and LLM provider. Onboarding will re-run on next launch.",
      okText: "Reset everything",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: () =>
        update({
          defaults: {
            documentType: "pptx",
            mode: "fast",
            runtimeMode: "hosted",
            enableImages: true,
            imageQuality: "standard",
          },
          outputDir: null,
          bridgeBinaryPath: null,
          llmProvider: null,
          onboardingCompletedAt: null,
        }).catch(() => undefined),
    });
  }, [update]);

  return (
    <div className="settings-layout">
      <aside className="settings-nav">
        {[
          ["person", "Account"],
          ["tune", "Generation Defaults"],
          ["terminal", "OfficeCLI Connection"],
          ["workspaces", "Workspace"],
          ["palette", "Appearance"],
          ["shield_lock", "Privacy & Data"],
        ].map(([icon, label], index) => (
          <button key={label} className={index === 1 ? "active" : ""}>
            <MaterialSymbol name={icon} />
            {label}
          </button>
        ))}
      </aside>
      <section className="settings-panel">
        <div className="page-header">
          <div>
            <h1>App Settings</h1>
            <p>Manage your account preferences and workspace configuration.</p>
          </div>
          {saving ? <Tag color="processing">Saving…</Tag> : <Tag color="green">Auto-saved</Tag>}
        </div>
        {error ? (
          <div className="settings-error">
            <ExclamationCircleFilled /> {error}
          </div>
        ) : null}
        {loading ? (
          <div className="settings-loading"><Spin /> <span>Loading settings…</span></div>
        ) : (
          <>
            <div className="setting-group">
              <h2>Generation Defaults</h2>
              <SettingRow title="Default Document Type" desc="Set the preferred output format for quick generation.">
                <Select
                  value={settings.defaults.documentType}
                  onChange={(value: DocumentType) => updateDefaults({ documentType: value })}
                  options={[
                    { value: "pptx", label: "PowerPoint (.pptx)" },
                    { value: "docx", label: "Word (.docx)" },
                    { value: "xlsx", label: "Excel (.xlsx)" },
                    { value: "report", label: "Report" },
                    { value: "img", label: "Image" },
                  ]}
                  style={{ minWidth: 220 }}
                />
              </SettingRow>
              <SettingRow title="Generation Mode" desc="Control the AI model's creativity level.">
                <Radio.Group
                  value={settings.defaults.mode}
                  onChange={(event) => updateDefaults({ mode: event.target.value })}
                  optionType="button"
                  buttonStyle="solid"
                  options={[
                    { value: "fast", label: "Fast" },
                    { value: "best", label: "Smart" },
                  ]}
                />
              </SettingRow>
              <SettingRow title="Runtime Environment" desc="Choose the compute node for rendering and processing documents.">
                <Radio.Group
                  value={settings.defaults.runtimeMode}
                  onChange={(event) => updateDefaults({ runtimeMode: event.target.value })}
                >
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <Radio value="hosted" className={`runtime-choice ${settings.defaults.runtimeMode === "hosted" ? "active" : ""}`}>
                      <StatusDot tone="green" />
                      <div>
                        <strong>Hosted</strong>
                        <span>Recommended — use OfficeCLI as the LLM provider. Fastest, highest concurrency.</span>
                      </div>
                    </Radio>
                    <Radio value="external" className={`runtime-choice ${settings.defaults.runtimeMode === "external" ? "active" : ""}`}>
                      <StatusDot tone="gray" />
                      <div>
                        <strong>External</strong>
                        <span>Bring your own LLM provider. Routes generation through your configured OfficeCLI bridge.</span>
                      </div>
                    </Radio>
                  </Space>
                </Radio.Group>
              </SettingRow>
              <SettingRow title="Enable Images" desc="Embed AI-generated images in supported documents.">
                <Switch checked={settings.defaults.enableImages} onChange={(checked) => updateDefaults({ enableImages: checked })} />
              </SettingRow>
              <SettingRow title="Image Quality" desc="Adjust the default resolution of images in documents.">
                <Select
                  value={settings.defaults.imageQuality}
                  onChange={(value: "standard" | "premium") => updateDefaults({ imageQuality: value })}
                  options={[
                    { value: "standard", label: "Standard" },
                    { value: "premium", label: "Premium" },
                  ]}
                  style={{ minWidth: 180 }}
                />
              </SettingRow>
            </div>
            <div className="setting-group">
              <h2>Workspace</h2>
              <SettingRow title="Workspace Output Directory" desc="Where generated artifacts are saved on disk. Leave empty to use the app data folder.">
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    placeholder={defaultWorkspaceDir || "(default workspace)"}
                    value={settings.outputDir ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      update({ outputDir: value.trim() ? value : null }).catch(() => undefined);
                    }}
                  />
                  <Button icon={<FolderOpenOutlined />} onClick={pickOutputDir}>Browse</Button>
                </Space.Compact>
                {settings.outputDir ? (
                  <Button type="link" size="small" onClick={() => update({ outputDir: null }).catch(() => undefined)}>
                    Reset to default
                  </Button>
                ) : null}
              </SettingRow>
            </div>
            <div className="setting-group">
              <h2>OfficeCLI Connection</h2>
              {settings.defaults.runtimeMode === "external" ? (
                <SettingRow title="External LLM Provider" desc="Configure the LLM endpoint that OfficeCLI will route generation requests through.">
                  <ProviderForm
                    provider={settings.llmProvider ?? { type: "openai", baseUrl: "", apiKey: "", model: "" }}
                    onChange={(patch: Partial<LlmProvider>) => {
                      const current = settings.llmProvider ?? { type: "openai" as const, baseUrl: "", apiKey: "", model: "" };
                      update({ llmProvider: { ...current, ...patch } }).catch(() => undefined);
                    }}
                  />
                  {settings.llmProvider ? (
                    <Button type="link" size="small" onClick={() => update({ llmProvider: null }).catch(() => undefined)}>
                      Clear provider
                    </Button>
                  ) : null}
                </SettingRow>
              ) : null}
              <SettingRow title="Bridge Binary Path" desc="Override the officecli binary used for bridge / login. Leave empty to use the bundled or PATH binary.">
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    placeholder="(use bundled / PATH)"
                    value={settings.bridgeBinaryPath ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      update({ bridgeBinaryPath: value.trim() ? value : null }).catch(() => undefined);
                    }}
                  />
                  <Button icon={<FolderOpenOutlined />} onClick={pickBridgeBinary}>Browse</Button>
                </Space.Compact>
                {settings.bridgeBinaryPath ? (
                  <Button type="link" size="small" onClick={() => update({ bridgeBinaryPath: null }).catch(() => undefined)}>
                    Reset to default
                  </Button>
                ) : null}
              </SettingRow>
            </div>
            <div className="setting-group">
              <h2>Reset</h2>
              <SettingRow title="Show onboarding wizard again" desc="Re-runs the 3-step setup on next app launch. Current settings are preserved.">
                <Button onClick={rerunOnboarding}>Show wizard</Button>
              </SettingRow>
              <SettingRow title="Reset all settings" desc="Wipes every setting back to defaults and re-shows onboarding.">
                <Button danger onClick={resetAll}>Reset everything</Button>
              </SettingRow>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

type LoginPhase = "loading" | "anonymous" | "awaiting" | "success" | "failure";

export function LoginScreen() {
  const [phase, setPhase] = useState<LoginPhase>("loading");
  const [whoami, setWhoami] = useState<WhoAmIResult | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  const phaseRef = useRef<LoginPhase>("loading");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const refreshWhoami = useCallback(async () => {
    try {
      const result = await officecli.whoami();
      if (!mountedRef.current) return;
      setWhoami(result);
      setPhase(result.mode === "anonymous" ? "anonymous" : "success");
    } catch (error) {
      if (!mountedRef.current) return;
      setErrorText(errorMessage(error));
      setPhase("failure");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refreshWhoami();
    const unsubscribe = officecli.onAuthEvent((event: AuthEvent) => {
      if (!mountedRef.current) return;
      if (event.type === "url") {
        setLoginUrl(event.url);
        setPhase("awaiting");
      } else if (event.type === "success") {
        void refreshWhoami();
      } else if (event.type === "failure") {
        setErrorText(event.message);
        setPhase("failure");
      } else if (event.type === "exit") {
        if (event.code !== 0 && phaseRef.current === "awaiting") {
          setErrorText(`Login process exited with code ${event.code ?? "null"}`);
          setPhase("failure");
        }
      }
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshWhoami]);

  const startLogin = useCallback(async () => {
    setBusy(true);
    setErrorText(null);
    try {
      const result = await officecli.login();
      setLoginUrl(result.url);
      setPhase("awaiting");
    } catch (error) {
      setErrorText(errorMessage(error));
      setPhase("failure");
    } finally {
      setBusy(false);
    }
  }, []);

  const cancelLogin = useCallback(async () => {
    await officecli.cancelLogin().catch(() => undefined);
    setPhase("anonymous");
    setLoginUrl(null);
  }, []);

  const openLoginUrl = useCallback(async () => {
    if (!loginUrl) return;
    await officecli.openExternal(loginUrl).catch(() => undefined);
  }, [loginUrl]);

  const copyLoginUrl = useCallback(async () => {
    if (!loginUrl) return;
    try {
      await navigator.clipboard.writeText(loginUrl);
      void message.success("Login URL copied");
    } catch {
      void message.error("Failed to copy");
    }
  }, [loginUrl]);

  const doLogout = useCallback(async () => {
    setBusy(true);
    try {
      await officecli.logout();
      setWhoami({ mode: "anonymous" });
      setPhase("anonymous");
      setLoginUrl(null);
    } catch (error) {
      setErrorText(errorMessage(error));
      setPhase("failure");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-mark">
          <MaterialSymbol name={phase === "success" ? "person" : "lock_open"} />
        </div>
        <h1>{titleFor(phase)}</h1>
        <p>{subtitleFor(phase, whoami)}</p>

        {phase === "loading" ? (
          <div className="login-status loading">
            <Loading3QuartersOutlined spin />
            <span>Checking sign-in status…</span>
          </div>
        ) : null}

        {phase === "anonymous" ? (
          <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
            <Button type="primary" icon={<GlobalOutlined />} block loading={busy} onClick={startLogin}>
              Sign in via browser
            </Button>
            <p className="copyright">A browser window will open for sign-in. Return here once complete.</p>
          </Space>
        ) : null}

        {phase === "awaiting" ? (
          <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
            <div className="login-status awaiting">
              <Loading3QuartersOutlined spin />
              <span>Waiting for browser sign-in…</span>
            </div>
            {loginUrl ? (
              <div className="login-url-box">
                <span className="login-url-text" title={loginUrl}>{loginUrl}</span>
                <Space>
                  <Button size="small" icon={<CopyOutlined />} onClick={copyLoginUrl}>Copy</Button>
                  <Button size="small" type="link" onClick={openLoginUrl}>Open again</Button>
                </Space>
              </div>
            ) : null}
            <Button block onClick={cancelLogin}>Cancel</Button>
          </Space>
        ) : null}

        {phase === "success" && whoami ? (
          <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
            <div className="login-status success">
              <CheckCircleFilled />
              <span>Signed in</span>
            </div>
            <div className="login-info">
              <InfoRow label="Mode" value={modeLabel(whoami.mode)} />
              {whoami.userId ? <InfoRow label="User ID" value={whoami.userId} /> : null}
              {whoami.session ? <InfoRow label="Session" value={whoami.session} /> : null}
              {whoami.expiresAt ? <InfoRow label="Expires" value={whoami.expiresAt} /> : null}
            </div>
            <Button block icon={<LogoutOutlined />} loading={busy} onClick={doLogout}>
              Sign out
            </Button>
          </Space>
        ) : null}

        {phase === "failure" ? (
          <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
            <div className="login-status failure">
              <ExclamationCircleFilled />
              <span>{errorText || "Sign-in failed"}</span>
            </div>
            <Button type="primary" block onClick={startLogin}>
              Try again
            </Button>
          </Space>
        ) : null}

        <span className="copyright">© 2026 OfficeDex</span>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="login-info-row">
      <span className="login-info-label">{label}</span>
      <span className="login-info-value">{value}</span>
    </div>
  );
}

function titleFor(phase: LoginPhase): string {
  switch (phase) {
    case "loading":
      return "Sign in to OfficeDex";
    case "anonymous":
      return "Sign in to OfficeDex";
    case "awaiting":
      return "Complete sign-in in your browser";
    case "success":
      return "You're signed in";
    case "failure":
      return "Sign-in failed";
  }
}

function subtitleFor(phase: LoginPhase, whoami: WhoAmIResult | null): string {
  switch (phase) {
    case "loading":
      return "Verifying your local session.";
    case "anonymous":
      return "Open a browser to sign in with your OfficeCLI account.";
    case "awaiting":
      return "We've opened your browser. Finish sign-in there to continue.";
    case "success":
      return whoami?.userId ? `Connected as user ${whoami.userId}.` : "Your OfficeCLI account is connected.";
    case "failure":
      return "Try again, or check the OfficeCLI bridge in Settings.";
  }
}

function modeLabel(mode: WhoAmIResult["mode"]): string {
  switch (mode) {
    case "logged_in":
      return "Account";
    case "api_key":
      return "API Key";
    case "anonymous":
      return "Anonymous";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function FluidSettings() {
  return (
    <div className="settings-layout fluid-settings">
      <aside className="settings-nav">
        {["Account", "Generation Defaults", "Connection", "Workspace", "Appearance"].map((label, index) => (
          <button key={label} className={index === 0 ? "active" : ""}>
            {label}
          </button>
        ))}
      </aside>
      <section className="settings-panel">
        <div className="page-header">
          <div>
            <h1>Settings</h1>
            <p>Manage your account preferences and workspace configuration.</p>
          </div>
          <Button icon={<SaveOutlined />} type="primary">
            Save Changes
          </Button>
        </div>
        <Tabs
          items={[
            {
              key: "profile",
              label: "Profile",
              children: (
                <div className="setting-group">
                  <Space align="center" size={20}>
                    <Avatar size={64} icon={<UserOutlined />} />
                    <Button icon={<UploadOutlined />}>Change Avatar</Button>
                  </Space>
                  <Form layout="vertical" className="profile-form">
                    <Form.Item label="First Name">
                      <Input defaultValue="Alex" />
                    </Form.Item>
                    <Form.Item label="Last Name">
                      <Input defaultValue="Chen" />
                    </Form.Item>
                    <Form.Item label="Email">
                      <Input defaultValue="alex.chen@officedex.ai" />
                    </Form.Item>
                    <Form.Item label="Role / Title">
                      <Input defaultValue="AI Product Manager" />
                    </Form.Item>
                  </Form>
                </div>
              ),
            },
            {
              key: "security",
              label: "Security",
              children: (
                <div className="setting-group">
                  <SettingRow title="Password" desc="Last changed 3 months ago">
                    <Button>Update</Button>
                  </SettingRow>
                  <SettingRow title="Two-Factor Authentication (2FA)" desc="Enhance account security">
                    <Switch checked />
                  </SettingRow>
                  <SettingRow title="Session Protection" desc="Auto-lock idle workspaces">
                    <SafetyCertificateOutlined className="large-setting-icon" />
                  </SettingRow>
                </div>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}

function SettingRow({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
