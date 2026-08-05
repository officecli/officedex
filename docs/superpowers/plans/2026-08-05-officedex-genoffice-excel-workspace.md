# OfficeDex GenOffice Excel Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy XLSX dialogue path with a GenOffice-style spreadsheet workspace that generates, opens, edits, saves, and AI-modifies real XLSX files inside the new OfficeDex project shell.

**Architecture:** Add a dedicated `spreadsheet` navigation state and a `SpreadsheetWorkspace` composed of a compactable project sidebar, document top bar, editable Sheet SDK canvas, and AI task panel. Selectively port the verified Wails `office2modoc` and `@shimo/sdk-sheet` session implementation from `explore/xlsx-sdk-sheet-editor`, while retaining OfficeDex's current OfficeCLI generate/modify protocol and React 19 local UI facade.

**Tech Stack:** React 19, TypeScript, Vitest, Wails v2, Go, `@shimo/sdk-sheet`, `@shimo/simple-i18n`, `office2modoc` native FFI, Vite, local WebOffice-style UI facade.

---

## Safety and source boundaries

- Work only in `/Users/luyang/.config/superpowers/worktrees/officedex/genoffice-home-weboffice-ui` on `codex/genoffice-home-weboffice-ui`.
- Read the proven editor code from `/Users/luyang/.config/superpowers/worktrees/officedex/xlsx-sdk-sheet-editor` at `954bd3d`; do not merge or cherry-pick that branch because it contains the old AntD/facade implementation.
- Port code with `apply_patch` and adapt all renderer imports to the current local UI facade.
- Keep App icon files and non-XLSX document flows unchanged.
- Use `127.0.0.1:7890` for npm and `env -u GOROOT` for Go/Wails.

## File map

New backend units:

- `internal/office2modoc/*`: authenticated and bounded XLSX/MODoc native conversion.
- `internal/xlsxeditor/atomic.go`: XLSX validation and atomic replacement.
- `internal/xlsxeditor/service.go`: token-bound editing sessions.

New renderer units:

- `src/renderer/spreadsheet/types.ts`: route and component contracts.
- `src/renderer/spreadsheet/sessionState.ts`: pure session reducer.
- `src/renderer/spreadsheet/useSpreadsheetSession.ts`: OfficeCLI task and preview-grant orchestration.
- `src/renderer/spreadsheet/sheetSdk.ts`: local Sheet SDK loader.
- `src/renderer/spreadsheet/SpreadsheetCanvas.tsx`: editor lifecycle and saving.
- `src/renderer/spreadsheet/SpreadsheetTopbar.tsx`: document actions and save state.
- `src/renderer/spreadsheet/SpreadsheetAgentPanel.tsx`: generation and modify interaction.
- `src/renderer/spreadsheet/UnsavedChangesDialog.tsx`: Save, Discard, Cancel decision.
- `src/renderer/spreadsheet/SpreadsheetWorkspace.tsx`: complete Excel workspace.
- `src/renderer/styles/spreadsheet.css`: workspace layout and states.

---

### Task 1: Bundle the Sheet SDK entirely offline

**Files:**
- Create: `.npmrc`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Create: `scripts/sdk-sheet-build-assets.test.mjs`

- [ ] **Step 1: Write the failing production-asset test**

Create the test with these exact required assets:

```js
const requiredAssets = [
  "sdk-sheet/p2.chunk.js",
  "sdk-sheet-locales/fe-common/zh-CN.js",
  "sdk-sheet-locales/lizard-service-sheet-sdk/zh-CN.js",
];

test("production build includes Sheet SDK chunks and Chinese locale resources", async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "officedex-sdk-sheet-build-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [viteBin, "build", "--outDir", outputDir, "--emptyOutDir"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  for (const relativePath of requiredAssets) {
    const assetPath = path.join(outputDir, relativePath);
    await access(assetPath);
    assert.equal((await stat(assetPath)).isFile(), true);
  }
});
```

Use the imports and `viteBin` setup from `explore/xlsx-sdk-sheet-editor:scripts/sdk-sheet-build-assets.test.mjs`.

- [ ] **Step 2: Run it and verify RED**

```bash
node --test scripts/sdk-sheet-build-assets.test.mjs
```

Expected: FAIL because the dependencies and build assets are absent.

- [ ] **Step 3: Install the verified dependency versions**

```bash
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 npm install --save-exact @shimo/editor-sdk-core@0.0.1-124-jsapi.51 @shimo/sdk-sheet@5.0.14-jsapi.4 @shimo/simple-i18n@4.0.27
```

Expected: React remains `^19.0.0`; only the three Sheet SDK packages are added. The tracked `.npmrc` routes only the `@shimo` scope to `http://registry.npm.shimo.run`; all other dependencies continue to use the default registry.

- [ ] **Step 4: Implement secure Vite asset routing**

Port `sdkSheetAssetRoutes`, `sdkSheetDevAssets`, and `sdkSheetBuildAssets` from the exploration branch, retaining the current Vite configuration. Register:

```ts
plugins: [sdkSheetDevAssets(), sdkSheetBuildAssets(), react()]
```

The dev middleware must serve only `.js` files beneath the two configured roots and reject traversal, directories, and symlinks. The build plugin must copy both roots under the paths asserted above.

- [ ] **Step 5: Register and pass the test**

Add the new test file to `test:scripts`, then run:

```bash
node --test scripts/sdk-sheet-build-assets.test.mjs
npm run lint
```

Expected: PASS and TypeScript exit 0.

- [ ] **Step 6: Commit**

```bash
git add .npmrc package.json package-lock.json vite.config.ts scripts/sdk-sheet-build-assets.test.mjs docs/superpowers/plans/2026-08-05-officedex-genoffice-excel-workspace.md
git commit -m "build: bundle local Sheet SDK assets"
```

---

### Task 2: Port authenticated office2modoc conversion

**Files:**
- Create: `internal/office2modoc/converter.go`
- Create: `internal/office2modoc/converter_test.go`
- Create: `internal/office2modoc/integration_test.go`
- Create: `internal/office2modoc/native_darwin_arm64.go`
- Create: `internal/office2modoc/native_darwin_arm64_test.go`
- Create: `internal/office2modoc/native_stub.go`
- Create: `internal/office2modoc/path.go`
- Create: `internal/office2modoc/token.go`
- Create: `internal/office2modoc/types.go`

- [ ] **Step 1: Port tests before implementation**

Using `apply_patch`, port the tests from `explore/xlsx-sdk-sheet-editor` at `954bd3d`, including:

```go
func TestGenerateOfflineTokenMatchesFFIContract(t *testing.T)
func TestConverterSerializesNativeCalls(t *testing.T)
func TestConverterRejectsOversizedInput(t *testing.T)
func TestConverterPopulatesImportParams(t *testing.T)
func TestConverterPopulatesExportParams(t *testing.T)
func TestConverterHonorsCanceledContextBeforeLoadingNative(t *testing.T)
func TestNativeCallsDynamicLibraryWithExpectedParams(t *testing.T)
func TestIntegrationXlsxRoundTrip(t *testing.T)
```

- [ ] **Step 2: Verify RED**

```bash
env -u GOROOT go test ./internal/office2modoc -count=1
```

Expected: FAIL because the converter implementation is missing.

- [ ] **Step 3: Port the final converter implementation**

Port the exact production files from the exploration branch. Preserve this behavior:

```go
type Converter interface {
    ImportXlsx(context.Context, string, string, string) error
    ExportXlsx(context.Context, string, string, string) error
    Close() error
}
```

The implementation must generate the FFI offline token, serialize native calls, enforce input limits, check context cancellation, resolve bundled/cache library paths, and return a clear unsupported-platform error outside Darwin ARM64.

- [ ] **Step 4: Verify GREEN**

```bash
env -u GOROOT go test ./internal/office2modoc -count=1
```

Expected: PASS; real-library tests may skip only through their explicit environment gate.

- [ ] **Step 5: Commit**

```bash
git add internal/office2modoc
git commit -m "feat: add authenticated XLSX MODoc conversion"
```

---

### Task 3: Port secure XLSX editing sessions and Wails APIs

**Files:**
- Create: `internal/xlsxeditor/atomic.go`
- Create: `internal/xlsxeditor/atomic_test.go`
- Create: `internal/xlsxeditor/service.go`
- Create: `internal/xlsxeditor/service_test.go`
- Create: `internal/xlsxeditor/integration_test.go`
- Create: `app_xlsx_editor_test.go`
- Modify: `app.go`

- [ ] **Step 1: Port session tests first**

Port the final tests from the exploration branch, including token mismatch, external file modification, failed export preservation, directory MODoc packages, atomic replacement, session cleanup, revoke cleanup, and shutdown cleanup.

The core test names must include:

```go
func TestPrepareReadsContentFromDirectoryModocPackage(t *testing.T)
func TestSaveUpdatesDirectoryModocContentBeforeExport(t *testing.T)
func TestSaveRejectsTokenOrSessionMismatch(t *testing.T)
func TestSaveRejectsExternalFileModification(t *testing.T)
func TestSaveKeepsOriginalWhenExportFails(t *testing.T)
func TestRevokePreviewTokenAlsoClosesXlsxSessions(t *testing.T)
func TestShutdownClosesAllXlsxSessions(t *testing.T)
```

- [ ] **Step 2: Verify RED**

```bash
env -u GOROOT go test ./internal/xlsxeditor . -run 'Test(Prepare|Save|Close|Revoke|Shutdown|Replace)' -count=1
```

Expected: FAIL because the package and App bindings are missing.

- [ ] **Step 3: Port the session service**

Port `atomic.go` and final `service.go`. Preserve:

```go
type PrepareResult struct {
    SessionID    string `json:"sessionId"`
    ModocContent string `json:"modocContent"`
}

type SaveResult struct { FilePath string `json:"filePath"` }

func (s *Service) Prepare(context.Context, string) (PrepareResult, error)
func (s *Service) Save(context.Context, string, string, string) (SaveResult, error)
func (s *Service) Close(string, string) error
func (s *Service) CloseByToken(string) error
func (s *Service) CloseAll() error
func (s *Service) CleanupStale() error
```

`resolveModocContentPath` must accept both `workbook.modoc` and `workbook.modoc/content`.

- [ ] **Step 4: Add App integration**

Add `xlsxEditorService` to `App`, initialize it with:

```go
app.xlsxEditorService = xlsxeditor.NewService(previewReg, office2modoc.New(repoRoot), os.TempDir())
```

Add these bindings:

```go
type SaveXlsxEditorInput struct {
    PreviewToken string `json:"previewToken"`
    SessionID    string `json:"sessionId"`
    ModocContent string `json:"modocContent"`
}

type CloseXlsxEditorInput struct {
    PreviewToken string `json:"previewToken"`
    SessionID    string `json:"sessionId"`
}

func (a *App) PrepareXlsxEditor(previewToken string) (xlsxeditor.PrepareResult, error)
func (a *App) SaveXlsxEditor(input SaveXlsxEditorInput) (xlsxeditor.SaveResult, error)
func (a *App) CloseXlsxEditor(input CloseXlsxEditorInput) error
```

Run stale cleanup at startup, close all sessions at shutdown, and close token-bound sessions before `RevokePreviewToken` removes the grant.

- [ ] **Step 5: Verify GREEN**

```bash
env -u GOROOT go test ./internal/office2modoc ./internal/xlsxeditor . -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app.go app_xlsx_editor_test.go internal/xlsxeditor
git commit -m "feat: expose secure XLSX editor sessions"
```

---

### Task 4: Add renderer editor contracts and local SDK loader

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/bridge.ts`
- Create: `src/renderer/spreadsheet/sheetSdk.ts`
- Create: `src/renderer/spreadsheet/sheetSdk.test.ts`

- [ ] **Step 1: Write the failing loader test**

Mock `createSheetSDK` and require this call order:

```ts
expect(order).toEqual([
  "locale:fe-common",
  "locale:lizard-service-sheet-sdk",
  "create",
  "init",
  "mount",
  "ready",
]);
```

Also require `disabledShortcuts` to contain `mod+s`, `mod+shift+s`, and `mod+shift+e`.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/renderer/spreadsheet/sheetSdk.test.ts
```

Expected: FAIL because the module is absent.

- [ ] **Step 3: Add shared API types and bridge methods**

Add:

```ts
export interface PrepareXlsxEditorResult { sessionId: string; modocContent: string; }
export interface SaveXlsxEditorInput { previewToken: string; sessionId: string; modocContent: string; }
export interface SaveXlsxEditorResult { filePath: string; }
export interface CloseXlsxEditorInput { previewToken: string; sessionId: string; }
```

Extend `DesktopAPI` with `prepareXlsxEditor`, `saveXlsxEditor`, and `closeXlsxEditor`. Implement Wails and RPC paths. Browser preview must reject Prepare/Save with a clear unsupported message and let Close resolve harmlessly.

- [ ] **Step 4: Implement the loader**

Port final `sheetSdk.ts` into the spreadsheet folder. Keep the two local locale URLs, `standard/editor` mode, collaboration UI hidden, and:

```ts
export async function createOfflineSheetEditor(
  container: HTMLElement,
  modocContent: string,
): Promise<AbstractedSheetSDK>
```

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx vitest run src/renderer/spreadsheet/sheetSdk.test.ts
npm run lint
git add src/shared/types.ts src/renderer/bridge.ts src/renderer/spreadsheet/sheetSdk.ts src/renderer/spreadsheet/sheetSdk.test.ts
git commit -m "feat: connect renderer to XLSX editor sessions"
```

---

### Task 5: Define spreadsheet navigation and session state

**Files:**
- Create: `src/renderer/spreadsheet/types.ts`
- Create: `src/renderer/spreadsheet/sessionState.ts`
- Create: `src/renderer/spreadsheet/sessionState.test.ts`
- Modify: `src/renderer/defaults.ts`

- [ ] **Step 1: Write reducer tests first**

Test new entry, generation start, matching artifact completion, loading, dirty, saving, save failure, and stale task rejection:

```ts
expect(createSpreadsheetSession({ kind: "new", workspaceId: "ws-1" })).toMatchObject({
  phase: "empty",
  workspaceId: "ws-1",
  dirty: false,
});

expect(spreadsheetSessionReducer(generating, {
  type: "artifact.ready",
  taskId: "task-xlsx",
  artifact,
  grant,
})).toMatchObject({ phase: "loading", artifact, grant });
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/renderer/spreadsheet/sessionState.test.ts
```

Expected: FAIL because the state module is absent.

- [ ] **Step 3: Implement explicit contracts**

```ts
export type SpreadsheetEntry =
  | { kind: "new"; workspaceId?: string }
  | { kind: "artifact"; artifact: Artifact; workspaceId?: string; conversationId?: string };

export type SpreadsheetPhase = "empty" | "generating" | "loading" | "ready" | "dirty" | "saving" | "error";

export interface SpreadsheetSessionState {
  phase: SpreadsheetPhase;
  workspaceId?: string;
  conversationId?: string;
  taskId?: string;
  artifact?: Artifact;
  grant?: PreviewGrant;
  dirty: boolean;
  error?: string;
}
```

Add `"spreadsheet"` to `NavKey`. Reject non-XLSX artifacts and task completions whose ID does not match the active spreadsheet run.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx vitest run src/renderer/spreadsheet/sessionState.test.ts
npm run lint
git add src/renderer/defaults.ts src/renderer/spreadsheet/types.ts src/renderer/spreadsheet/sessionState.ts src/renderer/spreadsheet/sessionState.test.ts
git commit -m "feat: define spreadsheet workspace state"
```

---

### Task 6: Build the editable SpreadsheetCanvas

**Files:**
- Create: `src/renderer/spreadsheet/SpreadsheetCanvas.tsx`
- Create: `src/renderer/spreadsheet/SpreadsheetCanvas.test.tsx`

- [ ] **Step 1: Write lifecycle tests first**

Cover prepare/mount, dirty reporting, save serialization, edit-during-save, save failure, focused `⌘S`, artifact replacement cleanup, and retry/external-open actions.

Require this imperative contract:

```ts
export interface SpreadsheetCanvasHandle {
  save(): Promise<boolean>;
  focus(): void;
}
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/renderer/spreadsheet/SpreadsheetCanvas.test.tsx
```

Expected: FAIL because the canvas is absent.

- [ ] **Step 3: Implement the editor lifecycle**

Adapt the proven `XlsxViewer.tsx` lifecycle without its preview toolbar and without AntD:

```tsx
export const SpreadsheetCanvas = forwardRef<SpreadsheetCanvasHandle, SpreadsheetCanvasProps>(
  function SpreadsheetCanvas({ grant, artifact, onDirtyChange, onStateChange }, ref) {
    return (
      <section className="spreadsheet-canvas" aria-label={artifact.fileName}>
        <div ref={containerRef} className="spreadsheet-canvas__editor" />
        {state === "loading" ? <LoadingState fileName={artifact.fileName} /> : null}
        {error ? <SpreadsheetCanvasError error={error} onRetry={reload} onOpenExternal={openExternal} /> : null}
      </section>
    );
  },
);
```

Track a change version so saving cannot clear edits made during the save. On token change/unmount, unsubscribe, unmount/destroy the SDK, and close the backend session exactly once.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx vitest run src/renderer/spreadsheet/SpreadsheetCanvas.test.tsx
npm run lint
git add src/renderer/spreadsheet/SpreadsheetCanvas.tsx src/renderer/spreadsheet/SpreadsheetCanvas.test.tsx
git commit -m "feat: add editable spreadsheet canvas"
```

---

### Task 7: Build the GenOffice-style Excel shell

**Files:**
- Create: `src/renderer/spreadsheet/SpreadsheetTopbar.tsx`
- Create: `src/renderer/spreadsheet/SpreadsheetWorkspace.tsx`
- Create: `src/renderer/spreadsheet/SpreadsheetWorkspace.test.tsx`
- Modify: `src/renderer/components/ProjectSidebar.tsx`
- Modify: `src/renderer/components/ProjectSidebar.test.tsx`
- Modify: `src/renderer/components/Shell.tsx`
- Modify: `src/renderer/components/Shell.test.tsx`
- Create: `src/renderer/styles/spreadsheet.css`
- Modify: `src/renderer/main.tsx`

- [ ] **Step 1: Write shell tests first**

Require the project sidebar, document banner, workbook region, and AI assistant. Explicitly reject legacy surfaces:

```ts
expect(screen.queryByText("What should we work on?")).toBeNull();
expect(screen.queryByRole("button", { name: /New chat/i })).toBeNull();
expect(screen.queryByTestId("new-generation-form")).toBeNull();
```

Test compact project navigation and AI-panel collapse.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/renderer/spreadsheet/SpreadsheetWorkspace.test.tsx src/renderer/components/ProjectSidebar.test.tsx src/renderer/components/Shell.test.tsx
```

Expected: FAIL because spreadsheet mode is absent.

- [ ] **Step 3: Implement shell components**

Extend `ProjectSidebarProps` with `compact` and `onCompactChange`. Compact mode keeps the OfficeDex icon and all project/utility actions as labelled icon buttons.

Implement `SpreadsheetTopbar` with:

```ts
interface SpreadsheetTopbarProps {
  fileName: string;
  workspaceName?: string;
  saveState: "unopened" | "saved" | "dirty" | "saving" | "error";
  canSave: boolean;
  agentOpen: boolean;
  onBack: () => void;
  onSave: () => void;
  onOpenExternal?: () => void;
  onToggleAgent: () => void;
}
```

Update `Shell` so Home and Spreadsheet share the project-shell family. Home retains its current breadcrumb. Spreadsheet lets `SpreadsheetWorkspace` own the document top bar.

- [ ] **Step 4: Add layout CSS**

```css
.spreadsheet-workspace {
  display: grid;
  grid-template-rows: 48px minmax(0, 1fr);
  height: 100vh;
  min-width: 0;
}

.spreadsheet-workspace__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 336px;
  min-height: 0;
}

.spreadsheet-workspace[data-agent-open="false"] .spreadsheet-workspace__body {
  grid-template-columns: minmax(0, 1fr);
}
```

Import the stylesheet from `main.tsx`.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx vitest run src/renderer/spreadsheet/SpreadsheetWorkspace.test.tsx src/renderer/components/ProjectSidebar.test.tsx src/renderer/components/Shell.test.tsx
npm run lint
git add src/renderer/spreadsheet/SpreadsheetTopbar.tsx src/renderer/spreadsheet/SpreadsheetWorkspace.tsx src/renderer/spreadsheet/SpreadsheetWorkspace.test.tsx src/renderer/components/ProjectSidebar.tsx src/renderer/components/ProjectSidebar.test.tsx src/renderer/components/Shell.tsx src/renderer/components/Shell.test.tsx src/renderer/styles/spreadsheet.css src/renderer/main.tsx
git commit -m "feat: add GenOffice-style spreadsheet shell"
```

---

### Task 8: Route every XLSX entry into SpreadsheetWorkspace

**Files:**
- Create: `src/renderer/spreadsheet/useSpreadsheetSession.ts`
- Create: `src/renderer/spreadsheet/useSpreadsheetSession.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

- [ ] **Step 1: Write App routing tests first**

Assert Home → Spreadsheet opens the workbook workspace and not Dialogue. Assert recent/local XLSX use the same workspace, while Presentation and DOCX retain their current routes.

```ts
fireEvent.click(screen.getByRole("button", { name: "Spreadsheet" }));
expect(await screen.findByRole("region", { name: /workbook/i })).toBeTruthy();
expect(screen.queryByTestId("new-generation-form")).toBeNull();
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/renderer/App.test.tsx -t 'spreadsheet|XLSX|local XLSX'
```

Expected: FAIL because XLSX still enters Dialogue or PreviewPanel.

- [ ] **Step 3: Add route state and entry handlers**

```ts
const [spreadsheetEntry, setSpreadsheetEntry] = useState<SpreadsheetEntry | null>(null);

const openSpreadsheet = useCallback((entry: SpreadsheetEntry) => {
  setSpreadsheetEntry(entry);
  setActiveNav("spreadsheet");
  clearError();
}, [clearError]);
```

Change `createFromHome` so XLSX opens `{ kind: "new", workspaceId: homeWorkspaceId }`. Change recent/local XLSX handling to issue a grant and open `{ kind: "artifact", artifact, ... }`. Leave non-XLSX behavior unchanged.

- [ ] **Step 4: Implement useSpreadsheetSession**

Expose:

```ts
interface UseSpreadsheetSessionResult {
  session: SpreadsheetSessionState;
  openArtifact(artifact: Artifact, conversationId?: string): Promise<void>;
  startGeneration(input: GenerateInput): Promise<void>;
  startModify(input: ModifyInput): Promise<void>;
  setDirty(dirty: boolean): void;
  setSaving(saving: boolean): void;
  setSaveError(error?: string): void;
  reset(): Promise<void>;
}
```

Revoke an old preview token only after its canvas session closes.

- [ ] **Step 5: Render and verify GREEN**

Render `SpreadsheetWorkspace` only for `activeNav === "spreadsheet"`; do not render Dialogue or PreviewPanel for the active spreadsheet.

```bash
npx vitest run src/renderer/App.test.tsx -t 'spreadsheet|XLSX|local XLSX'
npx vitest run src/renderer/spreadsheet/useSpreadsheetSession.test.tsx
npm run lint
git add src/renderer/App.tsx src/renderer/App.test.tsx src/renderer/spreadsheet/useSpreadsheetSession.ts src/renderer/spreadsheet/useSpreadsheetSession.test.tsx
git commit -m "feat: route XLSX files into spreadsheet workspace"
```

---

### Task 9: Generate XLSX and show progress inside the AI panel

**Files:**
- Create: `src/renderer/spreadsheet/SpreadsheetAgentPanel.tsx`
- Create: `src/renderer/spreadsheet/SpreadsheetAgentPanel.test.tsx`
- Modify: `src/renderer/spreadsheet/SpreadsheetWorkspace.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

- [ ] **Step 1: Write panel tests first**

Test empty, running, completed, failed, retry, and cancel states. Submission must produce:

```ts
expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({
  documentType: "xlsx",
  generationMode: "plan",
  prompt: "Build a quarterly sales forecast",
  workspaceId: "ws-1",
}));
```

Assert the generic document tabs, GIF option, legacy preset cards, and old Generate footer are absent.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/renderer/spreadsheet/SpreadsheetAgentPanel.test.tsx src/renderer/App.test.tsx -t 'spreadsheet generation'
```

Expected: FAIL because the panel wiring is absent.

- [ ] **Step 3: Implement XLSX-specific generation**

Use focused props for phase, tasks, workspace, error, generate, retry, and cancel. Construct:

```ts
{
  documentType: "xlsx",
  generationMode: "plan",
  topic: prompt.slice(0, 80),
  prompt,
  ...(workspaceId ? { workspaceId } : { noProject: true }),
  enableImages: true,
}
```

Reuse current task selectors/reduced stages rather than rendering `DialogueScreen`.

- [ ] **Step 4: Bind only the matching completion**

Track the spreadsheet task ID. When that task emits `task.completed` with an XLSX artifact, issue a preview grant and load it in the existing workspace. Ignore unrelated and stale completions.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx vitest run src/renderer/spreadsheet/SpreadsheetAgentPanel.test.tsx src/renderer/App.test.tsx -t 'spreadsheet generation'
npm run lint
git add src/renderer/spreadsheet/SpreadsheetAgentPanel.tsx src/renderer/spreadsheet/SpreadsheetAgentPanel.test.tsx src/renderer/spreadsheet/SpreadsheetWorkspace.tsx src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat: generate XLSX inside spreadsheet workspace"
```

---

### Task 10: Protect unsaved edits and support AI continue-modify

**Files:**
- Create: `src/renderer/spreadsheet/UnsavedChangesDialog.tsx`
- Create: `src/renderer/spreadsheet/UnsavedChangesDialog.test.tsx`
- Modify: `src/renderer/spreadsheet/SpreadsheetWorkspace.tsx`
- Modify: `src/renderer/spreadsheet/SpreadsheetWorkspace.test.tsx`
- Modify: `src/renderer/spreadsheet/SpreadsheetAgentPanel.tsx`
- Modify: `src/renderer/spreadsheet/SpreadsheetAgentPanel.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

- [ ] **Step 1: Write guard tests first**

Require Save and Continue, Discard Changes, and Cancel. Test the guard before Home navigation, file switching, and AI modify. Failed save must keep the workspace open and must not call modify.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/renderer/spreadsheet/UnsavedChangesDialog.test.tsx src/renderer/spreadsheet/SpreadsheetWorkspace.test.tsx src/renderer/App.test.tsx -t 'unsaved|continue modify'
```

Expected: FAIL because the guard is absent.

- [ ] **Step 3: Implement the three-action controlled dialog**

```ts
interface UnsavedChangesDialogProps {
  open: boolean;
  saving: boolean;
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
  onCancel: () => void;
}
```

Use local Button components and a portal. Do not use the two-button global confirmation service.

- [ ] **Step 4: Implement continue-modify**

When a workbook is ready, submit:

```ts
{
  documentType: "xlsx",
  sourceFile: artifact.filePath,
  prompt,
  ...(workspaceId ? { workspaceId } : { noProject: true }),
  conversationId,
  parentTaskId: sourceTaskId,
}
```

If dirty, queue this action behind the guard. Save continues only after success; Discard closes the old editor session; Cancel preserves the prompt and editor. On matching completion, close/revoke the old session and load the new artifact without leaving SpreadsheetWorkspace.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx vitest run src/renderer/spreadsheet/UnsavedChangesDialog.test.tsx src/renderer/spreadsheet/SpreadsheetWorkspace.test.tsx src/renderer/spreadsheet/SpreadsheetAgentPanel.test.tsx src/renderer/App.test.tsx -t 'unsaved|continue modify'
npm run lint
git add src/renderer/spreadsheet src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat: protect and AI-modify spreadsheet edits"
```

---

### Task 11: Finish localization, recovery states, and static boundaries

**Files:**
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/zh.ts`
- Modify: `src/renderer/styles/spreadsheet.css`
- Create: `src/renderer/spreadsheet/spreadsheetBoundaries.test.ts`
- Modify: spreadsheet component tests

- [ ] **Step 1: Write boundary and recovery tests first**

Assert spreadsheet source contains no AntD, remote URLs, or Dialogue imports:

```ts
expect(source).not.toMatch(/from ["']antd/);
expect(source).not.toContain("@ant-design/icons");
expect(source).not.toMatch(/https?:\/\//);
expect(source).not.toContain("DialogueScreen");
```

Add recovery tests for missing file, permissions, converter failure, SDK failure, save failure, retry, and external-open fallback.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/renderer/spreadsheet
```

Expected: FAIL for missing strings or recovery UI.

- [ ] **Step 3: Add localized strings**

Add English and Chinese keys for untitled workbook, saved/dirty/saving/failed, new and modify composer placeholders, generate/retry, missing/permission/converter/SDK errors, and all unsaved-dialog actions. Keep MODoc terminology out of primary user-facing copy.

- [ ] **Step 4: Finish responsive styling**

Cover desktop, 1024px compact, and narrow-window states. Collapse the project sidebar before shrinking the AI panel; always prioritize workbook width. Use current WebOffice/local tokens only.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx vitest run src/renderer/spreadsheet src/renderer/components/ProjectSidebar.test.tsx src/renderer/components/Shell.test.tsx
npm run lint
rg -n "from ['\"]antd['\"]|@ant-design/icons|https?://" src/renderer/spreadsheet src/renderer/styles/spreadsheet.css
git add src/renderer/i18n/en.ts src/renderer/i18n/zh.ts src/renderer/styles/spreadsheet.css src/renderer/spreadsheet
git commit -m "style: finish spreadsheet workspace states"
```

Expected: tests/lint PASS and `rg` has no matches.

---

### Task 12: Run complete regression verification

**Files:**
- Modify only when a failure is caused by this change.

- [ ] **Step 1: Run frontend checks**

```bash
npm run lint
npm run test:scripts
npx vitest run
```

Expected: all exit 0.

- [ ] **Step 2: Run both Go modes**

```bash
env -u GOROOT go test ./... -count=1
env -u GOROOT go test -tags officedex_demo ./... -count=1
```

Expected: PASS.

- [ ] **Step 3: Run real XLSX integration checks**

```bash
env -u GOROOT go test ./internal/office2modoc ./internal/xlsxeditor -run Integration -count=1 -v
```

Expected: configured real-library tests PASS; only explicitly environment-gated tests may skip.

- [ ] **Step 4: Verify static boundaries**

```bash
rg -n -i "antd|ant-design|anticon|UI_KIT|@vo-ui/backend" src vite.config.ts tsconfig.json package.json
npm ls antd @ant-design/icons --depth=0
npm ls weboffice-design lucide-react @shimo/sdk-sheet @shimo/simple-i18n --depth=0
git diff --check
```

Expected: no AntD/backend matches, removed dependency tree empty, required dependencies present, and diff check clean.

- [ ] **Step 5: Commit only necessary regression fixes**

If files changed, commit:

```bash
git commit -m "fix: stabilize spreadsheet workspace integration"
```

Do not create an empty commit.

---

### Task 13: Build and verify the local branch App

**Files:**
- Build: `build/bin/OfficeDex.app`
- Build: `build/bin/OfficeDex-0.6.8-genoffice-excel-workspace-macos-arm64.zip`

- [ ] **Step 1: Build**

```bash
env -u GOROOT HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 npm run build
```

Expected: Wails production build, packaging, runtime bundling, officecli signing, and App resealing all exit 0.

- [ ] **Step 2: Verify bundle**

```bash
codesign --verify --deep --strict --verbose=2 build/bin/OfficeDex.app
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' build/bin/OfficeDex.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' build/bin/OfficeDex.app/Contents/Info.plist
file build/bin/OfficeDex.app/Contents/MacOS/officedex
shasum -a 256 build/bin/OfficeDex.app/Contents/Resources/iconfile.icns
```

Expected: version `0.6.8`, ID `com.wails.OfficeDex`, ARM64, valid signature, icon hash `3e6e23c6e74b41f04060411e293f1fb0711a728860df5f9de2ac0f2c216b2b11`.

- [ ] **Step 3: Perform desktop acceptance**

Verify Home → Spreadsheet, generation progress, automatic open, cell edit and `⌘S`, reopen persistence, AI continue-modify, local XLSX edit/save, unsaved Save/Discard/Cancel, compact project sidebar, collapsed AI panel, and unchanged non-XLSX routes.

- [ ] **Step 4: Create and verify the branch ZIP**

```bash
ditto -c -k --sequesterRsrc --keepParent build/bin/OfficeDex.app build/bin/OfficeDex-0.6.8-genoffice-excel-workspace-macos-arm64.zip
unzip -tq build/bin/OfficeDex-0.6.8-genoffice-excel-workspace-macos-arm64.zip
shasum -a 256 build/bin/OfficeDex-0.6.8-genoffice-excel-workspace-macos-arm64.zip
```

Expected: archive integrity PASS and SHA-256 printed.

- [ ] **Step 5: Confirm isolation**

```bash
git status --short --branch
git log --oneline -20
```

Expected: branch `codex/genoffice-home-weboffice-ui`, clean tracked state, no merge and no push.
