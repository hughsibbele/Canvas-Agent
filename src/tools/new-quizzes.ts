import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

// New Quizzes use /api/quiz/v1/ instead of /api/v1/
// Since canvas() and canvasAll() prepend BASE_URL (/api/v1),
// we use a relative path trick: /api/v1/../quiz/v1 resolves to /api/quiz/v1
function quizApiPath(path: string): string {
  return `/../quiz/v1${path}`;
}

export function registerNewQuizTools(server: McpServer) {
  // ── 1. Get New Quiz Details ────────────────────────────────────────────
  server.tool(
    "get_new_quiz",
    "Get full details of a single New Quiz (Quizzes.Next) including settings, time limits, and configuration. The assignment_id is the Canvas assignment ID (found via list_new_quizzes or list_assignments where is_quiz_lti_assignment=true).",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("The assignment ID of the New Quiz"),
    },
    async ({ course_id, assignment_id }) => {
      const quiz = await canvas(
        quizApiPath(`/courses/${course_id}/quizzes/${assignment_id}`)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(quiz, null, 2) }],
      };
    }
  );

  // ── 2. Create New Quiz ─────────────────────────────────────────────────
  server.tool(
    "create_new_quiz",
    "Create a New Quiz (Quizzes.Next) in a course. Returns the created quiz object including its assignment_id.",
    {
      course_id: z.string().describe("Canvas course ID"),
      title: z.string().describe("Quiz title"),
      assignment_group_id: z
        .string()
        .optional()
        .describe("Assignment group ID to place the quiz in"),
      points_possible: z.number().optional().describe("Total point value"),
      due_at: z.string().optional().describe("Due date (ISO 8601)"),
      published: z.boolean().optional().describe("Publish immediately"),
    },
    async ({ course_id, ...params }) => {
      const result = await canvas(
        quizApiPath(`/courses/${course_id}/quizzes`),
        {
          method: "POST",
          body: JSON.stringify({ quiz: params }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Created New Quiz "${result.title}" (ID: ${result.id})\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );

  // ── 3. Update New Quiz ─────────────────────────────────────────────────
  server.tool(
    "update_new_quiz",
    "Update a New Quiz's settings (time limit, shuffle, attempts, etc.). For date changes (due_at, unlock_at, lock_at), use update_assignment_dates with the assignment_id instead — New Quizzes are assignments.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("The assignment ID of the New Quiz"),
      title: z.string().optional().describe("Quiz title"),
      points_possible: z.number().optional().describe("Total point value"),
      time_limit_seconds: z
        .number()
        .optional()
        .describe("Time limit in seconds (e.g. 3600 for 1 hour)"),
      shuffle_questions: z
        .boolean()
        .optional()
        .describe("Randomize question order"),
      shuffle_answers: z
        .boolean()
        .optional()
        .describe("Randomize answer choice order"),
      allow_backtracking: z
        .boolean()
        .optional()
        .describe("Allow students to go back to previous questions"),
      multiple_attempts_enabled: z
        .boolean()
        .optional()
        .describe("Allow multiple attempts"),
      max_attempts: z
        .number()
        .optional()
        .describe("Maximum number of attempts (requires multiple_attempts_enabled)"),
      published: z.boolean().optional().describe("Publish or unpublish"),
    },
    async ({ course_id, assignment_id, ...params }) => {
      const result = await canvas(
        quizApiPath(`/courses/${course_id}/quizzes/${assignment_id}`),
        {
          method: "PATCH",
          body: JSON.stringify({ quiz: params }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Updated New Quiz "${result.title}" (ID: ${result.id})\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );

  // ── 4. List Quiz Items (Questions) ─────────────────────────────────────
  server.tool(
    "list_quiz_items",
    "List all items (questions) in a New Quiz. This is for New Quizzes only — Classic Quizzes do not have a question API in this server. Returns each item's ID, position, points, question type, and content.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("The assignment ID of the New Quiz"),
    },
    async ({ course_id, assignment_id }) => {
      const items = await canvasAll(
        quizApiPath(`/courses/${course_id}/quizzes/${assignment_id}/items`)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
      };
    }
  );

  // ── 5. Get Quiz Item ───────────────────────────────────────────────────
  server.tool(
    "get_quiz_item",
    "Get full details of a single quiz item (question), including its interaction_data, scoring_data, and feedback.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("The assignment ID of the New Quiz"),
      item_id: z.string().describe("The quiz item ID"),
    },
    async ({ course_id, assignment_id, item_id }) => {
      const item = await canvas(
        quizApiPath(
          `/courses/${course_id}/quizzes/${assignment_id}/items/${item_id}`
        )
      );
      return {
        content: [{ type: "text", text: JSON.stringify(item, null, 2) }],
      };
    }
  );

  // ── 6. Create Quiz Item (Question) ─────────────────────────────────────
  server.tool(
    "create_quiz_item",
    `Create a question (item) in a New Quiz. This is the primary tool for adding questions.

INTERACTION TYPES AND THEIR DATA FORMATS:

1. "choice" (Multiple Choice) - Single correct answer from choices
   interaction_data: {
     "choices": [
       { "item_body": "Answer A", "position": 1 },
       { "item_body": "Answer B", "position": 2 },
       { "item_body": "Answer C", "position": 3 }
     ]
   }
   scoring_data: { "value": "<id_of_correct_choice>" }
   NOTE: Create with placeholder scoring_data first. The API returns choices
   with generated IDs. Then use update_quiz_item to set the correct answer ID.
   Alternatively, scoring_data can reference by position index.

2. "true-false" (True/False)
   interaction_data: {
     "choices": [
       { "item_body": "True", "position": 1 },
       { "item_body": "False", "position": 2 }
     ]
   }
   scoring_data: { "value": "<id_of_correct_choice>" }
   Same approach as "choice" - create first, then update with correct choice ID.

3. "multi-answer" (Multiple Answer / Select All That Apply)
   interaction_data: {
     "choices": [
       { "item_body": "Option A", "position": 1 },
       { "item_body": "Option B", "position": 2 },
       { "item_body": "Option C", "position": 3 }
     ]
   }
   scoring_data: { "value": ["<id_of_correct_1>", "<id_of_correct_2>"] }

4. "essay" (Essay / Free Response)
   interaction_data: {}
   scoring_data: { "value": "" }

5. "file-upload" (File Upload)
   interaction_data: {}
   scoring_data: { "value": "" }

6. "matching" (Matching)
   interaction_data: {
     "choices": [
       { "item_body": "Term 1", "position": 1, "match_id": "m1" },
       { "item_body": "Term 2", "position": 2, "match_id": "m2" }
     ],
     "matches": [
       { "item_body": "Definition 1", "id": "m1", "position": 1 },
       { "item_body": "Definition 2", "id": "m2", "position": 2 }
     ]
   }
   scoring_data: { "value": [{ "id": "<choice_id>", "match_id": "m1" }] }

7. "ordering" (Ordering)
   interaction_data: {
     "choices": [
       { "item_body": "First item", "position": 1 },
       { "item_body": "Second item", "position": 2 }
     ]
   }
   scoring_data: { "value": ["<id_in_correct_order>", "<id_in_correct_order>"] }

8. "categorization" (Categorization)
   interaction_data: {
     "categories": [
       { "item_body": "Category A", "id": "cat1" },
       { "item_body": "Category B", "id": "cat2" }
     ],
     "choices": [
       { "item_body": "Item 1", "position": 1 },
       { "item_body": "Item 2", "position": 2 }
     ]
   }
   scoring_data: { "value": [{ "id": "<choice_id>", "category_id": "cat1" }] }

9. "numeric" (Numeric Answer)
   interaction_data: {}
   scoring_data: { "value": "42" } or { "value": { "exact": 42, "margin": 0.1 } }

10. "fill-blank" (Fill in the Blank)
    interaction_data: {}
    scoring_data: { "value": ["acceptable answer 1", "acceptable answer 2"] }

11. "rich-fill-blank" (Fill in Multiple Blanks)
    interaction_data: { "blanks": [{ "id": "b1", "item_body": "blank1" }] }
    scoring_data: { "value": { "b1": ["answer1", "answer2"] } }

12. "formula" (Formula / Calculated)
    interaction_data: { "formula": "x + y", "variables": [{ "name": "x", "min": 1, "max": 10 }] }
    scoring_data: { "value": { "formula": "x + y", "margin": 0.01 } }

13. "hot-spot" (Hot Spot / Image Click)
    interaction_data: { "image_url": "...", "regions": [...] }
    scoring_data: { "value": "<region_id>" }

TIP: For choice-based questions, it is often easiest to create the item first with
an empty or placeholder scoring_data, then GET the item to see the generated choice
IDs, and finally UPDATE the item with the correct scoring_data referencing those IDs.`,
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("The assignment ID of the New Quiz"),
      position: z
        .number()
        .optional()
        .describe("Position/order of this question in the quiz (1-based)"),
      points_possible: z
        .number()
        .describe("Point value for this question"),
      title: z.string().describe("Short title for the question"),
      item_body: z
        .string()
        .describe(
          "The question text/prompt (HTML supported, e.g. '<p>What is 2+2?</p>')"
        ),
      interaction_type: z
        .enum([
          "choice",
          "true-false",
          "essay",
          "file-upload",
          "matching",
          "ordering",
          "categorization",
          "numeric",
          "formula",
          "rich-fill-blank",
          "multi-answer",
          "hot-spot",
          "fill-blank",
        ])
        .describe("The question type (see tool description for formats)"),
      interaction_data: z
        .record(z.any())
        .describe(
          "Question-type-specific data (choices, matches, etc). See tool description for format per type."
        ),
      scoring_data: z
        .record(z.any())
        .describe(
          "Correct answer data. See tool description for format per type."
        ),
      feedback_neutral: z
        .string()
        .optional()
        .describe(
          "Feedback shown to all students after answering (HTML supported)"
        ),
    },
    async ({
      course_id,
      assignment_id,
      position,
      points_possible,
      title,
      item_body,
      interaction_type,
      interaction_data,
      scoring_data,
      feedback_neutral,
    }) => {
      const entry: Record<string, any> = {
        title,
        item_body,
        calculator_type: "none",
        interaction_type_slug: interaction_type,
        interaction_data,
        scoring_data,
      };
      if (feedback_neutral) {
        entry.feedback = { neutral: feedback_neutral };
      }

      const item: Record<string, any> = {
        points_possible,
        properties: {},
        entry_type: "Item",
        entry,
      };
      if (position !== undefined) {
        item.position = position;
      }

      const result = await canvas(
        quizApiPath(
          `/courses/${course_id}/quizzes/${assignment_id}/items`
        ),
        {
          method: "POST",
          body: JSON.stringify({ item }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Created quiz item "${title}" (ID: ${result.id})\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );

  // ── 7. Update Quiz Item ────────────────────────────────────────────────
  server.tool(
    "update_quiz_item",
    "Update an existing question (item) in a New Quiz. Only include fields you want to change. Commonly used after create_quiz_item to set the correct answer IDs in scoring_data once the choice IDs are known.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("The assignment ID of the New Quiz"),
      item_id: z.string().describe("The quiz item ID to update"),
      position: z.number().optional().describe("Position in the quiz"),
      points_possible: z.number().optional().describe("Point value"),
      title: z.string().optional().describe("Question title"),
      item_body: z
        .string()
        .optional()
        .describe("Question text/prompt (HTML)"),
      interaction_type: z
        .enum([
          "choice",
          "true-false",
          "essay",
          "file-upload",
          "matching",
          "ordering",
          "categorization",
          "numeric",
          "formula",
          "rich-fill-blank",
          "multi-answer",
          "hot-spot",
          "fill-blank",
        ])
        .optional()
        .describe("Question type"),
      interaction_data: z
        .record(z.any())
        .optional()
        .describe("Updated choices/answers structure"),
      scoring_data: z
        .record(z.any())
        .optional()
        .describe("Updated correct answer data"),
      feedback_neutral: z
        .string()
        .optional()
        .describe("Updated feedback text (HTML)"),
    },
    async ({
      course_id,
      assignment_id,
      item_id,
      position,
      points_possible,
      title,
      item_body,
      interaction_type,
      interaction_data,
      scoring_data,
      feedback_neutral,
    }) => {
      const entry: Record<string, any> = {};
      if (title !== undefined) entry.title = title;
      if (item_body !== undefined) entry.item_body = item_body;
      if (interaction_type !== undefined)
        entry.interaction_type_slug = interaction_type;
      if (interaction_data !== undefined)
        entry.interaction_data = interaction_data;
      if (scoring_data !== undefined) entry.scoring_data = scoring_data;
      if (feedback_neutral !== undefined)
        entry.feedback = { neutral: feedback_neutral };

      const item: Record<string, any> = {};
      if (position !== undefined) item.position = position;
      if (points_possible !== undefined)
        item.points_possible = points_possible;
      if (Object.keys(entry).length > 0) {
        item.entry_type = "Item";
        item.entry = entry;
      }

      const result = await canvas(
        quizApiPath(
          `/courses/${course_id}/quizzes/${assignment_id}/items/${item_id}`
        ),
        {
          method: "PATCH",
          body: JSON.stringify({ item }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Updated quiz item (ID: ${result.id})\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );

  // ── 8. Delete Quiz Item ────────────────────────────────────────────────
  server.tool(
    "delete_quiz_item",
    "Delete a question (item) from a New Quiz. This cannot be undone.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("The assignment ID of the New Quiz"),
      item_id: z.string().describe("The quiz item ID to delete"),
    },
    async ({ course_id, assignment_id, item_id }) => {
      await canvas(
        quizApiPath(
          `/courses/${course_id}/quizzes/${assignment_id}/items/${item_id}`
        ),
        { method: "DELETE" }
      );
      return {
        content: [
          {
            type: "text",
            text: `Deleted quiz item ${item_id} from quiz ${assignment_id}`,
          },
        ],
      };
    }
  );

  // ── 9. Set Quiz Accommodations ─────────────────────────────────────────
  server.tool(
    "set_quiz_accommodations",
    "Set testing accommodations (extra time, extra attempts) for specific students on a New Quiz. Use list_students to find student user IDs.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("The assignment ID of the New Quiz"),
      student_ids: z
        .array(z.string())
        .describe("List of Canvas user IDs to accommodate"),
      extra_time_seconds: z
        .number()
        .optional()
        .describe("Extra time in seconds (e.g. 600 for 10 extra minutes)"),
      extra_attempts: z
        .number()
        .optional()
        .describe("Number of extra attempts to grant"),
    },
    async ({
      course_id,
      assignment_id,
      student_ids,
      extra_time_seconds,
      extra_attempts,
    }) => {
      const accommodations = student_ids.map((student_id) => {
        const acc: Record<string, any> = { student_id };
        if (extra_time_seconds !== undefined)
          acc.extra_time = extra_time_seconds;
        if (extra_attempts !== undefined)
          acc.extra_attempts = extra_attempts;
        return acc;
      });

      const result = await canvas(
        quizApiPath(
          `/courses/${course_id}/quizzes/${assignment_id}/accommodations`
        ),
        {
          method: "POST",
          body: JSON.stringify({ quiz_accommodations: accommodations }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Set accommodations for ${student_ids.length} student(s) on quiz ${assignment_id}\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );

  // ── 10. Generate Quiz Report ───────────────────────────────────────────
  server.tool(
    "generate_quiz_report",
    "Generate a student analysis or item analysis report for a New Quiz. Returns a progress object — poll the returned URL to check when the report file is ready for download.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("The assignment ID of the New Quiz"),
      report_type: z
        .enum(["student_analysis", "item_analysis"])
        .describe(
          "Type of report: 'student_analysis' for per-student results, 'item_analysis' for per-question statistics"
        ),
      format: z
        .enum(["csv", "json"])
        .describe("Output format for the report"),
    },
    async ({ course_id, assignment_id, report_type, format }) => {
      const result = await canvas(
        quizApiPath(
          `/courses/${course_id}/quizzes/${assignment_id}/reports`
        ),
        {
          method: "POST",
          body: JSON.stringify({ report_type, format }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Report generation started.\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );
}
