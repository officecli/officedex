//go:build officedex_demo

package demoflow

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"

	"officedex/internal/types"
)

var demoSessionState = struct {
	sync.RWMutex
	loaded  bool
	session DemoSession
}{}

func sessionOverride() (types.WhoAmIResult, types.CreditStatus, DemoSession, bool) {
	if os.Getenv("OFFICEDEX_E2E_HOST") != "1" || os.Getenv("OFFICEDEX_DEMO_ACCEPT_ANY_PROMPT") != "1" {
		return types.WhoAmIResult{}, types.CreditStatus{}, DemoSession{}, false
	}
	session := currentDemoSession()
	return demoWhoAmI(session), demoCreditStatus(session), session, true
}

func updateSession(auth string, credits int) (DemoSession, error) {
	if os.Getenv("OFFICEDEX_E2E_HOST") != "1" || os.Getenv("OFFICEDEX_DEMO_ACCEPT_ANY_PROMPT") != "1" {
		return DemoSession{}, errors.New("demo session control requires the loopback E2E demo host")
	}
	session, err := validateDemoSession(auth, credits)
	if err != nil {
		return DemoSession{}, err
	}
	demoSessionState.Lock()
	demoSessionState.loaded = true
	demoSessionState.session = session
	demoSessionState.Unlock()
	return session, nil
}

func currentDemoSession() DemoSession {
	demoSessionState.RLock()
	if demoSessionState.loaded {
		session := demoSessionState.session
		demoSessionState.RUnlock()
		return session
	}
	demoSessionState.RUnlock()

	credits, _ := strconv.Atoi(strings.TrimSpace(os.Getenv("OFFICEDEX_DEMO_CREDITS")))
	session, err := validateDemoSession(os.Getenv("OFFICEDEX_DEMO_AUTH"), credits)
	if err != nil {
		session = DemoSession{Auth: "anonymous", Credits: 0}
	}
	demoSessionState.Lock()
	if !demoSessionState.loaded {
		demoSessionState.loaded = true
		demoSessionState.session = session
	}
	session = demoSessionState.session
	demoSessionState.Unlock()
	return session
}

func validateDemoSession(auth string, credits int) (DemoSession, error) {
	auth = strings.ReplaceAll(strings.ToLower(strings.TrimSpace(auth)), "-", "_")
	if auth == "" {
		auth = "anonymous"
	}
	if auth != "anonymous" && auth != "logged_in" {
		return DemoSession{}, fmt.Errorf("demo auth must be anonymous or logged_in, got %q", auth)
	}
	if credits < -1_000_000_000 || credits > 1_000_000_000 {
		return DemoSession{}, errors.New("demo credits must be between -1000000000 and 1000000000")
	}
	if auth == "anonymous" && credits < 0 {
		return DemoSession{}, errors.New("anonymous demo credits cannot be negative")
	}
	return DemoSession{Auth: auth, Credits: credits}, nil
}

func demoWhoAmI(session DemoSession) types.WhoAmIResult {
	if session.Auth == "logged_in" {
		return types.WhoAmIResult{
			Mode:    types.WhoAmILoggedIn,
			UserID:  "devctl-demo-user",
			Email:   "demo@officedex.local",
			Session: "devctl-demo-session",
		}
	}
	return types.WhoAmIResult{Mode: types.WhoAmIAnonymous}
}

func demoCreditStatus(session DemoSession) types.CreditStatus {
	credits := session.Credits
	if session.Auth == "logged_in" {
		return types.CreditStatus{
			Mode:                types.WhoAmILoggedIn,
			AccessMode:          "devctl_demo",
			PlanName:            "Devctl Demo Credits",
			PaidEntitlement:     true,
			HostedCreditBalance: &credits,
			Raw:                 fmt.Sprintf("Mode: logged in\nAccount hosted credits: %d\n", credits),
		}
	}
	reserved := 0
	return types.CreditStatus{
		Mode:                     types.WhoAmIAnonymous,
		AccessMode:               "devctl_demo",
		PlanName:                 "Devctl Anonymous Credits",
		AnonymousCreditAvailable: &credits,
		AnonymousCreditReserved:  &reserved,
		AnonymousCreditBalance:   &credits,
		Raw:                      fmt.Sprintf("Anonymous credit balance (this device): %d available / 0 reserved / %d total\n", credits, credits),
	}
}
