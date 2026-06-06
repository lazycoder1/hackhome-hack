import type {
  PocLifecycleStatus,
  PocMonitoringReport,
  PocPlan,
  PocRecord,
  PocRequirements,
  SetupResult,
} from "../contracts.js";
import type { PocStore } from "./types.js";

export class InMemoryPocStore implements PocStore {
  private readonly pocs = new Map<string, PocRecord>();
  private readonly requirements = new Map<string, PocRequirements>();
  private readonly plans = new Map<string, PocPlan>();
  private readonly setupResults = new Map<string, SetupResult>();
  private readonly monitoringReports = new Map<string, PocMonitoringReport[]>();

  async createPoc(record: PocRecord): Promise<void> {
    this.pocs.set(record.pocId, record);
  }

  async getPoc(pocId: string): Promise<PocRecord | undefined> {
    return this.pocs.get(pocId);
  }

  async listPocs(input: { limit?: number } = {}): Promise<PocRecord[]> {
    return [...this.pocs.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit ?? 50);
  }

  async updateStatus(pocId: string, status: PocLifecycleStatus, updatedAt: string): Promise<void> {
    const record = this.requirePoc(pocId);
    this.pocs.set(pocId, { ...record, status, updatedAt });
  }

  async updatePoc(pocId: string, patch: Partial<PocRecord>): Promise<void> {
    const record = this.requirePoc(pocId);
    this.pocs.set(pocId, { ...record, ...patch });
  }

  async saveRequirements(requirements: PocRequirements): Promise<void> {
    this.requirements.set(requirements.pocId, requirements);
  }

  async getRequirements(pocId: string): Promise<PocRequirements | undefined> {
    return this.requirements.get(pocId);
  }

  async savePlan(plan: PocPlan): Promise<void> {
    this.plans.set(this.planKey(plan.pocId, plan.version), plan);
    const record = this.requirePoc(plan.pocId);
    this.pocs.set(plan.pocId, {
      ...record,
      activePlanVersion: plan.version,
      updatedAt: record.updatedAt,
    });
  }

  async getPlan(pocId: string, version: number): Promise<PocPlan | undefined> {
    return this.plans.get(this.planKey(pocId, version));
  }

  async saveSetupResult(result: SetupResult): Promise<void> {
    this.setupResults.set(result.pocId, result);
  }

  async getSetupResult(pocId: string): Promise<SetupResult | undefined> {
    return this.setupResults.get(pocId);
  }

  async saveMonitoringReport(report: PocMonitoringReport): Promise<void> {
    this.requirePoc(report.pocId);
    const reports = this.monitoringReports.get(report.pocId) ?? [];
    const next = [...reports.filter((existing) => existing.runId !== report.runId), report].sort(
      sortReportsNewestFirst,
    );
    this.monitoringReports.set(report.pocId, next);
  }

  async listMonitoringReports(
    pocId: string,
    input: { limit?: number } = {},
  ): Promise<PocMonitoringReport[]> {
    return (this.monitoringReports.get(pocId) ?? []).slice(0, input.limit ?? 50);
  }

  async getLatestMonitoringReport(pocId: string): Promise<PocMonitoringReport | undefined> {
    return (await this.listMonitoringReports(pocId, { limit: 1 }))[0];
  }

  private requirePoc(pocId: string): PocRecord {
    const record = this.pocs.get(pocId);
    if (!record) {
      throw new Error(`Unknown PoC: ${pocId}`);
    }
    return record;
  }

  private planKey(pocId: string, version: number): string {
    return `${pocId}:v${version}`;
  }
}

function sortReportsNewestFirst(left: PocMonitoringReport, right: PocMonitoringReport): number {
  return right.checkedAt.localeCompare(left.checkedAt);
}
