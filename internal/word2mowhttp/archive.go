package word2mowhttp

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// contentFileName is the one entry every MOW package must carry at its root.
const contentFileName = "content.json"

// maxArchiveEntryBytes bounds a single entry read out of a client-supplied ZIP.
// Without it a zip bomb could expand a small request body into an unbounded
// write to the temporary directory.
const maxArchiveEntryBytes = 256 * 1024 * 1024

// normalizeMowArchivePath is the Go twin of mow-archive.ts's function of the
// same name. The two must agree exactly: writer builds the ZIP with those
// rules, this reads it back, and a divergence would show up as a file silently
// dropped from a round-trip rather than as an error.
func normalizeMowArchivePath(path string) (string, error) {
	if path == "" || strings.HasPrefix(path, "/") || strings.Contains(path, `\`) {
		return "", fmt.Errorf("invalid MOW archive path: %s", path)
	}
	segments := strings.Split(path, "/")
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return "", fmt.Errorf("invalid MOW archive path: %s", path)
		}
	}
	root := segments[0]
	if path != contentFileName && root != "image" && root != "embedding" {
		return "", fmt.Errorf("unsupported MOW archive entry: %s", path)
	}
	return path, nil
}

// writeMowArchiveToDirectory unpacks a MOW ZIP into an empty directory.
func writeMowArchiveToDirectory(archive []byte, root string) error {
	if len(archive) == 0 {
		return errors.New("MOW ZIP must not be empty")
	}
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return errors.New("MOW package is not a valid ZIP archive")
	}
	seen := make(map[string]struct{}, len(reader.File))
	contentSize := int64(-1)
	for _, entry := range reader.File {
		if strings.HasSuffix(entry.Name, "/") {
			continue
		}
		safePath, err := normalizeMowArchivePath(entry.Name)
		if err != nil {
			return err
		}
		if _, duplicate := seen[safePath]; duplicate {
			return fmt.Errorf("duplicate MOW archive entry: %s", safePath)
		}
		seen[safePath] = struct{}{}

		destination := filepath.Join(root, filepath.FromSlash(safePath))
		if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
			return err
		}
		written, err := copyArchiveEntry(entry, destination)
		if err != nil {
			return err
		}
		if safePath == contentFileName {
			contentSize = written
		}
	}
	if contentSize < 0 {
		return errors.New("MOW ZIP must contain content.json at its root")
	}
	if contentSize == 0 {
		return errors.New("MOW ZIP must contain a non-empty content.json at its root")
	}
	return nil
}

func copyArchiveEntry(entry *zip.File, destination string) (int64, error) {
	source, err := entry.Open()
	if err != nil {
		return 0, err
	}
	defer source.Close()

	file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return 0, err
	}
	defer file.Close()

	written, err := io.Copy(file, io.LimitReader(source, maxArchiveEntryBytes+1))
	if err != nil {
		return written, err
	}
	if written > maxArchiveEntryBytes {
		return written, fmt.Errorf("MOW archive entry %s exceeds the allowed size", entry.Name)
	}
	return written, file.Close()
}

// readMowDirectoryAsArchive packs a MOW directory the converter produced.
// Entries are added in sorted order so the same package always produces the
// same bytes, which keeps a re-import diffable.
func readMowDirectoryAsArchive(root string) ([]byte, error) {
	if info, err := os.Stat(filepath.Join(root, contentFileName)); err != nil || info.Size() == 0 {
		return nil, errors.New("word2mow import did not produce content.json")
	}

	paths, err := collectMowFiles(root)
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)

	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, archivePath := range paths {
		entry, err := writer.Create(archivePath)
		if err != nil {
			return nil, err
		}
		content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(archivePath)))
		if err != nil {
			return nil, err
		}
		if _, err := entry.Write(content); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func collectMowFiles(root string) ([]string, error) {
	var paths []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !info.Mode().IsRegular() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		archivePath, err := normalizeMowArchivePath(filepath.ToSlash(relative))
		if err != nil {
			return err
		}
		paths = append(paths, archivePath)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return paths, nil
}
