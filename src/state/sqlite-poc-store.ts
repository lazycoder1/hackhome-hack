import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ActivityEvent,
  PocLifecycleStatus,
  PocMonitoringReport,
  PocPlan,
  PocRecord,
  PocRequirements,
  SetupResult,
} from "../contracts.js";
import type { PocStore } from "./types.js";

type JsonRow = {
  body: string;
};

export class SqlitePocStore implements PocStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.configure();
    this.migrate();
  }

  async createPoc(record: PocRecord): Promise<void> {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO pocs (poc_id, updated_at, body)
        VALUES (?, ?, ?)
        `,
      )
      .run(record.pocId, record.updatedAt, stringify(record));
  }

  async getPoc(pocId: string): Promise<PocRecord | undefined> {
    return rowBody<PocRecord>(this.db.prepare("SELECT body FROM pocs WHERE poc_id = ?").get(pocId));
  }

  async listPocs(input: { limit?: number } = {}): Promise<PocRecord[]> {
    return this.db
      .prepare("SELECT body FROM pocs ORDER BY updated_at DESC LIMIT ?")
      .all(input.limit ?? 50)
      .map((row) => parseRow<PocRecord>(row));
  }

  async updateStatus(pocId: string, status: PocLifecycleStatus, updatedAt: string): Promise<void> {
    const record = await this.getPoc(pocId);
    if (!record) {
      throw new Error(`Unknown PoC: ${pocId}`);
    }
    await this.createPoc({ ...record, status, updatedAt });
  }

  async updatePoc(pocId: string, patch: Partial<PocRecord>): Promise<void> {
    const record = await this.getPoc(pocId);
    if (!record) {
      throw new Error(`Unknown PoC: ${pocId}`);
    }
    await this.createPoc({ ...record, ...patch });
  }

  async saveRequirements(requirements: PocRequirements): Promise<void> {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO requirements (poc_id, body)
        VALUES (?, ?)
        `,
      )
      .run(requirements.pocId, stringify(requirements));
  }

  async getRequirements(pocId: string): Promise<PocRequirements | undefined> {
    return rowBody<PocRequirements>(
      this.db.prepare("SELECT body FROM requirements WHERE poc_id = ?").get(pocId),
    );
  }

  async savePlan(plan: PocPlan): Promise<void> {
    const record = await this.getPoc(plan.pocId);
    if (!record) {
      throw new Error(`Unknown PoC: ${plan.pocId}`);
    }

    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO plans (poc_id, version, body)
        VALUES (?, ?, ?)
        `,
      )
      .run(plan.pocId, plan.version, stringify(plan));
    await this.createPoc({ ...record, activePlanVersion: plan.version });
  }

  async getPlan(pocId: string, version: number): Promise<PocPlan | undefined> {
    return rowBody<PocPlan>(
      this.db
        .prepare("SELECT body FROM plans WHERE poc_id = ? AND version = ?")
        .get(pocId, version),
    );
  }

  async saveSetupResult(result: SetupResult): Promise<void> {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO setup_results (poc_id, body)
        VALUES (?, ?)
        `,
      )
      .run(result.pocId, stringify(result));
  }

  async getSetupResult(pocId: string): Promise<SetupResult | undefined> {
    return rowBody<SetupResult>(
      this.db.prepare("SELECT body FROM setup_results WHERE poc_id = ?").get(pocId),
    );
  }

  async saveMonitoringReport(report: PocMonitoringReport): Promise<void> {
    const record = await this.getPoc(report.pocId);
    if (!record) {
      throw new Error(`Unknown PoC: ${report.pocId}`);
    }

    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO monitoring_reports (poc_id, run_id, checked_at, body)
        VALUES (?, ?, ?, ?)
        `,
      )
      .run(report.pocId, report.runId, report.checkedAt, stringify(report));
  }

  async listMonitoringReports(
    pocId: string,
    input: { limit?: number } = {},
  ): Promise<PocMonitoringReport[]> {
    return this.db
      .prepare(
        `
        SELECT body FROM monitoring_reports
        WHERE poc_id = ?
        ORDER BY checked_at DESC
        LIMIT ?
        `,
      )
      .all(pocId, input.limit ?? 50)
      .map((row) => parseRow<PocMonitoringReport>(row));
  }

  async getLatestMonitoringReport(pocId: string): Promise<PocMonitoringReport | undefined> {
    return (await this.listMonitoringReports(pocId, { limit: 1 }))[0];
  }

  async saveActivityEvent(event: ActivityEvent): Promise<void> {
    const record = await this.getPoc(event.pocId);
    if (!record) {
      throw new Error(`Unknown PoC: ${event.pocId}`);
    }

    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO activity_events (id, poc_id, ts, body)
        VALUES (?, ?, ?, ?)
        `,
      )
      .run(event.id, event.pocId, event.ts, stringify(event));
  }

  async listActivityEvents(
    pocId: string,
    input: { limit?: number } = {},
  ): Promise<ActivityEvent[]> {
    return this.db
      .prepare(
        `
        SELECT body FROM activity_events
        WHERE poc_id = ?
        ORDER BY ts DESC, id DESC
        LIMIT ?
        `,
      )
      .all(pocId, input.limit ?? 50)
      .map((row) => parseRow<ActivityEvent>(row));
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pocs (
        poc_id TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL,
        body TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS requirements (
        poc_id TEXT PRIMARY KEY,
        body TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plans (
        poc_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (poc_id, version)
      );

      CREATE TABLE IF NOT EXISTS setup_results (
        poc_id TEXT PRIMARY KEY,
        body TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS monitoring_reports (
        poc_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (poc_id, run_id)
      );

      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        poc_id TEXT NOT NULL,
        ts TEXT NOT NULL,
        body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_poc_ts ON activity_events (poc_id, ts DESC);
    `);
  }

  private configure(): void {
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
    `);
  }
}

function rowBody<T>(row: unknown): T | undefined {
  if (!isJsonRow(row)) {
    return undefined;
  }
  return JSON.parse(row.body) as T;
}

function parseRow<T>(row: unknown): T {
  if (!isJsonRow(row)) {
    throw new Error("SQLite row did not contain a JSON body");
  }
  return JSON.parse(row.body) as T;
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function isJsonRow(value: unknown): value is JsonRow {
  return typeof value === "object" && value !== null && typeof (value as JsonRow).body === "string";
}
