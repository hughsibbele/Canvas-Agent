import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas } from "../canvas-client.js";
import { rehydrateText } from "../anonymizer.js";

export function registerCommunicationCore(server: McpServer) {
  server.tool(
    "post_submission_comment",
    "Add a comment to a student's submission without changing the grade. Useful for leaving feedback during review or asking for revisions. For comments + grade in one call, use grade_submission with the comment field instead.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
      user_id: z.string().describe("Student user ID"),
      comment: z.string().describe("Comment text"),
      group_comment: z
        .boolean()
        .default(false)
        .describe(
          "For group assignments, send the comment to every group member instead of just this user."
        ),
    },
    async ({ course_id, assignment_id, user_id, comment, group_comment }) => {
      const body = {
        comment: {
          text_comment: rehydrateText(comment, course_id),
          group_comment,
        },
      };
      const result = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}/submissions/${user_id}`,
        { method: "PUT", body: JSON.stringify(body) }
      );
      return {
        content: [
          {
            type: "text",
            text: `Comment added on submission for user ${user_id}. Submission state: ${result.workflow_state}`,
          },
        ],
      };
    }
  );
}

export function registerCommunicationExtras(server: McpServer) {
  server.tool(
    "send_message",
    "Send a Canvas Inbox (Conversations) message to one or more users. Recipients can be individual users (id strings) or course/section bulk targets (e.g. 'course_1234_students', 'section_5678'). Pass group_conversation=true to put everyone on the same thread; otherwise each recipient gets a separate 1:1 thread.",
    {
      recipients: z
        .array(z.string())
        .describe(
          "List of recipient ids. User ids as plain strings ('1234'); course/section bulk targets as 'course_<id>_students', 'course_<id>_teachers', 'section_<id>', etc."
        ),
      subject: z.string().optional().describe("Message subject"),
      body: z.string().describe("Message body (plain text or simple HTML)"),
      group_conversation: z
        .boolean()
        .default(false)
        .describe(
          "If true, all recipients see one thread together. If false (default), each recipient gets their own private thread."
        ),
      context_code: z
        .string()
        .optional()
        .describe(
          "Scope the message to a course context, e.g. 'course_1234'. Required when sending to a bulk recipient like 'course_1234_students'."
        ),
      bulk_message: z
        .boolean()
        .optional()
        .describe(
          "Send as a bulk private message (one-to-each) when recipient count is large. Forces group_conversation=false."
        ),
    },
    async ({
      recipients,
      subject,
      body,
      group_conversation,
      context_code,
      bulk_message,
    }) => {
      const payload: any = {
        recipients,
        body: rehydrateText(body, null),
        group_conversation,
      };
      if (subject) payload.subject = rehydrateText(subject, null);
      if (context_code) payload.context_code = context_code;
      if (bulk_message) payload.bulk_message = true;
      const result = await canvas(`/conversations`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "create_announcement",
    "Post an announcement to a course. Announcements appear at the top of the course home page and notify students by default. Internally they're a discussion topic with is_announcement=true.",
    {
      course_id: z.string().describe("Canvas course ID"),
      title: z.string().describe("Announcement title"),
      message: z.string().describe("Announcement body (HTML)"),
      delayed_post_at: z
        .string()
        .optional()
        .describe(
          "Schedule the announcement to post at this ISO 8601 timestamp instead of immediately."
        ),
      lock_comments: z
        .boolean()
        .default(false)
        .describe(
          "If true, students cannot reply (locked = read-only)."
        ),
      published: z
        .boolean()
        .default(true)
        .describe("Publish immediately (default true)."),
    },
    async ({
      course_id,
      title,
      message,
      delayed_post_at,
      lock_comments,
      published,
    }) => {
      const body: any = {
        title: rehydrateText(title, course_id),
        message: rehydrateText(message, course_id),
        is_announcement: true,
        published,
        locked: lock_comments,
      };
      if (delayed_post_at) body.delayed_post_at = delayed_post_at;
      const result = await canvas(`/courses/${course_id}/discussion_topics`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [
          {
            type: "text",
            text: `Announcement "${result.title}" posted (ID: ${result.id})\n${result.html_url}`,
          },
        ],
      };
    }
  );
}
