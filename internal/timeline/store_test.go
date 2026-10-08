package timeline

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakeConverter struct {
	calls int
	mops  []string
	err   error
}

func (c *fakeConverter) ExportPptx(_ context.Context, mop, output string) error {
	c.calls++
	c.mops = append(c.mops, mop)
	if c.err != nil {
		return c.err
	}
	content, err := os.ReadFile(filepath.Join(mop, "content.json"))
	if err != nil {
		return err
	}
	media, _ := os.ReadDir(filepath.Join(mop, "media"))
	names := make([]string, 0, len(media))
	for _, entry := range media {
		names = append(names, entry.Name())
	}
	return os.WriteFile(output, []byte("PK|"+string(content)+"|"+strings.Join(names, ",")), 0o644)
}

func newStore(t *testing.T, converter Converter) *Store {
	t.Helper()
	store := New(filepath.Join(t.TempDir(), "timeline"), converter)
	stamp := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time {
		stamp = stamp.Add(time.Minute)
		return stamp
	}
	return store
}

func photo(name string) Asset {
	return Asset{Path: "media/" + name, ContentType: "image/jpeg", Data: []byte("bytes-of-" + name)}
}

func TestAppendRecordsAnOrderedChain(t *testing.T) {
	store := newStore(t, nil)

	first, err := store.Append("task-1", Node{Slide: 1, Slides: 3, Seq: 5, Label: "第 1 页完成"}, []byte(`{"v":1}`), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Append("task-1", Node{Slide: 2, Slides: 3, Seq: 12, Label: "第 2 页完成"}, []byte(`{"v":2}`), nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	if first.ID != "n001" || second.ID != "n002" {
		t.Fatalf("ids = %s, %s", first.ID, second.ID)
	}
	// Each node continues the one before it, so a fork has a parent to hang off
	// without the layout changing later.
	if first.ParentID != "" || second.ParentID != "n001" {
		t.Fatalf("parents = %q, %q", first.ParentID, second.ParentID)
	}
	if first.Kind != "generation" || first.CreatedAt == "" {
		t.Fatalf("node = %#v", first)
	}
	nodes, err := store.List("task-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 2 || nodes[0].Label != "第 1 页完成" || nodes[1].Slide != 2 {
		t.Fatalf("nodes = %#v", nodes)
	}
}

func TestAppendSharesMediaAcrossNodes(t *testing.T) {
	store := newStore(t, nil)
	cover := photo("cover.jpg")

	if _, err := store.Append("task-1", Node{Slide: 1}, []byte(`{"v":1}`), []Asset{cover}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Append("task-1", Node{Slide: 2}, []byte(`{"v":2}`), []Asset{cover, photo("chart.jpg")}, nil); err != nil {
		t.Fatal(err)
	}

	// The photo that appears on both slides is stored once: nodes are cheap
	// precisely because media is shared by content digest.
	entries, err := os.ReadDir(filepath.Join(store.root, "task-1", "assets", "media"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("assets = %v, want cover + chart", entries)
	}
	for _, name := range []string{"cover.jpg", "chart.jpg"} {
		data, err := os.ReadFile(filepath.Join(store.root, "task-1", "assets", "media", name))
		if err != nil || string(data) != "bytes-of-"+name {
			t.Fatalf("asset %s = %q (%v)", name, data, err)
		}
	}
}

func TestMaterializeExportsTheDeckAsItStoodAtANode(t *testing.T) {
	converter := &fakeConverter{}
	store := newStore(t, converter)
	if _, err := store.Append("task-1", Node{Slide: 1}, []byte(`{"v":1}`), []Asset{photo("cover.jpg")}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Append("task-1", Node{Slide: 2}, []byte(`{"v":2}`), nil, nil); err != nil {
		t.Fatal(err)
	}

	deck, err := store.Materialize(context.Background(), "task-1", "n001")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(deck)
	if err != nil {
		t.Fatal(err)
	}
	// The earlier node's own document, with the timeline's media alongside it.
	if string(data) != "PK|{\"v\":1}|cover.jpg" {
		t.Fatalf("deck = %q", data)
	}
	if _, err := os.Stat(store.root); err != nil {
		t.Fatal(err)
	}
	// Staging is cleaned up; only the cached deck remains.
	entries, _ := os.ReadDir(filepath.Join(store.root, "task-1"))
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".materialize-") {
			t.Fatalf("staging directory left behind: %s", entry.Name())
		}
	}
}

func TestMaterializeReusesTheExportedDeck(t *testing.T) {
	converter := &fakeConverter{}
	store := newStore(t, converter)
	if _, err := store.Append("task-1", Node{Slide: 1}, []byte(`{"v":1}`), nil, nil); err != nil {
		t.Fatal(err)
	}

	first, err := store.Materialize(context.Background(), "task-1", "n001")
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Materialize(context.Background(), "task-1", "n001")
	if err != nil {
		t.Fatal(err)
	}
	// A node never changes, so scrubbing back to one repeatedly must not pay
	// for a conversion every time.
	if first != second || converter.calls != 1 {
		t.Fatalf("exports = %d (%s, %s)", converter.calls, first, second)
	}
}

func TestMaterializeNamesTheDeckAfterTheNode(t *testing.T) {
	store := newStore(t, &fakeConverter{})
	if _, err := store.Append("task-1", Node{Slide: 2, Label: "第 2 页完成"}, []byte(`{"v":1}`), nil, nil); err != nil {
		t.Fatal(err)
	}
	deck, err := store.Materialize(context.Background(), "task-1", "n001")
	if err != nil {
		t.Fatal(err)
	}
	// The preview titles a deck by its file name, so the file has to read the
	// way the node does.
	if filepath.Base(deck) != "第 2 页完成.pptx" {
		t.Fatalf("deck = %s", deck)
	}
}

func TestMaterializeNamesADeckWithAnUnusableLabel(t *testing.T) {
	store := newStore(t, &fakeConverter{})
	if _, err := store.Append("task-1", Node{Slide: 1, Label: "  ../.. "}, []byte(`{"v":1}`), nil, nil); err != nil {
		t.Fatal(err)
	}
	deck, err := store.Materialize(context.Background(), "task-1", "n001")
	if err != nil {
		t.Fatal(err)
	}
	// A label that cannot be a file name must not become a path of its own.
	if filepath.Base(deck) != "n001.pptx" {
		t.Fatalf("deck = %s", deck)
	}
}

func TestMaterializeReportsAnUnknownNode(t *testing.T) {
	store := newStore(t, &fakeConverter{})
	if _, err := store.Materialize(context.Background(), "task-1", "n404"); err == nil {
		t.Fatal("an unknown node must not resolve")
	}
}

func TestMaterializeSurfacesAConversionFailure(t *testing.T) {
	converter := &fakeConverter{err: errors.New("mop-convert exploded")}
	store := newStore(t, converter)
	if _, err := store.Append("task-1", Node{Slide: 1}, []byte(`{"v":1}`), nil, nil); err != nil {
		t.Fatal(err)
	}
	_, err := store.Materialize(context.Background(), "task-1", "n001")
	if err == nil || !strings.Contains(err.Error(), "mop-convert exploded") {
		t.Fatalf("err = %v", err)
	}
	// A failed export must not leave a truncated deck behind to be served as a
	// cache hit next time.
	if entries, err := os.ReadDir(filepath.Join(store.root, "task-1", "decks", "n001")); err == nil && len(entries) > 0 {
		t.Fatalf("a failed export left %v behind", entries)
	}
}

func TestStoreRejectsUnsafeIdentifiersAndPaths(t *testing.T) {
	store := newStore(t, nil)
	for _, taskID := range []string{"", "../escape", "task/../..", strings.Repeat("x", 65)} {
		if _, err := store.Append(taskID, Node{}, []byte(`{}`), nil, nil); err == nil {
			t.Fatalf("task id %q was accepted", taskID)
		}
	}
	if _, err := store.Append("task-1", Node{}, []byte(`{}`), []Asset{{Path: "../../escape.jpg", Data: []byte("x")}}, nil); err == nil {
		t.Fatal("an asset path escaping the store was accepted")
	}
	if _, err := store.Append("task-1", Node{}, nil, nil, nil); err == nil {
		t.Fatal("empty content was accepted")
	}
}

func TestResetStartsATaskHistoryOver(t *testing.T) {
	store := newStore(t, &fakeConverter{})
	if _, err := store.Append("task-1", Node{Slide: 1, Label: "第 1 页完成"}, []byte(`{"v":1}`), []Asset{photo("cover.jpg")}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Append("task-1", Node{Slide: 2}, []byte(`{"v":2}`), nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Materialize(context.Background(), "task-1", "n001"); err != nil {
		t.Fatal(err)
	}

	if err := store.Reset("task-1"); err != nil {
		t.Fatal(err)
	}

	nodes, err := store.List("task-1")
	if err != nil || len(nodes) != 0 {
		t.Fatalf("nodes after reset = %#v (%v)", nodes, err)
	}
	// A redraw must read as one history, not as a deck that drew every slide
	// twice: the next node is the first one again.
	next, err := store.Append("task-1", Node{Slide: 1, Label: "第 1 页完成"}, []byte(`{"v":9}`), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if next.ID != "n001" || next.ParentID != "" {
		t.Fatalf("node after reset = %#v", next)
	}
	// The old nodes' content and exported decks go with them.
	if _, err := os.Stat(filepath.Join(store.root, "task-1", "decks", "n001")); !os.IsNotExist(err) {
		t.Fatal("a stale deck survived the reset")
	}
	if _, err := os.Stat(filepath.Join(store.root, "task-1", "assets", "media", "cover.jpg")); !os.IsNotExist(err) {
		t.Fatal("stale media survived the reset")
	}
}

func TestResetIsHarmlessForATaskWithNoTimeline(t *testing.T) {
	store := newStore(t, nil)
	if err := store.Reset("task-fresh"); err != nil {
		t.Fatalf("resetting an untouched task failed: %v", err)
	}
	if err := store.Reset("../escape"); err == nil {
		t.Fatal("an unsafe task id was accepted")
	}
}

func TestListIsEmptyForATaskWithNoTimeline(t *testing.T) {
	store := newStore(t, nil)
	nodes, err := store.List("task-unknown")
	if err != nil || len(nodes) != 0 {
		t.Fatalf("nodes = %#v (%v)", nodes, err)
	}
}

func TestNodesSurviveAsPlainJSONOnDisk(t *testing.T) {
	store := newStore(t, nil)
	if _, err := store.Append("task-1", Node{Slide: 1, Label: "第 1 页完成"}, []byte(`{"v":1}`), nil, nil); err != nil {
		t.Fatal(err)
	}
	// A fresh store over the same root sees the same timeline: nodes outlive
	// the process that recorded them.
	reopened := New(store.root, nil)
	nodes, err := reopened.List("task-1")
	if err != nil || len(nodes) != 1 || nodes[0].Label != "第 1 页完成" {
		t.Fatalf("nodes = %#v (%v)", nodes, err)
	}
	raw, err := os.ReadFile(filepath.Join(store.root, "task-1", nodesFileName))
	if err != nil {
		t.Fatal(err)
	}
	var decoded []Node
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("nodes.json is not readable JSON: %v", err)
	}
}

func TestResumeForksTheTimeline(t *testing.T) {
	store := New(t.TempDir(), nil)
	first, err := store.Append("task-1", Node{Label: "第 1 页"}, []byte(`{"v":1}`), nil, []byte(`{"m":1}`))
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Append("task-1", Node{Label: "第 2 页"}, []byte(`{"v":2}`), nil, []byte(`{"m":2}`))
	if err != nil {
		t.Fatal(err)
	}
	// A node captured without a manifest (a mid-generation step, an editor
	// save) inherits the nearest ancestor's on resume.
	third, err := store.Append("task-1", Node{Kind: "edit", Label: "你的编辑"}, []byte(`{"v":3}`), nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	// Fork back to the first node: the head moves, and the manifest recorded
	// there comes back with it.
	resumed, manifest, err := store.Resume("task-1", first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if resumed.ID != first.ID || string(manifest) != `{"m":1}` {
		t.Fatalf("resume = %s manifest=%s", resumed.ID, manifest)
	}
	// The next node continues from the fork point, not from the last node.
	fork, err := store.Append("task-1", Node{Kind: "edit", Label: "分支上的改动"}, []byte(`{"v":4}`), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if fork.ParentID != first.ID {
		t.Fatalf("fork parent = %s, want %s", fork.ParentID, first.ID)
	}
	nodes, head, err := store.State("task-1")
	if err != nil {
		t.Fatal(err)
	}
	if head != fork.ID || len(nodes) != 4 {
		t.Fatalf("state = head:%s nodes:%d", head, len(nodes))
	}

	// Resuming the manifest-less node walks up to its ancestor's manifest.
	if _, manifest, err = store.Resume("task-1", third.ID); err != nil || string(manifest) != `{"m":2}` {
		t.Fatalf("ancestor manifest = %s (%v)", manifest, err)
	}
	if _, ok := findNode(nodes, second.ID); !ok {
		t.Fatal("the abandoned branch's node must survive as another version")
	}
}
