//go:build !officedex_demo

package demoflow

import (
	"context"
	"testing"

	"officedex/internal/types"
)

func TestNormalBuildDoesNotMatchMagicPrompt(t *testing.T) {
	engine := New(Options{})
	result, ok, err := engine.TryGenerate(context.Background(), types.GenerateInput{
		DocumentType:   types.DocPPTX,
		GenerationMode: "plan",
		Topic:          MagicPromptForTests(),
	})
	if err != nil {
		t.Fatalf("TryGenerate returned error: %v", err)
	}
	if ok {
		t.Fatalf("normal build matched demo flow: %#v", result)
	}
}
