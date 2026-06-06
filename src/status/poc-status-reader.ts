import type {
  ActivityEvent,
  PocLifecycleStatus,
  PocMonitoringReport,
  PocPlan,
  PocRequirements,
  SetupResult,
} from "../contracts.js";
import type { PocStore } from "../state/types.js";

export type PocStatusSummary = {
  pocId: string;
  status: PocLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  activePlanVersion?: number;
  customerCompany?: string;
  customerSlug?: string;
  product?: "posthog";
  objective?: string;
  approvalUrl?: string;
  confirmationThreadId?: string;
  hasRequirements: boolean;
  hasActivePlan: boolean;
  hasSetupResult: boolean;
  setupStatus?: SetupResult["status"];
  validationStatus?: NonNullable<SetupResult["validationReport"]>["status"];
  latestMonitoringStatus?: PocMonitoringReport["status"];
  latestMonitoringRisk?: PocMonitoringReport["riskLevel"];
  latestMonitoringCheckedAt?: string;
};

export type PocStatusDetail = PocStatusSummary & {
  requirements?: PocRequirements;
  activePlan?: PocPlan;
  setupResult?: SetupResult;
  latestMonitoringReport?: PocMonitoringReport;
};

export type PocStatusReadApi = {
  list(input?: { limit?: number }): Promise<{ pocs: PocStatusSummary[] }>;
  detail(pocId: string): Promise<PocStatusDetail | undefined>;
  monitoringReports(
    pocId: string,
    input?: { limit?: number },
  ): Promise<{
    reports: PocMonitoringReport[];
  }>;
  activity(
    pocId: string,
    input?: { limit?: number },
  ): Promise<{
    events: ActivityEvent[];
  }>;
};

export class PocStatusReader implements PocStatusReadApi {
  private readonly store: PocStore;

  constructor(store: PocStore) {
    this.store = store;
  }

  async list(input: { limit?: number } = {}): Promise<{ pocs: PocStatusSummary[] }> {
    const records = await this.store.listPocs({ limit: input.limit });
    const pocs = await Promise.all(records.map((record) => this.summary(record.pocId)));
    return {
      pocs: pocs.filter((poc): poc is PocStatusSummary => Boolean(poc)),
    };
  }

  async detail(pocId: string): Promise<PocStatusDetail | undefined> {
    const record = await this.store.getPoc(pocId);
    if (!record) {
      return undefined;
    }

    const requirements = await this.store.getRequirements(pocId);
    const activePlan = record.activePlanVersion
      ? await this.store.getPlan(pocId, record.activePlanVersion)
      : undefined;
    const setupResult = await this.store.getSetupResult(pocId);
    const latestMonitoringReport = await this.store.getLatestMonitoringReport(pocId);

    return {
      ...baseSummary({
        pocId: record.pocId,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        activePlanVersion: record.activePlanVersion,
        approvalUrl: record.approvalUrl,
        confirmationThreadId: record.confirmationThreadId,
        requirements,
        activePlan,
        setupResult,
        latestMonitoringReport,
      }),
      requirements,
      activePlan,
      setupResult,
      latestMonitoringReport,
    };
  }

  async monitoringReports(
    pocId: string,
    input: { limit?: number } = {},
  ): Promise<{ reports: PocMonitoringReport[] }> {
    return {
      reports: await this.store.listMonitoringReports(pocId, { limit: input.limit }),
    };
  }

  async activity(
    pocId: string,
    input: { limit?: number } = {},
  ): Promise<{ events: ActivityEvent[] }> {
    return {
      events: await this.store.listActivityEvents(pocId, { limit: input.limit }),
    };
  }

  private async summary(pocId: string): Promise<PocStatusSummary | undefined> {
    const detail = await this.detail(pocId);
    if (!detail) {
      return undefined;
    }

    const {
      requirements: _requirements,
      activePlan: _activePlan,
      setupResult: _setupResult,
      ...summary
    } = detail;
    return summary;
  }
}

function baseSummary(input: {
  pocId: string;
  status: PocLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  activePlanVersion?: number;
  approvalUrl?: string;
  confirmationThreadId?: string;
  requirements?: PocRequirements;
  activePlan?: PocPlan;
  setupResult?: SetupResult;
  latestMonitoringReport?: PocMonitoringReport;
}): PocStatusSummary {
  return {
    pocId: input.pocId,
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    activePlanVersion: input.activePlanVersion,
    customerCompany:
      input.activePlan?.customer.companyName ?? input.requirements?.customer.companyName,
    customerSlug:
      input.activePlan?.customer.companySlug ?? input.requirements?.customer.companySlug,
    product: input.activePlan?.product ?? input.requirements?.product,
    objective: input.activePlan?.objective ?? input.requirements?.businessGoal,
    approvalUrl: input.approvalUrl,
    confirmationThreadId: input.confirmationThreadId,
    hasRequirements: Boolean(input.requirements),
    hasActivePlan: Boolean(input.activePlan),
    hasSetupResult: Boolean(input.setupResult),
    setupStatus: input.setupResult?.status,
    validationStatus: input.setupResult?.validationReport?.status,
    latestMonitoringStatus: input.latestMonitoringReport?.status,
    latestMonitoringRisk: input.latestMonitoringReport?.riskLevel,
    latestMonitoringCheckedAt: input.latestMonitoringReport?.checkedAt,
  };
}
