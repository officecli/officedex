package defaultapps

import "fmt"

type Result struct {
	Extension string `json:"extension"`
	IsDefault bool   `json:"isDefault"`
	Error     string `json:"error,omitempty"`
}

var Extensions = []string{"docx", "xlsx", "pptx"}

func Types(ext string) (string, error) {
	switch ext {
	case "docx":
		return "org.openxmlformats.wordprocessingml.document", nil
	case "xlsx":
		return "org.openxmlformats.spreadsheetml.sheet", nil
	case "pptx":
		return "org.openxmlformats.presentationml.presentation", nil
	default:
		return "", fmt.Errorf("unsupported default document type: %s", ext)
	}
}

// Validate the entire request before changing any association.
func Apply(extensions []string) ([]Result, error) {
	for _, ext := range extensions {
		if _, err := Types(ext); err != nil {
			return nil, err
		}
	}
	results := []Result{}
	seen := map[string]bool{}
	for _, ext := range extensions {
		if seen[ext] {
			continue
		}
		seen[ext] = true
		r := Result{Extension: ext}
		if err := setDefault(ext); err != nil {
			r.Error = err.Error()
		}
		ok, err := isDefault(ext)
		r.IsDefault = ok
		if err != nil {
			r.Error = err.Error()
		}
		if !ok && r.Error == "" {
			r.Error = "The system did not confirm the change."
		}
		results = append(results, r)
	}
	return results, nil
}

func Query() []Result {
	results := []Result{}
	for _, ext := range Extensions {
		ok, err := isDefault(ext)
		r := Result{Extension: ext, IsDefault: ok}
		if err != nil {
			r.Error = err.Error()
		}
		results = append(results, r)
	}
	return results
}
