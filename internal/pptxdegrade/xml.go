package pptxdegrade

import "bytes"

// removeElements deletes every element for which match returns true, together
// with its content, and returns the result and the number of elements removed.
//
// It works on the raw bytes instead of re-serialising through encoding/xml:
// everything that is kept stays byte-identical, so namespace prefixes and
// declarations, which Office markup depends on, cannot be disturbed.
// Malformed input is returned unchanged.
func removeElements(source []byte, match func(ancestors []string, local string) bool) ([]byte, int) {
	var (
		output    bytes.Buffer
		ancestors []string
		removed   int
		keepFrom  int
		skipDepth = -1 // depth of the element being removed, -1 when keeping
	)
	position := 0
	for position < len(source) {
		open := bytes.IndexByte(source[position:], '<')
		if open < 0 {
			break
		}
		start := position + open
		end, kind := scanMarkup(source, start)
		if end < 0 {
			return source, 0
		}
		tag := source[start:end]
		switch kind {
		case markupOpen, markupEmpty:
			local := localName(tag[1:])
			if skipDepth < 0 && match(ancestors, local) {
				output.Write(source[keepFrom:start])
				removed++
				if kind == markupEmpty {
					keepFrom = end
				} else {
					skipDepth = len(ancestors)
				}
			}
			if kind == markupOpen {
				ancestors = append(ancestors, local)
			}
		case markupClose:
			if len(ancestors) == 0 {
				return source, 0
			}
			ancestors = ancestors[:len(ancestors)-1]
			if skipDepth == len(ancestors) {
				skipDepth = -1
				keepFrom = end
			}
		}
		position = end
	}
	if len(ancestors) != 0 || skipDepth >= 0 {
		return source, 0
	}
	if removed == 0 {
		return source, 0
	}
	output.Write(source[keepFrom:])
	return output.Bytes(), removed
}

type markupKind int

const (
	markupOther markupKind = iota // comment, CDATA, processing instruction, doctype
	markupOpen
	markupEmpty
	markupClose
)

// scanMarkup returns the index just past the markup starting at start, and
// what it is. It returns -1 when the markup is not terminated.
func scanMarkup(source []byte, start int) (int, markupKind) {
	rest := source[start:]
	for _, block := range []struct{ open, close string }{
		{"<!--", "-->"},
		{"<![CDATA[", "]]>"},
		{"<?", "?>"},
	} {
		if bytes.HasPrefix(rest, []byte(block.open)) {
			end := bytes.Index(rest[len(block.open):], []byte(block.close))
			if end < 0 {
				return -1, markupOther
			}
			return start + len(block.open) + end + len(block.close), markupOther
		}
	}
	// A '>' inside a quoted attribute value does not end the tag.
	var quote byte
	for i := 1; i < len(rest); i++ {
		c := rest[i]
		switch {
		case quote != 0:
			if c == quote {
				quote = 0
			}
		case c == '"' || c == '\'':
			quote = c
		case c == '>':
			switch {
			case rest[1] == '/':
				return start + i + 1, markupClose
			case rest[1] == '!':
				return start + i + 1, markupOther
			case rest[i-1] == '/':
				return start + i + 1, markupEmpty
			default:
				return start + i + 1, markupOpen
			}
		}
	}
	return -1, markupOther
}

// localName reads an element's local name from the bytes following '<'.
func localName(afterBracket []byte) string {
	end := 0
	for end < len(afterBracket) {
		c := afterBracket[end]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '/' || c == '>' {
			break
		}
		end++
	}
	name := afterBracket[:end]
	if colon := bytes.IndexByte(name, ':'); colon >= 0 {
		name = name[colon+1:]
	}
	return string(name)
}
