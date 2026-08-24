// Single swap point for the UI kit backend. Both the bundler alias
// (`vite.config.ts`) and the TypeScript path mapping (`tsconfig.json`) resolve
// `@vo-ui/backend` here, so changing this line switches the whole app.
export * from "./backends/weboffice";
