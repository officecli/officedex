package login

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"syscall"

	"officedex/internal/subprocess"
	"officedex/internal/types"
)

// whoamiJSON is the shape `officecli whoami --json` prints, mirroring the CLI's
// whoamiReport. It replaced four regexes over the CLI's prose; see
// credit_status.go for why that arrangement had to go.
//
// An API key has no user record behind it, so the CLI answers that case with
// the quota report instead. Both shapes carry `mode`, which is the only field
// this function needs from it.
type whoamiJSON struct {
	Mode      string `json:"mode"`
	UserID    string `json:"user_id"`
	Email     string `json:"email"`
	Session   string `json:"session"`
	ExpiresAt string `json:"expires_at"`
}

// GetWhoAmI spawns `officecli whoami --json`, waits for exit, and parses the
// result. Errors from spawning or unexpected I/O are returned; an
// unauthenticated state surfaces as a successful result with Mode=anonymous.
func GetWhoAmI(ctx context.Context, opts ManagerOptions) (types.WhoAmIResult, error) {
	stdout, _, code, err := runOnce(ctx, opts, []string{"whoami", "--json"})
	if err != nil {
		return types.WhoAmIResult{}, err
	}
	return ParseWhoAmI(stdout, code)
}

// Logout spawns `officecli logout` and reports a non-zero exit as an error
// including the last bytes of stderr.
func Logout(ctx context.Context, opts ManagerOptions) error {
	_, stderr, code, err := runOnce(ctx, opts, []string{"logout"})
	if err != nil {
		return err
	}
	if code != 0 {
		trimmed := strings.TrimSpace(stderr)
		suffix := ""
		if trimmed != "" {
			suffix = "\nstderr:\n" + trimmed
		}
		return fmt.Errorf("officecli logout exited with code %d%s", code, suffix)
	}
	return nil
}

// ParseWhoAmI decodes what `officecli whoami --json` printed. A non-zero exit
// means the CLI could not answer, which reads as anonymous.
func ParseWhoAmI(stdout string, exitCode int) (types.WhoAmIResult, error) {
	if exitCode != 0 {
		return types.WhoAmIResult{Mode: types.WhoAmIAnonymous}, nil
	}
	trimmed := strings.TrimSpace(stdout)
	if trimmed == "" {
		return types.WhoAmIResult{Mode: types.WhoAmIAnonymous}, fmt.Errorf("officecli whoami --json printed nothing")
	}
	var report whoamiJSON
	if err := json.Unmarshal([]byte(trimmed), &report); err != nil {
		return types.WhoAmIResult{Mode: types.WhoAmIAnonymous}, outdatedCLIError("whoami", err)
	}
	return types.WhoAmIResult{
		Mode:      creditStatusMode(report.Mode),
		UserID:    strings.TrimSpace(report.UserID),
		Email:     strings.TrimSpace(report.Email),
		Session:   strings.TrimSpace(report.Session),
		ExpiresAt: strings.TrimSpace(report.ExpiresAt),
	}, nil
}

// outdatedCLIError names the likely cause of unparseable output on a successful
// exit. An officecli from before these commands learned --json ignores the flag
// and prints its usual prose, which is not a malformed answer so much as an
// answer in the old format — and "invalid character 'M'" tells a user nothing
// about what to do next.
func outdatedCLIError(command string, err error) error {
	return fmt.Errorf("officecli %s --json did not print JSON (the binary is probably older than this app expects; update or rebuild it): %w", command, err)
}

// runOnce drives a single short-lived officecli subprocess to completion and
// returns its captured stdout, stderr, and exit code. Used by GetWhoAmI and
// Logout.
func runOnce(ctx context.Context, opts ManagerOptions, args []string) (string, string, int, error) {
	transport, err := spawnOnce(opts, args)
	if err != nil {
		return "", "", 0, fmt.Errorf("login: spawn %s: %w", args[0], err)
	}
	var stdoutBuf, stderrBuf strings.Builder
	stdoutDone := make(chan struct{})
	stderrDone := make(chan struct{})
	go drain(transport.Stdout(), &stdoutBuf, stdoutDone)
	go drain(transport.Stderr(), &stderrBuf, stderrDone)

	waitDone := make(chan waitResult, 1)
	go func() {
		code, sig, werr := transport.Wait()
		<-stdoutDone
		<-stderrDone
		waitDone <- waitResult{code: code, signal: sig, err: werr}
	}()

	select {
	case result := <-waitDone:
		if result.err != nil {
			return stdoutBuf.String(), stderrBuf.String(), result.code, result.err
		}
		return stdoutBuf.String(), stderrBuf.String(), result.code, nil
	case <-ctx.Done():
		_ = transport.Kill(syscall.SIGTERM)
		<-waitDone
		return stdoutBuf.String(), stderrBuf.String(), 0, ctx.Err()
	}
}

func drain(r io.Reader, sink *strings.Builder, done chan<- struct{}) {
	defer close(done)
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			sink.Write(buf[:n])
		}
		if err != nil {
			return
		}
	}
}

func spawnOnce(opts ManagerOptions, args []string) (Transport, error) {
	if opts.SpawnTransport != nil {
		return opts.SpawnTransport(args)
	}
	binary := opts.BinaryPath
	if binary == "" && opts.ResolveBinary != nil {
		binary = opts.ResolveBinary()
	}
	if binary == "" {
		binary = "officecli"
	}
	cmd := subprocess.Command(binary, args...)
	cmd.Env = BuildBridgeEnv(opts.Env)
	return newProcessTransport(cmd)
}
