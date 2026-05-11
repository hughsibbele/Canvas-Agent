import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerQuizzesExtras(server: McpServer) {
  server.tool(
    "list_quizzes",
    "List quizzes in a course. Note: New Quizzes also appear as assignments (with submission_types=['external_tool'] and is_quiz_lti_assignment=true). This endpoint covers Classic Quizzes; use list_assignments to see New Quizzes.",
    {
      course_id: z.string().describe("Canvas course ID"),
      search_term: z.string().optional().describe("Filter by title"),
    },
    async ({ course_id, search_term }) => {
      const params: Record<string, string> = {};
      if (search_term) params.search_term = search_term;

      const quizzes = await canvasAll(
        `/courses/${course_id}/quizzes`,
        params
      );
      const summary = quizzes.map((q: any) => ({
        id: q.id,
        title: q.title,
        quiz_type: q.quiz_type,
        due_at: q.due_at,
        unlock_at: q.unlock_at,
        lock_at: q.lock_at,
        points_possible: q.points_possible,
        question_count: q.question_count,
        time_limit: q.time_limit,
        published: q.published,
        assignment_id: q.assignment_id,
        html_url: q.html_url,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "get_quiz",
    "Get full details of a Classic Quiz. For New Quizzes (Quizzes.Next), use get_new_quiz instead.",
    {
      course_id: z.string().describe("Canvas course ID"),
      quiz_id: z.string().describe("Quiz ID"),
    },
    async ({ course_id, quiz_id }) => {
      const quiz = await canvas(
        `/courses/${course_id}/quizzes/${quiz_id}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(quiz, null, 2) }],
      };
    }
  );

  server.tool(
    "update_quiz",
    "Update a Classic Quiz. Only include fields you want to change. For New Quizzes, use update_new_quiz instead.",
    {
      course_id: z.string().describe("Canvas course ID"),
      quiz_id: z.string().describe("Quiz ID"),
      title: z.string().optional(),
      description: z.string().optional().describe("HTML instructions"),
      due_at: z.string().optional().describe("ISO 8601"),
      unlock_at: z.string().optional().describe("Available from (ISO 8601)"),
      lock_at: z.string().optional().describe("Available until (ISO 8601)"),
      points_possible: z.number().optional(),
      time_limit: z.number().optional().describe("Time limit in minutes (Classic Quizzes use minutes; New Quizzes use seconds)"),
      published: z.boolean().optional(),
    },
    async ({ course_id, quiz_id, ...params }) => {
      const result = await canvas(
        `/courses/${course_id}/quizzes/${quiz_id}`,
        { method: "PUT", body: JSON.stringify({ quiz: params }) }
      );
      return {
        content: [
          {
            type: "text",
            text: `Updated quiz "${result.title}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

}
