//go:build darwin && cgo

package defaultapps

/*
#cgo LDFLAGS: -framework CoreServices -framework CoreFoundation -framework AppKit -framework UniformTypeIdentifiers
#include <CoreServices/CoreServices.h>
#include <stdlib.h>
int changeDefault(const char *uti);
static int checkDefault(const char *uti) {
    CFStringRef bundle = CFBundleGetIdentifier(CFBundleGetMainBundle());
    if (!bundle) return -1;
    CFStringRef type = CFStringCreateWithCString(NULL, uti, kCFStringEncodingUTF8);
    CFStringRef handler = LSCopyDefaultRoleHandlerForContentType(type, kLSRolesAll);
    CFRelease(type);
    int matches = handler && CFStringCompare(bundle, handler, kCFCompareCaseInsensitive) == kCFCompareEqualTo;
    if (handler) CFRelease(handler);
    return matches;
}
*/
import "C"
import (
	"fmt"
	"unsafe"
)

func setDefault(ext string) error {
	uti, err := Types(ext)
	if err != nil {
		return err
	}
	value := C.CString(uti)
	defer C.free(unsafe.Pointer(value))
	if code := C.changeDefault(value); code != 0 {
		return fmt.Errorf("macOS could not change .%s (status %d)", ext, int(code))
	}
	return nil
}
func isDefault(ext string) (bool, error) {
	uti, err := Types(ext)
	if err != nil {
		return false, err
	}
	value := C.CString(uti)
	defer C.free(unsafe.Pointer(value))
	result := C.checkDefault(value)
	if result < 0 {
		return false, fmt.Errorf("default apps require an installed OfficeDex application bundle")
	}
	return result == 1, nil
}
