import { getAgentById } from "./agentRegistry";
import { routeAgents } from "./agentRouter";
import {
  parseToolCommand,
  type ToolCommand,
} from "../tools/toolCommands";
import { PermissionBrain } from "../tools/permissionBrain";
import type { ToolService } from "../tools/toolService";
import type { ToolExecutionResult } from "../tools/types";
import type {
  AgentRoute,
  AgentWorkItem,
  AgentLayer,
  MasterBrainExecutionStep,
  MasterBrainExecution,
  MasterBrainPlan,
  ToolPermissionDecision,
} from "./types";

function createPlanId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `plan_${crypto.randomUUID()}`;
  }

  return `plan_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function inferObjective(route: AgentRoute, input: string): string {
  const firstResponsibility = route.agent.responsibilities[0];

  if (!firstResponsibility) {
    return `Evaluate how ${route.agent.name} should support the request: ${input}`;
  }

  return `${firstResponsibility} for the request: ${input}`;
}

function inferPhase(layer: AgentLayer): AgentWorkItem["phase"] {
  if (
    layer === "internet"
    || layer === "vision"
    || layer === "coding"
    || layer === "analytics"
    || layer === "system-intelligence"
    || layer === "security"
  ) {
    return "context";
  }

  if (layer === "memory") {
    return "memory";
  }

  if (layer === "personality") {
    return "synthesis";
  }

  return "action";
}

function inferDeliverable(route: AgentRoute): string {
  const layer = route.agent.layer;

  if (layer === "internet") {
    return "Relevant web findings, source context, or browser state.";
  }

  if (layer === "vision") {
    return "Captured visual context or a clear boundary if deeper vision is not available.";
  }

  if (layer === "coding") {
    return "Codebase context, file references, risks, or implementation guidance.";
  }

  if (layer === "memory") {
    return "Relevant remembered facts, preferences, or memory update recommendations.";
  }

  if (layer === "productivity") {
    return "Calendar, reminder, to-do, note, or daily planning outcome.";
  }

  if (layer === "operating-system") {
    return "Desktop, file, app, window, clipboard, or device operation result.";
  }

  if (layer === "security") {
    return "Permission boundary, risk assessment, or safety decision.";
  }

  if (layer === "system-intelligence") {
    return "Routing, diagnostics, model/tool choice, or recovery guidance.";
  }

  if (layer === "personality") {
    return "Tone, emotional framing, and user-facing final response guidance.";
  }

  if (layer === "autonomous") {
    return "Repeatable workflow, trigger, or automation plan.";
  }

  return "Specialist context for the Master Brain.";
}

function inferDependencies(phase: AgentWorkItem["phase"]): string[] {
  if (phase === "action") {
    return ["context", "security"];
  }

  if (phase === "memory") {
    return ["context", "action"];
  }

  if (phase === "synthesis") {
    return ["context", "action", "memory"];
  }

  return [];
}

function createWorkItem(route: AgentRoute, input: string): AgentWorkItem {
  const tools =
    route.agent.toolIds.length > 0 ? route.agent.toolIds.join(", ") : "none";
  const phase = inferPhase(route.agent.layer);
  const deliverable = inferDeliverable(route);
  const dependsOn = inferDependencies(phase);

  if (route.agent.status === "planned") {
    return {
      agent: route.agent,
      status: "planned",
      phase,
      objective: inferObjective(route, input),
      deliverable,
      dependsOn,
      output: `${route.agent.name} is relevant, but its runtime is not implemented yet. Treat it as future capability and do not claim it acted.`,
    };
  }

  return {
    agent: route.agent,
    status: "ready",
    phase,
    objective: inferObjective(route, input),
    deliverable,
    dependsOn,
    output: `${route.agent.name} is ready to contribute using available tools: ${tools}. It has not executed a tool unless the user used an explicit supported command.`,
  };
}

function createPersonalityRoute(input: string): AgentRoute | null {
  const personalityAgent = getAgentById("personality.engine");

  if (!personalityAgent) return null;

  return {
    agent: personalityAgent,
    score: 1,
    reason: `Personality Engine keeps the final FRIDAY response natural for: ${input}`,
  };
}

function includePersonalityRoute(routes: AgentRoute[], input: string): AgentRoute[] {
  if (routes.some((route) => route.agent.id === "personality.engine")) {
    return routes;
  }

  const personalityRoute = createPersonalityRoute(input);
  if (!personalityRoute) return routes;

  return [...routes, personalityRoute];
}

const EXECUTION_PHASE_ORDER: AgentWorkItem["phase"][] = [
  "context",
  "action",
  "memory",
  "synthesis",
];

function phaseRank(phase: AgentWorkItem["phase"]): number {
  return EXECUTION_PHASE_ORDER.indexOf(phase);
}

function createExecutionSteps(
  workItems: AgentWorkItem[],
  input: string,
  permissionBrain: PermissionBrain,
): MasterBrainExecutionStep[] {
  return [...workItems]
    .sort((first, second) => phaseRank(first.phase) - phaseRank(second.phase))
    .map((workItem, index) => {
      const permissionDecisions = workItem.agent.toolIds.map((toolId) =>
        permissionBrain.decide(toolId, input),
      );
      const blockers = [
        ...(workItem.agent.status === "planned"
          ? [`${workItem.agent.name} is planned, not executable yet.`]
          : []),
        ...(workItem.agent.toolIds.length === 0
          && workItem.phase !== "synthesis"
          && workItem.agent.id !== "autonomous.workflow"
          ? ["No direct tools are attached to this agent yet."]
          : []),
        ...permissionDecisions
          .filter((decision) => decision.status !== "allowed")
          .map((decision) => `${decision.toolId}: ${decision.reason}`),
      ];

      return {
        id: `step_${index + 1}_${workItem.agent.id.replace(/[^a-z0-9]+/gi, "_")}`,
        phase: workItem.phase,
        agentId: workItem.agent.id,
        agentName: workItem.agent.name,
        toolIds: workItem.agent.toolIds,
        instruction: workItem.objective,
        expectedDeliverable: workItem.deliverable,
        canRunNow: blockers.length === 0,
        blockers,
      };
    });
}

export function getToolIdForCommand(command: ToolCommand): string {
  if (command.type === "deviceOverview") return "system.overview";
  if (command.type === "selfDiagnostics") return "system.self_diagnostics";
  if (command.type === "activityLog") return "system.activity_log";
  if (command.type === "failureReview") return "system.failure_review";
  if (command.type === "retryPlan") return "system.retry_plan";
  if (command.type === "aiProviderStatus") return "ai.provider_status";
  if (command.type === "permissionAudit") return "security.permission_audit";
  if (command.type === "systemStatus") return "system.status";
  if (command.type === "networkStatus") return "network.status";
  if (command.type === "storageStatus") return "storage.status";
  if (command.type === "activeWindow") return "windows.active";
  if (command.type === "listWindows") return "windows.list";
  if (command.type === "listProcesses") return "process.list";
  if (command.type === "listApplications") return "apps.list";
  if (command.type === "openApp") return "apps.open";
  if (command.type === "focusApp") return "windows.focus_app";
  if (command.type === "quitApp") return "apps.quit";
  if (command.type === "createFolder") return "files.create_folder";
  if (command.type === "createTextFile") return "files.create_text_file";
  if (command.type === "appendTextFile") return "files.append_text_file";
  if (command.type === "renamePath") return "files.rename";
  if (command.type === "movePath") return "files.move";
  if (command.type === "copyPath") return "files.copy";
  if (command.type === "trashPath") return "files.trash";
  if (command.type === "listFolder") return "files.list";
  if (command.type === "folderTree") return "files.tree";
  if (command.type === "folderSummary") return "files.summary";
  if (command.type === "searchFiles") return "files.search";
  if (command.type === "searchText") return "files.search_text";
  if (command.type === "pathInfo") return "files.info";
  if (command.type === "revealPath") return "files.reveal";
  if (command.type === "openPath") return "files.open";
  if (command.type === "readTextFile") return "files.read";
  if (command.type === "summarizeTextFile") return "files.read";
  if (command.type === "readClipboard") return "clipboard.read";
  if (command.type === "writeClipboard") return "clipboard.write";
  if (command.type === "sendNotification") return "notifications.send";
  if (command.type === "dailyBriefing") return "productivity.briefing";
  if (command.type === "productivityOverview") return "productivity.overview";
  if (command.type === "searchProductivity") return "productivity.search";
  if (command.type === "createReminder") return "productivity.reminder.create";
  if (command.type === "listReminders") return "productivity.reminder.list";
  if (command.type === "cancelReminder") return "productivity.reminder.cancel";
  if (command.type === "addTodo") return "productivity.todo.add";
  if (command.type === "listTodos") return "productivity.todo.list";
  if (command.type === "completeTodo") return "productivity.todo.complete";
  if (command.type === "addNote") return "productivity.note.add";
  if (command.type === "listNotes") return "productivity.note.list";
  if (command.type === "readNote") return "productivity.note.read";
  if (command.type === "deleteNote") return "productivity.note.delete";
  if (command.type === "captureScreen") return "screen.capture";
  if (command.type === "speakText") return "voice.speak";
  if (command.type === "openWebsite") return "browser.open";
  if (command.type === "searchWeb") return "browser.search";
  if (command.type === "readWebpage") return "browser.read";
  if (command.type === "researchWeb") return "browser.research";
  if (command.type === "deepResearchWeb") return "browser.deep_research";
  if (command.type === "execute") return command.toolId;

  return "system.tool_registry";
}

function applyExecutionToPlan(
  plan: MasterBrainPlan,
  result: ToolExecutionResult,
  permissionDecision: ToolPermissionDecision,
): MasterBrainPlan {
  const selectedAgents = plan.selectedAgents.map((workItem, index) => {
    if (index !== 0) return workItem;

    return {
      ...workItem,
      toolId: result.toolId,
      ok: result.ok,
      permissionDecision,
      output: result.ok
        ? `Executed ${result.toolId}. Result: ${result.message}`
        : `Tried ${result.toolId}. Result: ${result.message}`,
    };
  });

  return {
    ...plan,
    selectedAgents,
  };
}

function shouldSynthesize(command: ToolCommand, result: ToolExecutionResult): boolean {
  if (!result.ok) return false;

  return (
    command.type === "researchWeb"
    || command.type === "deepResearchWeb"
    || command.type === "readWebpage"
    || command.type === "summarizeTextFile"
  );
}

export class MasterBrain {
  private readonly permissionBrain = new PermissionBrain();

  plan(input: string): MasterBrainPlan | null {
    const routes = includePersonalityRoute(routeAgents(input, 6), input);

    if (routes.length === 0) {
      return null;
    }

    const selectedAgents = routes.map((route) => createWorkItem(route, input));

    return {
      id: createPlanId(),
      userIntent: input,
      selectedAgents,
      executionSteps: createExecutionSteps(selectedAgents, input, this.permissionBrain),
      synthesisInstructions: [
        "Act as the Master Brain.",
        "Delegate work to selected agents as internal specialists.",
        "Collect agent outputs before responding.",
        "Synthesize one final user-facing response.",
        "Speak as FRIDAY: natural, calm, direct, and present.",
        "Hide the agent system unless the user asks how you decided.",
        "Do not expose implementation details unless the user asks.",
        "Do not claim planned agents acted.",
        "Do not claim tools ran unless an available command actually executed.",
      ].join(" "),
      createdAt: Date.now(),
    };
  }

  async execute(
    input: string,
    toolService: ToolService,
  ): Promise<MasterBrainExecution | null> {
    const plan = this.plan(input);
    if (!plan) return null;

    const command = parseToolCommand(input);
    if (!command) {
      return {
        plan,
        handled: false,
        output: "No directly executable tool command was detected.",
        requiresSynthesis: false,
      };
    }

    const toolId = getToolIdForCommand(command);
    const permissionDecision = this.permissionBrain.decide(toolId, input);

    if (permissionDecision.status !== "allowed") {
      const blockedResult: ToolExecutionResult = {
        toolId,
        ok: false,
        requiresConfirmation:
          permissionDecision.status === "explicit-intent-required",
        message: permissionDecision.reason,
      };
      const blockedPlan = applyExecutionToPlan(
        plan,
        blockedResult,
        permissionDecision,
      );

      return {
        plan: blockedPlan,
        handled: true,
        output: this.synthesizeToolOutput(
          blockedPlan,
          command,
          blockedResult,
        ),
        requiresSynthesis: false,
      };
    }

    const result = await this.executeToolCommand(command, toolService);
    const executedPlan = applyExecutionToPlan(
      plan,
      result,
      permissionDecision,
    );

    return {
      plan: executedPlan,
      handled: true,
      output: this.synthesizeToolOutput(executedPlan, command, result),
      requiresSynthesis: shouldSynthesize(command, result),
    };
  }

  private async executeToolCommand(
    command: ToolCommand,
    toolService: ToolService,
  ): Promise<ToolExecutionResult> {
    if (command.type === "list") {
      return {
        toolId: getToolIdForCommand(command),
        ok: true,
        message: toolService.listTools(),
      };
    }

    if (command.type === "deviceOverview") {
      return toolService.executeConfirmed({
        toolId: "system.overview",
      });
    }

    if (command.type === "selfDiagnostics") {
      return toolService.executeConfirmed({
        toolId: "system.self_diagnostics",
      });
    }

    if (command.type === "activityLog") {
      return toolService.executeConfirmed({
        toolId: "system.activity_log",
      });
    }

    if (command.type === "failureReview") {
      return toolService.executeConfirmed({
        toolId: "system.failure_review",
      });
    }

    if (command.type === "retryPlan") {
      return toolService.executeConfirmed({
        toolId: "system.retry_plan",
      });
    }

    if (command.type === "aiProviderStatus") {
      return toolService.executeConfirmed({
        toolId: "ai.provider_status",
      });
    }

    if (command.type === "permissionAudit") {
      return toolService.executeConfirmed({
        toolId: "security.permission_audit",
      });
    }

    if (command.type === "systemStatus") {
      return toolService.executeConfirmed({
        toolId: "system.status",
      });
    }

    if (command.type === "networkStatus") {
      return toolService.executeConfirmed({
        toolId: "network.status",
      });
    }

    if (command.type === "storageStatus") {
      return toolService.executeConfirmed({
        toolId: "storage.status",
      });
    }

    if (command.type === "activeWindow") {
      return toolService.executeConfirmed({
        toolId: "windows.active",
      });
    }

    if (command.type === "listWindows") {
      return toolService.executeConfirmed({
        toolId: "windows.list",
      });
    }

    if (command.type === "listProcesses") {
      return toolService.executeConfirmed({
        toolId: "process.list",
      });
    }

    if (command.type === "listApplications") {
      return toolService.executeConfirmed({
        toolId: "apps.list",
      });
    }

    if (command.type === "openApp") {
      return toolService.executeConfirmed({
        toolId: "apps.open",
        input: { appName: command.appName },
      });
    }

    if (command.type === "focusApp") {
      return toolService.executeConfirmed({
        toolId: "windows.focus_app",
        input: { appName: command.appName },
      });
    }

    if (command.type === "quitApp") {
      return toolService.executeConfirmed({
        toolId: "apps.quit",
        input: { appName: command.appName },
      });
    }

    if (command.type === "createFolder") {
      return toolService.executeConfirmed({
        toolId: "files.create_folder",
        input: { path: command.path },
      });
    }

    if (command.type === "createTextFile") {
      return toolService.executeConfirmed({
        toolId: "files.create_text_file",
        input: {
          path: command.path,
          content: command.content,
        },
      });
    }

    if (command.type === "appendTextFile") {
      return toolService.executeConfirmed({
        toolId: "files.append_text_file",
        input: {
          path: command.path,
          content: command.content,
        },
      });
    }

    if (command.type === "renamePath") {
      return toolService.executeConfirmed({
        toolId: "files.rename",
        input: {
          path: command.path,
          newName: command.newName,
        },
      });
    }

    if (command.type === "movePath") {
      return toolService.executeConfirmed({
        toolId: "files.move",
        input: {
          path: command.path,
          destinationFolder: command.destinationFolder,
        },
      });
    }

    if (command.type === "copyPath") {
      return toolService.executeConfirmed({
        toolId: "files.copy",
        input: {
          path: command.path,
          destinationFolder: command.destinationFolder,
        },
      });
    }

    if (command.type === "trashPath") {
      return toolService.executeConfirmed({
        toolId: "files.trash",
        input: { path: command.path },
      });
    }

    if (command.type === "listFolder") {
      return toolService.executeConfirmed({
        toolId: "files.list",
        input: { path: command.path },
      });
    }

    if (command.type === "folderTree") {
      return toolService.executeConfirmed({
        toolId: "files.tree",
        input: { path: command.path },
      });
    }

    if (command.type === "folderSummary") {
      return toolService.executeConfirmed({
        toolId: "files.summary",
        input: { path: command.path },
      });
    }

    if (command.type === "searchFiles") {
      return toolService.executeConfirmed({
        toolId: "files.search",
        input: {
          path: command.path,
          query: command.query,
        },
      });
    }

    if (command.type === "searchText") {
      return toolService.executeConfirmed({
        toolId: "files.search_text",
        input: {
          path: command.path,
          query: command.query,
        },
      });
    }

    if (command.type === "pathInfo") {
      return toolService.executeConfirmed({
        toolId: "files.info",
        input: { path: command.path },
      });
    }

    if (command.type === "revealPath") {
      return toolService.executeConfirmed({
        toolId: "files.reveal",
        input: { path: command.path },
      });
    }

    if (command.type === "openPath") {
      return toolService.executeConfirmed({
        toolId: "files.open",
        input: { path: command.path },
      });
    }

    if (command.type === "readTextFile") {
      return toolService.executeConfirmed({
        toolId: "files.read",
        input: { path: command.path },
      });
    }

    if (command.type === "summarizeTextFile") {
      return toolService.executeConfirmed({
        toolId: "files.read",
        input: { path: command.path },
      });
    }

    if (command.type === "readClipboard") {
      return toolService.executeConfirmed({
        toolId: "clipboard.read",
      });
    }

    if (command.type === "writeClipboard") {
      return toolService.executeConfirmed({
        toolId: "clipboard.write",
        input: { text: command.text },
      });
    }

    if (command.type === "sendNotification") {
      return toolService.executeConfirmed({
        toolId: "notifications.send",
        input: {
          title: command.title,
          body: command.body,
        },
      });
    }

    if (command.type === "dailyBriefing") {
      return toolService.executeConfirmed({
        toolId: "productivity.briefing",
      });
    }

    if (command.type === "productivityOverview") {
      return toolService.executeConfirmed({
        toolId: "productivity.overview",
      });
    }

    if (command.type === "searchProductivity") {
      return toolService.executeConfirmed({
        toolId: "productivity.search",
        input: { query: command.query },
      });
    }

    if (command.type === "createReminder") {
      return toolService.executeConfirmed({
        toolId: "productivity.reminder.create",
        input: {
          text: command.text,
          delayMs: command.delayMs,
        },
      });
    }

    if (command.type === "listReminders") {
      return toolService.executeConfirmed({
        toolId: "productivity.reminder.list",
      });
    }

    if (command.type === "cancelReminder") {
      return toolService.executeConfirmed({
        toolId: "productivity.reminder.cancel",
        input: { reminderId: command.reminderId },
      });
    }

    if (command.type === "addTodo") {
      return toolService.executeConfirmed({
        toolId: "productivity.todo.add",
        input: { text: command.text },
      });
    }

    if (command.type === "listTodos") {
      return toolService.executeConfirmed({
        toolId: "productivity.todo.list",
      });
    }

    if (command.type === "completeTodo") {
      return toolService.executeConfirmed({
        toolId: "productivity.todo.complete",
        input: { todoId: command.todoId },
      });
    }

    if (command.type === "addNote") {
      return toolService.executeConfirmed({
        toolId: "productivity.note.add",
        input: { text: command.text },
      });
    }

    if (command.type === "listNotes") {
      return toolService.executeConfirmed({
        toolId: "productivity.note.list",
      });
    }

    if (command.type === "readNote") {
      return toolService.executeConfirmed({
        toolId: "productivity.note.read",
        input: { noteId: command.noteId },
      });
    }

    if (command.type === "deleteNote") {
      return toolService.executeConfirmed({
        toolId: "productivity.note.delete",
        input: { noteId: command.noteId },
      });
    }

    if (command.type === "captureScreen") {
      return toolService.executeConfirmed({
        toolId: "screen.capture",
      });
    }

    if (command.type === "speakText") {
      return toolService.executeConfirmed({
        toolId: "voice.speak",
        input: { text: command.text },
      });
    }

    if (command.type === "openWebsite") {
      return toolService.executeConfirmed({
        toolId: "browser.open",
        input: { target: command.target },
      });
    }

    if (command.type === "searchWeb") {
      return toolService.executeConfirmed({
        toolId: "browser.search",
        input: { query: command.query },
      });
    }

    if (command.type === "readWebpage") {
      return toolService.executeConfirmed({
        toolId: "browser.read",
        input: { target: command.target },
      });
    }

    if (command.type === "researchWeb") {
      return toolService.executeConfirmed({
        toolId: "browser.research",
        input: { query: command.query },
      });
    }

    if (command.type === "deepResearchWeb") {
      return toolService.executeConfirmed({
        toolId: "browser.deep_research",
        input: { query: command.query },
      });
    }

    return toolService.execute({ toolId: command.toolId });
  }

  private synthesizeToolOutput(
    plan: MasterBrainPlan,
    command: ToolCommand,
    result: ToolExecutionResult,
  ): string {
    const primaryAgent = plan.selectedAgents[0]?.agent.name ?? "Tool Router";

    if (command.type === "list") {
      return result.message;
    }

    if (!result.ok) {
      return [
        `${primaryAgent} tried to handle that, but it could not complete the action.`,
        "",
        result.message,
      ].join("\n");
    }

    return [
      `${primaryAgent} handled that.`,
      "",
      result.message,
    ].join("\n");
  }
}
