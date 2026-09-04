package workspace

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"officedex/internal/types"
)

func ptr(s string) *string { return &s }

func TestCleanDirRequiresAnAbsolutePathWithoutNUL(t *testing.T) {
	if got, err := CleanDir("  /tmp/ws  "); err != nil || got != "/tmp/ws" {
		t.Fatalf("CleanDir = %q, %v", got, err)
	}
	if _, err := CleanDir("relative/ws"); err == nil || !strings.Contains(err.Error(), "absolute") {
		t.Fatalf("relative path accepted: %v", err)
	}
	if _, err := CleanDir("/tmp/ws\x00x"); err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Fatalf("NUL accepted: %v", err)
	}
	if _, err := CleanOutputDir("relative"); err == nil || !strings.Contains(err.Error(), "generate output dir") {
		t.Fatalf("output dir error must name the output dir: %v", err)
	}
}

func TestCleanExistingDirRejectsMissingPathsAndFiles(t *testing.T) {
	root := t.TempDir()
	if got, err := CleanExistingDir(root); err != nil || got != root {
		t.Fatalf("existing dir: %q, %v", got, err)
	}
	if _, err := CleanExistingDir(filepath.Join(root, "missing")); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("missing dir accepted: %v", err)
	}
	file := filepath.Join(root, "f.txt")
	if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := CleanExistingDir(file); err == nil || !strings.Contains(err.Error(), "directory") {
		t.Fatalf("file accepted as workspace: %v", err)
	}
}

func TestSamePathCleansBeforeComparing(t *testing.T) {
	if !SamePath("/a/b/../b", "/a/b/") {
		t.Fatal("equivalent paths not recognised")
	}
	if SamePath("", "/a") || SamePath("/a", "  ") {
		t.Fatal("an empty side never matches")
	}
}

func TestSettingsDirPrefersWorkspaceDirOverLegacyOutputDir(t *testing.T) {
	if got, ok := SettingsDir(types.UserSettings{WorkspaceDir: ptr("/ws"), OutputDir: ptr("/out")}); !ok || got != "/ws" {
		t.Fatalf("SettingsDir = %q, %v", got, ok)
	}
	if got, ok := SettingsDir(types.UserSettings{WorkspaceDir: ptr("  "), OutputDir: ptr("/out")}); !ok || got != "/out" {
		t.Fatalf("blank WorkspaceDir must fall back to OutputDir: %q, %v", got, ok)
	}
	if _, ok := SettingsDir(types.UserSettings{}); ok {
		t.Fatal("nothing configured reported as set")
	}
	if _, ok := SettingsDir(types.UserSettings{WorkspaceDir: ptr("relative")}); ok {
		t.Fatal("an invalid configured dir must not be returned")
	}
}

func TestHasInvalidSettingsDirOnlyFlagsAConfiguredBadPath(t *testing.T) {
	if HasInvalidSettingsDir(types.UserSettings{}) {
		t.Fatal("unset is not invalid")
	}
	if HasInvalidSettingsDir(types.UserSettings{WorkspaceDir: ptr("/ws")}) {
		t.Fatal("a valid dir flagged")
	}
	if !HasInvalidSettingsDir(types.UserSettings{WorkspaceDir: ptr("relative"), OutputDir: ptr("/out")}) {
		t.Fatal("an invalid WorkspaceDir must be flagged even when OutputDir is fine: WorkspaceDir is what the user chose")
	}
	if !HasInvalidSettingsDir(types.UserSettings{OutputDir: ptr("relative")}) {
		t.Fatal("invalid legacy OutputDir not flagged")
	}
}

func TestTrustedRootsAlwaysIncludeTheDefaultWorkspace(t *testing.T) {
	if got := TrustedRoots("/default", types.UserSettings{}); !reflect.DeepEqual(got, []string{"/default"}) {
		t.Fatalf("TrustedRoots = %v", got)
	}
	if got := TrustedRoots("/default", types.UserSettings{WorkspaceDir: ptr("/custom")}); !reflect.DeepEqual(got, []string{"/default", "/custom"}) {
		t.Fatalf("TrustedRoots = %v", got)
	}
	if got := TrustedRoots("/default", types.UserSettings{WorkspaceDir: ptr("bad")}); !reflect.DeepEqual(got, []string{"/default"}) {
		t.Fatalf("an invalid custom dir must not become a trusted root: %v", got)
	}
}

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"  Quarterly Report: Q3 / 2026 ": "quarterly-report-q3-2026",
		"季度报告":                           "",
		"季度报告 Q3":                        "q3",
		"---":                            "",
		strings.Repeat("abcde-", 20):     strings.Repeat("abcde-", 6) + "abcd",
	}
	for in, want := range cases {
		if got := Slugify(in); got != want {
			t.Errorf("Slugify(%q) = %q, want %q", in, got, want)
		}
	}
	if got := Slugify(strings.Repeat("abcde-", 20)); len(got) > slugMaxLen {
		t.Fatalf("slug longer than %d: %d", slugMaxLen, len(got))
	}
}

func TestTaskDirNameSortsByTimeAndFallsBackToTypeThenTask(t *testing.T) {
	at := time.Date(2026, 9, 4, 15, 4, 5, 0, time.UTC)
	id := "0123456789abcdef-ffff"
	if got := taskDirName("Board Review", "pptx", at, id); got != "20260904-150405-board-review-01234567" {
		t.Fatalf("TaskDirName = %q", got)
	}
	if got := taskDirName("季度报告", "pptx", at, id); got != "20260904-150405-pptx-01234567" {
		t.Fatalf("CJK topic must fall back to the document type: %q", got)
	}
	if got := taskDirName("季度报告", "", at, id); got != "20260904-150405-task-01234567" {
		t.Fatalf("no slug at all must fall back to \"task\": %q", got)
	}
	live := TaskDirName("x", "y")
	if len(strings.Split(live, "-")) != 4 || len(live) != len("20260904-150405-x-01234567") {
		t.Fatalf("live TaskDirName shape: %q", live)
	}
}
