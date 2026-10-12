// Package pptxdegrade lets a PPTX import survive the converter's fail-closed
// field review.
//
// mop-convert refuses a whole file when it meets a typed field it has not
// reviewed ("conversion stopped with N unsupported typed field(s)") and names
// every such field with its package part and field path. That strictness is
// deliberate in the converter: it never guesses at markup it cannot round-trip.
// It is the wrong outcome for the product, though, because the fields real
// decks trip over are almost always Office bookkeeping (creation ids, laser
// pointer colour, data label field tables, animation build lists) and losing
// them is invisible, while refusing the file loses everything.
//
// So the import is retried on a copy of the file with exactly the reported
// fields removed. Only what the converter named is touched, the original file
// is never modified, and a report the rules do not recognise leaves the first
// error standing rather than stripping markup on a guess.
package pptxdegrade

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// maxRounds bounds the retry loop. A removal can expose a field the converter
// had not reached yet (it reports a part's timing only after the build list is
// gone, for instance), so one retry is not always enough; a handful is.
const maxRounds = 4

// Removal records one kind of markup dropped from one package part.
type Removal struct {
	Part    string // package part, e.g. "ppt/slides/slide9.xml"
	Element string // what was removed, e.g. "spPr/extLst"
	Count   int
}

func (r Removal) String() string {
	return fmt.Sprintf("%s: %s x%d", r.Part, r.Element, r.Count)
}

// gapLinePattern matches one reported field:
//
//	import /ppt/slides/slide9.xml CTSlide.cSld.spTree.children[2].sp.spPr.extLst[0] shape ...: reason
var gapLinePattern = regexp.MustCompile(`(?m)^\s*import\s+/(\S+)\s+(\S+)`)

var indexPattern = regexp.MustCompile(`\[\d+\]`)

// rule decides which elements to drop from a part. It is called with the
// local names of the open ancestors (outermost first) and of the element.
type rule struct {
	label string
	match func(ancestors []string, local string) bool
}

func parentIs(ancestors []string, name string) bool {
	return len(ancestors) > 0 && ancestors[len(ancestors)-1] == name
}

// rulesFor turns one reported field path into removal rules, most precise
// first; later entries are fallbacks tried only when the earlier ones match
// nothing in the part. An unrecognised path yields no rules.
func rulesFor(fieldPath string) []rule {
	segments := strings.Split(indexPattern.ReplaceAllString(fieldPath, ""), ".")
	index := func(name string) int {
		for i, segment := range segments {
			if segment == name {
				return i
			}
		}
		return -1
	}

	// Extension lists: drop the one under the reported parent, and only fall
	// back to every extension list in the part when the converter's field name
	// does not match the element name.
	if i := index("extLst"); i >= 0 {
		anyExtLst := rule{label: "extLst", match: func(_ []string, local string) bool { return local == "extLst" }}
		if i == 0 {
			return []rule{anyExtLst}
		}
		parent := segments[i-1]
		scoped := rule{label: parent + "/extLst", match: func(ancestors []string, local string) bool {
			return local == "extLst" && parentIs(ancestors, parent)
		}}
		return []rule{scoped, anyExtLst}
	}
	// Image edit layers and effects live as children of the blip.
	if index("imgProps") >= 0 || index("blip") >= 0 {
		return []rule{{label: "blip children", match: func(ancestors []string, _ string) bool {
			return parentIs(ancestors, "blip")
		}}}
	}
	// Animation: the build list is optional beside the time node tree, so try
	// losing just that before giving up the slide's animation entirely.
	if index("bldLst") >= 0 {
		return []rule{
			{label: "timing/bldLst", match: func(_ []string, local string) bool { return local == "bldLst" }},
			{label: "timing", match: func(_ []string, local string) bool { return local == "timing" }},
		}
	}
	if index("timing") >= 0 {
		return []rule{{label: "timing", match: func(_ []string, local string) bool { return local == "timing" }}}
	}
	if index("transition") >= 0 {
		return []rule{{label: "transition", match: func(_ []string, local string) bool { return local == "transition" }}}
	}
	return nil
}

// planFor groups the rules by package part. Parts keep their first-seen order
// only for determinism in reports; removal itself is order independent.
func planFor(detail string) map[string][][]rule {
	plan := map[string][][]rule{}
	seen := map[string]bool{}
	for _, match := range gapLinePattern.FindAllStringSubmatch(detail, -1) {
		part, fieldPath := match[1], match[2]
		rules := rulesFor(fieldPath)
		if len(rules) == 0 {
			continue
		}
		key := part + "\x00" + rules[0].label
		if seen[key] {
			continue
		}
		seen[key] = true
		plan[part] = append(plan[part], rules)
	}
	return plan
}

// Recoverable reports whether a converter failure names at least one field
// this package knows how to drop.
func Recoverable(detail string) bool {
	return len(planFor(detail)) > 0
}

// Strip writes a copy of the PPTX at inputPath to outputPath with the fields
// named in the converter's failure detail removed, and returns what it
// removed. It returns no removals, and writes nothing, when the detail names
// nothing it can act on.
func Strip(inputPath, outputPath, detail string) ([]Removal, error) {
	plan := planFor(detail)
	if len(plan) == 0 {
		return nil, nil
	}
	reader, err := zip.OpenReader(inputPath)
	if err != nil {
		return nil, fmt.Errorf("open PPTX: %w", err)
	}
	defer reader.Close()

	rewritten := map[string][]byte{}
	var removals []Removal
	for _, file := range reader.File {
		groups, ok := plan[file.Name]
		if !ok {
			continue
		}
		content, err := readZipFile(file)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", file.Name, err)
		}
		changed := false
		for _, fallbacks := range groups {
			for _, candidate := range fallbacks {
				next, count := removeElements(content, candidate.match)
				if count == 0 {
					continue
				}
				content, changed = next, true
				removals = append(removals, Removal{Part: file.Name, Element: candidate.label, Count: count})
				break
			}
		}
		if changed {
			rewritten[file.Name] = content
		}
	}
	if len(rewritten) == 0 {
		return nil, nil
	}
	sort.SliceStable(removals, func(i, j int) bool { return removals[i].Part < removals[j].Part })
	if err := writeZip(reader, outputPath, rewritten); err != nil {
		return nil, err
	}
	return removals, nil
}

func readZipFile(file *zip.File) ([]byte, error) {
	handle, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	return io.ReadAll(handle)
}

func writeZip(reader *zip.ReadCloser, outputPath string, rewritten map[string][]byte) (err error) {
	output, err := os.OpenFile(outputPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("create stripped PPTX: %w", err)
	}
	defer func() {
		if closeErr := output.Close(); err == nil && closeErr != nil {
			err = closeErr
		}
	}()
	writer := zip.NewWriter(output)
	for _, file := range reader.File {
		content, ok := rewritten[file.Name]
		if !ok {
			// Untouched entries are copied compressed, byte for byte.
			if err := writer.Copy(file); err != nil {
				return fmt.Errorf("copy %s: %w", file.Name, err)
			}
			continue
		}
		entry, err := writer.CreateHeader(&zip.FileHeader{Name: file.Name, Method: zip.Deflate, Modified: file.Modified})
		if err != nil {
			return fmt.Errorf("write %s: %w", file.Name, err)
		}
		if _, err := entry.Write(content); err != nil {
			return fmt.Errorf("write %s: %w", file.Name, err)
		}
	}
	return writer.Close()
}

// Import runs convert on inputPath and, when it fails on fields this package
// can drop, retries on a stripped copy. convert must be safe to call again
// after a failure. detailOf extracts the converter's output from its error.
//
// The returned removals are non-empty exactly when the import succeeded on a
// degraded copy. When nothing more can be stripped the first error is
// returned, since it describes the user's actual file.
func Import(
	ctx context.Context,
	inputPath string,
	convert func(ctx context.Context, inputPath string) error,
	detailOf func(error) string,
) ([]Removal, error) {
	firstErr := convert(ctx, inputPath)
	if firstErr == nil {
		return nil, nil
	}
	if !Recoverable(detailOf(firstErr)) {
		return nil, firstErr
	}
	workDir, err := os.MkdirTemp("", "officedex-pptx-degrade-")
	if err != nil {
		return nil, firstErr
	}
	defer os.RemoveAll(workDir)

	var removals []Removal
	current, lastErr := inputPath, firstErr
	for round := 1; round <= maxRounds; round++ {
		if ctx.Err() != nil {
			return nil, firstErr
		}
		next := filepath.Join(workDir, fmt.Sprintf("round-%d.pptx", round))
		removed, err := Strip(current, next, detailOf(lastErr))
		if err != nil || len(removed) == 0 {
			return nil, firstErr
		}
		removals = append(removals, removed...)
		current = next
		if lastErr = convert(ctx, current); lastErr == nil {
			return removals, nil
		}
	}
	return nil, firstErr
}
