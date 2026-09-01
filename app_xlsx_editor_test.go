package main

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"officedex/internal/preview"
	"officedex/internal/types"
	"officedex/internal/xlsxeditor"
)

type fakeXlsxEditorService struct {
	prepareToken  string
	prepareResult xlsxeditor.PrepareResult
	prepareErr    error

	saveToken         string
	saveSession       string
	saveContent       string
	saveManagedSheets []xlsxeditor.ManagedSheet
	saveResult        xlsxeditor.SaveResult
	saveErr           error

	stageResult       xlsxeditor.StageImageResult
	stageErr          error
	stageToken        string
	stageSession      string
	stageData         []byte
	stageMime         string
	stageSheet        string
	stageRow          int
	stageColumn       int
	stageStatusColumn int

	closeToken   string
	closeSession string
	closeErr     error

	closeByToken string
	closeByErr   error
	onCloseBy    func(string)

	closeAllCalls int
	closeAllErr   error
	cleanupCalls  int
	cleanupErr    error
}

func (s *fakeXlsxEditorService) Prepare(_ context.Context, token string) (xlsxeditor.PrepareResult, error) {
	s.prepareToken = token
	return s.prepareResult, s.prepareErr
}

func (s *fakeXlsxEditorService) Save(_ context.Context, token, sessionID, content string, managedSheets []xlsxeditor.ManagedSheet) (xlsxeditor.SaveResult, error) {
	s.saveToken, s.saveSession, s.saveContent = token, sessionID, content
	s.saveManagedSheets = managedSheets
	return s.saveResult, s.saveErr
}

func (s *fakeXlsxEditorService) StageImage(token, session string, data []byte, mime, sheet string, row, column, statusColumn int) (xlsxeditor.StageImageResult, error) {
	s.stageToken, s.stageSession = token, session
	s.stageData, s.stageMime, s.stageSheet = data, mime, sheet
	s.stageRow, s.stageColumn, s.stageStatusColumn = row, column, statusColumn
	return s.stageResult, s.stageErr
}

func (s *fakeXlsxEditorService) Close(token, sessionID string) error {
	s.closeToken, s.closeSession = token, sessionID
	return s.closeErr
}

func (s *fakeXlsxEditorService) CloseByToken(token string) error {
	s.closeByToken = token
	if s.onCloseBy != nil {
		s.onCloseBy(token)
	}
	return s.closeByErr
}

func (s *fakeXlsxEditorService) CloseAll() error {
	s.closeAllCalls++
	return s.closeAllErr
}

func (s *fakeXlsxEditorService) CleanupStale() error {
	s.cleanupCalls++
	return s.cleanupErr
}

func TestPrepareXlsxEditorDelegatesOpaqueToken(t *testing.T) {
	service := &fakeXlsxEditorService{prepareResult: xlsxeditor.PrepareResult{SessionID: "session-1", ModocContent: "modoc"}}
	app := &App{ctx: context.Background(), xlsxEditorService: service}

	result, err := app.PrepareXlsxEditor("opaque-preview-token")
	if err != nil {
		t.Fatalf("PrepareXlsxEditor() error = %v", err)
	}
	if service.prepareToken != "opaque-preview-token" || !reflect.DeepEqual(result, service.prepareResult) {
		t.Fatalf("delegation token/result = %q/%+v", service.prepareToken, result)
	}
}

func TestSaveXlsxEditorDelegatesSessionAndContent(t *testing.T) {
	service := &fakeXlsxEditorService{saveResult: xlsxeditor.SaveResult{FilePath: "/tmp/workbook.xlsx"}}
	app := &App{ctx: context.Background(), xlsxEditorService: service}
	input := SaveXlsxEditorInput{PreviewToken: "token", SessionID: "session", ModocContent: "modoc-content"}

	result, err := app.SaveXlsxEditor(input)
	if err != nil {
		t.Fatalf("SaveXlsxEditor() error = %v", err)
	}
	if service.saveToken != input.PreviewToken || service.saveSession != input.SessionID || service.saveContent != input.ModocContent {
		t.Fatalf("Save delegation = %q/%q/%q", service.saveToken, service.saveSession, service.saveContent)
	}
	if result != service.saveResult {
		t.Fatalf("SaveXlsxEditor() = %+v, want %+v", result, service.saveResult)
	}
}

func TestStageXlsxEditorImageDecodesRendererBytes(t *testing.T) {
	service := &fakeXlsxEditorService{stageResult: xlsxeditor.StageImageResult{URL: "modoc-assets:/media/clipboard.png"}}
	app := &App{xlsxEditorService: service}
	input := StageXlsxEditorImageInput{PreviewToken: "token", SessionID: "session", DataBase64: base64.StdEncoding.EncodeToString([]byte("png-bytes")), Mime: "image/png", SheetName: "Catalog", Row: 4, Column: 6, StatusColumn: 9}
	result, err := app.StageXlsxEditorImage(input)
	if err != nil {
		t.Fatalf("StageXlsxEditorImage() error = %v", err)
	}
	if result != service.stageResult || service.stageToken != input.PreviewToken || service.stageSession != input.SessionID || string(service.stageData) != "png-bytes" || service.stageMime != input.Mime || service.stageSheet != input.SheetName || service.stageRow != input.Row || service.stageColumn != input.Column || service.stageStatusColumn != input.StatusColumn {
		t.Fatalf("staged image delegation = %+v token=%q session=%q mime=%q sheet=%q row=%d column=%d status=%d", result, service.stageToken, service.stageSession, service.stageMime, service.stageSheet, service.stageRow, service.stageColumn, service.stageStatusColumn)
	}
}

func TestStageXlsxEditorImageRejectsInvalidBase64(t *testing.T) {
	service := &fakeXlsxEditorService{}
	app := &App{xlsxEditorService: service}
	_, err := app.StageXlsxEditorImage(StageXlsxEditorImageInput{PreviewToken: "token", SessionID: "session", DataBase64: "not-base64!", Mime: "image/png", SheetName: "Catalog"})
	if err == nil || service.stageToken != "" {
		t.Fatalf("StageXlsxEditorImage() error=%v, delegation token=%q", err, service.stageToken)
	}
}

func TestCloseXlsxEditorClosesBoundSession(t *testing.T) {
	service := &fakeXlsxEditorService{}
	app := &App{xlsxEditorService: service}
	input := CloseXlsxEditorInput{PreviewToken: "token", SessionID: "session"}

	if err := app.CloseXlsxEditor(input); err != nil {
		t.Fatalf("CloseXlsxEditor() error = %v", err)
	}
	if service.closeToken != input.PreviewToken || service.closeSession != input.SessionID {
		t.Fatalf("Close delegation = %q/%q", service.closeToken, service.closeSession)
	}
}

func TestRevokePreviewTokenAlsoClosesXlsxSessions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "workbook.xlsx")
	writeFileForAppTest(t, path, []byte("xlsx"))
	registry, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{dir}})
	if err != nil {
		t.Fatal(err)
	}
	artifact := types.Artifact{FilePath: path, FileName: "workbook.xlsx", DocumentType: "xlsx"}
	if err := registry.AllowArtifact(artifact); err != nil {
		t.Fatal(err)
	}
	grant, err := registry.IssueToken(artifact)
	if err != nil {
		t.Fatal(err)
	}
	service := &fakeXlsxEditorService{}
	service.onCloseBy = func(token string) {
		if _, err := registry.ResolveToken(token); err != nil {
			t.Fatalf("token was revoked before XLSX sessions closed: %v", err)
		}
	}
	app := &App{previewReg: registry, xlsxEditorService: service}

	app.RevokePreviewToken(grant.Token)
	if service.closeByToken != grant.Token {
		t.Fatalf("CloseByToken token = %q, want %q", service.closeByToken, grant.Token)
	}
	if _, err := registry.ResolveToken(grant.Token); err == nil {
		t.Fatal("preview token remains valid after revoke")
	}
}

func TestShutdownClosesAllXlsxSessions(t *testing.T) {
	service := &fakeXlsxEditorService{}
	app := &App{xlsxEditorService: service}

	app.shutdown(nil)
	if service.closeAllCalls != 1 {
		t.Fatalf("CloseAll calls = %d, want 1", service.closeAllCalls)
	}
}

func TestXlsxEditorBindingsReturnConfigurationError(t *testing.T) {
	app := &App{}
	if _, err := app.PrepareXlsxEditor("token"); !errors.Is(err, errXlsxEditorUnavailable) {
		t.Fatalf("PrepareXlsxEditor() error = %v, want unavailable", err)
	}
	if _, err := app.SaveXlsxEditor(SaveXlsxEditorInput{}); !errors.Is(err, errXlsxEditorUnavailable) {
		t.Fatalf("SaveXlsxEditor() error = %v, want unavailable", err)
	}
	if err := app.CloseXlsxEditor(CloseXlsxEditorInput{}); !errors.Is(err, errXlsxEditorUnavailable) {
		t.Fatalf("CloseXlsxEditor() error = %v, want unavailable", err)
	}
}

func writeFileForAppTest(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
}
