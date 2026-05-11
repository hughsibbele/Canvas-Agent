#!/usr/bin/env node
// Extras MCP server (36 tools): outcomes, groups, pages, files, classic quizzes,
// late policy, messaging, announcements. Mount this for project-specific work
// outside the daily teaching/grading loop.

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerQuizzesExtras } from "../tools/quizzes.js";
import { registerPagesExtras } from "../tools/pages.js";
import { registerFilesExtras } from "../tools/files.js";
import { registerGroupsExtras } from "../tools/groups.js";
import { registerOutcomesExtras } from "../tools/outcomes.js";
import { registerCommunicationExtras } from "../tools/communication.js";
import { registerGradingExtras } from "../tools/grading.js";
import { registerAnalyticsExtras } from "../tools/analytics.js";
import { registerSchedulingExtras } from "../tools/scheduling.js";

const server = new McpServer({
  name: "canvas-agent-extras",
  version: "1.0.0",
});

registerQuizzesExtras(server);
registerPagesExtras(server);
registerFilesExtras(server);
registerGroupsExtras(server);
registerOutcomesExtras(server);
registerCommunicationExtras(server);
registerGradingExtras(server);
registerAnalyticsExtras(server);
registerSchedulingExtras(server);

const transport = new StdioServerTransport();
await server.connect(transport);
