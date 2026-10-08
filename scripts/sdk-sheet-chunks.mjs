/**
 * Sheet SDK 5.1's classic webpack chunks contain top-level minifier helpers.
 * Give each chunk its own scope so later chunks cannot overwrite those helpers.
 * The explicit self.webpackChunk_shimo_sm_sheet registration remains shared.
 * Keep entry modules and locale resources unchanged.
 */
export function isolateSheetSdkChunk(fileName, source) {
  if (!fileName.endsWith(".chunk.js")) return source;
  return `(function () {\n${lazifySheetSdkI18nProperties(source)}\n}).call(globalThis);\n`;
}

/**
 * The ribbon evaluates `s18n("start")` (and section `label:` lookups) once
 * when the toolbar chunk first loads, then copies those strings into the tab
 * config. Switching the app language later updates s18n but not those copies,
 * so the sheet stays Chinese after an English switch.
 *
 * Re-read the current locale at render time, and stop snapshotting the tab
 * list so those getters survive.
 */
export function lazifySheetSdkI18nProperties(source) {
  const withLiveLookups = source.replace(
    /\b(tabName|label):([A-Za-z_$][\w$]*)\("([^"]+)"\)/g,
    "get $1(){return $2(\"$3\")}",
  );
  return withLiveLookups.replace(
    /,Ll=tr\.map\(\w+=>\w+\(\{\},\w+\)\)/g,
    ",Ll=tr",
  );
}
