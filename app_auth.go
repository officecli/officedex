package main

import (
	"officedex/internal/login"
	"officedex/internal/types"
)

// ─── Auth bindings ──────────────────────────────────────────────────────────

// LoginURLResult is the renderer-facing shape returned by Login.
type LoginURLResult struct {
	URL string `json:"url"`
}

type LoginInput struct {
	InviteCode string `json:"inviteCode,omitempty"`
}

// Login starts an OAuth flow if one is not already in progress, returns the
// verification URL the renderer can show / open in the browser.
func (a *App) Login(input LoginInput) (LoginURLResult, error) {
	a.mu.Lock()
	if a.pendingLoginURL != "" {
		url := a.pendingLoginURL
		a.mu.Unlock()
		return LoginURLResult{URL: url}, nil
	}
	manager := a.ensureLoginManagerLocked()
	a.mu.Unlock()

	url, err := manager.Start(a.ctx, input.InviteCode)
	if err != nil {
		return LoginURLResult{}, err
	}
	a.mu.Lock()
	a.pendingLoginURL = url
	a.mu.Unlock()

	if a.ctx != nil {
		emit(a.ctx, authEventChannel, types.AuthEvent{Type: types.AuthEventURL, URL: url})
	}
	return LoginURLResult{URL: url}, nil
}

// CancelLogin SIGTERM-s the active login subprocess (if any).
func (a *App) CancelLogin() error {
	a.mu.Lock()
	manager := a.loginManager
	a.mu.Unlock()
	if manager == nil {
		return nil
	}
	return manager.Cancel()
}

// WhoAmI runs `officecli whoami` and returns the parsed result.
func (a *App) WhoAmI() (types.WhoAmIResult, error) {
	opts := a.runCommandOptions()
	return login.GetWhoAmI(a.ctx, opts)
}

// GetCreditStatus runs `officecli auth status` and returns the parsed quota
// snapshot (hosted credit balance, free trial / reward / paid-key counters,
// access mode, plan name). A non-zero exit from the CLI is reported as an
// anonymous status with zeroed counters rather than an error.
func (a *App) GetCreditStatus() (types.CreditStatus, error) {
	opts := a.runCommandOptions()
	return login.GetCreditStatus(a.ctx, opts)
}

// GetInviteInfo runs `officecli invite --json` and returns the current user's
// invite code.
func (a *App) GetInviteInfo() (types.InviteInfo, error) {
	opts := a.runCommandOptions()
	return login.GetInviteInfo(a.ctx, opts)
}

// Logout runs `officecli logout`.
func (a *App) Logout() error {
	opts := a.runCommandOptions()
	if err := login.Logout(a.ctx, opts); err != nil {
		return err
	}
	a.resetBridgeRuntime()
	return nil
}

// Redeem runs `officecli redeem --json --source desktop <code>` to add hosted
// credits to the signed-in account. Errors surfaced by the platform (expired
// code, exhausted code, already-claimed, etc.) are returned as a normal error
// so the renderer can show the message to the user.
func (a *App) Redeem(code string) (types.RedeemResult, error) {
	opts := a.runCommandOptions()
	result, err := login.Redeem(a.ctx, opts, code)
	if err != nil {
		return types.RedeemResult{}, err
	}
	a.resetBridgeRuntime()
	return result, nil
}
