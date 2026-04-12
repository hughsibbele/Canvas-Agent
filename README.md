# Canvas Agent

MCP server that connects Claude AI to Instructure Canvas LMS. Manage courses, assignments, grades, and more through natural language.

## Setup

**New to the terminal or don't have Node.js yet?** Follow the full step-by-step walkthrough at **[hughsibbele.github.io/Canvas-Agent](https://hughsibbele.github.io/Canvas-Agent)** — it explains every step.

### Prerequisites

You need these installed before running Canvas Agent:

1. **A Claude Pro subscription** ($20/month) — [sign up at claude.ai/pricing](https://claude.ai/pricing)
2. **Node.js** — [download the LTS installer from nodejs.org](https://nodejs.org) and click through the defaults.
3. **Claude Code and/or Claude Desktop** — Canvas Agent works in either, and if you install both the wizard will set up both:
   - **Claude Code** (terminal-based): in a terminal, run
     ```bash
     npm install -g @anthropic-ai/claude-code
     ```
     Then type `claude` once to sign in with your Claude account.
   - **Claude Desktop** (point-and-click app): [download from claude.ai/download](https://claude.ai/download)

### Run the setup wizard

```bash
npx -y canvas-agent setup
```

The wizard will walk you through connecting your Canvas account.

### Alternative: install via Homebrew (macOS, developers)

If you already use [Homebrew](https://brew.sh) and would rather manage these as casks and formulas, you can replace the prerequisites above with:

```bash
brew install node
brew install --cask claude-code   # Claude Code (CLI)
brew install --cask claude        # Claude Desktop (GUI app)
```

Skip the ones you don't want — Canvas Agent only needs one of `claude-code` or `claude` to function. Homebrew is entirely optional; the nodejs.org installer path above works without it.

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
