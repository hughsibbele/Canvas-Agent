import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerRubricTools(server: McpServer) {
  server.tool(
    "list_rubrics",
    "List all rubrics in a course. Returns rubric ID, title, point total, and number of criteria.",
    {
      course_id: z.string().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
      const rubrics = await canvasAll(`/courses/${course_id}/rubrics`);
      const summary = rubrics.map((r: any) => ({
        id: r.id,
        title: r.title,
        points_possible: r.points_possible,
        criteria_count: r.data?.length ?? 0,
        associations_count: r.association_count,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "get_rubric",
    "Get full details of a rubric, including all criteria and their rating scales. The returned criterion IDs (e.g. '_7998') are needed by grade_with_rubric.",
    {
      course_id: z.string().describe("Canvas course ID"),
      rubric_id: z.string().describe("Rubric ID"),
    },
    async ({ course_id, rubric_id }) => {
      const rubric = await canvas(
        `/courses/${course_id}/rubrics/${rubric_id}?include[]=assignment_associations`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(rubric, null, 2) }],
      };
    }
  );

  server.tool(
    "create_rubric",
    "Create a new rubric in a course. Provide criteria as an array of objects, each with a description and an array of ratings (description + points). Optionally associate with an assignment immediately.",
    {
      course_id: z.string().describe("Canvas course ID"),
      title: z.string().describe("Rubric title"),
      criteria: z
        .array(
          z.object({
            description: z.string().describe("Criterion name/description"),
            long_description: z
              .string()
              .optional()
              .describe("Detailed criterion description"),
            points: z.number().describe("Maximum points for this criterion"),
            ratings: z.array(
              z.object({
                description: z.string().describe("Rating level description"),
                points: z.number().describe("Point value for this rating"),
              })
            ),
          })
        )
        .describe("Array of rubric criteria with their rating scales"),
      assignment_id: z
        .string()
        .optional()
        .describe(
          "If provided, associate this rubric with the assignment and use it for grading"
        ),
    },
    async ({ course_id, title, criteria, assignment_id }) => {
      const criteriaObj: Record<string, any> = {};
      criteria.forEach((c, i) => {
        const ratingsObj: Record<string, any> = {};
        c.ratings.forEach((r, j) => {
          ratingsObj[String(j)] = {
            description: r.description,
            points: r.points,
          };
        });
        criteriaObj[String(i)] = {
          description: c.description,
          long_description: c.long_description ?? "",
          points: c.points,
          ratings: ratingsObj,
        };
      });

      const body: any = {
        rubric: { title, criteria: criteriaObj },
      };

      if (assignment_id) {
        body.rubric_association = {
          association_id: Number(assignment_id),
          association_type: "Assignment",
          use_for_grading: true,
          purpose: "grading",
        };
      } else {
        body.rubric_association = {
          association_id: Number(course_id),
          association_type: "Course",
          use_for_grading: true,
          purpose: "grading",
        };
      }

      const result = await canvas(`/courses/${course_id}/rubrics`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      const rubric = result.rubric ?? result;
      return {
        content: [
          {
            type: "text",
            text: `Created rubric "${rubric.title}" (ID: ${rubric.id}), ${criteria.length} criteria, ${rubric.points_possible} points total${assignment_id ? `, associated with assignment ${assignment_id}` : ""}`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_rubric",
    "Update an existing rubric's title or criteria. Changes apply to all assignments using this rubric.",
    {
      course_id: z.string().describe("Canvas course ID"),
      rubric_id: z.string().describe("Rubric ID to update"),
      title: z.string().optional().describe("New rubric title"),
      criteria: z
        .array(
          z.object({
            description: z.string(),
            long_description: z.string().optional(),
            points: z.number(),
            ratings: z.array(
              z.object({
                description: z.string(),
                points: z.number(),
              })
            ),
          })
        )
        .optional()
        .describe("Replacement criteria (replaces all existing criteria)"),
    },
    async ({ course_id, rubric_id, title, criteria }) => {
      const body: any = { rubric: {} };

      if (title) body.rubric.title = title;

      if (criteria) {
        const criteriaObj: Record<string, any> = {};
        criteria.forEach((c, i) => {
          const ratingsObj: Record<string, any> = {};
          c.ratings.forEach((r, j) => {
            ratingsObj[String(j)] = {
              description: r.description,
              points: r.points,
            };
          });
          criteriaObj[String(i)] = {
            description: c.description,
            long_description: c.long_description ?? "",
            points: c.points,
            ratings: ratingsObj,
          };
        });
        body.rubric.criteria = criteriaObj;
      }

      const result = await canvas(
        `/courses/${course_id}/rubrics/${rubric_id}`,
        { method: "PUT", body: JSON.stringify(body) }
      );

      return {
        content: [
          {
            type: "text",
            text: `Updated rubric "${result.title}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_rubric",
    "Delete a rubric from a course. This removes it from all associated assignments.",
    {
      course_id: z.string().describe("Canvas course ID"),
      rubric_id: z.string().describe("Rubric ID to delete"),
    },
    async ({ course_id, rubric_id }) => {
      await canvas(`/courses/${course_id}/rubrics/${rubric_id}`, {
        method: "DELETE",
      });
      return {
        content: [
          { type: "text", text: `Deleted rubric ${rubric_id}` },
        ],
      };
    }
  );

  server.tool(
    "associate_rubric",
    "Associate an existing rubric with one or more assignments. This is how you reuse a rubric across multiple assignments. Use list_rubrics to find the rubric_id.",
    {
      course_id: z.string().describe("Canvas course ID"),
      rubric_id: z.string().describe("Rubric ID to associate"),
      assignment_ids: z
        .array(z.string())
        .describe("List of assignment IDs to associate the rubric with"),
      use_for_grading: z
        .boolean()
        .default(true)
        .describe("Whether to use this rubric for grading (default: true)"),
    },
    async ({ course_id, rubric_id, assignment_ids, use_for_grading }) => {
      const results: string[] = [];
      for (const aid of assignment_ids) {
        try {
          await canvas(`/courses/${course_id}/rubric_associations`, {
            method: "POST",
            body: JSON.stringify({
              rubric_association: {
                rubric_id: Number(rubric_id),
                association_type: "Assignment",
                association_id: Number(aid),
                use_for_grading,
                purpose: "grading",
              },
            }),
          });
          results.push(`  OK: assignment ${aid}`);
        } catch (e: any) {
          results.push(`  FAILED: assignment ${aid} — ${e.message}`);
        }
      }
      return {
        content: [
          {
            type: "text",
            text: `Rubric ${rubric_id} association results (${assignment_ids.length} assignments):\n${results.join("\n")}`,
          },
        ],
      };
    }
  );

  server.tool(
    "remove_rubric_from_assignment",
    "Remove a rubric association from a specific assignment without deleting the rubric itself.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID to remove rubric from"),
    },
    async ({ course_id, assignment_id }) => {
      // Get the assignment to find its rubric association
      const assignment = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}`
      );
      const rubricSettings = assignment.rubric_settings;

      if (!rubricSettings) {
        return {
          content: [
            {
              type: "text",
              text: `Assignment ${assignment_id} has no rubric associated.`,
            },
          ],
        };
      }

      // Remove by updating the assignment to clear rubric
      await canvas(`/courses/${course_id}/assignments/${assignment_id}`, {
        method: "PUT",
        body: JSON.stringify({
          assignment: { rubric_settings: { id: null } },
        }),
      });

      return {
        content: [
          {
            type: "text",
            text: `Removed rubric from assignment ${assignment_id} ("${assignment.name}")`,
          },
        ],
      };
    }
  );

  server.tool(
    "grade_with_rubric",
    "Grade a student's submission using a rubric. Provide scores for each criterion. For simple score-based grading without a rubric, use grade_submission instead.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
      student_id: z.string().describe("Student's user ID"),
      criterion_scores: z
        .array(
          z.object({
            criterion_id: z
              .string()
              .describe(
                "Criterion ID from the rubric (e.g., '_7998'). Use get_rubric to find these."
              ),
            points: z.number().describe("Points to award for this criterion"),
            comments: z
              .string()
              .optional()
              .describe("Feedback comment for this criterion"),
          })
        )
        .describe("Scores for each rubric criterion"),
    },
    async ({ course_id, assignment_id, student_id, criterion_scores }) => {
      const rubricAssessment: Record<string, any> = {};
      for (const cs of criterion_scores) {
        rubricAssessment[cs.criterion_id] = {
          points: cs.points,
          ...(cs.comments ? { comments: cs.comments } : {}),
        };
      }

      const result = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}/submissions/${student_id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            rubric_assessment: rubricAssessment,
          }),
        }
      );

      return {
        content: [
          {
            type: "text",
            text: `Graded submission for student ${student_id} on assignment ${assignment_id}: score ${result.score}/${result.assignment?.points_possible ?? "?"}`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_rubric_assessments",
    "Get all rubric assessments (grades) for an assignment. Shows how each student was scored on each criterion.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
    },
    async ({ course_id, assignment_id }) => {
      const submissions = await canvasAll(
        `/courses/${course_id}/assignments/${assignment_id}/submissions`,
        { include: "rubric_assessment,user" }
      );

      const assessed = submissions
        .filter((s: any) => s.rubric_assessment)
        .map((s: any) => ({
          student_id: s.user_id,
          student_name: s.user?.name ?? s.user?.sortable_name ?? "unknown",
          score: s.score,
          rubric_assessment: s.rubric_assessment,
        }));

      return {
        content: [
          {
            type: "text",
            text:
              assessed.length > 0
                ? JSON.stringify(assessed, null, 2)
                : "No rubric assessments found for this assignment.",
          },
        ],
      };
    }
  );
}
