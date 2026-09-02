//go:build !officedex_demo

package demoflow

import (
	"context"

	"officedex/internal/types"
)

type disabledImplementation struct{}

func newImplementation(Options) implementation {
	return disabledImplementation{}
}

func (disabledImplementation) TryGenerate(context.Context, types.GenerateInput) (GenerateResult, bool, error) {
	return GenerateResult{}, false, nil
}

func (disabledImplementation) TryRespond(context.Context, RespondInput) ([]byte, bool, error) {
	return nil, false, nil
}

func (disabledImplementation) TryModifyPptistDeck(context.Context, ModifyPptistDeckInput) (ModifyPptistDeckResult, bool, error) {
	return ModifyPptistDeckResult{}, false, nil
}

func (disabledImplementation) Shutdown() {}

func MagicPromptForTests() string {
	return "Create a launch strategy presentation for a new AI productivity app. Define the target audience, positioning, launch channels, a 90-day rollout plan, and success metrics. Make it clear, visual, and suitable for an executive review."
}
