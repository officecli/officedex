package main

import (
	"context"
	"testing"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type fakeDesktopNotificationRuntime struct {
	available      bool
	checkResults   []bool
	requestResults []bool
	sent           []wailsruntime.NotificationOptions
	checkCalls     int
	requestCalls   int
}

func (f *fakeDesktopNotificationRuntime) IsNotificationAvailable(context.Context) bool {
	return f.available
}

func (f *fakeDesktopNotificationRuntime) CheckNotificationAuthorization(context.Context) (bool, error) {
	result := false
	if f.checkCalls < len(f.checkResults) {
		result = f.checkResults[f.checkCalls]
	}
	f.checkCalls++
	return result, nil
}

func (f *fakeDesktopNotificationRuntime) RequestNotificationAuthorization(context.Context) (bool, error) {
	result := false
	if f.requestCalls < len(f.requestResults) {
		result = f.requestResults[f.requestCalls]
	}
	f.requestCalls++
	return result, nil
}

func (f *fakeDesktopNotificationRuntime) SendNotification(_ context.Context, options wailsruntime.NotificationOptions) error {
	f.sent = append(f.sent, options)
	return nil
}

func TestSendDesktopNotificationReusesGrantedAuthorization(t *testing.T) {
	app := &App{ctx: context.Background()}
	runtime := &fakeDesktopNotificationRuntime{
		available:      true,
		checkResults:   []bool{false, false},
		requestResults: []bool{true},
	}

	for i := 0; i < 2; i++ {
		if err := app.sendDesktopNotificationWithRuntime(runtime, DesktopNotificationInput{
			Title: "OfficeDex",
			Body:  "Test notification",
		}); err != nil {
			t.Fatalf("send %d: %v", i+1, err)
		}
	}

	if runtime.requestCalls != 1 {
		t.Fatalf("request authorization calls = %d, want 1", runtime.requestCalls)
	}
	if len(runtime.sent) != 2 {
		t.Fatalf("sent notifications = %d, want 2", len(runtime.sent))
	}
}
