package bridge

import "os"

// syscallEnviron is an indirection so tests can stub the host environment.
// Kept in its own file so the test binary can override `os.Environ` without
// touching production code by shadowing the variable.
var syscallEnviron = os.Environ
