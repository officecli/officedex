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
