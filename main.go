package main

import (
	"embed"
	"net/http"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"officedex/internal/applog"
)

//go:embed all:dist
var assets embed.FS

func main() {
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
	var mopHandler http.Handler
	if app != nil {
		mopHandler = app.mopHTTPHandler
	}
	return &options.App{
		Title:     "OfficeDex",
		Width:     1320,
		Height:    860,
		MinWidth:  1040,
		MinHeight: 720,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: mopHandler,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		BackgroundColour: &options.RGBA{R: 246, G: 245, B: 244, A: 255},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind:             []any{app},
	}
}
