import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";
import { rehydrateText } from "../anonymizer.js";

export function registerGradingCore(server: McpServer) {
  server.tool(
    "grade_submission",
    "Grade a single student submission with a score and optional comment. For rubric-based grading, use grade_with_rubric instead. Works for regular assignments, graded discussions (use the assignment_id), and New Quizzes (use the assignment_id).",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID (also works for graded discussions and New Quizzes via their linked assignment_id)"),
      student_id: z.string().describe("Student user ID (use list_students or list_gradeable_students to find IDs)"),
      score: z.union([z.number(), z.string()]).optional().describe("Grade to assign: points (95), percentage ('85%'), letter grade ('A-'), 'pass'/'fail', or 'complete'/'incomplete'"),
      excuse: z
        .boolean()
        .optional()
        .describe("Excuse the student from the assignment"),
      late_policy_status: z
        .enum(["none", "missing", "late", "extended"])
        .optional()
        .describe("Override the late policy status"),
      comment: z
        .string()
        .optional()
        .describe("Text comment on the submission"),
      comment_file_ids: z
        .array(z.string())
        .optional()
        .describe("File IDs to attach to the comment"),
    },
    async ({
      course_id,
      assignment_id,
      student_id,
      score,
      excuse,
      late_policy_status,
      comment,
      comment_file_ids,
    }) => {
      const body: Record<string, any> = {};

      const submission: Record<string, any> = {};
      if (score !== undefined) submission.posted_grade = score;
      if (excuse !== undefined) submission.excuse = excuse;
      if (late_policy_status !== undefined)
        submission.late_policy_status = late_policy_status;
      if (Object.keys(submission).length > 0) body.submission = submission;

      const commentObj: Record<string, any> = {};
      if (comment !== undefined)
        commentObj.text_comment = rehydrateText(comment, course_id);
      if (comment_file_ids !== undefined)
        commentObj.file_ids = comment_file_ids;
      if (Object.keys(commentObj).length > 0) body.comment = commentObj;

      const result = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}/submissions/${student_id}`,
        {
          method: "PUT",
          body: JSON.stringify(body),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Graded submission for user ${student_id}: score=${result.score}, grade="${result.grade}", workflow_state=${result.workflow_state}`,
          },
        ],
      };
    }
  );

  server.tool(
    "bulk_grade",
    "Grade multiple students on one assignment at once. Returns a Progress object — the grading happens asynchronously.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
      grades: z
        .array(
          z.object({
            student_id: z.string().describe("Student (user) ID"),
            score: z.union([z.number(), z.string()]).describe("Grade: points (95), percentage ('85%'), or letter ('A-')"),
            comment: z
              .string()
              .optional()
              .describe("Optional text comment"),
          })
        )
        .describe("Array of student grades to apply"),
    },
    async ({ course_id, assignment_id, grades }) => {
      const grade_data: Record<string, any> = {};
      for (const g of grades) {
        const entry: Record<string, any> = { posted_grade: g.score };
        if (g.comment !== undefined)
          entry.text_comment = rehydrateText(g.comment, course_id);
        grade_data[g.student_id] = entry;
      }

      const result = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}/submissions/update_grades`,
        {
          method: "POST",
          body: JSON.stringify({ grade_data }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Bulk grade started. Progress: id=${result.id}, workflow_state=${result.workflow_state}, url=${result.url ?? "N/A"}\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "submission_summary",
    "Quick overview of submission status for an assignment — counts of graded, ungraded, and not submitted. For individual submission details, use list_submissions instead.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
    },
    async ({ course_id, assignment_id }) => {
      const summary = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}/submission_summary`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "list_missing_submissions",
    "List all missing assignments for a specific student. Very useful for parent conferences and progress reports.",
    {
      student_id: z.string().describe("Student (user) ID"),
      course_id: z
        .string()
        .optional()
        .describe("Filter to a specific course"),
      include_planner_overrides: z
        .boolean()
        .optional()
        .describe("Include planner override info"),
    },
    async ({ student_id, course_id, include_planner_overrides }) => {
      const params: Record<string, string> = {};
      if (course_id) params.course_id = course_id;
      if (include_planner_overrides) params["include[]"] = "planner_overrides";

      const submissions = await canvasAll(
        `/users/${student_id}/missing_submissions`,
        params
      );
      const summary = submissions.map((s: any) => ({
        id: s.id,
        name: s.name,
        course_id: s.course_id,
        due_at: s.due_at,
        points_possible: s.points_possible,
        html_url: s.html_url,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "list_gradeable_students",
    "List students who can be graded for a specific assignment. Use the returned IDs as student_id in grade_submission or grade_with_rubric.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
    },
    async ({ course_id, assignment_id }) => {
      const students = await canvasAll(
        `/courses/${course_id}/assignments/${assignment_id}/gradeable_students`
      );
      const summary = students.map((s: any) => ({
        id: s.id,
        display_name: s.display_name,
        avatar_url: s.avatar_url,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "post_grades",
    "Post (make visible) grades for an assignment so students can see them. Optionally post for specific students only.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
      only_student_ids: z
        .array(z.string())
        .optional()
        .describe("Post grades only for these student IDs (omit to post all)"),
    },
    async ({ course_id, assignment_id, only_student_ids }) => {
      const body: Record<string, any> = {};
      if (only_student_ids !== undefined) {
        body.student_ids = only_student_ids;
      }

      const result = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}/post_grades`,
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Grades posted for assignment ${assignment_id}.\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "hide_grades",
    "Hide grades from students for an assignment. Optionally hide for specific students only.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
      only_student_ids: z
        .array(z.string())
        .optional()
        .describe("Hide grades only for these student IDs (omit to hide all)"),
    },
    async ({ course_id, assignment_id, only_student_ids }) => {
      const body: Record<string, any> = {};
      if (only_student_ids !== undefined) {
        body.student_ids = only_student_ids;
      }

      const result = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}/hide_grades`,
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Grades hidden for assignment ${assignment_id}.\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );
}

export function registerGradingExtras(server: McpServer) {
  server.tool(
    "get_late_policy",
    "Get the late policy configuration for a course.",
    {
      course_id: z.string().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
      const result = await canvas(`/courses/${course_id}/late_policy`);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "set_late_policy",
    "Create or update the late policy for a course. Only include fields you want to change.",
    {
      course_id: z.string().describe("Canvas course ID"),
      missing_submission_deduction_enabled: z
        .boolean()
        .optional()
        .describe("Enable automatic deduction for missing submissions"),
      missing_submission_deduction: z
        .number()
        .optional()
        .describe("Percentage to deduct for missing submissions"),
      late_submission_deduction_enabled: z
        .boolean()
        .optional()
        .describe("Enable automatic deduction for late submissions"),
      late_submission_deduction: z
        .number()
        .optional()
        .describe("Percentage to deduct per period for late submissions"),
      late_submission_interval: z
        .enum(["day", "hour"])
        .optional()
        .describe("Interval for late deduction (day or hour)"),
      late_submission_minimum_percent_enabled: z
        .boolean()
        .optional()
        .describe("Enable a minimum grade for late submissions"),
      late_submission_minimum_percent: z
        .number()
        .optional()
        .describe("Minimum percentage a late submission can receive"),
    },
    async ({ course_id, ...policyFields }) => {
      // Filter out undefined values
      const late_policy: Record<string, any> = {};
      for (const [key, value] of Object.entries(policyFields)) {
        if (value !== undefined) late_policy[key] = value;
      }

      const result = await canvas(`/courses/${course_id}/late_policy`, {
        method: "PATCH",
        body: JSON.stringify({ late_policy }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Late policy updated.\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_grading_standards",
    "List grading scales/standards defined for a course (e.g. A/B/C letter grades with cutoffs).",
    {
      course_id: z.string().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
      const standards = await canvasAll(
        `/courses/${course_id}/grading_standards`
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(standards, null, 2) },
        ],
      };
    }
  );
}
