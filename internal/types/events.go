package types

// Bridge event types. The officecli bridge emits the task.* events over
// JSON-RPC notifications; the desktop synthesises the Local* ones itself and
// stores them in the same task history. Keeping the names here means a typo
// is a compile error and the cross-repo contract test has one place to read.
const (
	EventTaskStarted     = "task.started"
	EventTaskProgress    = "task.progress"
	EventTaskQuestion    = "task.question"
	EventTaskPlan        = "task.plan"
	EventTaskVibeTree    = "task.vibe_tree"
	EventTaskVibeOps     = "task.vibe_ops"
	EventTaskVibeSlide   = "task.vibe_slide"
	EventTaskVibeOutline = "task.vibe_outline"
	EventTaskReslideTail = "task.reslide_tail"
	EventTaskOutput      = "task.output"
	EventTaskCompleted   = "task.completed"
	EventTaskFailed      = "task.failed"
	EventTaskCancelled   = "task.cancelled"

	// Desktop-local events. They share the task.* prefix because they are
	// persisted alongside the bridge's events and queried by type in the same
	// history; the bridge never emits them.
	EventLocalUserInput = "task.user_input"
	EventLocalAnswers   = "task.answers"
	EventLocalPlan      = "task.plan"
)

// CancelReasonRecoveredAfterRestart marks a task.cancelled event the desktop
// wrote itself when it found a task from a previous run that could not be
// resumed. Recovery checks this reason rather than the human-readable message.
const CancelReasonRecoveredAfterRestart = "recovered_after_restart"
