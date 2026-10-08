package login

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"officedex/internal/types"
)

// GetInviteInfo invokes `officecli invite --json` and returns the signed-in
// account's invite code in a stable renderer-facing shape.
func GetInviteInfo(ctx context.Context, opts ManagerOptions) (types.InviteInfo, error) {
	stdout, stderr, exit, err := runOnce(ctx, opts, []string{"invite", "--json"})
	if err != nil {
		return types.InviteInfo{}, err
	}
	if exit != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		if msg == "" {
			msg = fmt.Sprintf("officecli exited with code %d", exit)
		}
		return types.InviteInfo{}, errors.New(msg)
	}
	var parsed types.InviteInfo
	if jsonErr := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &parsed); jsonErr != nil {
		return types.InviteInfo{}, fmt.Errorf("parse invite output: %w", jsonErr)
	}
	if strings.TrimSpace(parsed.InviteCode) == "" {
		return types.InviteInfo{}, errors.New("officecli did not return an invite code")
	}
	parsed.InviteCode = strings.TrimSpace(parsed.InviteCode)
	return parsed, nil
}
