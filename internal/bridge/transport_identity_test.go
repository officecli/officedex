package bridge

import (
	"context"
	"reflect"
	"testing"
)

func TestAgentBridgeCommandArgsCarryOfficeDexIdentity(t *testing.T) {
	got := agentBridgeCommandArgs(Options{
		ClientID:         "desktop-1",
		BridgeInstanceID: "bridge-1",
		RuntimeRoot:      "/tmp/officedex-runtime",
	})
	want := []string{
		"agent-bridge",
		"--client-id", "desktop-1",
		"--bridge-instance-id", "bridge-1",
		"--runtime-root", "/tmp/officedex-runtime",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("agentBridgeCommandArgs() = %#v, want %#v", got, want)
	}
}

func TestBridgeInstanceIDChangesForEachChildProcess(t *testing.T) {
	issued := []string{"bridge-1", "bridge-2"}
	var captured []string
	client := New(Options{
		ClientID: "desktop-1",
		NewBridgeInstanceID: func() string {
			id := issued[len(captured)]
			return id
		},
		CreateTransport: func(opts Options) (Transport, error) {
			captured = append(captured, opts.BridgeInstanceID)
			return newFakeTransport(), nil
		},
		DisableAutoReconnect: true,
	})
	if err := client.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if client.BridgeInstanceID() != "bridge-1" {
		t.Fatalf("first bridge id = %q", client.BridgeInstanceID())
	}
	client.Stop()
	if err := client.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer client.Stop()
	if client.BridgeInstanceID() != "bridge-2" {
		t.Fatalf("second bridge id = %q", client.BridgeInstanceID())
	}
	if !reflect.DeepEqual(captured, issued) {
		t.Fatalf("captured bridge ids = %#v", captured)
	}
}

func TestAgentBridgeCommandArgsKeepLegacyShapeWithoutIdentity(t *testing.T) {
	if got := agentBridgeCommandArgs(Options{}); !reflect.DeepEqual(got, []string{"agent-bridge"}) {
		t.Fatalf("legacy args = %#v", got)
	}
}
