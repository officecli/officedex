package main

import (
	"officedex/internal/onboarding"
	"reflect"
	"testing"
)

func TestNativeFileQueueSurvivesUntilConsumed(t *testing.T) {
	app := &App{}
	app.queueNativeFile("/tmp/report.docx")
	app.queueNativeFile("/tmp/report.docx")
	app.queueNativeFile("relative.docx")
	app.queueNativeFile("/tmp/budget.xlsx")
	if got := app.TakeNativeOpenFiles(); !reflect.DeepEqual(got, []string{"/tmp/report.docx", "/tmp/budget.xlsx"}) {
		t.Fatal(got)
	}
	if got := app.TakeNativeOpenFiles(); got == nil || len(got) != 0 {
		t.Fatal(got)
	}
}

func TestSetupWindowInitialDimensions(t *testing.T) {
	for _, tc := range []struct {
		name, status, step string
		width, height      int
	}{
		{"first welcome", "pending", "welcome", 600, 700},
		{"resume setup", "pending", "defaults", 1120, 720},
		{"existing user", "migrated", "welcome", 1320, 860},
		{"completed", "completed", "defaults", 1320, 860},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			state := onboarding.Initial(false)
			state.Status, state.Step = tc.status, tc.step
			if err := onboarding.Save(dir, state); err != nil {
				t.Fatal(err)
			}
			app := &App{userDataDir: dir}
			options := newWailsAppOptions(app)
			if options.Width != tc.width || options.Height != tc.height {
				t.Fatalf("got %dx%d, want %dx%d", options.Width, options.Height, tc.width, tc.height)
			}
			if tc.status == "pending" && (app.setupWindow == nil || !app.setupWindow.Fresh || app.setupWindow.Width != 1320) {
				t.Fatal("new installation did not preserve workspace restore dimensions")
			}
		})
	}
}
func TestSetupWindowRejectsUnknownStage(t *testing.T) {
	if (&App{}).SetSetupWindow("custom") == nil {
		t.Fatal("invalid stage accepted")
	}
}
