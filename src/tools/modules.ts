import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerModulesCore(server: McpServer) {
  server.tool(
    "create_module",
    "Create a new module in a course. Use list_modules to see existing modules first.",
    {
      course_id: z.string().describe("Canvas course ID"),
      name: z.string().describe("Module name"),
      position: z.number().optional().describe("Position in the module list"),
      unlock_at: z
        .string()
        .optional()
        .describe("Date the module unlocks (ISO 8601)"),
      require_sequential_progress: z
        .boolean()
        .optional()
        .describe("Require students to complete items in order"),
      prerequisite_module_ids: z
        .array(z.string())
        .optional()
        .describe("IDs of modules that must be completed first"),
    },
    async ({ course_id, name, position, unlock_at, require_sequential_progress, prerequisite_module_ids }) => {
      const moduleData: Record<string, any> = { name };
      if (position !== undefined) moduleData.position = position;
      if (unlock_at !== undefined) moduleData.unlock_at = unlock_at;
      if (require_sequential_progress !== undefined)
        moduleData.require_sequential_progress = require_sequential_progress;
      if (prerequisite_module_ids !== undefined)
        moduleData.prerequisite_module_ids = prerequisite_module_ids;

      const result = await canvas(`/courses/${course_id}/modules`, {
        method: "POST",
        body: JSON.stringify({ module: moduleData }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Created module "${result.name}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_module",
    "Update an existing module. Only include fields you want to change.",
    {
      course_id: z.string().describe("Canvas course ID"),
      module_id: z.string().describe("Module ID"),
      name: z.string().optional(),
      position: z.number().optional(),
      published: z.boolean().optional(),
      unlock_at: z.string().optional().describe("ISO 8601"),
    },
    async ({ course_id, module_id, ...params }) => {
      const result = await canvas(
        `/courses/${course_id}/modules/${module_id}`,
        {
          method: "PUT",
          body: JSON.stringify({ module: params }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Updated module "${result.name}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_module",
    "Permanently delete a module and all items within it. This cannot be undone.",
    {
      course_id: z.string().describe("Canvas course ID"),
      module_id: z.string().describe("Module ID"),
      confirm_name: z
        .string()
        .describe("Type the module name to confirm deletion (safety check)"),
    },
    async ({ course_id, module_id, confirm_name }) => {
      const module = await canvas(
        `/courses/${course_id}/modules/${module_id}`
      );
      if (module.name !== confirm_name) {
        return {
          content: [
            {
              type: "text",
              text: `Safety check failed: module name is "${module.name}" but you confirmed "${confirm_name}". Delete aborted.`,
            },
          ],
        };
      }
      await canvas(`/courses/${course_id}/modules/${module_id}`, {
        method: "DELETE",
      });
      return {
        content: [
          {
            type: "text",
            text: `Deleted module "${confirm_name}"`,
          },
        ],
      };
    }
  );

  server.tool(
    "list_module_items",
    "List all items in a module.",
    {
      course_id: z.string().describe("Canvas course ID"),
      module_id: z.string().describe("Module ID"),
    },
    async ({ course_id, module_id }) => {
      const items = await canvasAll(
        `/courses/${course_id}/modules/${module_id}/items`
      );
      const summary = items.map((i: any) => ({
        id: i.id,
        title: i.title,
        type: i.type,
        position: i.position,
        content_id: i.content_id,
        html_url: i.html_url,
        published: i.published,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "add_module_item",
    "Add an item to a module. Required fields depend on type: Assignment/Discussion/File need content_id, Page needs page_url, SubHeader/ExternalUrl need title. For New Quizzes, use type='Assignment' with the New Quiz's assignment_id (not type='Quiz'). type='Quiz' is for Classic Quizzes only.",
    {
      course_id: z.string().describe("Canvas course ID"),
      module_id: z.string().describe("Module ID"),
      type: z
        .enum([
          "Assignment",
          "Quiz",
          "Discussion",
          "File",
          "Page",
          "SubHeader",
          "ExternalUrl",
          "ExternalTool",
        ])
        .describe("Type of item to add"),
      content_id: z
        .string()
        .optional()
        .describe("ID of the content (required for Assignment, Quiz, Discussion, File)"),
      page_url: z
        .string()
        .optional()
        .describe("URL slug of the page (required for Page type)"),
      title: z
        .string()
        .optional()
        .describe("Title (required for SubHeader and ExternalUrl)"),
      external_url: z
        .string()
        .optional()
        .describe("URL for ExternalUrl type"),
      position: z.number().optional().describe("Position within the module"),
      indent: z
        .number()
        .optional()
        .describe("Indentation level (0-5)"),
    },
    async ({ course_id, module_id, type, content_id, page_url, title, external_url, position, indent }) => {
      const moduleItem: Record<string, any> = { type };
      if (content_id !== undefined) moduleItem.content_id = content_id;
      if (page_url !== undefined) moduleItem.page_url = page_url;
      if (title !== undefined) moduleItem.title = title;
      if (external_url !== undefined) moduleItem.external_url = external_url;
      if (position !== undefined) moduleItem.position = position;
      if (indent !== undefined) moduleItem.indent = indent;

      const result = await canvas(
        `/courses/${course_id}/modules/${module_id}/items`,
        {
          method: "POST",
          body: JSON.stringify({ module_item: moduleItem }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Added "${result.title}" (ID: ${result.id}, type: ${result.type}) to module`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_module_item",
    "Update a module item. Only include fields you want to change.",
    {
      course_id: z.string().describe("Canvas course ID"),
      module_id: z.string().describe("Module ID"),
      item_id: z.string().describe("Module item ID"),
      title: z.string().optional(),
      position: z.number().optional(),
      indent: z.number().optional().describe("Indentation level (0-5)"),
      published: z.boolean().optional(),
    },
    async ({ course_id, module_id, item_id, ...params }) => {
      const result = await canvas(
        `/courses/${course_id}/modules/${module_id}/items/${item_id}`,
        {
          method: "PUT",
          body: JSON.stringify({ module_item: params }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Updated module item "${result.title}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_module_item",
    "Remove an item from a module. This only removes the module entry — the underlying assignment/page/file is not deleted.",
    {
      course_id: z.string().describe("Canvas course ID"),
      module_id: z.string().describe("Module ID"),
      item_id: z.string().describe("Module item ID"),
      confirm_title: z
        .string()
        .describe(
          "Type the module item title to confirm deletion (safety check)"
        ),
    },
    async ({ course_id, module_id, item_id, confirm_title }) => {
      const item = await canvas(
        `/courses/${course_id}/modules/${module_id}/items/${item_id}`
      );
      if (item.title !== confirm_title) {
        return {
          content: [
            {
              type: "text",
              text: `Safety check failed: module item title is "${item.title}" but you confirmed "${confirm_title}". Delete aborted.`,
            },
          ],
        };
      }
      await canvas(
        `/courses/${course_id}/modules/${module_id}/items/${item_id}`,
        { method: "DELETE" }
      );
      return {
        content: [
          {
            type: "text",
            text: `Deleted module item "${confirm_title}"`,
          },
        ],
      };
    }
  );

  server.tool(
    "publish_module",
    "Publish a module (makes it visible to students). Note: this publishes the module container only — individual items retain their own published state.",
    {
      course_id: z.string().describe("Canvas course ID"),
      module_id: z.string().describe("Module ID"),
    },
    async ({ course_id, module_id }) => {
      const result = await canvas(
        `/courses/${course_id}/modules/${module_id}`,
        {
          method: "PUT",
          body: JSON.stringify({ module: { published: true } }),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Published module "${result.name}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );
}
