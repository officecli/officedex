// Package login is the Go port of src/main/loginManager.ts.
//
// Style conventions (following internal/settings/store.go):
//
//   - All state lives on a value-receiver struct guarded by sync.Mutex.
//   - The process transport is fronted by an interface (Transport) so tests
//     can inject a fake without spawning a real subprocess. Production code
//     uses spawnProcess.
//   - Start returns the verification URL synchronously (or an error if the
//     subprocess fails to print one before URLTimeout); after that it leaves
//     the subprocess running until the user completes the browser flow, and
//     fans out url/success/failure/exit events to OnEvent subscribers.
//   - The TS source matches URLs with a JS-flavoured regex containing a
//     lookahead. RE2 (Go's stdlib regexp) has no lookahead, so the primary
//     pattern is rewritten to capture the body and the fallback pattern
//     keeps the original "greedy until whitespace/punct" behaviour.
package login

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"sync"
	"syscall"
	"time"

	"officedex/internal/subprocess"
)

// urlPattern captures the verification URL body. The TS source used a
// positive lookahead to stop at any whitespace or one of <>"'`; RE2 has no
// lookahead, so we capture greedily up to the first such terminator instead.
var urlPattern = regexp.MustCompile(`(?i)(https?://[^\s<>"'` + "`" + `]+?)[\s<>"'` + "`" + `]`)

// urlPatternFallback is used after exit when the streaming match never fired.
// It mirrors URL_PATTERN_FALLBACK in the TS source: take everything up to the
// first whitespace/punct, with no requirement for a trailing terminator.
var urlPatternFallback = regexp.MustCompile(`(?i)https?://[^\s<>"'` + "`" + `]+`)

const defaultURLTimeout = 30 * time.Second

// Transport abstracts the subprocess so tests can inject a fake. Implementations
// must not block in Stdout/Stderr/Stdin; Wait blocks until the child exits.
type Transport interface {
	Stdout() io.Reader
	Stderr() io.Reader
	Stdin() io.Writer
	Kill(sig os.Signal) error
	Wait() (exitCode int, signal os.Signal, err error)
}

// ManagerOptions configures a Manager or single-shot run (GetWhoAmI / Logout).
// At least one of BinaryPath / ResolveBinary should be set in production; if
// both are empty the binary name "officecli" is used (PATH lookup).
type ManagerOptions struct {
	BinaryPath     string
	ResolveBinary  func() string
	Env            []string
	URLTimeout     time.Duration
	SpawnTransport func(args []string) (Transport, error)
}

// LoginEventType discriminates the LoginEvent union.
type LoginEventType string

const (
	EventURLEmit LoginEventType = "url"
	EventSuccess LoginEventType = "success"
	EventFailure LoginEventType = "failure"
	EventExit    LoginEventType = "exit"
)

// LoginEvent is emitted to OnEvent subscribers as the subprocess progresses.
// Code/Signal are only populated for Exit events; URL is only set for URLEmit.
type LoginEvent struct {
	Type    LoginEventType `json:"type"`
	URL     string         `json:"url,omitempty"`
	Message string         `json:"message,omitempty"`
	Code    *int           `json:"code,omitempty"`
	Signal  string         `json:"signal,omitempty"`
}

// Manager owns one officecli login subprocess at a time. Safe for concurrent
// use; Start/Cancel/Running may be called from different goroutines.
type Manager struct {
	opts ManagerOptions

	mu           sync.Mutex
	transport    Transport
	stdoutBuf    string
	stderrBuf    string
	urlEmitted   bool
	exited       bool
	exitCode     int
	exitSignal   os.Signal
	subscribers  map[int]func(LoginEvent)
	subscriberID int
}

// New returns a Manager bound to opts. opts is captured by value; mutating
// the caller's struct after New has no effect.
func New(opts ManagerOptions) *Manager {
	return &Manager{opts: opts, subscribers: make(map[int]func(LoginEvent))}
}

// Running reports whether a subprocess has been spawned and has not yet
// exited.
func (m *Manager) Running() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.transport != nil && !m.exited
}

// Start spawns `officecli login`, watches stdout for a verification URL, and
// returns that URL synchronously. If no URL appears within URLTimeout the
// process is killed and an error is returned. The subprocess continues
// running after Start returns; subscribe via OnEvent for url/success/failure
// /exit events.
func (m *Manager) Start(ctx context.Context) (string, error) {
	m.mu.Lock()
	if m.transport != nil && !m.exited {
		m.mu.Unlock()
		return "", errors.New("officecli login is already running")
	}
	m.stdoutBuf = ""
	m.stderrBuf = ""
	m.urlEmitted = false
	m.exited = false
	m.exitCode = 0
	m.exitSignal = nil

	transport, err := m.spawn([]string{"login"})
	if err != nil {
		m.mu.Unlock()
		return "", fmt.Errorf("login: spawn: %w", err)
	}
	m.transport = transport
	timeout := m.opts.URLTimeout
	if timeout <= 0 {
		timeout = defaultURLTimeout
	}
	m.mu.Unlock()

	urlCh := make(chan string, 1)
	stdoutDone := make(chan struct{})
	stderrDone := make(chan struct{})

	go m.readStdout(transport.Stdout(), urlCh, stdoutDone)
	go m.readStderr(transport.Stderr(), stderrDone)

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	waitDone := make(chan waitResult, 1)
	go func() {
		code, sig, werr := transport.Wait()
		<-stdoutDone
		<-stderrDone
		waitDone <- waitResult{code: code, signal: sig, err: werr}
	}()

	select {
	case url := <-urlCh:
		go m.finalize(waitDone)
		return url, nil
	case <-timer.C:
		_ = transport.Kill(syscall.SIGTERM)
		<-waitDone
		m.markExited(0, nil)
		return "", fmt.Errorf("officecli login did not print a verification URL within %s", timeout)
	case <-ctx.Done():
		_ = transport.Kill(syscall.SIGTERM)
		<-waitDone
		m.markExited(0, nil)
		return "", ctx.Err()
	case result := <-waitDone:
		// Process exited before any URL was streamed; try the fallback regex.
		url, ok := m.fallbackURL()
		if ok {
			m.emit(LoginEvent{Type: EventURLEmit, URL: url})
			m.completeAfterExit(result)
			return url, nil
		}
		m.completeAfterExit(result)
		if result.code != 0 {
			return "", m.exitError(result)
		}
		return "", errors.New("officecli login exited without printing a verification URL")
	}
}

// OnEvent registers cb and returns an unsubscribe function. The callback is
// invoked from internal goroutines; implementations must not block.
func (m *Manager) OnEvent(cb func(event LoginEvent)) func() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.subscriberID++
	id := m.subscriberID
	m.subscribers[id] = cb
	return func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		delete(m.subscribers, id)
	}
}

// Cancel sends SIGTERM to the subprocess. Safe to call when nothing is
// running; in that case it is a no-op.
func (m *Manager) Cancel() error {
	m.mu.Lock()
	transport := m.transport
	exited := m.exited
	m.mu.Unlock()
	if transport == nil || exited {
		return nil
	}
	if err := transport.Kill(syscall.SIGTERM); err != nil {
		return fmt.Errorf("login: kill: %w", err)
	}
	return nil
}

// LastExit returns the most recent exit code and signal, or (0, nil) if the
// process has not yet exited.
func (m *Manager) LastExit() (int, os.Signal) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.exitCode, m.exitSignal
}

type waitResult struct {
	code   int
	signal os.Signal
	err    error
}

func (m *Manager) readStdout(r io.Reader, urlCh chan<- string, done chan<- struct{}) {
	defer close(done)
	reader := bufio.NewReader(r)
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			text := string(buf[:n])
			m.mu.Lock()
			m.stdoutBuf += text
			alreadyEmitted := m.urlEmitted
			snapshot := m.stdoutBuf
			m.mu.Unlock()
			if !alreadyEmitted {
				if match := urlPattern.FindStringSubmatch(snapshot); match != nil {
					url := match[1]
					m.mu.Lock()
					if !m.urlEmitted {
						m.urlEmitted = true
						m.mu.Unlock()
						m.emit(LoginEvent{Type: EventURLEmit, URL: url})
						select {
						case urlCh <- url:
						default:
						}
					} else {
						m.mu.Unlock()
					}
				}
			}
		}
		if err != nil {
			return
		}
	}
}

func (m *Manager) readStderr(r io.Reader, done chan<- struct{}) {
	defer close(done)
	reader := bufio.NewReader(r)
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			m.mu.Lock()
			combined := m.stderrBuf + string(buf[:n])
			if len(combined) > 8192 {
				combined = combined[len(combined)-8192:]
			}
			m.stderrBuf = combined
			m.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

func (m *Manager) finalize(waitDone <-chan waitResult) {
	result := <-waitDone
	m.completeAfterExit(result)
}

func (m *Manager) completeAfterExit(result waitResult) {
	m.markExited(result.code, result.signal)
	code := result.code
	exitEvent := LoginEvent{Type: EventExit, Code: &code}
	if result.signal != nil {
		exitEvent.Signal = result.signal.String()
	}
	m.emit(exitEvent)
	if result.code == 0 {
		m.emit(LoginEvent{Type: EventSuccess})
		return
	}
	err := m.exitError(result)
	m.emit(LoginEvent{Type: EventFailure, Message: err.Error()})
}

func (m *Manager) markExited(code int, sig os.Signal) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.exited = true
	m.exitCode = code
	m.exitSignal = sig
	m.transport = nil
}

func (m *Manager) emit(event LoginEvent) {
	m.mu.Lock()
	subs := make([]func(LoginEvent), 0, len(m.subscribers))
	for _, cb := range m.subscribers {
		subs = append(subs, cb)
	}
	m.mu.Unlock()
	for _, cb := range subs {
		cb(event)
	}
}

func (m *Manager) fallbackURL() (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.urlEmitted {
		return "", false
	}
	match := urlPatternFallback.FindString(m.stdoutBuf)
	if match == "" {
		return "", false
	}
	m.urlEmitted = true
	return match, true
}

func (m *Manager) exitError(result waitResult) error {
	m.mu.Lock()
	stderr := m.stderrBuf
	m.mu.Unlock()
	suffix := ""
	if trimmed := trimRight(stderr); trimmed != "" {
		suffix = "\nstderr:\n" + trimmed
	}
	sigStr := "null"
	if result.signal != nil {
		sigStr = result.signal.String()
	}
	return fmt.Errorf("officecli login exited: code=%d signal=%s%s", result.code, sigStr, suffix)
}

func (m *Manager) spawn(args []string) (Transport, error) {
	if m.opts.SpawnTransport != nil {
		return m.opts.SpawnTransport(args)
	}
	binary := m.opts.BinaryPath
	if binary == "" && m.opts.ResolveBinary != nil {
		binary = m.opts.ResolveBinary()
	}
	if binary == "" {
		binary = "officecli"
	}
	cmd := subprocess.Command(binary, args...)
	cmd.Env = BuildBridgeEnv(m.opts.Env)
	return newProcessTransport(cmd)
}

// processTransport is the production Transport backed by exec.Cmd.
type processTransport struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser
}

func newProcessTransport(cmd *exec.Cmd) (*processTransport, error) {
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start: %w", err)
	}
	return &processTransport{cmd: cmd, stdin: stdin, stdout: stdout, stderr: stderr}, nil
}

func (p *processTransport) Stdout() io.Reader { return p.stdout }
func (p *processTransport) Stderr() io.Reader { return p.stderr }
func (p *processTransport) Stdin() io.Writer  { return p.stdin }

func (p *processTransport) Kill(sig os.Signal) error {
	if p.cmd.Process == nil {
		return nil
	}
	return p.cmd.Process.Signal(sig)
}

func (p *processTransport) Wait() (int, os.Signal, error) {
	err := p.cmd.Wait()
	code := 0
	var sig os.Signal
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			code = exitErr.ExitCode()
			if status, ok := exitErr.Sys().(syscall.WaitStatus); ok && status.Signaled() {
				sig = status.Signal()
			}
			return code, sig, nil
		}
		return -1, nil, err
	}
	if state := p.cmd.ProcessState; state != nil {
		code = state.ExitCode()
	}
	return code, nil, nil
}

func trimRight(s string) string {
	end := len(s)
	for end > 0 {
		c := s[end-1]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			end--
			continue
		}
		break
	}
	return s[:end]
}
