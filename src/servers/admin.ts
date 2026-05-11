#!/usr/bin/env node
// Admin MCP server (18 tools): course/section/enrollment lifecycle.
// Mount this when doing setup / org-admin work.

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCoursesAdmin } from "../tools/courses.js";
import { registerEnrollmentsAdmin } from "../tools/enrollments.js";

const server = new McpServer({
  name: "canvas-agent-admin",
  version: "1.0.0",
});

registerCoursesAdmin(server);
registerEnrollmentsAdmin(server);

const transport = new StdioServerTransport();
await server.connect(transport);
