import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canvas, canvasAll } from "../canvas-client.js";

export function registerCalendarTools(server: McpServer) {
  server.tool(
    "list_calendar_events",
    "List calendar events, optionally filtered by course, date range, or type.",
    {
      course_id: z
        .string()
        .optional()
        .describe("Filter to a specific course ID"),
      start_date: z
        .string()
        .optional()
        .describe("Start of date range (ISO 8601)"),
      end_date: z
        .string()
        .optional()
        .describe("End of date range (ISO 8601)"),
      type: z
        .enum(["event", "assignment"])
        .optional()
        .describe("Filter by event type"),
    },
    async ({ course_id, start_date, end_date, type }) => {
      const params: Record<string, string> = {};
      if (course_id) params["context_codes[]"] = `course_${course_id}`;
      if (start_date) params.start_date = start_date;
      if (end_date) params.end_date = end_date;
      if (type) params.type = type;

      const events = await canvasAll("/calendar_events", params);
      const summary = events.map((e: any) => ({
        id: e.id,
        title: e.title,
        start_at: e.start_at,
        end_at: e.end_at,
        description: e.description
          ? e.description.substring(0, 200) +
            (e.description.length > 200 ? "..." : "")
          : null,
        location_name: e.location_name,
        type: e.type,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  server.tool(
    "create_calendar_event",
    "Create a standalone calendar event (e.g. office hours, class sessions, review sessions). These are NOT assignments — to create graded items with due dates, use create_assignment.",
    {
      course_id: z.string().describe("Canvas course ID"),
      title: z.string().describe("Event title"),
      start_at: z.string().describe("Start date/time (ISO 8601)"),
      end_at: z.string().describe("End date/time (ISO 8601)"),
      description: z
        .string()
        .optional()
        .describe("Event description (HTML supported)"),
      location_name: z.string().optional().describe("Location name"),
      location_address: z.string().optional().describe("Location address"),
    },
    async ({ course_id, title, start_at, end_at, description, location_name, location_address }) => {
      const result = await canvas("/calendar_events", {
        method: "POST",
        body: JSON.stringify({
          calendar_event: {
            context_code: `course_${course_id}`,
            title,
            start_at,
            end_at,
            description,
            location_name,
            location_address,
          },
        }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Created calendar event "${result.title}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_calendar_event",
    "Update an existing calendar event. Only include fields you want to change.",
    {
      event_id: z.string().describe("Calendar event ID"),
      title: z.string().optional(),
      start_at: z.string().optional().describe("ISO 8601"),
      end_at: z.string().optional().describe("ISO 8601"),
      description: z.string().optional().describe("HTML description"),
      location_name: z.string().optional(),
    },
    async ({ event_id, ...params }) => {
      const result = await canvas(`/calendar_events/${event_id}`, {
        method: "PUT",
        body: JSON.stringify({ calendar_event: params }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Updated calendar event "${result.title}" (ID: ${result.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_calendar_event",
    "Delete a calendar event.",
    {
      event_id: z.string().describe("Calendar event ID"),
    },
    async ({ event_id }) => {
      await canvas(`/calendar_events/${event_id}`, {
        method: "DELETE",
      });
      return {
        content: [
          {
            type: "text",
            text: `Deleted calendar event ${event_id}`,
          },
        ],
      };
    }
  );
}
