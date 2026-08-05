# GenOffice-Style Home and WebOffice UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Ant Design completely with a single `weboffice-design`-backed UI facade and add a GenOffice-style home/project center that unifies generated artifacts and user-opened local files.

**Architecture:** Business code imports only from `src/renderer/ui`; the facade wraps `weboffice-design` where available and supplies focused local React/CSS implementations for missing components. A versioned Go/SQLite recent-file model feeds a new Home screen while existing generation, task, preview, settings, login, update, and PPTist flows remain behaviorally unchanged.

**Tech Stack:** React 19, TypeScript 5.7, Vite 6, Vitest/Testing Library, Wails v2, Go, modernc SQLite, `weboffice-design@0.3.2`, `lucide-react`.

**Design reference:** `docs/superpowers/specs/2026-08-05-genoffice-home-weboffice-ui-design.md`

---

## File map

### UI foundation

- Modify `src/renderer/ui/index.ts` — public facade exports.
- Replace `src/renderer/ui/types.ts` — focused UI contracts used by OfficeDex.
- Create `src/renderer/ui/styles/tokens.css` — Shimo color, spacing, radius, typography, elevation, and state tokens.
- Create `src/renderer/ui/styles/components.css` — local facade component styling.
- Create `src/renderer/ui/components/*` — local implementations for missing WebOffice components.
- Create `src/renderer/ui/services/dialog.tsx` — imperative confirm/info service over the declarative Dialog host.
- Create `src/renderer/ui/services/toast.ts` — project message API over WebOffice Toast.
- Create `src/renderer/ui/icons/index.tsx` — single icon boundary using WebOffice SVG assets and `lucide-react`.
- Delete `src/renderer/ui/backend.ts`, `src/renderer/ui/resolveUiKit.ts`, `src/renderer/ui/backends/antd/index.tsx`, and `src/renderer/ui/backends/weboffice/index.tsx` after all consumers use the single facade.

### Existing renderer migration

- Modify `src/renderer/App.tsx`, `src/renderer/components/**/*.tsx`, `src/renderer/screens/**/*.tsx`, and `src/renderer/preview/**/*.tsx` — replace AntD and AntD icon imports.
- Modify `src/renderer/test/setup.ts` and affected tests — mock the project Toast/Dialog services instead of AntD internals.
- Modify `src/renderer/styles/*.css` and `src/renderer/preview/PreviewApp.css` — remove `.ant-*` selectors and use facade classes/tokens.
- Modify `vite.config.ts` and `tsconfig.json` — remove UI backend aliases.
- Modify `package.json` and `package-lock.json` — remove AntD packages.

### Recent files and Workspace rename

- Modify `internal/types/types.go` and `src/shared/types.ts` — define `RecentFile` and bridge methods.
- Modify `internal/localstore/store.go` and `internal/localstore/store_test.go` — schema v6, recent-file CRUD, Workspace rename.
- Modify `internal/preview/access.go` and `internal/preview/access_test.go` — exact-file preview grants for explicit user selections/recent-file clicks.
- Modify `app.go` and the relevant Go app tests — expose `ListRecentFiles`, `RemoveRecentFile`, `RenameWorkspace`, and `OpenRecentFile`.
- Modify `src/renderer/bridge.ts` and browser/Wails/RPC test doubles — normalize and expose the new methods.

### Home experience

- Modify `src/renderer/defaults.ts` — add `home` navigation key while preserving all document types, including hidden GIF capability.
- Create `src/renderer/screens/HomeScreen.tsx` and `HomeScreen.test.tsx` — five creation entries and recent-file list.
- Create `src/renderer/components/ProjectSidebar.tsx` and `ProjectSidebar.test.tsx` — Workspace navigation and actions.
- Modify `src/renderer/components/Shell.tsx`, `Shell.test.tsx`, `src/renderer/App.tsx`, and `App.test.tsx` — default Home route and transitions to existing workspaces.
- Modify `src/renderer/i18n/en.ts` and `src/renderer/i18n/zh.ts` — Home, recent-file, rename, missing-file, and fallback strings.
- Create `src/renderer/styles/home.css` and modify `src/renderer/styles/shell.css` — approved Shimo/GenOffice layout.

---

### Task 1: Establish the single-facade token and export boundary

**Files:**
- Create: `src/renderer/ui/styles/tokens.css`
- Create: `src/renderer/ui/styles/components.css`
- Modify: `src/renderer/ui/types.ts`
- Modify: `src/renderer/ui/index.ts`
- Test: `src/renderer/ui/ui.test.tsx`

- [ ] **Step 1: Write failing facade-boundary tests**

Add tests proving the public facade exports the direct WebOffice controls and no longer relies on `@vo-ui/backend`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, Input, Loading, RadioGroup, Select, Switch } from "./index";

describe("single UI facade", () => {
  it("exports the controls used by business code", () => {
    render(
      <>
        <Button ariaLabel="Continue">Continue</Button>
        <Input aria-label="Topic" value="" onChange={() => {}} />
        <Select ariaLabel="Type" value="pptx" options={[{ value: "pptx", label: "PPT" }]} onValueChange={() => {}} />
        <Switch ariaLabel="Images" checked onCheckedChange={() => {}} />
        <RadioGroup ariaLabel="Mode" value="plan" onValueChange={() => {}}>
          <RadioGroup.Item value="plan">Plan</RadioGroup.Item>
        </RadioGroup>
        <Loading ariaLabel="Loading" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByLabelText("Topic")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test and verify the old alias boundary fails**

Run:

```bash
npx vitest run src/renderer/ui/ui.test.tsx
```

Expected: FAIL because `src/renderer/ui/index.ts` only re-exports `@vo-ui/backend` and most controls are absent.

- [ ] **Step 3: Add the Shimo token file**

Create `src/renderer/ui/styles/tokens.css` with the approved fixed contract:

```css
:root {
  --od-ink: #41464b;
  --od-ink-medium: #41464bcc;
  --od-ink-secondary: #41464b99;
  --od-ink-disabled: #41464b4d;
  --od-guidance: #5da4e3;
  --od-danger: #e86666;
  --od-surface: #ffffff;
  --od-surface-subtle: #f9f9f9;
  --od-surface-muted: #f7f7f7;
  --od-border-subtle: #41464b1a;
  --od-border-hover: #41464b33;
  --od-radius-control: 4px;
  --od-radius-popover: 6px;
  --od-radius-dialog: 8px;
  --od-control-sm: 24px;
  --od-control-sm-plus: 28px;
  --od-control-md: 32px;
  --od-control-lg: 40px;
  --od-shadow-floating: 0 20px 32px #0000000f;
  --od-font-ui: "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

- [ ] **Step 4: Replace facade contracts and exports**

Define narrow contracts in `src/renderer/ui/types.ts` and export WebOffice controls from `src/renderer/ui/index.ts`:

```ts
import type { ReactNode } from "react";

export type UiTone = "default" | "primary" | "danger" | "guidance";
export type UiSize = "small" | "smallPlus" | "medium" | "large";
export interface UiOption<T extends string = string> { value: T; label: ReactNode; disabled?: boolean }
```

```ts
import "weboffice-design/style/base";
import "weboffice-design/css";
import "./styles/tokens.css";
import "./styles/components.css";

export { Button } from "weboffice-design/button";
export { Dropdown } from "weboffice-design/dropdown";
export { Input } from "weboffice-design/input";
export { InputNumber } from "weboffice-design/input-number";
export { Loading } from "weboffice-design/loading";
export { Menu } from "weboffice-design/menu";
export { Radio } from "weboffice-design/radio";
export { RadioGroup } from "weboffice-design/radio-group";
export { Select } from "weboffice-design/select";
export { Switch } from "weboffice-design/switch";
export { Tabs } from "weboffice-design/tabs";
export { Tooltip } from "weboffice-design/tooltip";
export * from "./types";
```

- [ ] **Step 5: Run the focused test**

Run `npx vitest run src/renderer/ui/ui.test.tsx`.

Expected: PASS for the public export contract; if a WebOffice prop differs, adapt only in a focused wrapper rather than widening business imports.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/ui
git commit -m "refactor: establish single WebOffice UI facade"
```

### Task 2: Implement Toast, Dialog, Loading, menu, and overlay adapters

**Files:**
- Create: `src/renderer/ui/services/toast.ts`
- Create: `src/renderer/ui/services/dialog.tsx`
- Create: `src/renderer/ui/components/Popover.tsx`
- Modify: `src/renderer/ui/index.ts`
- Modify: `src/renderer/ui/styles/components.css`
- Test: `src/renderer/ui/feedback.test.tsx`

- [ ] **Step 1: Write failing feedback-service tests**

```tsx
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DialogHost, dialog, toast } from "./index";

describe("UI feedback services", () => {
  it("renders and resolves confirm dialogs", async () => {
    render(<DialogHost />);
    const onOk = vi.fn();
    act(() => dialog.confirm({ title: "Remove project?", content: "Files stay on disk.", okText: "Remove", onOk }));
    screen.getByRole("button", { name: "Remove" }).click();
    expect(onOk).toHaveBeenCalledOnce();
  });

  it("exposes AntD-independent toast helpers", () => {
    expect(typeof toast.success).toBe("function");
    expect(typeof toast.error).toBe("function");
  });
});
```

- [ ] **Step 2: Verify failure**

Run `npx vitest run src/renderer/ui/feedback.test.tsx`.

Expected: FAIL because `DialogHost`, `dialog`, and `toast` do not exist.

- [ ] **Step 3: Implement the Toast adapter**

Expose the current call shape without importing AntD:

```ts
import { showToast } from "weboffice-design/toast";

function show(status: "success" | "warning" | "fail" | "info", content: string) {
  return showToast({ status, title: content });
}

export const toast = {
  success: (content: string) => show("success", content),
  warning: (content: string) => show("warning", content),
  error: (content: string) => show("fail", content),
  info: (content: string) => show("info", content),
  loading: (content: string) => showToast({ status: "loading", title: content, duration: null }),
};
```

- [ ] **Step 4: Implement Dialog service and host**

Use a module-level subscriber and a single React host. The public request type must be explicit:

```tsx
export interface DialogRequest {
  title: ReactNode;
  content?: ReactNode;
  okText?: string;
  cancelText?: string;
  tone?: "default" | "danger";
  onOk?: () => void | Promise<void>;
  onCancel?: () => void;
}

export const dialog = {
  confirm(request: DialogRequest) { publish({ ...request, kind: "confirm" }); },
  info(request: DialogRequest) { publish({ ...request, kind: "info" }); },
};
```

Render `weboffice-design/dialog` inside `DialogHost`, keep one request active, and close on Escape, cancel, successful OK, or mask click only when the request permits it.

- [ ] **Step 5: Implement the local Popover contract**

Use `createPortal` with `getBoundingClientRect`, `ResizeObserver`, scroll listeners, and viewport flipping. Export this focused contract:

```ts
export interface PopoverProps {
  content: ReactNode;
  children: ReactElement;
  open?: boolean;
  placement?: "top" | "right" | "bottom" | "left";
  onOpenChange?: (open: boolean) => void;
}
```

- [ ] **Step 6: Run feedback tests**

Run `npx vitest run src/renderer/ui/feedback.test.tsx`.

Expected: PASS, with no React render-phase state-update warning.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/ui
git commit -m "feat: add WebOffice feedback and overlay adapters"
```

### Task 3: Implement missing form and input primitives

**Files:**
- Create: `src/renderer/ui/components/Form.tsx`
- Create: `src/renderer/ui/components/TextArea.tsx`
- Create: `src/renderer/ui/components/PasswordInput.tsx`
- Modify: `src/renderer/ui/index.ts`
- Modify: `src/renderer/components/ImeInput.tsx`
- Test: `src/renderer/ui/form.test.tsx`
- Test: `src/renderer/components/ImeInput.test.tsx`

- [ ] **Step 1: Write failing form tests**

Cover required validation, initial values, async submission, password visibility, and IME-safe Enter:

```tsx
it("does not submit a composing textarea on Enter", () => {
  const onSubmit = vi.fn();
  render(<TextArea aria-label="Prompt" onSubmit={onSubmit} />);
  const input = screen.getByLabelText("Prompt");
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.compositionEnd(input);
  expect(onSubmit).not.toHaveBeenCalled();
});
```

```tsx
it("focuses the first invalid field", async () => {
  render(
    <Form onFinish={() => {}}>
      <FormField name="endpoint" rules={[{ required: true, message: "Required" }]}>
        <Input aria-label="Endpoint" />
      </FormField>
      <button type="submit">Save</button>
    </Form>,
  );
  screen.getByRole("button", { name: "Save" }).click();
  expect(await screen.findByText("Required")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText("Endpoint"));
});
```

- [ ] **Step 2: Verify failure**

Run `npx vitest run src/renderer/ui/form.test.tsx src/renderer/components/ImeInput.test.tsx`.

Expected: FAIL because the local form/input primitives do not exist.

- [ ] **Step 3: Implement the narrow Form model**

Implement only the repository contract:

```ts
export interface FormRule { required?: boolean; message: string; validator?: (value: unknown) => void | Promise<void> }
export interface FormProps<T extends Record<string, unknown>> {
  initialValues?: Partial<T>;
  onFinish: (values: T) => void | Promise<void>;
  children: ReactNode;
}
export interface FormFieldProps {
  name: string;
  label?: ReactNode;
  rules?: FormRule[];
  children: ReactElement;
}
```

Use React context for values/errors, clone the field child with `value`, `onChange`, `aria-invalid`, and `aria-describedby`, and focus the first invalid input on submit.

- [ ] **Step 4: Implement TextArea and PasswordInput**

`TextArea` wraps native `<textarea>` with the Shimo 32px/40px rhythm and composition tracking. `PasswordInput` wraps facade Input, adds a labeled visibility button, and preserves `autoComplete`, `disabled`, and controlled value behavior.

- [ ] **Step 5: Adapt ImeInput**

Replace AntD input prop imports with local facade prop types and preserve the existing composition guard. Do not change consumer callbacks.

- [ ] **Step 6: Run focused tests**

Run `npx vitest run src/renderer/ui/form.test.tsx src/renderer/components/ImeInput.test.tsx`.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/ui src/renderer/components/ImeInput.tsx src/renderer/components/ImeInput.test.tsx
git commit -m "feat: add local form and IME-safe input primitives"
```

### Task 4: Implement missing data-display and layout components

**Files:**
- Create: `src/renderer/ui/components/Alert.tsx`
- Create: `src/renderer/ui/components/Empty.tsx`
- Create: `src/renderer/ui/components/Image.tsx`
- Create: `src/renderer/ui/components/Progress.tsx`
- Create: `src/renderer/ui/components/Result.tsx`
- Create: `src/renderer/ui/components/Space.tsx`
- Create: `src/renderer/ui/components/Table.tsx`
- Create: `src/renderer/ui/components/Tag.tsx`
- Create: `src/renderer/ui/components/Timeline.tsx`
- Create: `src/renderer/ui/components/Typography.tsx`
- Modify: `src/renderer/ui/index.ts`
- Test: `src/renderer/ui/data-display.test.tsx`

- [ ] **Step 1: Write failing component-contract tests**

Include concrete assertions for each current usage:

```tsx
it("renders table cells and the empty state", () => {
  const columns = [{ key: "name", title: "Name", render: (row: { name: string }) => row.name }];
  const { rerender } = render(<Table rowKey="name" columns={columns} dataSource={[{ name: "Deck" }]} />);
  expect(screen.getByText("Deck")).toBeTruthy();
  rerender(<Table rowKey="name" columns={columns} dataSource={[]} emptyText="No files" />);
  expect(screen.getByText("No files")).toBeTruthy();
});

it("clamps progress and exposes its value", () => {
  render(<Progress percent={140} />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
});
```

Also test removable Tag, error Image fallback, Timeline status labels, Result actions, Space wrapping, Typography ellipsis, and closable Alert.

- [ ] **Step 2: Verify failure**

Run `npx vitest run src/renderer/ui/data-display.test.tsx`.

Expected: FAIL because the local components are absent.

- [ ] **Step 3: Implement semantic, narrow contracts**

Use these public shapes rather than AntD types:

```ts
export interface TableColumn<Row> { key: string; title: ReactNode; render: (row: Row) => ReactNode; width?: number | string }
export interface TableProps<Row> { rowKey: keyof Row | ((row: Row) => string); columns: TableColumn<Row>[]; dataSource: Row[]; emptyText?: ReactNode }
export interface ProgressProps { percent: number; status?: "normal" | "success" | "error"; showInfo?: boolean }
export interface TagProps { tone?: "neutral" | "brand" | "success" | "warning" | "danger"; closable?: boolean; onClose?: () => void; children: ReactNode }
```

Render native table/figure/progress semantics and Shimo tokens. Do not add sorting, pagination, virtual scrolling, nested rows, or APIs not used by OfficeDex.

- [ ] **Step 4: Run focused tests**

Run `npx vitest run src/renderer/ui/data-display.test.tsx`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ui
git commit -m "feat: add missing WebOffice data-display components"
```

### Task 5: Establish the unified icon boundary

**Files:**
- Create: `src/renderer/ui/icons/index.tsx`
- Create: `src/renderer/ui/icons/icons.test.tsx`
- Modify: `src/renderer/components/Shell.tsx`
- Modify: `src/renderer/components/HistoryList.tsx`
- Modify: `src/renderer/screens/vibeNodeAnimation.tsx`

- [ ] **Step 1: Write failing icon-boundary tests**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AddIcon, FileIcon, SettingsIcon } from "./index";

it("exports accessible project icons", () => {
  render(<><AddIcon aria-label="Add" /><FileIcon aria-label="File" /><SettingsIcon aria-label="Settings" /></>);
  expect(screen.getByLabelText("Add")).toBeTruthy();
});
```

- [ ] **Step 2: Verify failure**

Run `npx vitest run src/renderer/ui/icons/icons.test.tsx`.

Expected: FAIL because the icon boundary does not exist.

- [ ] **Step 3: Implement named project icons**

Export semantic names from `lucide-react` and WebOffice SVG wrappers:

```ts
export {
  CirclePlus as AddIcon,
  Bell as NotificationIcon,
  ChevronDown as DownIcon,
  Copy as CopyIcon,
  File as FileIcon,
  FolderOpen as FolderOpenIcon,
  History as HistoryIcon,
  Settings as SettingsIcon,
  User as UserIcon,
  X as CloseIcon,
} from "lucide-react";
```

Where WebOffice ships the matching product icon, wrap its SVG in a typed React component and export it under the same semantic naming convention.

- [ ] **Step 4: Migrate the first shared components**

Replace `@ant-design/icons` imports in `Shell.tsx`, `HistoryList.tsx`, and `vibeNodeAnimation.tsx` with the project icon boundary. Keep visible icon meaning and `aria-label` behavior unchanged.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run src/renderer/ui/icons/icons.test.tsx src/renderer/components/Shell.test.tsx src/renderer/components/HistoryList.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/ui/icons src/renderer/components/Shell.tsx src/renderer/components/HistoryList.tsx src/renderer/screens/vibeNodeAnimation.tsx
git commit -m "refactor: route renderer icons through UI facade"
```

### Task 6: Migrate existing renderer screens and components off AntD

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/*.tsx`
- Modify: `src/renderer/screens/*.tsx`
- Modify: `src/renderer/preview/**/*.tsx`
- Modify: `src/renderer/test/setup.ts`
- Modify: affected `*.test.tsx`
- Modify: `src/renderer/styles/*.css`
- Modify: `src/renderer/preview/PreviewApp.css`

- [ ] **Step 1: Capture the migration inventory**

Run and save the output in the implementation notes:

```bash
rg -n "from ['\"]antd['\"]|from ['\"]antd/|@ant-design/icons|\.ant-[a-zA-Z0-9_-]+" src/renderer
```

Expected before migration: matches in App, preview, settings, dialogue, data screens, update UI, shared components, tests, and styles.

- [ ] **Step 2: Convert tests from AntD internals to facade services first**

Replace imports such as:

```ts
import { message as antdMessage } from "antd";
```

with:

```ts
import { toast } from "../ui";
vi.spyOn(toast, "error").mockImplementation(() => undefined);
```

Replace `antd/es/message` act wrappers with Testing Library `act`. Replace `Modal` mocks with `dialog` spies.

- [ ] **Step 3: Run the affected test group and verify expected failures**

Run:

```bash
npx vitest run src/renderer/App.test.tsx src/renderer/screens/SettingsScreens.test.tsx src/renderer/screens/DialogueScreens.test.tsx src/renderer/screens/DataScreens.test.tsx src/renderer/components/ReportIssueDialog.test.tsx
```

Expected: FAIL until production imports use the facade.

- [ ] **Step 4: Migrate production imports file by file**

Apply these exact rules:

```ts
// before
import { Button, Form, Modal, Progress, Select, Space, Spin, Switch, Tag, message } from "antd";
// after
import { Button, Form, Dialog, Progress, Select, Space, Loading, Switch, Tag, toast } from "../ui";
```

- Replace `message.*` calls with `toast.*`.
- Replace `Modal.confirm/info` with `dialog.confirm/info`.
- Replace `Spin` with `Loading`.
- Remove `ConfigProvider` wrappers in `App.tsx` and `PreviewApp.tsx`; mount one `DialogHost` at each independent React root that uses the imperative dialog service.
- Replace `ColumnsType` with `TableColumn<Row>[]`.
- Replace `MenuProps["items"]` with the facade menu item type.
- Preserve event handlers, async flows, labels, and test IDs.

- [ ] **Step 5: Replace AntD-specific CSS selectors**

For every `.ant-*` selector, move the required styling to a facade class or the owning component. Example:

```css
/* before */
.settings-panel .ant-progress-bg { transition: width 180ms ease; }
/* after */
.settings-panel .ui-progress__bar { transition: width 180ms ease; }
```

Do not keep compatibility selectors for removed AntD markup.

- [ ] **Step 6: Run the migrated renderer tests**

Run `npx vitest run src/renderer`.

Expected: PASS with no AntD module mocks and no render-phase state-update warnings introduced by the migration.

- [ ] **Step 7: Commit**

```bash
git add src/renderer
git commit -m "refactor: migrate OfficeDex renderer off Ant Design"
```

### Task 7: Add recent-file persistence and Workspace rename

**Files:**
- Modify: `internal/types/types.go`
- Modify: `internal/localstore/store.go`
- Modify: `internal/localstore/store_test.go`

- [ ] **Step 1: Write failing Go tests for schema v6 and CRUD**

Add tests with explicit expectations:

```go
func TestRecentFilesUpsertSortFilterAndRemove(t *testing.T) {
    store := newTempStore(t)
    ctx := context.Background()
    older := types.RecentFile{FilePath: "/tmp/a.pptx", FileName: "a.pptx", DocumentType: "pptx", Source: "generated", WorkspaceID: "ws-a", LastOpenedAt: "2026-08-05T01:00:00Z"}
    newer := types.RecentFile{FilePath: "/tmp/b.docx", FileName: "b.docx", DocumentType: "docx", Source: "local", WorkspaceID: "ws-b", LastOpenedAt: "2026-08-05T02:00:00Z"}
    if err := store.UpsertRecentFile(ctx, older); err != nil { t.Fatal(err) }
    if err := store.UpsertRecentFile(ctx, newer); err != nil { t.Fatal(err) }
    got, err := store.QueryRecentFiles(ctx, "", 20)
    if err != nil { t.Fatal(err) }
    if len(got) != 2 || got[0].FilePath != newer.FilePath || got[1].FilePath != older.FilePath { t.Fatalf("unexpected order: %#v", got) }
    filtered, err := store.QueryRecentFiles(ctx, "ws-a", 20)
    if err != nil { t.Fatal(err) }
    if len(filtered) != 1 || filtered[0].FilePath != older.FilePath { t.Fatalf("unexpected filter: %#v", filtered) }
    if err := store.RemoveRecentFile(ctx, older.FilePath); err != nil { t.Fatal(err) }
}
```

Add `TestRenameWorkspacePreservesPathAndConversations` and a migration test that opens a v5 fixture, asserts `PRAGMA user_version = 6`, and verifies existing tasks remain.

- [ ] **Step 2: Verify failure**

Run:

```bash
env -u GOROOT go test ./internal/localstore -run 'TestRecentFiles|TestRenameWorkspace|TestMigrateV5' -count=1
```

Expected: compile failure because `types.RecentFile` and store methods do not exist.

- [ ] **Step 3: Define the Go model**

Add to `internal/types/types.go`:

```go
type RecentFile struct {
    FilePath       string `json:"filePath"`
    FileName       string `json:"fileName"`
    DocumentType   string `json:"documentType"`
    Source         string `json:"source"`
    WorkspaceID    string `json:"workspaceId,omitempty"`
    TaskID         string `json:"taskId,omitempty"`
    ConversationID string `json:"conversationId,omitempty"`
    LastOpenedAt   string `json:"lastOpenedAt"`
}
```

- [ ] **Step 4: Add schema v6**

Add `schemaV6` and a migration transaction matching v1-v5:

```sql
CREATE TABLE IF NOT EXISTS recent_files (
  file_path TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  source TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  task_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  last_opened_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recent_files_opened ON recent_files(last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_recent_files_workspace_opened ON recent_files(workspace_id, last_opened_at DESC);
```

Stamp `schema_migrations(version=6)` and set `PRAGMA user_version = 6` inside the same transaction.

- [ ] **Step 5: Implement store methods**

Implement:

```go
func (s *Store) UpsertRecentFile(ctx context.Context, file types.RecentFile) error
func (s *Store) QueryRecentFiles(ctx context.Context, workspaceID string, limit int) ([]types.RecentFile, error)
func (s *Store) RemoveRecentFile(ctx context.Context, filePath string) error
func (s *Store) RenameWorkspace(ctx context.Context, workspaceID, name string) (Workspace, error)
```

Normalize absolute file paths, reject empty names/source values outside `generated|local`, clamp non-positive limits to 50, and never touch disk contents in remove/rename methods.

- [ ] **Step 6: Run focused Go tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/types/types.go internal/localstore/store.go internal/localstore/store_test.go
git commit -m "feat: persist recent files and workspace names"
```

### Task 8: Add exact-file preview authorization

**Files:**
- Modify: `internal/preview/access.go`
- Modify: `internal/preview/access_test.go`

- [ ] **Step 1: Write failing security tests**

```go
func TestAllowSelectedArtifactTrustsOnlyExactFile(t *testing.T) {
    dir := t.TempDir()
    selected := writeFile(t, dir, "selected.pdf")
    sibling := writeFile(t, dir, "sibling.pdf")
    trustedRoot := canonRoot(t, t.TempDir())
    reg, err := New(RegistryOptions{TrustedRoots: []string{trustedRoot}})
    if err != nil { t.Fatal(err) }
    if err := reg.AllowSelectedArtifact(types.Artifact{FilePath: selected}); err != nil { t.Fatal(err) }
    _, err = reg.IssueToken(types.Artifact{FilePath: selected})
    if err != nil { t.Fatal(err) }
    err = reg.AllowArtifact(types.Artifact{FilePath: sibling})
    if err == nil { t.Fatal("expected sibling to remain untrusted") }
}
```

Also assert relative paths, NUL paths, missing files, unsupported extensions, and symlink aliases are rejected or canonicalized without trusting the parent directory.

- [ ] **Step 2: Verify failure**

Run:

```bash
env -u GOROOT go test ./internal/preview -run 'TestAllowSelectedArtifact' -count=1
```

Expected: compile failure because `AllowSelectedArtifact` does not exist.

- [ ] **Step 3: Implement exact-file allowlisting**

Add `allowedFiles map[string]struct{}` to `Registry`. `AllowSelectedArtifact` must canonicalize the path, require an existing regular file with a supported extension, and insert only that canonical path. Update `entryFromArtifact` to accept a path when either `withinTrustedRoots(path)` or `isAllowedFile(path)` is true.

```go
func (r *Registry) AllowSelectedArtifact(artifact types.Artifact) error {
    canonical, err := canonicalPath(artifact.FilePath)
    if err != nil { return err }
    info, err := os.Stat(canonical)
    if err != nil || !info.Mode().IsRegular() { return errors.New("preview: selected file is unavailable") }
    if _, ok := supportedPreviewExtensions[previewExtension(canonical)]; !ok { return errors.New("preview: unsupported preview file type") }
    r.mu.Lock()
    r.allowedFiles[canonical] = struct{}{}
    r.mu.Unlock()
    return nil
}
```

- [ ] **Step 4: Run security tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/preview/access.go internal/preview/access_test.go
git commit -m "feat: authorize explicitly selected preview files"
```

### Task 9: Expose recent-file and rename APIs through App and bridge

**Files:**
- Modify: `app.go`
- Modify: Go app tests covering Workspace/preview APIs
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/bridge.ts`
- Modify: `src/renderer/App.test.tsx` bridge factory
- Regenerate/Modify: `src/renderer/generated/wailsjs/go/main/App.d.ts`, `App.js`, and models if Wails generation is available

- [ ] **Step 1: Write failing App/bridge tests**

Add renderer normalization coverage:

```ts
it("normalizes recent files from the desktop bridge", async () => {
  const files = await api.listRecentFiles();
  expect(files[0]).toEqual(expect.objectContaining({
    filePath: "/tmp/deck.pptx",
    source: "generated",
  }));
});
```

Add Go tests asserting `RenameWorkspace` trims names, `ListRecentFiles` filters by Workspace, `RemoveRecentFile` deletes only the record, and `OpenRecentFile` returns a previewable Artifact for supported files.

- [ ] **Step 2: Verify failure**

Run:

```bash
npx vitest run src/renderer/App.test.tsx
env -u GOROOT go test . -run 'Test.*RecentFile|Test.*RenameWorkspace' -count=1
```

Expected: FAIL/compile failure because the APIs are absent.

- [ ] **Step 3: Add shared TypeScript contracts**

Add `RecentFile` to `src/shared/types.ts` with the same JSON names as Go, then extend `OfficeCLIAPI`:

```ts
listRecentFiles(workspaceId?: string): Promise<RecentFile[]>;
removeRecentFile(filePath: string): Promise<void>;
renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceSummary>;
openRecentFile(file: RecentFile): Promise<Artifact>;
```

- [ ] **Step 4: Add App methods**

Implement methods that delegate to localstore. `OpenRecentFile` must:

1. clean and stat the file;
2. infer the document type from the stored type/extension;
3. call `previewReg.AllowSelectedArtifact` for supported preview formats;
4. upsert `lastOpenedAt`;
5. return `types.Artifact` without opening a parent directory trust boundary.

When `RecordArtifact` succeeds, also upsert a generated recent file, looking up task context for Workspace/conversation IDs.

- [ ] **Step 5: Wire browser, Wails, and RPC bridge implementations**

Add normalizers and methods to all three bridge factories. Browser fallback keeps an in-memory `RecentFile[]`. Wails uses optional function lookup with actionable “requires a newer OfficeDex runtime” errors. RPC uses `ListRecentFiles`, `RemoveRecentFile`, `RenameWorkspace`, and `OpenRecentFile` method names.

- [ ] **Step 6: Regenerate bindings**

Run the installed Wails v2.12 binding generator:

```bash
wails generate module
```

Expected: generated Wails JS/TypeScript bindings include the four new App methods and the `RecentFile` model. Review generated diffs; do not hand-edit generated shapes.

- [ ] **Step 7: Run focused tests**

Run the Step 2 commands.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app.go internal/types src/shared/types.ts src/renderer/bridge.ts src/renderer/App.test.tsx src/renderer/generated/wailsjs
git commit -m "feat: expose recent file and workspace rename APIs"
```

### Task 10: Build HomeScreen and ProjectSidebar with TDD

**Files:**
- Create: `src/renderer/screens/HomeScreen.tsx`
- Create: `src/renderer/screens/HomeScreen.test.tsx`
- Create: `src/renderer/components/ProjectSidebar.tsx`
- Create: `src/renderer/components/ProjectSidebar.test.tsx`
- Create: `src/renderer/styles/home.css`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/zh.ts`

- [ ] **Step 1: Write failing HomeScreen tests**

```tsx
it("shows five creation types and hides GIF", () => {
  renderHome();
  expect(screen.getByRole("button", { name: /presentation/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /word/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /spreadsheet/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /report/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /image/i })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /gif/i })).toBeNull();
});

it("filters recent files by source and opens the selected file", () => {
  const onOpenFile = vi.fn();
  renderHome({ files: recentFilesFixture, onOpenFile });
  screen.getByRole("tab", { name: "Local files" }).click();
  expect(screen.getByText("Q3 forecast.xlsx")).toBeTruthy();
  screen.getByRole("button", { name: /Q3 forecast.xlsx/ }).click();
  expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ source: "local" }));
});
```

- [ ] **Step 2: Write failing ProjectSidebar tests**

Cover all-files selection, Workspace selection, create, rename, reveal, remove confirmation, and the unchanged app icon source:

```tsx
expect(screen.getByRole("img", { name: "OfficeDex" })).toHaveAttribute("src", expect.stringContaining("officedex-logo.png"));
```

- [ ] **Step 3: Verify failure**

Run:

```bash
npx vitest run src/renderer/screens/HomeScreen.test.tsx src/renderer/components/ProjectSidebar.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 4: Implement HomeScreen**

Use this focused prop boundary:

```ts
interface HomeScreenProps {
  files: RecentFile[];
  loading: boolean;
  error?: string;
  activeWorkspaceId?: string;
  onCreate: (documentType: Exclude<DocumentType, "gif">) => void;
  onOpenFile: (file: RecentFile) => void;
  onRemoveFile: (filePath: string) => void;
  onOpenLocalFile: () => void;
}
```

Render exactly five creation actions. Keep generated/local filters local to the component. Sort input defensively by `lastOpenedAt`, but treat backend order as authoritative when timestamps are equal.

- [ ] **Step 5: Implement ProjectSidebar**

Use existing Workspace objects. Render the existing `/officedex-logo.png`. Use facade Dialog for remove and an inline rename input for rename. Keep “All files”, Task History, Settings, and Account accessible by keyboard.

- [ ] **Step 6: Add approved Shimo styling**

Implement 232px sidebar, 52px topbar, five compact creation cards, and a recent-file table using `--od-*` tokens. At narrow widths, wrap creation entries to three/two columns and prioritize the filename column.

- [ ] **Step 7: Add bilingual strings**

Add exact keys for Home title/greeting, creation types, recent filters, open local file, rename, missing file, permission error, system-open fallback, and removal confirmation in both locale files.

- [ ] **Step 8: Run focused tests**

Run the Step 3 command.

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/screens/HomeScreen.tsx src/renderer/screens/HomeScreen.test.tsx src/renderer/components/ProjectSidebar.tsx src/renderer/components/ProjectSidebar.test.tsx src/renderer/styles/home.css src/renderer/i18n
git commit -m "feat: add GenOffice-style OfficeDex home"
```

### Task 11: Integrate Home into App and existing workspace transitions

**Files:**
- Modify: `src/renderer/defaults.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`
- Modify: `src/renderer/components/Shell.tsx`
- Modify: `src/renderer/components/Shell.test.tsx`
- Modify: `src/renderer/styles/shell.css`

- [ ] **Step 1: Write failing integration tests**

Add tests asserting:

```tsx
it("opens Home by default and enters dialogue with the chosen type", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: /today/i })).toBeTruthy();
  screen.getByRole("button", { name: /presentation/i }).click();
  expect(await screen.findByTestId("new-generation-form")).toHaveAttribute("data-document-type", "pptx");
});
```

Also cover Workspace filtering, generated artifact restore, local-file internal preview, unsupported system-open fallback, missing-file Toast/removal, and independent Home loading failures.

- [ ] **Step 2: Verify failure**

Run `npx vitest run src/renderer/App.test.tsx src/renderer/components/Shell.test.tsx`.

Expected: FAIL because `home` is not a navigation state and Home is not rendered.

- [ ] **Step 3: Add Home navigation state**

Change:

```ts
export type NavKey = "home" | "dialogue" | "tasks" | "settings" | "login";
```

Initialize `activeNav` to `"home"`. Keep GIF in `DOCUMENT_TYPES`; only Home excludes it.

- [ ] **Step 4: Add Home data state and actions**

In `App.tsx`, load Workspaces and recent files independently. Add callbacks:

```ts
const createFromHome = useCallback((documentType: Exclude<DocumentType, "gif">) => {
  resetNewGenerationDraft();
  updateNewGenerationDraft({ documentType });
  setActiveNav("dialogue");
  setNewChatNudgeKey((key) => key + 1);
}, [resetNewGenerationDraft, updateNewGenerationDraft]);
```

Implement `openRecentFile` so generated files restore the conversation when IDs exist, while local files call the bridge, synthesize the Artifact returned by the backend, and open the existing PreviewPanel. On missing files, show Toast with a remove action.

Implement `openLocalFileFromHome` by calling `officecli.openFileDialog` with DOCX/XLSX/PPTX/PDF/HTML filters, constructing a `RecentFile` with `source: "local"`, then passing it through the same `officecli.openRecentFile` and preview path. This keeps file authorization and recent-file persistence in one backend flow.

- [ ] **Step 5: Refactor Shell composition**

Use `ProjectSidebar` for the Home route and preserve the existing collapsible history sidebar for Dialogue/PPT canvas states where its behavior is still required. Do not force the Home sidebar to auto-collapse.

- [ ] **Step 6: Run integration tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/defaults.ts src/renderer/App.tsx src/renderer/App.test.tsx src/renderer/components/Shell.tsx src/renderer/components/Shell.test.tsx src/renderer/styles/shell.css
git commit -m "feat: make project home the default OfficeDex entry"
```

### Task 12: Remove aliases, AntD dependencies, and compatibility residue

**Files:**
- Delete: `src/renderer/ui/backend.ts`
- Delete: `src/renderer/ui/resolveUiKit.ts`
- Delete: `src/renderer/ui/backends/antd/index.tsx`
- Delete: `src/renderer/ui/backends/weboffice/index.tsx`
- Modify: `vite.config.ts`
- Modify: `tsconfig.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: remaining renderer files reported by boundary scans

- [ ] **Step 1: Run boundary scans and expect remaining failures**

```bash
rg -n "from ['\"]antd['\"]|from ['\"]antd/|import\(['\"]antd|@ant-design/icons|\.ant-[a-zA-Z0-9_-]+|UI_KIT|@vo-ui/backend" src vite.config.ts tsconfig.json package.json
```

Expected: only backend/alias/dependency residue remains. Any business-code match must be migrated before continuing.

- [ ] **Step 2: Remove Vite and TypeScript aliases**

Delete `resolveUiKitBackendAlias`, `rendererRoot`, and the alias array from `vite.config.ts`. Remove `baseUrl`/`paths` entries that exist only for `@vo-ui/backend` from `tsconfig.json` unless another project alias requires them.

- [ ] **Step 3: Delete obsolete backend files**

Delete the four files listed above. Update `ui.test.tsx` so it tests the single public facade, not backend selection.

- [ ] **Step 4: Remove packages through npm using the required proxy**

Run:

```bash
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 npm uninstall antd @ant-design/icons
```

Expected: `package.json` and `package-lock.json` remove both direct dependencies without unrelated package churn.

- [ ] **Step 5: Verify boundary scans are empty**

Run the Step 1 command.

Expected: no output.

- [ ] **Step 6: Verify the dependency tree**

Run:

```bash
npm ls antd @ant-design/icons --depth=0
npm ls weboffice-design lucide-react --depth=0
```

Expected: the first command reports no installed top-level AntD packages; the second reports the expected WebOffice and Lucide versions.

- [ ] **Step 7: Run renderer verification**

Run:

```bash
npm run lint
npm test
npx vite build
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src/renderer/ui src vite.config.ts tsconfig.json package.json package-lock.json
git commit -m "chore: remove Ant Design from OfficeDex"
```

### Task 13: Full regression and desktop acceptance

**Files:**
- Modify only files required by failures found in this task.
- Test: complete repository suites and desktop runtime.

- [ ] **Step 1: Run all automated checks**

Run:

```bash
npm run lint
npm run test:scripts
npm test
env -u GOROOT go test ./... -count=1
env -u GOROOT go test -tags officedex_demo ./... -count=1
npx vite build
git diff --check
```

Expected: every command PASS. Record any pre-existing baseline failure separately; do not attribute it to the migration without reproducing it on the base commit.

- [ ] **Step 2: Run targeted security and migration checks again**

```bash
env -u GOROOT go test ./internal/localstore ./internal/preview -count=1
```

Expected: PASS, including schema v6 and exact-file tests.

- [ ] **Step 3: Build the desktop app using the configured proxy for npm prefetches**

```bash
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 npm run build
```

Expected: Wails build and bundled runtime steps complete successfully.

- [ ] **Step 4: Verify the real desktop workflow**

Launch the built app and verify, in order:

1. Existing OfficeDex icon appears unchanged in the window/app bundle.
2. App opens to Home.
3. Project selection filters recent files.
4. Rename persists after restart.
5. Each of PPTX, DOCX, XLSX, report, and image enters the correct existing creation flow.
6. GIF is absent from Home but an existing GIF conversation/history remains usable.
7. Generated artifacts restore their conversation and preview.
8. Explicitly selected local DOCX/XLSX/PPTX/PDF/HTML files preview internally.
9. An unsupported file uses the system app.
10. A moved file shows an actionable Toast and can be removed from recents.
11. Settings, login, updates, tasks, diagnostics, PPTist, and force-update UI remain usable.

- [ ] **Step 5: Re-run static removal proof**

```bash
rg -n "from ['\"]antd['\"]|from ['\"]antd/|import\(['\"]antd|@ant-design/icons|\.ant-[a-zA-Z0-9_-]+|UI_KIT|@vo-ui/backend" src vite.config.ts tsconfig.json package.json
```

Expected: no output.

- [ ] **Step 6: Commit any verification-only fixes**

If Step 1-5 required fixes, commit them as one focused verification commit:

```bash
git add -u
git commit -m "fix: close OfficeDex UI migration regressions"
```

If no files changed, do not create an empty commit.

---

## Final completion evidence

Before claiming completion, capture:

- the final `git status --short --branch`;
- commit list for all plan tasks;
- zero-result AntD/UI alias boundary scan;
- `npm ls` proof that AntD packages are absent;
- passing TypeScript, Vitest, Go, Vite, and Wails build output;
- the real desktop acceptance checklist;
- confirmation that `officedex/public/officedex-logo.png` and packaged app icons are unchanged.
