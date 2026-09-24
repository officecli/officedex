//go:build officedex_demo

package main

// A demo build scripts a fake generation end to end (internal/demoflow). Its
// "completed" tasks produce fixture files, so reporting them would put staged
// runs into the product funnel. Nothing from a demo build is ever sent.
const (
	opsTelemetryDemoBuild = true
	opsTelemetryDevBuild  = true
)
