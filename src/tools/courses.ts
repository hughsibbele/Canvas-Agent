import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerCoursesCore(server: McpServer) {
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
        term_id: c.term?.id,
        workflow_state: c.workflow_state,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "list_terms",
    "List enrollment terms (semesters/quarters) defined in the account. Returns each term's id, name, and start/end dates. Use the returned id as enrollment_term_id in list_term_courses or create_course.",
    {
      workflow_state: z
        .enum(["active", "deleted", "all"])
        .default("active")
        .describe("Filter by term workflow state"),
    },
    async ({ workflow_state }) => {
      // /accounts/:id/terms returns a wrapped response: { enrollment_terms: [...] }
      const raw: any = await canvas(
        `/accounts/self/terms?workflow_state[]=${workflow_state}&per_page=100`
      );
      const terms = (raw?.enrollment_terms ?? []) as any[];
      const summary = terms.map((t) => ({
        id: t.id,
        name: t.name,
        start_at: t.start_at,
        end_at: t.end_at,
        sis_term_id: t.sis_term_id,
        workflow_state: t.workflow_state,
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

export function registerCoursesAdmin(server: McpServer) {
  server.tool(
    "list_term_courses",
    "List every course in a given enrollment term across the account (admin only). Useful for term-wide audits — e.g., finding every unpublished course or every section a teacher owns this semester. Discover the enrollment_term_id by running list_courses and reading the term_id field on any course in the desired term.",
    {
      enrollment_term_id: z
        .string()
        .describe(
          "Canvas enrollment term ID. Find this by running list_courses and reading term_id on any course in the desired term."
        ),
      state: z
        .array(z.enum(["unpublished", "available", "completed", "deleted"]))
        .optional()
        .describe(
          "Filter by workflow_state(s). Omit to return all states."
        ),
      include_teachers: z
        .boolean()
        .default(false)
        .describe(
          "Include the teachers array on each course (id and display_name). Useful for grouping courses by instructor."
        ),
      search_term: z
        .string()
        .optional()
        .describe(
          "Optional substring filter on course name or code (Canvas requires 2+ chars)."
        ),
    },
    async ({ enrollment_term_id, state, include_teachers, search_term }) => {
      const params: Record<string, string | string[]> = {
        enrollment_term_id,
        "include[]": include_teachers ? ["term", "teachers"] : ["term"],
      };
      if (search_term) params.search_term = search_term;

      const courses = await canvasAll("/accounts/self/courses", params);

      // Filter workflow_state client-side: Canvas's `state[]` query param uses
      // internal names (created/claimed) that don't match the response strings
      // (unpublished/available), so it's simpler and less error-prone to
      // filter here against the values users actually see.
      const filtered = state
        ? courses.filter((c: any) => state.includes(c.workflow_state))
        : courses;

      const summary = filtered.map((c: any) => ({
        id: c.id,
        name: c.name,
        course_code: c.course_code,
        term: c.term?.name,
        term_id: c.term?.id,
        workflow_state: c.workflow_state,
        ...(include_teachers
          ? {
              teachers: (c.teachers ?? []).map((t: any) => ({
                id: t.id,
                display_name: t.display_name,
              })),
            }
          : {}),
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "create_course",
    "Create a new course shell in the account. Returns the new course id. After creation, use update_course_settings to publish, copy_course_content to seed content, enroll_user to add people.",
    {
      name: z.string().describe("Course name (shown to students)"),
      course_code: z
        .string()
        .optional()
        .describe("Short course code (e.g. 'ENG101-PA-Smith')"),
      enrollment_term_id: z
        .string()
        .optional()
        .describe(
          "Enrollment term to place the course in. Find via list_terms. Omit to use the account default."
        ),
      start_at: z
        .string()
        .optional()
        .describe("Course start date (ISO 8601)"),
      end_at: z.string().optional().describe("Course end date (ISO 8601)"),
      sis_course_id: z
        .string()
        .optional()
        .describe("Optional SIS course id (admin-only)"),
    },
    async ({ name, course_code, enrollment_term_id, start_at, end_at, sis_course_id }) => {
      const course: any = { name };
      if (course_code) course.course_code = course_code;
      if (enrollment_term_id) course.term_id = enrollment_term_id;
      if (start_at) course.start_at = start_at;
      if (end_at) course.end_at = end_at;
      if (sis_course_id) course.sis_course_id = sis_course_id;
      const result = await canvas(`/accounts/self/courses`, {
        method: "POST",
        body: JSON.stringify({ course }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Created course "${result.name}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_course_settings",
    "Update a course's basic settings — name, code, dates, term, default view, and publish state. Pass event='offer' to publish or event='claim' to unpublish.",
    {
      course_id: z.string().describe("Canvas course ID"),
      name: z.string().optional().describe("New course name"),
      course_code: z.string().optional().describe("New short code"),
      enrollment_term_id: z
        .string()
        .optional()
        .describe("Move the course to a different term"),
      start_at: z.string().optional().describe("Course start date (ISO 8601)"),
      end_at: z.string().optional().describe("Course end date (ISO 8601)"),
      default_view: z
        .enum(["feed", "wiki", "modules", "assignments", "syllabus"])
        .optional()
        .describe("Course home page layout"),
      syllabus_body: z
        .string()
        .optional()
        .describe("HTML for the Syllabus page"),
      event: z
        .enum(["offer", "claim", "conclude", "delete", "undelete"])
        .optional()
        .describe(
          "Lifecycle action: offer=publish, claim=unpublish, conclude=end course, delete=remove (use delete_course instead), undelete=restore."
        ),
    },
    async ({ course_id, event, ...fields }) => {
      const course: any = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) {
          if (k === "enrollment_term_id") course.term_id = v;
          else course[k] = v;
        }
      }
      const body: any = { course };
      if (event) body.event = event;
      const result = await canvas(`/courses/${course_id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "conclude_course",
    "Mark a course as concluded (end of term). Students lose write access but keep read access. Reversible by re-publishing via update_course_settings with event='offer'.",
    { course_id: z.string().describe("Canvas course ID") },
    async ({ course_id }) => {
      const result = await canvas(`/courses/${course_id}?event=conclude`, {
        method: "DELETE",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "delete_course",
    "⚠️ DESTRUCTIVE — PERMANENTLY DELETES A COURSE. The course is removed from the gradebook, hidden from everyone, and effectively unrecoverable through the UI (only an admin can restore from the deleted-objects audit log, and only briefly). Wipes implied access to assignments, modules, files, and grades. NEVER call without explicit user confirmation that names the course by id and title. For end-of-term wind-down, use conclude_course instead — that is reversible.",
    {
      course_id: z.string().describe("Canvas course ID"),
      confirm_name: z
        .string()
        .describe("Type the course name to confirm deletion (safety check)"),
    },
    async ({ course_id, confirm_name }) => {
      const course = await canvas(`/courses/${course_id}`);
      if (course.name !== confirm_name) {
        return {
          content: [
            {
              type: "text",
              text: `Safety check failed: course name is "${course.name}" but you confirmed "${confirm_name}". Delete aborted.`,
            },
          ],
        };
      }
      const result = await canvas(`/courses/${course_id}?event=delete`, {
        method: "DELETE",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "reset_course_content",
    "⚠️ DESTRUCTIVE — WIPES ALL COURSE CONTENT. Deletes every assignment, module, page, file, quiz, discussion, announcement, rubric, and submission in the course, then issues a brand-new course id (the old id is invalidated). Enrollments and gradebook history are also cleared. There is NO undo. Only call when the user has explicitly asked to reset/wipe a specific course — never as part of a copy or import workflow. NEVER call on a published course with active students. Confirm course id AND title with the user before invoking.",
    {
      course_id: z.string().describe("Canvas course ID to reset"),
      confirm_name: z
        .string()
        .describe("Type the course name to confirm reset (safety check)"),
    },
    async ({ course_id, confirm_name }) => {
      const course = await canvas(`/courses/${course_id}`);
      if (course.name !== confirm_name) {
        return {
          content: [
            {
              type: "text",
              text: `Safety check failed: course name is "${course.name}" but you confirmed "${confirm_name}". Reset aborted.`,
            },
          ],
        };
      }
      const result = await canvas(`/courses/${course_id}/reset_content`, {
        method: "POST",
      });
      return {
        content: [
          {
            type: "text",
            text: `Reset complete. New course ID: ${result.id}\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "copy_course_content",
    "Copy content (assignments, modules, pages, files, quizzes, etc.) from a source course into a destination course. Common at the start of a new semester. Returns a content_migration object — the copy runs asynchronously, check workflow_state to see when complete. By default copies everything; pass selective=true and a `select` map to copy specific items only.",
    {
      destination_course_id: z
        .string()
        .describe("Course to copy content INTO"),
      source_course_id: z
        .string()
        .describe("Course to copy content FROM"),
      shift_dates: z
        .boolean()
        .default(false)
        .describe(
          "Shift assignment/event dates from old term to new term. Requires old_start_date, old_end_date, new_start_date, new_end_date."
        ),
      old_start_date: z
        .string()
        .optional()
        .describe("Old term start (ISO 8601, required if shift_dates)"),
      old_end_date: z
        .string()
        .optional()
        .describe("Old term end (required if shift_dates)"),
      new_start_date: z
        .string()
        .optional()
        .describe("New term start (required if shift_dates)"),
      new_end_date: z
        .string()
        .optional()
        .describe("New term end (required if shift_dates)"),
    },
    async ({
      destination_course_id,
      source_course_id,
      shift_dates,
      old_start_date,
      old_end_date,
      new_start_date,
      new_end_date,
    }) => {
      const body: any = {
        migration_type: "course_copy_importer",
        settings: { source_course_id },
      };
      if (shift_dates) {
        body.date_shift_options = {
          shift_dates: true,
          old_start_date,
          old_end_date,
          new_start_date,
          new_end_date,
        };
      }
      const result = await canvas(
        `/courses/${destination_course_id}/content_migrations`,
        { method: "POST", body: JSON.stringify(body) }
      );
      return {
        content: [
          {
            type: "text",
            text: `Migration started (ID ${result.id}, state: ${result.workflow_state}). Poll GET /courses/${destination_course_id}/content_migrations/${result.id} to track progress.`,
          },
        ],
      };
    }
  );

  server.tool(
    "list_course_tabs",
    "List the navigation tabs (left-side menu items) for a course, including which are hidden. Use the returned tab id with update_course_navigation to show/hide or reorder.",
    { course_id: z.string().describe("Canvas course ID") },
    async ({ course_id }) => {
      const tabs = await canvasAll(`/courses/${course_id}/tabs`);
      const summary = tabs.map((t: any) => ({
        id: t.id,
        label: t.label,
        position: t.position,
        hidden: t.hidden ?? false,
        visibility: t.visibility,
        type: t.type,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "update_course_navigation",
    "Show/hide or reorder a course navigation tab. Find tab_id via list_course_tabs. Some built-in tabs (Home, Settings) cannot be hidden — Canvas will silently ignore the change.",
    {
      course_id: z.string().describe("Canvas course ID"),
      tab_id: z
        .string()
        .describe("Tab id from list_course_tabs (e.g. 'assignments', 'quizzes')"),
      hidden: z
        .boolean()
        .optional()
        .describe("true to hide the tab from students"),
      position: z
        .number()
        .optional()
        .describe("1-based position in the nav (Home is always 1)"),
    },
    async ({ course_id, tab_id, hidden, position }) => {
      const body: any = {};
      if (hidden !== undefined) body.hidden = hidden;
      if (position !== undefined) body.position = position;
      const result = await canvas(`/courses/${course_id}/tabs/${tab_id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
