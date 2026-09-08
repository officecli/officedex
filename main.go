package main

import (
	"embed"
	"net/http"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

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
	return &options.App{
		Title:     "OfficeDex",
		Width:     1320,
		Height:    860,
		MinWidth:  1040,
		MinHeight: 720,
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
			TitleBar: mac.TitleBarHidden(),
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
