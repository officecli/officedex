//go:build officedex_demo

package demoflow

import (
	"testing"

	"officedex/internal/types"
)

func TestDemoSessionControlsAnonymousAndLoggedInCreditShapes(t *testing.T) {
	t.Setenv("OFFICEDEX_E2E_HOST", "1")
	t.Setenv("OFFICEDEX_DEMO_ACCEPT_ANY_PROMPT", "1")

	if _, err := UpdateSession("anonymous", 30); err != nil {
		t.Fatalf("set anonymous demo session: %v", err)
	}
	whoami, credit, session, ok := SessionOverride()
	if !ok || session != (DemoSession{Auth: "anonymous", Credits: 30}) {
		t.Fatalf("anonymous session = %#v ok=%v", session, ok)
	}
	if whoami.Mode != types.WhoAmIAnonymous || credit.Mode != types.WhoAmIAnonymous {
		t.Fatalf("anonymous identity mismatch: whoami=%#v credit=%#v", whoami, credit)
	}
	if credit.AnonymousCreditAvailable == nil || *credit.AnonymousCreditAvailable != 30 || credit.HostedCreditBalance != nil {
		t.Fatalf("anonymous credit shape = %#v", credit)
	}

	if _, err := UpdateSession("logged-in", -5); err != nil {
		t.Fatalf("set logged-in demo session: %v", err)
	}
	whoami, credit, session, ok = SessionOverride()
	if !ok || session != (DemoSession{Auth: "logged_in", Credits: -5}) {
		t.Fatalf("logged-in session = %#v ok=%v", session, ok)
	}
	if whoami.Mode != types.WhoAmILoggedIn || whoami.Email != "demo@officedex.local" {
		t.Fatalf("logged-in whoami = %#v", whoami)
	}
	if credit.Mode != types.WhoAmILoggedIn || credit.HostedCreditBalance == nil || *credit.HostedCreditBalance != -5 || !credit.PaidEntitlement {
		t.Fatalf("logged-in credit shape = %#v", credit)
	}
}

func TestDemoSessionValidationAndGuard(t *testing.T) {
	t.Setenv("OFFICEDEX_E2E_HOST", "1")
	t.Setenv("OFFICEDEX_DEMO_ACCEPT_ANY_PROMPT", "1")
	if _, err := UpdateSession("anonymous", -1); err == nil {
		t.Fatal("negative anonymous credits should fail")
	}
	if _, err := UpdateSession("invalid", 1); err == nil {
		t.Fatal("invalid auth should fail")
	}
	t.Setenv("OFFICEDEX_E2E_HOST", "")
	if _, _, _, ok := SessionOverride(); ok {
		t.Fatal("demo session must not override identity outside the E2E host")
	}
}
