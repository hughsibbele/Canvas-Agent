import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";
import { rehydrateText } from "../anonymizer.js";

export function registerDiscussionsCore(server: McpServer) {
  server.tool(
    "list_discussions",
    "List discussion topics in a course. Graded discussions also appear as assignments (with assignment_id in the response). To update dates or points of graded discussions, use update_assignment_dates or update_assignment with the assignment_id.",
    {
      course_id: z.string().describe("Canvas course ID"),
      search_term: z.string().optional().describe("Filter by title substring"),
      only_announcements: z
        .boolean()
        .default(false)
        .describe("Only return announcements"),
    },
    async ({ course_id, search_term, only_announcements }) => {
      const params: Record<string, string> = {};
      if (search_term) params.search_term = search_term;
      if (only_announcements) params.only_announcements = "true";

      const discussions = await canvasAll(
        `/courses/${course_id}/discussion_topics`,
        params
      );
      const summary = discussions.map((d: any) => ({
        id: d.id,
        title: d.title,
        due_at: d.assignment?.due_at ?? null,
        unlock_at: d.assignment?.unlock_at ?? d.delayed_post_at,
        lock_at: d.assignment?.lock_at ?? d.lock_at,
        points_possible: d.assignment?.points_possible ?? null,
        published: d.published,
        discussion_type: d.discussion_type,
        assignment_id: d.assignment_id,
        html_url: d.html_url,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "get_discussion",
    "Get full details of a discussion topic, including its message/instructions.",
    {
      course_id: z.string().describe("Canvas course ID"),
      discussion_id: z.string().describe("Discussion topic ID"),
    },
    async ({ course_id, discussion_id }) => {
      const discussion = await canvas(
        `/courses/${course_id}/discussion_topics/${discussion_id}`
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(discussion, null, 2) },
        ],
      };
    }
  );

  server.tool(
    "create_discussion",
    "Create a new graded or ungraded discussion topic.",
    {
      course_id: z.string().describe("Canvas course ID"),
      title: z.string().describe("Discussion title"),
      message: z
        .string()
        .optional()
        .describe("Discussion prompt/instructions (HTML)"),
      discussion_type: z
        .enum(["side_comment", "threaded"])
        .default("threaded")
        .describe("Comment style"),
      published: z.boolean().default(false),
      // Grading fields — if included, Canvas creates a linked assignment
      points_possible: z
        .number()
        .optional()
        .describe("If set, makes this a graded discussion"),
      assignment_group_id: z.string().optional().describe("Group ID (use list_assignment_groups to find)"),
      due_at: z.string().optional().describe("Due date (ISO 8601)"),
      unlock_at: z.string().optional().describe("Available from (ISO 8601)"),
      lock_at: z.string().optional().describe("Available until (ISO 8601)"),
    },
    async ({ course_id, points_possible, assignment_group_id, due_at, unlock_at, lock_at, ...params }) => {
      const body: any = { ...params };
      if (body.title !== undefined) body.title = rehydrateText(body.title, course_id);
      if (body.message !== undefined) body.message = rehydrateText(body.message, course_id);
      // If grading fields are provided, nest them under assignment
      if (points_possible != null) {
        body.assignment = {
          points_possible,
          assignment_group_id,
          due_at,
          unlock_at,
          lock_at,
          submission_types: ["discussion_topic"],
        };
      }
      const result = await canvas(
        `/courses/${course_id}/discussion_topics`,
        { method: "POST", body: JSON.stringify(body) }
      );
      return {
        content: [
          {
            type: "text",
            text: `Created discussion "${result.title}" (ID: ${result.id})\n${result.html_url}`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_discussion",
    "Update a discussion topic's title, message, or published state. Cannot update dates or points — for those, use update_assignment or update_assignment_dates with the discussion's assignment_id (from list_discussions).",
    {
      course_id: z.string().describe("Canvas course ID"),
      discussion_id: z.string().describe("Discussion topic ID"),
      title: z.string().optional(),
      message: z.string().optional().describe("HTML prompt/instructions"),
      published: z.boolean().optional(),
    },
    async ({ course_id, discussion_id, ...params }) => {
      const payload: Record<string, any> = { ...params };
      if (payload.title !== undefined)
        payload.title = rehydrateText(payload.title, course_id);
      if (payload.message !== undefined)
        payload.message = rehydrateText(payload.message, course_id);
      const result = await canvas(
        `/courses/${course_id}/discussion_topics/${discussion_id}`,
        { method: "PUT", body: JSON.stringify(payload) }
      );
      return {
        content: [
          {
            type: "text",
            text: `Updated discussion "${result.title}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "batch_update_discussions",
    "Update title/message/published across multiple discussions. Cannot update dates or points — use batch_update_dates with assignment_ids for date changes on graded discussions.",
    {
      course_id: z.string().describe("Canvas course ID"),
      discussion_ids: z.array(z.string()).describe("Discussion topic IDs"),
      updates: z.object({
        message: z.string().optional().describe("HTML instructions"),
        discussion_type: z.enum(["side_comment", "threaded"]).optional(),
        published: z.boolean().optional(),
      }),
    },
    async ({ course_id, discussion_ids, updates }) => {
      const payload: Record<string, any> = { ...updates };
      if (payload.message !== undefined)
        payload.message = rehydrateText(payload.message, course_id);
      const results: string[] = [];
      for (const id of discussion_ids) {
        try {
          const result = await canvas(
            `/courses/${course_id}/discussion_topics/${id}`,
            { method: "PUT", body: JSON.stringify(payload) }
          );
          results.push(`  OK: "${result.title}" (${id})`);
        } catch (e: any) {
          results.push(`  FAILED: ${id} — ${e.message}`);
        }
      }
      return {
        content: [
          {
            type: "text",
            text: `Batch update complete (${discussion_ids.length} discussions):\n${results.join("\n")}`,
          },
        ],
      };
    }
  );
}
