// Package onboarding persists setup separately from generation preferences.
package onboarding

import (
	"encoding/json"
	"errors"
	"officedex/internal/atomicfile"
	"os"
	"path/filepath"
)

type State struct {
	Version   int    `json:"version"`
	Status    string `json:"status"`
	Step      string `json:"step"`
	StartMode string `json:"startMode"`
}

func Initial(existing bool) State {
	s := State{Version: 1, Status: "pending", Step: "welcome", StartMode: "agent"}
	if existing {
		s.Status = "migrated"
	}
	return s
}

// Initialize runs before the application creates its settings or database.
// Existing installations are migrated even if their old completion date is null.
func Initialize(dir string) error {
	if _, err := os.Stat(filepath.Join(dir, "onboarding.json")); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	existing := false
	for _, name := range []string{"settings.json", "officedex.sqlite"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			existing = true
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	return Save(dir, Initial(existing))
}

func Load(dir string) (State, error) {
	var state State
	body, err := os.ReadFile(filepath.Join(dir, "onboarding.json"))
	if err != nil {
		return state, err
	}
	if err = json.Unmarshal(body, &state); err != nil {
		return state, err
	}
	return state, Validate(state)
}

func Validate(s State) error {
	if s.Version != 1 || (s.StartMode != "agent" && s.StartMode != "local") {
		return errors.New("invalid setup version or mode")
	}
	switch s.Status {
	case "pending", "completed", "skipped", "migrated":
	default:
		return errors.New("invalid setup status")
	}
	switch s.Step {
	case "welcome", "introduction", "ai", "preferences", "defaults":
	default:
		return errors.New("invalid setup step")
	}
	return nil
}

func Save(dir string, state State) error {
	if err := Validate(state); err != nil {
		return err
	}
	body, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return atomicfile.WriteFile(filepath.Join(dir, "onboarding.json"), body, 0600)
}
