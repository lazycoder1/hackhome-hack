// Seeds .data/pocs.json with a realistic spread of PoCs across every lifecycle
// phase so the operator console and customer pages are fully populated when the
// backend boots — no API keys required. Run: `node scripts/seed-demo.mjs`.
//
// Shape matches FilePocStore's FileStoreData: { pocs, requirements, plans, setupResults }.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const OUT = process.env.POC_STORE_PATH ?? ".data/pocs.json";
const HOST = "https://us.posthog.com";
const now = Date.now();
const ago = (mins) => new Date(now - mins * 60000).toISOString();
const ahead = (days) => new Date(now + days * 86400000).toISOString().slice(0, 10);

const data = { pocs: {}, requirements: {}, plans: {}, setupResults: {} };

function projectUrl(pid) {
  return `${HOST}/project/${pid}`;
}

function ev(name, description, props = [], required = true) {
  return {
    name,
    description,
    source: "customer",
    required,
    properties: props.map((p) => ({ name: p, type: "string", required: false })),
  };
}

function dashboard(name, tiles) {
  return { name, description: `${name} for the PoC`, tiles };
}

function resource(type, id, name, url) {
  return { type, id, name, url, tags: ["source:poc-automation"] };
}

// Build a complete PoC across stores.
function addPoc({
  id,
  pid,
  company,
  slug,
  status,
  objective,
  successCriteria,
  events,
  dashboards = [],
  flags = [],
  surveys = [],
  alerts = [],
  assumptions = [],
  openQuestions = [],
  contact,
  region = "US",
  createdMinsAgo,
  updatedMinsAgo,
  planVersion,
  setup,
  approval,
  security,
  reviewInDays = 14,
  teardownInDays = 30,
}) {
  const customer = {
    companyName: company,
    companySlug: slug,
    contacts: [{ name: contact.name, email: contact.email, role: contact.role, isPrimary: true }],
    timezone: "UTC",
  };

  data.pocs[id] = {
    pocId: id,
    status,
    createdAt: ago(createdMinsAgo),
    updatedAt: ago(updatedMinsAgo),
    activePlanVersion: planVersion,
    approvalTokenId: approval?.tokenId,
    approvalUrl: approval?.url,
    confirmationEmailId: approval ? `email_${slug}` : undefined,
    confirmationThreadId: approval ? `thread_${slug}` : undefined,
    sourceText: `Discovery call with ${company}. ${objective}`,
  };

  data.requirements[id] = {
    pocId: id,
    product: "posthog",
    customer,
    businessGoal: objective,
    successCriteria,
    appContext: {
      appName: `${company} App`,
      appUrl: `https://app.${slug}.test`,
      platform: ["web"],
      techStack: ["React", "Node"],
      environments: ["prod"],
    },
    posthogContext: { projectName: `${company} PoC`, region, useExistingProject: false },
    analyticsScope: { events, dashboards, featureFlags: flags, surveys, alerts },
    securityConstraints: security,
    timeline: { reviewDate: ahead(reviewInDays), endDate: ahead(teardownInDays), timezone: "UTC" },
    assumptions,
    openQuestions,
    source: { sourceKind: "api", sourceId: `req-${slug}`, receivedAt: ago(createdMinsAgo) },
  };

  if (planVersion) {
    data.plans[`${id}:v${planVersion}`] = {
      pocId: id,
      version: planVersion,
      status: approval?.planStatus ?? "approved",
      customer,
      product: "posthog",
      objective,
      successCriteria,
      assumptions,
      openQuestions,
      securityConstraints: security,
      posthogTarget: {
        projectName: `${company} PoC`,
        region,
        projectUrl: projectUrl(pid),
        projectStrategy: "precreated_blank_project",
      },
      setup: {
        projectSettings: { session_recording_opt_in: true },
        events,
        actions: events.slice(0, 2).map((e) => ({
          name: `${e.name} action`,
          description: `Matches ${e.name}`,
          matchEvents: [e.name],
        })),
        dashboards,
        cohorts: [],
        featureFlags: flags,
        surveys,
        alerts,
      },
      validationPlan: {
        syntheticEvents: events.slice(0, 2),
        requiredChecks: ["project_readable", "dashboard_present", "schema_present", "sql_smoke"],
        acceptanceThreshold: "pass_or_warn",
      },
      handoffPlan: {
        recipients: [contact.email],
        includeSdkInstructions: true,
        includeTestingPlan: true,
        includeCredentialLinks: true,
        reviewDate: ahead(reviewInDays),
        teardownDate: ahead(teardownInDays),
      },
      approval: approval?.completed
        ? {
            approvedBy: contact.email,
            approvedAt: ago(updatedMinsAgo + 5),
            approvalSource: "approval_link",
          }
        : {},
    };
  }

  if (setup) {
    data.setupResults[id] = setup(pid, customer, events, dashboards);
  }
}

// ---- Reusable setup-result builder -------------------------------------------

function buildSetup({
  pid,
  events,
  dashboards,
  status = "succeeded",
  validation,
  knownGaps = [],
  withCreds = true,
  reviewInDays = 14,
}) {
  const created = [resource("project", `${pid}`, "PoC project", projectUrl(pid))];
  dashboards.forEach((d, i) =>
    created.push(
      resource("dashboard", `dash_${pid}_${i}`, d.name, `${projectUrl(pid)}/dashboard/${1000 + i}`),
    ),
  );
  dashboards.forEach((d, di) =>
    d.tiles
      .filter((t) => t.type !== "text")
      .forEach((t, ti) =>
        created.push(
          resource(
            "insight",
            `ins_${pid}_${di}_${ti}`,
            t.title,
            `${projectUrl(pid)}/insights/${di}${ti}abc`,
          ),
        ),
      ),
  );
  events
    .slice(0, 2)
    .forEach((e, i) =>
      created.push(
        resource(
          "action",
          `act_${pid}_${i}`,
          `${e.name} action`,
          `${projectUrl(pid)}/data-management/actions/${i}`,
        ),
      ),
    );

  return {
    pocId: `poc`,
    status,
    posthog: {
      projectId: `${pid}`,
      projectName: "PoC project",
      projectUrl: projectUrl(pid),
      hostUrl: HOST,
    },
    createdResources: created,
    updatedResources: [],
    skippedResources:
      status === "succeeded"
        ? []
        : [
            {
              reason: "Deferred until customer confirms PII masking",
              resource: { type: "session_recording_playlist" },
            },
          ],
    credentialRefs: withCreds
      ? [
          {
            name: "PostHog project API key",
            secretRef: `secret_${pid}`,
            oneTimeLink: `http://localhost:3000/secrets/demo_${pid}`,
            expiresAt: ahead(reviewInDays),
          },
        ]
      : [],
    sdkInstructions: [
      {
        platform: "web",
        markdown: `import posthog from 'posthog-js'\n\nposthog.init('<project-api-key>', {\n  api_host: '${HOST}',\n  person_profiles: 'identified_only',\n})`,
      },
    ],
    knownGaps,
    validationReport: validation,
    auditEventIds: [`audit_${pid}_1`, `audit_${pid}_2`],
  };
}

function check(id, name, status, evidence, error) {
  return { id, name, status, evidence, error };
}

// ---- The seeded PoCs ----------------------------------------------------------

const acmeEvents = [
  ev("signup_started", "User begins the signup flow", ["plan", "referrer"]),
  ev("signup_completed", "User finishes signup", ["plan"]),
  ev("activation_event", "User reaches the aha moment", ["feature"]),
];
addPoc({
  id: "poc_acme",
  pid: 41001,
  company: "Acme Analytics",
  slug: "acme",
  status: "active_poc",
  objective: "Evaluate PostHog for signup activation analytics across the web app.",
  successCriteria: [
    "Activation funnel reflects test users end-to-end",
    "Weekly activation dashboard is shareable with execs",
    "Identity stitching works for logged-in users",
  ],
  events: acmeEvents,
  dashboards: [
    dashboard("Activation Overview", [
      { title: "Signups over time", type: "trend", sourceEvents: ["signup_completed"] },
      {
        title: "Signup → Activation funnel",
        type: "funnel",
        sourceEvents: ["signup_started", "activation_event"],
      },
      { title: "Notes", type: "text" },
    ]),
  ],
  flags: [{ key: "new-onboarding", name: "New onboarding flow", rollout: { percentage: 50 } }],
  assumptions: ["Customer uses a single production web app", "US data region is acceptable"],
  contact: { name: "Riley Chen", email: "riley@acme.test", role: "Head of Growth" },
  createdMinsAgo: 5760,
  updatedMinsAgo: 180,
  planVersion: 1,
  approval: { completed: true, planStatus: "approved" },
  setup: (pid, _c, events, dashboards) =>
    buildSetup({
      pid,
      events,
      dashboards,
      status: "succeeded",
      validation: {
        pocId: "poc_acme",
        status: "pass",
        checkedAt: ago(200),
        summary: "All required checks passed. Synthetic activation event visible in the dashboard.",
        checks: [
          check(
            "project_readable",
            "Project readable via MCP",
            "pass",
            "project-get returned project 41001",
          ),
          check("dashboard_present", "Activation dashboard exists", "pass", "3 tiles created"),
          check(
            "synthetic_event",
            "Synthetic activation_event captured",
            "pass",
            "Visible after 1 retry",
          ),
          check("sql_smoke", "SQL smoke query", "pass", "SELECT count() returned 1 row"),
          check("flag_present", "Feature flag created", "pass", "new-onboarding @ 50%"),
        ],
        knownGaps: [],
      },
    }),
});

const northwindEvents = [
  ev("viewed_quote", "Shipper views a freight quote", ["lane", "price"]),
  ev("requested_booking", "Shipper requests a booking", ["carrier"]),
  ev("booking_confirmed", "Booking is confirmed", ["carrier", "value"]),
  ev("carrier_selected", "Shipper selects a carrier", ["carrier"]),
];
addPoc({
  id: "poc_northwind",
  pid: 41002,
  company: "Northwind Logistics",
  slug: "northwind",
  status: "confirmation_sent",
  objective:
    "Understand why shippers drop off in the quote-to-booking funnel and which carriers win.",
  successCriteria: [
    "Quote → booking funnel is visible with drop-off rates",
    "Carrier popularity breakdown is available to the ops team",
    "Ops team has a weekly dashboard to watch",
  ],
  events: northwindEvents,
  dashboards: [
    dashboard("Booking Funnel", [
      {
        title: "Quote → Booking funnel",
        type: "funnel",
        sourceEvents: ["viewed_quote", "requested_booking", "booking_confirmed"],
      },
      { title: "Carrier popularity", type: "trend", sourceEvents: ["carrier_selected"] },
    ]),
  ],
  assumptions: ["React + Node web app", "EU data region required"],
  openQuestions: ["Should we mask freight pricing values?", "Is staging in scope or prod only?"],
  security: {
    piiPolicy: "Mask all text inputs",
    maskTextInputs: true,
    credentialExpiry: "14 days",
  },
  region: "EU",
  contact: { name: "Dana Office", email: "dana@northwind.test", role: "Head of Product" },
  createdMinsAgo: 120,
  updatedMinsAgo: 35,
  planVersion: 1,
  approval: {
    completed: false,
    planStatus: "sent_for_confirmation",
    tokenId: "tok_northwind",
    url: "/approval?tokenId=tok_northwind&publicAccessToken=pat_demo&pocId=poc_northwind",
  },
});

const globexEvents = [
  ev("checkout_started", "User starts checkout", ["cart_value"]),
  ev("payment_submitted", "User submits payment", []),
  ev("order_completed", "Order completes", ["value"]),
];
addPoc({
  id: "poc_globex",
  pid: 41003,
  company: "Globex Commerce",
  slug: "globex",
  status: "setup_running",
  objective: "Measure checkout conversion and find the highest drop-off step.",
  successCriteria: ["Checkout funnel built", "Conversion rate trend available"],
  events: globexEvents,
  dashboards: [
    dashboard("Checkout", [
      {
        title: "Checkout funnel",
        type: "funnel",
        sourceEvents: ["checkout_started", "payment_submitted", "order_completed"],
      },
    ]),
  ],
  assumptions: ["Single storefront", "US region"],
  contact: { name: "Sam Park", email: "sam@globex.test", role: "PM" },
  createdMinsAgo: 60,
  updatedMinsAgo: 4,
  planVersion: 1,
  approval: { completed: true, planStatus: "approved" },
});

const initechEvents = [
  ev("report_generated", "User generates a report", ["type"]),
  ev("report_shared", "User shares a report", []),
];
addPoc({
  id: "poc_initech",
  pid: 41004,
  company: "Initech",
  slug: "initech",
  status: "validation_running",
  objective: "Track reporting feature adoption for a renewal conversation.",
  successCriteria: ["Report usage dashboard", "Power-user cohort"],
  events: initechEvents,
  dashboards: [
    dashboard("Reporting Adoption", [
      { title: "Reports generated", type: "trend", sourceEvents: ["report_generated"] },
    ]),
  ],
  contact: { name: "Bill Lumbergh", email: "bill@initech.test", role: "Director" },
  createdMinsAgo: 90,
  updatedMinsAgo: 2,
  planVersion: 1,
  approval: { completed: true, planStatus: "approved" },
  setup: (pid, _c, events, dashboards) =>
    buildSetup({
      pid,
      events,
      dashboards,
      status: "succeeded",
      validation: {
        pocId: "poc_initech",
        status: "warn",
        checkedAt: ago(3),
        summary: "Core checks pass; synthetic event still propagating.",
        checks: [
          check("project_readable", "Project readable via MCP", "pass", "project-get ok"),
          check("dashboard_present", "Reporting dashboard exists", "pass", "1 tile created"),
          check(
            "synthetic_event",
            "Synthetic report_generated captured",
            "warn",
            "Not yet visible, retrying",
          ),
          check("sql_smoke", "SQL smoke query", "skipped"),
        ],
        knownGaps: ["Cohort not yet created"],
      },
    }),
});

addPoc({
  id: "poc_hooli",
  pid: 41005,
  company: "Hooli",
  slug: "hooli",
  status: "needs_clarification",
  objective: "Evaluate PostHog but goals are still fuzzy — needs a follow-up.",
  successCriteria: ["TBD — pending clarification"],
  events: [ev("app_opened", "App opened", [])],
  assumptions: ["Mobile + web, unclear which is primary"],
  openQuestions: [
    "Which platform is primary — iOS or web?",
    "What's the single most important metric?",
    "Is there an existing PostHog org?",
  ],
  contact: { name: "Gavin Belson", email: "gavin@hooli.test", role: "VP" },
  createdMinsAgo: 200,
  updatedMinsAgo: 150,
});

const starkEvents = [
  ev("suit_deployed", "Suit deployed", ["model"]),
  ev("threat_detected", "Threat detected", ["severity"]),
];
addPoc({
  id: "poc_stark",
  pid: 41006,
  company: "Stark Industries",
  slug: "stark",
  status: "needs_human_review",
  objective: "Telemetry analytics for deployed units — strict security review required.",
  successCriteria: ["Deployment funnel", "Threat-rate alert"],
  events: starkEvents,
  dashboards: [
    dashboard("Telemetry", [
      { title: "Deployments", type: "trend", sourceEvents: ["suit_deployed"] },
    ]),
  ],
  alerts: [
    {
      name: "Threat spike",
      condition: "threat_detected > 100 / hr",
      destination: "ops@stark.test",
    },
  ],
  security: {
    piiPolicy: "No PII may leave the EU",
    maskTextInputs: true,
    allowedDomains: ["stark.test"],
  },
  contact: { name: "Pepper Potts", email: "pepper@stark.test", role: "CEO" },
  createdMinsAgo: 300,
  updatedMinsAgo: 45,
  planVersion: 1,
  approval: { completed: true, planStatus: "approved" },
  setup: (pid, _c, events, dashboards) =>
    buildSetup({
      pid,
      events,
      dashboards,
      status: "succeeded_with_warnings",
      knownGaps: ["Alert destination unverified", "Session replay deferred pending PII sign-off"],
      validation: {
        pocId: "poc_stark",
        status: "fail",
        checkedAt: ago(46),
        summary:
          "Synthetic event never became visible; SQL smoke query failed. Escalated for review.",
        checks: [
          check("project_readable", "Project readable via MCP", "pass", "project-get ok"),
          check("dashboard_present", "Telemetry dashboard exists", "pass", "1 tile created"),
          check(
            "synthetic_event",
            "Synthetic suit_deployed captured",
            "fail",
            undefined,
            "Event not visible after 5 retries",
          ),
          check("sql_smoke", "SQL smoke query", "fail", undefined, "execute-sql returned 0 rows"),
        ],
        knownGaps: ["Ingestion may be blocked by allowed-domains policy"],
      },
    }),
});

const umbrellaEvents = [
  ev("trial_started", "Trial started", []),
  ev("feature_used", "Key feature used", ["feature"]),
  ev("upgraded", "Upgraded to paid", ["plan"]),
];
addPoc({
  id: "poc_umbrella",
  pid: 41007,
  company: "Umbrella Corp",
  slug: "umbrella",
  status: "handoff_sent",
  objective: "Trial-to-paid conversion analytics for the self-serve motion.",
  successCriteria: ["Trial → paid funnel", "Feature-usage breakdown", "Conversion alert"],
  events: umbrellaEvents,
  dashboards: [
    dashboard("Trial Conversion", [
      { title: "Trial → Paid funnel", type: "funnel", sourceEvents: ["trial_started", "upgraded"] },
      { title: "Feature usage", type: "trend", sourceEvents: ["feature_used"] },
    ]),
  ],
  surveys: [
    {
      name: "Why did you upgrade?",
      questions: [{ prompt: "What convinced you?", type: "open_text" }],
      launchDuringPoC: true,
    },
  ],
  contact: { name: "Ada Wong", email: "ada@umbrella.test", role: "Growth Lead" },
  createdMinsAgo: 1440,
  updatedMinsAgo: 240,
  planVersion: 2,
  approval: { completed: true, planStatus: "approved" },
  setup: (pid, _c, events, dashboards) =>
    buildSetup({
      pid,
      events,
      dashboards,
      status: "succeeded",
      knownGaps: ["Survey responses need 1 week to accumulate"],
      validation: {
        pocId: "poc_umbrella",
        status: "warn",
        checkedAt: ago(245),
        summary: "All core checks pass. Survey has no responses yet (expected).",
        checks: [
          check("project_readable", "Project readable via MCP", "pass", "ok"),
          check("dashboard_present", "Conversion dashboard exists", "pass", "2 tiles created"),
          check(
            "synthetic_event",
            "Synthetic upgraded event captured",
            "pass",
            "Visible immediately",
          ),
          check("survey_present", "Survey created", "warn", "No responses yet"),
          check("sql_smoke", "SQL smoke query", "pass", "1 row"),
        ],
        knownGaps: [],
      },
    }),
});

const wayneEvents = [
  ev("incident_logged", "Incident logged", ["zone"]),
  ev("response_dispatched", "Response dispatched", []),
];
addPoc({
  id: "poc_wayne",
  pid: 41008,
  company: "Wayne Enterprises",
  slug: "wayne",
  status: "completed",
  objective: "Response-time analytics PoC — completed and signed off.",
  successCriteria: ["Incident response funnel", "Response-time trend"],
  events: wayneEvents,
  dashboards: [
    dashboard("Response Ops", [
      { title: "Response time", type: "trend", sourceEvents: ["response_dispatched"] },
    ]),
  ],
  contact: { name: "Lucius Fox", email: "lucius@wayne.test", role: "CTO" },
  createdMinsAgo: 14400,
  updatedMinsAgo: 4320,
  planVersion: 1,
  approval: { completed: true, planStatus: "approved" },
  setup: (pid, _c, events, dashboards) =>
    buildSetup({
      pid,
      events,
      dashboards,
      status: "succeeded",
      validation: {
        pocId: "poc_wayne",
        status: "pass",
        checkedAt: ago(4400),
        summary: "PoC completed successfully and was signed off by the customer.",
        checks: [
          check("project_readable", "Project readable via MCP", "pass", "ok"),
          check("dashboard_present", "Response dashboard exists", "pass", "ok"),
          check("synthetic_event", "Synthetic event captured", "pass", "ok"),
          check("sql_smoke", "SQL smoke query", "pass", "ok"),
        ],
        knownGaps: [],
      },
    }),
});

// Normalize nested pocId on setup results (builder used a placeholder).
for (const [id, sr] of Object.entries(data.setupResults)) {
  sr.pocId = id;
  if (sr.validationReport) sr.validationReport.pocId = id;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`);
console.log(
  `Seeded ${Object.keys(data.pocs).length} PoCs, ${Object.keys(data.plans).length} plans, ${Object.keys(data.setupResults).length} setup results -> ${OUT}`,
);
