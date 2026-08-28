export type ActiveEditorSurface = "pptx-editor" | "docx-editor";

export type ActiveEditorClientToolHandler = (arguments_: Record<string, unknown>) => Promise<unknown>;

interface ActiveEditorRegistration {
  token: symbol;
  handlers: Record<string, ActiveEditorClientToolHandler>;
}

const activeEditors = new Map<ActiveEditorSurface, ActiveEditorRegistration>();
const waiters = new Map<ActiveEditorSurface, Set<() => void>>();

export function registerActiveEditorClientTools(
  surface: ActiveEditorSurface,
  handlers: Record<string, ActiveEditorClientToolHandler>,
): () => void {
  const registration = { token: Symbol(surface), handlers };
  activeEditors.set(surface, registration);
  waiters.get(surface)?.forEach((resolve) => resolve());
  waiters.delete(surface);
  return () => {
    if (activeEditors.get(surface)?.token === registration.token) activeEditors.delete(surface);
  };
}

export async function executeActiveEditorClientTool(
  surface: ActiveEditorSurface,
  tool: string,
  arguments_: Record<string, unknown>,
): Promise<unknown> {
  const registration = activeEditors.get(surface);
  const handler = registration?.handlers[tool];
  if (!handler) throw new Error(`The active ${surface} session does not provide ${tool}.`);
  return handler(arguments_);
}

export async function waitForActiveEditorSurface(
  surface: ActiveEditorSurface,
  timeoutMs = 30_000,
): Promise<boolean> {
  if (activeEditors.has(surface)) return true;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      const pending = waiters.get(surface);
      pending?.delete(onReady);
      if (pending?.size === 0) waiters.delete(surface);
      resolve(available);
    };
    const onReady = () => finish(true);
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    const pending = waiters.get(surface) ?? new Set<() => void>();
    pending.add(onReady);
    waiters.set(surface, pending);
    if (activeEditors.has(surface)) finish(true);
  });
}

