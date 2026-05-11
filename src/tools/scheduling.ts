import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerSchedulingCore(server: McpServer) {
  server.tool(
    "update_assignment_dates",
    "Update due_at, unlock_at, and/or lock_at for a single assignment. Also works for graded discussions and New Quizzes (which are assignments under the hood). Prefer this over update_assignment when you only need to change dates.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
      due_at: z
        .string()
        .optional()
        .describe("Due date (ISO 8601). Empty string to clear."),
      unlock_at: z
        .string()
        .optional()
        .describe("Available from (ISO 8601). Empty string to clear."),
      lock_at: z
        .string()
        .optional()
        .describe("Available until (ISO 8601). Empty string to clear."),
    },
    async ({ course_id, assignment_id, ...dates }) => {
      const result = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}`,
        {
          method: "PUT",
          body: JSON.stringify({ assignment: dates }),
        }
      );
      let warning = "";
      if (result.has_overrides) {
        warning =
          "\n⚠️  This assignment has section/student overrides. The base date was updated, but students see their override dates instead. Use list_assignment_overrides + update_assignment_override (or batch_update_dates with section_dates) to change what students actually see.";
      }
      return {
        content: [
          {
            type: "text",
            text: `Updated dates for "${result.name}":\n  due_at: ${result.due_at}\n  unlock_at: ${result.unlock_at}\n  lock_at: ${result.lock_at}${warning}`,
          },
        ],
      };
    }
  );

  server.tool(
    "batch_update_dates",
    "Update dates for multiple assignments at once. Override-aware: if an assignment has section overrides, updates those instead of the (ignored) base date. For assignments with overrides, provide section_dates to set per-section times; if only due_at is given, all overrides get that same time. Provide an array of {assignment_id, due_at, section_dates?, unlock_at, lock_at} objects.",
    {
      course_id: z.string().describe("Canvas course ID"),
      date_updates: z
        .array(
          z.object({
            assignment_id: z.string(),
            due_at: z
              .string()
              .optional()
              .describe(
                "Base due date (ISO 8601). Used directly if no overrides exist; used as fallback for overrides not listed in section_dates."
              ),
            section_dates: z
              .array(
                z.object({
                  section_id: z.string().describe("Course section ID"),
                  due_at: z.string().optional(),
                  unlock_at: z.string().optional(),
                  lock_at: z.string().optional(),
                })
              )
              .optional()
              .describe(
                "Per-section due dates. Only needed when sections have different times (e.g. different block schedules)."
              ),
            unlock_at: z.string().optional(),
            lock_at: z.string().optional(),
          })
        )
        .describe("Array of assignment ID + date updates"),
    },
    async ({ course_id, date_updates }) => {
      const results: string[] = [];
      for (const { assignment_id, section_dates, ...baseDates } of date_updates) {
        try {
          // Check if the assignment has overrides
          const overrides = await canvasAll(
            `/courses/${course_id}/assignments/${assignment_id}/overrides`
          );

          if (overrides.length === 0) {
            // No overrides — update the base date directly
            const result = await canvas(
              `/courses/${course_id}/assignments/${assignment_id}`,
              {
                method: "PUT",
                body: JSON.stringify({ assignment: baseDates }),
              }
            );
            results.push(
              `  OK: "${result.name}" → due ${result.due_at ?? "none"}`
            );
          } else {
            // Has overrides — update each one
            const sectionMap = new Map(
              (section_dates ?? []).map((s) => [s.section_id, s])
            );

            for (const ov of overrides) {
              const sectionSpecific = sectionMap.get(
                String(ov.course_section_id)
              );
              const dates = sectionSpecific
                ? {
                    due_at: sectionSpecific.due_at,
                    unlock_at: sectionSpecific.unlock_at,
                    lock_at: sectionSpecific.lock_at,
                  }
                : baseDates;

              const updated = await canvas(
                `/courses/${course_id}/assignments/${assignment_id}/overrides/${ov.id}`,
                {
                  method: "PUT",
                  body: JSON.stringify({ assignment_override: dates }),
                }
              );
              results.push(
                `  OK: "${updated.title}" override → due ${updated.due_at ?? "none"}`
              );
            }
            // Also update the base date if provided (for completeness)
            if (baseDates.due_at) {
              await canvas(
                `/courses/${course_id}/assignments/${assignment_id}`,
                {
                  method: "PUT",
                  body: JSON.stringify({ assignment: baseDates }),
                }
              );
            }
          }
        } catch (e: any) {
          results.push(`  FAILED: ${assignment_id} — ${e.message}`);
        }
      }
      return {
        content: [
          {
            type: "text",
            text: `Batch date update (${date_updates.length} assignments):\n${results.join("\n")}`,
          },
        ],
      };
    }
  );

  server.tool(
    "create_assignment_override",
    "Create a new date override for a specific section or set of students on an assignment. Use this to set section-specific due dates (e.g., different block start times for different sections).",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
      course_section_id: z
        .string()
        .optional()
        .describe("Section ID (use list_sections to find). Provide this OR student_ids, not both."),
      student_ids: z
        .array(z.string())
        .optional()
        .describe("Array of student IDs for a student-specific override. Provide this OR course_section_id, not both."),
      due_at: z.string().optional().describe("Due date (ISO 8601)"),
      unlock_at: z.string().optional().describe("Available from (ISO 8601)"),
      lock_at: z.string().optional().describe("Available until (ISO 8601)"),
    },
    async ({ course_id, assignment_id, course_section_id, student_ids, ...dates }) => {
      const overrideData: any = { ...dates };
      if (course_section_id) overrideData.course_section_id = course_section_id;
      if (student_ids) overrideData.student_ids = student_ids;

      const result = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}/overrides`,
        {
          method: "POST",
          body: JSON.stringify({ assignment_override: overrideData }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Created override "${result.title}" (ID ${result.id}):\n  due_at: ${result.due_at}\n  unlock_at: ${result.unlock_at}\n  lock_at: ${result.lock_at}`,
          },
        ],
      };
    }
  );

  server.tool(
    "list_assignment_overrides",
    "List all date overrides (section-specific or student-specific) for an assignment. Use this to discover override IDs before updating them.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
    },
    async ({ course_id, assignment_id }) => {
      const overrides = await canvasAll(
        `/courses/${course_id}/assignments/${assignment_id}/overrides`
      );
      return {
        content: [
          {
            type: "text",
            text: overrides.length
              ? JSON.stringify(overrides, null, 2)
              : "No overrides found — this assignment uses only its base due date.",
          },
        ],
      };
    }
  );

  server.tool(
    "update_assignment_override",
    "Update dates on a single section/student override. Use list_assignment_overrides first to get the override ID.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
      override_id: z.string().describe("Override ID (from list_assignment_overrides)"),
      due_at: z
        .string()
        .optional()
        .describe("Due date (ISO 8601). Empty string to clear."),
      unlock_at: z
        .string()
        .optional()
        .describe("Available from (ISO 8601). Empty string to clear."),
      lock_at: z
        .string()
        .optional()
        .describe("Available until (ISO 8601). Empty string to clear."),
    },
    async ({ course_id, assignment_id, override_id, ...dates }) => {
      const result = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}/overrides/${override_id}`,
        {
          method: "PUT",
          body: JSON.stringify({ assignment_override: dates }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Updated override "${result.title}" (ID ${result.id}):\n  due_at: ${result.due_at}\n  unlock_at: ${result.unlock_at}\n  lock_at: ${result.lock_at}`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_course_schedule_overview",
    "Get a chronological overview of all dated assignments, discussions, and quizzes in a course. Useful for understanding the current schedule before making changes.",
    {
      course_id: z.string().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
      const [assignments, quizzes] = await Promise.all([
        canvasAll(`/courses/${course_id}/assignments`),
        canvasAll(`/courses/${course_id}/quizzes`),
      ]);

      const items = [
        ...assignments.map((a: any) => ({
          type: a.is_quiz_lti_assignment
            ? "new_quiz"
            : a.submission_types?.includes("discussion_topic")
              ? "discussion"
              : "assignment",
          id: a.id,
          name: a.name,
          due_at: a.due_at,
          unlock_at: a.unlock_at,
          lock_at: a.lock_at,
          points: a.points_possible,
          published: a.published,
        })),
        ...quizzes.map((q: any) => ({
          type: "classic_quiz",
          id: q.id,
          name: q.title,
          due_at: q.due_at,
          unlock_at: q.unlock_at,
          lock_at: q.lock_at,
          points: q.points_possible,
          published: q.published,
        })),
      ];

      // Sort by due date (undated items at the end)
      items.sort((a, b) => {
        if (!a.due_at && !b.due_at) return 0;
        if (!a.due_at) return 1;
        if (!b.due_at) return -1;
        return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      });

      return {
        content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
      };
    }
  );
}

export function registerSchedulingExtras(server: McpServer) {
  server.tool(
    "update_quiz_dates",
    "Update dates for a classic quiz (not New Quizzes — those are assignments).",
    {
      course_id: z.string().describe("Canvas course ID"),
      quiz_id: z.string().describe("Classic Quiz ID (not assignment ID)"),
      due_at: z.string().optional().describe("Due date (ISO 8601)"),
      unlock_at: z.string().optional().describe("Available from (ISO 8601)"),
      lock_at: z.string().optional().describe("Available until (ISO 8601)"),
    },
    async ({ course_id, quiz_id, ...dates }) => {
      const result = await canvas(
        `/courses/${course_id}/quizzes/${quiz_id}`,
        {
          method: "PUT",
          body: JSON.stringify({ quiz: dates }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Updated dates for quiz "${result.title}":\n  due_at: ${result.due_at}\n  unlock_at: ${result.unlock_at}\n  lock_at: ${result.lock_at}`,
          },
        ],
      };
    }
  );
}
