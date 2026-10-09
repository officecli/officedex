#import <AppKit/AppKit.h>

static void layoutControls(NSWindow *window) {
    // AppKit owns the controls while the fullscreen toolbar is visible.
    if (window.styleMask & NSWindowStyleMaskFullScreen) return;
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    NSView *bar = close.superview;
    if (!bar) return;

    // Enlarge the native hit area as well as moving the buttons. Otherwise
    // their lower halves would lie outside the titlebar's clickable bounds.
    NSRect frame = bar.frame;
    if (!bar.superview.isFlipped) frame.origin.y = NSMaxY(frame) - 40;
    frame.size.height = 40;
    bar.frame = frame;

    NSWindowButton types[] = {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton};
    for (int index = 0; index < 3; index++) {
        NSButton *button = [window standardWindowButton:types[index]];
        NSRect bounds = button.frame;
        bounds.origin.x = 12 + index * 20;
        bounds.origin.y = (40 - bounds.size.height) / 2;
        button.frame = bounds;
    }
}

void alignWindowControls(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        static NSWindow *installedWindow;
        NSWindow *window = NSApp.mainWindow;
        if (!window) {
            for (NSWindow *candidate in NSApp.windows) {
                if ([candidate.title isEqualToString:@"OfficeDex"]) {
                    window = candidate;
                    break;
                }
            }
        }
        if (!window || installedWindow == window) return;
        installedWindow = window;
        layoutControls(window);
        for (NSNotificationName name in @[NSWindowDidResizeNotification,
                                          NSWindowDidBecomeKeyNotification,
                                          NSWindowDidExitFullScreenNotification]) {
            [NSNotificationCenter.defaultCenter addObserverForName:name object:window
                queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
                    layoutControls(note.object);
                }];
        }
    });
}
