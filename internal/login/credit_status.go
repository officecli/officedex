package login

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"officedex/internal/types"
)

// authStatusJSON is the shape `officecli auth status --json` prints. It is the
// CLI's authStatusReport, decoded back.
//
// This replaced seven regular expressions that read the same values out of the
// CLI's English prose. That arrangement failed silently in production: the
// hosted credits line grew a " credits remaining" suffix, the anchored regex
// stopped matching, and the desktop app read the balance as absent rather than
// as an error. Field names cannot drift that quietly — the CLI has a test
// pinning each one.
//
// The pointers are load-bearing. A quota that does not apply to this account
// arrives as null, and a quota that applies and is exhausted arrives as 0;
// types.CreditStatus keeps them apart for the same reason.
type authStatusJSON struct {
	Mode                string `json:"mode"`
	AccessMode          string `json:"access_mode"`
	PlanName            string `json:"plan_name"`
	PaidEntitlement     bool   `json:"paid_entitlement"`
	HostedCreditBalance *int   `json:"hosted_credit_balance"`
	AnonymousCredit     *struct {
		Available int `json:"available"`
		Reserved  int `json:"reserved"`
		Balance   int `json:"balance"`
	} `json:"anonymous_credit"`
	RewardRemaining int `json:"reward_remaining"`
	PaidKey         *struct {
		Prefix    string `json:"prefix"`
		Total     int    `json:"total"`
		Used      int    `json:"used"`
		Remaining int    `json:"remaining"`
	} `json:"paid_key"`
}

// GetCreditStatus spawns `officecli auth status --json`, waits for exit, and
// decodes the quota report. A non-zero exit is treated as an unauthenticated /
// anonymous state — the caller gets a zero-value CreditStatus (Mode=anonymous)
// rather than an error, mirroring GetWhoAmI's tolerance.
func GetCreditStatus(ctx context.Context, opts ManagerOptions) (types.CreditStatus, error) {
	stdout, _, code, err := runOnce(ctx, opts, []string{"auth", "status", "--json"})
	if err != nil {
		return types.CreditStatus{}, err
	}
	return ParseCreditStatus(stdout, code)
}

// ParseCreditStatus decodes what `officecli auth status --json` printed.
//
// A non-zero exit short-circuits to anonymous, as before: the CLI exits non-zero
// when it cannot reach the license service at all, and there is nothing to
// report. Malformed output on a zero exit is a real error, though — the previous
// prose parser could only shrug at it and return zeros, which is how a rewording
// went unnoticed.
func ParseCreditStatus(stdout string, exitCode int) (types.CreditStatus, error) {
	result := types.CreditStatus{Mode: types.WhoAmIAnonymous, Raw: stdout}
	if exitCode != 0 {
		return result, nil
	}
	trimmed := strings.TrimSpace(stdout)
	if trimmed == "" {
		return result, fmt.Errorf("officecli auth status --json printed nothing")
	}

	var report authStatusJSON
	if err := json.Unmarshal([]byte(trimmed), &report); err != nil {
		return result, outdatedCLIError("auth status", err)
	}

	result.Mode = creditStatusMode(report.Mode)
	result.AccessMode = strings.TrimSpace(report.AccessMode)
	result.PlanName = strings.TrimSpace(report.PlanName)
	result.PaidEntitlement = report.PaidEntitlement
	result.HostedCreditBalance = report.HostedCreditBalance
	result.RewardRemaining = report.RewardRemaining
	if anon := report.AnonymousCredit; anon != nil {
		available, reserved, balance := anon.Available, anon.Reserved, anon.Balance
		result.AnonymousCreditAvailable = &available
		result.AnonymousCreditReserved = &reserved
		result.AnonymousCreditBalance = &balance
	}
	if paid := report.PaidKey; paid != nil {
		result.PaidKeyPrefix = strings.TrimSpace(paid.Prefix)
		result.PaidKeyTotal = paid.Total
		result.PaidKeyUsed = paid.Used
		result.PaidKeyRemaining = paid.Remaining
	}
	return result, nil
}

// creditStatusMode maps the CLI's mode names onto the renderer's. An
// unrecognised one falls back to anonymous — the least-privileged reading, so a
// CLI that grows a fourth mode cannot accidentally unlock a paid affordance
// here.
func creditStatusMode(mode string) types.WhoAmIMode {
	switch strings.TrimSpace(mode) {
	case string(types.WhoAmIAPIKey):
		return types.WhoAmIAPIKey
	case string(types.WhoAmILoggedIn):
		return types.WhoAmILoggedIn
	default:
		return types.WhoAmIAnonymous
	}
}
