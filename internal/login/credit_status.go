package login

import (
	"context"
	"regexp"
	"strconv"
	"strings"

	"officedex/internal/types"
)

var (
	hostedCreditLine    = regexp.MustCompile(`(?im)^\s*Account hosted credits:\s*(-?\d+)\s*$`)
	freeTrialQuotaLine  = regexp.MustCompile(`(?im)^\s*Free trial quota.*?:\s*(\d+)\s*total\s*/\s*(\d+)\s*used\s*/\s*(\d+)\s*remaining\s*$`)
	rewardRemainingLine = regexp.MustCompile(`(?im)^\s*Reward quota remaining:\s*(\d+)\s*$`)
	paidQuotaLine       = regexp.MustCompile(`(?im)^\s*Paid quota on current key\s*\(([^)]*)\):\s*(\d+)\s*total\s*/\s*(\d+)\s*used\s*/\s*(\d+)\s*remaining\s*$`)
	currentAccessLine   = regexp.MustCompile(`(?im)^\s*Current access mode:\s*(.+?)\s*$`)
	currentPlanLine     = regexp.MustCompile(`(?im)^\s*Current plan:\s*(.+?)\s*$`)
)

// GetCreditStatus spawns `officecli auth status`, waits for exit, and parses
// the textual quota output. A non-zero exit is treated as an unauthenticated /
// anonymous state — the caller gets a zero-value CreditStatus (Mode=anonymous)
// rather than an error, mirroring GetWhoAmI's tolerance.
func GetCreditStatus(ctx context.Context, opts ManagerOptions) (types.CreditStatus, error) {
	stdout, _, code, err := runOnce(ctx, opts, []string{"auth", "status"})
	if err != nil {
		return types.CreditStatus{}, err
	}
	return ParseCreditStatus(stdout, code), nil
}

// ParseCreditStatus reads the text output produced by `officecli auth status`
// (see officecli/internal/cli/app.go runAuthStatus) and lifts the relevant
// quota / plan fields into a CreditStatus. Lines that are missing leave their
// destination fields at the zero value; the hosted credits line is special-
// cased to nil so callers can distinguish "no hosted plan" from "0 credits".
func ParseCreditStatus(stdout string, exitCode int) types.CreditStatus {
	result := types.CreditStatus{Mode: types.WhoAmIAnonymous, Raw: stdout}
	if exitCode != 0 {
		return result
	}

	result.Mode = inferMode(stdout)

	if m := hostedCreditLine.FindStringSubmatch(stdout); len(m) == 2 {
		if v, err := strconv.Atoi(m[1]); err == nil {
			result.HostedCreditBalance = &v
		}
	}
	if m := freeTrialQuotaLine.FindStringSubmatch(stdout); len(m) == 4 {
		result.FreeTrialLimit = atoiOrZero(m[1])
		result.FreeTrialUsed = atoiOrZero(m[2])
		result.FreeTrialRemaining = atoiOrZero(m[3])
	}
	if m := rewardRemainingLine.FindStringSubmatch(stdout); len(m) == 2 {
		result.RewardRemaining = atoiOrZero(m[1])
	}
	if m := paidQuotaLine.FindStringSubmatch(stdout); len(m) == 5 {
		result.PaidKeyPrefix = strings.TrimSpace(m[1])
		result.PaidKeyTotal = atoiOrZero(m[2])
		result.PaidKeyUsed = atoiOrZero(m[3])
		result.PaidKeyRemaining = atoiOrZero(m[4])
	}
	if m := currentAccessLine.FindStringSubmatch(stdout); len(m) == 2 {
		result.AccessMode = strings.TrimSpace(m[1])
	}
	if m := currentPlanLine.FindStringSubmatch(stdout); len(m) == 2 {
		result.PlanName = strings.TrimSpace(m[1])
	}
	return result
}

func inferMode(stdout string) types.WhoAmIMode {
	lowered := strings.ToLower(stdout)
	if strings.Contains(lowered, "api key configured: true") || strings.Contains(lowered, "mode: api key") {
		return types.WhoAmIAPIKey
	}
	if strings.Contains(lowered, "account session configured: true") || strings.Contains(lowered, "mode: logged in") {
		return types.WhoAmILoggedIn
	}
	return types.WhoAmIAnonymous
}

func atoiOrZero(s string) int {
	v, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0
	}
	return v
}
