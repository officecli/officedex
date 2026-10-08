package main

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"officedex/internal/types"
)

// ─── Document projection ────────────────────────────────────────────────────
//
// The Document/Run/Activity projection (schemaV7) has been maintained on every
// write since it landed, with its own tests, and until now nothing could read
// it: there was no RPC. These four methods are that missing half. They forward
// to localstore and hold no logic of their own — the projection is built where
// the writes happen, not here.
//
// This is what the new UI's file list reads. `files.list` in the UiPort
// contract is `ListDocuments`; a run that produced a file is that file's row,
// which is exactly what the projection already expresses.

// documentStoreContext returns the context the store calls should use, opening
// the store if it has not been opened yet.
func (a *App) documentStoreContext() (context.Context, error) {
	if a.localStore == nil {
		return nil, errors.New("document store is unavailable")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	if err := a.ensureLocalStoreOpen(ctx); err != nil {
		return nil, err
	}
	return ctx, nil
}

// ListDocuments returns one page of documents, newest first.
//
// An empty WorkspaceID means every workspace rather than "the ones filed
// nowhere": the caller filters, this does not guess.
func (a *App) ListDocuments(input types.DocumentListInput) (types.DocumentPage, error) {
	ctx, err := a.documentStoreContext()
	if err != nil {
		return types.DocumentPage{}, err
	}
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.Cursor = strings.TrimSpace(input.Cursor)
	return a.localStore.QueryDocuments(ctx, input)
}

// GetDocument returns one document. A missing id is an error rather than a
// zero value: every caller of this would have had to check anyway, and a blank
// record flowing into the UI is harder to trace than a refusal here.
func (a *App) GetDocument(documentID string) (types.DocumentRecord, error) {
	ctx, err := a.documentStoreContext()
	if err != nil {
		return types.DocumentRecord{}, err
	}
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return types.DocumentRecord{}, errors.New("document id is required")
	}
	record, found, err := a.localStore.GetDocument(ctx, documentID)
	if err != nil {
		return types.DocumentRecord{}, err
	}
	if !found {
		return types.DocumentRecord{}, fmt.Errorf("document not found: %s", documentID)
	}
	return record, nil
}

// ListDocumentRuns returns every run that produced or edited this document,
// newest first. A document usually has several: the run that created it, then
// one per follow-up edit.
func (a *App) ListDocumentRuns(documentID string) ([]types.RunRecord, error) {
	ctx, err := a.documentStoreContext()
	if err != nil {
		return nil, err
	}
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return nil, errors.New("document id is required")
	}
	runs, err := a.localStore.QueryDocumentRuns(ctx, documentID)
	if err != nil {
		return nil, err
	}
	if runs == nil {
		runs = []types.RunRecord{}
	}
	return runs, nil
}

// ListDocumentActivities returns one page of the document's activity stream —
// the events of every run against it, in order.
func (a *App) ListDocumentActivities(input types.DocumentActivityListInput) (types.ActivityPage, error) {
	ctx, err := a.documentStoreContext()
	if err != nil {
		return types.ActivityPage{}, err
	}
	input.DocumentID = strings.TrimSpace(input.DocumentID)
	input.Cursor = strings.TrimSpace(input.Cursor)
	if input.DocumentID == "" {
		return types.ActivityPage{}, errors.New("document id is required")
	}
	return a.localStore.QueryDocumentActivities(ctx, input)
}

// SetDocumentPinned pins or unpins a document. Pinning is a filter on the one
// file list rather than a move to some other location, so nothing about the
// document changes except this flag.
func (a *App) SetDocumentPinned(documentID string, pinned bool) error {
	ctx, err := a.documentStoreContext()
	if err != nil {
		return err
	}
	return a.localStore.SetDocumentPinned(ctx, documentID, pinned)
}

// RemoveDocument unregisters one document from the library, by document id.
// Files on disk are never touched: this forgets the row, which is all the
// sidebar's Remove ever promised.
//
// Which removal it is depends on what is behind the row, and the caller cannot
// be expected to know. A generated document is keyed on the task that produced
// it, so it goes through DeleteDocument — that path settles the lineage first,
// cancelling a run still in flight, which the store requires before it will
// delete. A file opened from disk has no task at all and is removed by id.
//
// This exists because the UI had no way to do either. `files.remove` in the
// UiPort could only forget a recent-files entry, while the file list reads the
// document projection, so the row came straight back on the next reload and the
// menu item looked dead.
func (a *App) RemoveDocument(documentID string) error {
	ctx, err := a.documentStoreContext()
	if err != nil {
		return err
	}
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return errors.New("document id is required")
	}
	record, found, err := a.localStore.GetDocument(ctx, documentID)
	if err != nil {
		return err
	}
	// Already gone. Removing a row twice is the user pressing a menu item twice,
	// not a failure worth an error banner.
	if !found {
		return nil
	}
	if taskID := strings.TrimSpace(record.CurrentArtifactTaskID); taskID != "" {
		return a.DeleteDocument(taskID)
	}
	return a.localStore.RemoveDocumentByID(ctx, documentID)
}
