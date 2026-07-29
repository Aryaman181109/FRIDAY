import { ToolService } from "./toolService";

export type ToolCommand =
  | { type: "list" }
  | { type: "execute"; toolId: string }
  | { type: "deviceOverview" }
  | { type: "selfDiagnostics" }
  | { type: "activityLog" }
  | { type: "failureReview" }
  | { type: "retryPlan" }
  | { type: "aiProviderStatus" }
  | { type: "permissionAudit" }
  | { type: "systemStatus" }
  | { type: "networkStatus" }
  | { type: "storageStatus" }
  | { type: "activeWindow" }
  | { type: "listWindows" }
  | { type: "listProcesses" }
  | { type: "listApplications" }
  | { type: "openApp"; appName: string }
  | { type: "focusApp"; appName: string }
  | { type: "quitApp"; appName: string }
  | { type: "createFolder"; path: string }
  | { type: "createTextFile"; path: string; content: string }
  | { type: "appendTextFile"; path: string; content: string }
  | { type: "renamePath"; path: string; newName: string }
  | { type: "movePath"; path: string; destinationFolder: string }
  | { type: "copyPath"; path: string; destinationFolder: string }
  | { type: "trashPath"; path: string }
  | { type: "listFolder"; path: string }
  | { type: "folderTree"; path: string }
  | { type: "folderSummary"; path: string }
  | { type: "searchFiles"; path: string; query: string }
  | { type: "searchText"; path: string; query: string }
  | { type: "pathInfo"; path: string }
  | { type: "revealPath"; path: string }
  | { type: "openPath"; path: string }
  | { type: "readTextFile"; path: string }
  | { type: "summarizeTextFile"; path: string }
  | { type: "readClipboard" }
  | { type: "writeClipboard"; text: string }
  | { type: "sendNotification"; title?: string; body: string }
  | { type: "dailyBriefing" }
  | { type: "productivityOverview" }
  | { type: "searchProductivity"; query: string }
  | { type: "createReminder"; text: string; delayMs: number }
  | { type: "listReminders" }
  | { type: "cancelReminder"; reminderId: string }
  | { type: "addTodo"; text: string }
  | { type: "listTodos" }
  | { type: "completeTodo"; todoId: string }
  | { type: "addNote"; text: string }
  | { type: "listNotes" }
  | { type: "readNote"; noteId: string }
  | { type: "deleteNote"; noteId: string }
  | { type: "captureScreen" }
  | { type: "speakText"; text: string }
  | { type: "openWebsite"; target: string }
  | { type: "searchWeb"; query: string }
  | { type: "readWebpage"; target: string }
  | { type: "researchWeb"; query: string }
  | { type: "deepResearchWeb"; query: string };

const LIST_TOOL_PATTERNS = [
  /\b(show|list|view)\s+(available\s+)?tools\b/i,
  /\bwhat\s+tools\s+(do\s+you\s+have|are\s+available)\b/i,
];

const EXECUTE_TOOL_PATTERN = /\b(?:run|use|execute)\s+tool\s+([a-z0-9._-]+)/i;
const DEVICE_OVERVIEW_PATTERNS = [
  /\b(?:device|system|computer|mac)\s+(?:overview|snapshot|summary|health|diagnostic|diagnostics)\b/i,
  /\b(?:how(?:'s| is)\s+my\s+(?:device|system|computer|mac)\s+doing)\b/i,
  /\b(?:give\s+me\s+)?(?:a\s+)?(?:full\s+)?(?:device|system|computer|mac)\s+(?:check|checkup|overview)\b/i,
];
const SELF_DIAGNOSTICS_PATTERNS = [
  /\b(?:friday\s+)?(?:self\s+)?diagnostics?\b/i,
  /\b(?:run|start|perform)\s+(?:a\s+)?(?:friday\s+)?(?:health\s+check|diagnostic|diagnostics)\b/i,
  /\b(?:is\s+)?friday\s+(?:healthy|working|configured|ready)\b/i,
  /\b(?:system\s+intelligence|ai\s+os)\s+(?:status|health|diagnostics?)\b/i,
];
const ACTIVITY_LOG_PATTERNS = [
  /\b(?:activity|action|tool|execution)\s+(?:log|history|trace)\b/i,
  /\b(?:what\s+did\s+you\s+do\s+recently)\b/i,
  /\b(?:show|list|view)\s+(?:recent\s+)?(?:friday\s+)?(?:actions|activity|tool\s+activity)\b/i,
];
const FAILURE_REVIEW_PATTERNS = [
  /\b(?:failure|error|failed|recovery)\s+(?:review|log|history|status|summary)\b/i,
  /\b(?:what\s+(?:failed|went\s+wrong)\s+recently)\b/i,
  /\b(?:show|list|view)\s+(?:recent\s+)?(?:failures|errors|failed\s+actions)\b/i,
];
const RETRY_PLAN_PATTERNS = [
  /\b(?:retry|recovery)\s+(?:plan|strategy|next\s+step)\b/i,
  /\b(?:how\s+should\s+(?:we|i)\s+retry)\b/i,
  /\b(?:plan\s+(?:a\s+)?retry)\b/i,
  /\b(?:what\s+should\s+(?:we|i)\s+do\s+after\s+(?:the\s+)?failure)\b/i,
];
const AI_PROVIDER_STATUS_PATTERNS = [
  /\b(?:ai|model|provider)\s+(?:status|config|configuration|info|information)\b/i,
  /\b(?:which|what)\s+(?:ai\s+)?(?:model|provider)\s+(?:are\s+you|is\s+friday)\s+using\b/i,
  /\b(?:is\s+)?(?:gemini|openai)\s+(?:configured|active|enabled)\b/i,
];
const PERMISSION_AUDIT_PATTERNS = [
  /\b(?:permission|permissions|security|privacy)\s+(?:audit|check|status|summary|overview)\b/i,
  /\b(?:what\s+can\s+friday\s+do\s+without\s+asking)\b/i,
  /\b(?:what\s+requires\s+confirmation)\b/i,
  /\b(?:show|list)\s+(?:confirmation|permission)\s+(?:boundaries|limits|gates)\b/i,
];
const SPEAK_TEXT_PATTERNS = [
  /^(?:speak|say|read\s+aloud)\s+(.+)$/i,
  /^(?:friday|jarvis)\s+(?:speak|say)\s+(.+)$/i,
  /^(?:speak\s+this|say\s+this|read\s+this\s+aloud)[:\s]+(.+)$/i,
];
const SYSTEM_STATUS_PATTERNS = [
  /\b(?:system|device|computer|mac)\s+(?:status|info|information)\b/i,
  /\b(?:battery|power)\s+(?:status|level|info|information)\b/i,
  /\b(?:how(?:'s| is)\s+my\s+(?:system|battery|mac|computer))\b/i,
];
const NETWORK_STATUS_PATTERNS = [
  /\b(?:network|wifi|wi-fi|internet)\s+(?:status|info|information|connection)\b/i,
  /\b(?:am\s+i|are\s+we)\s+(?:online|connected)\b/i,
  /\b(?:how(?:'s| is)\s+my\s+(?:network|wifi|wi-fi|internet|connection))\b/i,
];
const STORAGE_STATUS_PATTERNS = [
  /\b(?:storage|disk|drive)\s+(?:status|info|information|space|usage)\b/i,
  /\b(?:how\s+much\s+)?(?:free\s+)?(?:space|storage)\s+(?:do\s+i\s+have|is\s+left|remaining)\b/i,
  /\b(?:how(?:'s| is)\s+my\s+(?:storage|disk|drive))\b/i,
];
const ACTIVE_WINDOW_PATTERNS = [
  /\b(?:active|current|frontmost|focused)\s+(?:app|application|window)\b/i,
  /\b(?:what\s+(?:app|application|window)\s+(?:am\s+i|is)\s+(?:using|focused|in|on))\b/i,
  /\b(?:what\s+am\s+i\s+(?:working\s+in|looking\s+at|using))\b/i,
];
const LIST_WINDOWS_PATTERNS = [
  /\b(?:list|show|view)\s+(?:open\s+|visible\s+|current\s+)?(?:windows|desktop\s+windows)\b/i,
  /\b(?:what\s+windows\s+(?:are\s+)?open)\b/i,
  /\b(?:window|desktop)\s+(?:inventory|overview|summary)\b/i,
];
const LIST_PROCESSES_PATTERNS = [
  /\b(?:list|show|view)\s+(?:running\s+)?(?:processes|apps|applications)\b/i,
  /\bwhat(?:'s| is)\s+(?:running|open)\b/i,
];
const LIST_APPLICATIONS_PATTERNS = [
  /\b(?:list|show|view)\s+(?:installed\s+)?(?:apps|applications)\b/i,
  /\bwhat\s+(?:apps|applications)\s+(?:do\s+)?(?:i\s+)?have(?:\s+installed)?\b/i,
];
const OPEN_APP_PATTERNS = [
  /\b(?:open|launch|start)\s+(?:the\s+)?(?:app|application)\s+(.+)$/i,
];
const FOCUS_APP_PATTERNS = [
  /\b(?:focus|activate)\s+(?:the\s+)?(?:app|application)\s+(.+)$/i,
  /\b(?:focus|activate)\s+(.+)$/i,
  /\b(?:bring|switch)\s+(?:to\s+)?(?:the\s+)?(?:app|application)\s+(.+)$/i,
  /\b(?:switch)\s+to\s+(.+)$/i,
  /\b(?:bring|switch)\s+(.+?)\s+(?:to\s+)?(?:front|foreground)\b/i,
];
const QUIT_APP_PATTERNS = [
  /\b(?:quit|close|exit|stop)\s+(?:the\s+)?(?:app|application)\s+(.+)$/i,
  /\b(?:quit|close|exit|stop)\s+(.+?)\s+(?:app|application)$/i,
];
const CREATE_FOLDER_PATTERNS = [
  /\b(?:create|make|new)\s+(?:a\s+)?(?:folder|directory)\s+(.+)$/i,
  /\b(?:create|make)\s+(.+)\s+(?:folder|directory)$/i,
];
const CREATE_TEXT_FILE_PATTERNS = [
  /\b(?:create|write|make)\s+(?:a\s+)?(?:text\s+|markdown\s+)?file\s+(.+?)\s+with\s+(?:content|text)\s+(.+)$/i,
  /\b(?:create|write|make)\s+(?:a\s+)?(?:text\s+|markdown\s+)?file\s+(.+?):\s*(.+)$/i,
];
const APPEND_TEXT_TO_FILE_PATTERN =
  /\b(?:append|add)\s+(.+?)\s+(?:to|into)\s+(?:the\s+)?(?:text\s+|markdown\s+)?file\s+(.+)$/i;
const APPEND_TO_TEXT_FILE_PATTERN =
  /\b(?:append|add)\s+(?:to|into)\s+(?:the\s+)?(?:text\s+|markdown\s+)?file\s+(.+?):\s*(.+)$/i;
const RENAME_PATH_PATTERNS = [
  /\brename\s+(?:the\s+)?(?:file|folder|directory|path)?\s*(.+?)\s+to\s+(.+)$/i,
];
const MOVE_PATH_PATTERNS = [
  /\bmove\s+(?:the\s+)?(?:file|folder|directory|path)?\s*(.+?)\s+to\s+(?:the\s+)?(?:folder|directory)\s+(.+)$/i,
];
const COPY_PATH_PATTERNS = [
  /\bcopy\s+(?:the\s+)?(?:file|folder|directory|path)?\s*(.+?)\s+to\s+(?:the\s+)?(?:folder|directory)\s+(.+)$/i,
];
const TRASH_PATH_PATTERNS = [
  /\b(?:trash|delete|remove)\s+(?:the\s+)?(?:file|folder|directory|path)?\s*(.+)$/i,
  /\bmove\s+(?:the\s+)?(?:file|folder|directory|path)?\s*(.+?)\s+to\s+(?:the\s+)?trash$/i,
];
const LIST_FOLDER_PATTERNS = [
  /\b(?:list|show|view)\s+(?:the\s+)?(?:folder|directory)\s+(.+)$/i,
  /\b(?:what(?:'s| is)\s+in)\s+(.+)$/i,
];
const FOLDER_TREE_PATTERNS = [
  /\b(?:show|view|print|display)\s+(?:the\s+)?(?:folder|directory)?\s*tree\s+(?:for|of)\s+(.+)$/i,
  /\b(?:tree|structure)\s+(?:of|for)\s+(?:the\s+)?(?:folder|directory)\s+(.+)$/i,
  /\b(?:show|view)\s+(?:the\s+)?(?:structure)\s+(?:of|for)\s+(.+)$/i,
];
const FOLDER_SUMMARY_PATTERNS = [
  /\b(?:summarize|analyze|inspect)\s+(?:the\s+)?(?:folder|directory)\s+(.+)$/i,
  /\b(?:folder|directory)\s+(?:summary|overview|stats|statistics)\s+(?:for|of)?\s*(.+)$/i,
  /\b(?:how\s+big|size\s+summary)\s+(?:is\s+)?(?:the\s+)?(?:folder|directory)\s+(.+)$/i,
];
const SEARCH_FILES_PATTERNS = [
  /\b(?:search|find)\s+(?:files?|folders?)\s+(.+?)\s+(?:in|inside)\s+(.+)$/i,
  /\b(?:search|find)\s+(.+?)\s+(?:in|inside)\s+(?:folder|directory)\s+(.+)$/i,
];
const SEARCH_TEXT_PATTERNS = [
  /\b(?:search|find)\s+(?:text|content)\s+(.+?)\s+(?:in|inside)\s+(?:folder|directory)\s+(.+)$/i,
  /\b(?:search|find)\s+(?:for\s+)?["“]?(.+?)["”]?\s+(?:in|inside)\s+(?:the\s+)?(?:contents?\s+of\s+)?(?:folder|directory)\s+(.+)$/i,
];
const PATH_INFO_PATTERNS = [
  /\b(?:info|details|metadata|properties)\s+(?:for|about|of)\s+(?:the\s+)?(?:file|folder|directory|path)?\s*(.+)$/i,
  /\b(?:file|folder|directory|path)\s+(?:info|details|metadata|properties)\s+(.+)$/i,
  /\b(?:stat|inspect)\s+(?:the\s+)?(?:file|folder|directory|path)\s+(.+)$/i,
];
const REVEAL_PATH_PATTERNS = [
  /\b(?:reveal|locate)\s+(?:the\s+)?(?:file|folder|directory|path)?\s*(.+?)\s+in\s+finder\b/i,
  /\b(?:show|open)\s+(?:the\s+)?(?:file|folder|directory|path)?\s*(.+?)\s+in\s+finder\b/i,
  /\b(?:reveal|locate)\s+(?:the\s+)?(?:file|folder|directory|path)\s+(.+)$/i,
];
const OPEN_PATH_PATTERNS = [
  /\b(?:open|launch)\s+(?:the\s+)?(?:file|folder|directory|path)\s+(.+?)\s+(?:with|in)\s+(?:the\s+)?default\s+(?:app|application)\b/i,
  /\b(?:open|launch)\s+(?:the\s+)?path\s+(.+)$/i,
];
const SUMMARIZE_TEXT_FILE_PATTERNS = [
  /\b(?:summarize|explain|analyze|review)\s+(?:the\s+)?(?:text\s+|markdown\s+)?file\s+(.+)$/i,
  /\b(?:summarize|explain|analyze|review)\s+(.+\.(?:txt|md|json|csv|log|yaml|yml|toml|rs|ts|tsx|js|jsx|css|html))$/i,
];
const READ_TEXT_FILE_PATTERNS = [
  /\b(?:read|show|open)\s+(?:the\s+)?(?:text\s+)?file\s+(.+)$/i,
  /\b(?:read|show)\s+(.+\.(?:txt|md|json|csv|log|yaml|yml|toml|rs|ts|tsx|js|jsx|css|html))$/i,
];
const READ_CLIPBOARD_PATTERNS = [
  /\b(?:read|show|view|what(?:'s| is) on)\s+(?:my\s+)?clipboard\b/i,
];
const WRITE_CLIPBOARD_PATTERNS = [
  /\b(?:copy|put|set)\s+(.+)\s+(?:to|on|into)\s+(?:my\s+)?clipboard$/i,
  /\b(?:copy|put|set)\s+(?:this\s+)?(?:to|on|into)\s+(?:my\s+)?clipboard:\s*(.+)$/i,
];
const SEND_NOTIFICATION_WITH_TITLE_PATTERNS = [
  /\b(?:send|show|display)\s+(?:a\s+)?notification\s+(?:called|titled)\s+(.+?)\s+(?:saying|with)\s+(.+)$/i,
  /\b(?:notify|alert)\s+me\s+(?:with|about)\s+(.+?):\s*(.+)$/i,
];
const SEND_NOTIFICATION_PATTERNS = [
  /\b(?:send|show|display)\s+(?:me\s+)?(?:a\s+)?notification\s+(?:saying|that|with)?\s*(.+)$/i,
  /\b(?:notify|alert)\s+me\s+(?:that|to|about)?\s*(.+)$/i,
];
const DAILY_BRIEFING_PATTERNS = [
  /\b(?:daily|morning|evening|today(?:'s)?)\s+(?:briefing|brief|overview|snapshot)\b/i,
  /\b(?:brief|briefing)\s+me\b/i,
  /\b(?:start|begin)\s+my\s+day\b/i,
  /\b(?:what(?:'s| is)\s+my\s+day\s+looking\s+like)\b/i,
  /\b(?:give\s+me\s+)?(?:a\s+)?(?:quick\s+)?(?:personal|system|friday)\s+briefing\b/i,
];
const PRODUCTIVITY_OVERVIEW_PATTERNS = [
  /\b(?:productivity|tasks?|todos?|to-dos?|notes?|reminders?)\s+(?:overview|summary|snapshot|brief)\b/i,
  /\b(?:what(?:'s| is)\s+on\s+my\s+plate)\b/i,
  /\b(?:brief\s+me\s+on\s+my\s+(?:work|tasks?|productivity))\b/i,
];
const SEARCH_PRODUCTIVITY_PATTERNS = [
  /\b(?:search|find)\s+(?:my\s+)?(?:productivity|tasks?|todos?|to-dos?|notes?|reminders?)\s+(?:for|about)\s+(.+)$/i,
  /\b(?:search|find)\s+(?:for\s+)?(.+?)\s+in\s+(?:my\s+)?(?:tasks?|todos?|to-dos?|notes?|reminders?)$/i,
];
const REMINDER_PATTERNS = [
  /\b(?:remind)\s+me\s+in\s+(\d+)\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?)\s+(?:to|that|about)\s+(.+)$/i,
  /\b(?:remind)\s+me\s+(?:to|that|about)\s+(.+?)\s+in\s+(\d+)\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?)$/i,
];
const LIST_REMINDERS_PATTERNS = [
  /\b(?:list|show|view)\s+(?:active\s+|my\s+)?reminders\b/i,
  /\b(?:what\s+reminders\s+(?:are\s+)?(?:active|set|scheduled))\b/i,
];
const CANCEL_REMINDER_PATTERNS = [
  /\b(?:cancel|clear|delete|remove)\s+(?:the\s+)?reminder\s+([a-z0-9_-]+)$/i,
  /\b(?:cancel|clear|delete|remove)\s+([a-z0-9_-]+)\s+reminder$/i,
];
const ADD_TODO_PATTERNS = [
  /\b(?:add|create|new)\s+(?:a\s+)?(?:todo|to-do|task)\s+(.+)$/i,
  /\b(?:add)\s+(.+?)\s+to\s+(?:my\s+)?(?:todo|to-do|task)\s+list$/i,
];
const LIST_TODOS_PATTERNS = [
  /\b(?:list|show|view)\s+(?:my\s+|active\s+)?(?:todos|to-dos|tasks|task\s+list)\b/i,
  /\b(?:what\s+(?:todos|to-dos|tasks)\s+(?:are\s+)?(?:active|open|left))\b/i,
];
const COMPLETE_TODO_PATTERNS = [
  /\b(?:complete|finish|done|mark\s+done)\s+(?:the\s+)?(?:todo|to-do|task)\s+([a-z0-9_-]+)$/i,
  /\b(?:complete|finish|done|mark\s+done)\s+([a-z0-9_-]+)$/i,
];
const ADD_NOTE_PATTERNS = [
  /\b(?:add|create|new|save)\s+(?:a\s+)?note\s+(.+)$/i,
  /\b(?:note|remember)\s+(?:this\s+)?:\s*(.+)$/i,
];
const LIST_NOTES_PATTERNS = [
  /\b(?:list|show|view)\s+(?:my\s+)?notes\b/i,
  /\b(?:what\s+notes\s+(?:do\s+i\s+have|are\s+saved))\b/i,
];
const READ_NOTE_PATTERNS = [
  /\b(?:read|show|view)\s+(?:the\s+)?note\s+([a-z0-9_-]+)$/i,
];
const DELETE_NOTE_PATTERNS = [
  /\b(?:delete|remove|clear)\s+(?:the\s+)?note\s+([a-z0-9_-]+)$/i,
];
const CAPTURE_SCREEN_PATTERNS = [
  /\b(?:take|capture|grab)\s+(?:a\s+)?(?:screenshot|screen\s*capture)\b/i,
  /\b(?:screenshot|screen\s*capture)\s+(?:my\s+)?(?:screen|desktop)\b/i,
];
const OPEN_WEBSITE_PATTERNS = [
  /\b(?:open|launch|go\s+to|visit)\s+(?:the\s+)?(?:website|site|url|webpage)\s+(.+)$/i,
  /\b(?:open|launch|go\s+to|visit)\s+((?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?)$/i,
];
const SEARCH_WEB_PATTERNS = [
  /\b(?:search|google|look\s+up)\s+(?:the\s+web\s+)?(?:for\s+)?(.+)$/i,
  /\b(?:web\s+search|internet\s+search)\s+(.+)$/i,
];
const READ_WEBPAGE_PATTERNS = [
  /\b(?:read|summarize|scan)\s+(?:the\s+)?(?:webpage|website|url|page)\s+(.+)$/i,
  /\b(?:read|summarize|scan)\s+((?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?)$/i,
];
const RESEARCH_WEB_PATTERNS = [
  /\b(?:research|investigate|find\s+sources\s+for)\s+(.+)$/i,
  /\b(?:do\s+research\s+on|research\s+the\s+web\s+for)\s+(.+)$/i,
];
const DEEP_RESEARCH_WEB_PATTERNS = [
  /\b(?:deep\s+research|research\s+deeply|do\s+deep\s+research\s+on)\s+(.+)$/i,
  /\b(?:find\s+and\s+read\s+sources\s+for|search\s+and\s+read\s+about)\s+(.+)$/i,
];

export function parseToolCommand(input: string): ToolCommand | null {
  const normalizedInput = input.trim();

  if (LIST_TOOL_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "list" };
  }

  const executeMatch = normalizedInput.match(EXECUTE_TOOL_PATTERN);
  if (executeMatch?.[1]) {
    return {
      type: "execute",
      toolId: executeMatch[1],
    };
  }

  if (DEVICE_OVERVIEW_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "deviceOverview" };
  }

  if (SELF_DIAGNOSTICS_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "selfDiagnostics" };
  }

  if (ACTIVITY_LOG_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "activityLog" };
  }

  if (FAILURE_REVIEW_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "failureReview" };
  }

  if (RETRY_PLAN_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "retryPlan" };
  }

  if (AI_PROVIDER_STATUS_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "aiProviderStatus" };
  }

  if (PERMISSION_AUDIT_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "permissionAudit" };
  }

  if (NETWORK_STATUS_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "networkStatus" };
  }

  if (STORAGE_STATUS_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "storageStatus" };
  }

  if (ACTIVE_WINDOW_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "activeWindow" };
  }

  if (LIST_WINDOWS_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "listWindows" };
  }

  if (SYSTEM_STATUS_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "systemStatus" };
  }

  if (LIST_APPLICATIONS_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "listApplications" };
  }

  if (LIST_PROCESSES_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "listProcesses" };
  }

  for (const pattern of OPEN_APP_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const appName = match?.[1]?.trim();

    if (appName) {
      return {
        type: "openApp",
        appName,
      };
    }
  }

  for (const pattern of FOCUS_APP_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const appName = match?.[1]?.trim();

    if (appName) {
      return {
        type: "focusApp",
        appName,
      };
    }
  }

  for (const pattern of QUIT_APP_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const appName = match?.[1]?.trim();

    if (appName) {
      return {
        type: "quitApp",
        appName,
      };
    }
  }

  for (const pattern of CREATE_FOLDER_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();

    if (path) {
      return {
        type: "createFolder",
        path,
      };
    }
  }

  for (const pattern of CREATE_TEXT_FILE_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();
    const content = match?.[2]?.trim();

    if (path && content) {
      return {
        type: "createTextFile",
        path,
        content,
      };
    }
  }

  const appendTextToFileMatch = normalizedInput.match(APPEND_TEXT_TO_FILE_PATTERN);
  if (appendTextToFileMatch?.[1] && appendTextToFileMatch[2]) {
    return {
      type: "appendTextFile",
      content: appendTextToFileMatch[1].trim(),
      path: appendTextToFileMatch[2].trim(),
    };
  }

  const appendToTextFileMatch = normalizedInput.match(APPEND_TO_TEXT_FILE_PATTERN);
  if (appendToTextFileMatch?.[1] && appendToTextFileMatch[2]) {
    return {
      type: "appendTextFile",
      path: appendToTextFileMatch[1].trim(),
      content: appendToTextFileMatch[2].trim(),
    };
  }

  for (const pattern of RENAME_PATH_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();
    const newName = match?.[2]?.trim();

    if (path && newName) {
      return {
        type: "renamePath",
        path,
        newName,
      };
    }
  }

  for (const pattern of MOVE_PATH_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();
    const destinationFolder = match?.[2]?.trim();

    if (path && destinationFolder) {
      return {
        type: "movePath",
        path,
        destinationFolder,
      };
    }
  }

  for (const pattern of COPY_PATH_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();
    const destinationFolder = match?.[2]?.trim();

    if (path && destinationFolder) {
      return {
        type: "copyPath",
        path,
        destinationFolder,
      };
    }
  }

  for (const pattern of TRASH_PATH_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();

    if (path) {
      return {
        type: "trashPath",
        path,
      };
    }
  }

  for (const pattern of FOLDER_TREE_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();

    if (path) {
      return {
        type: "folderTree",
        path,
      };
    }
  }

  for (const pattern of FOLDER_SUMMARY_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();

    if (path) {
      return {
        type: "folderSummary",
        path,
      };
    }
  }

  for (const pattern of LIST_FOLDER_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();

    if (path) {
      return {
        type: "listFolder",
        path,
      };
    }
  }

  for (const pattern of SEARCH_TEXT_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const query = match?.[1]?.trim();
    const path = match?.[2]?.trim();

    if (query && path) {
      return {
        type: "searchText",
        path,
        query,
      };
    }
  }

  for (const pattern of SEARCH_FILES_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const query = match?.[1]?.trim();
    const path = match?.[2]?.trim();

    if (query && path) {
      return {
        type: "searchFiles",
        path,
        query,
      };
    }
  }

  for (const pattern of PATH_INFO_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();

    if (path) {
      return {
        type: "pathInfo",
        path,
      };
    }
  }

  for (const pattern of REVEAL_PATH_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();

    if (path) {
      return {
        type: "revealPath",
        path,
      };
    }
  }

  for (const pattern of OPEN_PATH_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();

    if (path) {
      return {
        type: "openPath",
        path,
      };
    }
  }

  for (const pattern of SUMMARIZE_TEXT_FILE_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();

    if (path) {
      return {
        type: "summarizeTextFile",
        path,
      };
    }
  }

  for (const pattern of READ_TEXT_FILE_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const path = match?.[1]?.trim();

    if (path) {
      return {
        type: "readTextFile",
        path,
      };
    }
  }

  if (READ_CLIPBOARD_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "readClipboard" };
  }

  for (const pattern of WRITE_CLIPBOARD_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const text = match?.[1]?.trim();

    if (text) {
      return {
        type: "writeClipboard",
        text,
      };
    }
  }

  for (const pattern of SEND_NOTIFICATION_WITH_TITLE_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const title = match?.[1]?.trim();
    const body = match?.[2]?.trim();

    if (title && body) {
      return {
        type: "sendNotification",
        title,
        body,
      };
    }
  }

  for (const pattern of SEND_NOTIFICATION_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const body = match?.[1]?.trim();

    if (body) {
      return {
        type: "sendNotification",
        body,
      };
    }
  }

  if (DAILY_BRIEFING_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "dailyBriefing" };
  }

  if (PRODUCTIVITY_OVERVIEW_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "productivityOverview" };
  }

  for (const pattern of SEARCH_PRODUCTIVITY_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const query = match?.[1]?.trim();

    if (query) {
      return {
        type: "searchProductivity",
        query,
      };
    }
  }

  for (const pattern of REMINDER_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const first = match?.[1]?.trim();
    const second = match?.[2]?.trim();
    const third = match?.[3]?.trim();

    if (!first || !second || !third) continue;

    const startsWithDelay = /^\d+$/.test(first);
    const amount = Number(startsWithDelay ? first : second);
    const unit = startsWithDelay ? second : third;
    const text = startsWithDelay ? third : first;
    const delayMs = parseReminderDelay(amount, unit);

    if (text && delayMs !== null) {
      return {
        type: "createReminder",
        text,
        delayMs,
      };
    }
  }

  if (LIST_REMINDERS_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "listReminders" };
  }

  for (const pattern of CANCEL_REMINDER_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const reminderId = match?.[1]?.trim();

    if (reminderId) {
      return {
        type: "cancelReminder",
        reminderId,
      };
    }
  }

  for (const pattern of ADD_TODO_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const text = match?.[1]?.trim();

    if (text) {
      return {
        type: "addTodo",
        text,
      };
    }
  }

  if (LIST_TODOS_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "listTodos" };
  }

  for (const pattern of COMPLETE_TODO_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const todoId = match?.[1]?.trim();

    if (todoId) {
      return {
        type: "completeTodo",
        todoId,
      };
    }
  }

  for (const pattern of ADD_NOTE_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const text = match?.[1]?.trim();

    if (text) {
      return {
        type: "addNote",
        text,
      };
    }
  }

  if (LIST_NOTES_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "listNotes" };
  }

  for (const pattern of READ_NOTE_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const noteId = match?.[1]?.trim();

    if (noteId) {
      return {
        type: "readNote",
        noteId,
      };
    }
  }

  for (const pattern of DELETE_NOTE_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const noteId = match?.[1]?.trim();

    if (noteId) {
      return {
        type: "deleteNote",
        noteId,
      };
    }
  }

  if (CAPTURE_SCREEN_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "captureScreen" };
  }

  for (const pattern of SPEAK_TEXT_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const text = match?.[1]?.trim();

    if (text) {
      return {
        type: "speakText",
        text,
      };
    }
  }

  for (const pattern of OPEN_WEBSITE_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const target = match?.[1]?.trim();

    if (target) {
      return {
        type: "openWebsite",
        target,
      };
    }
  }

  for (const pattern of READ_WEBPAGE_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const target = match?.[1]?.trim();

    if (target) {
      return {
        type: "readWebpage",
        target,
      };
    }
  }

  for (const pattern of DEEP_RESEARCH_WEB_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const query = match?.[1]?.trim();

    if (query) {
      return {
        type: "deepResearchWeb",
        query,
      };
    }
  }

  for (const pattern of RESEARCH_WEB_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const query = match?.[1]?.trim();

    if (query) {
      return {
        type: "researchWeb",
        query,
      };
    }
  }

  for (const pattern of SEARCH_WEB_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const query = match?.[1]?.trim();

    if (query) {
      return {
        type: "searchWeb",
        query,
      };
    }
  }

  return null;
}

export async function resolveToolCommand(
  input: string,
  toolService: ToolService,
): Promise<string | null> {
  const command = parseToolCommand(input);
  if (!command) return null;

  if (command.type === "list") {
    return toolService.listTools();
  }

  if (command.type === "deviceOverview") {
    const result = await toolService.executeConfirmed({
      toolId: "system.overview",
    });

    return result.message;
  }

  if (command.type === "selfDiagnostics") {
    const result = await toolService.executeConfirmed({
      toolId: "system.self_diagnostics",
    });

    return result.message;
  }

  if (command.type === "activityLog") {
    const result = await toolService.executeConfirmed({
      toolId: "system.activity_log",
    });

    return result.message;
  }

  if (command.type === "failureReview") {
    const result = await toolService.executeConfirmed({
      toolId: "system.failure_review",
    });

    return result.message;
  }

  if (command.type === "retryPlan") {
    const result = await toolService.executeConfirmed({
      toolId: "system.retry_plan",
    });

    return result.message;
  }

  if (command.type === "aiProviderStatus") {
    const result = await toolService.executeConfirmed({
      toolId: "ai.provider_status",
    });

    return result.message;
  }

  if (command.type === "permissionAudit") {
    const result = await toolService.executeConfirmed({
      toolId: "security.permission_audit",
    });

    return result.message;
  }

  if (command.type === "systemStatus") {
    const result = await toolService.executeConfirmed({
      toolId: "system.status",
    });

    return result.message;
  }

  if (command.type === "networkStatus") {
    const result = await toolService.executeConfirmed({
      toolId: "network.status",
    });

    return result.message;
  }

  if (command.type === "storageStatus") {
    const result = await toolService.executeConfirmed({
      toolId: "storage.status",
    });

    return result.message;
  }

  if (command.type === "activeWindow") {
    const result = await toolService.executeConfirmed({
      toolId: "windows.active",
    });

    return result.message;
  }

  if (command.type === "listWindows") {
    const result = await toolService.executeConfirmed({
      toolId: "windows.list",
    });

    return result.message;
  }

  if (command.type === "listProcesses") {
    const result = await toolService.executeConfirmed({
      toolId: "process.list",
    });

    return result.message;
  }

  if (command.type === "listApplications") {
    const result = await toolService.executeConfirmed({
      toolId: "apps.list",
    });

    return result.message;
  }

  if (command.type === "openApp") {
    const result = await toolService.executeConfirmed({
      toolId: "apps.open",
      input: { appName: command.appName },
    });

    return result.message;
  }

  if (command.type === "focusApp") {
    const result = await toolService.executeConfirmed({
      toolId: "windows.focus_app",
      input: { appName: command.appName },
    });

    return result.message;
  }

  if (command.type === "quitApp") {
    const result = await toolService.executeConfirmed({
      toolId: "apps.quit",
      input: { appName: command.appName },
    });

    return result.message;
  }

  if (command.type === "createFolder") {
    const result = await toolService.executeConfirmed({
      toolId: "files.create_folder",
      input: { path: command.path },
    });

    return result.message;
  }

  if (command.type === "createTextFile") {
    const result = await toolService.executeConfirmed({
      toolId: "files.create_text_file",
      input: {
        path: command.path,
        content: command.content,
      },
    });

    return result.message;
  }

  if (command.type === "appendTextFile") {
    const result = await toolService.executeConfirmed({
      toolId: "files.append_text_file",
      input: {
        path: command.path,
        content: command.content,
      },
    });

    return result.message;
  }

  if (command.type === "renamePath") {
    const result = await toolService.executeConfirmed({
      toolId: "files.rename",
      input: {
        path: command.path,
        newName: command.newName,
      },
    });

    return result.message;
  }

  if (command.type === "movePath") {
    const result = await toolService.executeConfirmed({
      toolId: "files.move",
      input: {
        path: command.path,
        destinationFolder: command.destinationFolder,
      },
    });

    return result.message;
  }

  if (command.type === "copyPath") {
    const result = await toolService.executeConfirmed({
      toolId: "files.copy",
      input: {
        path: command.path,
        destinationFolder: command.destinationFolder,
      },
    });

    return result.message;
  }

  if (command.type === "trashPath") {
    const result = await toolService.executeConfirmed({
      toolId: "files.trash",
      input: { path: command.path },
    });

    return result.message;
  }

  if (command.type === "listFolder") {
    const result = await toolService.executeConfirmed({
      toolId: "files.list",
      input: { path: command.path },
    });

    return result.message;
  }

  if (command.type === "folderTree") {
    const result = await toolService.executeConfirmed({
      toolId: "files.tree",
      input: { path: command.path },
    });

    return result.message;
  }

  if (command.type === "folderSummary") {
    const result = await toolService.executeConfirmed({
      toolId: "files.summary",
      input: { path: command.path },
    });

    return result.message;
  }

  if (command.type === "searchFiles") {
    const result = await toolService.executeConfirmed({
      toolId: "files.search",
      input: {
        path: command.path,
        query: command.query,
      },
    });

    return result.message;
  }

  if (command.type === "searchText") {
    const result = await toolService.executeConfirmed({
      toolId: "files.search_text",
      input: {
        path: command.path,
        query: command.query,
      },
    });

    return result.message;
  }

  if (command.type === "pathInfo") {
    const result = await toolService.executeConfirmed({
      toolId: "files.info",
      input: { path: command.path },
    });

    return result.message;
  }

  if (command.type === "revealPath") {
    const result = await toolService.executeConfirmed({
      toolId: "files.reveal",
      input: { path: command.path },
    });

    return result.message;
  }

  if (command.type === "openPath") {
    const result = await toolService.executeConfirmed({
      toolId: "files.open",
      input: { path: command.path },
    });

    return result.message;
  }

  if (command.type === "readTextFile") {
    const result = await toolService.executeConfirmed({
      toolId: "files.read",
      input: { path: command.path },
    });

    return result.message;
  }

  if (command.type === "summarizeTextFile") {
    const result = await toolService.executeConfirmed({
      toolId: "files.read",
      input: { path: command.path },
    });

    return result.message;
  }

  if (command.type === "readClipboard") {
    const result = await toolService.executeConfirmed({
      toolId: "clipboard.read",
    });

    return result.message;
  }

  if (command.type === "writeClipboard") {
    const result = await toolService.executeConfirmed({
      toolId: "clipboard.write",
      input: { text: command.text },
    });

    return result.message;
  }

  if (command.type === "sendNotification") {
    const result = await toolService.executeConfirmed({
      toolId: "notifications.send",
      input: {
        title: command.title,
        body: command.body,
      },
    });

    return result.message;
  }

  if (command.type === "dailyBriefing") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.briefing",
    });
    return result.message;
  }

  if (command.type === "productivityOverview") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.overview",
    });

    return result.message;
  }

  if (command.type === "searchProductivity") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.search",
      input: { query: command.query },
    });

    return result.message;
  }

  if (command.type === "createReminder") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.reminder.create",
      input: {
        text: command.text,
        delayMs: command.delayMs,
      },
    });

    return result.message;
  }

  if (command.type === "listReminders") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.reminder.list",
    });

    return result.message;
  }

  if (command.type === "cancelReminder") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.reminder.cancel",
      input: { reminderId: command.reminderId },
    });

    return result.message;
  }

  if (command.type === "addTodo") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.todo.add",
      input: { text: command.text },
    });

    return result.message;
  }

  if (command.type === "listTodos") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.todo.list",
    });

    return result.message;
  }

  if (command.type === "completeTodo") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.todo.complete",
      input: { todoId: command.todoId },
    });

    return result.message;
  }

  if (command.type === "addNote") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.note.add",
      input: { text: command.text },
    });

    return result.message;
  }

  if (command.type === "listNotes") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.note.list",
    });

    return result.message;
  }

  if (command.type === "readNote") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.note.read",
      input: { noteId: command.noteId },
    });

    return result.message;
  }

  if (command.type === "deleteNote") {
    const result = await toolService.executeConfirmed({
      toolId: "productivity.note.delete",
      input: { noteId: command.noteId },
    });

    return result.message;
  }

  if (command.type === "captureScreen") {
    const result = await toolService.executeConfirmed({
      toolId: "screen.capture",
    });

    return result.message;
  }

  if (command.type === "speakText") {
    const result = await toolService.executeConfirmed({
      toolId: "voice.speak",
      input: { text: command.text },
    });

    return result.message;
  }

  if (command.type === "openWebsite") {
    const result = await toolService.executeConfirmed({
      toolId: "browser.open",
      input: { target: command.target },
    });

    return result.message;
  }

  if (command.type === "searchWeb") {
    const result = await toolService.executeConfirmed({
      toolId: "browser.search",
      input: { query: command.query },
    });

    return result.message;
  }

  if (command.type === "readWebpage") {
    const result = await toolService.executeConfirmed({
      toolId: "browser.read",
      input: { target: command.target },
    });

    return result.message;
  }

  if (command.type === "researchWeb") {
    const result = await toolService.executeConfirmed({
      toolId: "browser.research",
      input: { query: command.query },
    });

    return result.message;
  }

  if (command.type === "deepResearchWeb") {
    const result = await toolService.executeConfirmed({
      toolId: "browser.deep_research",
      input: { query: command.query },
    });

    return result.message;
  }

  const result = toolService.execute({ toolId: command.toolId });
  return result.message;
}

function parseReminderDelay(amount: number, unit: string): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const normalizedUnit = unit.toLowerCase();
  if (/^s(ec|ecs|econd|econds)?$/.test(normalizedUnit)) {
    return amount * 1000;
  }

  if (/^m(in|ins|inute|inutes)?$/.test(normalizedUnit)) {
    return amount * 60 * 1000;
  }

  if (/^h(r|rs|our|ours)?$/.test(normalizedUnit)) {
    return amount * 60 * 60 * 1000;
  }

  return null;
}
