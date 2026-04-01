import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvasAll } from "../canvas-client.js";

export function registerCourseTools(server: McpServer) {
  server.tool(
    "list_courses",
    "List Canvas courses you have access to. Returns course IDs needed by all other tools. Shows active courses by default.",
    {
      enrollment_state: z
        .enum(["active", "completed", "invited"])
        .default("active")
        .describe("Filter by enrollment state"),
    },
    async ({ enrollment_state }) => {
      const courses = await canvasAll("/courses", {
        enrollment_state,
        include: "term",
      });
      const summary = courses.map((c: any) => ({
        id: c.id,
        name: c.name,
        course_code: c.course_code,
        term: c.term?.name,
        workflow_state: c.workflow_state,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "list_assignment_groups",
    "List assignment groups (grading categories) in a course with their weights. The returned group IDs are used as assignment_group_id when creating or updating assignments.",
    { course_id: z.string().describe("Canvas course ID") },
    async ({ course_id }) => {
      const groups = await canvasAll(
        `/courses/${course_id}/assignment_groups`
      );
      const summary = groups.map((g: any) => ({
        id: g.id,
        name: g.name,
        position: g.position,
        group_weight: g.group_weight,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "list_modules",
    "List modules in a course. For module management (create, update, delete, add items), see create_module, update_module, add_module_item, and related tools.",
    {
      course_id: z.string().describe("Canvas course ID"),
      include_items: z
        .boolean()
        .default(false)
        .describe("Include module items in the response"),
    },
    async ({ course_id, include_items }) => {
      const params: Record<string, string> = {};
      if (include_items) params.include = "items";
      const modules = await canvasAll(
        `/courses/${course_id}/modules`,
        params
      );
      return {
        content: [{ type: "text", text: JSON.stringify(modules, null, 2) }],
      };
    }
  );
}
