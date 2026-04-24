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
    "crosslist_section",
    "Move a section from its current course into a different course. Students, submissions, and grades in that section all follow it into the destination course. This is a significant action — confirm with the user before calling, and double-check you have the correct section_id (from list_sections on the source course) and new_course_id (from list_courses). To reverse, use decrosslist_section.",
    {
      section_id: z
        .string()
        .describe(
          "Canvas section ID to move. Get this from list_sections on the section's current (source) course."
        ),
      new_course_id: z
        .string()
        .describe("Canvas course ID of the destination course to move the section into."),
    },
    async ({ section_id, new_course_id }) => {
      const result = await canvas(
        `/sections/${section_id}/crosslist/${new_course_id}`,
        { method: "POST" }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "decrosslist_section",
    "Undo a crosslist — move a section back to its original course. Only works on sections that were previously crosslisted.",
    {
      section_id: z.string().describe("Canvas section ID to de-crosslist"),
    },
    async ({ section_id }) => {
      const result = await canvas(`/sections/${section_id}/crosslist`, {
        method: "DELETE",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "create_section",
    "Create a new section within a course. Useful for splitting a class into smaller groups with their own due dates or rosters.",
    {
      course_id: z.string().describe("Canvas course ID"),
      name: z.string().describe("Section name (shown to students)"),
      start_at: z
        .string()
        .optional()
        .describe("Section start date (ISO 8601)"),
      end_at: z.string().optional().describe("Section end date (ISO 8601)"),
      restrict_enrollments_to_section_dates: z
        .boolean()
        .optional()
        .describe(
          "If true, students only have access between start_at and end_at."
        ),
      sis_section_id: z
        .string()
        .optional()
        .describe("Optional SIS id (admin-only)"),
    },
    async ({ course_id, ...fields }) => {
      const course_section: any = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) course_section[k] = v;
      }
      const result = await canvas(`/courses/${course_id}/sections`, {
        method: "POST",
        body: JSON.stringify({ course_section }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Created section "${result.name}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_section",
    "Update a section's name, dates, or enrollment restrictions.",
    {
      section_id: z.string().describe("Canvas section ID"),
      name: z.string().optional(),
      start_at: z.string().optional().describe("ISO 8601"),
      end_at: z.string().optional().describe("ISO 8601"),
      restrict_enrollments_to_section_dates: z.boolean().optional(),
    },
    async ({ section_id, ...fields }) => {
      const course_section: any = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) course_section[k] = v;
      }
      const result = await canvas(`/sections/${section_id}`, {
        method: "PUT",
        body: JSON.stringify({ course_section }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "delete_section",
    "⚠️ DESTRUCTIVE — DELETES A SECTION. Only succeeds if the section has zero enrollments (Canvas refuses otherwise). Confirm with the user before calling and double-check the section_id is correct.",
    {
      section_id: z.string().describe("Canvas section ID"),
      confirm_name: z
        .string()
        .describe("Type the section name to confirm deletion (safety check)"),
    },
    async ({ section_id, confirm_name }) => {
      const section = await canvas(`/sections/${section_id}`);
      if (section.name !== confirm_name) {
        return {
          content: [
            {
              type: "text",
              text: `Safety check failed: section name is "${section.name}" but you confirmed "${confirm_name}". Delete aborted.`,
            },
          ],
        };
      }
      const result = await canvas(`/sections/${section_id}`, {
        method: "DELETE",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "enroll_user",
    "Enroll a user (student, teacher, TA, observer, or designer) in a course or specific section. By default the enrollment is created in 'invited' state — pass enrollment_state='active' to skip the invitation step (typical for SIS-style adds).",
    {
      course_id: z.string().describe("Canvas course ID"),
      user_id: z.string().describe("Canvas user ID to enroll"),
      type: z
        .enum([
          "StudentEnrollment",
          "TeacherEnrollment",
          "TaEnrollment",
          "ObserverEnrollment",
          "DesignerEnrollment",
        ])
        .default("StudentEnrollment")
        .describe("Enrollment role"),
      section_id: z
        .string()
        .optional()
        .describe(
          "Specific section to enroll into. Omit for the course's default section."
        ),
      enrollment_state: z
        .enum(["active", "invited", "inactive"])
        .default("active")
        .describe(
          "Initial state. 'active' = enrolled immediately (no invite email)."
        ),
      notify: z
        .boolean()
        .default(false)
        .describe("Send the user a notification email"),
      limit_privileges_to_course_section: z
        .boolean()
        .optional()
        .describe(
          "Restrict the user to only see other users in the same section (often used for TAs)."
        ),
    },
    async ({
      course_id,
      user_id,
      type,
      section_id,
      enrollment_state,
      notify,
      limit_privileges_to_course_section,
    }) => {
      const enrollment: any = {
        user_id,
        type,
        enrollment_state,
        notify,
      };
      if (section_id) enrollment.course_section_id = section_id;
      if (limit_privileges_to_course_section !== undefined) {
        enrollment.limit_privileges_to_course_section =
          limit_privileges_to_course_section;
      }
      // The enroll endpoint hangs the section_id off the URL when you want
      // to target a specific section.
      const path = section_id
        ? `/sections/${section_id}/enrollments`
        : `/courses/${course_id}/enrollments`;
      const result = await canvas(path, {
        method: "POST",
        body: JSON.stringify({ enrollment }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Enrolled user ${user_id} as ${type} (enrollment ID: ${result.id}, state: ${result.enrollment_state})`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_enrollment_state",
    "Drop or reactivate an enrollment without deleting it. 'conclude' ends participation but keeps grades visible. 'inactivate' soft-removes (admin term), 'deactivate' is the user-facing equivalent. 'reactivate' restores a previously inactive enrollment to active. To find the enrollment_id, use get_student_enrollments.",
    {
      course_id: z.string().describe("Canvas course ID"),
      enrollment_id: z
        .string()
        .describe(
          "Canvas enrollment id (NOT user id). Get from get_student_enrollments."
        ),
      task: z
        .enum(["conclude", "inactivate", "deactivate", "reactivate"])
        .describe(
          "Lifecycle transition: conclude=end participation, deactivate/inactivate=soft remove, reactivate=restore."
        ),
    },
    async ({ course_id, enrollment_id, task }) => {
      // 'reactivate' is a separate endpoint
      if (task === "reactivate") {
        const result = await canvas(
          `/courses/${course_id}/enrollments/${enrollment_id}/reactivate`,
          { method: "PUT" }
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }
      const result = await canvas(
        `/courses/${course_id}/enrollments/${enrollment_id}?task=${task}`,
        { method: "DELETE" }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "delete_enrollment",
    "⚠️ DESTRUCTIVE — HARD-DELETES AN ENROLLMENT. The user vanishes from the course roster and their submissions, grades, and participation history are removed. There is NO undo. In nearly every real scenario you want update_enrollment_state with task='deactivate' (soft-remove, reversible) or task='conclude' (end-of-term) instead. Only call delete_enrollment when the user has explicitly said \"hard delete\" or \"permanently remove\" and named the user. Confirm before invoking.",
    {
      course_id: z.string().describe("Canvas course ID"),
      enrollment_id: z.string().describe("Canvas enrollment id"),
      confirm_user_name: z
        .string()
        .describe(
          "Type the enrolled user's name to confirm deletion (safety check)"
        ),
    },
    async ({ course_id, enrollment_id, confirm_user_name }) => {
      const enrollment = await canvas(
        `/courses/${course_id}/enrollments/${enrollment_id}`
      );
      const actualName = enrollment.user?.name ?? enrollment.user_name;
      if (actualName !== confirm_user_name) {
        return {
          content: [
            {
              type: "text",
              text: `Safety check failed: enrolled user is "${actualName}" but you confirmed "${confirm_user_name}". Delete aborted.`,
            },
          ],
        };
      }
      const result = await canvas(
        `/courses/${course_id}/enrollments/${enrollment_id}?task=delete`,
        { method: "DELETE" }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "move_student_to_section",
    "Move a student from one section to another within the same course. Implemented as deactivate + re-enroll, which preserves their submissions and grades. Use this rather than deleting and re-creating.",
    {
      course_id: z.string().describe("Canvas course ID"),
      user_id: z.string().describe("Canvas user id of the student"),
      from_enrollment_id: z
        .string()
        .describe(
          "Current enrollment id to deactivate (find via get_student_enrollments)"
        ),
      to_section_id: z
        .string()
        .describe("Section id to move the student into"),
    },
    async ({ course_id, user_id, from_enrollment_id, to_section_id }) => {
      await canvas(
        `/courses/${course_id}/enrollments/${from_enrollment_id}?task=deactivate`,
        { method: "DELETE" }
      );
      const enrollment = {
        user_id,
        type: "StudentEnrollment",
        enrollment_state: "active",
        course_section_id: to_section_id,
        notify: false,
      };
      const result = await canvas(`/sections/${to_section_id}/enrollments`, {
        method: "POST",
        body: JSON.stringify({ enrollment }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Moved user ${user_id} into section ${to_section_id} (new enrollment ID: ${result.id}). Old enrollment ${from_enrollment_id} is now inactive.`,
          },
        ],
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
