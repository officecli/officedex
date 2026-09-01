//go:build officedex_demo

package main

import (
	"context"
	"path/filepath"
	"testing"

	"officedex/internal/demoflow"
	"officedex/internal/localstore"
	"officedex/internal/preview"
	"officedex/internal/settings"
	"officedex/internal/types"
)

func TestDemoGenerateBypassesProviderValidation(t *testing.T) {
	app := newDemoTestApp(t)
	app.cachedSettings.LlmProvider = &types.LlmProvider{Type: types.LlmOpenAI, BaseURL: "", APIKey: "", Model: ""}

	result, err := app.Generate(types.GenerateInput{
		DocumentType:   types.DocPPTX,
		GenerationMode: "plan",
		Topic:          demoflow.MagicPromptForTests(),
	})
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}
	if result.TaskID == "" || result.Status != "running" {
		t.Fatalf("result = %#v", result)
	}
	if len(app.bridgeClients) != 0 {
		t.Fatal("demo generate started bridge client")
	}
}

func TestDemoModifyPptistDeckRoutesPreparedTimelineEdit(t *testing.T) {
	app := newDemoTestApp(t)
	result, err := app.ModifyPptistDeck(ModifyPptistDeckInput{
		Prompt: "Turn this launch timeline into a vertical roadmap.",
		Snapshot: PptistDeckSnapshot{
			SlideIndex: 5,
			Slides: []PptistSlide{
				{ID: "s1"}, {ID: "s2"}, {ID: "s3"}, {ID: "s4"}, {ID: "s5"}, demoTimelineAppSnapshotSlide(), {ID: "s7"}, {ID: "s8"}, {ID: "s9"},
			},
		},
	})
	if err != nil {
		t.Fatalf("ModifyPptistDeck returned error: %v", err)
	}
	if !result.RequiresConfirmation || len(result.Ops) != 1 || result.Ops[0]["type"] != "slide:update" {
		t.Fatalf("result = %#v, want confirmation slide:update", result)
	}
}

func demoTimelineAppSnapshotSlide() PptistSlide {
	return PptistSlide{
		ID: "demo-slide-06",
		Elements: []map[string]any{
			{"id": "hero-copy", "type": "shape", "left": 74.0, "top": 192.0, "width": 720.0, "height": 54.0, "text": map[string]any{"content": "<p>This slide is intentionally visual so the demo can show a precise timeline edit.</p>"}},
			{"id": "timeline-axis", "type": "shape", "left": 150.0, "top": 416.0, "width": 980.0, "height": 4.0, "path": "axis-path", "viewBox": []any{200.0, 200.0}, "fill": "#315D62", "fixedRatio": false},
			{"id": "timeline-node-1", "type": "shape", "left": 174.0, "top": 386.0, "width": 62.0, "height": 62.0, "path": "circle-path", "viewBox": []any{200.0, 200.0}, "fill": "#1AAE39", "fixedRatio": false},
			{"id": "timeline-day-1", "type": "shape", "left": 178.0, "top": 404.0, "width": 54.0, "height": 22.0, "text": map[string]any{"content": "<p>0–30</p>"}},
			{"id": "timeline-title-1", "type": "shape", "left": 140.0, "top": 476.0, "width": 130.0, "height": 34.0, "text": map[string]any{"content": "<p>Proof</p>"}},
			{"id": "timeline-copy-1", "type": "shape", "left": 92.0, "top": 518.0, "width": 226.0, "height": 54.0, "text": map[string]any{"content": "<p>Website, video, download funnel</p>"}},
			{"id": "timeline-node-2", "type": "shape", "left": 524.0, "top": 386.0, "width": 62.0, "height": 62.0, "path": "circle-path", "viewBox": []any{200.0, 200.0}, "fill": "#006876", "fixedRatio": false},
			{"id": "timeline-day-2", "type": "shape", "left": 518.0, "top": 405.0, "width": 74.0, "height": 22.0, "text": map[string]any{"content": "<p>31–60</p>"}},
			{"id": "timeline-title-2", "type": "shape", "left": 490.0, "top": 476.0, "width": 130.0, "height": 34.0, "text": map[string]any{"content": "<p>Signal</p>"}},
			{"id": "timeline-copy-2", "type": "shape", "left": 442.0, "top": 518.0, "width": 226.0, "height": 54.0, "text": map[string]any{"content": "<p>X thread, community examples, onboarding data</p>"}},
			{"id": "timeline-node-3", "type": "shape", "left": 874.0, "top": 386.0, "width": 62.0, "height": 62.0, "path": "circle-path", "viewBox": []any{200.0, 200.0}, "fill": "#7B3FF2", "fixedRatio": false},
			{"id": "timeline-day-3", "type": "shape", "left": 874.0, "top": 406.0, "width": 62.0, "height": 16.0, "text": map[string]any{"content": "<p>61–90</p>"}},
			{"id": "timeline-title-3", "type": "shape", "left": 840.0, "top": 476.0, "width": 130.0, "height": 34.0, "text": map[string]any{"content": "<p>Scale</p>"}},
			{"id": "timeline-copy-3", "type": "shape", "left": 792.0, "top": 518.0, "width": 226.0, "height": 54.0, "text": map[string]any{"content": "<p>Templates, partner content, paid conversion tests</p>"}},
		},
	}
}

func newDemoTestApp(t *testing.T) *App {
	t.Helper()
	dir := t.TempDir()
	store := localstore.New(filepath.Join(dir, "officedex.sqlite"))
	if err := store.Open(context.Background()); err != nil {
		t.Fatalf("Open local store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{dir}})
	if err != nil {
		t.Fatalf("preview registry: %v", err)
	}
	app := &App{
		ctx:           context.Background(),
		userDataDir:   dir,
		workspaceDir:  dir,
		localStore:    store,
		previewReg:    reg,
		settingsStore: settings.New(filepath.Join(dir, "settings.json"), nil),
	}
	app.demoFlow = demoflow.New(demoflow.Options{Recorder: app})
	return app
}
