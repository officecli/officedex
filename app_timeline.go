package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"officedex/internal/pptxeditor"
	"officedex/internal/timeline"
	"officedex/internal/types"
)

// A deck's timeline is the record of how it came to be: one node per slide the
// drawing finished, one per save a person made afterwards. Scrubbing back to a
// node reopens the deck exactly as it stood then — the same document, not a
// picture of it — so the person can keep working from there.

var errTimelineUnavailable = errors.New("deck timeline is unavailable")

// CaptureTimelineNodeInput records the state a session is in right now.
type CaptureTimelineNodeInput struct {
	TaskID       string `json:"taskId"`
	PreviewToken string `json:"previewToken"`
	SessionID    string `json:"sessionId"`
	Kind         string `json:"kind"`
	Seq          int    `json:"seq"`
	Slide        int    `json:"slide"`
	Slides       int    `json:"slides"`
	Label        string `json:"label"`
	Shape        string `json:"shape,omitempty"`
	// Content is the document the editor encoded itself, base64. Recording a
	// step per shape this way costs no save round trip; when it is empty the
	// session's own saved snapshot is read instead.
	Content string `json:"content,omitempty"`
	// WithAssets pulls the session's media across too. Only the step that
	// first needs an image has to: the timeline pool is shared.
	WithAssets bool `json:"withAssets,omitempty"`
	// ArtifactPath names the deck whose generation manifest should be
	// snapshotted with this node, so a later fork restores the AI re-entry
	// context as it stood here. Optional; decks without a manifest record
	// nothing.
	ArtifactPath string `json:"artifactPath,omitempty"`
}

// TimelineDeck points at a node's deck, shaped like the artifacts the preview
// already knows how to open.
type TimelineDeck struct {
	NodeID   string `json:"nodeId"`
	FilePath string `json:"filePath"`
	FileName string `json:"fileName"`
}

// CaptureTimelineNode stores the open session's document as the next node on a
// task's timeline. The caller is responsible for making the editor flush its
// journal first; without that this records the previous save, not the drawing
// that just finished.
func (a *App) CaptureTimelineNode(input CaptureTimelineNodeInput) (timeline.Node, error) {
	if a.timelineStore == nil {
		return timeline.Node{}, errTimelineUnavailable
	}
	content, err := base64.StdEncoding.DecodeString(strings.TrimSpace(input.Content))
	if err != nil {
		return timeline.Node{}, fmt.Errorf("decode step content: %w", err)
	}
	var assets []timeline.Asset
	if len(content) == 0 || input.WithAssets {
		service, ok := a.pptxEditorService.(interface {
			Snapshot(string, string) (pptxeditor.SnapshotResult, error)
		})
		if !ok || service == nil {
			return timeline.Node{}, errPptxEditorUnavailable
		}
		snapshot, err := service.Snapshot(input.PreviewToken, input.SessionID)
		if err != nil {
			return timeline.Node{}, err
		}
		if len(content) == 0 {
			content = snapshot.Content
		}
		assets = make([]timeline.Asset, 0, len(snapshot.Assets))
		for _, asset := range snapshot.Assets {
			assets = append(assets, timeline.Asset{Path: asset.Path, ContentType: asset.ContentType, Data: asset.Data})
		}
	}
	return a.timelineStore.Append(input.TaskID, timeline.Node{
		Kind:   strings.TrimSpace(input.Kind),
		Seq:    input.Seq,
		Slide:  input.Slide,
		Slides: input.Slides,
		Label:  strings.TrimSpace(input.Label),
		Shape:  strings.TrimSpace(input.Shape),
	}, content, assets, readTimelineManifest(input.ArtifactPath))
}

// readTimelineManifest reads the run manifest next to an artifact, for the
// node snapshot. Best-effort: a deck without one records nothing.
func readTimelineManifest(artifactPath string) []byte {
	path := strings.TrimSpace(artifactPath)
	if path == "" {
		return nil
	}
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		path = filepath.Dir(path)
	}
	data, err := os.ReadFile(filepath.Join(path, ".mop-manifest.json"))
	if err != nil {
		return nil
	}
	return data
}

// TimelineState is a task's nodes with its current head — the branch-aware
// strip's input: the head's ancestry is the main line, other leaves are the
// deck's other versions.
type TimelineState struct {
	Nodes  []timeline.Node `json:"nodes"`
	HeadID string          `json:"headId"`
}

// TimelineBranchState returns a task's nodes and current head.
func (a *App) TimelineBranchState(taskID string) (TimelineState, error) {
	if a.timelineStore == nil {
		return TimelineState{}, errTimelineUnavailable
	}
	nodes, head, err := a.timelineStore.State(taskID)
	if err != nil {
		return TimelineState{}, err
	}
	if nodes == nil {
		nodes = []timeline.Node{}
	}
	return TimelineState{Nodes: nodes, HeadID: head}, nil
}

// ResumeFromTimelineNodeInput names the node work continues from.
type ResumeFromTimelineNodeInput struct {
	TaskID string `json:"taskId"`
	NodeID string `json:"nodeId"`
	// ArtifactPath is where the node's recorded generation manifest is
	// restored to, so the re-render ladder works against the forked state.
	ArtifactPath string `json:"artifactPath,omitempty"`
}

type ResumeFromTimelineNodeResult struct {
	Node timeline.Node `json:"node"`
	// ManifestRestored says whether an AI re-entry context came back with
	// the fork; without one the current manifest stays and re-renders may
	// not match the forked page contents.
	ManifestRestored bool `json:"manifestRestored"`
}

// ResumeFromTimelineNode forks the timeline: the head moves to the node, the
// next capture continues from it, and the generation manifest recorded there
// (or at its nearest ancestor) is restored next to the artifact. The editor
// content itself is the caller's job — it has the node already on screen.
func (a *App) ResumeFromTimelineNode(input ResumeFromTimelineNodeInput) (ResumeFromTimelineNodeResult, error) {
	if a.timelineStore == nil {
		return ResumeFromTimelineNodeResult{}, errTimelineUnavailable
	}
	node, manifest, err := a.timelineStore.Resume(input.TaskID, input.NodeID)
	if err != nil {
		return ResumeFromTimelineNodeResult{}, err
	}
	restored := false
	if len(manifest) > 0 {
		path := strings.TrimSpace(input.ArtifactPath)
		if path != "" {
			if info, err := os.Stat(path); err == nil && !info.IsDir() {
				path = filepath.Dir(path)
			}
			if err := os.WriteFile(filepath.Join(path, ".mop-manifest.json"), manifest, 0o644); err == nil {
				restored = true
			}
		}
	}
	return ResumeFromTimelineNodeResult{Node: node, ManifestRestored: restored}, nil
}

// ListTimeline returns a task's nodes, oldest first.
func (a *App) ListTimeline(taskID string) ([]timeline.Node, error) {
	if a.timelineStore == nil {
		return nil, errTimelineUnavailable
	}
	nodes, err := a.timelineStore.List(taskID)
	if err != nil {
		return nil, err
	}
	if nodes == nil {
		nodes = []timeline.Node{}
	}
	return nodes, nil
}

// TimelineSnapshot is a node's document, ready to be swapped into an editor
// that is already open. It carries no PPTX: the round trip through
// mop-convert exists only for hosts that must reopen a file.
type TimelineSnapshot struct {
	NodeID   string           `json:"nodeId"`
	Content  []byte           `json:"content"`
	Assets   []timeline.Asset `json:"assets,omitempty"`
	Revision int              `json:"revision"`
}

// ReadTimelineNode returns the document a node holds.
func (a *App) ReadTimelineNode(input OpenTimelineNodeInput) (TimelineSnapshot, error) {
	if a.timelineStore == nil {
		return TimelineSnapshot{}, errTimelineUnavailable
	}
	content, assets, err := a.timelineStore.Snapshot(input.TaskID, input.NodeID)
	if err != nil {
		return TimelineSnapshot{}, err
	}
	return TimelineSnapshot{NodeID: input.NodeID, Content: content, Assets: assets}, nil
}

// ReadEditorDocumentInput names an open editing session.
type ReadEditorDocumentInput struct {
	PreviewToken string `json:"previewToken"`
	SessionID    string `json:"sessionId"`
}

// ReadEditorDocument returns the document an open session holds. Scrubbing back
// through a history swaps the editor's document, so the state being left has to
// be kept somewhere to return to.
func (a *App) ReadEditorDocument(input ReadEditorDocumentInput) (TimelineSnapshot, error) {
	service, ok := a.pptxEditorService.(interface {
		Snapshot(string, string) (pptxeditor.SnapshotResult, error)
	})
	if !ok || service == nil {
		return TimelineSnapshot{}, errPptxEditorUnavailable
	}
	snapshot, err := service.Snapshot(input.PreviewToken, input.SessionID)
	if err != nil {
		return TimelineSnapshot{}, err
	}
	assets := make([]timeline.Asset, 0, len(snapshot.Assets))
	for _, asset := range snapshot.Assets {
		assets = append(assets, timeline.Asset{Path: asset.Path, ContentType: asset.ContentType, Data: asset.Data})
	}
	return TimelineSnapshot{Content: snapshot.Content, Assets: assets, Revision: snapshot.Revision}, nil
}

// OpenTimelineNodeInput addresses one node of a task's timeline.
type OpenTimelineNodeInput struct {
	TaskID string `json:"taskId"`
	NodeID string `json:"nodeId"`
}

// OpenTimelineNode turns a node back into a deck the preview can open, and
// grants access to it. The conversion is cached by the store, so scrubbing
// back and forth across a timeline pays for each node once.
func (a *App) OpenTimelineNode(input OpenTimelineNodeInput) (TimelineDeck, error) {
	if a.timelineStore == nil {
		return TimelineDeck{}, errTimelineUnavailable
	}
	path, err := a.timelineStore.Materialize(context.Background(), input.TaskID, input.NodeID)
	if err != nil {
		return TimelineDeck{}, err
	}
	artifact := types.Artifact{FilePath: path, FileName: filepath.Base(path), DocumentType: "pptx"}
	if err := a.previewReg.AllowArtifact(artifact); err != nil {
		return TimelineDeck{}, fmt.Errorf("grant timeline deck: %w", err)
	}
	return TimelineDeck{NodeID: input.NodeID, FilePath: path, FileName: filepath.Base(path)}, nil
}
