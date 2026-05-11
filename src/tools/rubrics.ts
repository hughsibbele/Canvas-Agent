import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";
import { rehydrateText } from "../anonymizer.js";
import { unsandboxText } from "../sandbox.js";

/**
 * Strip sandbox markers (and the surrounding whitespace our wrap adds) from
 * a free-text field that was fetched from Canvas and is about to be sent
 * back. Without this, Canvas stores the marker text verbatim and every
 * subsequent read wraps it again — corrupting the rubric for UI users.
 */
function cleanDescription(value: unknown): string {
  if (typeof value !== "string") return "";
  return (unsandboxText(value) ?? "").trim();
}

export function registerRubricsCore(server: McpServer) {
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
    "Get full details of a rubric, including all criteria and their rating scales. The returned criterion IDs (e.g. '_7998') are needed by grade_with_rubric. Pass include=['assessments'] to also retrieve every rubric_assessment row (with their IDs) — that's how you find the rubric_association_id and assessment_id needed by update_rubric_assessment / delete_rubric_assessment.",
    {
      course_id: z.string().describe("Canvas course ID"),
      rubric_id: z.string().describe("Rubric ID"),
      include: z
        .array(
          z.enum([
            "assignment_associations",
            "course_associations",
            "account_associations",
            "associations",
            "assessments",
            "graded_assessments",
            "peer_assessments",
          ])
        )
        .optional()
        .describe(
          "Optional includes. Defaults to ['assignment_associations']. Use 'assessments' (or 'graded_assessments' / 'peer_assessments') to embed individual rubric_assessment rows."
        ),
      style: z
        .enum(["full", "comments_only"])
        .optional()
        .describe(
          "Assessment style filter. Only meaningful when include contains an *assessments variant. 'comments_only' strips numeric scores and returns just comments."
        ),
    },
    async ({ course_id, rubric_id, include, style }) => {
      const includes = include?.length
        ? include
        : ["assignment_associations"];
      const params = new URLSearchParams();
      for (const inc of includes) params.append("include[]", inc);
      if (style) params.append("style", style);
      const rubric = await canvas(
        `/courses/${course_id}/rubrics/${rubric_id}?${params.toString()}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(rubric, null, 2) }],
      };
    }
  );

  server.tool(
    "create_rubric",
    "Create a new rubric in a course. Provide criteria as an array of objects, each with a description and an array of ratings (description + points). Optionally associate with an assignment immediately. Criteria can be linked to learning outcomes via learning_outcome_id (use list_outcomes to find IDs) — when linked, the criterion's mastery feeds into outcome rollups.",
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
            learning_outcome_id: z
              .string()
              .optional()
              .describe(
                "Optional: link this criterion to a learning outcome. Mastery against this criterion feeds the outcome's rollup. The outcome must be linked to this course (see list_outcomes)."
              ),
          })
        )
        .describe("Array of rubric criteria with their rating scales"),
      free_form_criterion_comments: z
        .boolean()
        .optional()
        .describe(
          "If true, graders write free-form comments per criterion instead of selecting from the rating scale"
        ),
      assignment_id: z
        .string()
        .optional()
        .describe(
          "If provided, associate this rubric with the assignment and use it for grading"
        ),
    },
    async ({
      course_id,
      title,
      criteria,
      free_form_criterion_comments,
      assignment_id,
    }) => {
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
          ...(c.learning_outcome_id
            ? { learning_outcome_id: Number(c.learning_outcome_id) }
            : {}),
        };
      });

      const rubricBody: any = { title, criteria: criteriaObj };
      if (free_form_criterion_comments !== undefined) {
        rubricBody.free_form_criterion_comments = free_form_criterion_comments;
      }
      const body: any = { rubric: rubricBody };

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
    "Update an existing rubric's title, criteria, or display settings. Changes apply to all assignments using this rubric. If you change only the title (without passing criteria), existing criteria are preserved automatically.",
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
            learning_outcome_id: z
              .string()
              .optional()
              .describe(
                "Optional: link this criterion to a learning outcome (see list_outcomes)"
              ),
          })
        )
        .optional()
        .describe("Replacement criteria (replaces all existing criteria). Omit to keep current criteria."),
      free_form_criterion_comments: z
        .boolean()
        .optional()
        .describe("If true, graders write free-form comments per criterion instead of selecting a rating"),
    },
    async ({
      course_id,
      rubric_id,
      title,
      criteria,
      free_form_criterion_comments,
    }) => {
      // Canvas's PUT replaces fields wholesale: omitting `title` resets it
      // to a default, omitting `criteria` wipes them. To make partial
      // updates safe we always fetch the current state and use it as the
      // default for any field the caller didn't supply.
      const existing = await canvas(
        `/courses/${course_id}/rubrics/${rubric_id}`
      );

      const body: any = { rubric: {} };
      body.rubric.title = title ?? existing.title;
      if (free_form_criterion_comments !== undefined) {
        body.rubric.free_form_criterion_comments = free_form_criterion_comments;
      }
      // Note: Canvas exposes skip_updating_points_possible as a documented
      // PUT parameter, but live testing showed both placements broken —
      // nested under rubric[] is silently ignored, and at the top level
      // Canvas returns a 500. Not exposing it until Canvas fixes it.

      // When using fetched criteria, descriptions come back sandbox-wrapped
      // by the privacy pipeline; cleanDescription strips those markers so we
      // don't write them back to Canvas. When the caller supplies criteria,
      // descriptions are clean already (cleanDescription is a no-op).
      const usingFetched = !criteria;
      const criteriaSource = criteria ?? existing.data ?? [];

      const criteriaObj: Record<string, any> = {};
      criteriaSource.forEach((c: any, i: number) => {
        const ratingsObj: Record<string, any> = {};
        (c.ratings ?? []).forEach((r: any, j: number) => {
          ratingsObj[String(j)] = {
            description: usingFetched
              ? cleanDescription(r.description)
              : r.description,
            points: r.points,
            ...(r.long_description
              ? { long_description: r.long_description }
              : {}),
          };
        });
        criteriaObj[String(i)] = {
          description: usingFetched
            ? cleanDescription(c.description)
            : c.description,
          long_description: c.long_description ?? "",
          points: c.points,
          ratings: ratingsObj,
          ...(c.id ? { id: c.id } : {}),
          ...(c.learning_outcome_id
            ? { learning_outcome_id: Number(c.learning_outcome_id) }
            : {}),
        };
      });
      body.rubric.criteria = criteriaObj;

      const result = await canvas(
        `/courses/${course_id}/rubrics/${rubric_id}`,
        { method: "PUT", body: JSON.stringify(body) }
      );

      const rubric = result.rubric ?? result;
      return {
        content: [
          {
            type: "text",
            text: `Updated rubric "${rubric.title}" (ID: ${rubric.id}), ${rubric.data?.length ?? "?"} criteria, ${rubric.points_possible ?? "?"} points total`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_rubric",
    "Permanently delete a rubric from a course. This removes it from all associated assignments and cannot be undone.",
    {
      course_id: z.string().describe("Canvas course ID"),
      rubric_id: z.string().describe("Rubric ID to delete"),
      confirm_title: z
        .string()
        .describe("Type the rubric title to confirm deletion (safety check)"),
    },
    async ({ course_id, rubric_id, confirm_title }) => {
      const rubric = await canvas(
        `/courses/${course_id}/rubrics/${rubric_id}`
      );
      if (rubric.title !== confirm_title) {
        return {
          content: [
            {
              type: "text",
              text: `Safety check failed: rubric title is "${rubric.title}" but you confirmed "${confirm_title}". Delete aborted.`,
            },
          ],
        };
      }
      await canvas(`/courses/${course_id}/rubrics/${rubric_id}`, {
        method: "DELETE",
      });
      return {
        content: [
          { type: "text", text: `Deleted rubric "${rubric.title}"` },
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
      hide_score_total: z
        .boolean()
        .optional()
        .describe("Hide the total score in the student/grader view of the rubric"),
      hide_points: z
        .boolean()
        .optional()
        .describe(
          "Hide all point values on the rubric (Canvas UI: 'Remove points from rubric'). Useful for non-scoring rubrics."
        ),
      hide_outcome_results: z
        .boolean()
        .optional()
        .describe(
          "Don't post outcome results from this rubric to the Learning Mastery Gradebook. Use when a rubric criterion is outcome-linked but you don't want this assignment to count toward mastery."
        ),
    },
    async ({
      course_id,
      rubric_id,
      assignment_ids,
      use_for_grading,
      hide_score_total,
      hide_points,
      hide_outcome_results,
    }) => {
      const results: string[] = [];
      for (const aid of assignment_ids) {
        try {
          const associationBody: any = {
            rubric_id: Number(rubric_id),
            association_type: "Assignment",
            association_id: Number(aid),
            use_for_grading,
            purpose: "grading",
          };
          if (hide_score_total !== undefined)
            associationBody.hide_score_total = hide_score_total;
          if (hide_points !== undefined)
            associationBody.hide_points = hide_points;
          if (hide_outcome_results !== undefined)
            associationBody.hide_outcome_results = hide_outcome_results;

          await canvas(`/courses/${course_id}/rubric_associations`, {
            method: "POST",
            body: JSON.stringify({ rubric_association: associationBody }),
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
    "update_rubric_association",
    "Update the display/grading settings of an existing rubric–assignment association without re-associating. Use this to toggle 'Remove points from rubric' (hide_points), hide the score total, or change use_for_grading. Find the association_id by calling get_rubric (look at assignment_associations) or by reading the assignment's rubric_settings.",
    {
      course_id: z.string().describe("Canvas course ID"),
      association_id: z
        .string()
        .describe("Rubric association ID (NOT the rubric ID or assignment ID)"),
      use_for_grading: z
        .boolean()
        .optional()
        .describe("Whether the rubric is used for grading"),
      hide_score_total: z
        .boolean()
        .optional()
        .describe("Hide the total score in the rubric view"),
      hide_points: z
        .boolean()
        .optional()
        .describe(
          "Hide all point values on the rubric (Canvas UI: 'Remove points from rubric')"
        ),
      hide_outcome_results: z
        .boolean()
        .optional()
        .describe(
          "Don't post outcome results from this rubric to the Learning Mastery Gradebook"
        ),
    },
    async ({
      course_id,
      association_id,
      use_for_grading,
      hide_score_total,
      hide_points,
      hide_outcome_results,
    }) => {
      const associationBody: any = {};
      if (use_for_grading !== undefined)
        associationBody.use_for_grading = use_for_grading;
      if (hide_score_total !== undefined)
        associationBody.hide_score_total = hide_score_total;
      if (hide_points !== undefined) associationBody.hide_points = hide_points;
      if (hide_outcome_results !== undefined)
        associationBody.hide_outcome_results = hide_outcome_results;

      if (Object.keys(associationBody).length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No changes specified — pass at least one of use_for_grading, hide_score_total, hide_points, hide_outcome_results.",
            },
          ],
        };
      }

      const result = await canvas(
        `/courses/${course_id}/rubric_associations/${association_id}`,
        {
          method: "PUT",
          body: JSON.stringify({ rubric_association: associationBody }),
        }
      );

      const assoc = result.rubric_association ?? result;
      const changes = Object.entries(associationBody)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return {
        content: [
          {
            type: "text",
            text: `Updated rubric association ${assoc.id ?? association_id} (rubric ${assoc.rubric_id ?? "?"} → ${assoc.association_type ?? "?"} ${assoc.association_id ?? "?"}): ${changes}`,
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
          ...(cs.comments
            ? { comments: rehydrateText(cs.comments, course_id) }
            : {}),
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
    "Get all rubric assessments (grades) for an assignment. Shows how each student was scored on each criterion. Note: this returns the per-criterion data but not the assessment row IDs — for those (needed by update_rubric_assessment / delete_rubric_assessment), call get_rubric with include=['assessments'].",
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

  server.tool(
    "copy_rubric",
    "Duplicate an existing rubric. Copies title, criteria (with ratings, long descriptions, and outcome links), and free_form_criterion_comments. By default copies into the same course; pass target_course_id to copy across courses. Optionally renames and associates with one or more assignments. Display toggles (hide_score_total / hide_points / hide_outcome_results) are inherited from the source's primary association unless overridden. NOTE: outcome-linked criteria require the same outcome to be available in the target course; if it isn't, Canvas may strip the outcome link.",
    {
      source_course_id: z.string().describe("Course ID where the rubric currently lives"),
      source_rubric_id: z.string().describe("Rubric ID to copy"),
      target_course_id: z
        .string()
        .optional()
        .describe("Course ID to copy into. Defaults to source_course_id."),
      new_title: z
        .string()
        .optional()
        .describe("Title for the copy. Defaults to '<original title> (copy)'."),
      assignment_ids: z
        .array(z.string())
        .optional()
        .describe("Optional: assignment IDs in the target course to associate the copy with."),
      hide_score_total: z
        .boolean()
        .optional()
        .describe("Override hide_score_total on the new association(s). Defaults to the source's value."),
      hide_points: z
        .boolean()
        .optional()
        .describe("Override hide_points (Canvas UI: 'Remove points from rubric') on the new association(s). Defaults to the source's value."),
      hide_outcome_results: z
        .boolean()
        .optional()
        .describe("Override hide_outcome_results on the new association(s). Defaults to the source's value."),
    },
    async ({
      source_course_id,
      source_rubric_id,
      target_course_id,
      new_title,
      assignment_ids,
      hide_score_total,
      hide_points,
      hide_outcome_results,
    }) => {
      const targetCourseId = target_course_id ?? source_course_id;
      // Pull source rubric *with* assignment_associations so we can inherit
      // display toggles from its primary association.
      const source = await canvas(
        `/courses/${source_course_id}/rubrics/${source_rubric_id}?include[]=assignment_associations`
      );
      const sourceAssoc =
        source.assessments?.[0]?.rubric_association ??
        source.associations?.[0] ??
        source.assignment_associations?.[0] ??
        {};

      const inheritedToggles = {
        hide_score_total:
          hide_score_total ?? sourceAssoc.hide_score_total ?? undefined,
        hide_points: hide_points ?? sourceAssoc.hide_points ?? undefined,
        hide_outcome_results:
          hide_outcome_results ?? sourceAssoc.hide_outcome_results ?? undefined,
      };
      const applyToggles = (assoc: Record<string, any>) => {
        if (inheritedToggles.hide_score_total !== undefined)
          assoc.hide_score_total = inheritedToggles.hide_score_total;
        if (inheritedToggles.hide_points !== undefined)
          assoc.hide_points = inheritedToggles.hide_points;
        if (inheritedToggles.hide_outcome_results !== undefined)
          assoc.hide_outcome_results = inheritedToggles.hide_outcome_results;
        return assoc;
      };

      // Source data was fetched via canvas() so description fields come back
      // sandbox-wrapped — clean them before sending to the create endpoint
      // or Canvas would store the wrapped strings.
      const criteriaObj: Record<string, any> = {};
      (source.data ?? []).forEach((c: any, i: number) => {
        const ratingsObj: Record<string, any> = {};
        (c.ratings ?? []).forEach((r: any, j: number) => {
          ratingsObj[String(j)] = {
            description: cleanDescription(r.description),
            points: r.points,
            ...(r.long_description
              ? { long_description: r.long_description }
              : {}),
          };
        });
        criteriaObj[String(i)] = {
          description: cleanDescription(c.description),
          long_description: c.long_description ?? "",
          points: c.points,
          ratings: ratingsObj,
          ...(c.learning_outcome_id
            ? { learning_outcome_id: Number(c.learning_outcome_id) }
            : {}),
        };
      });

      const rubricBody: any = {
        title: new_title ?? `${source.title} (copy)`,
        criteria: criteriaObj,
      };
      if (source.free_form_criterion_comments !== undefined) {
        rubricBody.free_form_criterion_comments =
          source.free_form_criterion_comments;
      }

      // Create the rubric, associated to the first assignment if any (or to the
      // course otherwise — this is the same default create_rubric uses).
      const firstAssignment = assignment_ids?.[0];
      const body: any = { rubric: rubricBody };
      if (firstAssignment) {
        body.rubric_association = applyToggles({
          association_id: Number(firstAssignment),
          association_type: "Assignment",
          use_for_grading: true,
          purpose: "grading",
        });
      } else {
        body.rubric_association = applyToggles({
          association_id: Number(targetCourseId),
          association_type: "Course",
          use_for_grading: true,
          purpose: "grading",
        });
      }

      const created = await canvas(`/courses/${targetCourseId}/rubrics`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const newRubric = created.rubric ?? created;

      // Associate the remaining assignments (if any).
      const extras = (assignment_ids ?? []).slice(firstAssignment ? 1 : 0);
      const associationLines: string[] = [];
      for (const aid of extras) {
        try {
          await canvas(`/courses/${targetCourseId}/rubric_associations`, {
            method: "POST",
            body: JSON.stringify({
              rubric_association: applyToggles({
                rubric_id: Number(newRubric.id),
                association_type: "Assignment",
                association_id: Number(aid),
                use_for_grading: true,
                purpose: "grading",
              }),
            }),
          });
          associationLines.push(`  OK: assignment ${aid}`);
        } catch (e: any) {
          associationLines.push(`  FAILED: assignment ${aid} — ${e.message}`);
        }
      }

      const summary = [
        `Copied rubric "${source.title}" → "${newRubric.title}" (new ID: ${newRubric.id}, course ${targetCourseId})`,
        `${(source.data ?? []).length} criteria, ${newRubric.points_possible} points total`,
      ];
      if (firstAssignment)
        summary.push(`Associated with assignment ${firstAssignment}`);
      if (associationLines.length)
        summary.push(
          `Additional associations:\n${associationLines.join("\n")}`
        );

      return {
        content: [{ type: "text", text: summary.join("\n") }],
      };
    }
  );

  server.tool(
    "update_rubric_assessment",
    "Edit an existing rubric assessment (e.g. correct one student's rubric grade) without re-grading the whole submission. Find rubric_association_id and assessment_id by calling get_rubric with include=['assessments']. For most grading workflows, grade_with_rubric is simpler — use this tool when you specifically need to surgically edit one row.",
    {
      course_id: z.string().describe("Canvas course ID"),
      rubric_association_id: z
        .string()
        .describe("Rubric association ID (from get_rubric assessments)"),
      assessment_id: z
        .string()
        .describe("Rubric assessment ID (the row's own ID, from get_rubric assessments)"),
      criterion_scores: z
        .array(
          z.object({
            criterion_id: z.string().describe("Criterion ID (e.g. '_7998')"),
            points: z.number(),
            comments: z.string().optional(),
          })
        )
        .describe("Per-criterion scores. Replaces existing per-criterion data."),
      assessment_type: z
        .enum(["grading", "peer_review", "provisional_grade"])
        .optional()
        .describe("Assessment type. Defaults to 'grading'."),
    },
    async ({
      course_id,
      rubric_association_id,
      assessment_id,
      criterion_scores,
      assessment_type,
    }) => {
      const rubricAssessment: Record<string, any> = {
        assessment_type: assessment_type ?? "grading",
      };
      for (const cs of criterion_scores) {
        rubricAssessment[cs.criterion_id] = {
          points: cs.points,
          ...(cs.comments
            ? { comments: rehydrateText(cs.comments, course_id) }
            : {}),
        };
      }

      const result = await canvas(
        `/courses/${course_id}/rubric_associations/${rubric_association_id}/rubric_assessments/${assessment_id}`,
        {
          method: "PUT",
          body: JSON.stringify({ rubric_assessment: rubricAssessment }),
        }
      );

      const assessment = result.rubric_assessment ?? result;
      return {
        content: [
          {
            type: "text",
            text: `Updated rubric assessment ${assessment.id ?? assessment_id}: score ${assessment.score ?? "?"} (${criterion_scores.length} criteria)`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_rubric_assessment",
    "Delete a single rubric assessment row, clearing that student's rubric grade for the assignment without removing the rubric or affecting other students. Find rubric_association_id and assessment_id by calling get_rubric with include=['assessments'].",
    {
      course_id: z.string().describe("Canvas course ID"),
      rubric_association_id: z
        .string()
        .describe("Rubric association ID (from get_rubric assessments)"),
      assessment_id: z
        .string()
        .describe("Rubric assessment ID to delete (from get_rubric assessments)"),
    },
    async ({ course_id, rubric_association_id, assessment_id }) => {
      await canvas(
        `/courses/${course_id}/rubric_associations/${rubric_association_id}/rubric_assessments/${assessment_id}`,
        { method: "DELETE" }
      );
      return {
        content: [
          {
            type: "text",
            text: `Deleted rubric assessment ${assessment_id} (association ${rubric_association_id}).`,
          },
        ],
      };
    }
  );
}
