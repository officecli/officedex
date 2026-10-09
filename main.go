package main

import (
	"embed"
	"net/http"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"officedex/internal/applog"
	"officedex/internal/word2mowhttp"
	"officedex/internal/writerfonts"
)

//go:embed all:dist
var assets embed.FS

func main() {
	// A preflight check must not create the user data directory or open the
	// local store, so it runs before NewApp and exits there.
	runVerifyRuntimeIfRequested()
	// Both of these run before startup installs the Wails forwarder, so they
	// reach stderr — which is the only place they could go anyway, there being
	// no window to log into yet.
	app, err := NewApp()
	if err != nil {
		applog.Logger().Error("init", applog.Err(err))
		os.Exit(1)
	}
	if err := wails.Run(newWailsAppOptions(app)); err != nil {
		applog.Logger().Error("wails run", applog.Err(err))
		os.Exit(1)
	}
}

func newWailsAppOptions(app *App) *options.App {
	width, height, minWidth, minHeight := 1320, 860, 1040, 720
	if app != nil {
		if state, err := app.GetSetupState(); err == nil && state.Status == "pending" {
			width, height = 1120, 720
			if state.Step == "welcome" {
				width, height, minWidth, minHeight = 600, 700, 600, 700
			}
			app.setupWindow = &setupWindowState{Width: 1320, Height: 860, Fresh: true}
		}
	}
	return &options.App{
		Title:     "OfficeDex",
		Width:     width,
		Height:    height,
		MinWidth:  minWidth,
		MinHeight: minHeight,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: newAssetFallbackHandler(app),
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		BackgroundColour: &options.RGBA{R: 246, G: 245, B: 244, A: 255},
		// The window controls sit inside the sidebar rather than on a title bar
		// strip of their own; the renderer reserves the traffic-light band and
		// marks it draggable (see windowChrome.ts). Hidden rather than
		// HiddenInset: the inset variant needs a toolbar that Wails does not
		// style, so the lights end up at the plain hidden-titlebar position
		// anyway and the extra reserved height reads as a gap. Windows keeps its
		// native frame — this option is macOS-only.
		Mac: &mac.Options{
			TitleBar:   mac.TitleBarHidden(),
			OnFileOpen: app.queueNativeFile,
			OnUrlOpen:  app.handleNativeURL,
		},
		// Windows keeps the native frame (see windowChrome.ts), so nothing here
		// touches the chrome. What is set:
		//
		//   - Theme follows the system. The shell ships the light theme only
		//     (OD-UI-1.2 r10), but the native title bar and the WebView2
		//     scrollbars are the OS's, and forcing them light on a dark desktop
		//     reads as a bug rather than a design.
		//   - WebView2 user data stays at the default %APPDATA%\officedex.exe,
		//     which the NSIS uninstaller already removes.
		//
		// How WebView2 itself gets onto the machine is not an option here but a
		// build tag: `wails build -webview2 embed` (scripts/dist-win.mjs) bakes
		// Microsoft's ~2MB bootstrapper into the exe, so a Windows 10 machine
		// without the runtime is prompted to install it without the app first
		// having to download the bootstrapper. The default "download" fetches
		// the bootstrapper over the network at first start; in the locked-down
		// environments that lack WebView2 in the first place that fetch is the
		// step most likely to be blocked, and 2MB in a 300MB package is cheap.
		// The runtime itself (~150MB) is downloaded by the bootstrapper either
		// way; only "browser" / a fixed-version runtime would avoid that, and
		// shipping a fixed WebView2 is a licensing and update burden this
		// project has not taken on.
		Windows: &windows.Options{
			Theme: windows.SystemDefault,
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind:       []any{app},
	}
}

// newAssetFallbackHandler dispatches the asset server's single fallback slot
// between the local APIs. The slot receives every non-GET request regardless of
// path, so each handler owns a prefix and 404s anything else; returning nil
// here (no app) leaves the asset server serving the embedded bundle alone.
func newAssetFallbackHandler(app *App) http.Handler {
	if app == nil {
		return nil
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case word2mowhttp.Handles(r.URL.Path):
			app.word2mowHTTPHandler.ServeHTTP(w, r)
		case writerfonts.Handles(r.URL.Path):
			app.writerFontsHandler.ServeHTTP(w, r)
		default:
			// The MOP handler owns its own prefix check, including the cluster
			// proxy prefixes it has to strip first, so it stays the default.
			app.mopHTTPHandler.ServeHTTP(w, r)
		}
	})
}
