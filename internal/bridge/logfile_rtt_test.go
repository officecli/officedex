package bridge

import (
	"context"
	"encoding/json"
	"io"
	"sort"
	"testing"
	"time"
)

// slowWriter is the harness sink described in the Stage A1 acceptance: a
// blocking writer whose Write sleeps for `sleep` before returning. With the
// bounded-channel + drop-newest design, RPC RTT must NOT be sensitive to the
// sink's speed.
type slowWriter struct{ sleep time.Duration }

func (s *slowWriter) Write(b []byte) (int, error) {
	time.Sleep(s.sleep)
	return len(b), nil
}

func TestLogfileRTT_SlowSinkDoesNotDegradeRPC(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping RTT harness in -short mode")
	}

	const n = 1000

	p99Discard := runRTT(t, n, io.Discard)
	p99Slow := runRTT(t, n, &slowWriter{sleep: 100 * time.Millisecond})

	delta := p99Slow - p99Discard
	t.Logf("p99 discard=%v slow=%v delta=%v", p99Discard, p99Slow, delta)
	if delta > 5*time.Millisecond {
		t.Fatalf("p99 delta = %v, want <5ms (discard=%v slow=%v)",
			delta, p99Discard, p99Slow)
	}
}

func runRTT(t *testing.T, n int, sink io.Writer) time.Duration {
	t.Helper()
	fake := newFakeTransport()
	client := New(Options{
		RequestTimeout: 2 * time.Second,
		CreateTransport: func(opts Options) (Transport, error) {
			return fake, nil
		},
		DisableAutoReconnect: true,
	})
	// Inject a logfile pre-Start so the very first read tees to our sink.
	client.logfile = newWithSink(sink)
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer client.Stop()
	defer client.logfile.Close()

	// Echo server goroutine: read every request from the fake transport's
	// stdin and reply with `{"pong": true}`.
	stop := make(chan struct{})
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
			}
			body := fake.stdin.readUntilFrame()
			var msg jsonrpcMessage
			if err := json.Unmarshal(body, &msg); err != nil {
				return
			}
			writeEcho(fake, msg.idString())
		}
	}()
	defer close(stop)

	samples := make([]time.Duration, 0, n)
	for i := 0; i < n; i++ {
		start := time.Now()
		if _, err := client.Request(context.Background(), "ping", nil); err != nil {
			t.Fatalf("Request[%d]: %v", i, err)
		}
		samples = append(samples, time.Since(start))
	}

	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	return samples[(len(samples)*99)/100]
}

func writeEcho(f *fakeTransport, id string) {
	payload := []byte(`{"jsonrpc":"2.0","id":` + id + `,"result":{"pong":true}}`)
	header := []byte("Content-Length: ")
	header = append(header, []byte(itoa(len(payload)))...)
	header = append(header, '\r', '\n', '\r', '\n')
	_, _ = f.stdoutW.Write(append(header, payload...))
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
