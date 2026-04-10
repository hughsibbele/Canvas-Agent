import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerCourseTools(server: McpServer) {
  server.tool(
    "list_courses",
    "List Canvas courses you have access to. Returns course IDs needed by all other tools. Shows active courses by default. Admins can use search_term to search all courses in the account.",
    {
      enrollment_state: z
        .enum(["active", "completed", "invited"])
        .default("active")
        .describe("Filter by enrollment state"),
      search_term: z
        .string()
        .optional()
        .describe(
          "Search all courses by name or code (admin only). When provided, searches across the entire account instead of just enrolled courses."
        ),
    },
    async ({ enrollment_state, search_term }) => {
      let courses;
      if (search_term) {
        courses = await canvasAll("/accounts/self/courses", {
          search_term,
          include: "term",
        });
      } else {
        courses = await canvasAll("/courses", {
          enrollment_state,
          include: "term",
        });
      }
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

  server.tool(
    "list_grading_periods",
    "List the grading periods (e.g. semesters, quarters) defined for a course's term. Returns id, title, start_date, end_date, and is_closed for each period. The returned IDs can be passed as grading_period_id to get_student_enrollments and other grade-related tools to scope grades and submissions to a single period instead of the cumulative lifetime grade. Note: schools that don't use grading periods will get a single default period.",
    { course_id: z.string().describe("Canvas course ID") },
    async ({ course_id }) => {
      // The grading_periods endpoint returns a wrapped response:
      // {"grading_periods": [...], "meta": {...}}
      // Use canvas (not canvasAll) and unwrap manually.
      const raw: any = await canvas(`/courses/${course_id}/grading_periods`);
      const periods = (raw?.grading_periods ?? []) as any[];
      const summary = periods.map((p) => ({
        id: p.id,
        title: p.title,
        start_date: p.start_date,
        end_date: p.end_date,
        close_date: p.close_date,
        is_closed: p.is_closed,
        weight: p.weight,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );
}
