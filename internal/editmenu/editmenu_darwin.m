#import <AppKit/AppKit.h>

// Clears an unmodified key equivalent on every delete: item, at any depth.
static void clearDeleteKeyEquivalents(NSMenu *menu) {
    for (NSMenuItem *item in menu.itemArray) {
        if (item.action == @selector(delete:) && item.keyEquivalentModifierMask == 0) {
            item.keyEquivalent = @"";
        }
        if (item.hasSubmenu) clearDeleteKeyEquivalents(item.submenu);
    }
}

void releaseDeleteKey(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (NSApp.mainMenu) clearDeleteKeyEquivalents(NSApp.mainMenu);
    });
}
