// Single swap point for the UI kit backend. Both the bundler alias
// (`vite.config.ts`) and the TypeScript path mapping (`tsconfig.json`) resolve
// `@vo-ui/backend` here, so changing this line switches the whole app.
// Local primitives keep the app independent from the Shimo component runtime.
// Complex legacy AntD surfaces remain isolated at their existing call sites;
// every facade consumer uses this file for the shared interaction language.
export * from "./backends/beautiful";
