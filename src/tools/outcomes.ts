import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll, canvasAllWrapped } from "../canvas-client.js";

export function registerOutcomeTools(server: McpServer) {
  server.tool(
    "list_outcomes",
    "List every learning outcome linked to a course, flattened across outcome groups. Each entry includes the outcome's id, title, mastery_points, points_possible, ratings, and the group it lives in. Use this to find learning_outcome_id values for create_rubric / update_rubric criteria.",
    {
      course_id: z.string().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
      const links = await canvasAll(
        `/courses/${course_id}/outcome_group_links`
      );
      const summary = links.map((link: any) => ({
        outcome_id: link.outcome?.id,
        title: link.outcome?.title,
        display_name: link.outcome?.display_name,
        mastery_points: link.outcome?.mastery_points,
        points_possible: link.outcome?.points_possible,
        calculation_method: link.outcome?.calculation_method,
        calculation_int: link.outcome?.calculation_int,
        ratings: link.outcome?.ratings,
        group_id: link.outcome_group?.id,
        group_title: link.outcome_group?.title,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "list_outcome_groups",
    "List the outcome group hierarchy (folders) for a course. Use list_outcomes to see the outcomes themselves.",
    {
      course_id: z.string().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
      const groups = await canvasAll(`/courses/${course_id}/outcome_groups`);
      const summary = groups.map((g: any) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        parent_outcome_group_id: g.parent_outcome_group?.id,
        outcomes_count: g.outcomes_count,
        subgroups_count: g.subgroups_count,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "get_outcome",
    "Get full details of a single learning outcome (description, ratings, mastery_points, calculation method, etc.).",
    {
      outcome_id: z.string().describe("Outcome ID"),
    },
    async ({ outcome_id }) => {
      const outcome = await canvas(`/outcomes/${outcome_id}`);
      return {
        content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
      };
    }
  );

  server.tool(
    "list_outcome_results",
    "List per-assessment outcome results for a course — one row per (student, outcome, alignment) where the student was scored against the outcome (e.g. via an outcome-linked rubric criterion). Filter with user_ids and/or outcome_ids to narrow results. Auto-paginates (results from all pages merged, with the linked metadata deduped by id).",
    {
      course_id: z.string().describe("Canvas course ID"),
      user_ids: z
        .array(z.string())
        .optional()
        .describe("Restrict to these student user IDs"),
      outcome_ids: z
        .array(z.string())
        .optional()
        .describe("Restrict to these outcome IDs"),
      include: z
        .array(
          z.enum([
            "alignments",
            "outcomes",
            "outcomes.alignments",
            "outcome_groups",
            "outcome_links",
            "outcome_paths",
            "users",
          ])
        )
        .optional()
        .describe(
          "Optional includes. 'users' embeds (anonymized) student info; 'alignments' embeds the assignment/quiz that produced the result; 'outcomes' embeds the outcome object."
        ),
      include_hidden: z
        .boolean()
        .optional()
        .describe(
          "If true, include results from rubric associations with hide_outcome_results=true. Default Canvas behavior excludes them."
        ),
    },
    async ({
      course_id,
      user_ids,
      outcome_ids,
      include,
      include_hidden,
    }) => {
      const params: Record<string, string | string[]> = {};
      if (user_ids) params["user_ids[]"] = user_ids;
      if (outcome_ids) params["outcome_ids[]"] = outcome_ids;
      if (include) params["include[]"] = include;
      if (include_hidden) params["include_hidden"] = "true";

      const result = await canvasAllWrapped(
        `/courses/${course_id}/outcome_results`,
        "outcome_results",
        params
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "get_outcome_rollups",
    "Get aggregated outcome mastery rollups — the data behind the Learning Mastery Gradebook. Returns each student's current mastery level per outcome, computed using the outcome's calculation_method (e.g. decaying average). Pass aggregate='course' to instead get class-wide averages per outcome (no per-student breakdown). Auto-paginates across all rollups, merging linked metadata (users, outcomes) deduped by id.",
    {
      course_id: z.string().describe("Canvas course ID"),
      user_ids: z
        .array(z.string())
        .optional()
        .describe("Restrict to these student user IDs (per-student rollups only)"),
      outcome_ids: z
        .array(z.string())
        .optional()
        .describe("Restrict to these outcome IDs"),
      aggregate: z
        .enum(["course"])
        .optional()
        .describe(
          "If 'course', returns one rollup per outcome aggregated across all students (class average) instead of per-student rollups."
        ),
      aggregate_stat: z
        .enum(["mean", "median"])
        .optional()
        .describe(
          "Statistic to use for course-level aggregation. Defaults to 'mean'. Only used when aggregate='course'."
        ),
      sort_by: z
        .enum(["student", "outcome"])
        .optional()
        .describe("Sort order for per-student rollups"),
      sort_outcome_id: z
        .string()
        .optional()
        .describe(
          "When sort_by='outcome', sort students by their score on this outcome"
        ),
      include: z
        .array(
          z.enum([
            "courses",
            "outcomes",
            "outcomes.alignments",
            "outcome_groups",
            "outcome_links",
            "outcome_paths",
            "users",
          ])
        )
        .optional()
        .describe(
          "Optional includes — 'users' and 'outcomes' are most useful for translating IDs into readable rows."
        ),
      exclude: z
        .array(z.enum(["missing_user_rollups", "concluded_enrollments", "inactive_enrollments"]))
        .optional()
        .describe("Optional exclusions"),
    },
    async ({
      course_id,
      user_ids,
      outcome_ids,
      aggregate,
      aggregate_stat,
      sort_by,
      sort_outcome_id,
      include,
      exclude,
    }) => {
      const params: Record<string, string | string[]> = {};
      if (user_ids) params["user_ids[]"] = user_ids;
      if (outcome_ids) params["outcome_ids[]"] = outcome_ids;
      if (aggregate) params["aggregate"] = aggregate;
      if (aggregate_stat) params["aggregate_stat"] = aggregate_stat;
      if (sort_by) params["sort_by"] = sort_by;
      if (sort_outcome_id) params["sort_outcome_id"] = sort_outcome_id;
      if (include) params["include[]"] = include;
      if (exclude) params["exclude[]"] = exclude;

      const result = await canvasAllWrapped(
        `/courses/${course_id}/outcome_rollups`,
        "rollups",
        params
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
