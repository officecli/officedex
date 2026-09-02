package mophttp

// The MOP protocol and schema versions advertised on content responses. The
// editor's assertPackageCapabilities rejects any package whose headers differ
// from the versions its bundled WASM runtime reports, so a stale value here
// makes every presentation fail to open with a "MOP schema mismatch" error
// rather than degrading gracefully.
//
// capabilities_test.go pins these against the real mop-wasm binary whenever a
// learnof/pptx checkout is available, so a runtime upgrade cannot land without
// updating them.
const (
	DefaultProtocolVersion = 1
	DefaultSchemaVersion   = 975
)
