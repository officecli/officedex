// Package instance owns the persistent identity of one OfficeDex user-data
// profile. The ID scopes its OfficeCLI Runtime and Wails single-instance lock.
package instance

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"officedex/internal/atomicfile"
)

const identityFileName = "instance.json"

type Identity struct {
	DesktopInstanceID string `json:"desktop_instance_id"`
	CreatedAt         string `json:"created_at"`
}

func LoadOrCreate(userDataDir string) (Identity, error) {
	path := filepath.Join(userDataDir, identityFileName)
	if identity, err := load(path); err == nil {
		return identity, nil
	} else if !os.IsNotExist(err) {
		return Identity{}, err
	}

	lockPath := path + ".create.lock"
	lock, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if errors.Is(err, os.ErrExist) {
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			if identity, loadErr := load(path); loadErr == nil {
				return identity, nil
			}
			time.Sleep(20 * time.Millisecond)
		}
		if info, statErr := os.Stat(lockPath); statErr == nil && time.Since(info.ModTime()) > 30*time.Second {
			if removeErr := os.Remove(lockPath); removeErr == nil {
				return LoadOrCreate(userDataDir)
			}
		}
		return Identity{}, fmt.Errorf("OfficeDex instance identity creation is already in progress")
	}
	if err != nil {
		return Identity{}, fmt.Errorf("lock OfficeDex instance identity: %w", err)
	}
	_ = lock.Close()
	defer os.Remove(lockPath)
	// Another creator may have completed between the initial read and lock.
	if identity, err := load(path); err == nil {
		return identity, nil
	} else if !os.IsNotExist(err) {
		return Identity{}, err
	}

	identity := Identity{
		DesktopInstanceID: uuid.NewString(),
		CreatedAt:         time.Now().UTC().Format(time.RFC3339Nano),
	}
	raw, err := json.MarshalIndent(identity, "", "  ")
	if err != nil {
		return Identity{}, fmt.Errorf("marshal OfficeDex instance identity: %w", err)
	}
	raw = append(raw, '\n')
	if err := atomicfile.WriteFile(path, raw, 0o600); err != nil {
		return Identity{}, fmt.Errorf("write OfficeDex instance identity: %w", err)
	}
	return load(path)
}

func load(path string) (Identity, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Identity{}, err
	}
	var identity Identity
	if err := json.Unmarshal(raw, &identity); err != nil {
		return Identity{}, fmt.Errorf("decode OfficeDex instance identity: %w", err)
	}
	identity.DesktopInstanceID = strings.TrimSpace(identity.DesktopInstanceID)
	if _, err := uuid.Parse(identity.DesktopInstanceID); err != nil {
		return Identity{}, fmt.Errorf("invalid OfficeDex desktop_instance_id %q: %w", identity.DesktopInstanceID, err)
	}
	if strings.TrimSpace(identity.CreatedAt) == "" {
		return Identity{}, errors.New("OfficeDex instance identity is missing created_at")
	}
	return identity, nil
}
