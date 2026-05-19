import fs from "node:fs";
import path from "node:path";
import type { Artifact, BridgeEvent } from "../shared/types.js";

type DatabaseSync = any;

export class LocalStore {
  private db?: DatabaseSync;

  constructor(private readonly dbPath: string) {}

  async open(): Promise<void> {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const sqlite = await import("node:sqlite");
    this.db = new sqlite.DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        document_type TEXT,
        topic TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_events (
        event_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        file_path TEXT PRIMARY KEY,
        task_id TEXT,
        file_id TEXT,
        file_name TEXT NOT NULL,
        document_type TEXT NOT NULL,
        preview_url TEXT,
        edit_url TEXT,
        synced_at TEXT NOT NULL
      );
    `);
  }

  recordEvent(event: BridgeEvent): void {
    if (!this.db || !event.task_id) {
      return;
    }
    const now = new Date().toISOString();
    const status = statusFromEvent(event.type);
    this.db
      .prepare(
        `INSERT INTO tasks(id, status, document_type, topic, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status=excluded.status,
           document_type=COALESCE(excluded.document_type, tasks.document_type),
           topic=COALESCE(excluded.topic, tasks.topic),
           updated_at=excluded.updated_at`,
      )
      .run(event.task_id, status, stringPayload(event, "document_type") || null, stringPayload(event, "topic") || null, now);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO task_events(event_id, task_id, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(event.event_id || `${event.task_id}:${event.type}:${now}`, event.task_id, event.type, JSON.stringify(event.payload || {}), now);
  }

  recordArtifact(artifact: Artifact): void {
    if (!this.db) {
      return;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO artifacts(file_path, task_id, file_id, file_name, document_type, preview_url, edit_url, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET
           task_id=excluded.task_id,
           file_id=excluded.file_id,
           file_name=excluded.file_name,
           document_type=excluded.document_type,
           preview_url=excluded.preview_url,
           edit_url=excluded.edit_url,
           synced_at=excluded.synced_at`,
      )
      .run(artifact.filePath, artifact.taskId || null, artifact.fileID || null, artifact.fileName, artifact.documentType, artifact.previewUrl || null, artifact.editUrl || null, now);
  }
}

function statusFromEvent(type: string): string {
  switch (type) {
    case "task.completed":
      return "completed";
    case "task.failed":
      return "failed";
    case "task.cancelled":
      return "cancelled";
    case "task.question":
      return "question";
    default:
      return "running";
  }
}

function stringPayload(event: BridgeEvent, key: string): string {
  const value = event.payload?.[key];
  return typeof value === "string" ? value : "";
}
