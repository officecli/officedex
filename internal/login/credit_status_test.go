package login

import (
	"reflect"
	"testing"

	"officedex/internal/types"
)

// The fixtures here are what `officecli auth status --json` prints, field for
// field. They used to be paragraphs of the CLI's English output, which seven
// regexes read the numbers back out of — an arrangement that failed in
// production when the hosted credits line grew a " credits remaining" suffix
// and the anchored regex quietly stopped matching. The CLI side pins these
// field names with its own tests; between the two, a rename is a failure on one
// side or the other rather than a nil balance in the desktop app.
func TestParseCreditStatus(t *testing.T) {
	tests := []struct {
		name     string
		stdout   string
		exitCode int
		want     types.CreditStatus
	}{
		{
			name:     "anonymous: device credit, no hosted balance",
			exitCode: 0,
			stdout: `{"mode":"anonymous","access_mode":"anonymous trial","paid_entitlement":false,
			  "hosted_credit_balance":null,
			  "anonymous_credit":{"available":100,"reserved":0,"balance":100},
			  "reward_remaining":0,"paid_key":null,
			  "license_enabled":true,"session_configured":false,"api_key_configured":false}`,
			want: types.CreditStatus{
				Mode:                     types.WhoAmIAnonymous,
				AccessMode:               "anonymous trial",
				AnonymousCreditAvailable: intPtr(100),
				AnonymousCreditReserved:  intPtr(0),
				AnonymousCreditBalance:   intPtr(100),
				RewardRemaining:          0,
				HostedCreditBalance:      nil,
			},
		},
		{
			name:     "logged_in: hosted credits, no anonymous account",
			exitCode: 0,
			stdout: `{"mode":"logged_in","access_mode":"hosted","plan_name":"Pro","paid_entitlement":true,
			  "hosted_credit_balance":42,"anonymous_credit":null,"reward_remaining":5,"paid_key":null,
			  "license_enabled":true,"session_configured":true,"api_key_configured":false}`,
			want: types.CreditStatus{
				Mode:                types.WhoAmILoggedIn,
				AccessMode:          "hosted",
				PlanName:            "Pro",
				RewardRemaining:     5,
				HostedCreditBalance: intPtr(42),
				PaidEntitlement:     true,
			},
		},
		{
			name: "logged_in: an exhausted hosted balance is 0, not absent",
			// This is the distinction the pointer exists for. A plan with nothing
			// left says 0; an account with no hosted plan at all says null, and
			// the renderer shows those two differently.
			exitCode: 0,
			stdout: `{"mode":"logged_in","access_mode":"hosted","plan_name":"Pro","paid_entitlement":true,
			  "hosted_credit_balance":0,"anonymous_credit":null,"reward_remaining":0,"paid_key":null,
			  "license_enabled":true,"session_configured":true,"api_key_configured":false}`,
			want: types.CreditStatus{
				Mode:                types.WhoAmILoggedIn,
				AccessMode:          "hosted",
				PlanName:            "Pro",
				HostedCreditBalance: intPtr(0),
				PaidEntitlement:     true,
			},
		},
		{
			name: "logged_in: a negative hosted balance survives the round trip",
			// Postpaid accounts can go negative. The prose renders this as
			// "balance -12; 12 outstanding", which is exactly the rewording that
			// broke the old regex; the JSON just carries the number.
			exitCode: 0,
			stdout: `{"mode":"logged_in","access_mode":"hosted","plan_name":"Pro","paid_entitlement":true,
			  "hosted_credit_balance":-12,"anonymous_credit":null,"reward_remaining":0,"paid_key":null,
			  "license_enabled":true,"session_configured":true,"api_key_configured":false}`,
			want: types.CreditStatus{
				Mode:                types.WhoAmILoggedIn,
				AccessMode:          "hosted",
				PlanName:            "Pro",
				HostedCreditBalance: intPtr(-12),
				PaidEntitlement:     true,
			},
		},
		{
			name:     "logged_in: a large balance does not imply entitlement",
			exitCode: 0,
			stdout: `{"mode":"logged_in","access_mode":"hosted","paid_entitlement":false,
			  "hosted_credit_balance":1097930,"anonymous_credit":null,"reward_remaining":0,"paid_key":null,
			  "license_enabled":true,"session_configured":true,"api_key_configured":false}`,
			want: types.CreditStatus{
				Mode:                types.WhoAmILoggedIn,
				AccessMode:          "hosted",
				HostedCreditBalance: intPtr(1097930),
				PaidEntitlement:     false,
			},
		},
		{
			name:     "api_key: paid key quota does not imply entitlement",
			exitCode: 0,
			stdout: `{"mode":"api_key","access_mode":"api-key","plan_name":"API","paid_entitlement":false,
			  "hosted_credit_balance":0,"anonymous_credit":null,"reward_remaining":0,
			  "paid_key":{"prefix":"sk-abc123","total":1000,"used":100,"remaining":900},
			  "license_enabled":true,"session_configured":false,"api_key_configured":true}`,
			want: types.CreditStatus{
				Mode:                types.WhoAmIAPIKey,
				AccessMode:          "api-key",
				PlanName:            "API",
				PaidEntitlement:     false,
				RewardRemaining:     0,
				HostedCreditBalance: intPtr(0),
				PaidKeyPrefix:       "sk-abc123",
				PaidKeyTotal:        1000,
				PaidKeyUsed:         100,
				PaidKeyRemaining:    900,
			},
		},
		{
			name:     "logged_in: a named plan alone does not imply entitlement",
			exitCode: 0,
			stdout: `{"mode":"logged_in","access_mode":"hosted","plan_name":"Pro","paid_entitlement":false,
			  "hosted_credit_balance":0,"anonymous_credit":null,"reward_remaining":0,"paid_key":null,
			  "license_enabled":true,"session_configured":true,"api_key_configured":false}`,
			want: types.CreditStatus{
				Mode:                types.WhoAmILoggedIn,
				AccessMode:          "hosted",
				PlanName:            "Pro",
				HostedCreditBalance: intPtr(0),
				PaidEntitlement:     false,
			},
		},
		{
			name:     "anonymous: a spent device balance still reports its zeros",
			exitCode: 0,
			stdout: `{"mode":"anonymous","access_mode":"anonymous trial","paid_entitlement":false,
			  "hosted_credit_balance":null,
			  "anonymous_credit":{"available":0,"reserved":0,"balance":0},
			  "reward_remaining":0,"paid_key":null,
			  "license_enabled":true,"session_configured":false,"api_key_configured":false}`,
			want: types.CreditStatus{
				Mode:                     types.WhoAmIAnonymous,
				AccessMode:               "anonymous trial",
				AnonymousCreditAvailable: intPtr(0),
				AnonymousCreditReserved:  intPtr(0),
				AnonymousCreditBalance:   intPtr(0),
			},
		},
		{
			name:     "an unknown mode reads as anonymous",
			exitCode: 0,
			stdout: `{"mode":"enterprise_sso","access_mode":"hosted","paid_entitlement":true,
			  "hosted_credit_balance":7,"anonymous_credit":null,"reward_remaining":0,"paid_key":null,
			  "license_enabled":true,"session_configured":true,"api_key_configured":false}`,
			want: types.CreditStatus{
				Mode:                types.WhoAmIAnonymous,
				AccessMode:          "hosted",
				PaidEntitlement:     true,
				HostedCreditBalance: intPtr(7),
			},
		},
		{
			name:     "non-zero exit short-circuits to anonymous",
			exitCode: 2,
			stdout:   `{"mode":"logged_in","hosted_credit_balance":999}`,
			want:     types.CreditStatus{Mode: types.WhoAmIAnonymous},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseCreditStatus(tc.stdout, tc.exitCode)
			if err != nil {
				t.Fatalf("ParseCreditStatus: %v", err)
			}
			// Raw is informational and varies by case; do not assert it field-by-field.
			got.Raw = ""
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("ParseCreditStatus mismatch\n got: %#v\nwant: %#v", got, tc.want)
			}
		})
	}
}

// The old parser could not fail: unrecognised output produced zeros, which is
// indistinguishable from an account with nothing left. These two cases are the
// reason the signature grew an error.
func TestParseCreditStatusReportsMalformedOutput(t *testing.T) {
	status, err := ParseCreditStatus("Current access mode: hosted\nAccount hosted credits: 42\n", 0)
	if err == nil {
		t.Fatalf("expected an error for prose output, got %#v", status)
	}
	if status.Mode != types.WhoAmIAnonymous {
		t.Fatalf("expected anonymous alongside the error, got %q", status.Mode)
	}
	if status.HostedCreditBalance != nil {
		t.Fatalf("expected no balance from unparsed output, got %d", *status.HostedCreditBalance)
	}
}

func TestParseCreditStatusReportsEmptyOutput(t *testing.T) {
	if _, err := ParseCreditStatus("   \n", 0); err == nil {
		t.Fatal("expected an error when a successful call printed nothing")
	}
}

func intPtr(v int) *int { return &v }
