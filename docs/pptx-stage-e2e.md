# PPTX production stage browser E2E

The provider-free browser checks live in `e2e/pptx-stage-real.spec.ts` and are
opt-in so they cannot spend hosted Credits accidentally.

Run them through the managed real bridge:

```bash
OFFICEDEX_E2E_PPTX_STAGE=1 npm run test:e2e -- e2e/pptx-stage-real.spec.ts
```

The first test intercepts `Generate` and verifies the immediate `Starting`
feedback without invoking a provider. The second seeds a persisted PPTX
failure event and verifies the visible failed-stage surface and retry action.
The completed-stage visual and editor action are covered by the component
contract test; a browser completion test should only be enabled when a
deterministic, non-billed PPTX artifact fixture is available.

