package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

type classifyOutcome struct {
	result OutputTypeClassification
	err    error
}

func classifyInBackground(client *Client, prompt string) <-chan classifyOutcome {
	done := make(chan classifyOutcome, 1)
	go func() {
		result, err := client.ClassifyOutputType(context.Background(), prompt)
		done <- classifyOutcome{result: result, err: err}
	}()
	return done
}

func TestClassifyOutputTypeAsksAnEngineThatAdvertisesIt(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()
	done := classifyInBackground(client, "  给我详细介绍一下绝区零的剧情  ")

	probe := fake.readRequest(t)
	if probe.Method != MethodCapabilitiesGet {
		t.Fatalf("first method = %q, want %s", probe.Method, MethodCapabilitiesGet)
	}
	fake.writeResponse(t, probe.idString(), map[string]any{"methods": []string{"initialize", MethodIntentClassifyOutputType}}, nil)

	call := fake.readRequest(t)
	if call.Method != MethodIntentClassifyOutputType {
		t.Fatalf("second method = %q, want %s", call.Method, MethodIntentClassifyOutputType)
	}
	var params map[string]any
	if err := json.Unmarshal(call.Params, &params); err != nil {
		t.Fatalf("decode params: %v", err)
	}
	if params["prompt"] != "给我详细介绍一下绝区零的剧情" {
		t.Fatalf("prompt = %#v, want the trimmed request", params["prompt"])
	}
	fake.writeResponse(t, call.idString(), map[string]any{"document_type": "docx", "confidence": 0.93, "reason": "Asks for an explanation."}, nil)

	outcome := <-done
	if outcome.err != nil {
		t.Fatalf("ClassifyOutputType: %v", outcome.err)
	}
	if outcome.result.DocumentType != "docx" || outcome.result.Confidence != 0.93 {
		t.Fatalf("unexpected result: %#v", outcome.result)
	}
}

func TestClassifyOutputTypeNeverCallsAnEngineThatPredatesIt(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()
	done := classifyInBackground(client, "anything")

	probe := fake.readRequest(t)
	fake.writeResponse(t, probe.idString(), map[string]any{"methods": []string{"initialize", "task/invoke"}}, nil)

	outcome := <-done
	if !errors.Is(outcome.err, ErrOutputTypeClassifierUnavailable) {
		t.Fatalf("err = %v, want ErrOutputTypeClassifierUnavailable", outcome.err)
	}
	if pending := fake.stdin.Len(); pending != 0 {
		t.Fatalf("%d bytes were sent to an engine with no classifier", pending)
	}
}

func TestClassifyOutputTypeReportsTheEnginesFailure(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()
	client.rememberCapabilities([]byte(`{"methods":["intent/classify-output-type"]}`))
	done := classifyInBackground(client, "anything")

	call := fake.readRequest(t)
	fake.writeResponse(t, call.idString(), nil, &jsonrpcError{Code: -32000, Message: "upstream unavailable"})

	if outcome := <-done; outcome.err == nil || errors.Is(outcome.err, ErrOutputTypeClassifierUnavailable) {
		t.Fatalf("err = %v, want the engine's own failure", outcome.err)
	}
}

func TestClassifyOutputTypeRejectsAnEmptyPrompt(t *testing.T) {
	client, _ := newClientWithFake(t)
	defer client.Stop()

	if _, err := client.ClassifyOutputType(context.Background(), "   "); err == nil {
		t.Fatal("want an error for an empty prompt")
	}
}
