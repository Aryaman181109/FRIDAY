import { listAgents, listAvailableAgents } from "./agentRegistry";
import { routeAgent, routeAgents } from "./agentRouter";
import { getToolIdForCommand, MasterBrain } from "./masterBrain";
import type {
  AgentResultEnvelope,
  AgentLayer,
  AgentRoute,
  MasterBrainDryRun,
  MasterBrainFinalPreview,
  MasterBrainLedgerEntry,
  MasterBrainOrchestrationPacket,
  MasterBrainPlan,
  MasterBrainRecoveryAction,
  MasterBrainRecoveryPlan,
  MasterBrainRunManifest,
  MasterBrainSynthesisBrief,
} from "./types";
import { PermissionBrain } from "../tools/permissionBrain";
import { parseToolCommand } from "../tools/toolCommands";
import type { ToolService } from "../tools/toolService";
import { getToolById } from "../tools/toolRegistry";
import { describePermission } from "../tools/toolPermissions";

function formatWorkItem(index: number, workItem: MasterBrainPlan["selectedAgents"][number]): string {
  const tools =
    workItem.agent.toolIds.length > 0
      ? workItem.agent.toolIds.join(", ")
      : "no direct tools yet";
  const status =
    workItem.agent.status === "available"
      ? "available now"
      : "planned for later";

  return [
    `${index + 1}. ${workItem.agent.name}`,
    `   Layer: ${workItem.agent.layer}`,
    `   Status: ${status}`,
    `   Risk: ${workItem.agent.riskLevel}`,
    `   Objective: ${workItem.objective}`,
    `   Tools: ${tools}`,
    `   Note: ${workItem.output}`,
  ].join("\n");
}

function formatDelegationItem(index: number, workItem: MasterBrainPlan["selectedAgents"][number]): string {
  const tools =
    workItem.agent.toolIds.length > 0
      ? workItem.agent.toolIds.join(", ")
      : "no tools attached yet";
  const runtime =
    workItem.agent.status === "available"
      ? "online"
      : "planned";

  return [
    `${index + 1}. ${workItem.agent.name}`,
    `   Phase: ${workItem.phase}`,
    `   Role: ${workItem.objective}`,
    `   Deliverable: ${workItem.deliverable}`,
    `   Depends on: ${workItem.dependsOn.length > 0 ? workItem.dependsOn.join(", ") : "none"}`,
    `   Runtime: ${runtime}`,
    `   Tools: ${tools}`,
    `   Handoff: ${workItem.output}`,
  ].join("\n");
}

function formatPhaseGroup(
  title: string,
  phase: MasterBrainPlan["selectedAgents"][number]["phase"],
  workItems: MasterBrainPlan["selectedAgents"],
): string[] {
  const phaseItems = workItems.filter((workItem) => workItem.phase === phase);

  if (phaseItems.length === 0) {
    return [`${title}: none`];
  }

  return [
    `${title}:`,
    ...phaseItems.map((workItem) => {
      const runtime = workItem.agent.status === "available" ? "online" : "planned";
      return `- ${workItem.agent.name} (${runtime}): ${workItem.deliverable}`;
    }),
  ];
}

function formatExecutionStep(
  index: number,
  step: MasterBrainPlan["executionSteps"][number],
): string {
  return [
    `${index + 1}. ${step.agentName}`,
    `   Phase: ${step.phase}`,
    `   Instruction: ${step.instruction}`,
    `   Expected: ${step.expectedDeliverable}`,
    `   Tools: ${step.toolIds.length > 0 ? step.toolIds.join(", ") : "none"}`,
    `   Runtime: ${step.canRunNow ? "can run now" : "blocked for now"}`,
    `   Blockers: ${step.blockers.length > 0 ? step.blockers.join(" | ") : "none"}`,
  ].join("\n");
}

function formatExecutionReadiness(plan: MasterBrainPlan): string[] {
  const runnable = plan.executionSteps.filter((step) => step.canRunNow);
  const blocked = plan.executionSteps.filter((step) => !step.canRunNow);

  return [
    `Runnable steps: ${runnable.length}`,
    `Blocked steps: ${blocked.length}`,
    ...(blocked.length > 0
      ? [
          "Blockers:",
          ...blocked.map((step) => `- ${step.agentName}: ${step.blockers.join(" | ")}`),
        ]
      : ["Blockers: none"]),
  ];
}

function getReadinessDecision(plan: MasterBrainPlan): string {
  const runnableCount = plan.executionSteps.filter((step) => step.canRunNow).length;
  const blockedCount = plan.executionSteps.length - runnableCount;

  if (plan.executionSteps.length === 0) {
    return "ask for clarification";
  }

  if (blockedCount === 0) {
    return "ready";
  }

  if (runnableCount > 0) {
    return "partially ready";
  }

  return "not ready";
}

function createRunManifest(plan: MasterBrainPlan): MasterBrainRunManifest {
  const runnableSteps = plan.executionSteps.filter((step) => step.canRunNow);
  const blockedSteps = plan.executionSteps.filter((step) => !step.canRunNow);
  const readinessDecision = getReadinessDecision(plan);
  const decision =
    readinessDecision === "ready"
      ? "ready"
      : readinessDecision === "partially ready"
        ? "partially-ready"
        : readinessDecision === "ask for clarification"
          ? "needs-clarification"
          : "not-ready";
  const finalResponseMode =
    decision === "ready"
      ? "execute-and-summarize"
      : decision === "partially-ready"
        ? "partial-execution"
        : "planning-only";
  const synthesisBrief = createSynthesisBrief(finalResponseMode);

  return {
    planId: plan.id,
    request: plan.userIntent,
    decision,
    runnableStepIds: runnableSteps.map((step) => step.id),
    blockedStepIds: blockedSteps.map((step) => step.id),
    skippedStepIds: blockedSteps.map((step) => step.id),
    finalResponseMode,
    expectedResults: plan.executionSteps.map((step): AgentResultEnvelope => ({
      stepId: step.id,
      agentId: step.agentId,
      agentName: step.agentName,
      status: step.canRunNow ? "pending" : "blocked",
      summary: step.canRunNow
        ? `Waiting for ${step.agentName} to produce: ${step.expectedDeliverable}`
        : `Blocked before execution: ${step.blockers.join(" | ")}`,
      evidence: step.canRunNow
        ? []
        : step.blockers,
    })),
    synthesisBrief,
    notes: [
      `Runnable steps: ${runnableSteps.length}`,
      `Blocked steps: ${blockedSteps.length}`,
      decision === "ready"
        ? "All planned execution steps can run through the normal permission flow."
        : decision === "partially-ready"
          ? "Only runnable steps may execute; blocked steps must be reported honestly."
          : "Do not execute. Stay in planning or clarification mode.",
    ],
  };
}

function createOrchestrationPacket(plan: MasterBrainPlan): MasterBrainOrchestrationPacket {
  return {
    version: 1,
    createdAt: Date.now(),
    plan,
    manifest: createRunManifest(plan),
  };
}

function createSynthesisBrief(
  responseMode: MasterBrainRunManifest["finalResponseMode"],
): MasterBrainSynthesisBrief {
  const include =
    responseMode === "execute-and-summarize"
      ? ["completed outcome", "important result details", "next useful step if obvious"]
      : responseMode === "partial-execution"
        ? ["what completed", "what was blocked", "why it was blocked", "next safest step"]
        : ["what FRIDAY understood", "why execution cannot proceed", "clarifying question or missing capability"];

  const avoid = [
    "internal implementation details unless requested",
    "listing agents unless the user asked for orchestration details",
    "claiming planned agents or blocked steps executed",
    "over-explaining simple outcomes",
  ];

  const honestyRules = [
    "Never say a tool ran unless an execution result confirms it.",
    "Treat blocked result envelopes as constraints, not accomplishments.",
    "If only part of the plan is runnable, separate completed work from blocked work.",
    "Keep the final answer in FRIDAY's single voice.",
  ];

  return {
    responseMode,
    audience: "user",
    voice: "friday",
    include,
    avoid,
    honestyRules,
  };
}

function formatRunManifest(manifest: MasterBrainRunManifest): string[] {
  return [
    `Plan: ${manifest.planId}`,
    `Decision: ${manifest.decision}`,
    `Final response mode: ${manifest.finalResponseMode}`,
    `Runnable step IDs: ${manifest.runnableStepIds.length > 0 ? manifest.runnableStepIds.join(", ") : "none"}`,
    `Blocked step IDs: ${manifest.blockedStepIds.length > 0 ? manifest.blockedStepIds.join(", ") : "none"}`,
    `Skipped step IDs: ${manifest.skippedStepIds.length > 0 ? manifest.skippedStepIds.join(", ") : "none"}`,
    "Expected result envelopes:",
    ...manifest.expectedResults.map((result) =>
      `- ${result.stepId} -> ${result.agentName}: ${result.status}; ${result.summary}`,
    ),
    "Synthesis brief:",
    `- Response mode: ${manifest.synthesisBrief.responseMode}`,
    `- Include: ${manifest.synthesisBrief.include.join(", ")}`,
    `- Avoid: ${manifest.synthesisBrief.avoid.join(", ")}`,
    `- Honesty: ${manifest.synthesisBrief.honestyRules.join(" | ")}`,
    "Notes:",
    ...manifest.notes.map((note) => `- ${note}`),
  ];
}

function formatOrchestrationPacket(packet: MasterBrainOrchestrationPacket): string[] {
  return [
    `Version: ${packet.version}`,
    `Plan: ${packet.plan.id}`,
    `Request: ${packet.plan.userIntent}`,
    `Agents: ${packet.plan.selectedAgents.length}`,
    `Execution steps: ${packet.plan.executionSteps.length}`,
    `Decision: ${packet.manifest.decision}`,
    `Final response mode: ${packet.manifest.finalResponseMode}`,
    `Expected result envelopes: ${packet.manifest.expectedResults.length}`,
    `Synthesis mode: ${packet.manifest.synthesisBrief.responseMode}`,
  ];
}

function createDryRun(packet: MasterBrainOrchestrationPacket): MasterBrainDryRun {
  const runnableStepIds = new Set(packet.manifest.runnableStepIds);
  const wouldRunStepIds = packet.plan.executionSteps
    .filter((step) => runnableStepIds.has(step.id))
    .map((step) => step.id);
  const wouldSkipStepIds = packet.plan.executionSteps
    .filter((step) => !runnableStepIds.has(step.id))
    .map((step) => step.id);
  const simulatedResults = packet.plan.executionSteps.map((step): AgentResultEnvelope => {
    if (!runnableStepIds.has(step.id)) {
      return {
        stepId: step.id,
        agentId: step.agentId,
        agentName: step.agentName,
        status: "skipped",
        summary: `Dry run skipped this step: ${step.blockers.join(" | ")}`,
        evidence: step.blockers,
        producedAt: Date.now(),
      };
    }

    return {
      stepId: step.id,
      agentId: step.agentId,
      agentName: step.agentName,
      status: "completed",
      summary: `Dry run would ask ${step.agentName} to produce: ${step.expectedDeliverable}`,
      evidence: [`Instruction: ${step.instruction}`],
      producedAt: Date.now(),
    };
  });
  const ledger = createDryRunLedger(packet, simulatedResults);

  return {
    packetVersion: packet.version,
    planId: packet.plan.id,
    request: packet.plan.userIntent,
    wouldRunStepIds,
    wouldSkipStepIds,
    simulatedResults,
    ledger,
    finalResponseMode: packet.manifest.finalResponseMode,
    summary:
      wouldSkipStepIds.length === 0
        ? "Dry run is fully runnable through the current orchestration path."
        : wouldRunStepIds.length > 0
          ? "Dry run is partially runnable; skipped steps must be reported honestly."
          : "Dry run cannot execute any steps yet.",
  };
}

function createDryRunLedger(
  packet: MasterBrainOrchestrationPacket,
  results: AgentResultEnvelope[],
): MasterBrainLedgerEntry[] {
  const resultByStep = new Map(results.map((result) => [result.stepId, result]));
  const createdAt = Date.now();

  return packet.plan.executionSteps.flatMap((step, index): MasterBrainLedgerEntry[] => {
    const result = resultByStep.get(step.id);
    const event = step.canRunNow ? "would-run" : "would-skip";
    const statusEntry: MasterBrainLedgerEntry = {
      id: `ledger_${index + 1}_${event}`,
      stepId: step.id,
      agentId: step.agentId,
      agentName: step.agentName,
      event,
      message: step.canRunNow
        ? `${step.agentName} would run in phase ${step.phase}.`
        : `${step.agentName} would be skipped: ${step.blockers.join(" | ")}`,
      createdAt,
    };

    if (!result) {
      return [statusEntry];
    }

    return [
      statusEntry,
      {
        id: `ledger_${index + 1}_simulated_result`,
        stepId: step.id,
        agentId: step.agentId,
        agentName: step.agentName,
        event: result.status === "skipped" ? "blocked" : "simulated-result",
        message: result.summary,
        createdAt: result.producedAt ?? createdAt,
      },
    ];
  });
}

function formatDryRun(dryRun: MasterBrainDryRun): string[] {
  return [
    `Packet version: ${dryRun.packetVersion}`,
    `Plan: ${dryRun.planId}`,
    `Request: ${dryRun.request}`,
    `Final response mode: ${dryRun.finalResponseMode}`,
    `Would run: ${dryRun.wouldRunStepIds.length > 0 ? dryRun.wouldRunStepIds.join(", ") : "none"}`,
    `Would skip: ${dryRun.wouldSkipStepIds.length > 0 ? dryRun.wouldSkipStepIds.join(", ") : "none"}`,
    `Ledger entries: ${dryRun.ledger.length}`,
    `Summary: ${dryRun.summary}`,
    "Simulated results:",
    ...dryRun.simulatedResults.map((result) =>
      `- ${result.stepId} -> ${result.agentName}: ${result.status}; ${result.summary}`,
    ),
  ];
}

function createRecoveryPlan(dryRun: MasterBrainDryRun): MasterBrainRecoveryPlan {
  const blockedResults = dryRun.simulatedResults.filter(
    (result) => result.status === "skipped" || result.status === "blocked",
  );
  const actions = dryRun.simulatedResults.map((result) => {
    if (result.status !== "skipped" && result.status !== "blocked") {
      return {
        stepId: result.stepId,
        agentName: result.agentName,
        action: "continue" as const,
        reason: "Dry run indicates this step can contribute.",
      };
    }

    const blockerText = result.evidence.join(" ");
    const action: MasterBrainRecoveryAction["action"] =
      /planned|not executable yet|No direct tools/i.test(blockerText)
        ? "wait-for-capability"
        : /explicit|permission|confirm/i.test(blockerText)
          ? "ask-user"
          : "skip-and-summarize";

    return {
      stepId: result.stepId,
      agentName: result.agentName,
      action,
      reason: result.summary,
    };
  });
  const status =
    blockedResults.length === 0
      ? "clear"
      : blockedResults.length < dryRun.simulatedResults.length
        ? "recoverable"
        : "blocked";

  return {
    planId: dryRun.planId,
    request: dryRun.request,
    status,
    actions,
    summary:
      status === "clear"
        ? "No recovery needed; all dry-run steps are runnable."
        : status === "recoverable"
          ? "Proceed with runnable steps and explain blocked steps clearly."
          : "Do not execute yet; the plan needs clarification or missing capability.",
  };
}

function formatRecoveryPlan(recoveryPlan: MasterBrainRecoveryPlan): string[] {
  return [
    `Plan: ${recoveryPlan.planId}`,
    `Request: ${recoveryPlan.request}`,
    `Status: ${recoveryPlan.status}`,
    `Summary: ${recoveryPlan.summary}`,
    "Actions:",
    ...recoveryPlan.actions.map((action) =>
      `- ${action.stepId} -> ${action.agentName}: ${action.action}; ${action.reason}`,
    ),
  ];
}

function createFinalPreview(
  dryRun: MasterBrainDryRun,
  recoveryPlan: MasterBrainRecoveryPlan,
): MasterBrainFinalPreview {
  const completedResults = dryRun.simulatedResults.filter(
    (result) => result.status === "completed",
  );
  const blockedResults = dryRun.simulatedResults.filter(
    (result) => result.status === "skipped" || result.status === "blocked",
  );
  const message =
    recoveryPlan.status === "clear"
      ? `I can handle this path. The plan has ${completedResults.length} runnable step${completedResults.length === 1 ? "" : "s"}, and the final answer should summarize the completed outcome without exposing internal agent details.`
      : recoveryPlan.status === "recoverable"
        ? `I can handle part of this. I would proceed with ${completedResults.length} runnable step${completedResults.length === 1 ? "" : "s"} and clearly explain ${blockedResults.length} blocked step${blockedResults.length === 1 ? "" : "s"} instead of pretending they ran.`
        : "I should not execute this yet. The plan is blocked, so the final answer should ask for what is missing or explain the unavailable capability.";

  return {
    planId: dryRun.planId,
    request: dryRun.request,
    responseMode: dryRun.finalResponseMode,
    message,
    includedResultCount: completedResults.length,
    blockedResultCount: blockedResults.length,
  };
}

function formatFinalPreview(preview: MasterBrainFinalPreview): string[] {
  return [
    `Plan: ${preview.planId}`,
    `Request: ${preview.request}`,
    `Response mode: ${preview.responseMode}`,
    `Included results: ${preview.includedResultCount}`,
    `Blocked results: ${preview.blockedResultCount}`,
    "",
    "Preview:",
    preview.message,
  ];
}

function formatMasterBrainResponse(
  preview: MasterBrainFinalPreview,
  recoveryPlan: MasterBrainRecoveryPlan,
  usesPersonality: boolean,
): string {
  const presenceLine = usesPersonality
    ? "I’ll keep the response calm, concise, and in one FRIDAY voice."
    : "I’ll keep the response operational and clear.";

  if (recoveryPlan.status === "clear") {
    return [
      "I can handle that path.",
      "",
      preview.message,
      "",
      "Nothing is blocked in the current dry-run plan. Real execution still follows the normal permission gates.",
      presenceLine,
    ].join("\n");
  }

  if (recoveryPlan.status === "recoverable") {
    const blockedActions = recoveryPlan.actions.filter(
      (action) => action.action !== "continue",
    );

    return [
      "I can handle part of that.",
      "",
      preview.message,
      "",
      "What needs attention:",
      ...blockedActions.map((action) => `- ${action.agentName}: ${action.action}`),
      "",
      "I would continue only with the runnable parts and explain the rest clearly.",
      presenceLine,
    ].join("\n");
  }

  return [
    "I should not run that yet.",
    "",
    preview.message,
    "",
    "The current plan is blocked, so I would ask for clarification or wait for the missing capability before taking action.",
    presenceLine,
  ].join("\n");
}

const LAYER_ORDER: AgentLayer[] = [
  "system-intelligence",
  "security",
  "operating-system",
  "internet",
  "memory",
  "productivity",
  "communication",
  "vision",
  "coding",
  "autonomous",
  "analytics",
  "creative",
  "personality",
];

function classifyIntent(input: string, routes: AgentRoute[]): string {
  const normalizedInput = input.toLowerCase();

  if (/\b(open|launch|quit|close|focus|move|copy|delete|trash|create|write|append|notify|capture)\b/.test(normalizedInput)) {
    return "action request";
  }

  if (/\b(search|research|find|read|summarize|analyze|inspect|list|show|view|status|overview)\b/.test(normalizedInput)) {
    return "information request";
  }

  if (/\b(can|able|capability|agent|tool|permission|safe|confirm)\b/.test(normalizedInput)) {
    return "capability request";
  }

  if (routes.some((route) => route.agent.layer === "productivity")) {
    return "productivity request";
  }

  if (routes.some((route) => route.agent.layer === "memory")) {
    return "memory request";
  }

  return "general request";
}

function classifyRisk(routes: AgentRoute[]): string {
  if (routes.some((route) => route.agent.riskLevel === "dangerous")) {
    return "dangerous";
  }

  if (routes.some((route) => route.agent.riskLevel === "confirm")) {
    return "needs confirmation for execution";
  }

  return "safe";
}

function getRouteTools(route: AgentRoute) {
  return route.agent.toolIds
    .map((toolId) => getToolById(toolId))
    .filter((tool) => tool !== undefined);
}

function findClarificationReasons(input: string): string[] {
  const normalizedInput = input.toLowerCase().trim();
  const reasons: string[] = [];

  if (normalizedInput.length < 8) {
    reasons.push("The request is very short.");
  }

  if (/\b(open|launch|quit|close|focus|delete|remove|trash|move|copy|rename|create|write|append|search|find|read)\s*$/i.test(input)) {
    reasons.push("The action is missing a target.");
  }

  if (/\b(this|that|it|there|here)\b/i.test(input) && !/\b(file|folder|app|window|note|reminder|todo|website|url|clipboard)\b/i.test(input)) {
    reasons.push("The request uses a vague reference without a clear object.");
  }

  if (/\b(delete|remove|trash|move|rename|overwrite|clear)\b/i.test(input) && !/\b(file|folder|note|memory|reminder|todo|clipboard)\b/i.test(input)) {
    reasons.push("The request may change or remove something, but the target type is unclear.");
  }

  if (/\b(search|find|read|summarize|analyze)\b/i.test(input) && !/\b(for|about|in|inside|file|folder|url|website|webpage|notes|memory|reminders|todos|to-dos)\b/i.test(input)) {
    reasons.push("The information request is missing a source or topic.");
  }

  return reasons;
}

function clampConfidence(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function extractConstraint(pattern: RegExp, input: string): string | null {
  const match = input.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function extractConstraints(input: string): string[] {
  const constraints = [
    ["Topic", extractConstraint(/\b(?:about|for)\s+(.+?)(?:\s+(?:in|inside|to|from|with)\b|$)/i, input)],
    ["Source", extractConstraint(/\b(?:in|inside|from)\s+(?:the\s+)?(.+?)(?:\s+(?:to|with|about|for)\b|$)/i, input)],
    ["Destination", extractConstraint(/\b(?:to|into)\s+(?:the\s+)?(.+)$/i, input)],
    ["Timing", extractConstraint(/\b(?:in|after)\s+(\d+\s+(?:seconds?|minutes?|hours?|days?))\b/i, input)],
    ["App", extractConstraint(/\b(?:app|application)\s+([a-z0-9 ._-]+)$/i, input)],
    ["Named path", extractConstraint(/\b((?:~|\/|\.\/|[A-Za-z]:\\)[^\s]+)\b/i, input)],
  ].flatMap(([label, value]) => value ? [`${label}: ${value}`] : []);

  if (/\b(confirm|ask|permission|safe|careful)\b/i.test(input)) {
    constraints.push("Permission hint: user referenced safety or confirmation.");
  }

  if (/\b(this|that|it)\b/i.test(input)) {
    constraints.push("Reference hint: request contains a pronoun that may need context.");
  }

  return Array.from(new Set(constraints));
}

export class AgentService {
  private readonly masterBrain = new MasterBrain();
  private readonly permissionBrain = new PermissionBrain();

  route(input: string): AgentRoute | null {
    return routeAgent(input);
  }

  routeMany(input: string): AgentRoute[] {
    return routeAgents(input);
  }

  createPlan(input: string): MasterBrainPlan | null {
    return this.masterBrain.plan(input);
  }

  execute(input: string, toolService: ToolService) {
    return this.masterBrain.execute(input, toolService);
  }

  listAgents(): string {
    const available = listAvailableAgents()
      .map((agent) => `- ${agent.name} (${agent.id})`)
      .join("\n");
    const plannedCount = listAgents().filter(
      (agent) => agent.status === "planned",
    ).length;

    return [
      "Available FRIDAY agents:",
      available,
      "",
      `${plannedCount} additional agents are mapped as planned capabilities.`,
    ].join("\n");
  }

  orchestrationCommands(): string {
    return [
      "FRIDAY orchestration commands:",
      "",
      "Planning:",
      "- delegation plan <request>",
      "- execution timeline <request>",
      "- execution readiness <request>",
      "",
      "Executor contract:",
      "- run manifest <request>",
      "- orchestration packet <request>",
      "- result envelopes <request>",
      "- synthesis brief <request>",
      "",
      "Safe rehearsal:",
      "- dry run orchestration <request>",
      "- orchestration ledger <request>",
      "- orchestration recovery <request>",
      "- final answer preview <request>",
      "- orchestration report <request>",
      "",
      "Rule:",
      "These commands inspect or simulate orchestration. They do not execute desktop, browser, file, notification, or system-changing actions.",
    ].join("\n");
  }

  orchestrationHealth(): string {
    const agents = listAgents();
    const availableAgents = agents.filter((agent) => agent.status === "available");
    const plannedAgents = agents.filter((agent) => agent.status === "planned");
    const availableTools = new Set(availableAgents.flatMap((agent) => agent.toolIds));
    const plannedTools = new Set(plannedAgents.flatMap((agent) => agent.toolIds));

    return [
      "FRIDAY orchestration health:",
      "",
      "Agent registry:",
      `- Online agents: ${availableAgents.length}`,
      `- Planned agents: ${plannedAgents.length}`,
      `- Online tool links: ${availableTools.size}`,
      `- Planned tool links: ${plannedTools.size}`,
      "",
      "Master Brain layers:",
      "- Routing: online",
      "- Phased delegation: online",
      "- Handoff contracts: online",
      "- Execution timeline: online",
      "- Go/no-go readiness: online",
      "- Run manifest: online",
      "- Result envelopes: online",
      "- Synthesis brief: online",
      "- Orchestration packet: online",
      "- Dry-run executor: online",
      "- Ledger: online",
      "- Recovery plan: online",
      "- Final answer preview: online",
      "",
      "Execution boundary:",
      "The orchestration stack can plan, simulate, audit, recover, and preview. Real multi-step autonomous execution is not enabled yet.",
    ].join("\n");
  }

  capabilityMatrix(): string {
    const agents = listAgents();
    const rows = LAYER_ORDER.flatMap((layer) => {
      const layerAgents = agents.filter((agent) => agent.layer === layer);
      if (layerAgents.length === 0) return [];

      const available = layerAgents.filter((agent) => agent.status === "available");
      const planned = layerAgents.filter((agent) => agent.status === "planned");
      const directTools = new Set(layerAgents.flatMap((agent) => agent.toolIds));
      const status =
        available.length === layerAgents.length
          ? "online"
          : available.length > 0
            ? "partial"
            : "planned";

      return [
        [
          `- ${layer}: ${status}`,
          `  Agents: ${available.length} online / ${planned.length} planned`,
          `  Direct tools: ${directTools.size}`,
          `  Online: ${
            available.length > 0
              ? available.map((agent) => agent.name).join(", ")
              : "none"
          }`,
          planned.length > 0
            ? `  Planned: ${planned.map((agent) => agent.name).join(", ")}`
            : "  Planned: none",
        ].join("\n"),
      ];
    });

    return [
      "FRIDAY capability matrix:",
      "",
      ...rows,
      "",
      "Readiness:",
      "Core intelligence, desktop actions, browser/research, memory, productivity, security, diagnostics, logging, recovery, screen capture vision, coding inspection, response personality, workflow blueprinting, voice output, and microphone transcription are online in early form. Creative tools, analytics, real background automation, wake word, and interruptible streaming speech are still planned layers.",
    ].join("\n");
  }

  capabilityLookup(input: string): string {
    const routes = this.routeMany(input);

    if (routes.length === 0) {
      return [
        "Capability lookup:",
        "",
        `Request: ${input}`,
        "Status: unknown",
        "",
        "I could not map that to a specific FRIDAY agent yet.",
      ].join("\n");
    }

    const availableRoutes = routes.filter((route) => route.agent.status === "available");
    const plannedRoutes = routes.filter((route) => route.agent.status === "planned");
    const directTools = routes.flatMap((route) => getRouteTools(route));
    const safeToolCount = directTools.filter((tool) => tool.permissionLevel === "safe").length;
    const confirmToolCount = directTools.filter((tool) => tool.permissionLevel === "confirm").length;
    const dangerousToolCount = directTools.filter((tool) => tool.permissionLevel === "dangerous").length;
    const status =
      availableRoutes.length > 0 && plannedRoutes.length === 0
        ? "available now"
        : availableRoutes.length > 0
          ? "partially available"
          : "planned";

    return [
      "Capability lookup:",
      "",
      `Request: ${input}`,
      `Status: ${status}`,
      "",
      "Matching agents:",
      ...routes.map((route) => {
        const tools = getRouteTools(route).map((tool) => `${tool.id} (${describePermission(tool)})`);

        return [
          `- ${route.agent.name}: ${route.agent.status}`,
          `  Layer: ${route.agent.layer}`,
          `  Risk: ${route.agent.riskLevel}`,
          `  Tools: ${tools.length > 0 ? tools.join(", ") : "no direct tools yet"}`,
        ].join("\n");
      }),
      "",
      "Permission shape:",
      `Safe tools: ${safeToolCount}`,
      `Needs confirmation: ${confirmToolCount}`,
      `Dangerous/blocked tools: ${dangerousToolCount}`,
      "",
      availableRoutes.length > 0
        ? "FRIDAY can help with this in the current build, within the permission boundaries above."
        : "This belongs to a planned layer, so FRIDAY can discuss the intent but should not claim active execution yet.",
    ].join("\n");
  }

  classifyRequest(input: string): string {
    const routes = this.routeMany(input);
    const intentType = classifyIntent(input, routes);
    const risk = classifyRisk(routes);
    const runtimeStatus =
      routes.length === 0
        ? "unrouted"
        : routes.some((route) => route.agent.status === "available")
          ? "has available support"
          : "planned only";

    return [
      "Intent classification:",
      "",
      `Request: ${input}`,
      `Intent type: ${intentType}`,
      `Runtime status: ${runtimeStatus}`,
      `Risk shape: ${risk}`,
      "",
      "Likely agent chain:",
      ...(routes.length > 0
        ? routes.map((route, index) => `${index + 1}. ${route.agent.name} (${route.agent.layer}, ${route.agent.status})`)
        : ["No matching specialist yet."]),
      "",
      "Decision:",
      risk === "safe"
        ? "This can stay in direct execution territory if a supported command exists."
        : "FRIDAY should plan first and require explicit user intent before executing anything with side effects.",
    ].join("\n");
  }

  assessRisk(input: string): string {
    const routes = this.routeMany(input);
    const tools = routes.flatMap((route) => getRouteTools(route));
    const safeTools = tools.filter((tool) => tool.permissionLevel === "safe");
    const confirmTools = tools.filter((tool) => tool.permissionLevel === "confirm");
    const dangerousTools = tools.filter((tool) => tool.permissionLevel === "dangerous");
    const plannedAgents = routes.filter((route) => route.agent.status === "planned");
    const risk =
      dangerousTools.length > 0 || routes.some((route) => route.agent.riskLevel === "dangerous")
        ? "blocked until a dedicated flow exists"
        : confirmTools.length > 0 || routes.some((route) => route.agent.riskLevel === "confirm")
          ? "confirmation required before execution"
          : "safe/read-only";

    return [
      "Risk assessment:",
      "",
      `Request: ${input}`,
      `Risk level: ${risk}`,
      "",
      "Permission shape:",
      `Safe tools: ${safeTools.length}`,
      `Confirmation tools: ${confirmTools.length}`,
      `Dangerous tools: ${dangerousTools.length}`,
      `Planned agents: ${plannedAgents.length}`,
      "",
      "Relevant boundaries:",
      ...(confirmTools.length > 0
        ? confirmTools.slice(0, 8).map((tool) => `- ${tool.id}: ${describePermission(tool)}`)
        : ["- No confirmation-gated direct tools detected."]),
      ...(dangerousTools.length > 0
        ? dangerousTools.slice(0, 8).map((tool) => `- ${tool.id}: ${describePermission(tool)}`)
        : []),
      "",
      "Decision:",
      risk === "safe/read-only"
        ? "FRIDAY may answer or run a supported safe command directly."
        : risk === "confirmation required before execution"
          ? "FRIDAY may plan and explain, but execution needs explicit user intent."
          : "FRIDAY should refuse execution and offer a safer alternative.",
    ].join("\n");
  }

  previewExecution(input: string): string {
    const routes = this.routeMany(input);
    const command = parseToolCommand(input);

    if (!command) {
      return [
        "Execution preview:",
        "",
        `Request: ${input}`,
        "Detected command: none",
        "",
        "FRIDAY can plan this request, but no directly executable supported command was detected.",
      ].join("\n");
    }

    const toolId = getToolIdForCommand(command);
    const tool = getToolById(toolId);
    const decision = this.permissionBrain.decide(toolId, input);

    return [
      "Execution preview:",
      "",
      `Request: ${input}`,
      `Detected command: ${command.type}`,
      `Tool: ${toolId}`,
      `Tool status: ${tool ? tool.availability : "unknown"}`,
      `Permission: ${decision.status}`,
      `Reason: ${decision.reason}`,
      "",
      "Likely agents:",
      ...(routes.length > 0
        ? routes.map((route, index) => `${index + 1}. ${route.agent.name} (${route.agent.status}, ${route.agent.riskLevel})`)
        : ["No matching specialist yet."]),
      "",
      "Execution boundary:",
      decision.status === "allowed"
        ? "FRIDAY may execute this supported command if the user submits it normally."
        : "FRIDAY should not execute this until the permission issue is resolved.",
    ].join("\n");
  }

  clarificationCheck(input: string): string {
    const command = parseToolCommand(input);
    const routes = this.routeMany(input);
    const reasons = findClarificationReasons(input);
    const needsClarification = reasons.length > 0 || (!command && routes.length === 0);

    return [
      "Clarification check:",
      "",
      `Request: ${input}`,
      `Needs clarification: ${needsClarification ? "yes" : "no"}`,
      `Detected command: ${command ? command.type : "none"}`,
      "",
      "Signals:",
      ...(reasons.length > 0 ? reasons.map((reason) => `- ${reason}`) : ["- The request is specific enough for planning."]),
      "",
      "Suggested follow-up:",
      needsClarification
        ? this.suggestClarifyingQuestion(input, command !== null)
        : "No follow-up needed before normal planning.",
    ].join("\n");
  }

  decisionPipeline(input: string): string {
    const routes = this.routeMany(input);
    const command = parseToolCommand(input);
    const clarificationReasons = findClarificationReasons(input);
    const needsClarification =
      clarificationReasons.length > 0 || (!command && routes.length === 0);
    const intentType = classifyIntent(input, routes);
    const riskShape = classifyRisk(routes);
    const toolId = command ? getToolIdForCommand(command) : null;
    const decision = toolId ? this.permissionBrain.decide(toolId, input) : null;

    return [
      "Decision pipeline:",
      "",
      `Request: ${input}`,
      "",
      "1. Intent",
      `Type: ${intentType}`,
      `Agent support: ${
        routes.some((route) => route.agent.status === "available")
          ? "available"
          : routes.length > 0
            ? "planned only"
            : "unrouted"
      }`,
      "",
      "2. Clarification",
      `Needs clarification: ${needsClarification ? "yes" : "no"}`,
      ...(clarificationReasons.length > 0
        ? clarificationReasons.map((reason) => `- ${reason}`)
        : ["- Request is specific enough for current planning."]),
      "",
      "3. Risk",
      `Risk shape: ${riskShape}`,
      "",
      "4. Execution preview",
      `Command: ${command ? command.type : "none"}`,
      `Tool: ${toolId ?? "none"}`,
      `Permission: ${decision ? decision.status : "not evaluated"}`,
      `Reason: ${decision ? decision.reason : "No supported command was detected."}`,
      "",
      "Final gate:",
      needsClarification
        ? this.suggestClarifyingQuestion(input, command !== null)
        : decision?.status === "allowed"
          ? "FRIDAY can proceed if the user submits the command normally."
          : "FRIDAY should plan or ask before execution.",
    ].join("\n");
  }

  delegationPlan(input: string): string {
    const plan = this.createPlan(input);
    const command = parseToolCommand(input);
    const toolId = command ? getToolIdForCommand(command) : null;
    const decision = toolId ? this.permissionBrain.decide(toolId, input) : null;

    if (!plan) {
      return [
        "Delegation plan:",
        "",
        `Request: ${input}`,
        "",
        "Master Brain:",
        "No specialist team matched this yet. FRIDAY should handle it as a general reasoning request or ask for a clearer target.",
      ].join("\n");
    }

    const onlineAgents = plan.selectedAgents.filter(
      (workItem) => workItem.agent.status === "available",
    );
    const plannedAgents = plan.selectedAgents.filter(
      (workItem) => workItem.agent.status === "planned",
    );
    const manifest = createRunManifest(plan);

    return [
      "Delegation plan:",
      "",
      `Request: ${input}`,
      "",
      "Master Brain:",
      "Break the request into specialist work, let the relevant agents contribute, then return one clean outcome to the user.",
      "",
      "Coordination phases:",
      ...formatPhaseGroup("1. Context", "context", plan.selectedAgents),
      ...formatPhaseGroup("2. Action", "action", plan.selectedAgents),
      ...formatPhaseGroup("3. Memory", "memory", plan.selectedAgents),
      ...formatPhaseGroup("4. Synthesis", "synthesis", plan.selectedAgents),
      "",
      "Agent team:",
      ...plan.selectedAgents.map((workItem, index) => formatDelegationItem(index, workItem)),
      "",
      "Execution timeline:",
      ...plan.executionSteps.map((step, index) => formatExecutionStep(index, step)),
      "",
      "Execution readiness:",
      ...formatExecutionReadiness(plan),
      "",
      "Run manifest:",
      ...formatRunManifest(manifest),
      "",
      "Execution gate:",
      `Direct command: ${command ? command.type : "none detected"}`,
      `Tool: ${toolId ?? "none"}`,
      `Permission: ${decision ? decision.status : "not evaluated"}`,
      decision ? `Reason: ${decision.reason}` : "Reason: No executable tool was selected.",
      "",
      "Readiness:",
      `${onlineAgents.length} online agents can contribute now.`,
      plannedAgents.length > 0
        ? `${plannedAgents.length} planned agents are relevant but cannot act yet.`
        : "No planned-only agents are required for this request.",
      "",
      "Final response rule:",
      "FRIDAY should speak as one intelligence, not as separate agents, and only mention the team when the user asks.",
    ].join("\n");
  }

  runManifest(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return [
        "Run manifest:",
        "",
        `Request: ${input}`,
        "Decision: needs-clarification",
        "",
        "FRIDAY could not route this to a specialist team yet.",
      ].join("\n");
    }

    return [
      "Run manifest:",
      "",
      `Request: ${input}`,
      "",
      ...formatRunManifest(createRunManifest(plan)),
    ].join("\n");
  }

  orchestrationPacket(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return [
        "Orchestration packet:",
        "",
        `Request: ${input}`,
        "",
        "No packet could be created because FRIDAY could not route this request yet.",
      ].join("\n");
    }

    const packet = createOrchestrationPacket(plan);

    return [
      "Orchestration packet:",
      "",
      ...formatOrchestrationPacket(packet),
      "",
      "Executor contract:",
      "Use the plan for agent order, the manifest for go/no-go, result envelopes for evidence, and the synthesis brief for the final FRIDAY response.",
    ].join("\n");
  }

  dryRunOrchestration(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return [
        "Dry run orchestration:",
        "",
        `Request: ${input}`,
        "",
        "No dry run could be created because FRIDAY could not route this request yet.",
      ].join("\n");
    }

    const dryRun = createDryRun(createOrchestrationPacket(plan));

    return [
      "Dry run orchestration:",
      "",
      ...formatDryRun(dryRun),
      "",
      "Safety:",
      "This is a simulation only. No tools, desktop actions, browser actions, files, or notifications were executed.",
    ].join("\n");
  }

  orchestrationLedger(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return [
        "Orchestration ledger:",
        "",
        `Request: ${input}`,
        "",
        "No ledger could be created because FRIDAY could not route this request yet.",
      ].join("\n");
    }

    const dryRun = createDryRun(createOrchestrationPacket(plan));

    return [
      "Orchestration ledger:",
      "",
      `Request: ${input}`,
      "",
      ...dryRun.ledger.map((entry, index) => [
        `${index + 1}. ${entry.event}`,
        `   Agent: ${entry.agentName}`,
        `   Step: ${entry.stepId}`,
        `   Message: ${entry.message}`,
      ].join("\n")),
      "",
      "Scope:",
      "This ledger is generated from a dry run only. It records intended orchestration, not real tool execution.",
    ].join("\n");
  }

  orchestrationRecovery(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return [
        "Orchestration recovery:",
        "",
        `Request: ${input}`,
        "",
        "No recovery plan could be created because FRIDAY could not route this request yet.",
      ].join("\n");
    }

    const dryRun = createDryRun(createOrchestrationPacket(plan));
    const recoveryPlan = createRecoveryPlan(dryRun);

    return [
      "Orchestration recovery:",
      "",
      ...formatRecoveryPlan(recoveryPlan),
      "",
      "Rule:",
      "Recovery actions are planning guidance only. They do not execute tools or change the system.",
    ].join("\n");
  }

  finalAnswerPreview(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return [
        "Final answer preview:",
        "",
        `Request: ${input}`,
        "",
        "I should ask for clarification because I could not route this request to a specialist team yet.",
      ].join("\n");
    }

    const dryRun = createDryRun(createOrchestrationPacket(plan));
    const recoveryPlan = createRecoveryPlan(dryRun);
    const preview = createFinalPreview(dryRun, recoveryPlan);

    return [
      "Final answer preview:",
      "",
      ...formatFinalPreview(preview),
      "",
      "Scope:",
      "This preview is based on dry-run orchestration only. It does not claim real tool execution.",
    ].join("\n");
  }

  orchestrationReport(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return [
        "Orchestration report:",
        "",
        `Request: ${input}`,
        "",
        "No report could be created because FRIDAY could not route this request yet.",
      ].join("\n");
    }

    const packet = createOrchestrationPacket(plan);
    const dryRun = createDryRun(packet);
    const recoveryPlan = createRecoveryPlan(dryRun);
    const preview = createFinalPreview(dryRun, recoveryPlan);

    return [
      "Orchestration report:",
      "",
      "Packet:",
      ...formatOrchestrationPacket(packet),
      "",
      "Dry run:",
      ...formatDryRun(dryRun),
      "",
      "Recovery:",
      ...formatRecoveryPlan(recoveryPlan),
      "",
      "Final answer preview:",
      ...formatFinalPreview(preview),
      "",
      "Safety:",
      "This report is a full dry-run pipeline. It does not execute tools or change the system.",
    ].join("\n");
  }

  masterBrainResponse(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return [
        "I need a clearer target before I can coordinate that.",
        "",
        `Request: ${input}`,
      ].join("\n");
    }

    const dryRun = createDryRun(createOrchestrationPacket(plan));
    const recoveryPlan = createRecoveryPlan(dryRun);
    const preview = createFinalPreview(dryRun, recoveryPlan);
    const usesPersonality = plan.selectedAgents.some(
      (workItem) => workItem.agent.id === "personality.engine",
    );

    return formatMasterBrainResponse(preview, recoveryPlan, usesPersonality);
  }

  resultEnvelopes(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return [
        "Agent result envelopes:",
        "",
        `Request: ${input}`,
        "",
        "No result envelopes could be created because FRIDAY could not route this request yet.",
      ].join("\n");
    }

    const manifest = createRunManifest(plan);

    return [
      "Agent result envelopes:",
      "",
      `Request: ${input}`,
      "",
      ...manifest.expectedResults.map((result, index) => [
        `${index + 1}. ${result.agentName}`,
        `   Step: ${result.stepId}`,
        `   Status: ${result.status}`,
        `   Summary: ${result.summary}`,
        `   Evidence: ${result.evidence.length > 0 ? result.evidence.join(" | ") : "none yet"}`,
      ].join("\n")),
      "",
      "Rule:",
      "Future agent execution should fill these envelopes with summaries and evidence, then the Master Brain should synthesize one final answer.",
    ].join("\n");
  }

  synthesisBrief(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return [
        "Synthesis brief:",
        "",
        `Request: ${input}`,
        "",
        "No synthesis brief could be created because FRIDAY could not route this request yet.",
      ].join("\n");
    }

    const brief = createRunManifest(plan).synthesisBrief;

    return [
      "Synthesis brief:",
      "",
      `Request: ${input}`,
      `Mode: ${brief.responseMode}`,
      `Voice: ${brief.voice}`,
      "",
      "Include:",
      ...brief.include.map((item) => `- ${item}`),
      "",
      "Avoid:",
      ...brief.avoid.map((item) => `- ${item}`),
      "",
      "Honesty rules:",
      ...brief.honestyRules.map((item) => `- ${item}`),
    ].join("\n");
  }

  executionTimeline(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return [
        "Execution timeline:",
        "",
        `Request: ${input}`,
        "",
        "No specialist timeline could be created yet.",
      ].join("\n");
    }

    return [
      "Execution timeline:",
      "",
      `Request: ${input}`,
      "",
      "Ordered steps:",
      ...plan.executionSteps.map((step, index) => formatExecutionStep(index, step)),
      "",
      "Readiness:",
      ...formatExecutionReadiness(plan),
      "",
      "Executor rule:",
      "Run context before action, action before memory, and memory before final synthesis. Planned-only steps become constraints, not fake actions.",
    ].join("\n");
  }

  executionReadiness(input: string): string {
    const plan = this.createPlan(input);
    const command = parseToolCommand(input);
    const toolId = command ? getToolIdForCommand(command) : null;
    const decision = toolId ? this.permissionBrain.decide(toolId, input) : null;

    if (!plan) {
      return [
        "Execution readiness:",
        "",
        `Request: ${input}`,
        "Decision: ask for clarification",
        "",
        "Reason:",
        "FRIDAY could not route this to a specialist team yet.",
      ].join("\n");
    }

    const readinessDecision = getReadinessDecision(plan);
    const runnableSteps = plan.executionSteps.filter((step) => step.canRunNow);
    const blockedSteps = plan.executionSteps.filter((step) => !step.canRunNow);

    return [
      "Execution readiness:",
      "",
      `Request: ${input}`,
      `Decision: ${readinessDecision}`,
      "",
      "Direct command gate:",
      `Command: ${command ? command.type : "none detected"}`,
      `Tool: ${toolId ?? "none"}`,
      `Permission: ${decision ? decision.status : "not evaluated"}`,
      decision ? `Reason: ${decision.reason}` : "Reason: No executable command was selected.",
      "",
      "Runnable now:",
      ...(runnableSteps.length > 0
        ? runnableSteps.map((step) => `- ${step.agentName}: ${step.expectedDeliverable}`)
        : ["- None"]),
      "",
      "Blocked:",
      ...(blockedSteps.length > 0
        ? blockedSteps.map((step) => `- ${step.agentName}: ${step.blockers.join(" | ")}`)
        : ["- None"]),
      "",
      "Rule:",
      readinessDecision === "ready"
        ? "FRIDAY may proceed through the normal permission flow if the user submitted an executable command."
        : readinessDecision === "partially ready"
          ? "FRIDAY may run only safe ready steps, then explain blocked steps instead of pretending they worked."
          : "FRIDAY should not execute this yet. It should ask, plan, or wait for missing capability.",
    ].join("\n");
  }

  stepPlan(input: string): string {
    const routes = this.routeMany(input);
    const command = parseToolCommand(input);
    const clarificationReasons = findClarificationReasons(input);
    const needsClarification =
      clarificationReasons.length > 0 || (!command && routes.length === 0);
    const toolId = command ? getToolIdForCommand(command) : null;
    const decision = toolId ? this.permissionBrain.decide(toolId, input) : null;
    const primaryAgent = routes[0]?.agent.name ?? "Tool Router";
    const steps = [
      `1. Interpret the request with ${primaryAgent}.`,
      needsClarification
        ? `2. Ask clarification: ${this.suggestClarifyingQuestion(input, command !== null)}`
        : "2. Clarification gate passed.",
      toolId
        ? `3. Prepare tool ${toolId}.`
        : "3. No executable tool selected yet; continue as planning/advice.",
      decision
        ? `4. Permission gate: ${decision.status} (${decision.reason})`
        : "4. Permission gate not evaluated.",
      decision?.status === "allowed"
        ? "5. Execute only if the user submits the command normally."
        : "5. Do not execute; ask, plan, or offer a safer alternative.",
    ];

    return [
      "Step plan:",
      "",
      `Request: ${input}`,
      "",
      "Agent owners:",
      ...(routes.length > 0
        ? routes.map((route, index) => `${index + 1}. ${route.agent.name} (${route.agent.layer})`)
        : ["No matching specialist yet."]),
      "",
      "Steps:",
      ...steps,
    ].join("\n");
  }

  confidenceEstimate(input: string): string {
    const routes = this.routeMany(input);
    const command = parseToolCommand(input);
    const clarificationReasons = findClarificationReasons(input);
    const toolId = command ? getToolIdForCommand(command) : null;
    const decision = toolId ? this.permissionBrain.decide(toolId, input) : null;
    let score = 35;
    const signals: string[] = [];

    if (routes.length > 0) {
      score += 20;
      signals.push("Request maps to known agents.");
    } else {
      score -= 15;
      signals.push("No specialist matched the request.");
    }

    if (routes.some((route) => route.agent.status === "available")) {
      score += 15;
      signals.push("At least one matching agent is online.");
    }

    if (command) {
      score += 20;
      signals.push(`Supported command detected: ${command.type}.`);
    } else {
      score -= 15;
      signals.push("No directly executable command was detected.");
    }

    if (clarificationReasons.length === 0) {
      score += 15;
      signals.push("No clarification issues detected.");
    } else {
      score -= clarificationReasons.length * 10;
      signals.push(...clarificationReasons);
    }

    if (decision?.status === "allowed") {
      score += 10;
      signals.push("Permission brain would allow the selected tool.");
    } else if (decision) {
      score -= 10;
      signals.push(`Permission gate is ${decision.status}.`);
    }

    const confidence = clampConfidence(score);

    return [
      "Confidence estimate:",
      "",
      `Request: ${input}`,
      `Confidence: ${confidence}%`,
      `Tool: ${toolId ?? "none"}`,
      "",
      "Signals:",
      ...signals.map((signal) => `- ${signal}`),
      "",
      "Interpretation:",
      confidence >= 75
        ? "FRIDAY has enough structure to proceed through normal planning."
        : confidence >= 45
          ? "FRIDAY should proceed carefully and may need confirmation or clarification."
          : "FRIDAY should ask a clarifying question before attempting execution.",
    ].join("\n");
  }

  constraintExtraction(input: string): string {
    const constraints = extractConstraints(input);
    const command = parseToolCommand(input);
    const routes = this.routeMany(input);

    return [
      "Constraint extraction:",
      "",
      `Request: ${input}`,
      `Detected command: ${command ? command.type : "none"}`,
      "",
      "Extracted constraints:",
      ...(constraints.length > 0
        ? constraints.map((constraint) => `- ${constraint}`)
        : ["- No explicit constraints detected."]),
      "",
      "Likely owners:",
      ...(routes.length > 0
        ? routes.slice(0, 3).map((route) => `- ${route.agent.name}`)
        : ["- Tool Router"]),
    ].join("\n");
  }

  codingStatus(): string {
    const codingAgent = listAgents().find((agent) => agent.id === "coding.coding");

    if (!codingAgent) {
      return "Coding Agent is not registered.";
    }

    const tools = codingAgent.toolIds
      .map((toolId) => getToolById(toolId))
      .filter((tool) => tool !== undefined)
      .map((tool) => `- ${tool.id}: ${tool.description} (${describePermission(tool)})`);

    return [
      "Coding Agent status:",
      "",
      `Runtime: ${codingAgent.status}`,
      `Risk: ${codingAgent.riskLevel}`,
      "",
      "Current scope:",
      ...codingAgent.responsibilities.map((item) => `- ${item}`),
      "",
      "Available tools:",
      ...(tools.length > 0 ? tools : ["- No direct tools yet."]),
      "",
      "Boundary:",
      "FRIDAY can inspect, search, read, summarize, and plan coding work. Direct code modification remains behind the existing file write/edit permission flow.",
    ].join("\n");
  }

  visionStatus(): string {
    const visionAgent = listAgents().find((agent) => agent.id === "vision.screen-understanding");

    if (!visionAgent) {
      return "Vision Agent is not registered.";
    }

    const tools = visionAgent.toolIds
      .map((toolId) => getToolById(toolId))
      .filter((tool) => tool !== undefined)
      .map((tool) => `- ${tool.id}: ${tool.description} (${describePermission(tool)})`);

    return [
      "Vision Agent status:",
      "",
      `Runtime: ${visionAgent.status}`,
      `Risk: ${visionAgent.riskLevel}`,
      "",
      "Current scope:",
      ...visionAgent.responsibilities.map((item) => `- ${item}`),
      "",
      "Available tools:",
      ...(tools.length > 0 ? tools : ["- No direct tools yet."]),
      "",
      "Boundary:",
      "FRIDAY can capture the visible screen as visual context. OCR, PDF understanding, image reasoning, and live screen awareness are still future upgrades.",
    ].join("\n");
  }

  personalityStatus(): string {
    const personalityAgent = listAgents().find((agent) => agent.id === "personality.engine");

    if (!personalityAgent) {
      return "Personality Engine is not registered.";
    }

    return [
      "Personality Engine status:",
      "",
      `Runtime: ${personalityAgent.status}`,
      `Risk: ${personalityAgent.riskLevel}`,
      "",
      "Current scope:",
      ...personalityAgent.responsibilities.map((item) => `- ${item}`),
      "",
      "Available tools:",
      "- Internal synthesis only; no external tools required.",
      "",
      "Boundary:",
      "FRIDAY can shape tone and final-response presence. Emotion detection, wellness coaching, relationship memory, and persistent personality learning are still future upgrades.",
    ].join("\n");
  }

  workflowStatus(): string {
    const workflowAgent = listAgents().find((agent) => agent.id === "autonomous.workflow");

    if (!workflowAgent) {
      return "Workflow Agent is not registered.";
    }

    return [
      "Workflow Agent status:",
      "",
      `Runtime: ${workflowAgent.status}`,
      `Risk: ${workflowAgent.riskLevel}`,
      "",
      "Current scope:",
      ...workflowAgent.responsibilities.map((item) => `- ${item}`),
      "",
      "Available tools:",
      "- Internal blueprint planning only; no background automation tools are enabled.",
      "",
      "Boundary:",
      "FRIDAY can design repeatable routines and safety boundaries. Scheduling, background monitoring, triggers, and autonomous execution are still future upgrades.",
    ].join("\n");
  }

  workflowBlueprint(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return [
        "Workflow blueprint:",
        "",
        `Request: ${input}`,
        "",
        "I need a clearer repeatable task before I can design a workflow.",
      ].join("\n");
    }

    const packet = createOrchestrationPacket(plan);
    const dryRun = createDryRun(packet);
    const recoveryPlan = createRecoveryPlan(dryRun);

    return [
      "Workflow blueprint:",
      "",
      `Goal: ${input}`,
      "",
      "Trigger:",
      "- Manual command for now. Background triggers are not enabled yet.",
      "",
      "Routine shape:",
      ...plan.executionSteps.map((step, index) =>
        `${index + 1}. ${step.phase}: ${step.agentName} prepares ${step.expectedDeliverable}`,
      ),
      "",
      "Safety gates:",
      "- Do not run background actions automatically.",
      "- Use confirmation for desktop, browser, file, notification, or system-changing tools.",
      "- Report blocked steps honestly.",
      "",
      "Readiness:",
      recoveryPlan.summary,
      "",
      "Boundary:",
      "This is a reusable plan, not an active automation.",
    ].join("\n");
  }

  voiceStatus(): string {
    const voiceAgent = listAgents().find((agent) => agent.id === "communication.voice");

    if (!voiceAgent) {
      return "Voice Agent is not registered.";
    }

    const tools = voiceAgent.toolIds
      .map((toolId) => getToolById(toolId))
      .filter((tool) => tool !== undefined)
      .map((tool) => `- ${tool.id}: ${tool.description} (${describePermission(tool)})`);

    return [
      "Voice Agent status:",
      "",
      `Runtime: ${voiceAgent.status}`,
      `Risk: ${voiceAgent.riskLevel}`,
      "",
      "Current scope:",
      ...voiceAgent.responsibilities.map((item) => `- ${item}`),
      "",
      "Available tools:",
      ...(tools.length > 0 ? tools : ["- No direct tools yet."]),
      "",
      "Boundary:",
      "FRIDAY can speak short text aloud and transcribe short microphone clips locally with Whisper when the local model is installed. Cloud speech-to-text keys are optional fallback only. Wake word, interruption, deeper voice activity detection, and streaming speech are still future upgrades.",
    ].join("\n");
  }

  explainRoute(input: string): string {
    const plan = this.createPlan(input);

    if (!plan) {
      return "I could not route that to specific agents yet. The Master Brain will handle it as a general request.";
    }

    return [
      "Master Brain action plan:",
      "",
      `Intent: ${plan.userIntent}`,
      "",
      "Selected specialists:",
      ...plan.selectedAgents.map((workItem, index) => formatWorkItem(index, workItem)),
      "",
      "Execution rule:",
      "FRIDAY should use available safe tools directly, ask before confirm-level actions, and treat planned agents as future capability only.",
    ].join("\n");
  }

  private suggestClarifyingQuestion(input: string, hasCommand: boolean): string {
    if (/\b(open|launch|quit|close|focus)\b/i.test(input)) {
      return "Which app or window should FRIDAY target?";
    }

    if (/\b(delete|remove|trash|move|copy|rename|create|write|append)\b/i.test(input)) {
      return "Which exact file, folder, note, or item should FRIDAY use?";
    }

    if (/\b(search|find|read|summarize|analyze)\b/i.test(input)) {
      return "What topic or source should FRIDAY use?";
    }

    if (hasCommand) {
      return "Confirm the missing target or constraint before execution.";
    }

    return "What outcome do you want FRIDAY to produce?";
  }
}
