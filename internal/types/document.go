package types

// FolderRecord is a real directory the app files documents into.
//
// Exactly one folder is the default — where work lands when the user has not
// chosen anywhere else. It is synthesised from the per-user workspace
// directory rather than stored, so the old IA's "no project" path and the new
// one's "default folder" are the same place on disk without either having to
// agree with the other. See app_folders.go.
type FolderRecord struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	// Absolute path on disk. The UI shows it; it never parses it.
	Path      string `json:"path"`
	IsDefault bool   `json:"isDefault,omitempty"`
}

type DocumentRecord struct {
	ID                    string `json:"id"`
	FilePath              string `json:"filePath"`
	FileName              string `json:"fileName"`
	DocumentType          string `json:"documentType"`
	CurrentArtifactTaskID string `json:"currentArtifactTaskId,omitempty"`
	WorkspaceID           string `json:"workspaceId,omitempty"`
	CreatedAt             string `json:"createdAt"`
	UpdatedAt             string `json:"updatedAt"`
	MigrationSource       string `json:"migrationSource"`
	// Pinned is a filter on the one file list, not a separate location.
	Pinned                bool   `json:"pinned"`
}

type RunRecord struct {
	ID                   string `json:"id"`
	DocumentID           string `json:"documentId,omitempty"`
	ActivityStreamID     string `json:"activityStreamId"`
	SourceConversationID string `json:"sourceConversationId"`
	ParentRunID          string `json:"parentRunId,omitempty"`
	Status               string `json:"status"`
	DocumentType         string `json:"documentType,omitempty"`
	SourceFile           string `json:"sourceFile,omitempty"`
	CreatedAt            string `json:"createdAt"`
	UpdatedAt            string `json:"updatedAt"`
}

type ActivityRecord struct {
	ID                   string `json:"id"`
	ActivityStreamID     string `json:"activityStreamId"`
	SourceConversationID string `json:"sourceConversationId"`
	TaskID               string `json:"taskId"`
	Ordinal              int    `json:"ordinal"`
	Kind                 string `json:"kind"`
	EventID              string `json:"eventId,omitempty"`
	EventType            string `json:"eventType"`
	PayloadJSON          string `json:"payloadJson"`
	CreatedAt            string `json:"createdAt"`
}

type DocumentListInput struct {
	WorkspaceID string `json:"workspaceId,omitempty"`
	Limit       int    `json:"limit,omitempty"`
	Cursor      string `json:"cursor,omitempty"`
}

type DocumentPage struct {
	Items      []DocumentRecord `json:"items"`
	NextCursor string           `json:"nextCursor,omitempty"`
}

type DocumentActivityListInput struct {
	DocumentID string `json:"documentId"`
	Limit      int    `json:"limit,omitempty"`
	Cursor     string `json:"cursor,omitempty"`
}

type ActivityPage struct {
	Items      []ActivityRecord `json:"items"`
	NextCursor string           `json:"nextCursor,omitempty"`
}
