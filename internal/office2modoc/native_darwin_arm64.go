//go:build darwin && arm64 && cgo

package office2modoc

/*
#include <dlfcn.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
	char *request_id;
	char *input_office_file_path;
	char *shimo_file_path;
	char *temp_path;
	char *token;
	char *config_path;
	char *password;
	uint8_t file_type;
	char *limit;
	char *lang;
} ImportParam_t;

typedef struct {
	char *request_id;
	char *output_office_file_path;
	char *shimo_file_path;
	char *temp_path;
	char *token;
	char *config_path;
	char *password;
	uint8_t file_type;
	char *to_type;
	char *sheet_id;
	char *lang;
} ExportParam_t;

typedef uint8_t (*office2modoc_import_fn)(const ImportParam_t *);
typedef uint8_t (*office2modoc_export_fn)(const ExportParam_t *);

typedef struct {
	void *library;
	office2modoc_import_fn import_fn;
	office2modoc_export_fn export_fn;
} office2modoc_native;

static char *office2modoc_copy_error(const char *message) {
	return strdup(message == NULL ? "unknown dynamic loader error" : message);
}

static int office2modoc_open(const char *path, office2modoc_native **result, char **error_message) {
	*result = NULL;
	*error_message = NULL;

	void *library = dlopen(path, RTLD_NOW | RTLD_LOCAL);
	if (library == NULL) {
		*error_message = office2modoc_copy_error(dlerror());
		return -1;
	}

	dlerror();
	office2modoc_import_fn import_fn = (office2modoc_import_fn)dlsym(library, "shimo_import");
	const char *symbol_error = dlerror();
	if (symbol_error != NULL) {
		*error_message = office2modoc_copy_error(symbol_error);
		dlclose(library);
		return -1;
	}

	dlerror();
	office2modoc_export_fn export_fn = (office2modoc_export_fn)dlsym(library, "shimo_export");
	symbol_error = dlerror();
	if (symbol_error != NULL) {
		*error_message = office2modoc_copy_error(symbol_error);
		dlclose(library);
		return -1;
	}

	office2modoc_native *native = calloc(1, sizeof(*native));
	if (native == NULL) {
		*error_message = office2modoc_copy_error("could not allocate native loader state");
		dlclose(library);
		return -1;
	}
	native->library = library;
	native->import_fn = import_fn;
	native->export_fn = export_fn;
	*result = native;
	return 0;
}

static uint8_t office2modoc_import(office2modoc_native *native, const ImportParam_t *params) {
	return native->import_fn(params);
}

static uint8_t office2modoc_export(office2modoc_native *native, const ExportParam_t *params) {
	return native->export_fn(params);
}

static int office2modoc_close(office2modoc_native *native, char **error_message) {
	*error_message = NULL;
	int result = dlclose(native->library);
	if (result != 0) {
		*error_message = office2modoc_copy_error(dlerror());
	}
	free(native);
	return result;
}
*/
import "C"

import (
	"errors"
	"fmt"
	"os"
	"sync"
	"time"
	"unsafe"
)

type native struct {
	mu     sync.Mutex
	handle *C.office2modoc_native
}

func openNative(path string) (Native, error) {
	info, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("office2modoc: library %q does not exist", path)
		}
		return nil, fmt.Errorf("office2modoc: stat library %q: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("office2modoc: library %q is not a regular file", path)
	}

	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))

	var handle *C.office2modoc_native
	var loaderError *C.char
	if C.office2modoc_open(cPath, &handle, &loaderError) != 0 {
		defer C.free(unsafe.Pointer(loaderError))
		return nil, fmt.Errorf("office2modoc: load library %q: %s", path, C.GoString(loaderError))
	}
	return &native{handle: handle}, nil
}

func (n *native) Import(params ImportParams) (uint8, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.handle == nil {
		return 0, ErrClosed
	}

	requestID := C.CString(params.RequestID)
	defer C.free(unsafe.Pointer(requestID))
	inputOfficePath := C.CString(params.InputOfficePath)
	defer C.free(unsafe.Pointer(inputOfficePath))
	shimoPath := C.CString(params.ShimoPath)
	defer C.free(unsafe.Pointer(shimoPath))
	tempPath := C.CString(params.TempPath)
	defer C.free(unsafe.Pointer(tempPath))
	offlineToken, err := generateOfflineToken(params.RequestID, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	token := C.CString(offlineToken)
	defer C.free(unsafe.Pointer(token))
	configPath := C.CString("")
	defer C.free(unsafe.Pointer(configPath))
	password := optionalCString(params.Password)
	defer C.free(unsafe.Pointer(password))
	limit := C.CString(ImportLimitJSON)
	defer C.free(unsafe.Pointer(limit))
	lang := C.CString(params.Lang)
	defer C.free(unsafe.Pointer(lang))

	cParams := C.ImportParam_t{
		request_id:             requestID,
		input_office_file_path: inputOfficePath,
		shimo_file_path:        shimoPath,
		temp_path:              tempPath,
		token:                  token,
		config_path:            configPath,
		password:               password,
		file_type:              C.uint8_t(1),
		limit:                  limit,
		lang:                   lang,
	}
	return uint8(C.office2modoc_import(n.handle, &cParams)), nil
}

func (n *native) Export(params ExportParams) (uint8, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.handle == nil {
		return 0, ErrClosed
	}

	requestID := C.CString(params.RequestID)
	defer C.free(unsafe.Pointer(requestID))
	outputOfficePath := C.CString(params.OutputOfficePath)
	defer C.free(unsafe.Pointer(outputOfficePath))
	shimoPath := C.CString(params.ShimoPath)
	defer C.free(unsafe.Pointer(shimoPath))
	tempPath := C.CString(params.TempPath)
	defer C.free(unsafe.Pointer(tempPath))
	offlineToken, err := generateOfflineToken(params.RequestID, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	token := C.CString(offlineToken)
	defer C.free(unsafe.Pointer(token))
	configPath := C.CString("")
	defer C.free(unsafe.Pointer(configPath))
	password := optionalCString(params.Password)
	defer C.free(unsafe.Pointer(password))
	toType := C.CString("xlsx")
	defer C.free(unsafe.Pointer(toType))
	sheetID := optionalCString("")
	defer C.free(unsafe.Pointer(sheetID))
	lang := C.CString(params.Lang)
	defer C.free(unsafe.Pointer(lang))

	cParams := C.ExportParam_t{
		request_id:              requestID,
		output_office_file_path: outputOfficePath,
		shimo_file_path:         shimoPath,
		temp_path:               tempPath,
		token:                   token,
		config_path:             configPath,
		password:                password,
		file_type:               C.uint8_t(1),
		to_type:                 toType,
		sheet_id:                sheetID,
		lang:                    lang,
	}
	return uint8(C.office2modoc_export(n.handle, &cParams)), nil
}

func optionalCString(value string) *C.char {
	if value == "" {
		return nil
	}
	return C.CString(value)
}

func (n *native) Close() error {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.handle == nil {
		return nil
	}

	handle := n.handle
	n.handle = nil
	var loaderError *C.char
	if C.office2modoc_close(handle, &loaderError) != 0 {
		defer C.free(unsafe.Pointer(loaderError))
		return fmt.Errorf("office2modoc: close library: %s", C.GoString(loaderError))
	}
	return nil
}
