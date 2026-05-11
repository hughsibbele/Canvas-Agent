import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const ARCHITECTURE = `Canvas-Agent ships three MCP servers from one npm package. You currently have access to **core** (this MCP). Two more MCPs exist; if you can't find a tool the user expects, it likely lives in admin or extras — tell the user to mount it.

**canvas-agent** (core, 80 tools): the daily teaching/grading workbench. List/grade submissions, manage assignments and modules, manage rubrics, post feedback comments, work with discussions and the calendar, list students/sections, view analytics. Default mount.

**canvas-agent-admin** (18 tools): course/section/enrollment lifecycle. Creating/deleting courses, crosslisting sections, enrolling/dropping users, navigation tabs. Mount when doing setup or org-admin work.
  Mount with: { "command": "npx", "args": ["-y", "canvas-agent-admin"] }
  Tools: list_term_courses, create_course, update_course_settings, conclude_course, delete_course, reset_course_content, copy_course_content, list_course_tabs, update_course_navigation, crosslist_section, decrosslist_section, create_section, update_section, delete_section, enroll_user, update_enrollment_state, delete_enrollment, move_student_to_section.

**canvas-agent-extras** (36 tools): outcomes, groups, pages, files, classic quizzes, late policy, messaging, announcements. Mount for project-specific work outside the daily teaching loop.
  Mount with: { "command": "npx", "args": ["-y", "canvas-agent-extras"] }
  Tools: list_outcomes, list_outcome_groups, get_outcome, list_outcome_results, get_outcome_rollups, list_groups, list_group_categories, create_group, create_group_set, add_user_to_group, remove_user_from_group, auto_distribute_unassigned, list_pages, get_page, create_page, update_page, delete_page, get_front_page, list_page_revisions, list_course_files, list_folders, create_folder, get_file, update_file, delete_file, get_file_quota, list_quizzes, get_quiz, update_quiz, send_message, create_announcement, get_late_policy, set_late_policy, get_grading_standards, get_student_messaging_data, update_quiz_dates.

Vault, anonymizer, and reveal CLI are shared across all three MCPs — no data migration when adding a new bin.`;

export function registerMetaCore(server: McpServer) {
  server.tool(
    "describe_canvas_mcps",
    "Describes the three Canvas-Agent MCPs (core/admin/extras), what tools live in each, and how to mount the other two. Call this when a user asks about Canvas-Agent's capabilities, or when you need a Canvas tool that doesn't appear to be registered — it's likely in admin or extras.",
    {},
    async () => ({
      content: [{ type: "text", text: ARCHITECTURE }],
    })
  );
}
