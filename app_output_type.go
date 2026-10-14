package main

import (
	"context"
	"errors"
	"log/slog"

	"officedex/internal/applog"
	"officedex/internal/bridge"
)

// OutputTypeClassification is what the renderer gets back when it asks which
// kind of file a request wants. Available is false when the running engine
// has no classifier; the renderer then routes the way it did before one
// existed, and that is not an error.
type OutputTypeClassification struct {
	Available    bool    `json:"available"`
	DocumentType string  `json:"documentType"`
	Confidence   float64 `json:"confidence"`
	Reason       string  `json:"reason,omitempty"`
}

// ClassifyOutputType asks the engine what kind of file prompt is asking for.
// The renderer calls it only when the user stated no type.
func (a *App) ClassifyOutputType(prompt string) (OutputTypeClassification, error) {
	client, err := a.bridgeForMetadata()
	if err != nil {
		return OutputTypeClassification{}, err
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	result, err := client.ClassifyOutputType(ctx, prompt)
	if errors.Is(err, bridge.ErrOutputTypeClassifierUnavailable) {
		return OutputTypeClassification{}, nil
	}
	if err != nil {
		applog.Logger().Warn("classify output type failed", slog.String("error", err.Error()))
		return OutputTypeClassification{}, err
	}
	return OutputTypeClassification{
		Available:    true,
		DocumentType: result.DocumentType,
		Confidence:   result.Confidence,
		Reason:       result.Reason,
	}, nil
}
