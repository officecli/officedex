//go:build !officedex_demo && !dev && !devtools

package main

// The default build. Whether it is *the* release build additionally depends on
// appVersion having been injected by scripts/build-mac-dmg.sh: a bare `go
// build` or `go test` leaves it at "dev" and still reports as test traffic.
// See opsTelemetryTestTraffic.
const (
	opsTelemetryDemoBuild = false
	opsTelemetryDevBuild  = false
)
