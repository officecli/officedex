package login

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"officedex/internal/types"
)

// Redeem invokes the bundled officecli binary to redeem the given code and
// returns a parsed RedeemResult. The CLI is asked for --json output so we get
// a stable structured payload. On non-zero exit the trailing stderr message
// produced by the CLI ("Redeem failed: ...") is surfaced as the error so the
// renderer can show it verbatim.
func Redeem(ctx context.Context, opts ManagerOptions, code string) (types.RedeemResult, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return types.RedeemResult{}, errors.New("redemption code is required")
	}
	stdout, stderr, exit, err := runOnce(ctx, opts, []string{"redeem", "--json", "--source", "desktop", code})
	if err != nil {
		return types.RedeemResult{}, err
	}
	if exit != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		if msg == "" {
			msg = fmt.Sprintf("officecli exited with code %d", exit)
		}
		return types.RedeemResult{}, errors.New(stripRedeemPrefix(msg))
	}
	var parsed types.RedeemResult
	if jsonErr := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &parsed); jsonErr != nil {
		return types.RedeemResult{}, fmt.Errorf("parse redeem output: %w", jsonErr)
	}
	if parsed.Code == "" {
		return types.RedeemResult{}, errors.New("officecli did not return a redemption result")
	}
	return parsed, nil
}

// stripRedeemPrefix trims the conventional "Redeem failed: " prefix that the
// CLI prints to stderr, so we only show the underlying reason in the UI.
func stripRedeemPrefix(s string) string {
	const prefix = "Redeem failed: "
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		return strings.TrimPrefix(line, prefix)
	}
	return s
}
