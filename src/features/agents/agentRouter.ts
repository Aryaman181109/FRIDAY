import { listAgents } from "./agentRegistry";
import type { AgentDefinition, AgentRoute } from "./types";

const INTENT_KEYWORDS: Record<string, string[]> = {
  "os.app-launcher": ["open", "launch", "start", "app", "application"],
  "os.file-system": [
    "file",
    "folder",
    "directory",
    "read",
    "search",
    "find",
    "list",
    "document",
  ],
  "os.clipboard": ["clipboard", "copy", "paste", "copied"],
  "os.screen-capture": ["screenshot", "screen capture", "capture screen"],
  "memory.long-term": [
    "memory",
    "remember",
    "forget",
    "preference",
    "profile",
    "habit",
  ],
  "internet.browser": ["browser", "website", "webpage", "url", "tab"],
  "internet.research": ["research", "google", "search web", "sources", "news"],
  "communication.voice": ["voice", "speak", "listen", "mic", "wake word"],
  "vision.screen-understanding": [
    "screenshot",
    "screen",
    "screen capture",
    "capture screen",
    "image",
    "pdf",
    "ocr",
    "see",
    "vision",
    "visual context",
  ],
  "productivity.calendar": [
    "calendar",
    "brief",
    "briefing",
    "daily",
    "today",
    "reminder",
    "todo",
    "to-do",
    "schedule",
    "meeting",
  ],
  "coding.coding": [
    "code",
    "source",
    "debug",
    "review",
    "git",
    "deploy",
    "test",
    "typescript",
    "react",
    "rust",
    "tauri",
    "function",
    "component",
    "bug",
  ],
  "autonomous.workflow": [
    "automate",
    "workflow",
    "routine",
    "background",
    "monitor",
  ],
  "security.permission-manager": [
    "audit",
    "confirmation",
    "boundaries",
    "permission",
    "permissions",
    "privacy",
    "security",
    "password",
    "safe",
  ],
  "personality.engine": [
    "personality",
    "mood",
    "motivation",
    "wellness",
    "tone",
    "voice",
    "style",
    "response",
    "presence",
    "warm",
  ],
  "system.self-diagnostics": [
    "diagnostic",
    "diagnostics",
    "health",
    "healthy",
    "ready",
    "configured",
    "self check",
    "health check",
  ],
  "system.logging": [
    "activity",
    "history",
    "trace",
    "recent actions",
    "what did you do",
    "tool log",
  ],
  "system.recovery": [
    "failure",
    "failed",
    "error",
    "recovery",
    "recover",
    "went wrong",
    "retry",
    "retry plan",
    "next step",
  ],
  "system.model-router": ["model", "gemini", "openai", "openrouter", "fast", "latency"],
  "system.tool-router": ["tool", "capability", "can you", "what can"],
};

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreAgent(agent: AgentDefinition, input: string): number {
  const searchable = [
    agent.id,
    agent.name,
    agent.layer,
    agent.description,
    ...agent.responsibilities,
    ...agent.toolIds,
    ...(INTENT_KEYWORDS[agent.id] ?? []),
  ].join(" ").toLowerCase();

  const words = normalize(input)
    .split(" ")
    .filter((word) => word.length > 2);

  const keywordScore = (INTENT_KEYWORDS[agent.id] ?? []).reduce(
    (score, keyword) => score + (input.includes(keyword) ? 4 : 0),
    0,
  );
  const wordScore = words.reduce(
    (score, word) => score + (searchable.includes(word) ? 1 : 0),
    0,
  );
  const availabilityBonus = agent.status === "available" ? 2 : 0;

  return keywordScore + wordScore + availabilityBonus;
}

function buildReason(agent: AgentDefinition): string {
  if (agent.status === "available") {
    return `${agent.name} is the best available owner for this request.`;
  }

  return `${agent.name} matches the request, but it is still planned and should only be discussed as a future capability.`;
}

export function routeAgent(input: string): AgentRoute | null {
  const routes = routeAgents(input, 1);

  return routes[0] ?? null;
}

export function routeAgents(input: string, limit = 3): AgentRoute[] {
  const normalizedInput = normalize(input);
  if (!normalizedInput) return [];

  return listAgents()
    .map((agent) => ({
      agent,
      score: scoreAgent(agent, normalizedInput),
      reason: buildReason(agent),
    }))
    .filter((route) => route.score > 2)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.agent.status !== right.agent.status) {
        return left.agent.status === "available" ? -1 : 1;
      }
      return left.agent.name.localeCompare(right.agent.name);
    })
    .slice(0, limit);
}
