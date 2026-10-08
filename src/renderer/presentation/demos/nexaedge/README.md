# NexaEdge PPT generation demo

The recording's 141 drawing operations and the image referenced by those operations are bundled by Vite into both browser and desktop frontend builds; the original `NexaEdge_AI_Fabric_Product_Launch.pptx` is kept beside them as source material only. The ops were recovered from the original generation's `task.vibe_ops` events, deduplicated and ordered by `seq`. Only `deck.begin.assetsDir` was replaced with the portable `builtin-nexaedge` asset identifier.

From the home screen, the **演示 PPT 生成** / **Watch PPT generation** card leads the PPTX example rail under **从范例开始** / **Start from an example**. The existing live replay sequencer draws an editable draft from blank, including text, shapes and the embedded image. **重新演示** / **Replay drawing** starts it again.

The console entry point is `await window.__officedexReplayDemo("nexaedge")`. No historical task, account generation call, external image request or source workspace is needed. As with other live drawing, a desktop bridge (or the managed real-bridge browser environment) and working presentation runtime are required; the frontend-only mock preview cannot create a local draft.
