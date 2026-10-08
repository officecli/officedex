package main

import (
	"errors"
	"strings"
	"testing"
)

const codesignSignedOutput = `Executable=/Applications/OfficeDex.app/Contents/MacOS/OfficeDex
Identifier=com.wails.OfficeDex
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=30+7 location=embedded
Authority=Developer ID Application: ChuXin Tec Co., Ltd. (Z35T9799TW)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=Z35T9799TW
Runtime Version=14.0.0
`

const codesignAdhocOutput = `Executable=/tmp/OfficeDex.app/Contents/MacOS/OfficeDex
Identifier=com.wails.OfficeDex
Format=app bundle with Mach-O thin (arm64)
Signature=adhoc
TeamIdentifier=not set
`

func TestParseCodesignTeamID(t *testing.T) {
	if got := parseCodesignTeamID(codesignSignedOutput); got != "Z35T9799TW" {
		t.Fatalf("signed: got %q", got)
	}
	if got := parseCodesignTeamID(codesignAdhocOutput); got != "" {
		t.Fatalf("adhoc: got %q, want empty", got)
	}
	if got := parseCodesignTeamID("Identifier=x\n"); got != "" {
		t.Fatalf("missing field: got %q, want empty", got)
	}
}

// fakeCodesign scripts codesign's answers per bundle path: verifyErr makes
// `--verify` fail for that path; team is what `-dv` reports.
type fakeCodesign struct {
	verifyErr map[string]error
	team      map[string]string
	calls     []string
}

func (f *fakeCodesign) run(args ...string) (string, error) {
	f.calls = append(f.calls, strings.Join(args, " "))
	app := args[len(args)-1]
	if args[0] == "--verify" {
		if err := f.verifyErr[app]; err != nil {
			return app + ": invalid signature (code or signature have been modified)", err
		}
		return "", nil
	}
	if args[0] == "-dv" {
		team, ok := f.team[app]
		if !ok {
			return app + ": code object is not signed at all", errors.New("exit status 1")
		}
		if team == "" {
			return codesignAdhocOutput, nil
		}
		return strings.ReplaceAll(codesignSignedOutput, "Z35T9799TW", team), nil
	}
	return "", errors.New("unexpected codesign invocation: " + strings.Join(args, " "))
}

func TestVerifyUpdateBundle_AcceptsSameTeam(t *testing.T) {
	fake := &fakeCodesign{team: map[string]string{"/new.app": "Z35T9799TW", "/cur.app": "Z35T9799TW"}}
	if err := verifyUpdateBundle("/new.app", "/cur.app", fake.run); err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if len(fake.calls) == 0 || !strings.HasPrefix(fake.calls[0], "--verify --deep --strict") {
		t.Fatalf("first codesign call must be a strict verify, got %v", fake.calls)
	}
}

func TestVerifyUpdateBundle_RejectsTeamIDMismatch(t *testing.T) {
	fake := &fakeCodesign{team: map[string]string{"/new.app": "ATTACKER01", "/cur.app": "Z35T9799TW"}}
	err := verifyUpdateBundle("/new.app", "/cur.app", fake.run)
	if err == nil || !strings.Contains(err.Error(), "Team ID mismatch") {
		t.Fatalf("expected Team ID mismatch, got %v", err)
	}
	if !strings.Contains(err.Error(), "ATTACKER01") || !strings.Contains(err.Error(), "Z35T9799TW") {
		t.Fatalf("error should name both teams: %v", err)
	}
}

func TestVerifyUpdateBundle_RejectsAdhocDownload(t *testing.T) {
	fake := &fakeCodesign{team: map[string]string{"/new.app": "", "/cur.app": "Z35T9799TW"}}
	err := verifyUpdateBundle("/new.app", "/cur.app", fake.run)
	if err == nil || !strings.Contains(err.Error(), "Team ID mismatch") {
		t.Fatalf("expected mismatch for ad-hoc download, got %v", err)
	}
}

func TestVerifyUpdateBundle_RejectsWhenRunningAppUnsigned(t *testing.T) {
	fake := &fakeCodesign{team: map[string]string{"/new.app": "Z35T9799TW", "/cur.app": ""}}
	err := verifyUpdateBundle("/new.app", "/cur.app", fake.run)
	if err == nil || !strings.Contains(err.Error(), "running app has no Team ID") {
		t.Fatalf("expected unsigned-running-app error, got %v", err)
	}
}

func TestVerifyUpdateBundle_RejectsBrokenSignature(t *testing.T) {
	fake := &fakeCodesign{
		verifyErr: map[string]error{"/new.app": errors.New("exit status 1")},
		team:      map[string]string{"/new.app": "Z35T9799TW", "/cur.app": "Z35T9799TW"},
	}
	err := verifyUpdateBundle("/new.app", "/cur.app", fake.run)
	if err == nil || !strings.Contains(err.Error(), "codesign verify failed") {
		t.Fatalf("expected verify failure, got %v", err)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("must stop after the failed verify, got calls %v", fake.calls)
	}
}
