//go:build !officedex_demo && (dev || devtools)

package main

// `wails dev` compiles with -tags dev,devtools. Those runs are development
// traffic and must not count as product usage, so they are marked with
// X-Ops-Test: 1 and filtered out of the default export.
const (
	opsTelemetryDemoBuild = false
	opsTelemetryDevBuild  = true
)
