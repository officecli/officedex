package pptxtemplate

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type SlotFill struct {
	SlotID string `json:"slotId"`
	Text   string `json:"text"`
}

func ApplyFillsToMOP(mopDir string, fills []SlotFill) error {
	byID := map[string]string{}
	for _, fill := range fills {
		id := strings.TrimSpace(fill.SlotID)
		if id == "" {
			continue
		}
		byID[id] = fill.Text
	}
	if len(byID) == 0 {
		return nil
	}
	contentPath := filepath.Join(mopDir, "content.json")
	raw, err := os.ReadFile(contentPath)
	if err != nil {
		return fmt.Errorf("read filled MOP: %w", err)
	}
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		return fmt.Errorf("parse filled MOP: %w", err)
	}
	blocks, _ := root["blocks"].([]any)
	for _, rawBlock := range blocks {
		block, _ := rawBlock.(map[string]any)
		if fmt.Sprint(block["type"]) != "slides" {
			continue
		}
		slides, _ := block["data"].([]any)
		for i, rawSlide := range slides {
			slide, _ := rawSlide.(map[string]any)
			if slide == nil {
				continue
			}
			n := 0
			applyWalk(asAnySlice(slide["data"]), i+1, &n, byID)
		}
	}
	out, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(contentPath, append(out, '\n'), 0o600)
}

func applyWalk(nodes []any, slideIndex int, textIndex *int, byID map[string]string) {
	for _, raw := range nodes {
		node, _ := raw.(map[string]any)
		if node == nil {
			continue
		}
		switch fmt.Sprint(node["type"]) {
		case "picture":
			continue
		case "shape":
			if collectMapText(node) != "" {
				id := fmt.Sprintf("s%d-t%d", slideIndex, *textIndex)
				*textIndex++
				if text, ok := byID[id]; ok {
					setMapText(node, text)
				}
			}
			continue
		}
		applyWalk(asAnySlice(node["data"]), slideIndex, textIndex, byID)
	}
}

func collectMapText(node map[string]any) string {
	var parts []string
	var walk func(map[string]any)
	walk = func(n map[string]any) {
		if fmt.Sprint(n["type"]) == "text" {
			if s, ok := n["data"].(string); ok && strings.TrimSpace(s) != "" {
				parts = append(parts, strings.TrimSpace(s))
			}
			return
		}
		for _, child := range asAnySlice(n["data"]) {
			if m, ok := child.(map[string]any); ok {
				walk(m)
			}
		}
	}
	walk(node)
	return strings.TrimSpace(strings.Join(parts, " "))
}

func setMapText(node map[string]any, text string) {
	first := true
	var walk func(map[string]any)
	walk = func(n map[string]any) {
		if fmt.Sprint(n["type"]) == "text" {
			if first {
				n["data"] = text
				first = false
			} else {
				n["data"] = ""
			}
			return
		}
		for _, child := range asAnySlice(n["data"]) {
			if m, ok := child.(map[string]any); ok {
				walk(m)
			}
		}
	}
	walk(node)
}

func asAnySlice(value any) []any {
	items, _ := value.([]any)
	return items
}

func CopyDir(src, dest string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dest, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode())
		if err != nil {
			return err
		}
		defer out.Close()
		_, err = io.Copy(out, in)
		return err
	})
}
