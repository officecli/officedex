package main

import (
	"embed"
	"log"
	"net/http"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:dist
var assets embed.FS

func main() {
	app, err := NewApp()
	if err != nil {
		log.Fatalf("init: %v", err)
	}
	if err := wails.Run(newWailsAppOptions(app)); err != nil {
		log.Fatalf("wails run: %v", err)
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
