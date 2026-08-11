import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "../ui";
import { useT } from "../i18n";
import { findSemanticField } from "./workbookData";
import type { WorkbookAppConfig, WorkbookSheetData } from "./types";

export interface WorkbookAppPreviewProps {
  config: WorkbookAppConfig;
  sheet: WorkbookSheetData;
  live?: boolean;
  lastSyncedAt?: string;
}

function text(value: string | number | boolean | undefined): string {
  return value === undefined ? "" : String(value);
}

export function WorkbookAppPreview({ config, sheet, live = false, lastSyncedAt }: WorkbookAppPreviewProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const selectedFields = sheet.fields.filter((field) => config.fieldIds.includes(field.id));
  const titleField = findSemanticField(sheet, "title") ?? selectedFields[0];
  const statusField = findSemanticField(sheet, "status");
  const ownerField = findSemanticField(sheet, "owner");
  const dateField = findSemanticField(sheet, "date");
  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sheet.rows;
    return sheet.rows.filter((row) => selectedFields.some((field) => text(row.values[field.id]).toLowerCase().includes(normalized)));
  }, [query, selectedFields, sheet.rows]);
  const statusValues = statusField
    ? Array.from(new Set(filteredRows.map((row) => text(row.values[statusField.id]) || t("appBuilder.preview.unassigned"))))
    : [];
  const board = Boolean(statusField && (/看板|board|kanban/i.test(config.prompt) || statusValues.length > 1));

  return (
    <section className="workbook-app-preview" aria-label={t("appBuilder.preview.aria", { name: config.name })}>
      <header className="workbook-app-preview__header">
        <div>
          <div className="workbook-app-preview__eyebrow">{t("appBuilder.preview.eyebrow")}</div>
          <h1>{config.name}</h1>
          <p>{t("appBuilder.preview.subtitle", { sheet: sheet.name })}</p>
        </div>
        <div className="workbook-app-preview__header-actions">
          {live ? <span className="workbook-app-preview__live"><i />{t("appBuilder.preview.live")}</span> : null}
          <Input size="small" prefix={<Search aria-hidden="true" />} value={query} placeholder={t("appBuilder.preview.search")} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </header>
      <div className="workbook-app-preview__metrics">
        <article><span>{t("appBuilder.preview.total")}</span><strong>{sheet.rows.length}</strong></article>
        <article><span>{statusField?.label ?? t("appBuilder.preview.fields")}</span><strong>{statusField ? statusValues.length : selectedFields.length}</strong></article>
        <article><span>{t("appBuilder.preview.visible")}</span><strong>{filteredRows.length}</strong></article>
      </div>
      {board ? (
        <div className="workbook-app-preview__board">
          {statusValues.map((status) => {
            const rows = filteredRows.filter((row) => (text(row.values[statusField!.id]) || t("appBuilder.preview.unassigned")) === status);
            return (
              <section className="workbook-app-preview__column" key={status}>
                <header><strong>{status}</strong><span>{rows.length}</span></header>
                <div>
                  {rows.map((row) => (
                    <article className="workbook-app-preview__card" key={row.id}>
                      <strong>{titleField ? text(row.values[titleField.id]) : row.id}</strong>
                      <div>
                        {ownerField ? <span>{text(row.values[ownerField.id])}</span> : null}
                        {dateField ? <span>{text(row.values[dateField.id])}</span> : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="workbook-app-preview__table-wrap">
          <table className="workbook-app-preview__table">
            <thead><tr>{selectedFields.map((field) => <th key={field.id}>{field.label}</th>)}</tr></thead>
            <tbody>{filteredRows.map((row) => <tr key={row.id}>{selectedFields.map((field) => <td key={field.id}>{text(row.values[field.id])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      <footer>{lastSyncedAt ? t("appBuilder.preview.synced", { time: new Date(lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }) : t("appBuilder.preview.waiting")}</footer>
    </section>
  );
}

