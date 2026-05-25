package diagnostics

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"officedex/internal/types"
)

const (
	maxFileSize    = 10 * 1024 * 1024  // 10MB
	maxTotalSize   = 25 * 1024 * 1024  // 25MB
	recentLimit    = 200
	logRetainDays  = 3
	zip64Threshold = 4 * 1024 * 1024 * 1024 // 4GB
)

func BuildBundle(ctx context.Context, opts BundleOptions) (zipPath string, manifest BundleManifest, err error) {
	now := opts.Now
	if now == nil {
		now = time.Now
	}

	// Backward-compat: when no Include* flag is set (zero-value BundleOptions),
	// include everything. This keeps older callers and tests working while
	// letting newer callers opt out of specific sections.
	if !opts.IncludeSettings && !opts.IncludeEvents && !opts.IncludeLogs && !opts.IncludeRecent {
		opts.IncludeSettings = true
		opts.IncludeEvents = true
		opts.IncludeLogs = true
		opts.IncludeRecent = true
	}

	manifest = BundleManifest{
		SchemaVersion: 1,
		BundleID:      opts.BundleID,
	}

	tmpDir, err := os.MkdirTemp("", "officedex-bundle-*")
	if err != nil {
		return "", manifest, fmt.Errorf("diagnostics: create temp dir: %w", err)
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(tmpDir)
		}
	}()

	partialPath := filepath.Join(tmpDir, "bundle.zip.partial")
	out, err := os.Create(partialPath)
	if err != nil {
		return "", manifest, fmt.Errorf("diagnostics: create partial zip: %w", err)
	}

	zw := zip.NewWriter(out)
	scrubber := NewScrubberWithWorkspace(opts.Settings, opts.CachedBridgeEnv, opts.WorkspaceDir)

	meta := buildMeta(opts, now)
	metaJSON, _ := json.MarshalIndent(meta, "", "  ")
	if err := writeZipEntry(zw, "meta.json", metaJSON); err != nil {
		_ = zw.Close()
		_ = out.Close()
		return "", manifest, fmt.Errorf("diagnostics: write meta.json: %w", err)
	}
	manifest.Items = append(manifest.Items, BundleItem{
		Path:      "meta.json",
		SizeBytes: int64(len(metaJSON)),
		SectionID: "meta",
	})

	if opts.IncludeSettings {
		settingsPath := filepath.Join(opts.UserDataDir, "settings.json")
		scrubbedSettings := readAndScrubSettings(settingsPath, scrubber)
		if err := writeZipEntry(zw, "settings.scrubbed.json", scrubbedSettings); err != nil {
			_ = zw.Close()
			_ = out.Close()
			return "", manifest, fmt.Errorf("diagnostics: write settings: %w", err)
		}
		manifest.Items = append(manifest.Items, BundleItem{
			Path:      "settings.scrubbed.json",
			SizeBytes: int64(len(scrubbedSettings)),
			SectionID: "settings",
		})
	}

	var totalSize int64
	for _, item := range manifest.Items {
		totalSize += item.SizeBytes
	}

	if opts.IncludeEvents && opts.TaskID != "" && opts.LocalStore != nil {
		events, qErr := opts.LocalStore.QueryEventsByTask(ctx, opts.TaskID)
		if qErr == nil && len(events) > 0 {
			entryName := fmt.Sprintf("events/task-%s.jsonl", opts.TaskID)
			data := eventsToJSONL(events, scrubber)
			if err := writeZipEntry(zw, entryName, data); err != nil {
				_ = zw.Close()
				_ = out.Close()
				return "", manifest, fmt.Errorf("diagnostics: write task events: %w", err)
			}
			manifest.Items = append(manifest.Items, BundleItem{
				Path:      entryName,
				SizeBytes: int64(len(data)),
				SectionID: "events",
			})
			totalSize += int64(len(data))
		}
	}

	var recentData []byte
	if opts.IncludeRecent && opts.LocalStore != nil {
		events, qErr := opts.LocalStore.QueryRecentEvents(ctx, recentLimit)
		if qErr == nil && len(events) > 0 {
			recentData = eventsToJSONL(events, scrubber)
		}
	}

	type logEntry struct {
		name string
		data []byte
	}
	var logEntries []logEntry
	if opts.IncludeLogs {
		logsDir := filepath.Join(opts.UserDataDir, "logs")
		cutoff := now().AddDate(0, 0, -logRetainDays)
		entries, _ := os.ReadDir(logsDir)
		for _, e := range entries {
			if e.IsDir() || !strings.HasPrefix(e.Name(), "bridge-") || !strings.HasSuffix(e.Name(), ".log") {
				continue
			}
			info, infoErr := e.Info()
			if infoErr != nil {
				continue
			}
			if info.ModTime().Before(cutoff) {
				continue
			}
			data, readErr := os.ReadFile(filepath.Join(logsDir, e.Name()))
			if readErr != nil {
				continue
			}
			data = truncateFile(data, &manifest)
			data = scrubber.ScrubBytes(data)
			logEntries = append(logEntries, logEntry{name: "logs/" + e.Name(), data: data})
		}
	}

	logSize := int64(0)
	for _, le := range logEntries {
		logSize += int64(len(le.data))
	}
	recentSize := int64(len(recentData))

	if totalSize+logSize+recentSize > maxTotalSize {
		manifest.ExcludedReasons = append(manifest.ExcludedReasons, "total size exceeds 25MB limit")

		var oldLogEntries []logEntry
		for _, le := range logEntries {
			oldLogEntries = append(oldLogEntries, le)
		}

		if totalSize+logSize > maxTotalSize {
			var keptLogs []logEntry
			allowed := maxTotalSize - totalSize
			var accumulated int64
			for i := len(oldLogEntries) - 1; i >= 0; i-- {
				sz := int64(len(oldLogEntries[i].data))
				if accumulated+sz <= allowed {
					keptLogs = append([]logEntry{oldLogEntries[i]}, keptLogs...)
					accumulated += sz
				} else {
					manifest.ExcludedReasons = append(manifest.ExcludedReasons,
						fmt.Sprintf("excluded log %s to fit size limit", oldLogEntries[i].name))
				}
			}
			logEntries = keptLogs
		}
		recentData = nil
		manifest.ExcludedReasons = append(manifest.ExcludedReasons, "excluded recent.jsonl to fit size limit")
	}

	if len(recentData) > 0 {
		if err := writeZipEntry(zw, "events/recent.jsonl", recentData); err != nil {
			_ = zw.Close()
			_ = out.Close()
			return "", manifest, fmt.Errorf("diagnostics: write recent events: %w", err)
		}
		manifest.Items = append(manifest.Items, BundleItem{
			Path:      "events/recent.jsonl",
			SizeBytes: int64(len(recentData)),
			SectionID: "events",
		})
	}

	for _, le := range logEntries {
		if err := writeZipEntry(zw, le.name, le.data); err != nil {
			_ = zw.Close()
			_ = out.Close()
			return "", manifest, fmt.Errorf("diagnostics: write log %s: %w", le.name, err)
		}
		manifest.Items = append(manifest.Items, BundleItem{
			Path:      le.name,
			SizeBytes: int64(len(le.data)),
			SectionID: "logs",
		})
	}

	if err := zw.Close(); err != nil {
		_ = out.Close()
		return "", manifest, fmt.Errorf("diagnostics: close zip writer: %w", err)
	}
	if err := out.Close(); err != nil {
		return "", manifest, fmt.Errorf("diagnostics: close zip file: %w", err)
	}

	ts := now().Format("20060102150405.000000000")
	bundleShort := opts.BundleID
	if len(bundleShort) > 8 {
		bundleShort = bundleShort[:8]
	}
	finalName := fmt.Sprintf("officedex-logs-%s-%s.zip", ts, bundleShort)
	finalPath := filepath.Join(opts.DestDir, finalName)

	if err := os.MkdirAll(opts.DestDir, 0o755); err != nil {
		return "", manifest, fmt.Errorf("diagnostics: ensure dest dir: %w", err)
	}

	if err := os.Rename(partialPath, finalPath); err != nil {
		// Cross-device fallback: copy partial to a sibling .partial in DestDir,
		// then rename within DestDir so failures never leave a half-written .zip
		// at the user-visible final path.
		destPartial := finalPath + ".partial"
		data, readErr := os.ReadFile(partialPath)
		if readErr != nil {
			return "", manifest, fmt.Errorf("diagnostics: rename failed and copy fallback read failed: %w", err)
		}
		if writeErr := os.WriteFile(destPartial, data, 0o644); writeErr != nil {
			_ = os.Remove(destPartial)
			return "", manifest, fmt.Errorf("diagnostics: copy fallback write failed: %w", writeErr)
		}
		if renameErr := os.Rename(destPartial, finalPath); renameErr != nil {
			_ = os.Remove(destPartial)
			return "", manifest, fmt.Errorf("diagnostics: copy fallback rename failed: %w", renameErr)
		}
	}

	_ = os.RemoveAll(tmpDir)

	return finalPath, manifest, nil
}

func buildMeta(opts BundleOptions, now func() time.Time) map[string]any {
	m := map[string]any{
		"appVersion":          opts.AppVersion,
		"os":                  runtime.GOOS,
		"arch":                runtime.GOARCH,
		"time":                now().UTC().Format(time.RFC3339),
		"bundleId":            opts.BundleID,
		"bundleSchemaVersion": 1,
		"runtimeDroppedBytes": opts.RuntimeDroppedBytes,
	}
	if opts.TaskID != "" {
		m["taskId"] = opts.TaskID
	}
	return m
}

func readAndScrubSettings(path string, scrubber *Scrubber) []byte {
	body, err := os.ReadFile(path)
	if err != nil {
		placeholder, _ := json.MarshalIndent(map[string]string{
			"_error": "settings not readable",
		}, "", "  ")
		return placeholder
	}
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		placeholder, _ := json.MarshalIndent(map[string]string{
			"_error": "settings not parseable",
		}, "", "  ")
		return placeholder
	}
	if provider, ok := raw["llmProvider"].(map[string]any); ok {
		if _, ok := provider["apiKey"].(string); ok {
			provider["apiKey"] = "[REDACTED_API_KEY]"
		}
		if _, ok := provider["baseUrl"].(string); ok {
			provider["baseUrl"] = "[REDACTED_BASE_URL]"
		}
	}
	out, _ := json.MarshalIndent(raw, "", "  ")
	return scrubber.ScrubBytes(out)
}

func eventsToJSONL(events []types.BridgeEvent, scrubber *Scrubber) []byte {
	var lines []string
	for _, ev := range events {
		b, err := json.Marshal(ev)
		if err != nil {
			continue
		}
		line := scrubber.ScrubLine(string(b))
		lines = append(lines, line)
	}
	return []byte(strings.Join(lines, "\n") + "\n")
}

func truncateFile(data []byte, manifest *BundleManifest) []byte {
	if int64(len(data)) <= maxFileSize {
		return data
	}
	manifest.Truncated = true
	half := maxFileSize / 2
	skipped := len(data) - maxFileSize
	marker := fmt.Sprintf("\n[TRUNCATED %d bytes]\n", skipped)
	result := make([]byte, 0, maxFileSize+len(marker))
	result = append(result, data[:half]...)
	result = append(result, []byte(marker)...)
	result = append(result, data[len(data)-half:]...)
	return result
}

func writeZipEntry(zw *zip.Writer, name string, data []byte) error {
	header := &zip.FileHeader{
		Name:   name,
		Method: zip.Deflate,
	}
	if int64(len(data)) >= zip64Threshold {
		header.UncompressedSize64 = uint64(len(data))
	}
	w, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, strings.NewReader(string(data)))
	return err
}
