package diagnostics

import (
	"context"
	"time"

	"officedex/internal/types"
)

type EventQuerier interface {
	QueryEventsByTask(ctx context.Context, taskID string) ([]types.BridgeEvent, error)
	QueryRecentEvents(ctx context.Context, limit int) ([]types.BridgeEvent, error)
}

type BundleOptions struct {
	DestDir         string
	UserDataDir     string
	WorkspaceDir    string
	LocalStore      EventQuerier
	Settings        types.UserSettings
	CachedBridgeEnv []string
	TaskID          string
	IncludeRecent   bool
	IncludeLogs     bool
	AppVersion      string
	Now             func() time.Time
	BundleID        string
	RuntimeDroppedBytes int64
}

type BundleManifest struct {
	SchemaVersion   int          `json:"schemaVersion"`
	BundleID        string       `json:"bundleId"`
	Items           []BundleItem `json:"items"`
	Truncated       bool         `json:"truncated"`
	ExcludedReasons []string     `json:"excludedReasons,omitempty"`
}

type BundleItem struct {
	Path      string `json:"path"`
	SizeBytes int64  `json:"sizeBytes"`
	Preview   string `json:"preview,omitempty"`
	SectionID string `json:"sectionId"`
}
