import type {
  ActivityEvent,
  PocLifecycleStatus,
  PocMonitoringReport,
  PocPlan,
  PocRecord,
  PocRequirements,
  SetupResult,
} from "../contracts.js";

export type PocStore = {
  createPoc(record: PocRecord): Promise<void>;
  getPoc(pocId: string): Promise<PocRecord | undefined>;
  listPocs(input?: { limit?: number }): Promise<PocRecord[]>;
  updateStatus(pocId: string, status: PocLifecycleStatus, updatedAt: string): Promise<void>;
  updatePoc(pocId: string, patch: Partial<PocRecord>): Promise<void>;
  saveRequirements(requirements: PocRequirements): Promise<void>;
  getRequirements(pocId: string): Promise<PocRequirements | undefined>;
  savePlan(plan: PocPlan): Promise<void>;
  getPlan(pocId: string, version: number): Promise<PocPlan | undefined>;
  saveSetupResult(result: SetupResult): Promise<void>;
  getSetupResult(pocId: string): Promise<SetupResult | undefined>;
  saveMonitoringReport(report: PocMonitoringReport): Promise<void>;
  listMonitoringReports(pocId: string, input?: { limit?: number }): Promise<PocMonitoringReport[]>;
  getLatestMonitoringReport(pocId: string): Promise<PocMonitoringReport | undefined>;
  saveActivityEvent(event: ActivityEvent): Promise<void>;
  listActivityEvents(pocId: string, input?: { limit?: number }): Promise<ActivityEvent[]>;
};
