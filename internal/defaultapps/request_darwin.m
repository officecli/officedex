//go:build darwin && cgo

#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <CoreServices/CoreServices.h>

// Go calls this on a worker thread. Never block AppKit's main queue while the
// operating system is presenting an asynchronous consent prompt.
int changeDefault(const char *uti) {
    @autoreleasepool {
        if ([NSThread isMainThread]) return -2;
        NSBundle *bundle = [NSBundle mainBundle];
        if (![bundle bundleIdentifier] || ![[[bundle bundleURL] pathExtension] isEqualToString:@"app"]) return -1;
        NSString *identifier = [NSString stringWithUTF8String:uti];
        if (@available(macOS 12.0, *)) {
            dispatch_semaphore_t completed = dispatch_semaphore_create(0);
            __block NSInteger status = 0;
            dispatch_async(dispatch_get_main_queue(), ^{
                UTType *type = [UTType typeWithIdentifier:identifier];
                if (!type) { status = -3; dispatch_semaphore_signal(completed); return; }
                [[NSWorkspace sharedWorkspace] setDefaultApplicationAtURL:[bundle bundleURL]
                    toOpenContentType:type completionHandler:^(NSError *error) {
                        status = error ? [error code] : 0;
                        dispatch_semaphore_signal(completed);
                    }];
            });
            dispatch_semaphore_wait(completed, DISPATCH_TIME_FOREVER);
            #if !__has_feature(objc_arc)
            dispatch_release(completed);
            #endif
            return (int)status;
        }
        // Older supported systems expose the Launch Services equivalent.
        return (int)LSSetDefaultRoleHandlerForContentType((CFStringRef)identifier,
            kLSRolesAll, (CFStringRef)[bundle bundleIdentifier]);
    }
}
