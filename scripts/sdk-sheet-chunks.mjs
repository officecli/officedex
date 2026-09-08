/**
 * Sheet SDK 5.1's classic webpack chunks contain top-level minifier helpers.
 * Give each chunk its own scope so later chunks cannot overwrite those helpers.
 * The explicit self.webpackChunk_shimo_sm_sheet registration remains shared.
 * Keep entry modules and locale resources unchanged.
 */
export function isolateSheetSdkChunk(fileName, source) {
  if (!fileName.endsWith(".chunk.js")) return source;
  return `(function () {\n${source}\n}).call(globalThis);\n`;
}
