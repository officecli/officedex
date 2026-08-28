package types

type ArtifactStageTarget struct {
	ArtifactID   string `json:"artifact_id"`
	ArtifactPath string `json:"artifact_path"`
	DocumentType string `json:"document_type"`
}

type ArtifactStageBlockTarget struct {
	BlockID       string `json:"block_id"`
	BlockKind     string `json:"block_kind"`
	Path          []int  `json:"path"`
	TextSHA256    string `json:"text_sha256"`
	ParagraphHint int    `json:"paragraph_hint"`
}

type ArtifactStageRangeTarget struct {
	SheetID   string `json:"sheet_id"`
	SheetName string `json:"sheet_name,omitempty"`
	A1        string `json:"a1"`
}

type ArtifactStageFrameTarget struct {
	Kind       string `json:"kind"`
	Index      int    `json:"index,omitempty"`
	Start      int    `json:"start,omitempty"`
	End        int    `json:"end,omitempty"`
	FrameCount int    `json:"frame_count,omitempty"`
}

type ArtifactStageRegionTarget struct {
	X      float64                   `json:"x"`
	Y      float64                   `json:"y"`
	Width  float64                   `json:"width"`
	Height float64                   `json:"height"`
	Frames *ArtifactStageFrameTarget `json:"frames,omitempty"`
}

type ArtifactStageScope struct {
	Kind   string                     `json:"kind"`
	Block  *ArtifactStageBlockTarget  `json:"block,omitempty"`
	Range  *ArtifactStageRangeTarget  `json:"range,omitempty"`
	Region *ArtifactStageRegionTarget `json:"region,omitempty"`
}

type ArtifactStageEnvelope struct {
	Version        int                 `json:"version"`
	Action         string              `json:"action"`
	Instruction    string              `json:"instruction"`
	CostClass      string              `json:"cost_class"`
	IdempotencyKey string              `json:"idempotency_key"`
	ExpectedSHA256 string              `json:"expected_sha256"`
	WriteMode      string              `json:"write_mode"`
	Target         ArtifactStageTarget `json:"target"`
	Scope          ArtifactStageScope  `json:"scope"`
}

type ArtifactStageEditInput struct {
	ArtifactStage  ArtifactStageEnvelope `json:"artifact_stage"`
	WorkspaceID    string                `json:"workspaceId,omitempty"`
	NoProject      bool                  `json:"noProject,omitempty"`
	ConversationID string                `json:"conversationId,omitempty"`
	ParentTaskID   string                `json:"parentTaskId,omitempty"`
}
