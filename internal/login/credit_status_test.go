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
			name:     "anonymous: credits-only output",
			exitCode: 0,
			stdout: `Current access mode: anonymous trial

Quota summary
Anonymous credit balance (this device): 100 available / 0 reserved / 100 total
Reward quota remaining: 0
API key: none configured
Access checks enabled: true
Account session configured: false
API key configured: false
`,
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
			name:     "logged_in: hosted credits, no anonymous line",
			exitCode: 0,
			stdout: `Current access mode: hosted
Current plan: Pro

Quota summary
Account hosted credits: 42
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
Anonymous credit balance (this device): 5 available / 1 reserved / 6 total
`,
			want: types.CreditStatus{Mode: types.WhoAmIAnonymous},
		},
		{
			name:     "anonymous: zero credits line still sets pointers",
			exitCode: 0,
			stdout: `Current access mode: anonymous trial

Quota summary
Anonymous credit balance (this device): 0 available / 0 reserved / 0 total
Reward quota remaining: 0
API key: none configured
Access checks enabled: true
Account session configured: false
API key configured: false
`,
			want: types.CreditStatus{
				Mode:                     types.WhoAmIAnonymous,
				AccessMode:               "anonymous trial",
				AnonymousCreditAvailable: intPtr(0),
				AnonymousCreditReserved:  intPtr(0),
				AnonymousCreditBalance:   intPtr(0),
			},
		},
		{
			name:     "logged_in: anonymous line absent leaves pointers nil",
			exitCode: 0,
			stdout: `Current access mode: hosted
Current plan: Pro

Quota summary
Account hosted credits: 7
Reward quota remaining: 0
API key: none configured
Access checks enabled: true
Account session configured: true
API key configured: false
`,
			want: types.CreditStatus{
				Mode:                     types.WhoAmILoggedIn,
				AccessMode:               "hosted",
				PlanName:                 "Pro",
				HostedCreditBalance:      intPtr(7),
				AnonymousCreditAvailable: nil,
				AnonymousCreditReserved:  nil,
				AnonymousCreditBalance:   nil,
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
