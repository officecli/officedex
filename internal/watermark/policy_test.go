package watermark

import (
	"errors"
	"testing"

	"officedex/internal/types"
)

func TestShouldApplyImageWatermarkPolicy(t *testing.T) {
	baseSettings := types.UserSettings{}

	tests := []struct {
		name      string
		settings  types.UserSettings
		credit    types.CreditStatus
		creditErr error
		want      bool
	}{
		{
			name:     "unpaid users always receive watermark",
			settings: baseSettings,
			credit:   types.CreditStatus{PaidEntitlement: false},
			want:     true,
		},
		{
			name:     "paid users skip watermark by default",
			settings: baseSettings,
			credit:   types.CreditStatus{PaidEntitlement: true},
			want:     false,
		},
		{
			name:     "paid users can opt into watermark",
			settings: types.UserSettings{ImageWatermark: types.ImageWatermarkSettings{ShowWatermark: true, PreferenceSource: "user"}},
			credit:   types.CreditStatus{PaidEntitlement: true},
			want:     true,
		},
		{
			name:      "credit lookup failure fails closed",
			settings:  baseSettings,
			creditErr: errors.New("old officecli"),
			want:      true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ShouldApply(tc.settings, tc.credit, tc.creditErr)
			if got != tc.want {
				t.Fatalf("shouldRequestImageWatermark = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSyncImageWatermarkSettingsForCredit(t *testing.T) {
	tests := []struct {
		name     string
		settings types.UserSettings
		credit   types.CreditStatus
		err      error
		want     types.ImageWatermarkSettings
		changed  bool
	}{
		{
			name:     "paid system preference defaults off",
			settings: types.UserSettings{ImageWatermark: types.ImageWatermarkSettings{ShowWatermark: true, PreferenceSource: "system"}},
			credit:   types.CreditStatus{PaidEntitlement: true},
			want:     types.ImageWatermarkSettings{ShowWatermark: false, PreferenceSource: "system"},
			changed:  true,
		},
		{
			name:     "hosted credits do not count as paid for system preference",
			settings: types.UserSettings{ImageWatermark: types.ImageWatermarkSettings{ShowWatermark: true, PreferenceSource: "system"}},
			credit:   types.CreditStatus{Mode: types.WhoAmILoggedIn, HostedCreditBalance: intPtr(1097930)},
			want:     types.ImageWatermarkSettings{ShowWatermark: true, PreferenceSource: "system"},
			changed:  false,
		},
		{
			name:     "paid user preference is preserved on",
			settings: types.UserSettings{ImageWatermark: types.ImageWatermarkSettings{ShowWatermark: true, PreferenceSource: "user"}},
			credit:   types.CreditStatus{PaidEntitlement: true},
			want:     types.ImageWatermarkSettings{ShowWatermark: true, PreferenceSource: "user"},
			changed:  false,
		},
		{
			name:     "paid user preference is preserved off",
			settings: types.UserSettings{ImageWatermark: types.ImageWatermarkSettings{ShowWatermark: false, PreferenceSource: "user"}},
			credit:   types.CreditStatus{PaidEntitlement: true},
			want:     types.ImageWatermarkSettings{ShowWatermark: false, PreferenceSource: "user"},
			changed:  false,
		},
		{
			name:     "unpaid system preference is forced on",
			settings: types.UserSettings{ImageWatermark: types.ImageWatermarkSettings{ShowWatermark: false, PreferenceSource: "system"}},
			credit:   types.CreditStatus{PaidEntitlement: false},
			want:     types.ImageWatermarkSettings{ShowWatermark: true, PreferenceSource: "system"},
			changed:  true,
		},
		{
			name:     "credit lookup failure is forced on",
			settings: types.UserSettings{ImageWatermark: types.ImageWatermarkSettings{ShowWatermark: false, PreferenceSource: "system"}},
			err:      errors.New("status failed"),
			want:     types.ImageWatermarkSettings{ShowWatermark: true, PreferenceSource: "system"},
			changed:  true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, changed := SyncSettingsForCredit(tc.settings, tc.credit, tc.err)
			if changed != tc.changed {
				t.Fatalf("changed = %v, want %v", changed, tc.changed)
			}
			if got.ImageWatermark != tc.want {
				t.Fatalf("ImageWatermark = %+v, want %+v", got.ImageWatermark, tc.want)
			}
		})
	}
}

func intPtr(v int) *int { return &v }

func TestImageWatermarkGenerateOptions(t *testing.T) {
	settings := types.UserSettings{ImageWatermark: types.ImageWatermarkSettings{ShowWatermark: true, PreferenceSource: "user"}}
	got := GenerateOptions(settings, types.CreditStatus{PaidEntitlement: true}, nil)
	if got == nil {
		t.Fatal("options = nil, want image watermark options")
	}
	if !got.Apply || !got.PaidEntitlement || !got.CanDisable {
		t.Fatalf("options = %+v, want apply with paid entitlement", *got)
	}

	unpaid := GenerateOptions(types.UserSettings{}, types.CreditStatus{PaidEntitlement: false}, nil)
	if unpaid == nil || !unpaid.Apply || unpaid.PaidEntitlement || unpaid.CanDisable {
		t.Fatalf("unpaid options = %+v, want apply unpaid cannot disable", unpaid)
	}

	hostedCreditsOnly := GenerateOptions(types.UserSettings{}, types.CreditStatus{Mode: types.WhoAmILoggedIn, HostedCreditBalance: intPtr(1097930)}, nil)
	if hostedCreditsOnly == nil || !hostedCreditsOnly.Apply || hostedCreditsOnly.PaidEntitlement || hostedCreditsOnly.CanDisable {
		t.Fatalf("hosted credits only options = %+v, want apply unpaid cannot disable", hostedCreditsOnly)
	}

	paidOptOut := GenerateOptions(types.UserSettings{}, types.CreditStatus{PaidEntitlement: true}, nil)
	if paidOptOut == nil || paidOptOut.Apply || !paidOptOut.PaidEntitlement || !paidOptOut.CanDisable {
		t.Fatalf("paid opt-out options = %+v, want no apply paid can disable", paidOptOut)
	}
}
