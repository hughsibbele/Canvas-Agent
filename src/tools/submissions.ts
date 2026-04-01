import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export function registerSubmissionTools(server: McpServer) {
  server.tool(
    "list_submissions",
    "List all submissions for an assignment (including graded discussions and New Quizzes). Shows student name, score, submission status, and submitted_at timestamp.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z
        .string()
        .describe(
          "Assignment ID (also works for the linked assignment of graded discussions and New Quizzes)"
        ),
      include_comments: z
        .boolean()
        .default(false)
        .describe("Include submission comments"),
    },
    async ({ course_id, assignment_id, include_comments }) => {
      const params: Record<string, string> = {
        include: include_comments ? "user,submission_comments" : "user",
      };
      // Use the "grouped" parameter to avoid duplicate entries
      const submissions = await canvasAll(
        `/courses/${course_id}/assignments/${assignment_id}/submissions`,
        params
      );
      const summary = submissions.map((s: any) => ({
        user_id: s.user_id,
        user_name: s.user?.name ?? s.user?.sortable_name ?? "unknown",
        workflow_state: s.workflow_state,
        submitted_at: s.submitted_at,
        score: s.score,
        grade: s.grade,
        late: s.late,
        missing: s.missing,
        attempt: s.attempt,
        submission_type: s.submission_type,
        preview_url: s.preview_url,
        ...(include_comments && s.submission_comments
          ? {
              comments: s.submission_comments.map((c: any) => ({
                author: c.author_name,
                comment: c.comment,
                created_at: c.created_at,
              })),
            }
          : {}),
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "download_submissions",
    "Download all submitted files for an assignment to a local directory. Creates a folder per student. Returns the path where files were saved.",
    {
      course_id: z.string().describe("Canvas course ID"),
      assignment_id: z.string().describe("Assignment ID"),
      output_dir: z
        .string()
        .default("./downloads")
        .describe("Local directory to save files to"),
    },
    async ({ course_id, assignment_id, output_dir }) => {
      const submissions = await canvasAll(
        `/courses/${course_id}/assignments/${assignment_id}/submissions`,
        { include: "user" }
      );

      // Get assignment name for the folder
      const assignment = await canvas(
        `/courses/${course_id}/assignments/${assignment_id}`
      );
      const safeName = assignment.name.replace(/[^a-zA-Z0-9_\- ]/g, "");
      const baseDir = join(output_dir, safeName);

      let downloaded = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const sub of submissions) {
        if (!sub.attachments || sub.attachments.length === 0) {
          skipped++;
          continue;
        }

        const studentName = (
          sub.user?.sortable_name ??
          sub.user?.name ??
          `user_${sub.user_id}`
        ).replace(/[^a-zA-Z0-9_\- ]/g, "");

        const studentDir = join(baseDir, studentName);
        await mkdir(studentDir, { recursive: true });

        for (const attachment of sub.attachments) {
          try {
            let res: Response | null = null;
            for (let attempt = 0; attempt < 3; attempt++) {
              res = await fetch(attachment.url, {
                headers: {
                  Authorization: `Bearer ${process.env.CANVAS_API_TOKEN}`,
                },
              });
              if (res.ok || res.status !== 429) break;
              const delay = 1000 * (attempt + 1);
              await new Promise((r) => setTimeout(r, delay));
            }
            if (!res!.ok) throw new Error(`HTTP ${res!.status} for ${attachment.filename}`);
            const buffer = Buffer.from(await res!.arrayBuffer());
            await writeFile(
              join(studentDir, attachment.filename),
              buffer
            );
            downloaded++;
          } catch (e: any) {
            errors.push(
              `  ${studentName}/${attachment.filename}: ${e.message}`
            );
          }
        }
      }

      let report = `Downloaded submissions for "${assignment.name}" to ${baseDir}\n`;
      report += `  Files downloaded: ${downloaded}\n`;
      report += `  Students with no submission: ${skipped}\n`;
      if (errors.length > 0) {
        report += `  Errors:\n${errors.join("\n")}`;
      }

      return { content: [{ type: "text", text: report }] };
    }
  );

  server.tool(
    "download_discussion_entries",
    "Download all entries/replies for a discussion topic as a JSON file — the actual student posts and replies. Unlike list_submissions (which shows grading metadata for graded discussions), this downloads the discussion content itself.",
    {
      course_id: z.string().describe("Canvas course ID"),
      discussion_id: z.string().describe("Discussion topic ID"),
      output_dir: z.string().default("./downloads"),
    },
    async ({ course_id, discussion_id, output_dir }) => {
      const [discussion, entries] = await Promise.all([
        canvas(`/courses/${course_id}/discussion_topics/${discussion_id}`),
        canvasAll(
          `/courses/${course_id}/discussion_topics/${discussion_id}/entries`
        ),
      ]);

      // Also fetch replies for each top-level entry
      const fullEntries = await Promise.all(
        entries.map(async (entry: any) => {
          let replies: any[] = [];
          try {
            replies = await canvasAll(
              `/courses/${course_id}/discussion_topics/${discussion_id}/entries/${entry.id}/replies`
            );
          } catch {
            // Some entries may not have replies endpoint
          }
          return {
            id: entry.id,
            user_name: entry.user_name,
            message: entry.message,
            created_at: entry.created_at,
            replies: replies.map((r: any) => ({
              id: r.id,
              user_name: r.user_name,
              message: r.message,
              created_at: r.created_at,
            })),
          };
        })
      );

      const safeName = discussion.title.replace(/[^a-zA-Z0-9_\- ]/g, "");
      await mkdir(output_dir, { recursive: true });
      const filePath = join(output_dir, `${safeName}.json`);
      await writeFile(filePath, JSON.stringify(fullEntries, null, 2));

      return {
        content: [
          {
            type: "text",
            text: `Saved ${fullEntries.length} entries (with replies) to ${filePath}`,
          },
        ],
      };
    }
  );
}
