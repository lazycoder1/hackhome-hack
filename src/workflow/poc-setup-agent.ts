import type { PocPlan, SetupResult } from "../contracts.js";

/**
 * Product-specific PoC setup agents implement this contract.
 *
 * The workflow owns lifecycle concerns: approval, retries, email follow-up, and status persistence.
 * A setup agent owns only the product-specific work, such as PostHog dashboard creation today or a
 * different tool's resources tomorrow.
 */
export type PocSetupAgent = {
  setup(plan: PocPlan): Promise<SetupResult>;
};
