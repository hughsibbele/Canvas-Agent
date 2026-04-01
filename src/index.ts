import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCourseTools } from "./tools/courses.js";
import { registerAssignmentTools } from "./tools/assignments.js";
import { registerDiscussionTools } from "./tools/discussions.js";
import { registerQuizTools } from "./tools/quizzes.js";
import { registerSchedulingTools } from "./tools/scheduling.js";
import { registerSubmissionTools } from "./tools/submissions.js";
import { registerRubricTools } from "./tools/rubrics.js";
import { registerNewQuizTools } from "./tools/new-quizzes.js";
import { registerGradingTools } from "./tools/grading.js";
import { registerPageTools } from "./tools/pages.js";
import { registerEnrollmentTools } from "./tools/enrollments.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerFileTools } from "./tools/files.js";
import { registerModuleTools } from "./tools/modules.js";

const server = new McpServer({
  name: "canvas-agent",
  version: "1.0.0",
});

// Register all tool groups
registerCourseTools(server);
registerAssignmentTools(server);
registerDiscussionTools(server);
registerQuizTools(server);
registerSchedulingTools(server);
registerSubmissionTools(server);
registerRubricTools(server);
registerNewQuizTools(server);
registerGradingTools(server);
registerPageTools(server);
registerEnrollmentTools(server);
registerAnalyticsTools(server);
registerCalendarTools(server);
registerFileTools(server);
registerModuleTools(server);

// Connect via stdio (Claude Code launches this as a subprocess)
const transport = new StdioServerTransport();
await server.connect(transport);
