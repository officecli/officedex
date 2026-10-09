//go:build !darwin || !cgo

package defaultapps

import "errors"

func setDefault(string) error {
	return errors.New("default document associations are supported on macOS only")
}
func isDefault(string) (bool, error) { return false, setDefault("") }
