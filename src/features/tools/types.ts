export type ToolCategory =
  | "system"
  | "network"
  | "storage"
  | "apps"
  | "windows"
  | "files"
  | "clipboard"
  | "notifications"
  | "screen"
  | "browser"
  | "voice"
  | "memory"
  | "productivity";

export type ToolPermissionLevel = "safe" | "confirm" | "dangerous";

export type ToolAvailability = "available" | "planned";

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  permissionLevel: ToolPermissionLevel;
  availability: ToolAvailability;
}

export interface ToolExecutionRequest {
  toolId: string;
  input?: Record<string, unknown>;
}

export interface ToolExecutionResult {
  toolId: string;
  ok: boolean;
  message: string;
  requiresConfirmation?: boolean;
}
