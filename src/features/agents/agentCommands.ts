import type { AgentService } from "./agentService";

function parseRouteInput(input: string): string | null {
  const match = input.match(/^(?:which agent|route agent|route this|show plan for|action plan for|how would you handle)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseCapabilityLookupInput(input: string): string | null {
  const match = input.match(/^(?:capability\s+lookup|check\s+capability|debug\s+capability|inspect\s+capability)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function resolveNaturalCapabilityQuestion(input: string): string | null {
  if (
    /\b(?:can|could|do|will|are)\s+(?:you|friday)\b.*\b(?:listen|hear|understand)\b.*\b(?:me|my\s+voice|voice|mic|microphone)\b/i.test(input)
    || /\b(?:listen|hear|understand)\b.*\b(?:me|my\s+voice|voice|mic|microphone)\b/i.test(input)
  ) {
    return "Yes. The microphone is the default input now, and FRIDAY uses local Whisper first so it does not need paid speech-to-text quota.";
  }

  return null;
}

function parseIntentClassificationInput(input: string): string | null {
  const match = input.match(/^(?:classify|inspect|analyze)\s+(?:intent|request)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseRiskAssessmentInput(input: string): string | null {
  const match = input.match(/^(?:assess|check|analyze)\s+(?:risk|safety)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseExecutionPreviewInput(input: string): string | null {
  const match = input.match(/^(?:preview|dry\s+run|simulate)\s+(?:execution|command|action)?\s*(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseClarificationCheckInput(input: string): string | null {
  const match = input.match(/^(?:clarification\s+check|check\s+clarification|does\s+this\s+need\s+clarification|should\s+you\s+ask\s+first)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseDecisionPipelineInput(input: string): string | null {
  const match = input.match(/^(?:decision\s+pipeline|run\s+decision\s+pipeline|think\s+before\s+acting|preflight)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseDelegationPlanInput(input: string): string | null {
  const match = input.match(/^(?:delegation\s+plan|delegate|team\s+plan|agent\s+team|how\s+would\s+friday\s+delegate)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseExecutionTimelineInput(input: string): string | null {
  const match = input.match(/^(?:execution\s+timeline|run\s+timeline|agent\s+timeline|orchestration\s+timeline)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseExecutionReadinessInput(input: string): string | null {
  const match = input.match(/^(?:execution\s+readiness|readiness\s+check|go\s+no-go|can\s+friday\s+run|can\s+you\s+run)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseRunManifestInput(input: string): string | null {
  const match = input.match(/^(?:run\s+manifest|execution\s+manifest|agent\s+manifest|manifest)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseOrchestrationPacketInput(input: string): string | null {
  const match = input.match(/^(?:orchestration\s+packet|executor\s+packet|master\s+brain\s+packet)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseDryRunOrchestrationInput(input: string): string | null {
  const match = input.match(/^(?:dry\s+run\s+orchestration|simulate\s+orchestration|rehearse\s+orchestration|dry\s+run\s+agents)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseOrchestrationLedgerInput(input: string): string | null {
  const match = input.match(/^(?:orchestration\s+ledger|agent\s+ledger|execution\s+ledger|dry\s+run\s+ledger)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseOrchestrationRecoveryInput(input: string): string | null {
  const match = input.match(/^(?:orchestration\s+recovery|agent\s+recovery|recovery\s+plan|self\s+correction\s+plan)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseFinalAnswerPreviewInput(input: string): string | null {
  const match = input.match(/^(?:final\s+answer\s+preview|response\s+preview|preview\s+final\s+answer|friday\s+response\s+preview)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseOrchestrationReportInput(input: string): string | null {
  const match = input.match(/^(?:orchestration\s+report|master\s+brain\s+report|full\s+orchestration|full\s+agent\s+report)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseMasterBrainResponseInput(input: string): string | null {
  const match = input.match(/^(?:friday\s+handle|master\s+brain|coordinate|handle\s+with\s+agents)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseWorkflowBlueprintInput(input: string): string | null {
  const match = input.match(/^(?:workflow\s+blueprint|routine\s+blueprint|design\s+workflow|build\s+routine)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseResultEnvelopeInput(input: string): string | null {
  const match = input.match(/^(?:result\s+envelopes?|agent\s+results?|result\s+contracts?)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseSynthesisBriefInput(input: string): string | null {
  const match = input.match(/^(?:synthesis\s+brief|final\s+response\s+brief|response\s+brief)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseStepPlanInput(input: string): string | null {
  const match = input.match(/^(?:step\s+plan|make\s+a\s+plan|plan\s+steps|planner)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseConfidenceEstimateInput(input: string): string | null {
  const match = input.match(/^(?:confidence|confidence\s+estimate|estimate\s+confidence|how\s+confident\s+are\s+you)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parseConstraintExtractionInput(input: string): string | null {
  const match = input.match(/^(?:extract\s+constraints|constraint\s+extraction|constraints|pull\s+constraints)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export function resolveAgentCommand(
  input: string,
  agentService: AgentService,
): string | null {
  const naturalCapabilityResponse = resolveNaturalCapabilityQuestion(input);
  if (naturalCapabilityResponse) {
    return naturalCapabilityResponse;
  }

  if (/^(show|list|view)\s+agents$/i.test(input)) {
    return agentService.listAgents();
  }

  if (/^(?:orchestration|master\s+brain|agent)\s+commands$/i.test(input)) {
    return agentService.orchestrationCommands();
  }

  if (/^(?:orchestration|master\s+brain)\s+(?:health|status)$/i.test(input)) {
    return agentService.orchestrationHealth();
  }

  if (/^(?:coding|code)\s+(?:agent\s+)?status$/i.test(input)) {
    return agentService.codingStatus();
  }

  if (/^(?:vision|screen\s+understanding|screen)\s+(?:agent\s+)?status$/i.test(input)) {
    return agentService.visionStatus();
  }

  if (/^(?:personality|presence|tone)\s+(?:engine\s+|agent\s+)?status$/i.test(input)) {
    return agentService.personalityStatus();
  }

  if (/^(?:workflow|routine|automation)\s+(?:agent\s+)?status$/i.test(input)) {
    return agentService.workflowStatus();
  }

  if (/^(?:voice|speech|tts)\s+(?:agent\s+)?status$/i.test(input)) {
    return agentService.voiceStatus();
  }

  if (
    /\b(?:capability|agent|brain)\s+(?:matrix|map|status|overview)\b/i.test(input)
    || /\bwhat\s+agents\s+are\s+online\b/i.test(input)
    || /\bwhat\s+can\s+friday\s+do\s+now\b/i.test(input)
  ) {
    return agentService.capabilityMatrix();
  }

  const capabilityInput = parseCapabilityLookupInput(input);
  if (capabilityInput) {
    return agentService.capabilityLookup(capabilityInput);
  }

  const intentInput = parseIntentClassificationInput(input);
  if (intentInput) {
    return agentService.classifyRequest(intentInput);
  }

  if (/^what\s+kind\s+of\s+request\s+is\s+this\??$/i.test(input)) {
    return "Ask with the request included, like: classify intent open Safari and remind me in 10 minutes";
  }

  const riskInput = parseRiskAssessmentInput(input);
  if (riskInput) {
    return agentService.assessRisk(riskInput);
  }

  if (/^(?:is\s+this\s+safe|does\s+this\s+need\s+confirmation)\??$/i.test(input)) {
    return "Ask with the request included, like: assess risk move this file to Documents";
  }

  const previewInput = parseExecutionPreviewInput(input);
  if (previewInput) {
    return agentService.previewExecution(previewInput);
  }

  const clarificationInput = parseClarificationCheckInput(input);
  if (clarificationInput) {
    return agentService.clarificationCheck(clarificationInput);
  }

  const decisionInput = parseDecisionPipelineInput(input);
  if (decisionInput) {
    return agentService.decisionPipeline(decisionInput);
  }

  const delegationInput = parseDelegationPlanInput(input);
  if (delegationInput) {
    return agentService.delegationPlan(delegationInput);
  }

  const timelineInput = parseExecutionTimelineInput(input);
  if (timelineInput) {
    return agentService.executionTimeline(timelineInput);
  }

  const readinessInput = parseExecutionReadinessInput(input);
  if (readinessInput) {
    return agentService.executionReadiness(readinessInput);
  }

  const manifestInput = parseRunManifestInput(input);
  if (manifestInput) {
    return agentService.runManifest(manifestInput);
  }

  const orchestrationPacketInput = parseOrchestrationPacketInput(input);
  if (orchestrationPacketInput) {
    return agentService.orchestrationPacket(orchestrationPacketInput);
  }

  const dryRunOrchestrationInput = parseDryRunOrchestrationInput(input);
  if (dryRunOrchestrationInput) {
    return agentService.dryRunOrchestration(dryRunOrchestrationInput);
  }

  const orchestrationLedgerInput = parseOrchestrationLedgerInput(input);
  if (orchestrationLedgerInput) {
    return agentService.orchestrationLedger(orchestrationLedgerInput);
  }

  const orchestrationRecoveryInput = parseOrchestrationRecoveryInput(input);
  if (orchestrationRecoveryInput) {
    return agentService.orchestrationRecovery(orchestrationRecoveryInput);
  }

  const finalAnswerPreviewInput = parseFinalAnswerPreviewInput(input);
  if (finalAnswerPreviewInput) {
    return agentService.finalAnswerPreview(finalAnswerPreviewInput);
  }

  const orchestrationReportInput = parseOrchestrationReportInput(input);
  if (orchestrationReportInput) {
    return agentService.orchestrationReport(orchestrationReportInput);
  }

  const masterBrainResponseInput = parseMasterBrainResponseInput(input);
  if (masterBrainResponseInput) {
    return agentService.masterBrainResponse(masterBrainResponseInput);
  }

  const workflowBlueprintInput = parseWorkflowBlueprintInput(input);
  if (workflowBlueprintInput) {
    return agentService.workflowBlueprint(workflowBlueprintInput);
  }

  const resultEnvelopeInput = parseResultEnvelopeInput(input);
  if (resultEnvelopeInput) {
    return agentService.resultEnvelopes(resultEnvelopeInput);
  }

  const synthesisBriefInput = parseSynthesisBriefInput(input);
  if (synthesisBriefInput) {
    return agentService.synthesisBrief(synthesisBriefInput);
  }

  const stepPlanInput = parseStepPlanInput(input);
  if (stepPlanInput) {
    return agentService.stepPlan(stepPlanInput);
  }

  const confidenceInput = parseConfidenceEstimateInput(input);
  if (confidenceInput) {
    return agentService.confidenceEstimate(confidenceInput);
  }

  const constraintInput = parseConstraintExtractionInput(input);
  if (constraintInput) {
    return agentService.constraintExtraction(constraintInput);
  }

  const routeInput = parseRouteInput(input);
  if (routeInput) {
    return agentService.explainRoute(routeInput);
  }

  if (/^(?:which agent would handle this|show me the action plan)\??$/i.test(input)) {
    return "Ask with the request included, like: show plan for open Safari and summarize my tasks";
  }

  return null;
}
