package login

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"strings"
	"syscall"

	"officedex/internal/types"
)

var (
	userIDLine    = regexp.MustCompile(`(?i)user id:\s*(\S+)`)
	sessionLine   = regexp.MustCompile(`(?i)session:\s*(\S+)`)
	expiresAtLine = regexp.MustCompile(`(?i)expires at:\s*(\S+)`)
)

// GetWhoAmI spawns `officecli whoami`, waits for exit, and parses the result.
// Errors from spawning or unexpected I/O are returned; an unauthenticated
// state surfaces as a successful result with Mode=anonymous.
func GetWhoAmI(ctx context.Context, opts ManagerOptions) (types.WhoAmIResult, error) {
	stdout, _, code, err := runOnce(ctx, opts, []string{"whoami"})
	if err != nil {
		return types.WhoAmIResult{}, err
	}
	return ParseWhoAmI(stdout, code), nil
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

// ParseWhoAmI mirrors the TS parseWhoAmI: classify mode, then pull the three
// optional identity fields out of stdout.
func ParseWhoAmI(stdout string, exitCode int) types.WhoAmIResult {
	if exitCode != 0 {
		return types.WhoAmIResult{Mode: types.WhoAmIAnonymous}
	}
	lowered := strings.ToLower(stdout)
	mode := types.WhoAmIAnonymous
	switch {
	case strings.Contains(lowered, "api key"):
		mode = types.WhoAmIAPIKey
	case strings.Contains(lowered, "logged in"),
		strings.Contains(lowered, "user id:"),
		strings.Contains(lowered, "session:"):
		mode = types.WhoAmILoggedIn
	}
	result := types.WhoAmIResult{Mode: mode}
	if v := firstSubmatch(userIDLine, stdout); v != "" {
		result.UserID = v
	}
	if v := firstSubmatch(sessionLine, stdout); v != "" {
		result.Session = v
	}
	if v := firstSubmatch(expiresAtLine, stdout); v != "" {
		result.ExpiresAt = v
	}
	return result
}

func firstSubmatch(re *regexp.Regexp, text string) string {
	match := re.FindStringSubmatch(text)
	if len(match) < 2 {
		return ""
	}
	return match[1]
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
	cmd := exec.Command(binary, args...)
	cmd.Env = BuildBridgeEnv(opts.Env)
	return newProcessTransport(cmd)
}
