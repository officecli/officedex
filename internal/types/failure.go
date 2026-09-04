package types

import (
	"regexp"
	"strings"
)

// FailureKind is the coarse category the renderer uses to decide what to show
// for an error: sign in, fix setup, retry the connection, or retry the task.
// It used to be guessed from the message text ("login", "enoent", "429", even
// "饱和"); errors now say which kind they are.
type FailureKind string

const (
	FailureAuth       FailureKind = "auth"
	FailureSetup      FailureKind = "setup"
	FailureConnection FailureKind = "connection"
	FailureTask       FailureKind = "task"
	FailureOther      FailureKind = "other"
)

// failureTagPattern is the wire form of a kind inside an error message. Wails
// hands the renderer error.Error() and nothing else, so the kind travels in
// the text; wrapping with %w keeps it, and the renderer strips it for display.
var failureTagPattern = regexp.MustCompile(`\[kind:(auth|setup|connection|task|other)\]\s*`)

// TagFailure prefixes message with the kind tag the renderer reads. A message
// that already carries a tag is returned unchanged so wrapping does not
// stack tags.
func TagFailure(kind FailureKind, message string) string {
	if failureTagPattern.MatchString(message) {
		return message
	}
	return "[kind:" + string(kind) + "] " + message
}

// FailureKindOf returns the kind tagged in text, or FailureOther.
func FailureKindOf(text string) FailureKind {
	if match := failureTagPattern.FindStringSubmatch(text); match != nil {
		return FailureKind(match[1])
	}
	return FailureOther
}

// StripFailureTag removes the kind tag for display.
func StripFailureTag(text string) string {
	return strings.TrimSpace(failureTagPattern.ReplaceAllString(text, ""))
}

// codeTagPattern is the wire form of a bridge error code inside an error
// message, next to the kind tag: `[code:no_pending_input]`. The renderer
// decides by code what it used to decide by matching the sentence.
var codeTagPattern = regexp.MustCompile(`\[code:([a-z_]+)\]\s*`)

// TagCode prefixes message with a machine-readable code tag. An empty code
// or a message that already carries one is returned unchanged.
func TagCode(code, message string) string {
	if code == "" || codeTagPattern.MatchString(message) {
		return message
	}
	return "[code:" + code + "] " + message
}

// ErrorCodeOf returns the code tagged in text, or "".
func ErrorCodeOf(text string) string {
	if match := codeTagPattern.FindStringSubmatch(text); match != nil {
		return match[1]
	}
	return ""
}

// StripTags removes both the kind and the code tag for display.
func StripTags(text string) string {
	return strings.TrimSpace(codeTagPattern.ReplaceAllString(failureTagPattern.ReplaceAllString(text, ""), ""))
}
