package localstore

import (
	"context"
	"path/filepath"
	"testing"
)

func TestOfficeProductGraphRoundTrip(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "office.db"))
	ctx := context.Background()
	if err := store.Open(ctx); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertOfficeProject(OfficeProject{ID: "p1", Name: "Sales"}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertWorkbookSource(WorkbookSource{ID: "src1", WorkbookID: "book1", Name: "Jira", Kind: "jira"}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertWorkbookView(WorkbookView{ID: "view1", WorkbookID: "book1", SheetName: "Model", Layer: "model", Fingerprint: "v1"}); err != nil {
		t.Fatal(err)
	}
	sources, err := store.QueryWorkbookSources(ctx, "book1")
	if err != nil || len(sources) != 1 || sources[0].Kind != "jira" {
		t.Fatalf("unexpected sources: %#v (%v)", sources, err)
	}
	views, err := store.QueryWorkbookViews(ctx, "book1")
	if err != nil || len(views) != 1 || views[0].Layer != "model" {
		t.Fatalf("unexpected views: %#v (%v)", views, err)
	}
	if err := store.UpsertOfficeOutput(OfficeOutput{ID: "ppt1", ProjectID: "p1", OutputType: "presentation", Title: "Review", Version: 1, Status: "succeeded", WorkbookID: "book1", ViewIDs: []string{"view1"}, SourceIDs: []string{"src1"}, WorkbookFingerprint: "v1", ManuallyEdited: true}); err != nil {
		t.Fatal(err)
	}
	outputs, err := store.QueryOfficeOutputs(ctx, "p1", "book1")
	if err != nil {
		t.Fatal(err)
	}
	if len(outputs) != 1 || outputs[0].ID != "ppt1" || !outputs[0].ManuallyEdited || len(outputs[0].ViewIDs) != 1 {
		t.Fatalf("unexpected outputs: %#v", outputs)
	}
	if err := store.UpsertOfficeRefreshPlan(OfficeRefreshPlan{ID: "ppt1:charts", OutputID: "ppt1", Strategy: "charts", Status: "awaiting_confirmation", ChangedViews: []string{"view1"}, PreserveManualEdits: true, RequiresApproval: true, Attempts: 1}); err != nil {
		t.Fatal(err)
	}
	plans, err := store.QueryOfficeRefreshPlans(ctx, "ppt1")
	if err != nil || len(plans) != 1 || plans[0].Status != "awaiting_confirmation" || !plans[0].RequiresApproval {
		t.Fatalf("unexpected refresh plans: %#v (%v)", plans, err)
	}
}
