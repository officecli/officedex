package bridge

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"officedex/internal/types"
)

// TestArtifactStageEditWireCompatibility guards the versioned wire contract
// for every scope emitted by the renderer. Keep this test alongside the
// legacy office.modify tests: a change to the new contract must not silently
// change the old request shape.
func TestArtifactStageEditWireCompatibility(t *testing.T) {
	cases := []struct {
		name  string
		type_ string
		scope types.ArtifactStageScope
		want  map[string]any
	}{
		{
			name:  "document",
			type_: "docx",
			scope: types.ArtifactStageScope{Kind: "document"},
			want:  map[string]any{"kind": "document"},
		},
		{
			name:  "block",
			type_: "docx",
			scope: types.ArtifactStageScope{Kind: "block", Block: &types.ArtifactStageBlockTarget{
				BlockID: "block-1", BlockKind: "paragraph", Path: []int{0, 2},
				TextSHA256: strings.Repeat("a", 64), ParagraphHint: 1,
			}},
			want: map[string]any{
				"kind": "block", "block": map[string]any{
					"block_id": "block-1", "block_kind": "paragraph",
					"path": []any{float64(0), float64(2)}, "text_sha256": strings.Repeat("a", 64),
					"paragraph_hint": float64(1),
				},
			},
		},
		{
			name:  "range",
			type_: "xlsx",
			scope: types.ArtifactStageScope{Kind: "range", Range: &types.ArtifactStageRangeTarget{SheetID: "sheet-1", SheetName: "Summary", A1: "A1:C4"}},
			want:  map[string]any{"kind": "range", "range": map[string]any{"sheet_id": "sheet-1", "sheet_name": "Summary", "a1": "A1:C4"}},
		},
		{
			name:  "gif-frame-range",
			type_: "gif",
			scope: types.ArtifactStageScope{Kind: "region", Region: &types.ArtifactStageRegionTarget{
				X: 0.1, Y: 0.2, Width: 0.5, Height: 0.4,
				Frames: &types.ArtifactStageFrameTarget{Kind: "range", Start: 1, End: 3, FrameCount: 8},
			}},
			want: map[string]any{"kind": "region", "region": map[string]any{
				"x": 0.1, "y": 0.2, "width": 0.5, "height": 0.4,
				"frames": map[string]any{"kind": "range", "start": float64(1), "end": float64(3), "frame_count": float64(8)},
			}},
		},
		{
			name:  "image-region",
			type_: "img",
			scope: types.ArtifactStageScope{Kind: "region", Region: &types.ArtifactStageRegionTarget{
				X: 0, Y: 0, Width: 1, Height: 1,
				Frames: &types.ArtifactStageFrameTarget{Kind: "single", Index: 0, FrameCount: 1},
			}},
			want: map[string]any{"kind": "region", "region": map[string]any{
				"x": 0, "y": 0, "width": 1, "height": 1,
				// Go's wire type omits a zero single-frame index; the runtime
				// treats the omitted value as frame zero for still images.
				"frames": map[string]any{"kind": "single", "frame_count": float64(1)},
			}},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client, fake := newClientWithFake(t)
			defer client.Stop()
			done := make(chan error, 1)
			go func() {
				_, err := client.InvokeArtifactStageEdit(context.Background(), types.ArtifactStageEditInput{
					ArtifactStage: types.ArtifactStageEnvelope{
						Version: 1, Action: "rewrite", Instruction: "update this selection", CostClass: "metered",
						IdempotencyKey: "compat-" + tc.name, ExpectedSHA256: strings.Repeat("b", 64), WriteMode: "new_artifact",
						Target: types.ArtifactStageTarget{ArtifactID: "artifact-compat", ArtifactPath: "/workspace/input." + tc.type_, DocumentType: tc.type_},
						Scope:  tc.scope,
					},
				})
				done <- err
			}()

			opened := fake.readRequest(t)
			if opened.Method != "session/open" {
				t.Fatalf("first method = %q, want session/open", opened.Method)
			}
			fake.writeResponse(t, opened.idString(), map[string]any{"id": "compat-session"}, nil)
			invoked := fake.readRequest(t)
			if invoked.Method != "task/invoke" {
				t.Fatalf("second method = %q, want task/invoke", invoked.Method)
			}
			var params map[string]any
			if err := json.Unmarshal(invoked.Params, &params); err != nil {
				t.Fatalf("decode params: %v", err)
			}
			if params["tool"] != "artifact_stage_edit.v1" || params["interactive"] != true || params["output_format"] != "bundle" {
				t.Fatalf("unexpected invoke envelope: %#v", params)
			}
			args := params["args"].(map[string]any)
			stage := args["artifact_stage"].(map[string]any)
			if stage["version"] != float64(1) || stage["write_mode"] != "new_artifact" || stage["idempotency_key"] != "compat-"+tc.name {
				t.Fatalf("unexpected stage envelope: %#v", stage)
			}
			gotTarget := stage["target"].(map[string]any)
			if gotTarget["document_type"] != tc.type_ || gotTarget["artifact_id"] != "artifact-compat" {
				t.Fatalf("unexpected target: %#v", gotTarget)
			}
			gotScope := stage["scope"].(map[string]any)
			if !jsonEqual(gotScope, tc.want) {
				t.Fatalf("scope = %#v, want %#v", gotScope, tc.want)
			}
			fake.writeResponse(t, invoked.idString(), map[string]any{"task_id": "compat-task", "session_id": "compat-session", "status": "starting"}, nil)
			if err := <-done; err != nil {
				t.Fatalf("InvokeArtifactStageEdit: %v", err)
			}
		})
	}
}

func jsonEqual(got, want map[string]any) bool {
	gotJSON, _ := json.Marshal(got)
	wantJSON, _ := json.Marshal(want)
	var gotValue, wantValue any
	if json.Unmarshal(gotJSON, &gotValue) != nil || json.Unmarshal(wantJSON, &wantValue) != nil {
		return false
	}
	return jsonValueEqual(gotValue, wantValue)
}

func jsonValueEqual(got, want any) bool {
	gotMap, gotIsMap := got.(map[string]any)
	wantMap, wantIsMap := want.(map[string]any)
	if gotIsMap || wantIsMap {
		if !gotIsMap || !wantIsMap || len(gotMap) != len(wantMap) {
			return false
		}
		for key, wantItem := range wantMap {
			gotItem, ok := gotMap[key]
			if !ok || !jsonValueEqual(gotItem, wantItem) {
				return false
			}
		}
		return true
	}
	gotSlice, gotIsSlice := got.([]any)
	wantSlice, wantIsSlice := want.([]any)
	if gotIsSlice || wantIsSlice {
		if !gotIsSlice || !wantIsSlice || len(gotSlice) != len(wantSlice) {
			return false
		}
		for i := range wantSlice {
			if !jsonValueEqual(gotSlice[i], wantSlice[i]) {
				return false
			}
		}
		return true
	}
	return got == want
}
