import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerEnrollmentTools(server: McpServer) {
  server.tool(
    "list_students",
    "List students enrolled in a course with enrollment-specific data (section, activity, last login). For a simpler user list with any role (teachers, TAs, etc.), use list_users_in_course instead.",
    {
      course_id: z.string().describe("Canvas course ID"),
      section_id: z
        .string()
        .optional()
        .describe("Filter to a specific section"),
      state: z
        .array(z.enum(["active", "invited", "completed", "inactive"]))
        .optional()
        .describe("Filter by enrollment state(s)"),
    },
    async ({ course_id, section_id, state }) => {
      const params: Record<string, string> = {
        "type[]": "StudentEnrollment",
      };
      if (section_id) params.section_id = section_id;
      if (state) params["state[]"] = state.join(",");

      const enrollments = await canvasAll(
        `/courses/${course_id}/enrollments`,
        params
      );
      const summary = enrollments.map((e: any) => ({
        user_id: e.user_id,
        name: e.user?.name ?? null,
        sortable_name: e.user?.sortable_name ?? null,
        email: e.user?.email ?? null,
        section_id: e.course_section_id,
        enrollment_state: e.enrollment_state,
        last_activity_at: e.last_activity_at,
        total_activity_time_seconds: e.total_activity_time,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "list_sections",
    "List sections in a course. Optionally include enrolled students.",
    {
      course_id: z.string().describe("Canvas course ID"),
      include_students: z
        .boolean()
        .optional()
        .describe("Include student enrollments in each section"),
    },
    async ({ course_id, include_students }) => {
      const params: Record<string, string> = {};
      if (include_students) params["include[]"] = "students";

      const sections = await canvasAll(
        `/courses/${course_id}/sections`,
        params
      );
      return {
        content: [{ type: "text", text: JSON.stringify(sections, null, 2) }],
      };
    }
  );

  server.tool(
    "get_student_enrollments",
    "Get enrollment details for a specific student in a course, including grades if available. Pass grading_period_id to get the grade for a specific semester/term instead of the cumulative lifetime grade — find the id with list_grading_periods.",
    {
      course_id: z.string().describe("Canvas course ID"),
      student_id: z.string().describe("Canvas user ID of the student"),
      grading_period_id: z
        .string()
        .optional()
        .describe(
          "Grading period ID to scope grades to a single semester/term. Without this, current_score reflects the entire course history. Use list_grading_periods to discover ids."
        ),
    },
    async ({ course_id, student_id, grading_period_id }) => {
      const params: Record<string, string> = { user_id: student_id };
      if (grading_period_id) params.grading_period_id = grading_period_id;
      const enrollments = await canvasAll(
        `/courses/${course_id}/enrollments`,
        params
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(enrollments, null, 2) },
        ],
      };
    }
  );

  server.tool(
    "list_users_in_course",
    "List users in a course by role (teacher, student, ta, observer). Simpler output than list_students — use list_students when you need enrollment details like section, activity time, or state.",
    {
      course_id: z.string().describe("Canvas course ID"),
      enrollment_type: z
        .enum(["teacher", "student", "ta", "observer", "designer"])
        .optional()
        .describe("Filter by enrollment role"),
      search_term: z
        .string()
        .optional()
        .describe("Filter by name or email substring"),
      include_email: z
        .boolean()
        .optional()
        .describe("Include email addresses in results"),
    },
    async ({ course_id, enrollment_type, search_term, include_email }) => {
      const params: Record<string, string> = {};
      if (enrollment_type) params.enrollment_type = enrollment_type;
      if (search_term) params.search_term = search_term;
      if (include_email) params["include[]"] = "email";

      const users = await canvasAll(
        `/courses/${course_id}/users`,
        params
      );
      const summary = users.map((u: any) => ({
        id: u.id,
        name: u.name,
        sortable_name: u.sortable_name,
        email: u.email ?? null,
        created_at: u.created_at,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "get_user_profile",
    "Get any user's profile information including name, email, and bio. Works for students, teachers, and any Canvas user.",
    {
      user_id: z.string().describe("Canvas user ID"),
    },
    async ({ user_id }) => {
      const profile = await canvas(`/users/${user_id}/profile`);
      return {
        content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
      };
    }
  );
}
