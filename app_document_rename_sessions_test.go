package main

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"officedex/internal/pptxeditor"
	"officedex/internal/preview"
	"officedex/internal/types"
	"officedex/internal/xlsxeditor"
)

// Conversion is independent of relocation. Real converters and actual edited
// OOXML are covered by qa26-rename-real.spec.ts; this exercises live services.
type renameConverter struct {
	output    []byte
	exporting chan struct{}
	proceed   chan struct{}
}

func (c renameConverter) Close() error { return nil }
func (c renameConverter) ImportPptx(_ context.Context, _ string, dir string) error {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "content.json"), []byte(`{"magic":"mop0","version":1,"blocks":[]}`), 0600)
}
func (c renameConverter) ExportPptx(_ context.Context, _ string, out string) error {
	if c.exporting != nil {
		close(c.exporting)
		<-c.proceed
	}
	return os.WriteFile(out, c.output, 0600)
}
func (c renameConverter) ImportXlsx(_ context.Context, _ string, out, _ string) error {
	return os.WriteFile(out, []byte("modoc"), 0600)
}
func (c renameConverter) ExportXlsx(_ context.Context, out, _, _ string) error {
	return os.WriteFile(out, c.output, 0600)
}

func TestRenameDocumentPreservesOpenEditorSaveAndRetry(t *testing.T) {
	for _, ext := range []string{"docx", "pptx", "xlsx"} {
		t.Run(ext, func(t *testing.T) {
			app, store, root := newFolderTestApp(t)
			old := filepath.Join(root, "before."+ext)
			seedDocument(t, store, "task-rename", "", old)
			record := seededDocument(t, app, "task-rename", old)
			original, err := os.ReadFile(filepath.Join("e2e", "fixtures", "qa26", "original."+ext))
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(old, original, 0600); err != nil {
				t.Fatal(err)
			}
			app.previewReg, err = preview.New(preview.RegistryOptions{TrustedRoots: []string{root}})
			if err != nil {
				t.Fatal(err)
			}
			artifact := types.Artifact{FilePath: old, FileName: filepath.Base(old), DocumentType: ext}
			if err = app.previewReg.AllowArtifact(artifact); err != nil {
				t.Fatal(err)
			}
			grant, err := app.IssuePreviewToken(artifact)
			if err != nil {
				t.Fatal(err)
			}
			converter := renameConverter{output: original}
			var save func() error
			switch ext {
			case "docx":
				edited := testDocxPackage(t, "N26 edits survive rename")
				expected := sha256Hex(original)
				save = func() error {
					result, e := app.SaveDocx(SaveDocxInput{PreviewToken: grant.Token, ExpectedSHA256: expected, DataBase64: base64.StdEncoding.EncodeToString(edited)})
					if e == nil {
						expected = result.SHA256
					}
					return e
				}
			case "pptx":
				app.pptxEditorService = pptxeditor.NewService(app.previewReg, converter, t.TempDir())
				t.Cleanup(func() { _ = app.pptxEditorService.CloseAll() })
				session, e := app.PreparePptxEditor(grant.Token)
				if e != nil {
					t.Fatal(e)
				}
				// An unsaved snapshot must remain available across rename.
				_, e = app.SavePptxEditorSnapshot(SavePptxEditorSnapshotInput{PreviewToken: grant.Token, SessionID: session.SessionID, ContentBase64: base64.StdEncoding.EncodeToString(session.Content), BaseRevision: 0, Revision: 1})
				if e != nil {
					t.Fatal(e)
				}
				save = func() error {
					_, e := app.ExportPptxEditor(ExportPptxEditorInput{PreviewToken: grant.Token, SessionID: session.SessionID, Revision: 1})
					return e
				}
			case "xlsx":
				app.xlsxEditorService = xlsxeditor.NewService(app.previewReg, converter, t.TempDir())
				t.Cleanup(func() { _ = app.xlsxEditorService.CloseAll() })
				session, e := app.PrepareXlsxEditor(grant.Token)
				if e != nil {
					t.Fatal(e)
				}
				save = func() error {
					_, e := app.SaveXlsxEditor(SaveXlsxEditorInput{PreviewToken: grant.Token, SessionID: session.SessionID, ModocContent: session.ModocContent})
					return e
				}
			}
			for _, name := range []string{"after", "twice"} {
				renamed, e := app.RenameDocument(record.ID, name)
				if e != nil {
					t.Fatal(e)
				}
				for i := 0; i < 2; i++ {
					if e = save(); e != nil {
						t.Fatalf("save/retry %d after rename to %s: %v", i, name, e)
					}
				}
				if _, e = os.Stat(renamed.FilePath); e != nil {
					t.Fatal(e)
				}
				if _, e = os.Stat(old); !os.IsNotExist(e) {
					t.Fatalf("save recreated old path: %v", e)
				}
				old = renamed.FilePath
			}
		})
	}
}

func TestRenameDocumentWaitsForInFlightSave(t *testing.T) {
	app, store, root := newFolderTestApp(t)
	old := filepath.Join(root, "before.pptx")
	seedDocument(t, store, "task-rename", "", old)
	record := seededDocument(t, app, "task-rename", old)
	original, err := os.ReadFile("e2e/fixtures/qa26/original.pptx")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(old, original, 0600); err != nil {
		t.Fatal(err)
	}
	app.previewReg, err = preview.New(preview.RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatal(err)
	}
	artifact := types.Artifact{FilePath: old, DocumentType: "pptx"}
	if err = app.previewReg.AllowArtifact(artifact); err != nil {
		t.Fatal(err)
	}
	grant, err := app.IssuePreviewToken(artifact)
	if err != nil {
		t.Fatal(err)
	}
	started, proceed := make(chan struct{}), make(chan struct{})
	app.pptxEditorService = pptxeditor.NewService(app.previewReg, renameConverter{output: original, exporting: started, proceed: proceed}, t.TempDir())
	t.Cleanup(func() { _ = app.pptxEditorService.CloseAll() })
	session, err := app.PreparePptxEditor(grant.Token)
	if err != nil {
		t.Fatal(err)
	}
	saved := make(chan error, 1)
	go func() {
		_, e := app.ExportPptxEditor(ExportPptxEditorInput{PreviewToken: grant.Token, SessionID: session.SessionID})
		saved <- e
	}()
	<-started
	renamed := make(chan error, 1)
	go func() { _, e := app.RenameDocument(record.ID, "after"); renamed <- e }()
	select {
	case e := <-renamed:
		close(proceed)
		t.Fatalf("rename completed during export: %v", e)
	case <-time.After(50 * time.Millisecond):
	}
	close(proceed)
	if err = <-saved; err != nil {
		t.Fatal(err)
	}
	if err = <-renamed; err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("old path: %v", err)
	}
	if _, err = os.Stat(filepath.Join(root, "after.pptx")); err != nil {
		t.Fatal(err)
	}
}

func TestRenameDocumentRetainsConflictGuardAndRejectsCollision(t *testing.T) {
	app, store, root := newFolderTestApp(t)
	old := filepath.Join(root, "before.docx")
	seedDocument(t, store, "task-rename", "", old)
	record := seededDocument(t, app, "task-rename", old)
	original := testDocxPackage(t, "original")
	if err := os.WriteFile(old, original, 0600); err != nil {
		t.Fatal(err)
	}
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatal(err)
	}
	app.previewReg = reg
	artifact := types.Artifact{FilePath: old, DocumentType: "docx"}
	if err = reg.AllowArtifact(artifact); err != nil {
		t.Fatal(err)
	}
	grant, err := reg.IssueToken(artifact)
	if err != nil {
		t.Fatal(err)
	}
	taken := filepath.Join(root, "taken.docx")
	if err = os.WriteFile(taken, []byte("other file"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = app.RenameDocument(record.ID, "taken"); err == nil {
		t.Fatal("collision accepted")
	}
	entry, _ := reg.ResolveToken(grant.Token)
	if entry.FilePath != canonicalPath(old) {
		t.Fatal("failed rename changed token")
	}
	external := testDocxPackage(t, "external change")
	if err = os.WriteFile(old, external, 0600); err != nil {
		t.Fatal(err)
	}
	after, err := app.RenameDocument(record.ID, "after")
	if err != nil {
		t.Fatal(err)
	}
	_, err = app.SaveDocx(SaveDocxInput{PreviewToken: grant.Token, ExpectedSHA256: sha256Hex(original), DataBase64: base64.StdEncoding.EncodeToString(testDocxPackage(t, "local edits"))})
	if err == nil || !strings.Contains(err.Error(), "changed outside OfficeDex") {
		t.Fatalf("conflict lost: %v", err)
	}
	disk, err := os.ReadFile(after.FilePath)
	if err != nil || string(disk) != string(external) {
		t.Fatal("external content overwritten")
	}
}

func TestRenameDocumentRollsBackDiskWhenStoreRejectsDestination(t *testing.T) {
	app, store, root := newFolderTestApp(t)
	old := filepath.Join(root, "before.docx")
	seedDocument(t, store, "task-before", "", old)
	record := seededDocument(t, app, "task-before", old)
	target := filepath.Join(root, "stale.docx")
	seedDocument(t, store, "task-stale", "", target)
	seededDocument(t, app, "task-stale", target)
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	if _, err := app.RenameDocument(record.ID, "stale"); err == nil {
		t.Fatal("expected stale database collision")
	}
	if _, err := os.Stat(old); err != nil {
		t.Fatalf("failed rename did not restore file: %v", err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("failed rename left destination: %v", err)
	}
	got, err := app.GetDocument(record.ID)
	if err != nil || got.FilePath != old {
		t.Fatalf("record changed: %+v %v", got, err)
	}
}

func TestRenameDocumentSymlinkPreservesSaveTarget(t *testing.T) {
	app, store, root := newFolderTestApp(t)
	link := filepath.Join(root, "link.docx")
	seedDocument(t, store, "task-link", "", link)
	record := seededDocument(t, app, "task-link", link)
	target := filepath.Join(t.TempDir(), "target.docx")
	original := testDocxPackage(t, "original")
	if err := os.WriteFile(target, original, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatal(err)
	}
	app.previewReg = reg
	artifact := types.Artifact{FilePath: link, DocumentType: "docx"}
	if err = reg.AllowSelectedArtifact(artifact); err != nil {
		t.Fatal(err)
	}
	grant, err := reg.IssueToken(artifact)
	if err != nil {
		t.Fatal(err)
	}
	renamed, err := app.RenameDocument(record.ID, "renamed-link")
	if err != nil {
		t.Fatal(err)
	}
	edited := testDocxPackage(t, "edited")
	_, err = app.SaveDocx(SaveDocxInput{PreviewToken: grant.Token, ExpectedSHA256: sha256Hex(original), DataBase64: base64.StdEncoding.EncodeToString(edited)})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(renamed.FilePath)
	if err != nil || string(data) != string(edited) {
		t.Fatal("renamed link no longer saves source")
	}
	info, err := os.Lstat(renamed.FilePath)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("link replaced by regular file")
	}
}
