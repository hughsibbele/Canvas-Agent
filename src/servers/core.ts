#!/usr/bin/env node
// Core MCP server (79 tools): the daily teaching/grading workbench.
// Phase 2: built but not yet wired to the canvas-agent bin.
// Phase 3: cli.ts's no-subcommand path will delegate here.

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCoursesCore } from "../tools/courses.js";
import { registerAssignmentsCore } from "../tools/assignments.js";
import { registerDiscussionsCore } from "../tools/discussions.js";
import { registerSchedulingCore } from "../tools/scheduling.js";
import { registerSubmissionsCore } from "../tools/submissions.js";
import { registerRubricsCore } from "../tools/rubrics.js";
import { registerNewQuizzesCore } from "../tools/new-quizzes.js";
import { registerGradingCore } from "../tools/grading.js";
import { registerEnrollmentsCore } from "../tools/enrollments.js";
import { registerAnalyticsCore } from "../tools/analytics.js";
import { registerCalendarCore } from "../tools/calendar.js";
import { registerModulesCore } from "../tools/modules.js";
import { registerCommunicationCore } from "../tools/communication.js";

const server = new McpServer({
  name: "canvas-agent-core",
  version: "1.0.0",
});

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

const transport = new StdioServerTransport();
await server.connect(transport);
