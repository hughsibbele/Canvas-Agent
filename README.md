# Canvas Agent

MCP server that connects Claude AI to Instructure Canvas LMS. Manage courses, assignments, grades, and more through natural language.

## Quick Setup

Full setup guide: **[hughsibbele.github.io/Canvas-Agent](https://hughsibbele.github.io/Canvas-Agent)**

If you already have Claude Code and Node.js installed:

```bash
npx -y canvas-agent setup
```

The wizard will walk you through connecting your Canvas account.

## What It Does

Canvas Agent gives Claude access to your Canvas LMS:

- **Courses & Modules** — list, organize, and manage course structure
- **Assignments** — create, update, set due dates and submission types
- **Grading & Rubrics** — grade submissions, create rubrics, post grades
- **Discussions & Quizzes** — create discussion boards and quizzes
- **Student Management** — enrollments, submissions, analytics
- **Pages, Files & Calendar** — create pages, upload files, manage events

## Development

```bash
git clone https://github.com/hughsibbele/Canvas-Agent.git
cd Canvas-Agent
npm install
cp .env.example .env     # add your Canvas URL and API token
npm run build
npm start
```

## License

MIT
