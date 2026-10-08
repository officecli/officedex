//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation
#import <Foundation/Foundation.h>

void disableAppNap() {
    [[NSProcessInfo processInfo] beginActivityWithOptions:NSActivityUserInitiatedAllowingIdleSystemSleep
                                                  reason:@"Animation playback must continue in background"];
}
*/
import "C"

func init() {
	C.disableAppNap()
}
