import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerAnalyticsTools(server: McpServer) {
  server.tool(
    "get_course_activity",
    "Get daily page views and participation analytics for a course. This returns engagement metrics, not assignment data — use list_assignments for assignment info.",
    {
      course_id: z.string().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
      const activity = await canvas(
        `/courses/${course_id}/analytics/activity`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(activity, null, 2) }],
      };
    }
  );

  server.tool(
    "get_course_assignment_analytics",
    "Get aggregate statistical analytics per assignment: min/max/median scores, submission counts (on_time, late, missing). This returns statistics, not the assignments themselves — use list_assignments for that. NOTE: this endpoint returns LIFETIME data and does NOT support grading_period_id — for semester-scoped data, fall back to fetching submissions directly via list_submissions.",
    {
      course_id: z.string().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
      const analytics = await canvas(
        `/courses/${course_id}/analytics/assignments`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(analytics, null, 2) }],
      };
    }
  );

  server.tool(
    "get_student_summaries",
    "Get per-student engagement analytics for a course: page views, participations, and tardiness breakdown (missing/late/on_time counts). For enrollment/roster data, use list_students instead. NOTE: this endpoint returns LIFETIME data and does NOT support grading_period_id — the tardiness counts include all assignments since the course began, not just the current semester. For per-semester counts, iterate course submissions with a grading_period_id filter.",
    {
      course_id: z.string().describe("Canvas course ID"),
      sort_column: z
        .enum([
          "name",
          "name_descending",
          "score",
          "score_descending",
          "participations",
          "page_views",
        ])
        .optional()
        .describe("Column to sort by"),
    },
    async ({ course_id, sort_column }) => {
      const params: Record<string, string> = {};
      if (sort_column) params.sort_column = sort_column;

      const summaries = await canvasAll(
        `/courses/${course_id}/analytics/student_summaries`,
        params
      );
      return {
        content: [{ type: "text", text: JSON.stringify(summaries, null, 2) }],
      };
    }
  );

  server.tool(
    "get_student_activity",
    "Get hourly page view breakdown for a specific student in a course.",
    {
      course_id: z.string().describe("Canvas course ID"),
      student_id: z.string().describe("Canvas user ID of the student"),
    },
    async ({ course_id, student_id }) => {
      const activity = await canvas(
        `/courses/${course_id}/analytics/users/${student_id}/activity`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(activity, null, 2) }],
      };
    }
  );

  server.tool(
    "get_student_assignment_data",
    "Get per-assignment scores, submission status, and timestamps for a specific student. This is analytics data — for actual submission details, use list_submissions. NOTE: this endpoint returns LIFETIME data and does NOT support grading_period_id — it includes assignments from all grading periods.",
    {
      course_id: z.string().describe("Canvas course ID"),
      student_id: z.string().describe("Canvas user ID of the student"),
    },
    async ({ course_id, student_id }) => {
      const data = await canvas(
        `/courses/${course_id}/analytics/users/${student_id}/assignments`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "get_student_messaging_data",
    "Get message counts between instructor and a specific student in a course.",
    {
      course_id: z.string().describe("Canvas course ID"),
      student_id: z.string().describe("Canvas user ID of the student"),
    },
    async ({ course_id, student_id }) => {
      const data = await canvas(
        `/courses/${course_id}/analytics/users/${student_id}/communication`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
