# Writer JS API

This package is an adapter over the existing embedded Writer protocol. It does
not modify Writer's editor, document model, rendering, or persistence code.

Only capabilities already exposed by the embed are forwarded. Unsupported
operations return `UNSUPPORTED_OPERATION`; callers must check `capabilities()`.

```ts
const api = createWriterApi(transport);
const capabilities = api.capabilities();
if (capabilities.save) await api.save();
```

The adapter preserves protocol versioning and forwards Writer events. Editing
operations will be added only after Writer exposes a stable host entry point.
