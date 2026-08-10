import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerSchedulingCore(server: McpServer) {
  server.tool(
    "update_assignment_dates",
    "Update due_at, unlock_at, and/or lock_at for a single assignment. Also works for graded discussions and New Quizzes (which are assignments under the hood). Prefer this over update_assignment when you only need to change dates. Only affects the base date: if the assignment has section overrides, students see those instead, and the base is not independently settable — Canvas recomputes it to the latest override time, so an empty string will NOT clear it. Use batch_update_dates with section_dates (or update_assignment_override) for anything with overrides.",
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
          "\n⚠️  This assignment has section/student overrides, so this call changed nothing students can see. Canvas pins the base date to the latest override time — it ignores what you sent here and an empty string will not clear it. The due_at shown above is Canvas's recomputed value, not your input. To change what students actually see, use batch_update_dates with section_dates, or list_assignment_overrides + update_assignment_override.";
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
    "Update dates for multiple assignments at once, including per-section due times. This is the bulk path for per-section scheduling: for each entry in section_dates it updates that section's override if one exists and CREATES it if one doesn't. Provide an array of {assignment_id, due_at?, section_dates?, unlock_at?, lock_at?} objects. Overrides not named in section_dates fall back to the top-level due_at. IMPORTANT: once an assignment has any override, Canvas ignores its base due date — it recomputes the base to the LATEST override time and will not let you set or clear it independently. So give every section its own section_dates entry rather than leaving one section on the base date.",
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
                "Per-section dates, used when sections meet at different times (e.g. different block schedules). An override is created for any section that doesn't have one yet. List every section — a section left out keeps whatever date it already had."
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
          const hasBaseDates = Object.values(baseDates).some(
            (v) => v !== undefined
          );
          if (!hasBaseDates && !section_dates?.length) {
            // Canvas rejects an empty PUT body with a confusing
            // "assignment is missing" — say what actually went wrong.
            results.push(
              `  SKIPPED: ${assignment_id} — no dates supplied (give due_at, section_dates, unlock_at, or lock_at)`
            );
            continue;
          }

          const overrides = await canvasAll(
            `/courses/${course_id}/assignments/${assignment_id}/overrides`
          );
          const bySection = new Map(
            overrides
              .filter((o: any) => o.course_section_id != null)
              .map((o: any) => [String(o.course_section_id), o])
          );
          const handled = new Set<number>();

          // Per-section dates: update the section's override, or create it if absent.
          for (const s of section_dates ?? []) {
            const dates = {
              due_at: s.due_at,
              unlock_at: s.unlock_at,
              lock_at: s.lock_at,
            };
            const existing: any = bySection.get(s.section_id);
            if (existing) {
              const updated = await canvas(
                `/courses/${course_id}/assignments/${assignment_id}/overrides/${existing.id}`,
                {
                  method: "PUT",
                  body: JSON.stringify({ assignment_override: dates }),
                }
              );
              handled.add(existing.id);
              results.push(
                `  OK: "${updated.title}" override → due ${updated.due_at ?? "none"}`
              );
            } else {
              const created = await canvas(
                `/courses/${course_id}/assignments/${assignment_id}/overrides`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    assignment_override: {
                      ...dates,
                      course_section_id: s.section_id,
                    },
                  }),
                }
              );
              results.push(
                `  CREATED: "${created.title}" override → due ${created.due_at ?? "none"}`
              );
            }
          }

          // Overrides not named in section_dates (other sections, student
          // overrides) fall back to the top-level dates.
          if (hasBaseDates) {
            for (const ov of overrides) {
              if (handled.has(ov.id)) continue;
              const updated = await canvas(
                `/courses/${course_id}/assignments/${assignment_id}/overrides/${ov.id}`,
                {
                  method: "PUT",
                  body: JSON.stringify({ assignment_override: baseDates }),
                }
              );
              results.push(
                `  OK: "${updated.title}" override → due ${updated.due_at ?? "none"}`
              );
            }
          }

          // Only write the base date when the assignment has no overrides at
          // all. Once any override exists Canvas recomputes the base to the
          // latest override time, so writing it is a no-op that reads as a bug.
          if (hasBaseDates && overrides.length === 0 && !section_dates?.length) {
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
    "Create a new date override for a specific section or set of students on an assignment. SIDE EFFECT: the first override leaves the assignment's base due_at alone, but as soon as a second one exists Canvas overwrites the base with the LATEST override time and will not let you clear it — the 'Everyone else' row permanently mirrors whichever section is due last. That is harmless once every section has its own override (no enrolled student reads the base date), but it makes 'base date for section A + override for section B' an unstable design: give every section an override. To date several sections or many assignments at once, prefer batch_update_dates with section_dates, which creates missing overrides in bulk.",
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
