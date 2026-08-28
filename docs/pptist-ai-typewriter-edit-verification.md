# PPTist AI Typewriter Edit Verification

Use this case after building the local app with `npm run build:local`.

1. Open a completed PPT deck in the OfficeDex PPTist review layout.
2. Submit an AI follow-up edit that changes text on the current slide.
3. Confirm the target slide is selected in the embedded PPTist editor.
4. Confirm the target text box or shape text shows the `Editing` border.
5. Confirm the old text clears before the replacement text appears.
6. Confirm the replacement text types in with a transient caret.
7. Wait for the edit run to finish and export the deck.
8. Confirm the exported PPTX contains the final text only, with no `Editing` label, caret, or border artifacts.
