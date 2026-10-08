package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"officedex/internal/pptxtemplate"
)

// ImportPptxTemplateInput is path-based so the renderer never uploads PPTX
// bytes through IPC. The native file dialog grants access to this path.
type ImportPptxTemplateInput struct {
	SourcePath string `json:"sourcePath"`
	Name       string `json:"name,omitempty"`
}

type ImportPptxTemplateResult struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	SourceFileName string         `json:"sourceFileName"`
	SourceSHA256   string         `json:"sourceSha256"`
	LocalAssetDir  string         `json:"localAssetDir"`
	Status         string         `json:"status"`
	Version        int            `json:"version"`
	CreatedAt      string         `json:"createdAt"`
	UpdatedAt      string         `json:"updatedAt"`
	PageCount      int            `json:"pageCount"`
	AssetCounts    map[string]int `json:"assetCounts"`
	Warnings       []string       `json:"warnings"`
}

type templateStructureAnalysis struct {
	Version       int            `json:"version"`
	PageCount     int            `json:"pageCount"`
	ObjectCounts  map[string]int `json:"objectCounts"`
	TextObjects   int            `json:"textObjects"`
	TextSamples   []string       `json:"textSamples,omitempty"`
	Colors        []string       `json:"colors,omitempty"`
	FontFamilies  []string       `json:"fontFamilies,omitempty"`
	ContentFormat string         `json:"contentFormat"`
	Warnings      []string       `json:"warnings,omitempty"`
}

const pptxTemplateProgressChannel = "pptx-template:progress"
const pptxTemplateProgressSteps = 5

// PptxTemplateProgress is one visible import stage. The desktop shows these
// while mop-convert, analysis and skill writing run inside ImportPptxTemplate.
type PptxTemplateProgress struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	SourceFileName string `json:"sourceFileName"`
	LocalAssetDir  string `json:"localAssetDir"`
	Status         string `json:"status"`
	Stage          string `json:"stage"`
	Step           int    `json:"step"`
	Steps          int    `json:"steps"`
	Error          string `json:"error,omitempty"`
}

func (a *App) reportPptxTemplateProgress(progress PptxTemplateProgress) {
	progress.Steps = pptxTemplateProgressSteps
	if a.pptxTemplateProgress != nil {
		a.pptxTemplateProgress(progress)
	}
	emit(a.ctx, pptxTemplateProgressChannel, progress)
}

// ImportPptxTemplate copies a user-selected PPTX into the app-managed local
// template directory. MOP conversion and analysis are separate stages.
func (a *App) ImportPptxTemplate(input ImportPptxTemplateInput) (ImportPptxTemplateResult, error) {
	sourcePath := strings.TrimSpace(input.SourcePath)
	if sourcePath == "" {
		return ImportPptxTemplateResult{}, errors.New("import PPTX template: source path is empty")
	}
	info, err := os.Stat(sourcePath)
	if err != nil {
		return ImportPptxTemplateResult{}, fmt.Errorf("import PPTX template: stat source: %w", err)
	}
	if !info.Mode().IsRegular() || !strings.EqualFold(filepath.Ext(sourcePath), ".pptx") {
		return ImportPptxTemplateResult{}, errors.New("import PPTX template: source must be a regular .pptx file")
	}
	settings, err := a.settingsStore.Load()
	if err != nil {
		return ImportPptxTemplateResult{}, fmt.Errorf("import PPTX template: load settings: %w", err)
	}
	workspaceDir, err := a.effectiveWorkspaceDir(settings)
	if err != nil {
		return ImportPptxTemplateResult{}, err
	}
	id := "tpl-" + uuid.NewString()
	assetDir := filepath.Join(workspaceDir, "ppt-templates", id)
	if err := os.MkdirAll(assetDir, 0o755); err != nil {
		return ImportPptxTemplateResult{}, fmt.Errorf("import PPTX template: create asset directory: %w", err)
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath))
	}
	sourceFileName := filepath.Base(sourcePath)
	report := func(status, stage string, step int, fail error) {
		progress := PptxTemplateProgress{
			ID: id, Name: name, SourceFileName: sourceFileName, LocalAssetDir: assetDir,
			Status: status, Stage: stage, Step: step,
		}
		if fail != nil {
			progress.Error = fail.Error()
		}
		a.reportPptxTemplateProgress(progress)
	}
	report("uploaded", "copy", 1, nil)
	dest := filepath.Join(assetDir, "source.pptx")
	source, err := os.Open(sourcePath)
	if err != nil {
		return ImportPptxTemplateResult{}, fmt.Errorf("import PPTX template: open source: %w", err)
	}
	defer source.Close()
	destination, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return ImportPptxTemplateResult{}, fmt.Errorf("import PPTX template: create local source: %w", err)
	}
	hash := sha256.New()
	if _, err := io.Copy(io.MultiWriter(destination, hash), source); err != nil {
		destination.Close()
		return ImportPptxTemplateResult{}, fmt.Errorf("import PPTX template: copy source: %w", err)
	}
	if err := destination.Close(); err != nil {
		return ImportPptxTemplateResult{}, fmt.Errorf("import PPTX template: close local source: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	fail := func(err error) (ImportPptxTemplateResult, error) {
		report("failed", "failed", 0, err)
		return ImportPptxTemplateResult{}, err
	}
	if a.pptxEditorService != nil {
		report("imported", "convert", 2, nil)
		mopDir := filepath.Join(assetDir, "source.mop")
		if err := a.pptxEditorService.ImportTemplate(context.Background(), dest, mopDir); err != nil {
			return fail(err)
		}
		report("assets_extracted", "extract", 3, nil)
		assets, err := a.pptxEditorService.TemplateAssets(mopDir)
		if err != nil {
			return fail(fmt.Errorf("import PPTX template: extract MOP assets: %w", err))
		}
		catalog := make([]map[string]any, 0, len(assets))
		for _, asset := range assets {
			digest := sha256.Sum256(asset.Data)
			catalog = append(catalog, map[string]any{
				"assetId": "asset-" + hex.EncodeToString(digest[:]),
				"path":    asset.Path, "contentType": asset.ContentType,
				"size": len(asset.Data), "source": "template", "reusable": true,
			})
		}
		data, err := json.MarshalIndent(map[string]any{"version": 1, "assets": catalog}, "", "  ")
		if err != nil {
			return fail(fmt.Errorf("import PPTX template: encode asset catalog: %w", err))
		}
		if err := os.WriteFile(filepath.Join(assetDir, "asset-catalog.json"), data, 0o600); err != nil {
			return fail(fmt.Errorf("import PPTX template: save asset catalog: %w", err))
		}
		report("analyzing", "analyze", 4, nil)
		facts, err := pptxtemplate.ExtractFacts(mopDir)
		if err != nil {
			return fail(fmt.Errorf("import PPTX template: extract facts: %w", err))
		}
		distilled := pptxtemplate.FallbackDistilled(facts)
		report("analyzing", "skill", 5, nil)
		if raw, distillErr := a.distillPptxTemplate(context.Background(), facts); distillErr != nil {
			distilled.Warnings = append(distilled.Warnings, "llm-distill-skipped: "+distillErr.Error())
		} else if merged, mergeErr := pptxtemplate.MergeLLM(facts, raw); mergeErr != nil {
			distilled.Warnings = append(distilled.Warnings, "llm-distill-invalid: "+mergeErr.Error())
		} else {
			distilled = merged
		}
		if err := pptxtemplate.WriteDistilled(assetDir, facts, distilled); err != nil {
			return fail(fmt.Errorf("import PPTX template: write distilled skill: %w", err))
		}
		assetCounts := map[string]int{"logo": 0, "icons": 0, "images": 0, "decorative": 0}
		for _, asset := range assets {
			switch {
			case strings.HasPrefix(asset.Path, "media/") && strings.Contains(strings.ToLower(asset.Path), "logo"):
				assetCounts["logo"]++
			case strings.HasPrefix(asset.Path, "media/"):
				assetCounts["images"]++
			case strings.HasPrefix(asset.Path, "embeddings/"):
				assetCounts["decorative"]++
			}
		}
		for _, slide := range facts.Slides {
			for _, pic := range slide.Pictures {
				if pic.Logo {
					assetCounts["logo"]++
				}
			}
		}
		report("ready", "ready", 5, nil)
		return ImportPptxTemplateResult{
			ID: id, Name: name, SourceFileName: sourceFileName,
			SourceSHA256: hex.EncodeToString(hash.Sum(nil)), LocalAssetDir: assetDir,
			Status: "ready", Version: 1, CreatedAt: now, UpdatedAt: now,
			PageCount: facts.PageCount, AssetCounts: assetCounts, Warnings: append(append([]string{}, facts.Warnings...), distilled.Warnings...),
		}, nil
	}
	report("imported", "imported", 2, nil)
	return ImportPptxTemplateResult{
		ID: id, Name: name, SourceFileName: sourceFileName,
		SourceSHA256: hex.EncodeToString(hash.Sum(nil)), LocalAssetDir: assetDir,
		Status: "imported", Version: 1, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func writeTemplateSkill(assetDir string, analysis templateStructureAnalysis) error {
	skillDir := filepath.Join(assetDir, "skill")
	if err := os.MkdirAll(skillDir, 0o700); err != nil {
		return err
	}
	entry := "# Local PPT template skill\n\n"
	entry += "This skill was generated from a local PPTX and its imported MOP package.\n"
	entry += "Use the layout library as a set of inferred candidates, not as fixed coordinates.\n\n"
	entry += "## Generation contract\n\n"
	entry += "1. Plan content relationships before selecting a layout.\n"
	entry += "2. Reuse fixed template assets and styles through the public JS-SDK.\n"
	entry += "3. Replace sample content; do not copy sample text into the generated deck.\n"
	entry += "4. Keep user-requested text editable and validate capacity before export.\n"
	entry += "5. Record fallback decisions when an inferred layout or object is unsupported.\n\n"
	entry += "## Evidence\n\n"
	entry += "The current rules are structural observations from the imported MOP. They require validation on new content before being promoted to a validated rule.\n"
	entry += fmt.Sprintf("Observed pages: %d; text objects: %d; observed colors: %d; observed fonts: %d.\n", analysis.PageCount, analysis.TextObjects, len(analysis.Colors), len(analysis.FontFamilies))
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(entry), 0o600); err != nil {
		return err
	}
	rules := map[string]any{
		"version":       1,
		"status":        "inferred",
		"source":        "mop-structure",
		"visualProfile": "../visual-profile.json",
		"layoutLibrary": "../layout-library.json",
		"assetCatalog":  "../asset-catalog.json",
		"fallback":      []string{"switch-layout", "reflow-content", "basic-object-substitute", "font-fallback"},
	}
	ruleData, err := json.MarshalIndent(rules, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(skillDir, "rules.json"), ruleData, 0o600)
}

func buildTemplateLayoutLibrary(analysis templateStructureAnalysis) map[string]any {
	layouts := []map[string]any{
		{
			"layoutId":        "text-summary",
			"contentRelation": "single-conclusion",
			"roles":           []string{"title", "body"},
			"source":          "mop-object-facts",
			"status":          "inferred",
		},
	}
	if analysis.ObjectCounts["image"] > 0 || analysis.ObjectCounts["picture"] > 0 {
		layouts = append(layouts, map[string]any{
			"layoutId":        "image-with-callout",
			"contentRelation": "single-conclusion",
			"roles":           []string{"title", "image", "callout"},
			"source":          "mop-object-facts", "status": "inferred",
		})
	}
	if analysis.ObjectCounts["chart"] > 0 || analysis.ObjectCounts["graph"] > 0 {
		layouts = append(layouts, map[string]any{
			"layoutId":        "chart-with-callout",
			"contentRelation": "data-summary",
			"roles":           []string{"title", "chart", "callout"},
			"source":          "mop-object-facts", "status": "inferred",
		})
	}
	if analysis.ObjectCounts["shape"] >= 3 || analysis.ObjectCounts["group"] >= 2 {
		layouts = append(layouts, map[string]any{
			"layoutId":        "parallel-blocks",
			"contentRelation": "parallel",
			"roles":           []string{"title", "repeated-block", "body"},
			"source":          "mop-object-facts", "status": "inferred",
		})
	}
	return map[string]any{
		"version":   1,
		"layouts":   layouts,
		"pageCount": analysis.PageCount,
		"status":    "inferred",
		"warning":   "Layout candidates are structural observations and require validation on new content.",
	}
}

func analyzeTemplateMOP(mopDirectory string) (templateStructureAnalysis, error) {
	contentPath := filepath.Join(mopDirectory, "content.json")
	raw, err := os.ReadFile(contentPath)
	if err != nil {
		return templateStructureAnalysis{}, fmt.Errorf("read content.json: %w", err)
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return templateStructureAnalysis{}, fmt.Errorf("parse content.json: %w", err)
	}
	result := templateStructureAnalysis{
		Version: 1, ObjectCounts: map[string]int{}, ContentFormat: "json",
	}
	colors := map[string]struct{}{}
	fonts := map[string]struct{}{}
	var visit func(any)
	visit = func(value any) {
		switch item := value.(type) {
		case []any:
			for _, child := range item {
				visit(child)
			}
		case map[string]any:
			if kind, ok := item["type"].(string); ok && kind != "" {
				result.ObjectCounts[kind]++
				if kind == "slide" || kind == "page" {
					result.PageCount++
				}
			}
			if text, ok := item["text"].(string); ok && strings.TrimSpace(text) != "" {
				result.TextObjects++
				if len(result.TextSamples) < 12 {
					result.TextSamples = append(result.TextSamples, strings.TrimSpace(text))
				}
			}
			for key, child := range item {
				switch key {
				case "fontFamily", "font-family", "fontName":
					if value, ok := child.(string); ok && strings.TrimSpace(value) != "" {
						fonts[strings.TrimSpace(value)] = struct{}{}
					}
				case "color", "fillColor", "strokeColor":
					if value, ok := child.(string); ok && strings.TrimSpace(value) != "" {
						colors[strings.TrimSpace(value)] = struct{}{}
					}
				}
				visit(child)
			}
		}
	}
	visit(root)
	for color := range colors {
		result.Colors = append(result.Colors, color)
	}
	for font := range fonts {
		result.FontFamilies = append(result.FontFamilies, font)
	}
	if result.PageCount == 0 {
		result.Warnings = append(result.Warnings, "page-count-not-detected")
	}
	return result, nil
}

type templateObjectIndex struct {
	Version int                    `json:"version"`
	Source  string                 `json:"source"`
	Objects []templateObjectRecord `json:"objects"`
}

type templateObjectRecord struct {
	ID       string `json:"id"`
	Page     int    `json:"page,omitempty"`
	Type     string `json:"type"`
	Role     string `json:"role,omitempty"`
	Text     string `json:"text,omitempty"`
	AssetRef string `json:"assetRef,omitempty"`
	Replace  bool   `json:"replaceable"`
}

func writeTemplateObjectIndex(mopDir, assetDir string) error {
	raw, err := os.ReadFile(filepath.Join(mopDir, "content.json"))
	if err != nil {
		return err
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return err
	}
	index := templateObjectIndex{Version: 1, Source: "source.mop/content.json"}
	page := 0
	ordinal := 0
	var visit func(any)
	visit = func(value any) {
		switch item := value.(type) {
		case []any:
			for _, child := range item {
				visit(child)
			}
		case map[string]any:
			typ, _ := item["type"].(string)
			lower := strings.ToLower(typ)
			if lower == "slide" || lower == "page" {
				page++
			}
			if typ != "" && lower != "slide" && lower != "page" && lower != "document" && lower != "presentation" {
				role := "body"
				if strings.Contains(lower, "image") || strings.Contains(lower, "picture") {
					role = "image"
				}
				if strings.Contains(lower, "chart") {
					role = "chart"
				}
				text, _ := item["text"].(string)
				if strings.Contains(strings.ToLower(text), "logo") {
					role = "logo"
				}
				asset, _ := item["assetId"].(string)
				if asset == "" {
					asset, _ = item["assetRef"].(string)
				}
				ordinal++
				index.Objects = append(index.Objects, templateObjectRecord{ID: fmt.Sprintf("tplobj-%04d", ordinal), Page: page, Type: typ, Role: role, Text: strings.TrimSpace(text), AssetRef: asset, Replace: role == "body" || role == "image" || role == "chart"})
			}
			for _, child := range item {
				visit(child)
			}
		}
	}
	visit(root)
	data, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(assetDir, "object-index.json"), data, 0o600)
}

func (a *App) distillPptxTemplate(ctx context.Context, facts pptxtemplate.Facts) (json.RawMessage, error) {
	if a.analyzePptxTemplate != nil {
		return a.analyzePptxTemplate(ctx, facts)
	}
	client, err := a.ensureBridge()
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(facts)
	if err != nil {
		return nil, err
	}
	return client.AnalyzePptxTemplate(ctx, payload)
}

// ReadPptxTemplateSource returns a locally imported template PPTX for the
// embedded Office JS worker. The renderer only receives bytes; it never gets
// arbitrary filesystem access.
func (a *App) ReadPptxTemplateSource(assetDir string) (ArtifactFile, error) {
	assetDir = strings.TrimSpace(assetDir)
	if assetDir == "" {
		return ArtifactFile{}, errors.New("read PPTX template: asset directory is empty")
	}
	path := filepath.Join(assetDir, "source.pptx")
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return ArtifactFile{}, fmt.Errorf("read PPTX template: source is unavailable")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ArtifactFile{}, fmt.Errorf("read PPTX template: %w", err)
	}
	return ArtifactFile{Data: data, SHA256: sha256Hex(data)}, nil
}

// DeletePptxTemplate removes one app-managed local template directory. It
// refuses paths that do not look like a workspace ppt-templates child.
func (a *App) DeletePptxTemplate(assetDir string) error {
	assetDir = filepath.Clean(strings.TrimSpace(assetDir))
	if assetDir == "." || assetDir == string(filepath.Separator) || filepath.Base(assetDir) == "ppt-templates" {
		return errors.New("delete PPTX template: invalid asset directory")
	}
	if filepath.Base(filepath.Dir(assetDir)) != "ppt-templates" {
		return errors.New("delete PPTX template: refusing path outside ppt-templates")
	}
	if _, err := os.Stat(assetDir); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("delete PPTX template: stat: %w", err)
	}
	if err := os.RemoveAll(assetDir); err != nil {
		return fmt.Errorf("delete PPTX template: %w", err)
	}
	return nil
}
