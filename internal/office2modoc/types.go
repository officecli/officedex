package office2modoc

import "errors"

const (
	DefaultRelativeLibraryPath       = "build/cache/office2modoc/0.1.34/darwin-arm64/liboffice2modoc_ffi.dylib"
	BundledRelativeLibraryPath       = "../Resources/office2modoc/liboffice2modoc_ffi.dylib"
	ImportLimitJSON                  = `{"slideSize":10000,"wordCharCount":100000000,"excelSingleSheetCell":2000000,"excelAllSheetCell":5000000}`
	MaxOfficeBytes             int64 = 100 << 20
	MaxModocBytes              int64 = 256 << 20
)

var (
	ErrInvalidFormat        = errors.New("office2modoc: invalid format")
	ErrPasswordProtected    = errors.New("office2modoc: password protected")
	ErrSingleSheetCellLimit = errors.New("office2modoc: single-sheet cell limit exceeded")
	ErrAllSheetCellLimit    = errors.New("office2modoc: all-sheet cell limit exceeded")
	ErrOfficeTooLarge       = errors.New("office2modoc: office input exceeds size limit")
	ErrModocTooLarge        = errors.New("office2modoc: MODoc input exceeds size limit")
)

type ImportParams struct {
	RequestID, InputOfficePath, ShimoPath, TempPath, Password, Lang string
}

type ExportParams struct {
	RequestID, OutputOfficePath, ShimoPath, TempPath, Password, Lang string
}

type Native interface {
	Import(ImportParams) (uint8, error)
	Export(ExportParams) (uint8, error)
	Close() error
}
