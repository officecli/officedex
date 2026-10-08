package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"officedex/internal/bridge"
)

type fakePptxJSPlanner struct {
	input  bridge.PlanPptxJSInput
	result bridge.PlanPptxJSResult
	err    error
	calls  int
}

func (f *fakePptxJSPlanner) PlanPptxJS(_ context.Context, input bridge.PlanPptxJSInput) (bridge.PlanPptxJSResult, error) {
	f.calls++
	f.input = input
	return f.result, f.err
}

func TestPlanPptxJSForwardsContextAndHistoryToBridgePlanner(t *testing.T) {
	planner := &fakePptxJSPlanner{result: bridge.PlanPptxJSResult{
		Summary:    "已将选中标题改为 OfficeDex 演示。",
		Source:     `return await PowerPoint.run(async (context) => { await context.sync(); return { changed: 1 }; });`,
		Confidence: "high",
	}}
	app := &App{ctx: context.Background(), pptxJSPlanner: planner}
	editorContext := map[string]any{
		"slides":           []any{map[string]any{"id": "slide-1", "index": 0}},
		"selectedSlideIds": []any{"slide-1"},
		"selectedShapes":   []any{map[string]any{"id": "title", "type": "Placeholder"}},
	}
	result, err := app.PlanPptxJS(PlanPptxJSInput{
		Prompt:  "  把选中的标题改为 OfficeDex 演示，但字体、颜色和位置不变  ",
		Context: editorContext,
		History: []PlanPptxJSTurn{{Role: "user", Content: "先看看"}, {Role: "assistant", Content: "  "}},
	})
	if err != nil {
		t.Fatalf("PlanPptxJS: %v", err)
	}
	if planner.calls != 1 {
		t.Fatalf("planner calls = %d", planner.calls)
	}
	if planner.input.Prompt != "把选中的标题改为 OfficeDex 演示，但字体、颜色和位置不变" {
		t.Fatalf("prompt = %q", planner.input.Prompt)
	}
	if len(planner.input.History) != 1 || planner.input.History[0].Content != "先看看" {
		t.Fatalf("history = %#v", planner.input.History)
	}
	ctx, ok := planner.input.Context.(map[string]any)
	if !ok || len(ctx["selectedShapes"].([]any)) != 1 {
		t.Fatalf("context = %#v", planner.input.Context)
	}
	if result.RequiresConfirmation || result.Confirmation != nil || result.Warnings == nil {
		t.Fatalf("result = %#v", result)
	}
	if !strings.Contains(result.Source, "PowerPoint.run") {
		t.Fatalf("source = %q", result.Source)
	}
}

func TestPlanPptxJSForcesConfirmationForLowConfidenceAndValidatesInput(t *testing.T) {
	planner := &fakePptxJSPlanner{result: bridge.PlanPptxJSResult{
		Summary:    "Guessing the target.",
		Source:     `return await PowerPoint.run(async (context) => { await context.sync(); });`,
		Confidence: "low",
	}}
	app := &App{ctx: context.Background(), pptxJSPlanner: planner}
	result, err := app.PlanPptxJS(PlanPptxJSInput{Prompt: "change it", Context: map[string]any{"slides": []any{}}})
	if err != nil {
		t.Fatalf("PlanPptxJS: %v", err)
	}
	if !result.RequiresConfirmation || result.Confirmation == nil || result.Confirmation.Message != "Guessing the target." {
		t.Fatalf("low confidence must confirm: %#v", result)
	}

	if _, err := app.PlanPptxJS(PlanPptxJSInput{Prompt: " ", Context: map[string]any{}}); err == nil {
		t.Fatal("empty prompt accepted")
	}
	if _, err := app.PlanPptxJS(PlanPptxJSInput{Prompt: "x", Context: nil}); err == nil {
		t.Fatal("nil context accepted")
	}
	if planner.calls != 1 {
		t.Fatalf("invalid inputs must not reach the planner: calls = %d", planner.calls)
	}

	failing := &fakePptxJSPlanner{err: errors.New("bridge down")}
	app = &App{ctx: context.Background(), pptxJSPlanner: failing}
	if _, err := app.PlanPptxJS(PlanPptxJSInput{Prompt: "x", Context: map[string]any{}}); err == nil || !strings.Contains(err.Error(), "bridge down") {
		t.Fatalf("planner error not surfaced: %v", err)
	}
	empty := &fakePptxJSPlanner{result: bridge.PlanPptxJSResult{Summary: "nothing"}}
	app = &App{ctx: context.Background(), pptxJSPlanner: empty}
	if _, err := app.PlanPptxJS(PlanPptxJSInput{Prompt: "x", Context: map[string]any{}}); err == nil || !strings.Contains(err.Error(), "empty source") {
		t.Fatalf("empty source not rejected: %v", err)
	}
}
