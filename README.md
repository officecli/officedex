# OfficeDex

OfficeDex is the desktop GUI for OfficeCLI. It is an Electron + React client that talks to the local `officecli agent-bridge` JSON-RPC process and keeps document generation, hosted runtime access, publishing, and review logic in the OfficeCLI binary.

## Development

```bash
npm install
npm run dev
```

During development OfficeDex resolves the CLI from `OFFICECLI_DESKTOP_BINARY` first, then `officecli` on `PATH`.

## Packaging

Put the OfficeCLI binary in `officecli-bin/` before packaging:

```bash
mkdir -p officecli-bin
cp /path/to/officecli officecli-bin/officecli
npm run dist:mac
```

Generated documents are written to the app data workspace by default, for example `~/Library/Application Support/OfficeDex/workspace` on macOS.
