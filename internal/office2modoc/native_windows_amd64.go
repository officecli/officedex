//go:build windows && amd64

package office2modoc

// The FFI exports a C ABI with pointers to UTF-8 strings.  Keep the ABI
// structs local to this file so the Windows loader does not require cgo.
import (
	"errors"
	"fmt"
	"os"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsImportParams struct {
	requestID, inputOfficePath, shimoPath, tempPath, token, configPath, password uintptr
	fileType                                                                     uint8
	_                                                                            [7]byte
	limit, lang                                                                  uintptr
}

type windowsExportParams struct {
	requestID, outputOfficePath, shimoPath, tempPath, token, configPath, password uintptr
	fileType                                                                      uint8
	_                                                                             [7]byte
	toType, sheetID, lang                                                         uintptr
}

type windowsNative struct {
	mu                 sync.Mutex
	dll                *windows.DLL
	importFn, exportFn *windows.Proc
	closed             bool
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
	dll, err := windows.LoadDLL(path)
	if err != nil {
		return nil, fmt.Errorf("office2modoc: load library %q: %w", path, err)
	}
	importFn, err := dll.FindProc("shimo_import")
	if err != nil {
		_ = dll.Release()
		return nil, fmt.Errorf("office2modoc: resolve shimo_import in %q: %w", path, err)
	}
	exportFn, err := dll.FindProc("shimo_export")
	if err != nil {
		_ = dll.Release()
		return nil, fmt.Errorf("office2modoc: resolve shimo_export in %q: %w", path, err)
	}
	return &windowsNative{dll: dll, importFn: importFn, exportFn: exportFn}, nil
}

func winCString(value string) ([]byte, uintptr) {
	b := append([]byte(value), 0)
	return b, uintptr(unsafe.Pointer(&b[0]))
}

func (n *windowsNative) Import(params ImportParams) (uint8, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed {
		return 0, ErrClosed
	}
	requestID, requestIDPtr := winCString(params.RequestID)
	_ = requestID
	input, inputPtr := winCString(params.InputOfficePath)
	_ = input
	shimo, shimoPtr := winCString(params.ShimoPath)
	_ = shimo
	temp, tempPtr := winCString(params.TempPath)
	_ = temp
	tokenValue, err := generateOfflineToken(params.RequestID, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	token, tokenPtr := winCString(tokenValue)
	_ = token
	config, configPtr := winCString("")
	_ = config
	password, passwordPtr := winOptionalCString(params.Password)
	_ = password
	limit, limitPtr := winCString(ImportLimitJSON)
	_ = limit
	lang, langPtr := winCString(params.Lang)
	_ = lang
	cParams := windowsImportParams{requestID: requestIDPtr, inputOfficePath: inputPtr, shimoPath: shimoPtr, tempPath: tempPtr, token: tokenPtr, configPath: configPtr, password: passwordPtr, fileType: 1, limit: limitPtr, lang: langPtr}
	r1, _, _ := n.importFn.Call(uintptr(unsafe.Pointer(&cParams)))
	return uint8(r1), nil
}

func (n *windowsNative) Export(params ExportParams) (uint8, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed {
		return 0, ErrClosed
	}
	requestID, requestIDPtr := winCString(params.RequestID)
	_ = requestID
	output, outputPtr := winCString(params.OutputOfficePath)
	_ = output
	shimo, shimoPtr := winCString(params.ShimoPath)
	_ = shimo
	temp, tempPtr := winCString(params.TempPath)
	_ = temp
	tokenValue, err := generateOfflineToken(params.RequestID, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	token, tokenPtr := winCString(tokenValue)
	_ = token
	config, configPtr := winCString("")
	_ = config
	password, passwordPtr := winOptionalCString(params.Password)
	_ = password
	toType, toTypePtr := winCString("xlsx")
	_ = toType
	lang, langPtr := winCString(params.Lang)
	_ = lang
	cParams := windowsExportParams{requestID: requestIDPtr, outputOfficePath: outputPtr, shimoPath: shimoPtr, tempPath: tempPtr, token: tokenPtr, configPath: configPtr, password: passwordPtr, fileType: 1, toType: toTypePtr, lang: langPtr}
	r1, _, _ := n.exportFn.Call(uintptr(unsafe.Pointer(&cParams)))
	return uint8(r1), nil
}

func winOptionalCString(value string) ([]byte, uintptr) {
	if value == "" {
		return nil, 0
	}
	return winCString(value)
}

func (n *windowsNative) Close() error {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed {
		return nil
	}
	n.closed = true
	if n.dll == nil {
		return nil
	}
	return n.dll.Release()
}
