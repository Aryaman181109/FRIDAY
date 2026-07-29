import type { ToolDefinition } from "./types";

export function canExecuteWithoutConfirmation(tool: ToolDefinition): boolean {
  return tool.permissionLevel === "safe";
}

export function describePermission(tool: ToolDefinition): string {
  if (tool.permissionLevel === "safe") {
    return "safe/read-only";
  }

  if (tool.permissionLevel === "confirm") {
    return "requires confirmation";
  }

  return "dangerous/requires explicit confirmation";
}
