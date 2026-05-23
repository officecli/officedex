package login

import (
	"reflect"
	"testing"

	"officedex/internal/types"
)

func TestParseCreditStatus(t *testing.T) {
	tests := []struct {
		name     string
		stdout   string
		exitCode int
		want     types.CreditStatus
	}{
		{
			name:     "anonymous: trial-only output",
			exitCode: 0,
			stdout: `Current access mode: anonymous trial

Quota summary
Free trial quota (this machine, lifetime): 100 total / 25 used / 75 remaining
Reward quota remaining: 0
API key: none configured
Access checks enabled: true
Account session configured: false
API key configured: false
`,
			want: types.CreditStatus{
				Mode:                types.WhoAmIAnonymous,
				AccessMode:          "anonymous trial",
				FreeTrialLimit:      100,
				FreeTrialUsed:       25,
				FreeTrialRemaining:  75,
				RewardRemaining:     0,
				HostedCreditBalance: nil,
			},
		},
		{
			name:     "logged_in: hosted + free trial + reward",
			exitCode: 0,
			stdout: `Current access mode: hosted
Current plan: Pro

Quota summary
Account hosted credits: 42
Free trial quota (this machine, lifetime): 100 total / 100 used / 0 remaining
Reward quota remaining: 5
API key: none configured
Access checks enabled: true
Account session configured: true
API key configured: false
`,
			want: types.CreditStatus{
				Mode:                types.WhoAmILoggedIn,
				AccessMode:          "hosted",
				PlanName:            "Pro",
				FreeTrialLimit:      100,
				FreeTrialUsed:       100,
				FreeTrialRemaining:  0,
				RewardRemaining:     5,
				HostedCreditBalance: intPtr(42),
			},
		},
		{
			name:     "api_key: paid quota line",
			exitCode: 0,
			stdout: `Mode: API key
Current access mode: api-key
Current plan: API

Quota summary
Account hosted credits: 0
Free trial quota (this machine, lifetime): 0 total / 0 used / 0 remaining
Reward quota remaining: 0
Paid quota on current key (sk-abc123): 1000 total / 100 used / 900 remaining
Access checks enabled: true
Account session configured: false
API key configured: true
`,
			want: types.CreditStatus{
				Mode:                types.WhoAmIAPIKey,
				AccessMode:          "api-key",
				PlanName:            "API",
				FreeTrialLimit:      0,
				FreeTrialUsed:       0,
				FreeTrialRemaining:  0,
				RewardRemaining:     0,
				HostedCreditBalance: intPtr(0),
				PaidKeyPrefix:       "sk-abc123",
				PaidKeyTotal:        1000,
				PaidKeyUsed:         100,
				PaidKeyRemaining:    900,
			},
		},
		{
			name:     "non-zero exit short-circuits to anonymous",
			exitCode: 2,
			stdout: `Account hosted credits: 999
Free trial quota (this machine, lifetime): 5 total / 1 used / 4 remaining
`,
			want: types.CreditStatus{Mode: types.WhoAmIAnonymous},
		},
		{
			name:     "missing hosted credits line leaves pointer nil",
			exitCode: 0,
			stdout: `Current access mode: anonymous trial

Quota summary
Free trial quota (this machine, lifetime): 50 total / 10 used / 40 remaining
Reward quota remaining: 0
API key: none configured
Access checks enabled: true
Account session configured: false
API key configured: false
`,
			want: types.CreditStatus{
				Mode:                types.WhoAmIAnonymous,
				AccessMode:          "anonymous trial",
				FreeTrialLimit:      50,
				FreeTrialUsed:       10,
				FreeTrialRemaining:  40,
				HostedCreditBalance: nil,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseCreditStatus(tc.stdout, tc.exitCode)
			// Raw is informational and varies by case; do not assert it field-by-field.
			got.Raw = ""
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("ParseCreditStatus mismatch\n got: %#v\nwant: %#v", got, tc.want)
			}
		})
	}
}

func intPtr(v int) *int { return &v }
