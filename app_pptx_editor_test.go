package main

import (
	"context"
	"encoding/base64"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/pptxeditor"
	"officedex/internal/preview"
	"officedex/internal/types"
)

// fakePptxEditorService records what the Wails bindings hand to the service
// layer, so the tests pin the decoding and argument plumbing the renderer
// depends on. The service itself is covered in internal/pptxeditor.
type fakePptxEditorService struct {
	prepareToken  string
	prepareResult pptxeditor.PrepareResult
	prepareErr    error

	snapshotToken   string
	snapshotSession string
	snapshotContent []byte
	snapshotBase    int
	snapshotRev     int
	snapshotResult  pptxeditor.SaveResult

	assetToken   string
	assetSession string
	assetPath    string
	assetType    string
	assetData    []byte
	assetResult  pptxeditor.SaveAssetResult

	exportToken   string
	exportSession string
	exportRev     int
	exportResult  pptxeditor.SaveResult

	closeToken   string
	closeSession string
	closeErr     error

	closedByToken []string
	closedByFile  []string
	closeAllCalls int
	cleanupCalls  int
}

func (s *fakePptxEditorService) Prepare(_ context.Context, token string) (pptxeditor.PrepareResult, error) {
	s.prepareToken = token
	return s.prepareResult, s.prepareErr
}

func (s *fakePptxEditorService) SaveSnapshot(token, session string, content []byte, base, rev int) (pptxeditor.SaveResult, error) {
	s.snapshotToken, s.snapshotSession, s.snapshotContent, s.snapshotBase, s.snapshotRev = token, session, content, base, rev
	return s.snapshotResult, nil
}

func (s *fakePptxEditorService) SaveAsset(token, session, relativePath, contentType string, data []byte) (pptxeditor.SaveAssetResult, error) {
	s.assetToken, s.assetSession, s.assetPath, s.assetType, s.assetData = token, session, relativePath, contentType, data
	return s.assetResult, nil
}

func (s *fakePptxEditorService) Export(_ context.Context, token, session string, rev int) (pptxeditor.SaveResult, error) {
	s.exportToken, s.exportSession, s.exportRev = token, session, rev
	return s.exportResult, nil
}

func (s *fakePptxEditorService) Close(token, session string) error {
	s.closeToken, s.closeSession = token, session
	return s.closeErr
}

func (s *fakePptxEditorService) CloseByToken(token string) error {
	s.closedByToken = append(s.closedByToken, token)
	return nil
}

func (s *fakePptxEditorService) CloseByFile(path string) error {
	s.closedByFile = append(s.closedByFile, path)
	return nil
}

func (s *fakePptxEditorService) CloseAll() error     { s.closeAllCalls++; return nil }
func (s *fakePptxEditorService) CleanupStale() error { s.cleanupCalls++; return nil }

func TestPreparePptxEditorDelegatesTokenAndReturnsDeck(t *testing.T) {
	service := &fakePptxEditorService{prepareResult: pptxeditor.PrepareResult{SessionID: "session-1", Title: "Deck", Content: []byte("mop"), DocumentRevision: 3}}
	app := &App{pptxEditorService: service}

	got, err := app.PreparePptxEditor("token-1")
	if err != nil {
		t.Fatalf("PreparePptxEditor: %v", err)
	}
	if service.prepareToken != "token-1" {
		t.Fatalf("prepare token = %q, want the renderer's opaque token", service.prepareToken)
	}
	if got.SessionID != "session-1" || got.DocumentRevision != 3 || string(got.Content) != "mop" {
		t.Fatalf("PreparePptxEditor returned %+v, want the service result untouched", got)
	}
}

func TestPreparePptxEditorSurfacesServiceErrors(t *testing.T) {
	service := &fakePptxEditorService{prepareErr: errors.New("token expired")}
	app := &App{pptxEditorService: service}
	if _, err := app.PreparePptxEditor("token-1"); err == nil || !strings.Contains(err.Error(), "token expired") {
		t.Fatalf("PreparePptxEditor error = %v, want the service error", err)
	}
}

func TestSavePptxEditorSnapshotDecodesBase64AndPassesRevisions(t *testing.T) {
	service := &fakePptxEditorService{snapshotResult: pptxeditor.SaveResult{FilePath: "/tmp/deck.pptx", Revision: 5}}
	app := &App{pptxEditorService: service}

	got, err := app.SavePptxEditorSnapshot(SavePptxEditorSnapshotInput{
		PreviewToken:  "token-1",
		SessionID:     "session-1",
		ContentBase64: base64.StdEncoding.EncodeToString([]byte(`{"slides":[]}`)),
		BaseRevision:  4,
		Revision:      5,
	})
	if err != nil {
		t.Fatalf("SavePptxEditorSnapshot: %v", err)
	}
	if string(service.snapshotContent) != `{"slides":[]}` {
		t.Fatalf("snapshot content = %q, want the decoded bytes", service.snapshotContent)
	}
	if service.snapshotToken != "token-1" || service.snapshotSession != "session-1" || service.snapshotBase != 4 || service.snapshotRev != 5 {
		t.Fatalf("snapshot args = %q/%q/%d/%d", service.snapshotToken, service.snapshotSession, service.snapshotBase, service.snapshotRev)
	}
	if got.Revision != 5 {
		t.Fatalf("revision = %d, want 5", got.Revision)
	}
}

func TestSavePptxEditorSnapshotRejectsInvalidBase64(t *testing.T) {
	service := &fakePptxEditorService{}
	app := &App{pptxEditorService: service}
	if _, err := app.SavePptxEditorSnapshot(SavePptxEditorSnapshotInput{PreviewToken: "t", SessionID: "s", ContentBase64: "%%not-base64%%"}); err == nil {
		t.Fatal("SavePptxEditorSnapshot accepted invalid base64")
	}
	if service.snapshotToken != "" {
		t.Fatal("invalid payload must not reach the service")
	}
}

func TestSavePptxEditorAssetDecodesBytesAndKeepsMetadata(t *testing.T) {
	service := &fakePptxEditorService{assetResult: pptxeditor.SaveAssetResult{ResourceURI: "mop-assets:/media/a.png", Digest: "abc", ResourceSize: 3, ContentType: "image/png", Extension: ".png"}}
	app := &App{pptxEditorService: service}

	got, err := app.SavePptxEditorAsset(SavePptxEditorAssetInput{
		PreviewToken: "token-1",
		SessionID:    "session-1",
		RelativePath: "media/a.png",
		ContentType:  "image/png",
		DataBase64:   base64.StdEncoding.EncodeToString([]byte{1, 2, 3}),
	})
	if err != nil {
		t.Fatalf("SavePptxEditorAsset: %v", err)
	}
	if string(service.assetData) != string([]byte{1, 2, 3}) || service.assetPath != "media/a.png" || service.assetType != "image/png" {
		t.Fatalf("asset args = %v/%q/%q", service.assetData, service.assetPath, service.assetType)
	}
	if got.ResourceURI != "mop-assets:/media/a.png" || got.ResourceSize != 3 {
		t.Fatalf("SavePptxEditorAsset returned %+v", got)
	}
}

func TestSavePptxEditorAssetRejectsInvalidBase64(t *testing.T) {
	service := &fakePptxEditorService{}
	app := &App{pptxEditorService: service}
	if _, err := app.SavePptxEditorAsset(SavePptxEditorAssetInput{PreviewToken: "t", SessionID: "s", RelativePath: "media/a.png", DataBase64: "***"}); err == nil {
		t.Fatal("SavePptxEditorAsset accepted invalid base64")
	}
	if service.assetToken != "" {
		t.Fatal("invalid payload must not reach the service")
	}
}

func TestExportAndClosePptxEditorDelegateSession(t *testing.T) {
	service := &fakePptxEditorService{exportResult: pptxeditor.SaveResult{FilePath: "/tmp/deck.pptx", Revision: 7}}
	app := &App{pptxEditorService: service}

	got, err := app.ExportPptxEditor(ExportPptxEditorInput{PreviewToken: "token-1", SessionID: "session-1", Revision: 7})
	if err != nil {
		t.Fatalf("ExportPptxEditor: %v", err)
	}
	if service.exportToken != "token-1" || service.exportSession != "session-1" || service.exportRev != 7 || got.FilePath != "/tmp/deck.pptx" {
		t.Fatalf("export args = %q/%q/%d -> %+v", service.exportToken, service.exportSession, service.exportRev, got)
	}
	if err := app.ClosePptxEditor(ClosePptxEditorInput{PreviewToken: "token-1", SessionID: "session-1"}); err != nil {
		t.Fatalf("ClosePptxEditor: %v", err)
	}
	if service.closeToken != "token-1" || service.closeSession != "session-1" {
		t.Fatalf("close args = %q/%q", service.closeToken, service.closeSession)
	}
}

func TestPptxEditorBindingsReportUnavailableServiceConsistently(t *testing.T) {
	app := &App{}
	if _, err := app.PreparePptxEditor("t"); !errors.Is(err, errPptxEditorUnavailable) {
		t.Fatalf("PreparePptxEditor error = %v", err)
	}
	if _, err := app.SavePptxEditorSnapshot(SavePptxEditorSnapshotInput{}); !errors.Is(err, errPptxEditorUnavailable) {
		t.Fatalf("SavePptxEditorSnapshot error = %v", err)
	}
	if _, err := app.SavePptxEditorAsset(SavePptxEditorAssetInput{}); !errors.Is(err, errPptxEditorUnavailable) {
		t.Fatalf("SavePptxEditorAsset error = %v", err)
	}
	if _, err := app.ExportPptxEditor(ExportPptxEditorInput{}); !errors.Is(err, errPptxEditorUnavailable) {
		t.Fatalf("ExportPptxEditor error = %v", err)
	}
	if err := app.ClosePptxEditor(ClosePptxEditorInput{}); !errors.Is(err, errPptxEditorUnavailable) {
		t.Fatalf("ClosePptxEditor error = %v", err)
	}
}

// Revoking a preview token must close the PPTX sessions bound to it before the
// token disappears, exactly as it does for XLSX; otherwise the editor session
// outlives the grant that authorised it.
func TestRevokePreviewTokenAlsoClosesPptxSessions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "deck.pptx")
	writeFileForAppTest(t, path, []byte("pptx"))
	registry, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{dir}})
	if err != nil {
		t.Fatal(err)
	}
	artifact := types.Artifact{FilePath: path, FileName: "deck.pptx", DocumentType: "pptx"}
	if err := registry.AllowArtifact(artifact); err != nil {
		t.Fatal(err)
	}
	grant, err := registry.IssueToken(artifact)
	if err != nil {
		t.Fatal(err)
	}
	service := &fakePptxEditorService{}
	app := &App{previewReg: registry, pptxEditorService: service}

	app.RevokePreviewToken(grant.Token)
	if len(service.closedByToken) != 1 || service.closedByToken[0] != grant.Token {
		t.Fatalf("CloseByToken calls = %v, want exactly %q", service.closedByToken, grant.Token)
	}
	if _, err := registry.ResolveToken(grant.Token); err == nil {
		t.Fatal("preview token remains valid after revoke")
	}
}

func TestShutdownClosesAllPptxSessions(t *testing.T) {
	service := &fakePptxEditorService{}
	app := &App{pptxEditorService: service}

	app.shutdown(nil)
	if service.closeAllCalls != 1 {
		t.Fatalf("CloseAll calls = %d, want 1", service.closeAllCalls)
	}
}
