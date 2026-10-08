// Package timeline keeps the ordered snapshots of a deck as it is produced:
// one node per drawn slide while a generation streams, and one per save while
// a person edits. Scrubbing back to any of them reopens the deck exactly as it
// stood at that moment.
//
// A node stores the MOP document and nothing else. Media is shared across the
// whole timeline under its content digest, so a deck with a 3MB photo on every
// slide still costs one copy of the photo plus a few tens of KB per node.
package timeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Node is one point on a deck's timeline.
type Node struct {
	ID string `json:"id"`
	// ParentID is the node this one continues from. It is the previous node on
	// an unbroken line, and the scrub target when work forks from the middle —
	// stored from the start so a fork does not need the layout to change.
	ParentID string `json:"parentId,omitempty"`
	// Kind is "generation" for a node the drawing produced, "edit" for one a
	// person's save produced.
	Kind string `json:"kind"`
	// Seq is the drawing op this node follows; 0 for an edit.
	Seq int `json:"seq,omitempty"`
	// Shape names the object this step put on the page, so returning to the
	// step can go to it and select it. Empty when the step drew nothing.
	Shape     string `json:"shape,omitempty"`
	Slide     int    `json:"slide,omitempty"`
	Slides    int    `json:"slides,omitempty"`
	Label     string `json:"label"`
	CreatedAt string `json:"createdAt"`
}

// Asset is one media file the node's document references.
type Asset struct {
	Path        string `json:"path"`
	ContentType string `json:"contentType"`
	Data        []byte `json:"data"`
}

// Converter exports a MOP package to PPTX; the pptx editor's converter
// satisfies it.
type Converter interface {
	ExportPptx(context.Context, string, string) error
}

const (
	maxContentBytes  = int64(512 << 20)
	maxAssetBytes    = int64(100 << 20)
	nodesFileName    = "nodes.json"
	headFileName     = "head"
	manifestsDirName = "manifests"
)

var taskIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// Store holds every task's timeline under one root directory.
type Store struct {
	mu        sync.Mutex
	root      string
	converter Converter
	now       func() time.Time
}

func New(root string, converter Converter) *Store {
	return &Store{root: root, converter: converter, now: time.Now}
}

// Append records a new node continuing from the task's current head. The
// content is the MOP document as it stands; assets are the media it
// references, and only the ones the timeline has not seen are written. The
// optional manifest is the deck's generation context at this moment — what a
// later fork restores so AI re-entry works against the forked state, not the
// newest one.
func (s *Store) Append(taskID string, node Node, content []byte, assets []Asset, manifest []byte) (Node, error) {
	if len(content) == 0 || int64(len(content)) > maxContentBytes {
		return Node{}, errors.New("timeline: invalid node content size")
	}
	directory, err := s.taskDirectory(taskID)
	if err != nil {
		return Node{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	nodes, err := s.readNodes(directory)
	if err != nil {
		return Node{}, err
	}
	node.ID = fmt.Sprintf("n%03d", len(nodes)+1)
	node.CreatedAt = s.now().UTC().Format(time.RFC3339)
	if node.ParentID == "" && len(nodes) > 0 {
		// Work continues from the head, which is the last node only until a
		// fork moves it: after a resume the line branches from mid-history.
		node.ParentID = s.readHead(directory, nodes)
	}
	if strings.TrimSpace(node.Kind) == "" {
		node.Kind = "generation"
	}
	for _, directory := range []string{filepath.Join(directory, "content"), filepath.Join(directory, "assets")} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			return Node{}, fmt.Errorf("timeline: create directory: %w", err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, "content", node.ID+".json"), content, 0o644); err != nil {
		return Node{}, fmt.Errorf("timeline: write node content: %w", err)
	}
	if err := writeAssets(filepath.Join(directory, "assets"), assets); err != nil {
		return Node{}, err
	}
	if len(manifest) > 0 {
		manifestsDir := filepath.Join(directory, manifestsDirName)
		if err := os.MkdirAll(manifestsDir, 0o755); err != nil {
			return Node{}, fmt.Errorf("timeline: create manifests directory: %w", err)
		}
		if err := os.WriteFile(filepath.Join(manifestsDir, node.ID+".json"), manifest, 0o644); err != nil {
			return Node{}, fmt.Errorf("timeline: write node manifest: %w", err)
		}
	}
	nodes = append(nodes, node)
	if err := s.writeNodes(directory, nodes); err != nil {
		return Node{}, err
	}
	if err := s.writeHead(directory, node.ID); err != nil {
		return Node{}, err
	}
	return node, nil
}

// readHead returns the task's current head node id; without a recorded head
// (a pre-fork timeline) the last node is the head, exactly as before.
func (s *Store) readHead(directory string, nodes []Node) string {
	if data, err := os.ReadFile(filepath.Join(directory, headFileName)); err == nil {
		id := strings.TrimSpace(string(data))
		if _, ok := findNode(nodes, id); ok {
			return id
		}
	}
	if len(nodes) > 0 {
		return nodes[len(nodes)-1].ID
	}
	return ""
}

func (s *Store) writeHead(directory, nodeID string) error {
	if err := os.WriteFile(filepath.Join(directory, headFileName), []byte(nodeID), 0o644); err != nil {
		return fmt.Errorf("timeline: write head: %w", err)
	}
	return nil
}

// State returns a task's nodes with its current head — what a branch-aware
// strip renders: the head's ancestry is the main line, other leaves are the
// deck's other versions.
func (s *Store) State(taskID string) ([]Node, string, error) {
	directory, err := s.taskDirectory(taskID)
	if err != nil {
		return nil, "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	nodes, err := s.readNodes(directory)
	if err != nil {
		return nil, "", err
	}
	return nodes, s.readHead(directory, nodes), nil
}

// Resume moves the task's head to a node: the next Append continues from it,
// which is what forking is. It returns the generation manifest recorded at
// that node — or, when the node itself has none, the nearest ancestor's — so
// the caller can restore the deck's AI re-entry context to match.
func (s *Store) Resume(taskID, nodeID string) (Node, []byte, error) {
	directory, err := s.taskDirectory(taskID)
	if err != nil {
		return Node{}, nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	nodes, err := s.readNodes(directory)
	if err != nil {
		return Node{}, nil, err
	}
	node, ok := findNode(nodes, nodeID)
	if !ok {
		return Node{}, nil, fmt.Errorf("timeline: node not found: %s", nodeID)
	}
	if err := s.writeHead(directory, node.ID); err != nil {
		return Node{}, nil, err
	}
	manifestsDir := filepath.Join(directory, manifestsDirName)
	for current, hops := node, 0; hops < len(nodes)+1; hops++ {
		if data, err := os.ReadFile(filepath.Join(manifestsDir, current.ID+".json")); err == nil {
			return node, data, nil
		}
		if current.ParentID == "" {
			break
		}
		parent, ok := findNode(nodes, current.ParentID)
		if !ok {
			break
		}
		current = parent
	}
	return node, nil, nil
}

// Reset clears a task's timeline. Drawing a deck from blank starts its history
// over: the nodes from the previous drawing describe a document that no longer
// exists, and keeping them would read as one long deck that drew every slide
// twice.
func (s *Store) Reset(taskID string) error {
	directory, err := s.taskDirectory(taskID)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.RemoveAll(directory); err != nil {
		return fmt.Errorf("timeline: reset: %w", err)
	}
	return nil
}

// List returns a task's nodes in the order they were recorded.
func (s *Store) List(taskID string) ([]Node, error) {
	directory, err := s.taskDirectory(taskID)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readNodes(directory)
}

// Snapshot returns the document a node holds, with the media it references.
// This is what an editor that can swap documents in place needs; it skips the
// two conversions Materialize pays for.
func (s *Store) Snapshot(taskID, nodeID string) ([]byte, []Asset, error) {
	directory, err := s.taskDirectory(taskID)
	if err != nil {
		return nil, nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	nodes, err := s.readNodes(directory)
	if err != nil {
		return nil, nil, err
	}
	if _, found := findNode(nodes, nodeID); !found {
		return nil, nil, fmt.Errorf("timeline: unknown node %q", nodeID)
	}
	content, err := os.ReadFile(filepath.Join(directory, "content", nodeID+".json"))
	if err != nil {
		return nil, nil, fmt.Errorf("timeline: read node content: %w", err)
	}
	assets, err := readAssets(filepath.Join(directory, "assets"))
	if err != nil {
		return nil, nil, err
	}
	return content, assets, nil
}

// readAssets loads the timeline's shared media pool.
func readAssets(root string) ([]Asset, error) {
	var assets []Asset
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if os.IsNotExist(walkErr) {
				return filepath.SkipAll
			}
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("timeline: read asset: %w", err)
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		assets = append(assets, Asset{
			Path:        filepath.ToSlash(relative),
			ContentType: mime.TypeByExtension(filepath.Ext(path)),
			Data:        data,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return assets, nil
}

// Materialize writes the deck as it stood at one node to a PPTX file and
// returns its path. The file is cached: a node never changes, so the same node
// is only ever exported once.
func (s *Store) Materialize(ctx context.Context, taskID, nodeID string) (string, error) {
	directory, err := s.taskDirectory(taskID)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	nodes, err := s.readNodes(directory)
	if err != nil {
		return "", err
	}
	node, found := findNode(nodes, nodeID)
	if !found {
		return "", fmt.Errorf("timeline: unknown node %q", nodeID)
	}
	// The preview names a deck after its file, so the file carries the node's
	// label: a person scrubbing back should read "第 2 页完成", not "n002".
	deck := filepath.Join(directory, "decks", nodeID, deckFileName(node))
	if info, err := os.Stat(deck); err == nil && info.Size() > 0 {
		return deck, nil
	}
	if s.converter == nil {
		return "", errors.New("timeline: no converter is available")
	}
	content, err := os.ReadFile(filepath.Join(directory, "content", nodeID+".json"))
	if err != nil {
		return "", fmt.Errorf("timeline: read node content: %w", err)
	}
	staging, err := os.MkdirTemp(directory, ".materialize-")
	if err != nil {
		return "", fmt.Errorf("timeline: staging directory: %w", err)
	}
	defer os.RemoveAll(staging)
	mop := filepath.Join(staging, "presentation.mop")
	if err := os.MkdirAll(mop, 0o755); err != nil {
		return "", fmt.Errorf("timeline: staging package: %w", err)
	}
	if err := os.WriteFile(filepath.Join(mop, "content.json"), content, 0o644); err != nil {
		return "", fmt.Errorf("timeline: stage node content: %w", err)
	}
	if err := copyTree(filepath.Join(directory, "assets"), mop); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(deck), 0o755); err != nil {
		return "", fmt.Errorf("timeline: create deck directory: %w", err)
	}
	if err := s.converter.ExportPptx(ctx, mop, deck); err != nil {
		return "", fmt.Errorf("timeline: export node %s: %w", nodeID, err)
	}
	return deck, nil
}

func (s *Store) taskDirectory(taskID string) (string, error) {
	if !taskIDPattern.MatchString(taskID) {
		return "", errors.New("timeline: invalid task id")
	}
	if strings.TrimSpace(s.root) == "" {
		return "", errors.New("timeline: no store root is configured")
	}
	return filepath.Join(s.root, taskID), nil
}

func (s *Store) readNodes(directory string) ([]Node, error) {
	data, err := os.ReadFile(filepath.Join(directory, nodesFileName))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("timeline: read nodes: %w", err)
	}
	var nodes []Node
	if err := json.Unmarshal(data, &nodes); err != nil {
		return nil, fmt.Errorf("timeline: decode nodes: %w", err)
	}
	return nodes, nil
}

func (s *Store) writeNodes(directory string, nodes []Node) error {
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("timeline: create task directory: %w", err)
	}
	data, err := json.MarshalIndent(nodes, "", "  ")
	if err != nil {
		return fmt.Errorf("timeline: encode nodes: %w", err)
	}
	return os.WriteFile(filepath.Join(directory, nodesFileName), data, 0o644)
}

func findNode(nodes []Node, id string) (Node, bool) {
	for _, node := range nodes {
		if node.ID == id {
			return node, true
		}
	}
	return Node{}, false
}

// deckFileName turns a node's label into a file name. Anything a file name
// cannot carry is dropped, and a node with no usable label falls back to its
// id so the deck always has a name.
func deckFileName(node Node) string {
	cleaned := strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(`/\:*?"<>|`, r) {
			return -1
		}
		return r
	}, node.Label)
	cleaned = strings.TrimSpace(strings.Trim(strings.TrimSpace(cleaned), "."))
	if runes := []rune(cleaned); len(runes) > 60 {
		cleaned = string(runes[:60])
	}
	if cleaned == "" {
		cleaned = node.ID
	}
	return cleaned + ".pptx"
}

// writeAssets stores media under the timeline's shared pool. Names are content
// digests already, so an entry of the right size is the right bytes and every
// node after the first pays nothing for the images it reuses.
func writeAssets(root string, assets []Asset) error {
	for _, asset := range assets {
		if int64(len(asset.Data)) > maxAssetBytes {
			return fmt.Errorf("timeline: asset %s exceeds the size limit", asset.Path)
		}
		clean, err := safeRelativePath(asset.Path)
		if err != nil {
			return err
		}
		target := filepath.Join(root, filepath.FromSlash(clean))
		if info, err := os.Stat(target); err == nil && info.Size() == int64(len(asset.Data)) {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("timeline: create asset directory: %w", err)
		}
		if err := os.WriteFile(target, asset.Data, 0o644); err != nil {
			return fmt.Errorf("timeline: write asset: %w", err)
		}
	}
	return nil
}

// safeRelativePath accepts only a path that is already relative and clean.
// Normalizing a traversal into something else would store the asset under a
// name nothing references, which reads as success and loses the image.
func safeRelativePath(path string) (string, error) {
	trimmed := filepath.ToSlash(strings.TrimSpace(path))
	clean := filepath.ToSlash(filepath.Clean(trimmed))
	if trimmed == "" || clean != trimmed || strings.HasPrefix(clean, "/") || clean == "." ||
		clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("timeline: unsafe asset path %q", path)
	}
	return clean, nil
}

func copyTree(source, target string) error {
	entries, err := os.ReadDir(source)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("timeline: read assets: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		from := filepath.Join(source, entry.Name())
		to := filepath.Join(target, entry.Name())
		if entry.IsDir() {
			if err := os.MkdirAll(to, 0o755); err != nil {
				return fmt.Errorf("timeline: stage asset directory: %w", err)
			}
			if err := copyTree(from, to); err != nil {
				return err
			}
			continue
		}
		data, err := os.ReadFile(from)
		if err != nil {
			return fmt.Errorf("timeline: read asset: %w", err)
		}
		if err := os.WriteFile(to, data, 0o644); err != nil {
			return fmt.Errorf("timeline: stage asset: %w", err)
		}
	}
	return nil
}
