package office2modoc

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"

	"github.com/google/uuid"
)

var ErrClosed = errors.New("office2modoc: converter is closed")

type NativeFactory func(path string) (Native, error)

// Converter serializes access to one lazily loaded office2modoc native library.
type Converter struct {
	mu          sync.Mutex
	repoRoot    string
	libraryPath string
	factory     NativeFactory
	native      Native
	closed      bool
}

func NewConverter(repoRoot string, factory NativeFactory) *Converter {
	return &Converter{repoRoot: repoRoot, factory: factory}
}

// New returns a Converter configured to lazily load the local office2modoc FFI.
func New(repoRoot string) *Converter {
	return NewConverter(repoRoot, openNative)
}

func (c *Converter) ImportXlsx(ctx context.Context, inputOfficePath, shimoPath, tempPath string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := checkSize(inputOfficePath, MaxOfficeBytes, ErrOfficeTooLarge); err != nil {
		return err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	native, err := c.loadNative()
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	status, err := native.Import(ImportParams{
		RequestID:       uuid.NewString(),
		InputOfficePath: inputOfficePath,
		ShimoPath:       shimoPath,
		TempPath:        tempPath,
		Lang:            "zh-CN",
	})
	if err != nil {
		return err
	}
	return StatusError("import", status)
}

func (c *Converter) ExportXlsx(ctx context.Context, outputOfficePath, shimoPath, tempPath string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := checkSize(shimoPath, MaxModocBytes, ErrModocTooLarge); err != nil {
		return err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	native, err := c.loadNative()
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	status, err := native.Export(ExportParams{
		RequestID:        uuid.NewString(),
		OutputOfficePath: outputOfficePath,
		ShimoPath:        shimoPath,
		TempPath:         tempPath,
		Lang:             "zh-CN",
	})
	if err != nil {
		return err
	}
	return StatusError("export", status)
}

func (c *Converter) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	if c.native == nil {
		return nil
	}
	return c.native.Close()
}

func (c *Converter) loadNative() (Native, error) {
	if c.closed {
		return nil, ErrClosed
	}
	if c.native != nil {
		return c.native, nil
	}
	if c.factory == nil {
		return nil, errors.New("office2modoc: native factory is not configured")
	}
	if c.libraryPath == "" {
		path, err := ResolveLibraryPath(c.repoRoot)
		if err != nil {
			return nil, err
		}
		c.libraryPath = path
	}
	native, err := c.factory(c.libraryPath)
	if err != nil {
		return nil, err
	}
	if native == nil {
		return nil, errors.New("office2modoc: native factory returned nil")
	}
	c.native = native
	return native, nil
}

func checkSize(path string, max int64, tooLarge error) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("office2modoc: stat %q: %w", path, err)
	}
	if info.Size() > max {
		return tooLarge
	}
	return nil
}

// StatusError maps office2modoc status codes into stable Go errors.
func StatusError(operation string, status uint8) error {
	if status == 0 {
		return nil
	}

	var mapped error
	switch operation {
	case "import":
		switch status {
		case 10:
			mapped = ErrInvalidFormat
		case 11:
			mapped = ErrPasswordProtected
		case 30:
			mapped = ErrSingleSheetCellLimit
		case 31:
			mapped = ErrAllSheetCellLimit
		}
	case "export":
		if status == 10 {
			mapped = ErrInvalidFormat
		}
	}

	if mapped != nil {
		return fmt.Errorf("office2modoc %s failed with status %d: %w", operation, status, mapped)
	}
	return fmt.Errorf("office2modoc %s failed with status %d", operation, status)
}
