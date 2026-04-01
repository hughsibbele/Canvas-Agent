import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll, summarizeItem } from "../canvas-client.js";

export function registerSchedulingTools(server: McpServer) {
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
      return {
        content: [
          {
            type: "text",
            text: `Updated dates for "${result.name}":\n  due_at: ${result.due_at}\n  unlock_at: ${result.unlock_at}\n  lock_at: ${result.lock_at}`,
          },
        ],
      };
    }
  );

  server.tool(
    "batch_update_dates",
    "Update dates for multiple assignments at once. Works for regular assignments, graded discussions, and New Quizzes. Use get_course_schedule_overview first to see current dates. Provide an array of {assignment_id, due_at, unlock_at, lock_at} objects.",
    {
      course_id: z.string().describe("Canvas course ID"),
      date_updates: z
        .array(
          z.object({
            assignment_id: z.string(),
            due_at: z.string().optional(),
            unlock_at: z.string().optional(),
            lock_at: z.string().optional(),
          })
        )
        .describe("Array of assignment ID + date updates"),
    },
    async ({ course_id, date_updates }) => {
      const results: string[] = [];
      for (const { assignment_id, ...dates } of date_updates) {
        try {
          const result = await canvas(
            `/courses/${course_id}/assignments/${assignment_id}`,
            {
              method: "PUT",
              body: JSON.stringify({ assignment: dates }),
            }
          );
          results.push(
            `  OK: "${result.name}" → due ${result.due_at ?? "none"}`
          );
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
