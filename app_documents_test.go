package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/localstore"
	"officedex/internal/types"
)

func newDocumentTestApp(t *testing.T) (*App, *localstore.Store) {
	t.Helper()
	store := localstore.New(filepath.Join(t.TempDir(), "officedex.db"))
	if err := store.Open(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return &App{localStore: store}, store
}

// seedDocument drives the projection the way the app does: a run's events, then
// the artifact it produced. The document row is a consequence of those writes,
// not something written directly — which is the property being relied on here.
func seedDocument(t *testing.T, store *localstore.Store, taskID, workspaceID, path string) {
	t.Helper()
	ctx := context.Background()
	if workspaceID != "" {
		if err := store.RecordTaskContext(ctx, taskID, localstore.TaskContext{
			ConversationID: taskID,
			WorkspaceID:    workspaceID,
		}); err != nil {
			t.Fatalf("RecordTaskContext: %v", err)
		}
	}
	for _, event := range []types.BridgeEvent{
		{EventID: taskID + "-1", TaskID: taskID, Type: "task.started", TS: "2026-03-01T12:00:01Z"},
		{EventID: taskID + "-2", TaskID: taskID, Type: "task.completed", TS: "2026-03-01T12:00:09Z"},
	} {
		if err := store.RecordEvent(event); err != nil {
			t.Fatalf("RecordEvent: %v", err)
		}
	}
	if err := store.RecordArtifact(types.Artifact{
		TaskID:       taskID,
		FilePath:     path,
		FileName:     filepath.Base(path),
		DocumentType: strings.TrimPrefix(filepath.Ext(path), "."),
	}); err != nil {
		t.Fatalf("RecordArtifact: %v", err)
	}
}

// The projection has been maintained on every write since it landed and had no
// reader. This is the reader: what the new UI's file list is built on.
func TestListDocumentsReturnsWhatTheProjectionRecorded(t *testing.T) {
	app, store := newDocumentTestApp(t)
	root := t.TempDir()
	seedDocument(t, store, "task-deck", "", filepath.Join(root, "deck.pptx"))
	seedDocument(t, store, "task-report", "", filepath.Join(root, "report.docx"))

	page, err := app.ListDocuments(types.DocumentListInput{})
	if err != nil {
		t.Fatalf("ListDocuments: %v", err)
	}
	names := make([]string, 0, len(page.Items))
	for _, item := range page.Items {
		names = append(names, item.FileName)
	}
	if len(names) != 2 {
		t.Fatalf("got %d documents %v, want 2", len(names), names)
	}
	for _, want := range []string{"deck.pptx", "report.docx"} {
		found := false
		for _, name := range names {
			if name == want {
				found = true
			}
		}
		if !found {
			t.Errorf("missing %s in %v", want, names)
		}
	}
}

// An empty WorkspaceID means "every workspace", not "the ones filed nowhere".
// Getting this backwards would make the unfiled documents the only ones the UI
// could ever see.
func TestListDocumentsFiltersByWorkspaceAndBlankMeansAll(t *testing.T) {
	app, store := newDocumentTestApp(t)
	ctx := context.Background()
	root := t.TempDir()
	alpha, err := store.EnsureWorkspace(ctx, filepath.Join(root, "alpha"))
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	seedDocument(t, store, "task-filed", alpha.ID, filepath.Join(root, "filed.pptx"))
	seedDocument(t, store, "task-unfiled", "", filepath.Join(root, "unfiled.pptx"))

	filed, err := app.ListDocuments(types.DocumentListInput{WorkspaceID: alpha.ID})
	if err != nil {
		t.Fatalf("ListDocuments(alpha): %v", err)
	}
	if len(filed.Items) != 1 || filed.Items[0].FileName != "filed.pptx" {
		t.Fatalf("workspace filter returned %+v, want only filed.pptx", filed.Items)
	}

	all, err := app.ListDocuments(types.DocumentListInput{})
	if err != nil {
		t.Fatalf("ListDocuments(all): %v", err)
	}
	if len(all.Items) != 2 {
		t.Fatalf("blank workspace returned %d documents, want both", len(all.Items))
	}
}

func TestGetDocumentRefusesAMissingID(t *testing.T) {
	app, store := newDocumentTestApp(t)
	seedDocument(t, store, "task-deck", "", filepath.Join(t.TempDir(), "deck.pptx"))

	page, err := app.ListDocuments(types.DocumentListInput{})
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("seed failed: %v %+v", err, page.Items)
	}
	found, err := app.GetDocument(page.Items[0].ID)
	if err != nil {
		t.Fatalf("GetDocument: %v", err)
	}
	if found.FileName != "deck.pptx" {
		t.Errorf("got %s, want deck.pptx", found.FileName)
	}

	// A blank record flowing into the UI is harder to trace than a refusal.
	if _, err := app.GetDocument("document:nope"); err == nil {
		t.Error("expected an error for a document that does not exist")
	}
	if _, err := app.GetDocument("   "); err == nil {
		t.Error("expected an error for a blank id")
	}
}

// A document usually has several runs: the one that created it, then one per
// follow-up edit. Its activity stream carries all of their events in order.
func TestDocumentRunsAndActivitiesAreReachable(t *testing.T) {
	app, store := newDocumentTestApp(t)
	path := filepath.Join(t.TempDir(), "deck.pptx")
	seedDocument(t, store, "task-first", "", path)

	page, err := app.ListDocuments(types.DocumentListInput{})
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("seed failed: %v %+v", err, page.Items)
	}
	documentID := page.Items[0].ID

	runs, err := app.ListDocumentRuns(documentID)
	if err != nil {
		t.Fatalf("ListDocumentRuns: %v", err)
	}
	if len(runs) == 0 {
		t.Fatal("expected at least the run that produced the document")
	}

	activities, err := app.ListDocumentActivities(types.DocumentActivityListInput{DocumentID: documentID})
	if err != nil {
		t.Fatalf("ListDocumentActivities: %v", err)
	}
	if len(activities.Items) == 0 {
		t.Fatal("expected the run's events in the activity stream")
	}
	for i := 1; i < len(activities.Items); i++ {
		if activities.Items[i-1].Ordinal > activities.Items[i].Ordinal {
			t.Fatalf("activities out of order at %d: %d after %d",
				i, activities.Items[i].Ordinal, activities.Items[i-1].Ordinal)
		}
	}

	if _, err := app.ListDocumentActivities(types.DocumentActivityListInput{}); err == nil {
		t.Error("expected an error when no document id is given")
	}
	if _, err := app.ListDocumentRuns(""); err == nil {
		t.Error("expected an error when no document id is given")
	}
}

// Every one of these refuses rather than returning an empty page when the store
// is not there: an empty file list and an unavailable store look identical in
// the UI otherwise.
func TestDocumentMethodsRefuseWithoutAStore(t *testing.T) {
	app := &App{}
	if _, err := app.ListDocuments(types.DocumentListInput{}); err == nil {
		t.Error("ListDocuments should refuse without a store")
	}
	if _, err := app.GetDocument("document:any"); err == nil {
		t.Error("GetDocument should refuse without a store")
	}
	if _, err := app.ListDocumentRuns("document:any"); err == nil {
		t.Error("ListDocumentRuns should refuse without a store")
	}
	if _, err := app.ListDocumentActivities(types.DocumentActivityListInput{DocumentID: "document:any"}); err == nil {
		t.Error("ListDocumentActivities should refuse without a store")
	}
}
