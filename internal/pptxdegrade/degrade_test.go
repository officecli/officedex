package pptxdegrade

import (
	"archive/zip"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The parts below reproduce, in miniature, the four kinds of field a real
// year-end-summary template was refused for.
const (
	slideWithShapeExtension = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="urn:a" xmlns:p="urn:p"><p:cSld><p:spTree>` +
		`<p:sp><p:nvSpPr><p:cNvPr id="2" name="keep &gt; me"><a:extLst><a:ext uri="{name}"/></a:extLst></p:cNvPr></p:nvSpPr>` +
		`<p:spPr><a:xfrm/><a:extLst><a:ext uri="{FF2B5EF4}"><a16:creationId xmlns:a16="urn:a16" id="{1}"/></a:ext></a:extLst></p:spPr>` +
		`<p:txBody><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>` +
		`<p:sp><p:spPr><a:extLst><a:ext uri="{FF2B5EF4}"/></a:extLst></p:spPr></p:sp>` +
		`</p:spTree></p:cSld></p:sld>`

	slideWithBuildList = `<p:sld xmlns:p="urn:p"><p:cSld/><p:timing><p:tnLst><p:par/></p:tnLst>` +
		`<p:bldLst><p:bldGraphic spid="49" grpId="0"><p:bldAsOne/></p:bldGraphic></p:bldLst></p:timing></p:sld>`

	chartWithLabelExtension = `<c:chartSpace xmlns:c="urn:c"><c:chart><c:plotArea><c:doughnutChart><c:ser>` +
		`<c:dLbls><c:dLbl><c:idx val="0"/><c:showVal val="1"/><c:extLst><c:ext uri="{CE6537A1}"><c15:dlblFieldTable xmlns:c15="urn:c15"/></c:ext></c:extLst></c:dLbl></c:dLbls>` +
		`<c:extLst><c:ext uri="{series}"/></c:extLst></c:ser></c:doughnutChart></c:plotArea></c:chart></c:chartSpace>`

	presPropsWithExtension = `<p:presentationPr xmlns:p="urn:p"><p:showPr showNarration="1"><p:present/>` +
		`<p:extLst><p:ext uri="{EC167BDD}"/></p:extLst></p:showPr>` +
		`<p:extLst><p:ext uri="{E76CE94A}"/></p:extLst></p:presentationPr>`

	converterReport = `Error: conversion stopped with 6 unsupported typed field(s)
import /ppt/charts/chart1.xml CTChartSpace.chart.plotArea.charts[0].doughnutChart.ser[0].dLbls.dLbl[0].extLst.ext[0] chart renderingAndEditing: data label extension is not mapped
import /ppt/charts/chart1.xml CTChartSpace.chart.plotArea.charts[0].doughnutChart.ser[0].dLbls.dLbl[0].extLst.ext[1] chart renderingAndEditing: data label extension is not mapped
import /ppt/presProps.xml CTPresentationProperties.showPr.extLst presentationProperties editing: unreviewed extension list
import /ppt/slides/slide12.xml CTSlide.timing.bldLst[0] slide renderingAndEditing: build variant is outside the reviewed B003 sample set
import /ppt/slides/slide9.xml CTSlide.cSld.spTree.children[2].sp.spPr.extLst[0] shape renderingAndEditing: shape property extension is not a reviewed hidden property
import /ppt/slides/slide9.xml CTSlide.cSld.spTree.children[3].sp.spPr.extLst[0] shape renderingAndEditing: shape property extension is not a reviewed hidden property
`
)

func writeDeck(t *testing.T, parts map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "deck.pptx")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create deck: %v", err)
	}
	writer := zip.NewWriter(file)
	for name, content := range parts {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		if _, err := io.WriteString(entry, content); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close deck: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close deck file: %v", err)
	}
	return path
}

func readDeck(t *testing.T, path string) map[string]string {
	t.Helper()
	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer reader.Close()
	parts := map[string]string{}
	for _, file := range reader.File {
		content, err := readZipFile(file)
		if err != nil {
			t.Fatalf("read %s: %v", file.Name, err)
		}
		parts[file.Name] = string(content)
	}
	return parts
}

func sampleDeck(t *testing.T) string {
	return writeDeck(t, map[string]string{
		"[Content_Types].xml":    `<Types/>`,
		"ppt/slides/slide9.xml":  slideWithShapeExtension,
		"ppt/slides/slide12.xml": slideWithBuildList,
		"ppt/slides/slide1.xml":  slideWithShapeExtension, // not reported: must stay intact
		"ppt/charts/chart1.xml":  chartWithLabelExtension,
		"ppt/presProps.xml":      presPropsWithExtension,
		"ppt/media/image1.png":   "\x89PNG not really",
	})
}

func TestStripRemovesOnlyTheReportedFields(t *testing.T) {
	input := sampleDeck(t)
	output := filepath.Join(t.TempDir(), "stripped.pptx")

	removals, err := Strip(input, output, converterReport)
	if err != nil {
		t.Fatalf("Strip: %v", err)
	}
	got := map[string]int{}
	for _, removal := range removals {
		got[removal.Part+" "+removal.Element] = removal.Count
	}
	want := map[string]int{
		"ppt/charts/chart1.xml dLbl/extLst":    1,
		"ppt/presProps.xml showPr/extLst":      1,
		"ppt/slides/slide12.xml timing/bldLst": 1,
		"ppt/slides/slide9.xml spPr/extLst":    2,
	}
	if len(got) != len(want) {
		t.Fatalf("removals = %v, want %v", got, want)
	}
	for key, count := range want {
		if got[key] != count {
			t.Errorf("removal %q = %d, want %d (all: %v)", key, got[key], count, got)
		}
	}

	before, after := readDeck(t, input), readDeck(t, output)
	if len(after) != len(before) {
		t.Fatalf("stripped deck has %d parts, want %d", len(after), len(before))
	}

	slide := after["ppt/slides/slide9.xml"]
	if strings.Contains(slide, "creationId") {
		t.Error("the reported shape property extension survived")
	}
	// An extension list the converter did not complain about belongs to a
	// different parent and must be left alone, as must the slide's content.
	for _, kept := range []string{`<a:ext uri="{name}"/>`, `name="keep &gt; me"`, "<a:t>Title</a:t>", "<a:xfrm/>"} {
		if !strings.Contains(slide, kept) {
			t.Errorf("slide lost %s: %s", kept, slide)
		}
	}

	if chart := after["ppt/charts/chart1.xml"]; strings.Contains(chart, "dlblFieldTable") ||
		!strings.Contains(chart, `<c:ext uri="{series}"/>`) || !strings.Contains(chart, `<c:showVal val="1"/>`) {
		t.Errorf("chart was not stripped precisely: %s", chart)
	}
	if props := after["ppt/presProps.xml"]; strings.Contains(props, "EC167BDD") || !strings.Contains(props, "E76CE94A") {
		t.Errorf("presProps was not stripped precisely: %s", props)
	}
	// Animation survives; only the unreviewed build list goes.
	if timing := after["ppt/slides/slide12.xml"]; strings.Contains(timing, "bldLst") || !strings.Contains(timing, "<p:tnLst><p:par/></p:tnLst>") {
		t.Errorf("timing was not stripped precisely: %s", timing)
	}

	for _, untouched := range []string{"ppt/slides/slide1.xml", "ppt/media/image1.png", "[Content_Types].xml"} {
		if after[untouched] != before[untouched] {
			t.Errorf("%s changed although the converter never named it", untouched)
		}
	}
	if readDeck(t, input)["ppt/slides/slide9.xml"] != slideWithShapeExtension {
		t.Error("Strip modified the user's original file")
	}
}

func TestStripFallsBackWhenTheReportedParentIsNotAnElementName(t *testing.T) {
	input := writeDeck(t, map[string]string{"ppt/slides/slide9.xml": slideWithShapeExtension})
	output := filepath.Join(t.TempDir(), "stripped.pptx")

	removals, err := Strip(input, output,
		"import /ppt/slides/slide9.xml CTSlide.somethingRenamed.extLst[0] shape: unreviewed")
	if err != nil {
		t.Fatalf("Strip: %v", err)
	}
	if len(removals) != 1 || removals[0].Element != "extLst" || removals[0].Count != 3 {
		t.Fatalf("removals = %v, want every extLst in the part", removals)
	}
	if strings.Contains(readDeck(t, output)["ppt/slides/slide9.xml"], "extLst") {
		t.Error("an extension list survived the fallback")
	}
}

func TestStripLeavesUnrecognisedReportsAlone(t *testing.T) {
	input := sampleDeck(t)
	output := filepath.Join(t.TempDir(), "stripped.pptx")

	for _, detail := range []string{
		"thread 'main' panicked at src/main.rs:1:1",
		"import /ppt/slides/slide9.xml CTSlide.cSld.spTree.children[0].sp.somethingNew shape: not mapped",
		"import /ppt/slides/missing.xml CTSlide.cSld.spTree.children[0].sp.spPr.extLst[0] shape: not mapped",
	} {
		removals, err := Strip(input, output, detail)
		if err != nil || len(removals) != 0 {
			t.Errorf("Strip(%q) = %v, %v; want nothing removed", detail, removals, err)
		}
		if _, err := os.Stat(output); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("Strip(%q) wrote a file although it removed nothing", detail)
		}
	}
	if Recoverable("thread 'main' panicked") {
		t.Error("a crash was classified as recoverable")
	}
}

func TestRemoveElementsReturnsMalformedInputUnchanged(t *testing.T) {
	anyElement := func(_ []string, local string) bool { return local == "extLst" }
	for _, source := range []string{
		`<a><extLst></a>`,
		`<a><extLst/></a></b>`,
		`<a><extLst attr="unterminated></a>`,
	} {
		output, count := removeElements([]byte(source), anyElement)
		if count != 0 || string(output) != source {
			t.Errorf("removeElements(%q) = %q, %d; want it untouched", source, output, count)
		}
	}
}

func TestRemoveElementsIgnoresMarkupThatOnlyLooksLikeATag(t *testing.T) {
	source := `<a><!-- <extLst> --><![CDATA[<extLst>]]><b title="a > b"><x:extLst><c/></x:extLst></b><extLst/></a>`
	output, count := removeElements([]byte(source), func(_ []string, local string) bool { return local == "extLst" })
	want := `<a><!-- <extLst> --><![CDATA[<extLst>]]><b title="a > b"></b></a>`
	if count != 2 || string(output) != want {
		t.Errorf("removeElements = %q, %d; want %q, 2", output, count, want)
	}
}

// fakeConverter fails the way mop-convert does for as long as the deck still
// contains markup it "does not support", reporting one kind per attempt so the
// retry loop has to go round more than once.
type fakeConverter struct {
	attempts []string
}

func (f *fakeConverter) convert(t *testing.T) func(context.Context, string) error {
	return func(_ context.Context, path string) error {
		f.attempts = append(f.attempts, path)
		parts := readDeck(t, path)
		if strings.Contains(parts["ppt/slides/slide9.xml"], "creationId") {
			return errors.New("import /ppt/slides/slide9.xml CTSlide.cSld.spTree.children[2].sp.spPr.extLst[0] shape: not reviewed")
		}
		if strings.Contains(parts["ppt/slides/slide12.xml"], "bldLst") {
			return errors.New("import /ppt/slides/slide12.xml CTSlide.timing.bldLst[0] slide: build variant is outside the reviewed set")
		}
		return nil
	}
}

func errorText(err error) string { return err.Error() }

func TestImportRetriesUntilTheConverterAccepts(t *testing.T) {
	input := sampleDeck(t)
	converter := &fakeConverter{}

	removals, err := Import(context.Background(), input, converter.convert(t), errorText)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if len(converter.attempts) != 3 || converter.attempts[0] != input {
		t.Fatalf("attempts = %v, want the original then two stripped copies", converter.attempts)
	}
	if len(removals) != 2 {
		t.Errorf("removals = %v, want the shape extension and the build list", removals)
	}
	for _, attempt := range converter.attempts[1:] {
		if _, err := os.Stat(attempt); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("temporary copy %s was left behind", attempt)
		}
	}
}

func TestImportDoesNotRetryACleanDeckOrAnUnrecoverableFailure(t *testing.T) {
	input := sampleDeck(t)

	calls := 0
	removals, err := Import(context.Background(), input, func(context.Context, string) error {
		calls++
		return nil
	}, errorText)
	if err != nil || len(removals) != 0 || calls != 1 {
		t.Errorf("clean import = %v, %v after %d call(s)", removals, err, calls)
	}

	calls = 0
	crash := errors.New("mop-convert import: file is not a zip archive")
	_, err = Import(context.Background(), input, func(context.Context, string) error {
		calls++
		return crash
	}, errorText)
	if !errors.Is(err, crash) || calls != 1 {
		t.Errorf("unrecoverable import = %v after %d call(s), want the original error once", err, calls)
	}
}

func TestImportReportsTheFirstErrorWhenStrippingDoesNotHelp(t *testing.T) {
	input := sampleDeck(t)
	first := errors.New("import /ppt/slides/slide9.xml CTSlide.cSld.spTree.children[2].sp.spPr.extLst[0] shape: not reviewed")
	calls := 0

	_, err := Import(context.Background(), input, func(context.Context, string) error {
		calls++
		if calls == 1 {
			return first
		}
		return errors.New("import /ppt/slides/slide9.xml CTSlide.cSld.spTree.children[2].sp.spPr.extLst[0] shape: still not reviewed")
	}, errorText)
	// Attempt two strips the reported extension list, attempt three falls back
	// to every extension list in the part; after that nothing is left to strip
	// and the loop must stop instead of spinning.
	if !errors.Is(err, first) || calls != 3 {
		t.Errorf("Import = %v after %d call(s), want the first error after 3", err, calls)
	}
}
