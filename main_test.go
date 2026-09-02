package main

import (
	"net/http"
	"testing"
)

func TestWailsAppOptionsEnableFileDrop(t *testing.T) {
	opts := newWailsAppOptions(nil)
	if opts.DragAndDrop == nil {
		t.Fatal("DragAndDrop options are nil")
	}
	if !opts.DragAndDrop.EnableFileDrop {
		t.Fatal("EnableFileDrop is false")
	}
	if !opts.DragAndDrop.DisableWebViewDrop {
		t.Fatal("DisableWebViewDrop is false")
	}
}

func TestWailsAppOptionsMountLocalMopHandler(t *testing.T) {
	app := &App{mopHTTPHandler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})}
	opts := newWailsAppOptions(app)
	if opts.AssetServer == nil || opts.AssetServer.Handler == nil {
		t.Fatal("local MOP handler is not mounted on the Wails asset server")
	}
}
