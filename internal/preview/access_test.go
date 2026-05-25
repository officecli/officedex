package preview

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/types"
)

func writeFile(t *testing.T, dir, name string) string {
	t.Helper()
	full := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	canon, err := filepath.EvalSymlinks(full)
	if err != nil {
		t.Fatalf("evalsymlinks: %v", err)
	}
	return canon
}

func canonRoot(t *testing.T, dir string) string {
	t.Helper()
	canon, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatalf("evalsymlinks root: %v", err)
	}
	return canon
}

func TestNewRejectsEmptyTrustedRoots(t *testing.T) {
	if _, err := New(RegistryOptions{}); err == nil {
		t.Fatal("expected error for empty trusted roots")
	}
}

func TestAllowIssueResolveRoundTrip(t *testing.T) {
	dir := t.TempDir()
	root := canonRoot(t, dir)
	path := writeFile(t, dir, "deck.pptx")

	reg, err := New(RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	artifact := types.Artifact{FilePath: path, FileName: "deck.pptx"}
	if err := reg.AllowArtifact(artifact); err != nil {
		t.Fatalf("AllowArtifact: %v", err)
	}
	grant, err := reg.IssueToken(artifact)
	if err != nil {
		t.Fatalf("IssueToken: %v", err)
	}
	if grant.Token == "" {
		t.Errorf("Token should be non-empty")
	}
	if grant.FileName != "deck.pptx" {
		t.Errorf("FileName = %q, want deck.pptx", grant.FileName)
	}
	if grant.DocumentType != "pptx" {
		t.Errorf("DocumentType = %q, want pptx", grant.DocumentType)
	}

	entry, err := reg.ResolveToken(grant.Token)
	if err != nil {
		t.Fatalf("ResolveToken: %v", err)
	}
	if entry.FilePath != path {
		t.Errorf("entry.FilePath = %q, want %q", entry.FilePath, path)
	}
	if entry.FileName != "deck.pptx" {
		t.Errorf("entry.FileName = %q, want deck.pptx", entry.FileName)
	}
	if entry.DocumentType != "pptx" {
		t.Errorf("entry.DocumentType = %q, want pptx", entry.DocumentType)
	}
}

func TestIssueTokenRequiresPriorAllow(t *testing.T) {
	dir := t.TempDir()
	root := canonRoot(t, dir)
	path := writeFile(t, dir, "doc.docx")

	reg, err := New(RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	_, err = reg.IssueToken(types.Artifact{FilePath: path})
	if err == nil || !strings.Contains(err.Error(), "not registered") {
		t.Fatalf("expected not-registered error, got %v", err)
	}
}

func TestRejectsPathOutsideTrustedRoots(t *testing.T) {
	dir := t.TempDir()
	root := canonRoot(t, dir)
	other := t.TempDir()
	outside := writeFile(t, other, "stray.pdf")

	reg, err := New(RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	err = reg.AllowArtifact(types.Artifact{FilePath: outside})
	if err == nil || !strings.Contains(err.Error(), "outside trusted") {
		t.Fatalf("expected outside-trusted error, got %v", err)
	}
}

func TestRejectsUnsupportedExtension(t *testing.T) {
	dir := t.TempDir()
	root := canonRoot(t, dir)
	path := writeFile(t, dir, "secrets.exe")

	reg, err := New(RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	err = reg.AllowArtifact(types.Artifact{FilePath: path})
	if err == nil || !strings.Contains(err.Error(), "unsupported preview file type") {
		t.Fatalf("expected unsupported-type error, got %v", err)
	}
}

func TestRejectsRelativePath(t *testing.T) {
	dir := t.TempDir()
	root := canonRoot(t, dir)
	reg, err := New(RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	err = reg.AllowArtifact(types.Artifact{FilePath: "relative/path.pdf"})
	if err == nil || !strings.Contains(err.Error(), "must be absolute") {
		t.Fatalf("expected absolute-path error, got %v", err)
	}
}

func TestRejectsNulByte(t *testing.T) {
	dir := t.TempDir()
	root := canonRoot(t, dir)
	reg, err := New(RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	err = reg.AllowArtifact(types.Artifact{FilePath: "/tmp/foo\x00.pdf"})
	if err == nil || !strings.Contains(err.Error(), "invalid preview file path") {
		t.Fatalf("expected invalid-path error, got %v", err)
	}
}

func TestRevokeTokenInvalidatesResolve(t *testing.T) {
	dir := t.TempDir()
	root := canonRoot(t, dir)
	path := writeFile(t, dir, "sheet.xlsx")

	reg, err := New(RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	artifact := types.Artifact{FilePath: path}
	if err := reg.AllowArtifact(artifact); err != nil {
		t.Fatalf("AllowArtifact: %v", err)
	}
	grant, err := reg.IssueToken(artifact)
	if err != nil {
		t.Fatalf("IssueToken: %v", err)
	}
	reg.RevokeToken(grant.Token)
	if _, err := reg.ResolveToken(grant.Token); err == nil || !strings.Contains(err.Error(), "invalid preview token") {
		t.Fatalf("expected invalid-token error after revoke, got %v", err)
	}
}

func TestCustomCreateTokenInjection(t *testing.T) {
	dir := t.TempDir()
	root := canonRoot(t, dir)
	path := writeFile(t, dir, "image.png")

	var calls int
	reg, err := New(RegistryOptions{
		TrustedRoots: []string{root},
		CreateToken: func() string {
			calls++
			return "deterministic-token"
		},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	artifact := types.Artifact{FilePath: path}
	if err := reg.AllowArtifact(artifact); err != nil {
		t.Fatalf("AllowArtifact: %v", err)
	}
	grant, err := reg.IssueToken(artifact)
	if err != nil {
		t.Fatalf("IssueToken: %v", err)
	}
	if grant.Token != "deterministic-token" {
		t.Errorf("Token = %q, want deterministic-token", grant.Token)
	}
	if calls != 1 {
		t.Errorf("createToken calls = %d, want 1", calls)
	}
}

func TestEvalSymlinksResolvesCanonicalPath(t *testing.T) {
	dir := t.TempDir()
	root := canonRoot(t, dir)
	target := writeFile(t, dir, "real/deck.pptx")

	linkDir := filepath.Join(dir, "link-dir")
	if err := os.Symlink(filepath.Join(dir, "real"), linkDir); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}
	viaSymlink := filepath.Join(linkDir, "deck.pptx")

	reg, err := New(RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := reg.AllowArtifact(types.Artifact{FilePath: target}); err != nil {
		t.Fatalf("AllowArtifact target: %v", err)
	}
	grant, err := reg.IssueToken(types.Artifact{FilePath: viaSymlink})
	if err != nil {
		t.Fatalf("IssueToken via symlink: %v", err)
	}
	entry, err := reg.ResolveToken(grant.Token)
	if err != nil {
		t.Fatalf("ResolveToken: %v", err)
	}
	if entry.FilePath != target {
		t.Errorf("entry.FilePath = %q, want canonical %q", entry.FilePath, target)
	}
}

func TestExtensionLowercased(t *testing.T) {
	dir := t.TempDir()
	root := canonRoot(t, dir)
	path := writeFile(t, dir, "Mixed.PPTX")

	reg, err := New(RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := reg.AllowArtifact(types.Artifact{FilePath: path}); err != nil {
		t.Fatalf("AllowArtifact: %v", err)
	}
	grant, err := reg.IssueToken(types.Artifact{FilePath: path})
	if err != nil {
		t.Fatalf("IssueToken: %v", err)
	}
	if grant.DocumentType != "pptx" {
		t.Errorf("DocumentType = %q, want lowercase pptx", grant.DocumentType)
	}
}
