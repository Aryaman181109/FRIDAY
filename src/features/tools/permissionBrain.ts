import { getToolById } from "./toolRegistry";
import type { ToolPermissionLevel } from "./types";
import type { ToolPermissionDecision } from "../agents/types";

const EXPLICIT_ACTION_WORDS = [
  "open",
  "focus",
  "activate",
  "bring",
  "switch",
  "quit",
  "close",
  "exit",
  "stop",
  "launch",
  "start",
  "list",
  "show",
  "view",
  "notify",
  "alert",
  "display",
  "say",
  "speak",
  "tell",
  "read aloud",
  "remind",
  "search",
  "find",
  "reveal",
  "locate",
  "read",
  "create",
  "make",
  "new",
  "write",
  "copy",
  "put",
  "set",
  "run",
  "use",
  "execute",
  "clear",
  "complete",
  "finish",
  "done",
  "trash",
  "remove",
  "delete",
  "move",
  "rename",
  "take",
  "capture",
  "grab",
  "visit",
  "go",
];

function hasExplicitIntent(input: string): boolean {
  const normalizedInput = input.toLowerCase();
  return EXPLICIT_ACTION_WORDS.some((word) =>
    new RegExp(`\\b${word}\\b`, "i").test(normalizedInput),
  );
}

function createDecision(
  toolId: string,
  status: ToolPermissionDecision["status"],
  permissionLevel: ToolPermissionLevel,
  reason: string,
): ToolPermissionDecision {
  return {
    toolId,
    status,
    permissionLevel,
    reason,
  };
}

export class PermissionBrain {
  decide(toolId: string, input: string): ToolPermissionDecision {
    const tool = getToolById(toolId);

    if (!tool) {
      return createDecision(
        toolId,
        "blocked",
        "dangerous",
        "The requested tool is not registered.",
      );
    }

    if (tool.availability !== "available") {
      return createDecision(
        tool.id,
        "unavailable",
        tool.permissionLevel,
        `${tool.name} is planned but not implemented yet.`,
      );
    }

    if (tool.permissionLevel === "safe") {
      return createDecision(
        tool.id,
        "allowed",
        tool.permissionLevel,
        `${tool.name} is read-only and safe to run.`,
      );
    }

    if (tool.permissionLevel === "confirm" && hasExplicitIntent(input)) {
      return createDecision(
        tool.id,
        "allowed",
        tool.permissionLevel,
        `${tool.name} was explicitly requested by the user.`,
      );
    }

    if (tool.permissionLevel === "confirm") {
      return createDecision(
        tool.id,
        "explicit-intent-required",
        tool.permissionLevel,
        `${tool.name} needs a clear user request before it can run.`,
      );
    }

    return createDecision(
      tool.id,
      "blocked",
      tool.permissionLevel,
      `${tool.name} is marked dangerous and needs a dedicated confirmation flow before execution.`,
    );
  }
}
