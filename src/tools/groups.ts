import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerGroupTools(server: McpServer) {
  server.tool(
    "list_group_categories",
    "List the group sets (categories) defined in a course. A group set is a container for related groups (e.g. 'Project Teams'). Use the returned id to create groups inside it or to assign students.",
    { course_id: z.string().describe("Canvas course ID") },
    async ({ course_id }) => {
      const cats = await canvasAll(
        `/courses/${course_id}/group_categories`
      );
      const summary = cats.map((c: any) => ({
        id: c.id,
        name: c.name,
        self_signup: c.self_signup,
        group_limit: c.group_limit,
        auto_leader: c.auto_leader,
        created_at: c.created_at,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "create_group_set",
    "Create a new group set (group category) in a course. Optionally have Canvas auto-create the groups by passing create_group_count and split_method.",
    {
      course_id: z.string().describe("Canvas course ID"),
      name: z.string().describe("Group set name (e.g. 'Project Teams')"),
      self_signup: z
        .enum(["enabled", "restricted"])
        .optional()
        .describe(
          "Allow students to pick their own group. 'enabled' = any group; 'restricted' = only within their section."
        ),
      group_limit: z
        .number()
        .optional()
        .describe("Max members per group (used with self_signup)"),
      create_group_count: z
        .number()
        .optional()
        .describe(
          "Number of groups Canvas should auto-create. Combine with split_method."
        ),
      split_method: z
        .enum(["random", "by_section"])
        .optional()
        .describe(
          "How to distribute students into the auto-created groups. Only used with create_group_count."
        ),
    },
    async ({ course_id, ...fields }) => {
      const payload: any = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) payload[k] = v;
      }
      const result = await canvas(
        `/courses/${course_id}/group_categories`,
        { method: "POST", body: JSON.stringify(payload) }
      );
      return {
        content: [
          {
            type: "text",
            text: `Created group set "${result.name}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "list_groups",
    "List the groups in a course or in a specific group set. Pass group_category_id to scope to one set.",
    {
      course_id: z.string().describe("Canvas course ID"),
      group_category_id: z
        .string()
        .optional()
        .describe(
          "Filter to one group set. If omitted, returns all groups in the course."
        ),
    },
    async ({ course_id, group_category_id }) => {
      const path = group_category_id
        ? `/group_categories/${group_category_id}/groups`
        : `/courses/${course_id}/groups`;
      const groups = await canvasAll(path);
      const summary = groups.map((g: any) => ({
        id: g.id,
        name: g.name,
        members_count: g.members_count,
        group_category_id: g.group_category_id,
        max_membership: g.max_membership,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "create_group",
    "Create a single group inside an existing group set. For bulk auto-creation, use create_group_set with create_group_count instead.",
    {
      group_category_id: z
        .string()
        .describe("Group set id (find via list_group_categories)"),
      name: z.string().describe("Group name"),
      description: z.string().optional(),
      max_membership: z
        .number()
        .optional()
        .describe("Max members allowed in this group"),
    },
    async ({ group_category_id, ...fields }) => {
      const payload: any = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) payload[k] = v;
      }
      const result = await canvas(
        `/group_categories/${group_category_id}/groups`,
        { method: "POST", body: JSON.stringify(payload) }
      );
      return {
        content: [
          {
            type: "text",
            text: `Created group "${result.name}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "add_user_to_group",
    "Add a single user to a group. Membership is created in 'accepted' state by default. To remove, use remove_user_from_group.",
    {
      group_id: z.string().describe("Canvas group ID"),
      user_id: z.string().describe("Canvas user ID"),
    },
    async ({ group_id, user_id }) => {
      const result = await canvas(`/groups/${group_id}/memberships`, {
        method: "POST",
        body: JSON.stringify({ user_id, workflow_state: "accepted" }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Added user ${user_id} to group ${group_id} (membership ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "remove_user_from_group",
    "Remove a user from a group.",
    {
      group_id: z.string().describe("Canvas group ID"),
      user_id: z.string().describe("Canvas user ID to remove"),
    },
    async ({ group_id, user_id }) => {
      const result = await canvas(
        `/groups/${group_id}/users/${user_id}`,
        { method: "DELETE" }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "auto_distribute_unassigned",
    "Auto-distribute students who aren't yet in a group across the existing groups in a group set. Uses Canvas's built-in randomization. Runs asynchronously — Canvas returns a progress object.",
    {
      group_category_id: z
        .string()
        .describe("Group set id to auto-distribute within"),
      sync: z
        .boolean()
        .default(false)
        .describe(
          "If true, blocks until distribution finishes (small group sets only)."
        ),
    },
    async ({ group_category_id, sync }) => {
      const params = sync ? "?sync=true" : "";
      const result = await canvas(
        `/group_categories/${group_category_id}/assign_unassigned_members${params}`,
        { method: "POST" }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
