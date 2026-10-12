package localstore

import (
	"context"
	"officedex/internal/types"
	"testing"
)

func TestProposalNeverBecomesDeliveredArtifact(t *testing.T) {
	s := newTempStore(t)
	ctx := context.Background()
	path := "/external/.officedex-proposal-123/a.modified.docx"
	if err := s.RecordArtifact(types.Artifact{TaskID: "edit", FilePath: path, FileName: "a.modified.docx", DocumentType: "docx"}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertRecentFile(ctx, types.RecentFile{FilePath: path, FileName: "a.modified.docx", DocumentType: "docx", Source: "generated"}); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM artifacts`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("proposal persisted: %d %v", count, err)
	}
	files, err := s.QueryRecentFiles(ctx, "", 1)
	if err != nil || len(files) != 0 {
		t.Fatalf("recent: %v %v", files, err)
	}
}

func TestLegacyProposalRowsHiddenBeforePaginationAcrossRestart(t *testing.T) {
	s := newTempStore(t)
	ctx := context.Background()
	for _, path := range []string{"/external/source.docx", "/external/user.modified.docx", "/external/.officedex-proposal-123/staged.docx", `/C:\external\.officedex-proposal-456\staged.docx`} {
		if _, err := s.RegisterLocalDocument(ctx, path, "test.docx", "docx", ""); err != nil {
			t.Fatal(err)
		}
		if _, err := s.db.Exec(`INSERT INTO recent_files(file_path,file_name,document_type,source,workspace_id,task_id,conversation_id,last_opened_at) VALUES (?,'test.docx','docx','local','','','','2026-10-12T00:00:00Z')`, path); err != nil {
			t.Fatal(err)
		}
	}
	for _, restart := range []bool{false, true} {
		if restart {
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			if err := s.Open(ctx); err != nil {
				t.Fatal(err)
			}
		}
		cursor := ""
		seen := 0
		for {
			page, err := s.QueryDocuments(ctx, types.DocumentListInput{Limit: 1, Cursor: cursor})
			if err != nil {
				t.Fatal(err)
			}
			for _, doc := range page.Items {
				if types.IsInternalProposal(doc.FilePath) {
					t.Fatalf("leaked: %s", doc.FilePath)
				}
				seen++
			}
			if page.NextCursor == "" {
				break
			}
			cursor = page.NextCursor
		}
		if seen != 2 {
			t.Fatalf("public document count %d", seen)
		}
		recent, err := s.QueryRecentFiles(ctx, "", 2)
		if err != nil || len(recent) != 2 {
			t.Fatalf("recent: %v %v", recent, err)
		}
		for _, file := range recent {
			if types.IsInternalProposal(file.FilePath) {
				t.Fatal("legacy proposal in recent")
			}
		}
	}
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM documents`).Scan(&count); err != nil || count != 4 {
		t.Fatalf("historical records deleted: %d %v", count, err)
	}
}
