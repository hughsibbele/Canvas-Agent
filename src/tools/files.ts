import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerFileTools(server: McpServer) {
  server.tool(
    "list_course_files",
    "List files in a course, optionally filtered by search term, content type, or sort order.",
    {
      course_id: z.string().describe("Canvas course ID"),
      search_term: z.string().optional().describe("Filter by filename substring"),
      content_types: z
        .array(z.string())
        .optional()
        .describe('Filter by MIME type (e.g. ["application/pdf"])'),
      sort: z
        .enum(["name", "size", "created_at", "updated_at"])
        .optional()
        .describe("Sort order"),
    },
    async ({ course_id, search_term, content_types, sort }) => {
      const params: Record<string, string> = {};
      if (search_term) params.search_term = search_term;
      if (sort) params.sort = sort;
      // Canvas expects content_types[] as repeated params; encode manually
      let extraQs = "";
      if (content_types && content_types.length > 0) {
        extraQs = content_types
          .map((ct) => `content_types[]=${encodeURIComponent(ct)}`)
          .join("&");
      }

      const path = extraQs
        ? `/courses/${course_id}/files?${extraQs}`
        : `/courses/${course_id}/files`;
      const files = await canvasAll(path, params);
      const summary = files.map((f: any) => ({
        id: f.id,
        display_name: f.display_name,
        filename: f.filename,
        size: f.size,
        content_type: f["content-type"],
        url: f.url,
        created_at: f.created_at,
        updated_at: f.updated_at,
        folder_id: f.folder_id,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "get_file",
    "Get full details of a single file, including its download URL.",
    {
      file_id: z.string().describe("File ID"),
    },
    async ({ file_id }) => {
      const file = await canvas(`/files/${file_id}`);
      return {
        content: [{ type: "text", text: JSON.stringify(file, null, 2) }],
      };
    }
  );

  server.tool(
    "list_folders",
    "List all folders in a course.",
    {
      course_id: z.string().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
      const folders = await canvasAll(`/courses/${course_id}/folders`);
      const summary = folders.map((f: any) => ({
        id: f.id,
        name: f.name,
        full_name: f.full_name,
        parent_folder_id: f.parent_folder_id,
        files_count: f.files_count,
        folders_count: f.folders_count,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "create_folder",
    "Create a new folder in a course.",
    {
      course_id: z.string().describe("Canvas course ID"),
      name: z.string().describe("Folder name"),
      parent_folder_path: z
        .string()
        .optional()
        .default("/")
        .describe("Parent folder path (default: root)"),
      hidden: z.boolean().optional().describe("Hide the folder from students"),
      locked: z.boolean().optional().describe("Lock the folder"),
    },
    async ({ course_id, name, parent_folder_path, hidden, locked }) => {
      const body: Record<string, any> = { name, parent_folder_path };
      if (hidden !== undefined) body.hidden = hidden;
      if (locked !== undefined) body.locked = locked;

      const result = await canvas(`/courses/${course_id}/folders`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [
          {
            type: "text",
            text: `Created folder "${result.name}" (ID: ${result.id}) at ${result.full_name}`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_file",
    "Permanently delete a file.",
    {
      file_id: z.string().describe("File ID"),
      confirm_name: z
        .string()
        .describe(
          "Type the file's display name to confirm deletion (safety check)"
        ),
    },
    async ({ file_id, confirm_name }) => {
      const file = await canvas(`/files/${file_id}`);
      const actualName = file.display_name ?? file.filename;
      if (actualName !== confirm_name) {
        return {
          content: [
            {
              type: "text",
              text: `Safety check failed: file name is "${actualName}" but you confirmed "${confirm_name}". Delete aborted.`,
            },
          ],
        };
      }
      await canvas(`/files/${file_id}`, { method: "DELETE" });
      return {
        content: [{ type: "text", text: `Deleted file "${actualName}"` }],
      };
    }
  );

  server.tool(
    "update_file",
    "Update file metadata. Only include fields you want to change.",
    {
      file_id: z.string().describe("File ID"),
      name: z.string().optional().describe("Rename the file"),
      lock_at: z.string().optional().describe("Lock date (ISO 8601)"),
      unlock_at: z.string().optional().describe("Unlock date (ISO 8601)"),
      locked: z.boolean().optional().describe("Lock the file"),
      hidden: z.boolean().optional().describe("Hide from students"),
    },
    async ({ file_id, ...params }) => {
      const result = await canvas(`/files/${file_id}`, {
        method: "PUT",
        body: JSON.stringify(params),
      });
      return {
        content: [
          {
            type: "text",
            text: `Updated file "${result.display_name}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_file_quota",
    "Get the file storage quota and usage for a course.",
    {
      course_id: z.string().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
      const quota = await canvas(`/courses/${course_id}/files/quota`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                quota: quota.quota,
                quota_used: quota.quota_used,
                quota_remaining: quota.quota - quota.quota_used,
                quota_human: `${(quota.quota / 1024 / 1024).toFixed(1)} MB`,
                used_human: `${(quota.quota_used / 1024 / 1024).toFixed(1)} MB`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
