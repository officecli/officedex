package bridge

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"officedex/internal/types"
	"os/exec"
	"syscall"

	"officedex/internal/subprocess"
)

// Transport abstracts the agent-bridge child process so tests can inject a
// fake backed by io.Pipe instead of spawning a real binary.
type Transport interface {
	Stdin() io.Writer
	Stdout() io.Reader
	Stderr() io.Reader
	Kill() error
	// Wait blocks until the child process exits and returns (exitCode, signal,
	// err). exitCode is nil when the process was killed by a signal; signal is
	// the empty string when the process exited cleanly.
	Wait() (code *int, signal string, err error)
}

// TransportFactory builds a Transport from the resolved Options. Tests pass
// their own factory via Options.CreateTransport.
type TransportFactory func(opts Options) (Transport, error)

// processTransport is the default Transport, backed by os/exec.
type processTransport struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser
}

func defaultProcessTransport(opts Options) (Transport, error) {
	binary := opts.BinaryPath
	if binary == "" && opts.ResolveBinary != nil {
		binary = opts.ResolveBinary()
	}
	if binary == "" {
		binary = "officecli"
	}
	cmd := subprocess.Command(binary, agentBridgeCommandArgs(opts)...)
	if opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}
	cmd.Env = BuildBridgeEnv(opts.Env)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("bridge: stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("bridge: stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("bridge: stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		kind := types.FailureConnection
		if errors.Is(err, exec.ErrNotFound) || errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrPermission) {
			// The binary itself is the problem, not the process.
			kind = types.FailureSetup
		}
		return nil, fmt.Errorf("%s: %w", types.TagFailure(kind, fmt.Sprintf("bridge: spawn officecli (%s)", binary)), err)
	}
	return &processTransport{cmd: cmd, stdin: stdin, stdout: stdout, stderr: stderr}, nil
}

func agentBridgeCommandArgs(opts Options) []string {
	args := []string{"agent-bridge"}
	if opts.ClientID != "" {
		args = append(args, "--client-id", opts.ClientID)
	}
	if opts.BridgeInstanceID != "" {
		args = append(args, "--bridge-instance-id", opts.BridgeInstanceID)
	}
	if opts.RuntimeRoot != "" {
		args = append(args, "--runtime-root", opts.RuntimeRoot)
	}
	return args
}

func (p *processTransport) Stdin() io.Writer  { return p.stdin }
func (p *processTransport) Stdout() io.Reader { return p.stdout }
func (p *processTransport) Stderr() io.Reader { return p.stderr }

func (p *processTransport) Kill() error {
	if err := killProcessTree(p.cmd.Process); err != nil {
		return fmt.Errorf("bridge: kill: %w", err)
	}
	return nil
}

func (p *processTransport) Wait() (*int, string, error) {
	err := p.cmd.Wait()
	if err == nil {
		zero := 0
		return &zero, "", nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		ws, ok := exitErr.Sys().(syscall.WaitStatus)
		if ok {
			if ws.Signaled() {
				return nil, ws.Signal().String(), nil
			}
			code := ws.ExitStatus()
			return &code, "", nil
		}
		code := exitErr.ExitCode()
		return &code, "", nil
	}
	return nil, "", fmt.Errorf("bridge: wait: %w", err)
}
