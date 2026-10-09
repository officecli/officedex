//go:build windows

package atomicfile

// SyncDir is a no-op on Windows, and does not open the directory.
//
// Go has no usable directory fsync here: os.Open yields a read-only directory
// handle, and FlushFileBuffers on it fails with ERROR_ACCESS_DENIED -- which is
// exactly how the first native Windows run died, in NewApp, with "write
// OfficeDex instance identity: sync ...: Access is denied", after the rename
// had already succeeded. NTFS records the rename in its metadata journal, so
// the durability the Unix sync buys is already there; a directory handle that
// cannot be flushed has nothing to add.
func SyncDir(string) error {
	return nil
}
