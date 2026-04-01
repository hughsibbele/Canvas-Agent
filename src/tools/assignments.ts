import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll, summarizeItem } from "../canvas-client.js";

export function registerAssignmentTools(server: McpServer) {
  server.tool(
    "list_assignments",
    "List assignments in a course. This includes regular assignments, graded discussions, and New Quizzes (which are all assignments internally). Returns summary info (id, name, dates, points). Use get_assignment for full details.",
    {
      course_id: z.string().describe("Canvas course ID"),
      search_term: z.string().optional().describe("Filter by name substring"),
      assignment_group_id: z
        .string()
        .optional()
        .describe("Filter to a specific assignment group"),
      order_by: z
        .enum(["due_at", "name", "position"])
        .default("position")
        .describe("Sort order"),
    },
    async ({ course_id, search_term, assignment_group_id, order_by }) => {
      const params: Record<string, string> = { order_by };
      if (search_term) params.search_term = search_term;
      if (assignment_group_id)
        params.assignment_group_id = assignment_group_id;

      const assignments = await canvasAll(
        `/courses/${course_id}/assignments`,
        params
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(assignments.map(summarizeItem), null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "get_assignment",
    "Get full details of a single assignment, including its description/instructions.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
    },
    async ({ course_id, assignment_id }) => {
      const assignment = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}`
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(assignment, null, 2) },
        ],
      };
    }
  );

  server.tool(
    "create_assignment",
    "Create a new regular assignment in a course. For graded discussions, use create_discussion with points_possible instead. For New Quizzes, use create_new_quiz instead.",
    {
      course_id: z.string().describe("Canvas course ID"),
      name: z.string().describe("Assignment name"),
      description: z
        .string()
        .optional()
        .describe("Instructions/description (HTML supported)"),
      due_at: z.string().optional().describe("Due date (ISO 8601)"),
      unlock_at: z
        .string()
        .optional()
        .describe("Available from date (ISO 8601)"),
      lock_at: z
        .string()
        .optional()
        .describe("Available until date (ISO 8601)"),
      points_possible: z.number().optional().describe("Point value"),
      submission_types: z
        .array(z.string())
        .optional()
        .describe(
          "e.g. ['online_text_entry','online_upload','online_url','discussion_topic','external_tool']"
        ),
      assignment_group_id: z
        .string()
        .optional()
        .describe("Assignment group ID to place it in"),
      published: z.boolean().default(false).describe("Publish immediately"),
      position: z.number().optional().describe("Position within the group"),
    },
    async ({ course_id, ...params }) => {
      const result = await canvas(`/courses/${course_id}/assignments`, {
        method: "POST",
        body: JSON.stringify({ assignment: params }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Created assignment "${result.name}" (ID: ${result.id})\n${result.html_url}`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_assignment",
    "Update an existing assignment. Only include fields you want to change. Also works for graded discussions and New Quizzes (via their assignment_id). For date-only changes, prefer update_assignment_dates which is more focused.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
      name: z.string().optional(),
      description: z.string().optional().describe("HTML instructions"),
      due_at: z.string().optional().describe("ISO 8601 or empty string to clear"),
      unlock_at: z.string().optional().describe("Available from (ISO 8601)"),
      lock_at: z.string().optional().describe("Available until (ISO 8601)"),
      points_possible: z.number().optional(),
      submission_types: z.array(z.string()).optional().describe("e.g. ['online_text_entry','online_upload','online_url']"),
      assignment_group_id: z.string().optional().describe("Group ID (use list_assignment_groups to find)"),
      published: z.boolean().optional(),
      position: z.number().optional(),
    },
    async ({ course_id, assignment_id, ...params }) => {
      const result = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}`,
        {
          method: "PUT",
          body: JSON.stringify({ assignment: params }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Updated "${result.name}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_assignment",
    "Permanently delete an assignment. This cannot be undone.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
      confirm_name: z
        .string()
        .describe(
          "Type the assignment name to confirm deletion (safety check)"
        ),
    },
    async ({ course_id, assignment_id, confirm_name }) => {
      // Verify the name matches before deleting
      const assignment = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}`
      );
      if (assignment.name !== confirm_name) {
        return {
          content: [
            {
              type: "text",
              text: `Safety check failed: assignment name is "${assignment.name}" but you confirmed "${confirm_name}". Delete aborted.`,
            },
          ],
        };
      }
      await canvas(`/courses/${course_id}/assignments/${assignment_id}`, {
        method: "DELETE",
      });
      return {
        content: [
          { type: "text", text: `Deleted assignment "${confirm_name}"` },
        ],
      };
    }
  );

  server.tool(
    "batch_update_assignments",
    "Update fields across multiple assignments at once. Does NOT support date fields — use batch_update_dates for date changes. Applies the same update to each assignment ID provided.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_ids: z
        .array(z.string())
        .describe("List of assignment IDs to update"),
      updates: z
        .object({
          description: z.string().optional(),
          points_possible: z.number().optional(),
          submission_types: z.array(z.string()).optional(),
          published: z.boolean().optional(),
          assignment_group_id: z.string().optional(),
        })
        .describe("Fields to update on each assignment"),
    },
    async ({ course_id, assignment_ids, updates }) => {
      const results: string[] = [];
      for (const id of assignment_ids) {
        try {
          const result = await canvas(
            `/courses/${course_id}/assignments/${id}`,
            {
              method: "PUT",
              body: JSON.stringify({ assignment: updates }),
            }
          );
          results.push(`  OK: "${result.name}" (${id})`);
        } catch (e: any) {
          results.push(`  FAILED: ${id} — ${e.message}`);
        }
      }
      return {
        content: [
          {
            type: "text",
            text: `Batch update complete (${assignment_ids.length} assignments):\n${results.join("\n")}`,
          },
        ],
      };
    }
  );
}
