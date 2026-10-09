import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useSetLocale } from "../../renderer/i18n";
import { useDesktopApi } from "../../renderer/services/desktopApi";
import type { CreditStatus, DefaultDocumentApp, SetupState } from "../../shared/types";
import { useShell } from "../state/ShellContext";
import { useLibraryActions } from "../nav/useLibraryActions";
import { Icon } from "../kit/Icon";
import { toast } from "../../renderer/ui";
import copy from "./copy.json";
import dex from "./assets/dex.svg";
import introduction from "./assets/introduction.svg";
import models from "./assets/models.svg";
import "./setup.css";

const translations = Object.fromEntries(Object.entries(copy).map(([zh, en]) => [en, zh]));
const fresh: SetupState = { version: 1, status: "pending", step: "welcome", startMode: "agent" };
type Page = SetupState["step"] | "awaiting" | "login-error";
export const SETUP_OPEN = "officedex:open-setup";
const extensions = ["docx", "xlsx", "pptx"];

export function creditPhase(credit: CreditStatus): "ready" | "low" | "unknown" {
  const available = credit.hostedCreditBalance ?? credit.anonymousCreditAvailable;
  if (available === null) return "unknown";
  return available <= 0 && credit.rewardRemaining <= 0 && credit.paidKeyRemaining <= 0 ? "low" : "ready";
}

export function SetupHost({ onVisibility, onAccountChanged }: { onVisibility: (visible: boolean) => void; onAccountChanged: () => void }) {
  const api = useDesktopApi();
  const locale = useLocale(); const setLocale = useSetLocale();
  const text = (en: string, zh?: string) => locale === "zh" ? zh ?? translations[en] ?? en : en;
  const { loaded, state: shell, dispatch } = useShell();
  const library = useLibraryActions();
  const [setup, setSetup] = useState<SetupState>(fresh);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>("welcome");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [skip, setSkip] = useState(false);
  const [manual, setManual] = useState(false);
  const [defaultsOnly, setDefaultsOnly] = useState(false);
  const [results, setResults] = useState<DefaultDocumentApp[] | null>(null);
  const [credit, setCredit] = useState<"loading" | "ready" | "low" | "unknown">("loading");
  const [loginURL, setLoginURL] = useState("");
  const loginAttempt = useRef(0);
  const waiting = useRef(false);
  const loginFlow = useRef("");
  const panel = useRef<HTMLDivElement>(null);
  const skipPanel = useRef<HTMLDivElement>(null);
  const skipTrigger = useRef<HTMLButtonElement>(null);
  const nativeOpening = useRef(false);
  const current = useRef({ setup, library, shell, visible }); current.current = { setup, library, shell, visible };

  useEffect(() => {
    let disposed = false;
    api.getSetupState().then(value => {
      if (disposed) return;
      setSetup(value); setPage(value.step); setVisible(value.status === "pending"); setReady(true);
    }).catch(reason => { if (!disposed) { setReady(true); void toast.error(String(reason)); } });
    const open = (event: Event) => {
      const onlyDefaults = (event as CustomEvent).detail === "defaults";
      setManual(true); setDefaultsOnly(onlyDefaults); setChecked(false); setResults(null); setError("");
      setPage(onlyDefaults ? "defaults" : (event as CustomEvent).detail === "welcome" ? "welcome" : "introduction"); setVisible(true);
    };
    window.addEventListener(SETUP_OPEN, open);
    return () => { disposed = true; window.removeEventListener(SETUP_OPEN, open); };
  }, [api]);

  useEffect(() => { onVisibility(visible); }, [visible, onVisibility]);
  const windowStage = !visible ? "workspace" : ["welcome", "awaiting", "login-error"].includes(page) ? "welcome" : "setup";
  useEffect(() => {
    if (!ready) return;
    void api.setSetupWindow(windowStage).catch(reason => setError(String(reason)));
  }, [api, windowStage, ready]);
  useEffect(() => {
    if (visible) panel.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [page, visible]);
  useEffect(() => {
    if (skip) skipPanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [skip]);

  // Poll the small native event queue only when the workspace can consume it.
  // The backend retains cold-start and in-setup Finder events until this point.
  useEffect(() => {
    if (!ready || !loaded || visible) return;
    let disposed = false;
    const drain = async () => {
      if (nativeOpening.current) return;
      nativeOpening.current = true;
      try {
        const paths = await api.takeNativeOpenFiles();
        if (paths.length) await current.current.library.openDropped(paths);
      } catch (reason) { if (!disposed) void toast.error(String(reason)); }
      finally { nativeOpening.current = false; }
    };
    void drain(); const timer = window.setInterval(() => void drain(), 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [api, ready, loaded, visible]);

  const move = async (step: SetupState["step"], mode = setup.startMode) => {
    const next = { ...setup, step, startMode: mode };
    await api.saveSetupState(next); setSetup(next); setPage(step); setError("");
  };
  const act = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const refreshCredit = async () => {
    setCredit("loading");
    try { setCredit(creditPhase(await api.getCreditStatus())); } catch { setCredit("unknown"); }
  };
  useEffect(() => {
    if (!visible || page !== "ai") return;
    void refreshCredit();
    const focus = () => void refreshCredit();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [visible, page, api]);

  useEffect(() => api.onAuthEvent(event => {
    if (!waiting.current || event.flowId !== loginFlow.current) return;
    const attempt = loginAttempt.current;
    if (event.type === "success") {
      void api.whoami().then(async identity => {
        if (!waiting.current || attempt !== loginAttempt.current || identity.mode !== "logged_in") return;
        waiting.current = false; onAccountChanged();
        const next = { ...current.current.setup, step: "introduction" as const };
        await api.saveSetupState(next); setSetup(next); setPage("introduction");
      }).catch(reason => setError(String(reason)));
    } else if (event.type === "failure" || (event.type === "exit" && event.code !== 0)) {
      waiting.current = false; setPage("login-error");
    }
  }), [api, onAccountChanged]);
  useEffect(() => {
    if (page !== "awaiting") return;
    const timeout = setTimeout(() => {
      waiting.current = false; loginAttempt.current++;
      void api.cancelLogin(); setPage("login-error");
    }, 10 * 60 * 1000);
    return () => clearTimeout(timeout);
  }, [page, api]);
  useEffect(() => () => { if (waiting.current) { waiting.current = false; void api.cancelLogin(); } }, [api]);

  const login = () => act(async () => {
    waiting.current = false; loginAttempt.current++;
    await api.cancelLogin();
    const identity = await api.whoami();
    if (identity.mode === "logged_in") { await move("introduction"); return; }
    waiting.current = true; loginFlow.current = crypto.randomUUID(); setPage("awaiting");
    try { const result = await api.login({ flowId: loginFlow.current }); setLoginURL(result.url); await api.openExternal(result.url); }
    catch (reason) { waiting.current = false; setPage("login-error"); throw reason; }
  });
  const finish = async (skipped = false, localShortcut = false) => {
    waiting.current = false; loginAttempt.current++; await api.cancelLogin();
    const next = { ...setup, status: skipped ? "skipped" as const : "completed" as const };
    if (!defaultsOnly) { await api.saveSetupState(next); setSetup(next); }
    setSkip(false);
    if (defaultsOnly || (manual && current.current.shell.activeFileId)) { setVisible(false); return; }
    dispatch({ type: "go", page: localShortcut || setup.startMode === "local" ? "local" : "home" });
    if (current.current.shell.navCollapsed) dispatch({ type: "toggle-nav" });
    const pending = await api.takeNativeOpenFiles();
    if (pending.length) await library.openDropped(pending);
    else if (localShortcut) await library.openFromDisk();
    setVisible(false);
    if (!pending.length && !localShortcut && setup.startMode === "agent") requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-draft="home"]')?.focus());
  };
  const submitDefaults = () => act(async () => {
    if (!checked) { await finish(); return; }
    const pending = results ? results.filter(item => !item.isDefault).map(item => item.extension) : extensions;
    const changed = await api.setDefaultDocumentApps(pending);
    const merged = extensions.map(extension => changed.find(item => item.extension === extension) ?? results?.find(item => item.extension === extension) ?? { extension, isDefault: false });
    setResults(merged);
    if (merged.every(item => item.isDefault)) await finish();
  });
  const closeSkip = () => { setSkip(false); requestAnimationFrame(() => skipTrigger.current?.focus()); };
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape" && skip) { event.preventDefault(); closeSkip(); }
    if (event.key !== "Tab") return;
    const root = skip ? skipPanel.current : panel.current;
    const focusable = [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]') ?? [])];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  if (!visible) return null;
  const heading = (title: string, body?: string) => <><h1 tabIndex={-1}>{text(title)}</h1>{body && <p>{text(body)}</p>}</>;
  const button = (label: string, action: () => void, primary = false) => <button type="button" className={primary ? "setup-primary" : ""} disabled={busy} onClick={action}>{text(label)}</button>;
  const back = page === "ai" ? "introduction" : page === "preferences" ? "ai" : "preferences";
  return <div className="setup-overlay" ref={panel} role="dialog" aria-modal="true" aria-label={text("Get started")} onKeyDown={keys}>
    <div className="setup-drag" />
    <main className={`setup-content setup-${page}`} inert={skip}>
      {["welcome", "awaiting", "login-error"].includes(page) ? <div className="setup-welcome-content">
        <img className="setup-dex" src={dex} alt="" />
        {heading(page === "welcome" ? "Welcome to OfficeDex" : page === "awaiting" ? "Finish logging in in your browser" : "You haven't logged in yet", page === "welcome" ? "Work on any document with Dex" : page === "awaiting" ? "Return to OfficeDex after logging in." : "Try again, or start with a local file.")}
        <div className="setup-welcome-actions">
          {page === "awaiting" ? <><p aria-live="polite">{text("Waiting for you to log in…")}</p>{button("Reopen browser", () => void act(() => api.openExternal(loginURL)))}{button("Back to welcome", () => void act(async () => { waiting.current = false; loginAttempt.current++; await api.cancelLogin(); setPage("welcome"); }))}</> : <>{button(page === "welcome" ? "Log in" : "Try again", () => void login(), true)}{button("Open a local file first →", () => void act(() => finish(true, true)))}</>}
        </div>
      </div> : page === "introduction" ? <div className="setup-split">
        <div>{heading("Welcome to OfficeDex", copy["OfficeDex会以项目为工作区，通过与Dex的人机协同，实现word , excel , ppt的创建与编辑；同时，你也可以只把OfficeDex当作Office 编辑器使用，需要起草或者修改时，再使用AI。"])}{button("Get started", () => void act(() => move("ai")), true)}</div>
        <img className="setup-illustration setup-intro-art" src={introduction} alt="" />
      </div> : page === "ai" ? <div className="setup-split setup-ai-split">
        <img className="setup-illustration setup-model-art" src={models} alt="" />
        <div aria-live="polite">{heading(credit === "unknown" ? "Couldn't load your credits" : credit === "low" ? "Not enough credits" : "Get ready to use AI", credit === "unknown" ? "Check your connection and try again, or continue setup." : credit === "low" ? "Add credits to keep working with Dex." : copy["OfficeDex 中 AI 执行任务时，会根据模型与工具使用的token量消耗额度，请提前添加额度，避免任务在执行过程中被迫中断。你的余额只会在Agent实际执行任务时消耗。"])}
          <div className="setup-actions">{button("Continue", () => void act(() => move("preferences")), true)}{button("Add credits", () => void act(() => api.openExternal("https://platform.officecli.io/app/billing")))}</div>
          {credit === "loading" && <p>{text("Loading…", "正在读取…")}</p>}{credit === "unknown" && button("Retry", () => void refreshCredit())}
        </div>
      </div> : page === "preferences" ? <div className="setup-centered">
        {heading("How would you like to start?", "We'll tailor the interface and tools to the way you work.")}
        <div className="setup-mode-cards" role="group" aria-label={text("Choose how to start")}>
          {(["agent", "local"] as const).map(mode => <button type="button" className="setup-choice" key={mode} aria-pressed={setup.startMode === mode} disabled={busy} onClick={() => void act(() => move("defaults", mode))}>
            {mode === "agent" ? <img src={dex} alt="" /> : <Icon name="FolderOpen" size={28} />}<span className="setup-selection" aria-hidden="true">{setup.startMode === mode ? "✓" : ""}</span>
            <strong>{text(mode === "agent" ? "Agent mode" : "Local mode")}</strong><span>{text(mode === "agent" ? "Create and edit documents with Dex." : "Use the editor. Add AI when you need it.")}</span>
          </button>)}
        </div>
      </div> : <div className="setup-centered">
        {heading("Open with OfficeDex", "Make OfficeDex your default document app.")}
        {results?.some(item => !item.isDefault) ? <div className="setup-association-results" role="status">
          <strong>{text("Some file types couldn't be changed")}</strong>
          <ul>{results.map(item => <li key={item.extension}>.{item.extension}: {text(item.isDefault ? "Set" : "Unchanged", item.isDefault ? "已设置" : "未更改")}</li>)}</ul>
          <p>{text("Try again, or open the app to get started.")}</p>
          <div className="setup-actions">{button("Retry", submitDefaults, true)}{button("Open app", () => void act(() => finish()))}</div>
          <details><summary>{text("Set up manually in Finder")}</summary><p>{text("Select a document in Finder, choose Get Info → Open with → OfficeDex, then Change All. Repeat for Word, Excel and PowerPoint.", "在 Finder 中选中文档，选择“显示简介 → 打开方式 → OfficeDex → 全部更改”。分别为 Word、Excel 和 PowerPoint 文档设置。")}</p></details>
        </div> : <><label className="setup-default-choice"><img src={dex} alt="" /><span><strong>{text("Always open documents with OfficeDex")}</strong><small>{text("Word, Excel, PowerPoint")}</small></span><input type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} /></label>
          {button(busy ? "Setting up…" : "Start using OfficeDex", submitDefaults, true)}</>}
      </div>}
    </main>
    {error && <p className="setup-error" role="alert">{error}</p>}
    {!["welcome", "awaiting", "login-error", "introduction"].includes(page) && <footer inert={skip}>{!defaultsOnly && button("← Back", () => void act(() => move(back)))}<button type="button" ref={skipTrigger} disabled={busy} onClick={() => defaultsOnly ? setVisible(false) : setSkip(true)}>{text(defaultsOnly ? "Close" : "Skip", defaultsOnly ? "关闭" : undefined)}</button></footer>}
    <div className="setup-language" inert={skip}><select aria-label="Language / 语言" value={locale} onChange={event => setLocale(event.target.value as "en" | "zh")}><option value="en">English</option><option value="zh">中文</option></select></div>
    {skip && <div className="setup-scrim"><div className="setup-skip-dialog" ref={skipPanel} role="dialog" aria-modal="true" aria-labelledby="setup-skip-title"><button type="button" className="setup-dialog-close" aria-label={text("Close", "关闭")} onClick={closeSkip}>×</button><h2 id="setup-skip-title">{text("Skip setup?")}</h2><p>{text("You can complete your setup anytime in Settings.")}</p><div className="setup-actions">{button("Continue setup", closeSkip)}{button("Open app", () => void act(() => finish(true)), true)}</div></div></div>}
  </div>;
}
