export type AgentLayer =
  | "operating-system"
  | "internet"
  | "communication"
  | "vision"
  | "memory"
  | "productivity"
  | "coding"
  | "autonomous"
  | "security"
  | "analytics"
  | "creative"
  | "personality"
  | "system-intelligence";

export type AgentStatus = "available" | "planned";

export type AgentRiskLevel = "safe" | "confirm" | "dangerous";

export interface AgentDefinition {
  id: string;
  name: string;
  layer: AgentLayer;
  description: string;
  responsibilities: string[];
  toolIds: string[];
  status: AgentStatus;
  riskLevel: AgentRiskLevel;
}

export interface AgentRoute {
  agent: AgentDefinition;
  score: number;
  reason: string;
}

export type AgentWorkStatus = "ready" | "planned" | "blocked";

export interface AgentWorkItem {
  agent: AgentDefinition;
  status: AgentWorkStatus;
  phase: "context" | "action" | "memory" | "synthesis";
  objective: string;
  deliverable: string;
  dependsOn: string[];
  output: string;
  toolId?: string;
  ok?: boolean;
  permissionDecision?: ToolPermissionDecision;
}

export interface MasterBrainExecutionStep {
  id: string;
  phase: AgentWorkItem["phase"];
  agentId: string;
  agentName: string;
  toolIds: string[];
  instruction: string;
  expectedDeliverable: string;
  canRunNow: boolean;
  blockers: string[];
}

export interface AgentResultEnvelope {
  stepId: string;
  agentId: string;
  agentName: string;
  status: "pending" | "completed" | "skipped" | "blocked" | "failed";
  summary: string;
  evidence: string[];
  producedAt?: number;
}

export interface MasterBrainSynthesisBrief {
  responseMode: "execute-and-summarize" | "partial-execution" | "planning-only";
  audience: "user";
  voice: "friday";
  include: string[];
  avoid: string[];
  honestyRules: string[];
}

export interface MasterBrainRunManifest {
  planId: string;
  request: string;
  decision: "ready" | "partially-ready" | "not-ready" | "needs-clarification";
  runnableStepIds: string[];
  blockedStepIds: string[];
  skippedStepIds: string[];
  finalResponseMode: "execute-and-summarize" | "partial-execution" | "planning-only";
  expectedResults: AgentResultEnvelope[];
  synthesisBrief: MasterBrainSynthesisBrief;
  notes: string[];
}

export interface MasterBrainOrchestrationPacket {
  version: 1;
  createdAt: number;
  plan: MasterBrainPlan;
  manifest: MasterBrainRunManifest;
}

export interface MasterBrainDryRun {
  packetVersion: MasterBrainOrchestrationPacket["version"];
  planId: string;
  request: string;
  wouldRunStepIds: string[];
  wouldSkipStepIds: string[];
  simulatedResults: AgentResultEnvelope[];
  ledger: MasterBrainLedgerEntry[];
  finalResponseMode: MasterBrainRunManifest["finalResponseMode"];
  summary: string;
}

export interface MasterBrainLedgerEntry {
  id: string;
  stepId: string;
  agentId: string;
  agentName: string;
  event: "would-run" | "would-skip" | "blocked" | "simulated-result";
  message: string;
  createdAt: number;
}

export interface MasterBrainRecoveryAction {
  stepId: string;
  agentName: string;
  action: "continue" | "ask-user" | "wait-for-capability" | "skip-and-summarize";
  reason: string;
}

export interface MasterBrainRecoveryPlan {
  planId: string;
  request: string;
  status: "clear" | "recoverable" | "blocked";
  actions: MasterBrainRecoveryAction[];
  summary: string;
}

export interface MasterBrainFinalPreview {
  planId: string;
  request: string;
  responseMode: MasterBrainRunManifest["finalResponseMode"];
  message: string;
  includedResultCount: number;
  blockedResultCount: number;
}

export interface MasterBrainPlan {
  id: string;
  userIntent: string;
  selectedAgents: AgentWorkItem[];
  executionSteps: MasterBrainExecutionStep[];
  synthesisInstructions: string;
  createdAt: number;
}

export interface MasterBrainExecution {
  plan: MasterBrainPlan;
  handled: boolean;
  output: string;
  requiresSynthesis: boolean;
}

export type ToolPermissionDecisionStatus =
  | "allowed"
  | "explicit-intent-required"
  | "blocked"
  | "unavailable";

export interface ToolPermissionDecision {
  toolId: string;
  status: ToolPermissionDecisionStatus;
  permissionLevel: "safe" | "confirm" | "dangerous";
  reason: string;
}
