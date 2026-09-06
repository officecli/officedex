import type { HtmlAppSpec } from "./htmlAppModel";
import type { WorkbookDataSnapshot } from "./types";

export interface HtmlAppFiles { "index.html": string; "package.json": string; "vite.config.ts": string; "src/main.ts": string; "src/style.css": string; "src/data.json": string; }

export function htmlAppFilesAsBytes(files: HtmlAppFiles): Record<string, Uint8Array> {
  return Object.fromEntries(Object.entries(files).map(([name, content]) => [name, new TextEncoder().encode(content)]));
}

export function buildHtmlAppFiles(spec: HtmlAppSpec, snapshot: WorkbookDataSnapshot): HtmlAppFiles {
  const safeTitle = spec.title.replace(/[<&>]/g, "");
  const data = JSON.stringify({ fingerprint: snapshot.fingerprint, sheets: snapshot.sheets });
  const components = spec.components.map((component) => component.type === "kpi"
    ? `<article class="kpi" data-field="${component.fieldId}"><small>${component.fieldId}</small><strong data-value="${component.fieldId}">—</strong></article>`
    : `<table data-component="${component.id}"><thead><tr>${component.columns.map((column) => `<th>${column}</th>`).join("")}</tr></thead><tbody id="table-body"></tbody></table>`).join("\n");
  return {
    "index.html": `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title></head><body><main><h1>${safeTitle}</h1><section id="app">${components}</section></main><script type="module" src="/src/main.ts"></script></body></html>`,
    "package.json": JSON.stringify({ private: true, type: "module", scripts: { dev: "vite", build: "vite build", preview: "vite preview" }, devDependencies: { vite: "^6.4.3", typescript: "^5.7.3" } }, null, 2) + "\n",
    "vite.config.ts": "import { defineConfig } from 'vite';\nexport default defineConfig({});\n",
    "src/main.ts": `import data from './data.json';\nconst sheet = data.sheets[0];\nfor (const node of document.querySelectorAll<HTMLElement>('[data-value]')) { const field = node.dataset.value; const value = sheet?.rows?.[0]?.values?.[field ?? '']; node.textContent = value == null ? '—' : String(value); }\nconst body = document.querySelector('#table-body'); if (body && sheet) body.innerHTML = sheet.rows.map((row) => '<tr>' + sheet.fields.map((field) => '<td>' + String(row.values[field.id] ?? '') + '</td>').join('') + '</tr>').join('');\nconsole.info('OfficeDex HTML App fingerprint', data.fingerprint);`,
    "src/style.css": `:root{font-family:Inter,system-ui,sans-serif;color:#17202a;background:#f7f8fa}main{max-width:1200px;margin:0 auto;padding:32px}.kpi{display:inline-flex;flex-direction:column;gap:8px;padding:16px;margin:0 12px 16px 0;background:white;border:1px solid #e4e8ee;border-radius:12px;min-width:150px}table{width:100%;border-collapse:collapse;background:white}th,td{padding:10px 12px;border-bottom:1px solid #edf0f3;text-align:left}`,
    "src/data.json": data,
  };
}
