// Package watermark decides whether generated images carry the OfficeDex
// watermark. The rule: a paid entitlement lets the user turn it off; without
// one (or when the credit check failed) it is always applied. A "system"
// preference follows the entitlement automatically; a "user" preference is
// left alone.
package watermark

import (
	"strings"

	"officedex/internal/types"
)

// SyncSettingsForCredit aligns the stored watermark preference with the
// current entitlement and reports whether the settings changed.
func SyncSettingsForCredit(s types.UserSettings, credit types.CreditStatus, creditErr error) (types.UserSettings, bool) {
	next := s
	source := strings.ToLower(strings.TrimSpace(next.ImageWatermark.PreferenceSource))
	if source != "user" {
		source = "system"
	}
	next.ImageWatermark.PreferenceSource = source

	if source == "user" {
		return next, next.ImageWatermark.PreferenceSource != s.ImageWatermark.PreferenceSource
	}

	wantShow := true
	if HasEntitlement(credit, creditErr) {
		wantShow = false
	}
	if next.ImageWatermark.ShowWatermark != wantShow {
		next.ImageWatermark.ShowWatermark = wantShow
		return next, true
	}
	return next, next.ImageWatermark.PreferenceSource != s.ImageWatermark.PreferenceSource
}

func GenerateOptions(s types.UserSettings, credit types.CreditStatus, creditErr error) *types.ImageWatermarkGenerateOptions {
	paid := HasEntitlement(credit, creditErr)
	return &types.ImageWatermarkGenerateOptions{
		Apply:           ShouldApply(s, credit, creditErr),
		PaidEntitlement: paid,
		CanDisable:      paid,
	}
}

func ShouldApply(s types.UserSettings, credit types.CreditStatus, creditErr error) bool {
	if s.ImageWatermark.ShowWatermark {
		return true
	}
	if creditErr != nil {
		return true
	}
	return !HasEntitlement(credit, creditErr)
}

func HasEntitlement(credit types.CreditStatus, creditErr error) bool {
	if creditErr != nil {
		return false
	}
	return credit.PaidEntitlement
}
