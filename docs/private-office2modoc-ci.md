# Private Office2Modoc runtime

Office2Modoc native runtimes are kept in the private `officecli-internal`
repository under `third_party/office2modoc-ffi/0.1.34/<target>/`. The public
OfficeDex repository never stores these binaries.

The release workflow requires these GitHub Actions secrets/variables:

- `OFFICECLI_INTERNAL_TOKEN`: read-only token for `officecli/officecli-internal`;
- `OFFICECLI_INTERNAL_REF`: branch, tag, or commit containing the private FFI asset tree.

CI clones the private repository, selects the target runtime for the runner,
verifies the checksum from `manifest.json`, and stages it under `build/cache`
before packaging. The current release matrix uses `aarch64-apple-darwin` for
macOS and `x86_64-pc-windows-msvc` for Windows. Additional Linux and legacy
Windows targets are available in the private FFI asset tree for future jobs.
