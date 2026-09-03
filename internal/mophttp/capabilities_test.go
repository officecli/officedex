package mophttp

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestDefaultCapabilitiesMatchBundledWasm guards the one constant pair that
// cannot fail loudly: if mop-wasm is rebuilt with a new schema version and
// these constants are not updated, every presentation opens to a "MOP schema
// mismatch" error from assertPackageCapabilities, with nothing in the Go layer
// to indicate why. Running the real engine is the only way to know the truth.
func TestDefaultCapabilitiesMatchBundledWasm(t *testing.T) {
	presentationRoot := locatePresentationRoot(t)
	if presentationRoot == "" {
		t.Skip("no presentation checkout with a built mop-wasm is available")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is not available to run the MOP engine")
	}

	scriptDirectory := t.TempDir()
	scriptPath := filepath.Join(scriptDirectory, "capabilities.mjs")
	packageDirectory := filepath.Join(presentationRoot, "bos", "dist", "mop-wasm", "pkg")
	script := `
import { readFileSync } from "node:fs";
import { initSync, MopEngine } from ` + jsStringLiteral(filepath.Join(packageDirectory, "mop_wasm.js")) + `;
initSync({ module: readFileSync(` + jsStringLiteral(filepath.Join(packageDirectory, "mop_wasm_bg.wasm")) + `) });
const engine = new MopEngine();
try {
  process.stdout.write(JSON.stringify({
    protocolVersion: engine.capabilities.protocolVersion,
    schemaVersion: engine.capabilities.schemaVersion,
  }));
} finally {
  engine.free();
}
`
	if err := os.WriteFile(scriptPath, []byte(script), 0o644); err != nil {
		t.Fatalf("write capability probe: %v", err)
	}

	output, err := exec.Command(node, scriptPath).Output()
	if err != nil {
		t.Skipf("could not run the MOP engine: %v", err)
	}
	var capabilities struct {
		ProtocolVersion int `json:"protocolVersion"`
		SchemaVersion   int `json:"schemaVersion"`
	}
	if err := json.Unmarshal(output, &capabilities); err != nil {
		t.Fatalf("decode capabilities %q: %v", output, err)
	}

	if capabilities.ProtocolVersion != DefaultProtocolVersion {
		t.Errorf("DefaultProtocolVersion = %d, but the bundled runtime reports %d; update the constant",
			DefaultProtocolVersion, capabilities.ProtocolVersion)
	}
	if capabilities.SchemaVersion != DefaultSchemaVersion {
		t.Errorf("DefaultSchemaVersion = %d, but the bundled runtime reports %d; update the constant",
			DefaultSchemaVersion, capabilities.SchemaVersion)
	}
}

// locatePresentationRoot mirrors the app's own runtime discovery closely enough
// to find a checkout in development, and returns "" when none is present.
func locatePresentationRoot(t *testing.T) string {
	t.Helper()
	candidates := []string{}
	if configured := strings.TrimSpace(os.Getenv("PRESENTATION_SOURCE_DIR")); configured != "" {
		candidates = append(candidates, configured)
	}
	if workingDirectory, err := os.Getwd(); err == nil {
		// internal/mophttp -> officedex -> workspace root.
		candidates = append(candidates, filepath.Join(workingDirectory, "..", "..", "..", "pptx"))
	}
	for _, candidate := range candidates {
		root, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		probe := filepath.Join(root, "bos", "dist", "mop-wasm", "pkg", "mop_wasm_bg.wasm")
		if info, err := os.Stat(probe); err == nil && !info.IsDir() {
			return root
		}
	}
	return ""
}

func jsStringLiteral(value string) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return `""`
	}
	return string(encoded)
}
