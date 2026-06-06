import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ActivityEvent,
  PocMonitoringReport,
  PocPlan,
  PocRecord,
  PocRequirements,
  SetupResult,
} from "../contracts.js";
import type { PocStore } from "./types.js";

type FileStoreData = {
  pocs: Record<string, PocRecord>;
  requirements: Record<string, PocRequirements>;
  plans: Record<string, PocPlan>;
  setupResults: Record<string, SetupResult>;
  monitoringReports: Record<string, PocMonitoringReport[]>;
  activityEvents: Record<string, ActivityEvent[]>;
};

export class FilePocStore implements PocStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.ensureFile();
  }

  async createPoc(record: PocRecord): Promise<void> {
    const data = this.read();
    data.pocs[record.pocId] = record;
    this.write(data);
  }

  async getPoc(pocId: string): Promise<PocRecord | undefined> {
    return this.read().pocs[pocId];
  }

  async listPocs(input: { limit?: number } = {}): Promise<PocRecord[]> {
    return Object.values(this.read().pocs)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit ?? 50);
  }

  async updateStatus(pocId: string, status: PocRecord["status"], updatedAt: string): Promise<void> {
    const data = this.read();
    const record = data.pocs[pocId];
    if (!record) {
      throw new Error(`Unknown PoC: ${pocId}`);
    }
    data.pocs[pocId] = { ...record, status, updatedAt };
    this.write(data);
  }

  async updatePoc(pocId: string, patch: Partial<PocRecord>): Promise<void> {
    const data = this.read();
    const record = data.pocs[pocId];
    if (!record) {
      throw new Error(`Unknown PoC: ${pocId}`);
    }
    data.pocs[pocId] = { ...record, ...patch };
    this.write(data);
  }

  async saveRequirements(requirements: PocRequirements): Promise<void> {
    const data = this.read();
    data.requirements[requirements.pocId] = requirements;
    this.write(data);
  }

  async getRequirements(pocId: string): Promise<PocRequirements | undefined> {
    return this.read().requirements[pocId];
  }

  async savePlan(plan: PocPlan): Promise<void> {
    const data = this.read();
    data.plans[this.planKey(plan.pocId, plan.version)] = plan;
    const record = data.pocs[plan.pocId];
    if (!record) {
      throw new Error(`Unknown PoC: ${plan.pocId}`);
    }
    data.pocs[plan.pocId] = {
      ...record,
      activePlanVersion: plan.version,
    };
    this.write(data);
  }

  async getPlan(pocId: string, version: number): Promise<PocPlan | undefined> {
    return this.read().plans[this.planKey(pocId, version)];
  }

  async saveSetupResult(result: SetupResult): Promise<void> {
    const data = this.read();
    data.setupResults[result.pocId] = result;
    this.write(data);
  }

  async getSetupResult(pocId: string): Promise<SetupResult | undefined> {
    return this.read().setupResults[pocId];
  }

  async saveMonitoringReport(report: PocMonitoringReport): Promise<void> {
    const data = this.read();
    if (!data.pocs[report.pocId]) {
      throw new Error(`Unknown PoC: ${report.pocId}`);
    }
    const reports = data.monitoringReports[report.pocId] ?? [];
    data.monitoringReports[report.pocId] = [
      ...reports.filter((existing) => existing.runId !== report.runId),
      report,
    ].sort(sortReportsNewestFirst);
    this.write(data);
  }

  async listMonitoringReports(
    pocId: string,
    input: { limit?: number } = {},
  ): Promise<PocMonitoringReport[]> {
    return (this.read().monitoringReports[pocId] ?? []).slice(0, input.limit ?? 50);
  }

  async getLatestMonitoringReport(pocId: string): Promise<PocMonitoringReport | undefined> {
    return (await this.listMonitoringReports(pocId, { limit: 1 }))[0];
  }

  async saveActivityEvent(event: ActivityEvent): Promise<void> {
    const data = this.read();
    if (!data.pocs[event.pocId]) {
      throw new Error(`Unknown PoC: ${event.pocId}`);
    }
    const events = data.activityEvents[event.pocId] ?? [];
    data.activityEvents[event.pocId] = [
      ...events.filter((existing) => existing.id !== event.id),
      event,
    ].sort(sortEventsNewestFirst);
    this.write(data);
  }

  async listActivityEvents(
    pocId: string,
    input: { limit?: number } = {},
  ): Promise<ActivityEvent[]> {
    return (this.read().activityEvents[pocId] ?? []).slice(0, input.limit ?? 50);
  }

  private ensureFile(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    if (!existsSync(this.path)) {
      this.write({
        pocs: {},
        requirements: {},
        plans: {},
        setupResults: {},
        monitoringReports: {},
        activityEvents: {},
      });
    }
  }

  private read(): FileStoreData {
    const data = JSON.parse(readFileSync(this.path, "utf8")) as Partial<FileStoreData>;
    return {
      pocs: data.pocs ?? {},
      requirements: data.requirements ?? {},
      plans: data.plans ?? {},
      setupResults: data.setupResults ?? {},
      monitoringReports: data.monitoringReports ?? {},
      activityEvents: data.activityEvents ?? {},
    };
  }

  private write(data: FileStoreData): void {
    writeFileSync(this.path, `${JSON.stringify(data, null, 2)}\n`);
  }

  private planKey(pocId: string, version: number): string {
    return `${pocId}:v${version}`;
  }
}

function sortReportsNewestFirst(left: PocMonitoringReport, right: PocMonitoringReport): number {
  return right.checkedAt.localeCompare(left.checkedAt);
}

function sortEventsNewestFirst(left: ActivityEvent, right: ActivityEvent): number {
  return right.ts.localeCompare(left.ts);
}
