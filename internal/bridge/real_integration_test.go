// Real-officecli integration E2E tests.
//
// These tests intentionally use the real bundled officecli runtime and generate
// real artifacts. They are gated by OFFICEDEX_E2E_REAL=1 so routine unit tests
// do not spend hosted credits by accident.
//
// Run through npm:
//
//   npm run test:e2e:real
//
// Or directly:
//
//   OFFICEDEX_E2E_REAL=1 OFFICEDEX_E2E_REAL_GENERATE=1 \
//   OFFICECLI_DESKTOP_BINARY=$(pwd)/build/officecli/officecli \
//   go test -tags real_e2e ./internal/bridge -run TestRealOfficeCli -count=1 -timeout 120m -v

//go:build real_e2e

package bridge

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type realE2ERecord struct {
	Name         string `json:"name"`
	Operation    string `json:"operation"`
	DocumentType string `json:"documentType"`
	Command      string `json:"command"`
	FilePath     string `json:"filePath"`
	FileSize     int64  `json:"fileSize"`
	DurationMS   int64  `json:"durationMs"`
	Credits      any    `json:"credits,omitempty"`
	AccessMode   string `json:"accessMode,omitempty"`
	RuntimeMode  string `json:"runtimeMode,omitempty"`
}

var realE2EReport = struct {
	mu      sync.Mutex
	records []realE2ERecord
}{}

func TestMain(m *testing.M) {
	code := m.Run()
	if path := os.Getenv("OFFICEDEX_REAL_E2E_REPORT"); path != "" {
		_ = writeRealE2EReport(path, code)
	}
	os.Exit(code)
}

func TestRealOfficeCliInitializeAndCapabilities(t *testing.T) {
	binary := realBinary(t)

	client := New(Options{
		BinaryPath:           binary,
		DisableAutoReconnect: true,
		RequestTimeout:       60 * time.Second,
		Env:                  realBridgeEnv(),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := client.Start(ctx); err != nil {
		t.Fatalf("client.Start: %v", err)
	}
	t.Cleanup(client.Stop)

	if _, err := client.Initialize(ctx); err != nil {
		t.Fatalf("client.Initialize: %v", err)
	}
	caps, err := client.GetCapabilities(ctx)
	if err != nil {
		t.Fatalf("client.GetCapabilities: %v", err)
	}
	if len(caps) == 0 {
		t.Fatal("GetCapabilities returned empty payload")
	}
	payload := string(caps)
	for _, want := range []string{"office.generate", "pptx", "docx", "xlsx", "report", "img", "office.modify"} {
		if !strings.Contains(payload, want) {
			t.Fatalf("capabilities missing %q; payload=%s", want, truncate(caps, 1024))
		}
	}
	t.Logf("capabilities (%d bytes): %s", len(caps), truncate(caps, 512))
}

func TestRealOfficeCliGenerateArtifacts(t *testing.T) {
	realGenerateEnabled(t)
	binary := realBinary(t)
	root := realOutputRoot(t)
	sourceWorkbook := writeSourceWorkbook(t, filepath.Join(root, "fixtures", "source-workbook.xlsx"))

	cases := []struct {
		name        string
		docType     string
		topic       string
		prompt      string
		extraArgs   []string
		acceptedExt []string
	}{
		{
			name:    "pptx",
			docType: "pptx",
			topic:   "OfficeDex real E2E deck",
			prompt:  "Create a concise two-slide editable deck for real OfficeDex E2E validation.",
			extraArgs: []string{
				"--mode", "best",
				"--no-images",
				"--no-reference-scan",
				"--local-preview",
			},
			acceptedExt: []string{".pptx"},
		},
		{
			name:        "docx",
			docType:     "docx",
			topic:       "OfficeDex real E2E document",
			prompt:      "Write a five sentence document for real OfficeDex E2E validation.",
			extraArgs:   []string{"--mode", "best", "--local-preview"},
			acceptedExt: []string{".docx"},
		},
		{
			name:        "xlsx",
			docType:     "xlsx",
			topic:       "OfficeDex real E2E workbook",
			prompt:      "Create a small workbook with columns Item, Owner, Status and three data rows.",
			extraArgs:   []string{"--mode", "best", "--local-preview"},
			acceptedExt: []string{".xlsx"},
		},
		{
			name:    "report",
			docType: "report",
			topic:   "OfficeDex real E2E report",
			prompt:  "Summarize revenue movement and key decisions from this workbook in a short report.",
			extraArgs: []string{
				"--file", sourceWorkbook,
				"--local-preview",
			},
			acceptedExt: []string{".html", ".docx", ".pdf", ".md", ".pptx", ".xlsx"},
		},
		{
			name:        "img",
			docType:     "img",
			topic:       "OfficeDex real E2E image",
			prompt:      "Create a simple square product illustration with the text OfficeDex E2E.",
			acceptedExt: []string{".png", ".jpg", ".jpeg", ".webp"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			outputDir := filepath.Join(root, "artifacts", "generate", tc.name)
			result := runOfficeCliJSON(t, binary, outputDir, append([]string{
				"new", tc.docType, tc.topic,
				"--prompt", tc.prompt,
				"--out", outputDir,
				"--no-publish",
				"--json",
			}, tc.extraArgs...)...)
			path := result.filePath(t, outputDir)
			size := verifyArtifact(t, path, tc.acceptedExt)
			recordRealE2E(realE2ERecord{
				Name:         tc.name,
				Operation:    "generate",
				DocumentType: tc.docType,
				Command:      result.command,
				FilePath:     path,
				FileSize:     size,
				DurationMS:   result.duration.Milliseconds(),
				Credits:      result.raw["credits_charged"],
				AccessMode:   stringValue(result.raw["access_mode"]),
				RuntimeMode:  stringValue(result.raw["runtime_mode"]),
			})
		})
	}
}

func TestRealOfficeCliModifyArtifacts(t *testing.T) {
	realGenerateEnabled(t)
	binary := realBinary(t)
	root := realOutputRoot(t)

	cases := []struct {
		name        string
		docType     string
		prompt      string
		seedPrompt  string
		acceptedExt []string
	}{
		{
			name:        "pptx",
			docType:     "pptx",
			prompt:      "Add one short note mentioning the real E2E modify pass.",
			seedPrompt:  "Create a concise two-slide editable deck for a modify smoke test.",
			acceptedExt: []string{".pptx"},
		},
		{
			name:        "docx",
			docType:     "docx",
			prompt:      "Append one sentence saying modified by real E2E.",
			seedPrompt:  "Write a five sentence document for a modify smoke test.",
			acceptedExt: []string{".docx"},
		},
		{
			name:        "xlsx",
			docType:     "xlsx",
			prompt:      "Add a final row with Item=Real E2E, Owner=OfficeDex, Status=Modified.",
			seedPrompt:  "Create a small workbook with columns Item, Owner, Status and two data rows.",
			acceptedExt: []string{".xlsx"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			seedDir := filepath.Join(root, "artifacts", "modify-seed", tc.name)
			seedArgs := []string{
				"new", tc.docType, "OfficeDex real E2E " + tc.name + " seed",
				"--prompt", tc.seedPrompt,
				"--out", seedDir,
				"--no-publish",
				"--json",
				"--mode", "best",
			}
			if tc.docType == "pptx" {
				seedArgs = append(seedArgs, "--no-images", "--no-reference-scan")
			}
			seed := runOfficeCliJSON(t, binary, seedDir, seedArgs...)
			seedPath := seed.filePath(t, seedDir)
			verifyArtifact(t, seedPath, tc.acceptedExt)

			modDir := filepath.Join(root, "artifacts", "modify", tc.name)
			mod := runOfficeCliJSON(t, binary, modDir,
				"modify", seedPath,
				"--prompt", tc.prompt,
				"--out", modDir,
				"--json",
			)
			modPath := mod.filePath(t, modDir)
			size := verifyArtifact(t, modPath, tc.acceptedExt)
			if modPath == seedPath {
				t.Fatalf("modify returned source file path %q; expected a distinct output artifact", modPath)
			}
			recordRealE2E(realE2ERecord{
				Name:         tc.name,
				Operation:    "modify",
				DocumentType: tc.docType,
				Command:      mod.command,
				FilePath:     modPath,
				FileSize:     size,
				DurationMS:   mod.duration.Milliseconds(),
				Credits:      mod.raw["credits_charged"],
				AccessMode:   stringValue(mod.raw["access_mode"]),
				RuntimeMode:  stringValue(mod.raw["runtime_mode"]),
			})
		})
	}
}

type cliJSONResult struct {
	raw      map[string]any
	command  string
	workDir  string
	duration time.Duration
}

func runOfficeCliJSON(t *testing.T, binary string, outputDir string, args ...string) cliJSONResult {
	t.Helper()
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		t.Fatalf("mkdir output dir: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = outputDir
	cmd.Env = realCLIEnv()
	start := time.Now()
	out, err := cmd.CombinedOutput()
	duration := time.Since(start)
	command := binary + " " + strings.Join(args, " ")
	if ctx.Err() != nil {
		t.Fatalf("%s timed out after %s\noutput:\n%s", command, duration, out)
	}
	if err != nil {
		t.Fatalf("%s failed after %s: %v\noutput:\n%s", command, duration, err, out)
	}
	payload, parseErr := parseLastJSONObject(out)
	if parseErr != nil {
		t.Fatalf("%s did not emit parseable JSON: %v\noutput:\n%s", command, parseErr, out)
	}
	t.Logf("%s completed in %s -> %s", strings.Join(args[:min(3, len(args))], " "), duration.Round(time.Second), stringValue(payload["file_path"]))
	return cliJSONResult{raw: payload, command: command, workDir: outputDir, duration: duration}
}

func (r cliJSONResult) filePath(t *testing.T, outputDir string) string {
	t.Helper()
	for _, key := range []string{"file_path", "filePath", "output_file"} {
		if value := stringValue(r.raw[key]); value != "" {
			if filepath.IsAbs(value) {
				return value
			}
			if _, err := os.Stat(value); err == nil {
				abs, absErr := filepath.Abs(value)
				if absErr == nil {
					return abs
				}
				return filepath.Clean(value)
			}
			return filepath.Clean(filepath.Join(r.workDir, value))
		}
	}
	return newestArtifactPath(t, outputDir)
}

func parseLastJSONObject(out []byte) (map[string]any, error) {
	text := strings.TrimSpace(string(out))
	idx := strings.LastIndex(text, "\n{")
	if idx >= 0 {
		text = text[idx+1:]
	} else if start := strings.Index(text, "{"); start >= 0 {
		text = text[start:]
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func realBinary(t *testing.T) string {
	t.Helper()
	if os.Getenv("OFFICEDEX_E2E_REAL") != "1" {
		t.Skip("OFFICEDEX_E2E_REAL=1 is required for real officecli E2E")
	}
	binary := os.Getenv("OFFICECLI_DESKTOP_BINARY")
	if binary == "" {
		t.Fatal("OFFICECLI_DESKTOP_BINARY is required for real officecli E2E")
	}
	abs, err := filepath.Abs(binary)
	if err != nil {
		t.Fatalf("abs officecli binary: %v", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		t.Fatalf("officecli binary not accessible: %v", err)
	}
	if info.IsDir() {
		t.Fatalf("OFFICECLI_DESKTOP_BINARY points to a directory: %s", abs)
	}
	return abs
}

func realGenerateEnabled(t *testing.T) {
	t.Helper()
	if os.Getenv("OFFICEDEX_E2E_REAL_GENERATE") != "1" {
		t.Skip("OFFICEDEX_E2E_REAL_GENERATE=1 is required because this test spends real generation credits")
	}
}

func realOutputRoot(t *testing.T) string {
	t.Helper()
	root := os.Getenv("OFFICEDEX_E2E_OUTPUT_DIR")
	if root == "" {
		root = filepath.Join("test-results", "real-e2e-artifacts")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		t.Fatalf("abs output root: %v", err)
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		t.Fatalf("mkdir output root: %v", err)
	}
	return abs
}

func realBridgeEnv() []string {
	return proxyEnv([]string{"OFFICECLI_SKIP_UPDATE_CHECK=1"})
}

func realCLIEnv() []string {
	return proxyEnv(os.Environ())
}

func proxyEnv(base []string) []string {
	out := append([]string{}, base...)
	if proxy := strings.TrimSpace(os.Getenv("OFFICEDEX_E2E_PROXY")); proxy != "" {
		out = setEnv(out, "HTTP_PROXY", proxy)
		out = setEnv(out, "HTTPS_PROXY", proxy)
		out = setEnv(out, "ALL_PROXY", proxy)
	}
	out = setEnv(out, "OFFICECLI_SKIP_UPDATE_CHECK", "1")
	return out
}

func setEnv(env []string, key string, value string) []string {
	prefix := key + "="
	filtered := env[:0]
	for _, item := range env {
		if !strings.HasPrefix(item, prefix) {
			filtered = append(filtered, item)
		}
	}
	return append(filtered, prefix+value)
}

func writeSourceWorkbook(t *testing.T, path string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir fixture dir: %v", err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create source workbook: %v", err)
	}
	zw := zip.NewWriter(file)
	files := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
		"xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
		"xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Month</t></is></c><c r="B1" t="inlineStr"><is><t>Revenue</t></is></c><c r="C1" t="inlineStr"><is><t>Cost</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>January</t></is></c><c r="B2"><v>120</v></c><c r="C2"><v>80</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>February</t></is></c><c r="B3"><v>150</v></c><c r="C3"><v>95</v></c></row>
</sheetData>
</worksheet>`,
	}
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create xlsx part %s: %v", name, err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatalf("write xlsx part %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close source workbook zip: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close source workbook: %v", err)
	}
	return path
}

func newestArtifactPath(t *testing.T, dir string) string {
	t.Helper()
	var newest string
	var newestMod time.Time
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || strings.HasSuffix(path, ".preview.html") || strings.HasSuffix(path, ".preview.json") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if newest == "" || info.ModTime().After(newestMod) {
			newest = path
			newestMod = info.ModTime()
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk output dir %s: %v", dir, err)
	}
	if newest == "" {
		t.Fatalf("no artifact found in %s", dir)
	}
	return newest
}

func verifyArtifact(t *testing.T, path string, acceptedExt []string) int64 {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("artifact missing: %s: %v", path, err)
	}
	if info.Size() <= 0 {
		t.Fatalf("artifact is empty: %s", path)
	}
	ext := strings.ToLower(filepath.Ext(path))
	if len(acceptedExt) > 0 && !containsString(acceptedExt, ext) {
		t.Fatalf("artifact extension = %q, want one of %v (path=%s)", ext, acceptedExt, path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read artifact: %v", err)
	}
	switch ext {
	case ".pptx", ".docx", ".xlsx":
		if !bytes.HasPrefix(data, []byte("PK")) {
			t.Fatalf("%s artifact is not an OOXML zip: %s", ext, path)
		}
	case ".png":
		if !bytes.HasPrefix(data, []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}) {
			t.Fatalf("png artifact has invalid magic: %s", path)
		}
	case ".jpg", ".jpeg":
		if len(data) < 3 || data[0] != 0xff || data[1] != 0xd8 || data[2] != 0xff {
			t.Fatalf("jpeg artifact has invalid magic: %s", path)
		}
	case ".webp":
		if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
			t.Fatalf("webp artifact has invalid magic: %s", path)
		}
	case ".pdf":
		if !bytes.HasPrefix(data, []byte("%PDF-")) {
			t.Fatalf("pdf artifact has invalid magic: %s", path)
		}
	}
	return info.Size()
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func stringValue(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

func min(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func recordRealE2E(record realE2ERecord) {
	realE2EReport.mu.Lock()
	realE2EReport.records = append(realE2EReport.records, record)
	realE2EReport.mu.Unlock()
}

func writeRealE2EReport(path string, exitCode int) error {
	realE2EReport.mu.Lock()
	records := append([]realE2ERecord(nil), realE2EReport.records...)
	realE2EReport.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	binary := os.Getenv("OFFICECLI_DESKTOP_BINARY")
	version := ""
	if binary != "" {
		out, err := exec.Command(binary, "--version").CombinedOutput()
		if err == nil {
			version = strings.TrimSpace(string(out))
		}
	}
	body, err := json.MarshalIndent(map[string]any{
		"status":           statusFromExitCode(exitCode),
		"exitCode":         exitCode,
		"generatedAt":      time.Now().Format(time.RFC3339),
		"officecliBinary":  binary,
		"officecliVersion": version,
		"records":          records,
	}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(body, '\n'), 0o644)
}

func statusFromExitCode(code int) string {
	if code == 0 {
		return "passed"
	}
	return "failed"
}

func truncate(b []byte, n int) string {
	s := string(b)
	if len(s) <= n {
		return s
	}
	return strings.ReplaceAll(s[:n], "\n", " ") + "..."
}
