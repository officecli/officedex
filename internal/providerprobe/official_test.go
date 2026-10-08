package providerprobe

import (
	"context"
	"errors"
	"strings"
	"testing"

	"officedex/internal/netproxy"
)

func TestOfficialEnvStripsInheritedProxiesAndSkipsPreflight(t *testing.T) {
	base := []string{"PATH=/usr/bin", "HTTP_PROXY=http://inherited:1", "https_proxy=http://inherited:2", "NO_PROXY=localhost", "OFFICECLI_SKIP_UPDATE_CHECK=0", "MALFORMED"}
	pool := netproxy.NewPool()
	if err := pool.Set("http://pool:3128"); err != nil {
		t.Fatal(err)
	}
	env := OfficialEnv(base, []string{"OFFICE_CLI_RUNTIME_MODE=hosted", "PATH=/override"}, pool)
	joined := "\n" + strings.Join(env, "\n") + "\n"
	for _, gone := range []string{"\nHTTP_PROXY=http://inherited:1\n", "\nhttps_proxy=http://inherited:2\n", "\nNO_PROXY=localhost\n"} {
		if strings.Contains(joined, gone) {
			t.Errorf("inherited proxy survived: %q", strings.TrimSpace(gone))
		}
	}
	for _, want := range []string{"\nOFFICECLI_SKIP_SKILL_PREFLIGHT=1\n", "\nOFFICECLI_SKIP_PUBLISH_SETUP=1\n", "\nOFFICECLI_SKIP_UPDATE_CHECK=1\n", "\nOFFICE_CLI_RUNTIME_MODE=hosted\n", "\nPATH=/override\n", "\nMALFORMED\n"} {
		if !strings.Contains(joined, want) {
			t.Errorf("env lacks %q: %v", strings.TrimSpace(want), env)
		}
	}
	if strings.Count(joined, "\nPATH=") != 1 || strings.Count(joined, "\nOFFICECLI_SKIP_UPDATE_CHECK=") != 1 {
		t.Fatalf("overrides must replace, not duplicate: %v", env)
	}
	poolSeen := false
	for _, kv := range pool.SubprocessEnv() {
		poolSeen = poolSeen || strings.Contains(joined, "\n"+kv+"\n")
	}
	if !poolSeen {
		t.Fatalf("pool proxy env missing: %v", env)
	}
	if len(base) != 6 || base[1] != "HTTP_PROXY=http://inherited:1" {
		t.Fatal("OfficialEnv must not mutate the caller's base environment")
	}
}

func TestFailureSummaryKeepsBoundedOutputAndFallsBackToTheRunError(t *testing.T) {
	long := strings.Repeat("x", outputCap+10)
	got := failureSummary(2, long, "boom", errors.New("exit status 2"))
	if !strings.HasPrefix(got, "official provider paid probe exited with exit code 2\nstderr: boom\nstdout: ") {
		t.Fatalf("summary = %q", got)
	}
	if !strings.HasSuffix(got, "...(truncated)") || len(got) > outputCap+100 {
		t.Fatalf("stdout not truncated: len=%d", len(got))
	}
	if got := failureSummary(-1, "  ", "", errors.New("fork/exec: no such file")); got != "official provider paid probe exited with exit code -1\nfork/exec: no such file" {
		t.Fatalf("no output must surface the run error: %q", got)
	}
}

func TestUnavailableIsExplicitNotASuccess(t *testing.T) {
	got := Unavailable()
	if got.OK || !got.Unavailable || got.URL != "official" || got.Error == "" {
		t.Fatalf("Unavailable = %+v", got)
	}
}

func TestRunOfficialPaidReportsAMissingBinaryAsAFailedProbe(t *testing.T) {
	got, err := RunOfficialPaid(context.Background(), OfficialPaidOptions{Binary: "/nonexistent/officecli-" + t.Name(), Env: []string{"PATH=/nonexistent"}})
	if err != nil {
		t.Fatalf("a failed run is a result, not an error: %v", err)
	}
	if got.OK || got.ProbeType != OfficialPaidProbeType || !strings.Contains(got.Error, "exit code -1") {
		t.Fatalf("result = %+v", got)
	}
}

func TestRunOfficialPaidHonoursTheDeadline(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, err := RunOfficialPaid(ctx, OfficialPaidOptions{Binary: "/nonexistent/officecli", Env: []string{"PATH=/nonexistent"}})
	if err != nil {
		t.Fatal(err)
	}
	if got.OK || got.Error != "official provider paid probe timed out" {
		t.Fatalf("result = %+v", got)
	}
}
