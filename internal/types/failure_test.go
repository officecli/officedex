package types

import "testing"

func TestFailureTagRoundTrip(t *testing.T) {
	tagged := TagFailure(FailureAuth, "custom_provider.login_required")
	if FailureKindOf(tagged) != FailureAuth {
		t.Fatalf("kind of %q = %q", tagged, FailureKindOf(tagged))
	}
	if StripFailureTag(tagged) != "custom_provider.login_required" {
		t.Fatalf("strip = %q", StripFailureTag(tagged))
	}
	// Wrapping keeps the tag readable and re-tagging does not stack.
	wrapped := "save pptx: " + tagged
	if FailureKindOf(wrapped) != FailureAuth {
		t.Fatalf("wrapped kind = %q", FailureKindOf(wrapped))
	}
	if TagFailure(FailureSetup, tagged) != tagged {
		t.Fatal("re-tagging stacked a second tag")
	}
	if FailureKindOf("plain text mentioning login and 429") != FailureOther {
		t.Fatal("untagged text must be 'other', not guessed from wording")
	}
}

func TestCodeTagTravelsBesideTheKindTag(t *testing.T) {
	msg := TagFailure(FailureTask, TagCode("no_pending_input", "task t-1: has no pending input"))
	if got := ErrorCodeOf(msg); got != "no_pending_input" {
		t.Fatalf("ErrorCodeOf(%q) = %q", msg, got)
	}
	if got := FailureKindOf(msg); got != FailureTask {
		t.Fatalf("kind lost next to the code tag: %q", got)
	}
	if got := StripTags(msg); got != "task t-1: has no pending input" {
		t.Fatalf("StripTags = %q", got)
	}
	if got := TagCode("x", TagCode("y", "m")); got != "[code:y] m" {
		t.Fatalf("a second code must not stack: %q", got)
	}
	if got := TagCode("", "m"); got != "m" {
		t.Fatalf("an empty code must not tag: %q", got)
	}
	if got := ErrorCodeOf("plain"); got != "" {
		t.Fatalf("untagged text has no code, got %q", got)
	}
}
