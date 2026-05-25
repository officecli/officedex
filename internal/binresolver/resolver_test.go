package binresolver

import "testing"

func ptr(s string) *string { return &s }

func TestResolveUserBinaryWins(t *testing.T) {
	got := Resolve(Options{
		UserBinaryPath:    ptr("/opt/user/officecli"),
		BundledBinaryPath: ptr("/app/bundled/officecli"),
		EnvBinaryPath:     ptr("/env/officecli"),
	})
	if got.Source != SourceUser {
		t.Errorf("Source = %q, want %q", got.Source, SourceUser)
	}
	if got.Path != "/opt/user/officecli" {
		t.Errorf("Path = %q, want %q", got.Path, "/opt/user/officecli")
	}
}

func TestResolveBundledWhenUserMissing(t *testing.T) {
	got := Resolve(Options{
		BundledBinaryPath: ptr("/app/bundled/officecli"),
		EnvBinaryPath:     ptr("/env/officecli"),
	})
	if got.Source != SourceBundled {
		t.Errorf("Source = %q, want %q", got.Source, SourceBundled)
	}
	if got.Path != "/app/bundled/officecli" {
		t.Errorf("Path = %q, want %q", got.Path, "/app/bundled/officecli")
	}
}

func TestResolveEnvWhenUserAndBundledMissing(t *testing.T) {
	got := Resolve(Options{
		EnvBinaryPath: ptr("/env/officecli"),
	})
	if got.Source != SourceEnv {
		t.Errorf("Source = %q, want %q", got.Source, SourceEnv)
	}
	if got.Path != "/env/officecli" {
		t.Errorf("Path = %q, want %q", got.Path, "/env/officecli")
	}
}

func TestResolveManagedSlotPriority(t *testing.T) {
	got := Resolve(Options{
		ManagedBinaryPath: ptr("/managed/officecli"),
		EnvBinaryPath:     ptr("/env/officecli"),
	})
	if got.Source != SourceManaged {
		t.Errorf("Source = %q, want %q", got.Source, SourceManaged)
	}
	if got.Path != "/managed/officecli" {
		t.Errorf("Path = %q, want %q", got.Path, "/managed/officecli")
	}
}

func TestResolveBundledBeatsManaged(t *testing.T) {
	got := Resolve(Options{
		BundledBinaryPath: ptr("/bundled/officecli"),
		ManagedBinaryPath: ptr("/managed/officecli"),
	})
	if got.Source != SourceBundled {
		t.Errorf("Source = %q, want %q", got.Source, SourceBundled)
	}
}

func TestResolveFallbackWhenAllNil(t *testing.T) {
	got := Resolve(Options{})
	if got.Source != SourceFallback {
		t.Errorf("Source = %q, want %q", got.Source, SourceFallback)
	}
	if got.Path != "officecli" {
		t.Errorf("Path = %q, want %q", got.Path, "officecli")
	}
}

func TestResolveTrimsWhitespaceAndFallsThrough(t *testing.T) {
	cases := []struct {
		name   string
		opts   Options
		want   string
		source BinarySource
	}{
		{
			name: "user empty falls to bundled",
			opts: Options{
				UserBinaryPath:    ptr(""),
				BundledBinaryPath: ptr("/b/officecli"),
			},
			want:   "/b/officecli",
			source: SourceBundled,
		},
		{
			name: "user whitespace falls to env",
			opts: Options{
				UserBinaryPath: ptr("   \t  "),
				EnvBinaryPath:  ptr("/e/officecli"),
			},
			want:   "/e/officecli",
			source: SourceEnv,
		},
		{
			name: "all whitespace falls to fallback",
			opts: Options{
				UserBinaryPath:    ptr("   "),
				BundledBinaryPath: ptr("\n"),
				EnvBinaryPath:     ptr("\t"),
			},
			want:   "officecli",
			source: SourceFallback,
		},
		{
			name: "user with surrounding whitespace is trimmed",
			opts: Options{
				UserBinaryPath: ptr("  /u/officecli  "),
			},
			want:   "/u/officecli",
			source: SourceUser,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Resolve(tc.opts)
			if got.Source != tc.source {
				t.Errorf("Source = %q, want %q", got.Source, tc.source)
			}
			if got.Path != tc.want {
				t.Errorf("Path = %q, want %q", got.Path, tc.want)
			}
		})
	}
}

func TestResolvePathReturnsOnlyPath(t *testing.T) {
	got := ResolvePath(Options{UserBinaryPath: ptr("/u/officecli")})
	if got != "/u/officecli" {
		t.Errorf("ResolvePath = %q, want %q", got, "/u/officecli")
	}
	if fallback := ResolvePath(Options{}); fallback != "officecli" {
		t.Errorf("ResolvePath fallback = %q, want %q", fallback, "officecli")
	}
}
