package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/pptxeditor"
	"officedex/internal/preview"
	"officedex/internal/timeline"
	"officedex/internal/types"
)

// snapshotEditorStub stands in for an open editor session holding a document.
type snapshotEditorStub struct {
	pptxEditorService
	snapshot pptxeditor.SnapshotResult
	token    string
	session  string
	err      error
}

func (s *snapshotEditorStub) Snapshot(previewToken, sessionID string) (pptxeditor.SnapshotResult, error) {
	s.token, s.session = previewToken, sessionID
	return s.snapshot, s.err
}

// passthroughConverter writes a recognisable stand-in for the exported deck.
type passthroughConverter struct{}

func (passthroughConverter) ExportPptx(_ context.Context, mop, output string) error {
	content, err := os.ReadFile(filepath.Join(mop, "content.json"))
	if err != nil {
		return err
	}
	return os.WriteFile(output, append([]byte("PK"), content...), 0o644)
}

func newTimelineApp(t *testing.T, editor pptxEditorService) *App {
	t.Helper()
	workspace := t.TempDir()
	registry, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{workspace}})
	if err != nil {
		t.Fatal(err)
	}
	return &App{
		workspaceDir:      workspace,
		previewReg:        registry,
		pptxEditorService: editor,
		timelineStore:     timeline.New(filepath.Join(workspace, "timeline"), passthroughConverter{}),
	}
}

func TestCaptureTimelineNodeStoresTheOpenDocument(t *testing.T) {
	editor := &snapshotEditorStub{snapshot: pptxeditor.SnapshotResult{
		Content: []byte(`{"slides":1}`),
		Assets:  []pptxeditor.Asset{{Path: "media/cover.jpg", ContentType: "image/jpeg", Data: []byte("photo")}},
	}}
	app := newTimelineApp(t, editor)

	node, err := app.CaptureTimelineNode(CaptureTimelineNodeInput{
		TaskID: "task-1", PreviewToken: "tok", SessionID: "sess",
		Kind: "generation", Seq: 12, Slide: 2, Slides: 4, Label: "第 2 页完成",
	})
	if err != nil {
		t.Fatal(err)
	}
	if node.ID != "n001" || node.Slide != 2 || node.Slides != 4 || node.Label != "第 2 页完成" {
		t.Fatalf("node = %#v", node)
	}
	if editor.token != "tok" || editor.session != "sess" {
		t.Fatalf("snapshot taken from %q/%q", editor.token, editor.session)
	}
	nodes, err := app.ListTimeline("task-1")
	if err != nil || len(nodes) != 1 || nodes[0].ID != "n001" {
		t.Fatalf("nodes = %#v (%v)", nodes, err)
	}
}

func TestOpenTimelineNodeYieldsAPreviewableDeck(t *testing.T) {
	editor := &snapshotEditorStub{snapshot: pptxeditor.SnapshotResult{Content: []byte(`{"slides":1}`)}}
	app := newTimelineApp(t, editor)
	if _, err := app.CaptureTimelineNode(CaptureTimelineNodeInput{TaskID: "task-1", Slide: 1}); err != nil {
		t.Fatal(err)
	}

	deck, err := app.OpenTimelineNode(OpenTimelineNodeInput{TaskID: "task-1", NodeID: "n001"})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(deck.FilePath)
	if err != nil || !strings.HasPrefix(string(data), "PK{\"slides\":1}") {
		t.Fatalf("deck = %q (%v)", data, err)
	}
	// The preview opens files it was granted; a node's deck has to be one of
	// them or scrubbing back would be refused.
	grant, err := app.IssuePreviewToken(types.Artifact{
		FilePath: deck.FilePath, FileName: deck.FileName, DocumentType: "pptx",
	})
	if err != nil {
		t.Fatalf("timeline deck was not granted to the preview: %v", err)
	}
	if strings.TrimSpace(grant.Token) == "" {
		t.Fatal("empty preview token")
	}
}

func TestTimelineRefusesWorkWithoutAStore(t *testing.T) {
	app := &App{}
	if _, err := app.CaptureTimelineNode(CaptureTimelineNodeInput{TaskID: "task-1"}); err == nil {
		t.Fatal("capture without a store must fail")
	}
	if _, err := app.ListTimeline("task-1"); err == nil {
		t.Fatal("listing without a store must fail")
	}
	if _, err := app.OpenTimelineNode(OpenTimelineNodeInput{TaskID: "task-1", NodeID: "n001"}); err == nil {
		t.Fatal("opening without a store must fail")
	}
}

func TestListTimelineIsEmptyBeforeAnythingIsCaptured(t *testing.T) {
	app := newTimelineApp(t, &snapshotEditorStub{})
	nodes, err := app.ListTimeline("task-fresh")
	if err != nil {
		t.Fatal(err)
	}
	// An empty timeline is a normal state, not an error: every deck starts here.
	if len(nodes) != 0 {
		t.Fatalf("nodes = %#v", nodes)
	}
}
