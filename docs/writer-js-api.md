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

The adapter preserves protocol versioning and forwards Writer events.

The AI panel uses a `WriterAgentEditor` handle from `WriterEditorFrame`, tied to
the mounted document. `writer:capture-edit` captures the body or a fixed selected
range and returns `{ id, text, scope }`. `writer:apply-edit` accepts that id and
an array of `{ query, replacement }` edits. The embed rejects expired captures,
changed text, ambiguous or overlapping targets, and read-only writes before
applying one JS API batch. `Range.getSubrange` is a Writer extension with Unicode
code point offsets; it does not change the Find service contract.

The panel invokes OfficeCLI workflow `office.docx.edit.v1` using the configured
LLM provider. Document text is data, not instructions. Structured replacements
are applied to the live editor and saved through the existing fingerprint-checked
DOCX save path. Cancellation before application discards late plans. If saving
fails after application, the panel asks the user to retry Save in the editor.

Rebuild OfficeCLI and the Writer embed alongside OfficeDex to use this feature.
The first version edits body/selected text; formatting-only requests produce an
explanation rather than executing arbitrary model-generated JavaScript.
