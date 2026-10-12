package types

import "strings"

// IsInternalProposal recognizes the reserved directory used by office.modify.
// These files remain available for Review/Apply but are not library documents.
func IsInternalProposal(path string) bool {
	parts := strings.Split(strings.ReplaceAll(path, `\`, "/"), "/")
	for _, part := range parts[:len(parts)-1] {
		if strings.HasPrefix(part, ".officedex-proposal-") && len(part) > len(".officedex-proposal-") {
			return true
		}
	}
	return false
}
