import { invoke } from "@tauri-apps/api/core";
import {
  getToolById,
  listAvailableTools,
  listPlannedTools,
  TOOL_REGISTRY,
} from "./toolRegistry";
import { canExecuteWithoutConfirmation, describePermission } from "./toolPermissions";
import type { ToolExecutionRequest, ToolExecutionResult } from "./types";

const PRODUCTIVITY_STORAGE_KEY = "friday.productivity.v1";
const TOOL_ACTIVITY_STORAGE_KEY = "friday.toolActivity.v1";
const MAX_TOOL_ACTIVITY_RECORDS = 80;

interface StoredReminder {
  id: string;
  text: string;
  dueAt: number;
  createdAt: number;
}

interface ScheduledReminder extends StoredReminder {
  timer: ReturnType<typeof setTimeout>;
}

interface TodoItem {
  id: string;
  text: string;
  createdAt: number;
  completedAt?: number;
}

interface NoteItem {
  id: string;
  text: string;
  createdAt: number;
}

interface ProductivitySnapshot {
  reminders: StoredReminder[];
  todos: TodoItem[];
  notes: NoteItem[];
}

interface ToolActivityRecord {
  id: string;
  toolId: string;
  ok: boolean;
  message: string;
  createdAt: number;
}

export class ToolService {
  private readonly reminders = new Map<string, ScheduledReminder>();
  private readonly todos = new Map<string, TodoItem>();
  private readonly notes = new Map<string, NoteItem>();

  constructor() {
    this.loadProductivitySnapshot();
  }

  listTools(): string {
    const available = listAvailableTools();
    const planned = listPlannedTools();

    return [
      "Tool system foundation is online.",
      "",
      "Available now:",
      ...available.map(
        (tool) => `- ${tool.id}: ${tool.description} (${describePermission(tool)})`,
      ),
      "",
      "Planned:",
      ...planned.map(
        (tool) => `- ${tool.id}: ${tool.description} (${describePermission(tool)})`,
      ),
    ].join("\n");
  }

  listToolIds(): string[] {
    return TOOL_REGISTRY.map((tool) => tool.id);
  }

  execute(request: ToolExecutionRequest): ToolExecutionResult {
    const tool = getToolById(request.toolId);

    if (!tool) {
      return {
        toolId: request.toolId,
        ok: false,
        message: `Unknown tool: ${request.toolId}`,
      };
    }

    if (tool.availability !== "available") {
      return {
        toolId: tool.id,
        ok: false,
        requiresConfirmation: tool.permissionLevel !== "safe",
        message: `${tool.name} is registered but not implemented yet.`,
      };
    }

    if (!canExecuteWithoutConfirmation(tool)) {
      return {
        toolId: tool.id,
        ok: false,
        requiresConfirmation: true,
        message: `${tool.name} requires confirmation before execution.`,
      };
    }

    if (tool.id === "system.current_time") {
      return {
        toolId: tool.id,
        ok: true,
        message: new Date().toLocaleString(),
      };
    }

    return {
      toolId: tool.id,
      ok: false,
      message: `${tool.name} is registered but has no executor yet.`,
    };
  }

  async executeConfirmed(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult> {
    return this.recordToolActivity(
      this.executeConfirmedInternal(request),
    );
  }

  private async executeConfirmedInternal(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult> {
    const tool = getToolById(request.toolId);

    if (!tool) {
      return {
        toolId: request.toolId,
        ok: false,
        message: `Unknown tool: ${request.toolId}`,
      };
    }

    if (tool.id === "apps.open") {
      const appName = request.input?.appName;

      if (typeof appName !== "string" || appName.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which app to open.",
        };
      }

      try {
        const message = await invoke<string>("desktop_open_application", {
          request: { appName },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : `I could not open ${appName}.`,
        };
      }
    }

    if (tool.id === "apps.quit") {
      const appName = request.input?.appName;

      if (typeof appName !== "string" || appName.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which app to quit.",
        };
      }

      try {
        const message = await invoke<string>("desktop_quit_application", {
          request: { appName },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : `I could not quit ${appName}.`,
        };
      }
    }

    if (tool.id === "windows.focus_app") {
      const appName = request.input?.appName;

      if (typeof appName !== "string" || appName.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which app to focus.",
        };
      }

      try {
        const message = await invoke<string>("desktop_focus_application", {
          request: { appName },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : `I could not focus ${appName}.`,
        };
      }
    }

    if (tool.id === "apps.list") {
      try {
        const message = await invoke<string>("desktop_list_applications");

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not list applications."),
        };
      }
    }

    if (tool.id === "system.status") {
      try {
        const message = await invoke<string>("desktop_system_status");

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not read system status."),
        };
      }
    }

    if (tool.id === "ai.provider_status") {
      try {
        const status = await invoke<{ message: string }>("ai_provider_status");

        return {
          toolId: tool.id,
          ok: true,
          message: status.message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not read AI provider status."),
        };
      }
    }

    if (tool.id === "security.permission_audit") {
      const availableTools = listAvailableTools();
      const plannedTools = listPlannedTools();
      const safeTools = availableTools.filter((item) => item.permissionLevel === "safe");
      const confirmTools = availableTools.filter((item) => item.permissionLevel === "confirm");
      const dangerousTools = TOOL_REGISTRY.filter((item) => item.permissionLevel === "dangerous");
      const confirmPreview = confirmTools
        .slice(0, 12)
        .map((item) => `- ${item.id}: ${item.description}`);
      const dangerousPreview = dangerousTools
        .slice(0, 8)
        .map((item) => `- ${item.id}: ${item.description}`);

      return {
        toolId: tool.id,
        ok: true,
        message: [
          "FRIDAY permission audit:",
          "",
          `Safe available tools: ${safeTools.length}`,
          `Confirmation-gated available tools: ${confirmTools.length}`,
          `Dangerous registered tools: ${dangerousTools.length}`,
          `Planned tools: ${plannedTools.length}`,
          "",
          "Confirmation-gated examples:",
          ...(confirmPreview.length > 0 ? confirmPreview : ["- None"]),
          ...(confirmTools.length > confirmPreview.length
            ? [`...and ${confirmTools.length - confirmPreview.length} more confirmation-gated tools.`]
            : []),
          "",
          "Dangerous tools:",
          ...(dangerousPreview.length > 0 ? dangerousPreview : ["- None registered."]),
          ...(dangerousTools.length > dangerousPreview.length
            ? [`...and ${dangerousTools.length - dangerousPreview.length} more dangerous tools.`]
            : []),
          "",
          "Policy:",
          "Safe tools may run directly. Confirmation-gated tools require explicit user intent. Dangerous actions remain blocked unless a future permission flow is deliberately built.",
        ].join("\n"),
      };
    }

    if (tool.id === "system.activity_log") {
      const records = this.loadToolActivity();

      if (records.length === 0) {
        return {
          toolId: tool.id,
          ok: true,
          message: "No recent FRIDAY tool activity has been recorded yet.",
        };
      }

      return {
        toolId: tool.id,
        ok: true,
        message: [
          "Recent FRIDAY activity:",
          "",
          ...records.slice(0, 20).map((record) => {
            const status = record.ok ? "ok" : "failed";
            return `- ${new Date(record.createdAt).toLocaleString()} | ${record.toolId} | ${status} | ${record.message}`;
          }),
          ...(records.length > 20 ? [`...and ${records.length - 20} more activity records.`] : []),
        ].join("\n"),
      };
    }

    if (tool.id === "system.failure_review") {
      const failures = this.loadToolActivity().filter((record) => !record.ok);

      if (failures.length === 0) {
        return {
          toolId: tool.id,
          ok: true,
          message: "No recent FRIDAY tool failures are recorded.",
        };
      }

      return {
        toolId: tool.id,
        ok: true,
        message: [
          "Recent FRIDAY failures:",
          "",
          ...failures.slice(0, 12).map((record) => [
            `- ${new Date(record.createdAt).toLocaleString()} | ${record.toolId}`,
            `  Result: ${record.message}`,
            `  Recovery: ${this.recommendRecovery(record.toolId)}`,
          ].join("\n")),
          ...(failures.length > 12 ? [`...and ${failures.length - 12} more failed records.`] : []),
        ].join("\n"),
      };
    }

    if (tool.id === "system.retry_plan") {
      const latestFailure = this.loadToolActivity().find((record) => !record.ok);

      if (!latestFailure) {
        return {
          toolId: tool.id,
          ok: true,
          message: "There is no recent failed FRIDAY action to retry.",
        };
      }

      const failedTool = getToolById(latestFailure.toolId);
      const permission = failedTool
        ? describePermission(failedTool)
        : "unknown permission level";
      const retryBoundary = failedTool?.permissionLevel === "safe"
        ? "This can be retried directly if the request is still relevant."
        : failedTool?.permissionLevel === "confirm"
          ? "This needs explicit user confirmation before retrying."
          : "This should stay blocked until a dedicated dangerous-action flow exists.";

      return {
        toolId: tool.id,
        ok: true,
        message: [
          "Retry plan:",
          "",
          `Failed tool: ${latestFailure.toolId}`,
          `Failed at: ${new Date(latestFailure.createdAt).toLocaleString()}`,
          `Result: ${latestFailure.message}`,
          `Permission boundary: ${permission}`,
          "",
          "Recommended next step:",
          this.recommendRecovery(latestFailure.toolId),
          "",
          "Retry boundary:",
          retryBoundary,
        ].join("\n"),
      };
    }

    if (tool.id === "system.self_diagnostics") {
      const availableTools = listAvailableTools();
      const plannedTools = listPlannedTools();
      const [provider, device, activeWindow, productivity] = await Promise.allSettled([
        this.executeConfirmed({ toolId: "ai.provider_status" }),
        this.executeConfirmed({ toolId: "system.overview" }),
        this.executeConfirmed({ toolId: "windows.active" }),
        this.executeConfirmed({ toolId: "productivity.overview" }),
      ]);

      const readResult = (
        result: PromiseSettledResult<ToolExecutionResult>,
        fallback: string,
      ): string => {
        if (result.status === "fulfilled") {
          return result.value.message;
        }

        return fallback;
      };

      const healthySections = [provider, device, activeWindow, productivity].filter(
        (result) => result.status === "fulfilled" && result.value.ok,
      ).length;

      return {
        toolId: tool.id,
        ok: healthySections > 0,
        message: [
          "FRIDAY self-diagnostics:",
          "",
          `Available tools: ${availableTools.length}`,
          `Planned tools: ${plannedTools.length}`,
          `Healthy checks: ${healthySections}/4`,
          "",
          "AI provider:",
          readResult(provider, "AI provider status is unavailable."),
          "",
          "Current focus:",
          readResult(activeWindow, "Active window context is unavailable."),
          "",
          "Productivity state:",
          readResult(productivity, "Productivity state is unavailable."),
          "",
          "Device state:",
          readResult(device, "Device state is unavailable."),
        ].join("\n"),
      };
    }

    if (tool.id === "system.overview") {
      const checks = await Promise.allSettled([
        invoke<string>("desktop_system_status"),
        invoke<string>("desktop_storage_status"),
        invoke<string>("desktop_network_status"),
        invoke<string>("desktop_list_processes"),
      ]);

      const labels = ["Core", "Storage", "Network", "Top Processes"];
      const sections = checks.map((check, index) => {
        if (check.status === "fulfilled") {
          return [`${labels[index]}:`, check.value].join("\n");
        }

        return [
          `${labels[index]}:`,
          this.formatToolError(check.reason, "Unavailable."),
        ].join("\n");
      });

      return {
        toolId: tool.id,
        ok: checks.some((check) => check.status === "fulfilled"),
        message: ["Device overview:", "", ...sections].join("\n\n"),
      };
    }

    if (tool.id === "process.list") {
      try {
        const message = await invoke<string>("desktop_list_processes");

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not list processes."),
        };
      }
    }

    if (tool.id === "network.status") {
      try {
        const message = await invoke<string>("desktop_network_status");

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not read network status."),
        };
      }
    }

    if (tool.id === "storage.status") {
      try {
        const message = await invoke<string>("desktop_storage_status");

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not read storage status."),
        };
      }
    }

    if (tool.id === "windows.active") {
      try {
        const message = await invoke<string>("desktop_active_window");

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not read the active window."),
        };
      }
    }

    if (tool.id === "windows.list") {
      try {
        const message = await invoke<string>("desktop_list_windows");

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not list open windows."),
        };
      }
    }

    if (tool.id === "files.list") {
      const path = request.input?.path;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which folder to list.",
        };
      }

      try {
        const message = await invoke<string>("desktop_list_directory", {
          request: { path },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not list ${path}.`),
        };
      }
    }

    if (tool.id === "files.tree") {
      const path = request.input?.path;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which folder tree to show.",
        };
      }

      try {
        const message = await invoke<string>("desktop_tree_directory", {
          request: { path },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not show the tree for ${path}.`),
        };
      }
    }

    if (tool.id === "files.summary") {
      const path = request.input?.path;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which folder to summarize.",
        };
      }

      try {
        const message = await invoke<string>("desktop_folder_summary", {
          request: { path },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not summarize ${path}.`),
        };
      }
    }

    if (tool.id === "files.create_folder") {
      const path = request.input?.path;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me where to create the folder.",
        };
      }

      try {
        const message = await invoke<string>("desktop_create_folder", {
          request: { path },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not create ${path}.`),
        };
      }
    }

    if (tool.id === "files.create_text_file") {
      const path = request.input?.path;
      const content = request.input?.content;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me where to create the file.",
        };
      }

      if (typeof content !== "string") {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what to write in the file.",
        };
      }

      try {
        const message = await invoke<string>("desktop_create_text_file", {
          request: { path, content },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not create ${path}.`),
        };
      }
    }

    if (tool.id === "files.append_text_file") {
      const path = request.input?.path;
      const content = request.input?.content;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which file to append to.",
        };
      }

      if (typeof content !== "string" || content.length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what text to append.",
        };
      }

      try {
        const message = await invoke<string>("desktop_append_text_file", {
          request: { path, content },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not append to ${path}.`),
        };
      }
    }

    if (tool.id === "files.rename") {
      const path = request.input?.path;
      const newName = request.input?.newName;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which file or folder to rename.",
        };
      }

      if (typeof newName !== "string" || newName.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me the new name.",
        };
      }

      try {
        const message = await invoke<string>("desktop_rename_path", {
          request: { path, newName },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not rename ${path}.`),
        };
      }
    }

    if (tool.id === "files.move") {
      const path = request.input?.path;
      const destinationFolder = request.input?.destinationFolder;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which file or folder to move.",
        };
      }

      if (typeof destinationFolder !== "string" || destinationFolder.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me the destination folder.",
        };
      }

      try {
        const message = await invoke<string>("desktop_move_path", {
          request: { path, destinationFolder },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not move ${path}.`),
        };
      }
    }

    if (tool.id === "files.copy") {
      const path = request.input?.path;
      const destinationFolder = request.input?.destinationFolder;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which file or folder to copy.",
        };
      }

      if (typeof destinationFolder !== "string" || destinationFolder.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me the destination folder.",
        };
      }

      try {
        const message = await invoke<string>("desktop_copy_path", {
          request: { path, destinationFolder },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not copy ${path}.`),
        };
      }
    }

    if (tool.id === "files.trash") {
      const path = request.input?.path;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which file or folder to move to Trash.",
        };
      }

      try {
        const message = await invoke<string>("desktop_trash_path", {
          request: { path },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not move ${path} to Trash.`),
        };
      }
    }

    if (tool.id === "files.search") {
      const path = request.input?.path;
      const query = request.input?.query;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which folder to search.",
        };
      }

      if (typeof query !== "string" || query.trim().length < 2) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what filename to search for.",
        };
      }

      try {
        const message = await invoke<string>("desktop_search_files", {
          request: { path, query },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not search ${path}.`),
        };
      }
    }

    if (tool.id === "files.search_text") {
      const path = request.input?.path;
      const query = request.input?.query;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which folder to search inside.",
        };
      }

      if (typeof query !== "string" || query.trim().length < 2) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what text to search for.",
        };
      }

      try {
        const message = await invoke<string>("desktop_search_text", {
          request: { path, query },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not search inside ${path}.`),
        };
      }
    }

    if (tool.id === "files.info") {
      const path = request.input?.path;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which file or folder to inspect.",
        };
      }

      try {
        const message = await invoke<string>("desktop_path_info", {
          request: { path },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not inspect ${path}.`),
        };
      }
    }

    if (tool.id === "files.reveal") {
      const path = request.input?.path;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which file or folder to reveal.",
        };
      }

      try {
        const message = await invoke<string>("desktop_reveal_path", {
          request: { path },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not reveal ${path}.`),
        };
      }
    }

    if (tool.id === "files.open") {
      const path = request.input?.path;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which file or folder to open.",
        };
      }

      try {
        const message = await invoke<string>("desktop_open_path", {
          request: { path },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not open ${path}.`),
        };
      }
    }

    if (tool.id === "files.read") {
      const path = request.input?.path;

      if (typeof path !== "string" || path.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which text file to read.",
        };
      }

      try {
        const message = await invoke<string>("desktop_read_text_file", {
          request: { path },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not read ${path}.`),
        };
      }
    }

    if (tool.id === "clipboard.read") {
      try {
        const message = await invoke<string>("desktop_read_clipboard");

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not read the clipboard."),
        };
      }
    }

    if (tool.id === "clipboard.write") {
      const text = request.input?.text;

      if (typeof text !== "string" || text.length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what text to copy to the clipboard.",
        };
      }

      try {
        const message = await invoke<string>("desktop_write_clipboard", {
          request: { text },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not write to the clipboard."),
        };
      }
    }

    if (tool.id === "notifications.send") {
      const title = request.input?.title;
      const body = request.input?.body;

      if (title !== undefined && typeof title !== "string") {
        return {
          toolId: tool.id,
          ok: false,
          message: "Notification title must be text.",
        };
      }

      if (typeof body !== "string" || body.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what the notification should say.",
        };
      }

      try {
        const message = await invoke<string>("desktop_send_notification", {
          request: { title, body },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not send the notification."),
        };
      }
    }

    if (tool.id === "productivity.briefing") {
      const [device, activeWindow, productivity] = await Promise.allSettled([
        this.executeConfirmed({ toolId: "system.overview" }),
        this.executeConfirmed({ toolId: "windows.active" }),
        this.executeConfirmed({ toolId: "productivity.overview" }),
      ]);

      const readSection = (
        section: PromiseSettledResult<ToolExecutionResult>,
        fallback: string,
      ): string => {
        if (section.status === "fulfilled") {
          return section.value.ok ? section.value.message : section.value.message;
        }

        return fallback;
      };

      const sections = [
        "FRIDAY briefing:",
        "",
        `Local time: ${new Date().toLocaleString()}`,
        "",
        "Current focus:",
        readSection(activeWindow, "Current window context is unavailable."),
        "",
        "Your work:",
        readSection(productivity, "Productivity context is unavailable."),
        "",
        "Machine state:",
        readSection(device, "Device context is unavailable."),
      ];

      return {
        toolId: tool.id,
        ok:
          (device.status === "fulfilled" && device.value.ok)
          || (activeWindow.status === "fulfilled" && activeWindow.value.ok)
          || (productivity.status === "fulfilled" && productivity.value.ok),
        message: sections.join("\n"),
      };
    }

    if (tool.id === "productivity.overview") {
      const now = Date.now();
      const activeTodos = [...this.todos.values()]
        .filter((todo) => todo.completedAt === undefined)
        .sort((a, b) => a.createdAt - b.createdAt);
      const reminders = [...this.reminders.values()].sort((a, b) => a.dueAt - b.dueAt);
      const notes = [...this.notes.values()].sort((a, b) => b.createdAt - a.createdAt);

      const lines = [
        "Productivity overview:",
        "",
        `Active to-dos: ${activeTodos.length}`,
      ];

      if (activeTodos.length > 0) {
        lines.push(...activeTodos.slice(0, 5).map((todo) => `- ${todo.id}: ${todo.text}`));
        if (activeTodos.length > 5) {
          lines.push(`...and ${activeTodos.length - 5} more to-dos.`);
        }
      }

      lines.push("", `Active reminders: ${reminders.length}`);
      if (reminders.length > 0) {
        lines.push(
          ...reminders.slice(0, 5).map((reminder) => {
            const remainingMs = Math.max(0, reminder.dueAt - now);
            return `- ${reminder.id}: ${reminder.text} (${this.formatDelay(remainingMs)} remaining)`;
          }),
        );
        if (reminders.length > 5) {
          lines.push(`...and ${reminders.length - 5} more reminders.`);
        }
      }

      lines.push("", `Saved notes: ${notes.length}`);
      if (notes.length > 0) {
        lines.push(
          ...notes.slice(0, 5).map((note) => {
            const preview = note.text.length > 100 ? `${note.text.slice(0, 100)}...` : note.text;
            return `- ${note.id}: ${preview}`;
          }),
        );
        if (notes.length > 5) {
          lines.push(`...and ${notes.length - 5} more notes.`);
        }
      }

      return {
        toolId: tool.id,
        ok: true,
        message: lines.join("\n"),
      };
    }

    if (tool.id === "productivity.search") {
      const query = request.input?.query;

      if (typeof query !== "string" || query.trim().length < 2) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what to search for.",
        };
      }

      const normalizedQuery = query.trim().toLowerCase();
      const matches: string[] = [];

      for (const todo of [...this.todos.values()].sort((a, b) => a.createdAt - b.createdAt)) {
        if (todo.text.toLowerCase().includes(normalizedQuery)) {
          const status = todo.completedAt === undefined ? "active" : "completed";
          matches.push(`- To-do ${todo.id} (${status}): ${todo.text}`);
        }
      }

      for (const reminder of [...this.reminders.values()].sort((a, b) => a.dueAt - b.dueAt)) {
        if (reminder.text.toLowerCase().includes(normalizedQuery)) {
          const remainingMs = Math.max(0, reminder.dueAt - Date.now());
          matches.push(`- Reminder ${reminder.id}: ${reminder.text} (${this.formatDelay(remainingMs)} remaining)`);
        }
      }

      for (const note of [...this.notes.values()].sort((a, b) => b.createdAt - a.createdAt)) {
        if (note.text.toLowerCase().includes(normalizedQuery)) {
          const preview = note.text.length > 180 ? `${note.text.slice(0, 180)}...` : note.text;
          matches.push(`- Note ${note.id}: ${preview}`);
        }
      }

      if (matches.length === 0) {
        return {
          toolId: tool.id,
          ok: true,
          message: `No productivity matches for "${query.trim()}".`,
        };
      }

      return {
        toolId: tool.id,
        ok: true,
        message: [
          `Productivity matches for "${query.trim()}":`,
          "",
          ...matches.slice(0, 20),
          ...(matches.length > 20 ? [`...and ${matches.length - 20} more matches.`] : []),
        ].join("\n"),
      };
    }

    if (tool.id === "productivity.reminder.create") {
      const text = request.input?.text;
      const delayMs = request.input?.delayMs;

      if (typeof text !== "string" || text.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what to remind you about.",
        };
      }

      if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs <= 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me when to remind you using a relative time.",
        };
      }

      const maxDelayMs = 24 * 60 * 60 * 1000;
      if (delayMs > maxDelayMs) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Local reminders currently support delays up to 24 hours.",
        };
      }

      if (text.length > 240) {
        return {
          toolId: tool.id,
          ok: false,
          message: "That reminder is too long.",
        };
      }

      const reminderId = this.createReminderId();
      const dueAt = Date.now() + delayMs;
      this.scheduleReminder({
        id: reminderId,
        text,
        dueAt,
        createdAt: Date.now(),
      });
      this.saveProductivitySnapshot();

      return {
        toolId: tool.id,
        ok: true,
        message: `Reminder ${reminderId} set for ${this.formatDelay(delayMs)} from now.`,
      };
    }

    if (tool.id === "productivity.reminder.list") {
      if (this.reminders.size === 0) {
        return {
          toolId: tool.id,
          ok: true,
          message: "No active local reminders.",
        };
      }

      const now = Date.now();
      const lines = ["Active reminders:", ""];
      for (const reminder of [...this.reminders.values()].sort((a, b) => a.dueAt - b.dueAt)) {
        const remainingMs = Math.max(0, reminder.dueAt - now);
        lines.push(`- ${reminder.id}: ${reminder.text} (${this.formatDelay(remainingMs)} remaining)`);
      }

      return {
        toolId: tool.id,
        ok: true,
        message: lines.join("\n"),
      };
    }

    if (tool.id === "productivity.reminder.cancel") {
      const reminderId = request.input?.reminderId;

      if (typeof reminderId !== "string" || reminderId.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which reminder ID to cancel.",
        };
      }

      const reminder = this.reminders.get(reminderId.trim());
      if (!reminder) {
        return {
          toolId: tool.id,
          ok: false,
          message: `I could not find active reminder ${reminderId}.`,
        };
      }

      clearTimeout(reminder.timer);
      this.reminders.delete(reminder.id);
      this.saveProductivitySnapshot();

      return {
        toolId: tool.id,
        ok: true,
        message: `Canceled reminder ${reminder.id}.`,
      };
    }

    if (tool.id === "productivity.todo.add") {
      const text = request.input?.text;

      if (typeof text !== "string" || text.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what task to add.",
        };
      }

      if (text.length > 240) {
        return {
          toolId: tool.id,
          ok: false,
          message: "That task is too long.",
        };
      }

      const todoId = this.createTodoId();
      this.todos.set(todoId, {
        id: todoId,
        text: text.trim(),
        createdAt: Date.now(),
      });
      this.saveProductivitySnapshot();

      return {
        toolId: tool.id,
        ok: true,
        message: `Added ${todoId}: ${text.trim()}`,
      };
    }

    if (tool.id === "productivity.todo.list") {
      const activeTodos = [...this.todos.values()]
        .filter((todo) => todo.completedAt === undefined)
        .sort((a, b) => a.createdAt - b.createdAt);

      if (activeTodos.length === 0) {
        return {
          toolId: tool.id,
          ok: true,
          message: "No active to-dos.",
        };
      }

      return {
        toolId: tool.id,
        ok: true,
        message: [
          "Active to-dos:",
          "",
          ...activeTodos.map((todo) => `- ${todo.id}: ${todo.text}`),
        ].join("\n"),
      };
    }

    if (tool.id === "productivity.todo.complete") {
      const todoId = request.input?.todoId;

      if (typeof todoId !== "string" || todoId.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which to-do ID to complete.",
        };
      }

      const todo = this.todos.get(todoId.trim());
      if (!todo || todo.completedAt !== undefined) {
        return {
          toolId: tool.id,
          ok: false,
          message: `I could not find active to-do ${todoId}.`,
        };
      }

      this.todos.set(todo.id, {
        ...todo,
        completedAt: Date.now(),
      });
      this.saveProductivitySnapshot();

      return {
        toolId: tool.id,
        ok: true,
        message: `Completed ${todo.id}: ${todo.text}`,
      };
    }

    if (tool.id === "productivity.note.add") {
      const text = request.input?.text;

      if (typeof text !== "string" || text.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what note to save.",
        };
      }

      if (text.length > 2_000) {
        return {
          toolId: tool.id,
          ok: false,
          message: "That note is too long for the in-session note system.",
        };
      }

      const noteId = this.createNoteId();
      this.notes.set(noteId, {
        id: noteId,
        text: text.trim(),
        createdAt: Date.now(),
      });
      this.saveProductivitySnapshot();

      return {
        toolId: tool.id,
        ok: true,
        message: `Saved ${noteId}.`,
      };
    }

    if (tool.id === "productivity.note.list") {
      if (this.notes.size === 0) {
        return {
          toolId: tool.id,
          ok: true,
          message: "No in-session notes.",
        };
      }

      const lines = ["In-session notes:", ""];
      for (const note of [...this.notes.values()].sort((a, b) => a.createdAt - b.createdAt)) {
        const preview = note.text.length > 120 ? `${note.text.slice(0, 120)}...` : note.text;
        lines.push(`- ${note.id}: ${preview}`);
      }

      return {
        toolId: tool.id,
        ok: true,
        message: lines.join("\n"),
      };
    }

    if (tool.id === "productivity.note.read") {
      const noteId = request.input?.noteId;

      if (typeof noteId !== "string" || noteId.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which note ID to read.",
        };
      }

      const note = this.notes.get(noteId.trim());
      if (!note) {
        return {
          toolId: tool.id,
          ok: false,
          message: `I could not find note ${noteId}.`,
        };
      }

      return {
        toolId: tool.id,
        ok: true,
        message: `${note.id}:\n${note.text}`,
      };
    }

    if (tool.id === "productivity.note.delete") {
      const noteId = request.input?.noteId;

      if (typeof noteId !== "string" || noteId.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which note ID to delete.",
        };
      }

      const trimmedNoteId = noteId.trim();
      if (!this.notes.has(trimmedNoteId)) {
        return {
          toolId: tool.id,
          ok: false,
          message: `I could not find note ${noteId}.`,
        };
      }

      this.notes.delete(trimmedNoteId);
      this.saveProductivitySnapshot();

      return {
        toolId: tool.id,
        ok: true,
        message: `Deleted note ${trimmedNoteId}.`,
      };
    }

    if (tool.id === "screen.capture") {
      try {
        const message = await invoke<string>("desktop_capture_screen");

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not capture the screen."),
        };
      }
    }

    if (tool.id === "voice.speak") {
      const text = request.input?.text;

      if (typeof text !== "string" || text.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what FRIDAY should say aloud.",
        };
      }

      try {
        const message = await invoke<string>("desktop_speak_text", {
          request: { text },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, "I could not speak that aloud."),
        };
      }
    }

    if (tool.id === "browser.open") {
      const target = request.input?.target;

      if (typeof target !== "string" || target.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which website to open.",
        };
      }

      try {
        const message = await invoke<string>("desktop_open_url", {
          request: { target },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not open ${target}.`),
        };
      }
    }

    if (tool.id === "browser.search") {
      const query = request.input?.query;

      if (typeof query !== "string" || query.trim().length < 2) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what to search for.",
        };
      }

      const target = `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;

      try {
        const message = await invoke<string>("desktop_open_url", {
          request: { target },
        });

        return {
          toolId: tool.id,
          ok: true,
          message: message.replace(target, `a web search for "${query.trim()}"`),
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not search for ${query}.`),
        };
      }
    }

    if (tool.id === "browser.read") {
      const target = request.input?.target;

      if (typeof target !== "string" || target.trim().length === 0) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me which webpage to read.",
        };
      }

      try {
        const message = await invoke<string>("desktop_read_url", {
          request: { target },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not read ${target}.`),
        };
      }
    }

    if (tool.id === "browser.research") {
      const query = request.input?.query;

      if (typeof query !== "string" || query.trim().length < 2) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what to research.",
        };
      }

      try {
        const message = await invoke<string>("desktop_research_web", {
          request: { query },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not research ${query}.`),
        };
      }
    }

    if (tool.id === "browser.deep_research") {
      const query = request.input?.query;

      if (typeof query !== "string" || query.trim().length < 2) {
        return {
          toolId: tool.id,
          ok: false,
          message: "Tell me what to research deeply.",
        };
      }

      try {
        const message = await invoke<string>("desktop_deep_research_web", {
          request: { query },
        });

        return {
          toolId: tool.id,
          ok: true,
          message,
        };
      } catch (error) {
        return {
          toolId: tool.id,
          ok: false,
          message: this.formatToolError(error, `I could not deeply research ${query}.`),
        };
      }
    }

    return this.execute(request);
  }

  private formatToolError(error: unknown, fallback: string): string {
    return typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : fallback;
  }

  private loadProductivitySnapshot(): void {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(PRODUCTIVITY_STORAGE_KEY);
      if (!raw) return;

      const snapshot = JSON.parse(raw) as Partial<ProductivitySnapshot>;
      const now = Date.now();
      let shouldSaveAfterLoad = false;

      if (Array.isArray(snapshot.reminders)) {
        for (const reminder of snapshot.reminders) {
          if (
            typeof reminder.id === "string"
            && typeof reminder.text === "string"
            && typeof reminder.dueAt === "number"
            && typeof reminder.createdAt === "number"
          ) {
            if (reminder.dueAt <= now) {
              void this.sendReminderNotification(reminder.text);
              shouldSaveAfterLoad = true;
            } else {
              this.scheduleReminder(reminder);
            }
          }
        }
      }

      if (Array.isArray(snapshot.todos)) {
        for (const todo of snapshot.todos) {
          if (
            typeof todo.id === "string"
            && typeof todo.text === "string"
            && typeof todo.createdAt === "number"
          ) {
            this.todos.set(todo.id, {
              id: todo.id,
              text: todo.text,
              createdAt: todo.createdAt,
              completedAt: typeof todo.completedAt === "number" ? todo.completedAt : undefined,
            });
          }
        }
      }

      if (Array.isArray(snapshot.notes)) {
        for (const note of snapshot.notes) {
          if (
            typeof note.id === "string"
            && typeof note.text === "string"
            && typeof note.createdAt === "number"
          ) {
            this.notes.set(note.id, {
              id: note.id,
              text: note.text,
              createdAt: note.createdAt,
            });
          }
        }
      }

      if (shouldSaveAfterLoad) {
        this.saveProductivitySnapshot();
      }
    } catch {
      window.localStorage.removeItem(PRODUCTIVITY_STORAGE_KEY);
    }
  }

  private saveProductivitySnapshot(): void {
    if (typeof window === "undefined") return;

    const snapshot: ProductivitySnapshot = {
      reminders: [...this.reminders.values()].map((reminder) => ({
        id: reminder.id,
        text: reminder.text,
        dueAt: reminder.dueAt,
        createdAt: reminder.createdAt,
      })),
      todos: [...this.todos.values()],
      notes: [...this.notes.values()],
    };

    window.localStorage.setItem(PRODUCTIVITY_STORAGE_KEY, JSON.stringify(snapshot));
  }

  private scheduleReminder(reminder: StoredReminder): void {
    const delayMs = Math.max(0, reminder.dueAt - Date.now());
    const timer = setTimeout(() => {
      this.reminders.delete(reminder.id);
      this.saveProductivitySnapshot();
      void this.sendReminderNotification(reminder.text);
    }, delayMs);

    this.reminders.set(reminder.id, {
      ...reminder,
      timer,
    });
  }

  private async sendReminderNotification(text: string): Promise<void> {
    try {
      await invoke<string>("desktop_send_notification", {
        request: {
          title: "FRIDAY Reminder",
          body: text,
        },
      });
    } catch {
      // Reminder delivery should not break the ToolService runtime.
    }
  }

  private createReminderId(): string {
    let index = this.reminders.size + 1;
    let reminderId = `reminder_${index}`;

    while (this.reminders.has(reminderId)) {
      index += 1;
      reminderId = `reminder_${index}`;
    }

    return reminderId;
  }

  private createTodoId(): string {
    let index = this.todos.size + 1;
    let todoId = `todo_${index}`;

    while (this.todos.has(todoId)) {
      index += 1;
      todoId = `todo_${index}`;
    }

    return todoId;
  }

  private createNoteId(): string {
    let index = this.notes.size + 1;
    let noteId = `note_${index}`;

    while (this.notes.has(noteId)) {
      index += 1;
      noteId = `note_${index}`;
    }

    return noteId;
  }

  private async recordToolActivity(
    execution: Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> {
    const result = await execution;
    this.saveToolActivityRecord({
      id: this.createActivityId(),
      toolId: result.toolId,
      ok: result.ok,
      message: this.compactActivityMessage(result.message),
      createdAt: Date.now(),
    });

    return result;
  }

  private loadToolActivity(): ToolActivityRecord[] {
    if (typeof window === "undefined") return [];

    try {
      const raw = window.localStorage.getItem(TOOL_ACTIVITY_STORAGE_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((record): record is ToolActivityRecord => {
          if (!record || typeof record !== "object") return false;

          const candidate = record as ToolActivityRecord;
          return (
            typeof candidate.id === "string"
            && typeof candidate.toolId === "string"
            && typeof candidate.ok === "boolean"
            && typeof candidate.message === "string"
            && typeof candidate.createdAt === "number"
          );
        })
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, MAX_TOOL_ACTIVITY_RECORDS);
    } catch {
      window.localStorage.removeItem(TOOL_ACTIVITY_STORAGE_KEY);
      return [];
    }
  }

  private saveToolActivityRecord(record: ToolActivityRecord): void {
    if (typeof window === "undefined") return;

    const nextRecords = [record, ...this.loadToolActivity()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_TOOL_ACTIVITY_RECORDS);

    window.localStorage.setItem(
      TOOL_ACTIVITY_STORAGE_KEY,
      JSON.stringify(nextRecords),
    );
  }

  private createActivityId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `activity_${crypto.randomUUID()}`;
    }

    return `activity_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  private compactActivityMessage(message: string): string {
    const compacted = message.replace(/\s+/g, " ").trim();
    if (compacted.length <= 180) return compacted;

    return `${compacted.slice(0, 180)}...`;
  }

  private recommendRecovery(toolId: string): string {
    if (toolId.startsWith("ai.")) {
      return "Check AI provider configuration and restart FRIDAY after changing environment variables.";
    }

    if (toolId.startsWith("files.")) {
      return "Check the path, file permissions, and whether the target exists.";
    }

    if (toolId.startsWith("browser.")) {
      return "Check the URL or network connection, then retry with a more specific request.";
    }

    if (toolId.startsWith("apps.") || toolId.startsWith("windows.")) {
      return "Check the app name and whether macOS allows FRIDAY to control or inspect that app.";
    }

    if (toolId.startsWith("screen.")) {
      return "Check macOS screen recording permission for FRIDAY.";
    }

    if (toolId.startsWith("clipboard.")) {
      return "Retry the clipboard action and check whether clipboard access is available.";
    }

    return "Retry the request with more specific wording, or run FRIDAY diagnostics.";
  }

  private formatDelay(delayMs: number): string {
    const seconds = Math.round(delayMs / 1000);

    if (seconds < 60) {
      return `${seconds} second${seconds === 1 ? "" : "s"}`;
    }

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }

    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
}
