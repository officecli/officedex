package main

import (
	"bytes"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"officedex/internal/types"
)

// blankPptxDraft is a minimal one-slide deck exported from the learnof/pptx
// blank-presentation fixture through mop-convert. It seeds the live drawing
// preview: the presentation editor opens it instantly while a generation task
// is still running, and the vibe replay driver then draws the deck into it
// object by object.
//
//go:embed internal/pptxeditor/assets/blank.pptx
var blankPptxDraft []byte

var livePptxTaskIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// newestBlankLivePptxDraft returns the task's latest draft when nothing has
// been drawn into it yet, and "" otherwise.
func newestBlankLivePptxDraft(liveDir, taskID string) string {
	run, drafts := nextLivePptxDraftRun(liveDir, taskID)
	latest := filepath.Join(liveDir, fmt.Sprintf("live-%s-%d.pptx", taskID, run-1))
	for _, path := range drafts {
		if path != latest {
			continue
		}
		data, err := os.ReadFile(path)
		if err == nil && bytes.Equal(data, blankPptxDraft) {
			return path
		}
	}
	return ""
}

// nextLivePptxDraftRun picks the run number for a new draft and lists the
// drafts of earlier runs, which are no longer anyone's document.
//
// Names are matched against the task's own prefix rather than parsed: a task
// id contains digits and dashes of its own, so "live-task-1.pptx" is otherwise
// indistinguishable from run 1 of task "task".
func nextLivePptxDraftRun(liveDir, taskID string) (int, []string) {
	entries, err := os.ReadDir(liveDir)
	if err != nil {
		return 1, nil
	}
	legacy := "live-" + taskID + ".pptx"
	prefix := "live-" + taskID + "-"
	run := 0
	var stale []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if name == legacy {
			// A draft from before runs were numbered.
			stale = append(stale, filepath.Join(liveDir, name))
			continue
		}
		if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, ".pptx") {
			continue
		}
		previous, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(name, prefix), ".pptx"))
		if err != nil {
			continue
		}
		stale = append(stale, filepath.Join(liveDir, name))
		if previous > run {
			run = previous
		}
	}
	return run + 1, stale
}

// LivePptxDraft is the artifact-shaped handle for a live drawing session.
type LivePptxDraft struct {
	FilePath string `json:"filePath"`
	FileName string `json:"fileName"`
}

// CreateLivePptxDraft writes a fresh blank deck for the given generation task
// and registers it with the preview access registry, so the renderer can open
// the presentation editor on it before the task has produced any artifact.
func (a *App) CreateLivePptxDraft(taskID string) (LivePptxDraft, error) {
	taskID = strings.TrimSpace(taskID)
	if !livePptxTaskIDPattern.MatchString(taskID) {
		return LivePptxDraft{}, fmt.Errorf("invalid task id")
	}
	liveDir := filepath.Join(a.workspaceDir, "live")
	if err := os.MkdirAll(liveDir, 0o755); err != nil {
		return LivePptxDraft{}, fmt.Errorf("create live draft directory: %w", err)
	}
	// Every drawing gets its own file. Reusing one name meant a fresh drawing
	// overwrote the file an earlier session had fingerprinted, and that session
	// — still alive behind a reloaded page — then failed every save with
	// "source PPTX changed externally".
	// Asking twice for the same fresh draft — a double-invoked effect, a retry
	// — must not replace the draft a drawing is already using: doing so pulls
	// the file out from under its session and the drawing hangs. An untouched
	// draft is already what the caller wants, so hand it back.
	if reusable := newestBlankLivePptxDraft(liveDir, taskID); reusable != "" {
		artifact := types.Artifact{FilePath: reusable, FileName: filepath.Base(reusable), DocumentType: "pptx"}
		if err := a.previewReg.AllowArtifact(artifact); err != nil {
			return LivePptxDraft{}, err
		}
		return LivePptxDraft{FilePath: reusable, FileName: filepath.Base(reusable)}, nil
	}
	run, stale := nextLivePptxDraftRun(liveDir, taskID)
	filePath := filepath.Join(liveDir, fmt.Sprintf("live-%s-%d.pptx", taskID, run))
	if err := os.WriteFile(filePath, blankPptxDraft, 0o644); err != nil {
		return LivePptxDraft{}, fmt.Errorf("write live draft: %w", err)
	}
	// The drafts of earlier drawings describe a deck that no longer exists.
	// Any session still editing one is retired first: pulling the file out
	// from under it would leave it failing every save it attempts.
	closer, _ := a.pptxEditorService.(interface{ CloseByFile(string) error })
	for _, path := range stale {
		if closer != nil {
			_ = closer.CloseByFile(path)
		}
		_ = os.Remove(path)
	}
	// The draft starts blank, so the deck's recorded history starts over with
	// it; the previous drawing's nodes describe a document that is gone.
	if a.timelineStore != nil {
		if err := a.timelineStore.Reset(taskID); err != nil {
			return LivePptxDraft{}, err
		}
	}
	artifact := types.Artifact{FilePath: filePath, FileName: filepath.Base(filePath), DocumentType: "pptx"}
	if err := a.previewReg.AllowArtifact(artifact); err != nil {
		return LivePptxDraft{}, err
	}
	return LivePptxDraft{FilePath: filePath, FileName: filepath.Base(filePath)}, nil
}
