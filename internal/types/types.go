package types

type DocumentType string

const (
	DocPPTX   DocumentType = "pptx"
	DocDOCX   DocumentType = "docx"
	DocXLSX   DocumentType = "xlsx"
	DocReport DocumentType = "report"
	DocIMG    DocumentType = "img"
)

var DocumentTypes = []DocumentType{DocPPTX, DocDOCX, DocXLSX, DocReport, DocIMG}

func IsValidDocumentType(value string) bool {
	for _, t := range DocumentTypes {
		if string(t) == value {
			return true
		}
	}
	return false
}

type AttachmentSlot string

const (
	SlotSourceWorkbook   AttachmentSlot = "sourceWorkbook"
	SlotReferenceImages  AttachmentSlot = "referenceImages"
)

type AttachmentBridgeArgKey string

const (
	BridgeArgFilePath        AttachmentBridgeArgKey = "file_path"
	BridgeArgReferenceImages AttachmentBridgeArgKey = "reference_images"
)

type AttachmentSpec struct {
	Slot         AttachmentSlot         `json:"slot"`
	Required     bool                   `json:"required"`
	Multiple     bool                   `json:"multiple"`
	MaxCount     int                    `json:"maxCount"`
	Extensions   []string               `json:"extensions"`
	BridgeArgKey AttachmentBridgeArgKey `json:"bridgeArgKey"`
	Label        string                 `json:"label"`
	Description  string                 `json:"description"`
}

type DocumentTypeCapability struct {
	Type        DocumentType     `json:"type"`
	Label       string           `json:"label"`
	Icon        string           `json:"icon"`
	Attachments []AttachmentSpec `json:"attachments"`
}

var DocumentTypeCapabilities = map[DocumentType]DocumentTypeCapability{
	DocPPTX: {Type: DocPPTX, Label: "PPTX", Icon: "slideshow", Attachments: []AttachmentSpec{}},
	DocDOCX: {Type: DocDOCX, Label: "DOCX", Icon: "description", Attachments: []AttachmentSpec{}},
	DocXLSX: {Type: DocXLSX, Label: "XLSX", Icon: "table", Attachments: []AttachmentSpec{}},
	DocReport: {
		Type:  DocReport,
		Label: "Report",
		Icon:  "article",
		Attachments: []AttachmentSpec{{
			Slot:         SlotSourceWorkbook,
			Required:     true,
			Multiple:     false,
			MaxCount:     1,
			Extensions:   []string{"xlsx"},
			BridgeArgKey: BridgeArgFilePath,
			Label:        "Source workbook",
			Description:  "Excel workbook used as the data source for the report.",
		}},
	},
	DocIMG: {
		Type:  DocIMG,
		Label: "Image",
		Icon:  "image",
		Attachments: []AttachmentSpec{{
			Slot:         SlotReferenceImages,
			Required:     false,
			Multiple:     true,
			MaxCount:     6,
			Extensions:   []string{"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"},
			BridgeArgKey: BridgeArgReferenceImages,
			Label:        "Reference images",
			Description:  "Optional style references blended into the generated image.",
		}},
	},
}

func GetCapability(t DocumentType) (DocumentTypeCapability, bool) {
	c, ok := DocumentTypeCapabilities[t]
	return c, ok
}

func GetAttachmentSpec(t DocumentType, slot AttachmentSlot) (AttachmentSpec, bool) {
	c, ok := DocumentTypeCapabilities[t]
	if !ok {
		return AttachmentSpec{}, false
	}
	for _, spec := range c.Attachments {
		if spec.Slot == slot {
			return spec, true
		}
	}
	return AttachmentSpec{}, false
}

func SupportsAttachment(t DocumentType, slot AttachmentSlot) bool {
	_, ok := GetAttachmentSpec(t, slot)
	return ok
}

type BridgeEvent struct {
	EventID   string                 `json:"event_id,omitempty"`
	SessionID string                 `json:"session_id,omitempty"`
	RequestID string                 `json:"request_id,omitempty"`
	TaskID    string                 `json:"task_id,omitempty"`
	Type      string                 `json:"type"`
	TS        string                 `json:"ts,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
}

type Artifact struct {
	TaskID       string `json:"taskId,omitempty"`
	FileID       string `json:"fileID,omitempty"`
	FilePath     string `json:"filePath"`
	FileName     string `json:"fileName"`
	DocumentType string `json:"documentType"`
	PreviewURL   string `json:"previewUrl,omitempty"`
	EditURL      string `json:"editUrl,omitempty"`
	SyncedAt     string `json:"syncedAt,omitempty"`
}

type GenerateInput struct {
	DocumentType     DocumentType `json:"documentType"`
	Topic            string       `json:"topic"`
	Prompt           string       `json:"prompt"`
	Mode             string       `json:"mode,omitempty"`
	RuntimeMode      string       `json:"runtimeMode,omitempty"`
	SourceFile       string       `json:"sourceFile,omitempty"`
	ReferenceImages  []string     `json:"referenceImages,omitempty"`
	OutputDir        string       `json:"outputDir,omitempty"`
	Publish          bool         `json:"publish,omitempty"`
	EnableImages     *bool        `json:"enableImages,omitempty"`
	ImageQuality     string       `json:"imageQuality,omitempty"`
	LocalPreview     bool         `json:"localPreview,omitempty"`
}

type TaskQuestionOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type TaskQuestion struct {
	ID            string               `json:"id"`
	Question      string               `json:"question"`
	Options       []TaskQuestionOption `json:"options"`
	AllowFreeform bool                 `json:"allowFreeform"`
}

type StageStatus string

const (
	StagePending   StageStatus = "pending"
	StageActive    StageStatus = "active"
	StageCompleted StageStatus = "completed"
	StageFailed    StageStatus = "failed"
)

type StageState struct {
	ID          string      `json:"id"`
	Label       string      `json:"label"`
	Status      StageStatus `json:"status"`
	StartedAt   string      `json:"startedAt,omitempty"`
	CompletedAt string      `json:"completedAt,omitempty"`
}

type DesktopTaskStatus string

const (
	TaskStarting  DesktopTaskStatus = "starting"
	TaskRunning   DesktopTaskStatus = "running"
	TaskQuestionStatus DesktopTaskStatus = "question"
	TaskCompleted DesktopTaskStatus = "completed"
	TaskFailed    DesktopTaskStatus = "failed"
	TaskCancelled DesktopTaskStatus = "cancelled"
)

type DesktopTask struct {
	ID            string            `json:"id"`
	Status        DesktopTaskStatus `json:"status"`
	DocumentType  string            `json:"documentType,omitempty"`
	Topic         string            `json:"topic,omitempty"`
	Events        []BridgeEvent     `json:"events"`
	Question      *TaskQuestion     `json:"question,omitempty"`
	Artifact      *Artifact         `json:"artifact,omitempty"`
	Error         string            `json:"error,omitempty"`
	Stages        []StageState      `json:"stages,omitempty"`
	ActiveStageID string            `json:"activeStageId,omitempty"`
	// RuntimeMode records which mode ("custom" / "hosted") the task ran
	// under, captured from the task.started event payload so the renderer can
	// label finished tasks correctly even after the user switches modes.
	RuntimeMode string `json:"runtimeMode,omitempty"`
}

type PreviewGrant struct {
	Token        string `json:"token"`
	FileName     string `json:"fileName"`
	DocumentType string `json:"documentType"`
}

// TaskHistoryEntry carries a persisted task and its bridge events back to
// the renderer so it can replay them into TaskState on startup.
type TaskHistoryEntry struct {
	TaskID string        `json:"taskId"`
	Events []BridgeEvent `json:"events"`
}

type WhoAmIMode string

const (
	WhoAmIAnonymous WhoAmIMode = "anonymous"
	WhoAmILoggedIn  WhoAmIMode = "logged_in"
	WhoAmIAPIKey    WhoAmIMode = "api_key"
)

type WhoAmIResult struct {
	Mode      WhoAmIMode `json:"mode"`
	UserID    string     `json:"userId,omitempty"`
	Email     string     `json:"email,omitempty"`
	Session   string     `json:"session,omitempty"`
	ExpiresAt string     `json:"expiresAt,omitempty"`
}

// CreditStatus mirrors the quota fields surfaced by `officecli auth status`.
// HostedCreditBalance and AnonymousCredit* are pointers so we can distinguish
// "line absent" from "value is zero".
type CreditStatus struct {
	Mode                      WhoAmIMode `json:"mode"`
	AccessMode                string     `json:"accessMode"`
	PlanName                  string     `json:"planName"`
	HostedCreditBalance       *int       `json:"hostedCreditBalance"`
	AnonymousCreditAvailable  *int       `json:"anonymousCreditAvailable"`
	AnonymousCreditReserved   *int       `json:"anonymousCreditReserved"`
	AnonymousCreditBalance    *int       `json:"anonymousCreditBalance"`
	RewardRemaining           int        `json:"rewardRemaining"`
	PaidKeyPrefix             string     `json:"paidKeyPrefix"`
	PaidKeyTotal              int        `json:"paidKeyTotal"`
	PaidKeyUsed               int        `json:"paidKeyUsed"`
	PaidKeyRemaining          int        `json:"paidKeyRemaining"`
	Raw                       string     `json:"raw"`
}

// RedeemResult is the parsed payload returned by `officecli redeem --json`.
// The shape mirrors platform's redemptionsvc.RedeemResponse.
type RedeemResult struct {
	Code         string  `json:"code"`
	CreditAmount int     `json:"credit_amount"`
	NewBalance   int     `json:"new_balance"`
	RedeemedAt   string  `json:"redeemed_at"`
	ExpiresAt    *string `json:"expires_at,omitempty"`
}

type AuthEventType string

const (
	AuthEventURL     AuthEventType = "url"
	AuthEventSuccess AuthEventType = "success"
	AuthEventFailure AuthEventType = "failure"
	AuthEventExit    AuthEventType = "exit"
)

type AuthEvent struct {
	Type    AuthEventType `json:"type"`
	URL     string        `json:"url,omitempty"`
	Message string        `json:"message,omitempty"`
	Code    *int          `json:"code,omitempty"`
	Signal  string        `json:"signal,omitempty"`
}

type GenerateMode string

const (
	ModeFast GenerateMode = "fast"
	ModeBest GenerateMode = "best"
)

type RuntimeMode string

const (
	RuntimeCustom RuntimeMode = "custom"
	RuntimeHosted RuntimeMode = "hosted"
)

type ImageQuality string

const (
	ImageStandard ImageQuality = "standard"
	ImagePremium  ImageQuality = "premium"
)

type GenerateDefaults struct {
	DocumentType DocumentType `json:"documentType"`
	Mode         GenerateMode `json:"mode"`
	EnableImages bool         `json:"enableImages"`
	ImageQuality ImageQuality `json:"imageQuality"`
}

type LlmProviderType string

const (
	LlmOpenAI    LlmProviderType = "openai"
	LlmAnthropic LlmProviderType = "anthropic"
	LlmAzure     LlmProviderType = "azure"
	LlmCustom    LlmProviderType = "custom"
	LlmOfficial  LlmProviderType = "official"
)

var LlmProviderTypes = []LlmProviderType{LlmOpenAI, LlmAnthropic, LlmAzure, LlmCustom, LlmOfficial}

type LlmProvider struct {
	Type    LlmProviderType `json:"type"`
	BaseURL string          `json:"baseUrl"`
	APIKey  string          `json:"apiKey"`
	Model   string          `json:"model"`
}

// ProxySettings configures an HTTP/SOCKS proxy that routes all outbound
// network traffic from the desktop app and its officecli subprocess.
type ProxySettings struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
}

type UserSettings struct {
	Version                int              `json:"version"`
	Defaults               GenerateDefaults `json:"defaults"`
	OutputDir              *string          `json:"outputDir"`
	BridgeBinaryPath       *string          `json:"bridgeBinaryPath"`
	LlmProvider            *LlmProvider     `json:"llmProvider"`
	OnboardingCompletedAt  *string          `json:"onboardingCompletedAt"`
	SupportReportEndpoint  *string          `json:"supportReportEndpoint"`
	SupportReportToken     *string          `json:"supportReportToken"`
	Proxy                  *ProxySettings   `json:"proxy,omitempty"`
}

// RuntimeStatus mirrors the renderer-facing status object emitted by the
// runtime manager. All optional string fields use *string so a missing value
// serialises to JSON null, matching the TypeScript origin's `string | null`.
type RuntimeStatus struct {
	Installed          bool    `json:"installed"`
	CurrentVersion     *string `json:"currentVersion"`
	LatestVersion      *string `json:"latestVersion"`
	LastCheckedAt      *string `json:"lastCheckedAt"`
	ManualPath         *string `json:"manualPath"`
	ResolvedBinaryPath *string `json:"resolvedBinaryPath"`
	Updating           bool    `json:"updating"`
	LastError          *string `json:"lastError"`
}

// RuntimeEventType discriminates the union shape of RuntimeEvent.
type RuntimeEventType string

const (
	RuntimeEventStatus    RuntimeEventType = "status"
	RuntimeEventProgress  RuntimeEventType = "progress"
	RuntimeEventInstalled RuntimeEventType = "installed"
	RuntimeEventError     RuntimeEventType = "error"
)

// RuntimePhase names the progress sub-state. Only meaningful when Type ==
// RuntimeEventProgress.
type RuntimePhase string

const (
	RuntimePhaseChecking    RuntimePhase = "checking"
	RuntimePhaseDownloading RuntimePhase = "downloading"
	RuntimePhaseInstalling  RuntimePhase = "installing"
)

// RuntimeEvent is the value emitted on every RuntimeManager state transition.
// Fields not relevant to the current Type are zero-valued and omitted from
// JSON via omitempty / pointer types.
type RuntimeEvent struct {
	Type       RuntimeEventType `json:"type"`
	Status     *RuntimeStatus   `json:"status,omitempty"`
	Phase      RuntimePhase     `json:"phase,omitempty"`
	Message    string           `json:"message,omitempty"`
	BytesDone  *int64           `json:"bytesDone,omitempty"`
	BytesTotal *int64           `json:"bytesTotal,omitempty"`
	Version    string           `json:"version,omitempty"`
}

// BridgeRuntimeSnapshot is the renderer-facing description of what the
// currently-resolved officecli subprocess is configured with. EnvApplied is
// true only when ensureBridge has populated the cached resolved fields — i.e.
// a subprocess has actually been spawned with this configuration. Provider is
// always sourced from the env slice that was handed to the subprocess; we do
// not fall back to settings.json so the snapshot's promise to the user is
// strictly "what is running" rather than "what is configured".
type BridgeRuntimeSnapshot struct {
	RuntimeMode RuntimeMode       `json:"runtimeMode"`
	Provider    *ProviderSnapshot `json:"provider,omitempty"`
	BinaryPath  string            `json:"binaryPath"`
	ResolvedAt  string            `json:"resolvedAt,omitempty"`
	EnvApplied  bool              `json:"envApplied"`
	ProxyHost   string            `json:"proxyHost,omitempty"`
}

// ProviderSnapshot mirrors the OFFICECLI_LLM_* env vars that were passed to
// the bridge subprocess. The API key is rendered through internal/mask before
// being stored here; APIKeyLength reports the rune length of the original
// (untrimmed) value so users can sanity-check they configured the right key.
type ProviderSnapshot struct {
	Type         LlmProviderType `json:"type"`
	BaseURLHost  string          `json:"baseUrlHost"`
	Model        string          `json:"model"`
	APIKeyMasked string          `json:"apiKeyMasked"`
	APIKeyLength int             `json:"apiKeyLength"`
}

// ProviderTestResult is the outcome of a TestProvider probe. The test sends a
// real "hi" chat completion to verify the LLM can respond. For bridge-based
// probes (official/hosted mode) HTTPStatus is left at 0 and OK indicates
// whether the bridge initialized successfully.
type ProviderTestResult struct {
	OK              bool   `json:"ok"`
	HTTPStatus      int    `json:"httpStatus"`
	LatencyMs       int64  `json:"latencyMs"`
	URL             string `json:"url"`
	Error           string `json:"error,omitempty"`
	ResponseMessage string `json:"responseMessage,omitempty"`
}
