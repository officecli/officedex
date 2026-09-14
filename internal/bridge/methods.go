package bridge

// JSON-RPC method names the desktop calls on the officecli agent bridge. One
// list, so a renamed method is a compile error here rather than a string that
// silently stops matching; officecli's registry test compares against these
// through the cross-repo contract test.
const (
	MethodTaskSkipResearch                   = "task/skip_research"
	// The live-gear trio: officecli absorbs an intervention and holds the run at
	// the next page boundary, which is what the desktop's steering bar and pause
	// button promise the user.
	MethodTaskIntervene                      = "task/intervene"
	MethodTaskPause                          = "task/pause"
	MethodTaskResumeLive                     = "task/resume"
	MethodInitialize                         = "initialize"
	MethodCapabilitiesGet                    = "capabilities/get"
	MethodSessionOpen                        = "session/open"
	MethodTaskInvoke                         = "task/invoke"
	MethodTaskRespond                        = "task/respond"
	MethodTaskStatus                         = "task/status"
	MethodTaskCancel                         = "task/cancel"
	MethodPptxPlanJS                         = "pptx/plan-js"
	MethodImageTemplatesList                 = "image_templates/list"
	MethodImageTemplatesCreate               = "image_templates/create"
	MethodImageTemplatePublishRequestsCreate = "image_template_publish_requests/create"
)
