package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"officedex/internal/preview"
	"officedex/internal/settings"
)

func newCreateWorkbookTestApp(t *testing.T) (*App, string) {
	t.Helper()
	root := t.TempDir()
	workspace := filepath.Join(root, "workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{workspace}})
	if err != nil {
		t.Fatal(err)
	}
	app := &App{
		settingsStore: settings.New(filepath.Join(root, "settings.json"), nil),
		previewReg:    reg,
		workspaceDir:  workspace,
	}
	return app, workspace
}

// CreateWorkbookFromSheet is what the Jira and Liquipedia syncs call on their
// first run. It has to write a real workbook the spreadsheet stage can open,
// register it for preview, and never overwrite an earlier sync's file.
func TestCreateWorkbookFromSheetWritesHeadersRowsAndGrantsPreview(t *testing.T) {
	app, workspace := newCreateWorkbookTestApp(t)

	artifact, err := app.CreateWorkbookFromSheet(CreateWorkbookFromSheetInput{
		FileName:  "Jira Issues.xlsx",
		SheetName: "Issues",
		Headers:   []string{"Issue Key", "Summary", "OfficeDex Notes"},
		Rows:      [][]string{{"OD-1", "First", ""}, {"OD-2", "Second", "note"}},
	})
	if err != nil {
		t.Fatalf("CreateWorkbookFromSheet: %v", err)
	}
	if artifact.DocumentType != "xlsx" || artifact.FileName != "Jira Issues.xlsx" {
		t.Fatalf("artifact = %+v", artifact)
	}
	if filepath.Dir(artifact.FilePath) != workspace {
		t.Fatalf("workbook written to %s, want the workspace %s", artifact.FilePath, workspace)
	}

	book, err := excelize.OpenFile(artifact.FilePath)
	if err != nil {
		t.Fatalf("open workbook: %v", err)
	}
	defer book.Close()
	rows, err := book.GetRows("Issues")
	if err != nil {
		t.Fatalf("GetRows: %v", err)
	}
	want := [][]string{{"Issue Key", "Summary", "OfficeDex Notes"}, {"OD-1", "First"}, {"OD-2", "Second", "note"}}
	if len(rows) != len(want) {
		t.Fatalf("rows = %v, want %v", rows, want)
	}
	for i := range want {
		if strings.Join(rows[i], "|") != strings.Join(want[i], "|") {
			t.Fatalf("row %d = %v, want %v", i, rows[i], want[i])
		}
	}

	if _, err := app.previewReg.IssueToken(artifact); err != nil {
		t.Fatalf("the new workbook must be registered for preview: %v", err)
	}
}

func TestCreateWorkbookFromSheetDoesNotOverwriteAnEarlierSync(t *testing.T) {
	app, _ := newCreateWorkbookTestApp(t)
	input := CreateWorkbookFromSheetInput{FileName: "Liquipedia Updates.xlsx", SheetName: "Updates", Headers: []string{"Team"}, Rows: [][]string{{"A"}}}

	first, err := app.CreateWorkbookFromSheet(input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := app.CreateWorkbookFromSheet(input)
	if err != nil {
		t.Fatal(err)
	}
	if first.FilePath == second.FilePath {
		t.Fatalf("second sync overwrote %s", first.FilePath)
	}
	for _, path := range []string{first.FilePath, second.FilePath} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("%s missing after second sync: %v", path, err)
		}
	}
	if !strings.HasPrefix(second.FileName, "Liquipedia Updates") || !strings.HasSuffix(second.FileName, ".xlsx") {
		t.Fatalf("second file name %q should keep the base name and extension", second.FileName)
	}
}

func TestCreateWorkbookFromSheetRejectsBadInput(t *testing.T) {
	app, workspace := newCreateWorkbookTestApp(t)
	cases := map[string]CreateWorkbookFromSheetInput{
		"empty name":      {FileName: "", SheetName: "S", Headers: []string{"A"}},
		"path in name":    {FileName: "../escape.xlsx", SheetName: "S", Headers: []string{"A"}},
		"wrong extension": {FileName: "notes.csv", SheetName: "S", Headers: []string{"A"}},
		"empty sheet":     {FileName: "ok.xlsx", SheetName: " ", Headers: []string{"A"}},
		"no headers":      {FileName: "ok.xlsx", SheetName: "S"},
	}
	for name, input := range cases {
		if _, err := app.CreateWorkbookFromSheet(input); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	entries, err := os.ReadDir(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("rejected inputs must not write files, found %d", len(entries))
	}
}
