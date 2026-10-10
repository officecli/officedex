package main

import (
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"net/http"
	"reflect"
	"runtime"
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

func TestMacNativeSaveAccelerator(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS menu")
	}
	m := nativeMenu(nil)
	for _, top := range m.Items {
		if top.Label != "File" || top.SubMenu == nil {
			continue
		}
		for _, item := range top.SubMenu.Items {
			if item.Label == "Save" && reflect.DeepEqual(item.Accelerator, keys.CmdOrCtrl("s")) && item.Click != nil && !item.Disabled {
				return
			}
		}
	}
	t.Fatal("native Cmd-S must reach a Save callback before WKWebView consumes the key")
}
