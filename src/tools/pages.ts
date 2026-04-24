import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerPageTools(server: McpServer) {
  server.tool(
    "list_pages",
    "List all wiki pages in a course. Returns summary info (url, title, published, updated_at). Use get_page for full content.",
    {
      course_id: z.string().describe("Canvas course ID"),
      search_term: z.string().optional().describe("Filter by title substring"),
      published: z.boolean().optional().describe("Filter by published state"),
      sort: z
        .enum(["title", "created_at", "updated_at"])
        .optional()
        .describe("Sort order"),
    },
    async ({ course_id, search_term, published, sort }) => {
      const params: Record<string, string> = {};
      if (search_term) params.search_term = search_term;
      if (published !== undefined) params.published = String(published);
      if (sort) params.sort = sort;

      const pages = await canvasAll(`/courses/${course_id}/pages`, params);
      const summary = pages.map((p: any) => ({
        url: p.url,
        title: p.title,
        published: p.published,
        updated_at: p.updated_at,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "get_page",
    "Get full details of a wiki page, including its body HTML content.",
    {
      course_id: z.string().describe("Canvas course ID"),
      url_or_id: z
        .string()
        .describe("Page URL slug (e.g. 'my-page-title') or numeric page ID"),
    },
    async ({ course_id, url_or_id }) => {
      const page = await canvas(
        `/courses/${course_id}/pages/${url_or_id}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(page, null, 2) }],
      };
    }
  );

  server.tool(
    "create_page",
    "Create a new wiki page in a course.",
    {
      course_id: z.string().describe("Canvas course ID"),
      title: z.string().describe("Page title"),
      body: z.string().describe("Page content (HTML)"),
      published: z.boolean().default(false).describe("Publish immediately"),
      front_page: z
        .boolean()
        .optional()
        .describe("Set as the course front page"),
      editing_roles: z
        .string()
        .optional()
        .describe(
          "Who can edit: 'teachers', 'students', 'members', or 'public'"
        ),
    },
    async ({ course_id, title, body, published, front_page, editing_roles }) => {
      const wiki_page: Record<string, any> = { title, body, published };
      if (front_page !== undefined) wiki_page.front_page = front_page;
      if (editing_roles) wiki_page.editing_roles = editing_roles;

      const result = await canvas(`/courses/${course_id}/pages`, {
        method: "POST",
        body: JSON.stringify({ wiki_page }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Created page "${result.title}" (URL: ${result.url})\n${result.html_url}`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_page",
    "Update an existing wiki page. Only include fields you want to change.",
    {
      course_id: z.string().describe("Canvas course ID"),
      url_or_id: z
        .string()
        .describe("Page URL slug or numeric page ID"),
      title: z.string().optional().describe("New page title"),
      body: z.string().optional().describe("New page content (HTML)"),
      published: z.boolean().optional().describe("Publish or unpublish"),
      front_page: z
        .boolean()
        .optional()
        .describe("Set or unset as front page"),
    },
    async ({ course_id, url_or_id, title, body, published, front_page }) => {
      const wiki_page: Record<string, any> = {};
      if (title !== undefined) wiki_page.title = title;
      if (body !== undefined) wiki_page.body = body;
      if (published !== undefined) wiki_page.published = published;
      if (front_page !== undefined) wiki_page.front_page = front_page;

      const result = await canvas(
        `/courses/${course_id}/pages/${url_or_id}`,
        {
          method: "PUT",
          body: JSON.stringify({ wiki_page }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Updated page "${result.title}" (URL: ${result.url})`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_page",
    "Permanently delete a wiki page. This cannot be undone.",
    {
      course_id: z.string().describe("Canvas course ID"),
      url_or_id: z
        .string()
        .describe("Page URL slug or numeric page ID"),
      confirm_title: z
        .string()
        .describe("Type the page title to confirm deletion (safety check)"),
    },
    async ({ course_id, url_or_id, confirm_title }) => {
      const page = await canvas(`/courses/${course_id}/pages/${url_or_id}`);
      if (page.title !== confirm_title) {
        return {
          content: [
            {
              type: "text",
              text: `Safety check failed: page title is "${page.title}" but you confirmed "${confirm_title}". Delete aborted.`,
            },
          ],
        };
      }
      await canvas(`/courses/${course_id}/pages/${url_or_id}`, {
        method: "DELETE",
      });
      return {
        content: [
          { type: "text", text: `Deleted page "${page.title}"` },
        ],
      };
    }
  );

  server.tool(
    "list_page_revisions",
    "List revision history for a wiki page. Shows who edited and when.",
    {
      course_id: z.string().describe("Canvas course ID"),
      url_or_id: z
        .string()
        .describe("Page URL slug or numeric page ID"),
    },
    async ({ course_id, url_or_id }) => {
      const revisions = await canvasAll(
        `/courses/${course_id}/pages/${url_or_id}/revisions`
      );
      const summary = revisions.map((r: any) => ({
        revision_id: r.revision_id,
        updated_at: r.updated_at,
        edited_by: r.edited_by
          ? { id: r.edited_by.id, display_name: r.edited_by.display_name }
          : null,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "get_front_page",
    "Get the course front page content.",
    {
      course_id: z.string().describe("Canvas course ID"),
    },
    async ({ course_id }) => {
      const page = await canvas(`/courses/${course_id}/front_page`);
      return {
        content: [{ type: "text", text: JSON.stringify(page, null, 2) }],
      };
    }
  );
}
