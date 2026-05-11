import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCoursesCore, registerCoursesAdmin } from "./tools/courses.js";
import { registerAssignmentsCore } from "./tools/assignments.js";
import { registerDiscussionsCore } from "./tools/discussions.js";
import { registerQuizzesExtras } from "./tools/quizzes.js";
import { registerSchedulingCore, registerSchedulingExtras } from "./tools/scheduling.js";
import { registerSubmissionsCore } from "./tools/submissions.js";
import { registerRubricsCore } from "./tools/rubrics.js";
import { registerNewQuizzesCore } from "./tools/new-quizzes.js";
import { registerGradingCore, registerGradingExtras } from "./tools/grading.js";
import { registerPagesExtras } from "./tools/pages.js";
import { registerEnrollmentsCore, registerEnrollmentsAdmin } from "./tools/enrollments.js";
import { registerAnalyticsCore, registerAnalyticsExtras } from "./tools/analytics.js";
import { registerCalendarCore } from "./tools/calendar.js";
import { registerFilesExtras } from "./tools/files.js";
import { registerModulesCore } from "./tools/modules.js";
import { registerCommunicationCore, registerCommunicationExtras } from "./tools/communication.js";
import { registerGroupsExtras } from "./tools/groups.js";
import { registerOutcomesExtras } from "./tools/outcomes.js";

const server = new McpServer({
  name: "canvas-agent",
  version: "1.0.0",
});

// Phase 1: register all three buckets so the v1 surface (133 tools) is preserved.
// Phase 2 will introduce dedicated server entry points that import only their bucket.

// Core (79 tools)
registerCoursesCore(server);
registerAssignmentsCore(server);
registerDiscussionsCore(server);
registerSchedulingCore(server);
registerSubmissionsCore(server);
registerRubricsCore(server);
registerNewQuizzesCore(server);
registerGradingCore(server);
registerEnrollmentsCore(server);
registerAnalyticsCore(server);
registerCalendarCore(server);
registerModulesCore(server);
registerCommunicationCore(server);

// Admin (18 tools)
registerCoursesAdmin(server);
registerEnrollmentsAdmin(server);

// Extras (36 tools)
registerQuizzesExtras(server);
registerPagesExtras(server);
registerFilesExtras(server);
registerGroupsExtras(server);
registerOutcomesExtras(server);
registerCommunicationExtras(server);
registerGradingExtras(server);
registerAnalyticsExtras(server);
registerSchedulingExtras(server);

// Connect via stdio (Claude Code launches this as a subprocess)
const transport = new StdioServerTransport();
await server.connect(transport);
