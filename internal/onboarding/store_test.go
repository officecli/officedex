package onboarding

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSetupMigrationAndResume(t *testing.T) {
	for _, old := range []bool{false, true} {
		t.Run(map[bool]string{true: "existing", false: "new"}[old], func(t *testing.T) {
			dir := t.TempDir()
			if old {
				if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"onboardingCompletedAt":null}`), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := Initialize(dir); err != nil {
				t.Fatal(err)
			}
			state, err := Load(dir)
			if err != nil {
				t.Fatal(err)
			}
			if (state.Status == "pending") == old {
				t.Fatalf("wrong migration: %+v", state)
			}
			state.Step = "defaults"
			state.StartMode = "local"
			if err := Save(dir, state); err != nil {
				t.Fatal(err)
			}
			if err := Initialize(dir); err != nil {
				t.Fatal(err)
			}
			resumed, err := Load(dir)
			if err != nil || resumed != state {
				t.Fatalf("lost progress: %+v %v", resumed, err)
			}
		})
	}
}
func TestInvalidSetupDoesNotOverwrite(t *testing.T) {
	dir := t.TempDir()
	if err := Initialize(dir); err != nil {
		t.Fatal(err)
	}
	state := Initial(false)
	state.StartMode = "other"
	if Save(dir, state) == nil {
		t.Fatal("accepted invalid mode")
	}
	saved, err := Load(dir)
	if err != nil || saved != Initial(false) {
		t.Fatalf("changed stored state: %+v %v", saved, err)
	}
}
