/**
 * Interactive setup wizard for Canvas Agent.
 * Guides non-technical users through connecting Canvas to Claude.
 * Uses only Node.js built-ins — no external dependencies.
 */

import { createInterface, type Interface as ReadlineInterface } from "readline/promises";
import { execSync, execFileSync } from "child_process";
import { stdin, stdout, platform } from "process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  realpathSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";

// ANSI color helpers
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function banner() {
  console.log();
  console.log(cyan("  ╔══════════════════════════════════════╗"));
  console.log(cyan("  ║") + bold("     Canvas Agent — Setup Wizard      ") + cyan("║"));
  console.log(cyan("  ╚══════════════════════════════════════╝"));
  console.log();
  console.log("  This will connect Claude to your Canvas courses.");
  console.log("  You'll need about 3 minutes and access to your");
  console.log("  Canvas account.\n");
}

function isClaudeCodeInstalled(): boolean {
  try {
    execSync("claude --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// Detects whether Claude Desktop is installed by looking for the app bundle
// (macOS) or executable (Windows). No official Linux build exists, so Linux
// always returns false. We intentionally DON'T check for the config file's
// existence — a user might install Claude Desktop but never launch it, in
// which case the config directory doesn't exist yet. Checking the app
// itself is the authoritative signal.
function isClaudeDesktopInstalled(): boolean {
  if (platform === "darwin") {
    return (
      existsSync("/Applications/Claude.app") ||
      existsSync(join(homedir(), "Applications/Claude.app"))
    );
  }
  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      // Known Claude Desktop install paths on Windows.
      if (existsSync(join(localAppData, "AnthropicClaude", "claude.exe"))) return true;
      if (existsSync(join(localAppData, "Programs", "Claude", "Claude.exe"))) return true;
    }
    return false;
  }
  return false;
}

// Opens a local folder in the OS file manager (Finder on macOS, Explorer on
// Windows, default on Linux). Uses execFileSync with an argv array so paths
// with spaces, quotes, or other special characters work correctly.
function openInFileManager(path: string): void {
  try {
    if (platform === "darwin") {
      execFileSync("open", [path], { stdio: "ignore" });
    } else if (platform === "win32") {
      execFileSync("explorer", [path], { stdio: "ignore" });
    } else {
      execFileSync("xdg-open", [path], { stdio: "ignore" });
    }
  } catch {
    // Nice-to-have, not critical — ignore if it fails.
  }
}

function normalizeCanvasUrl(raw: string): { hostname: string; apiUrl: string } {
  let hostname = raw.trim();
  // Strip protocol
  hostname = hostname.replace(/^https?:\/\//, "");
  // Strip paths
  hostname = hostname.replace(/\/.*$/, "");
  // Strip port for validation but keep it
  const apiUrl = `https://${hostname}/api/v1`;
  return { hostname, apiUrl };
}

async function validateCredentials(
  apiUrl: string,
  token: string
): Promise<{ valid: boolean; name?: string; error?: string }> {
  try {
    const res = await fetch(`${apiUrl}/users/self`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const user = (await res.json()) as { name?: string };
      return { valid: true, name: user.name };
    }
    if (res.status === 401) {
      return { valid: false, error: "Invalid token — double-check that you copied the full token." };
    }
    return { valid: false, error: `Canvas returned an error (${res.status} ${res.statusText}).` };
  } catch (e: any) {
    if (e.cause?.code === "ENOTFOUND") {
      return { valid: false, error: `Could not reach "${apiUrl}" — check your Canvas address.` };
    }
    return { valid: false, error: e.message };
  }
}

// Verifies that the URL the user typed actually points to a real Canvas
// school BEFORE we tell them to visit the URL to generate a token. This
// protects users from typo-squatters — e.g. someone who types
// "instructure.org" instead of "instructure.com" would otherwise be steered
// to a scam domain to generate a token, and their browser might pick up a
// push-notification spam prompt in the process.
//
// Strategy: hit /api/v1/users/self without a token and check the response.
// Canvas's actual unauthenticated response is 401 + the `x-canvas-meta`
// header. A *nonexistent* school on instructure.com returns 404 + the same
// header with a `"domain not found"` body — still instructure infrastructure,
// but no such school. A typosquat like .org doesn't hit instructure at all
// and fails at the socket layer. Each case gets a tailored error message.
async function checkCanvasReachability(
  apiUrl: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Normalize the display URL for error messages — the host the user sees.
  const displayHost = apiUrl.replace(/\/api\/v1\/?$/, "");

  // Hit an API endpoint directly rather than the root. The root redirects
  // to an SSO OAuth flow that returns 405 for unauthenticated HEAD requests,
  // which is unhelpful. The /users/self endpoint is stable and returns a
  // clear 401 for unauthenticated callers on every real Canvas instance.
  const endpoint = apiUrl.replace(/\/$/, "") + "/users/self";

  // Abort after 5 seconds so the wizard doesn't hang on a dead hostname
  // or a slow link.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(endpoint, { signal: controller.signal });

    const isCanvasInfra = res.headers.get("x-canvas-meta") !== null;

    // The happy path: real Canvas school, no token → 401 + x-canvas-meta.
    if (res.status === 401 && isCanvasInfra) {
      return { ok: true };
    }

    // 404 + x-canvas-meta means "we're on instructure.com but this specific
    // school subdomain doesn't exist" — usually a typo in the school name.
    if (res.status === 404 && isCanvasInfra) {
      return {
        ok: false,
        error:
          `Canvas couldn't find a school at "${displayHost}".\n` +
          `    Double-check the spelling of your school's subdomain.`,
      };
    }

    // Anything else — unexpected status, or no x-canvas-meta header at all.
    // This is the dangerous case: a URL that responds but isn't Canvas.
    return {
      ok: false,
      error:
        `"${displayHost}" responded, but it doesn't look like a Canvas site.\n` +
        `    Double-check the spelling. A common mistake is typing ".org" instead\n` +
        `    of ".com" — that can send you to a lookalike scam domain.`,
    };
  } catch (e: any) {
    const cause = e.cause?.code || e.code || "";

    // Any network-level failure — DNS NXDOMAIN, TLS error, socket refused,
    // etc. Treat them all the same: the user's URL doesn't reach a real
    // server, and a typo in the TLD is the most common cause.
    if (
      cause === "ENOTFOUND" ||
      cause === "UND_ERR_SOCKET" ||
      cause === "ECONNREFUSED" ||
      cause === "EAI_AGAIN"
    ) {
      return {
        ok: false,
        error:
          `Could not reach "${displayHost}".\n` +
          `    Double-check the spelling — a common mistake is typing ".org" or ".net"\n` +
          `    instead of ".com".`,
      };
    }

    if (e.name === "AbortError") {
      return {
        ok: false,
        error: `"${displayHost}" didn't respond in time. Check your internet connection.`,
      };
    }

    return {
      ok: false,
      error: `Could not reach "${displayHost}" — ${e.message || "unknown network error"}.`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

type RegisterResult = { ok: true } | { ok: false; error: string };

// Where to install Canvas Agent. Maps onto Claude Code's MCP scopes:
//   - "user"  → ~/.claude.json top-level mcpServers; available in every folder
//   - "local" → ~/.claude.json projects[folderPath].mcpServers; only when
//               Claude is launched from that folder
type ScopeChoice =
  | { scope: "user" }
  | { scope: "local"; folderPath: string };

function registerWithClaudeCode(
  apiUrl: string,
  token: string,
  scopeChoice: ScopeChoice
): RegisterResult {
  // For local scope, run `claude` from inside the target folder so it writes
  // the config under that folder's project key. For user scope, cwd doesn't
  // matter — user-scope entries aren't tied to a directory.
  const spawnOpts: { stdio: "pipe"; cwd?: string } = { stdio: "pipe" };
  if (scopeChoice.scope === "local") {
    spawnOpts.cwd = scopeChoice.folderPath;
  }

  // If canvas-agent is already registered where we're about to write (e.g.
  // the user re-runs setup after refreshing their token), remove the old
  // entry first so add-json doesn't fail with "already exists" and we don't
  // leave stale credentials on disk.
  try {
    execFileSync("claude", ["mcp", "get", "canvas-agent"], spawnOpts);
    try {
      execFileSync("claude", ["mcp", "remove", "canvas-agent"], spawnOpts);
    } catch {
      // Best effort — if remove fails, add-json below will surface the real error.
    }
  } catch {
    // Not registered in this scope; nothing to remove.
  }

  // Use `claude mcp add-json` with an argv array (not a shell string) so that:
  //  - Token characters never need shell escaping
  //  - We sidestep the variadic `-e` parsing quirk in `claude mcp add` where
  //    the server name can be swallowed as if it were another env var
  const serverConfig = {
    command: "npx",
    args: ["-y", "canvas-agent"],
    env: {
      CANVAS_API_URL: apiUrl,
      CANVAS_API_TOKEN: token,
    },
  };

  try {
    execFileSync(
      "claude",
      [
        "mcp",
        "add-json",
        "-s",
        scopeChoice.scope,
        "canvas-agent",
        JSON.stringify(serverConfig),
      ],
      spawnOpts
    );
  } catch (e: any) {
    const stderr = (
      e.stderr?.toString() ||
      e.stdout?.toString() ||
      e.message ||
      "unknown error"
    ).trim();
    return { ok: false, error: stderr };
  }

  // Trust but verify — confirm the entry actually landed. This catches the
  // rare case where `add-json` exits 0 but the config wasn't written (stale
  // CLI version, file permission quirks, etc.).
  try {
    execFileSync("claude", ["mcp", "get", "canvas-agent"], spawnOpts);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        "Claude Code accepted the configuration but the server isn't showing up in 'claude mcp list'. Try re-running setup, or report this at https://github.com/hughsibbele/Canvas-Agent/issues",
    };
  }
}

// ── Scope selection helpers ───────────────────────────────────────────
// These walk a non-technical user through choosing WHERE to install Canvas
// Agent (globally vs. a specific folder) and, if needed, creating a folder
// for them. Every prompt has a sensible default and plain-language guidance.

async function chooseScope(
  rl: ReadlineInterface,
  alsoInstallingInDesktop: boolean
): Promise<ScopeChoice> {
  // When Desktop is also a target, the heading and intro need to make clear
  // that this scope question only affects Claude Code — in Claude Desktop,
  // Canvas Agent is always globally available and we can't narrow that.
  if (alsoInstallingInDesktop) {
    console.log(bold("  Step 3: Where to Use Canvas Agent in Claude Code\n"));
    console.log(
      "  " +
        dim("(This choice only affects Claude Code. In Claude Desktop,")
    );
    console.log(
      "  " + dim("Canvas Agent is always available globally.)") + "\n"
    );
    console.log("  Canvas Agent can be available every time you use Claude Code,");
    console.log("  or only when you're working in a specific folder.\n");
  } else {
    console.log(bold("  Step 3: Where to Use Canvas Agent\n"));
    console.log("  Canvas Agent can be available every time you use Claude,");
    console.log("  or only when you're working in a specific folder.\n");
  }

  console.log("  " + bold("1.") + " Everywhere " + dim("(recommended)"));
  console.log("     " + dim("Canvas tools will load every time you run Claude."));
  console.log("     " + dim("Pick this if you're not sure."));
  console.log();
  console.log("  " + bold("2.") + " Only in a specific folder");
  console.log("     " + dim("Canvas tools will only load when you run Claude from"));
  console.log("     " + dim("that folder. Good if you want to keep your Canvas"));
  console.log("     " + dim("work separate from other projects."));
  console.log();

  while (true) {
    const answer = (
      await rl.question("  Choose " + bold("1") + " or " + bold("2") + " (press Enter for 1): ")
    ).trim();

    if (answer === "" || answer === "1") {
      console.log();
      return { scope: "user" };
    }
    if (answer === "2") {
      console.log();
      const folderPath = await chooseOrCreateFolder(rl);
      return { scope: "local", folderPath };
    }
    console.log(red("  ✗") + " Please type 1 or 2.\n");
  }
}

async function chooseOrCreateFolder(rl: ReadlineInterface): Promise<string> {
  console.log(bold("  Pick a Folder for Canvas Agent\n"));
  console.log("  " + bold("1.") + " Create a new folder for me " + dim("(recommended)"));
  console.log("     " + dim('We\'ll make a "Canvas Work" folder inside your Documents.'));
  console.log();
  console.log("  " + bold("2.") + " I already have a folder I want to use");
  console.log("     " + dim("You'll type the full path to it."));
  console.log();

  while (true) {
    const answer = (
      await rl.question("  Choose " + bold("1") + " or " + bold("2") + " (press Enter for 1): ")
    ).trim();

    if (answer === "" || answer === "1") {
      console.log();
      return await createNewFolder(rl);
    }
    if (answer === "2") {
      console.log();
      return await pickExistingFolder(rl);
    }
    console.log(red("  ✗") + " Please type 1 or 2.\n");
  }
}

async function createNewFolder(rl: ReadlineInterface): Promise<string> {
  const defaultName = "Canvas Work";
  const parentDir = join(homedir(), "Documents");

  console.log("  We'll create a folder inside your Documents folder:");
  console.log("  " + dim(parentDir) + "\n");

  let name = "";
  while (true) {
    const input = (
      await rl.question(`  Folder name (press Enter for "${defaultName}"): `)
    ).trim();
    name = input || defaultName;

    // Basic sanity check — no path separators in the name, and not empty.
    if (name.includes("/") || name.includes("\\")) {
      console.log(red("  ✗") + ' Folder name cannot contain "/" or "\\\\". Try again.\n');
      continue;
    }
    break;
  }

  // Ensure ~/Documents exists. On macOS/Windows it virtually always does,
  // but on Linux or exotic setups it might not — recursive mkdir is safe.
  try {
    mkdirSync(parentDir, { recursive: true });
  } catch {
    // If this fails the folder create below will also fail and surface the real error.
  }

  const folderPath = join(parentDir, name);

  if (existsSync(folderPath)) {
    console.log(green("  ✓") + " Folder already exists — we'll use it.");
  } else {
    try {
      mkdirSync(folderPath, { recursive: true });
      console.log(green("  ✓") + " Created folder.");
    } catch (e: any) {
      throw new Error(`Could not create folder "${folderPath}": ${e.message}`);
    }
  }

  // Resolve symlinks so the path we use matches the key Claude Code will
  // store (e.g. /tmp → /private/tmp on macOS). Otherwise the local-scope
  // config lookup could miss our entry.
  const canonical = realpathSync(folderPath);
  console.log(dim(`    ${canonical}\n`));

  // Nice touch: pop the folder open in Finder/Explorer so the user can
  // literally see where it is. Fails silently if the OS command isn't available.
  openInFileManager(canonical);

  return canonical;
}

async function pickExistingFolder(rl: ReadlineInterface): Promise<string> {
  console.log("  Type the full path to the folder you want to use.");
  console.log("  " + dim("You can use ~ to mean your home folder."));
  console.log("  " + dim("Example: ~/Documents/My Canvas Courses") + "\n");

  while (true) {
    const rawPath = (await rl.question("  Folder path: ")).trim();
    if (!rawPath) {
      console.log(red("  ✗") + " Please type a folder path.\n");
      continue;
    }

    // Expand ~ → home directory. Handles "~", "~/foo", and "~\foo".
    let expanded = rawPath;
    if (expanded === "~") {
      expanded = homedir();
    } else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
      expanded = join(homedir(), expanded.slice(2));
    }

    if (!existsSync(expanded)) {
      console.log(red("  ✗") + " That folder doesn't exist: " + dim(expanded));
      const create = (
        await rl.question("  Create it? (y/n): ")
      ).trim().toLowerCase();
      if (create !== "y") {
        console.log();
        continue;
      }
      try {
        mkdirSync(expanded, { recursive: true });
        console.log(green("  ✓") + " Created folder.");
      } catch (e: any) {
        console.log(red("  ✗") + ` Could not create: ${e.message}\n`);
        continue;
      }
    }

    // Make sure it's a directory, not a regular file.
    try {
      const stat = statSync(expanded);
      if (!stat.isDirectory()) {
        console.log(red("  ✗") + " That path is a file, not a folder. Try again.\n");
        continue;
      }
    } catch (e: any) {
      console.log(red("  ✗") + ` Could not read folder: ${e.message}\n`);
      continue;
    }

    const canonical = realpathSync(expanded);
    console.log(green("  ✓") + " Using folder.");
    console.log(dim(`    ${canonical}\n`));
    return canonical;
  }
}

function getDesktopConfigPath(): string | null {
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "Claude", "claude_desktop_config.json");
  }
  return null;
}

function registerWithDesktop(apiUrl: string, token: string): RegisterResult {
  const configPath = getDesktopConfigPath();
  if (!configPath) {
    return {
      ok: false,
      error: "No known Claude Desktop config path for this platform.",
    };
  }

  try {
    // Read existing config or start fresh. We preserve every other field
    // in the Desktop config (preferences, other MCP servers, etc.) — we
    // only touch mcpServers["canvas-agent"].
    let config: any = {};
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8");
      try {
        config = JSON.parse(raw);
      } catch (e: any) {
        return {
          ok: false,
          error: `Could not parse existing Claude Desktop config: ${e.message}. Fix or delete ${configPath} and try again.`,
        };
      }
    } else {
      // Ensure parent directory exists (Claude Desktop installed but never launched)
      const dir = join(configPath, "..");
      mkdirSync(dir, { recursive: true });
    }

    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers["canvas-agent"] = {
      command: "npx",
      args: ["-y", "canvas-agent"],
      env: {
        CANVAS_API_URL: apiUrl,
        CANVAS_API_TOKEN: token,
      },
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || "unknown error writing Desktop config" };
  }
}

function printManualConfig(apiUrl: string, token: string) {
  console.log(yellow("\n  Add this to your Claude MCP configuration:\n"));
  const config = {
    "canvas-agent": {
      command: "npx",
      args: ["-y", "canvas-agent"],
      env: {
        CANVAS_API_URL: apiUrl,
        CANVAS_API_TOKEN: token,
      },
    },
  };
  console.log("  " + JSON.stringify(config, null, 2).replace(/\n/g, "\n  "));
  console.log();
}

export async function runSetup(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    banner();

    // ── Detection: Claude Code and Claude Desktop are independent targets ──
    //
    // We install into whichever are present — no fall-through logic, no
    // "do you want Desktop instead" prompt. If the user has both, Canvas
    // Agent gets set up in both automatically. If they have only one, we
    // use that one. If they have neither, we bail out with a clear install
    // guide.

    const hasClaudeCode = isClaudeCodeInstalled();
    const hasClaudeDesktop = isClaudeDesktopInstalled();

    console.log("  Checking your Claude setup...\n");
    console.log(
      (hasClaudeCode ? green("  ✓") : dim("  ✗")) +
        " Claude Code " +
        (hasClaudeCode ? "" : dim("(not found)"))
    );
    console.log(
      (hasClaudeDesktop ? green("  ✓") : dim("  ✗")) +
        " Claude Desktop " +
        (hasClaudeDesktop ? "" : dim("(not found)"))
    );
    console.log();

    if (!hasClaudeCode && !hasClaudeDesktop) {
      console.log(
        yellow("  ⚠") + " Canvas Agent needs either Claude Code or Claude Desktop."
      );
      console.log();
      console.log("  " + bold("Install one (or both) and then re-run this wizard:"));
      console.log();
      console.log("  " + bold("Claude Code") + dim(" — terminal-based, works in any folder"));
      console.log("    " + bold("npm install -g @anthropic-ai/claude-code"));
      if (platform === "darwin") {
        console.log(
          "    " + dim("or, with Homebrew:") + " " + bold("brew install --cask claude-code")
        );
      }
      console.log();
      console.log("  " + bold("Claude Desktop") + dim(" — point-and-click app"));
      console.log("    Download at " + cyan("https://claude.ai/download"));
      console.log();
      console.log("  Full walkthrough: " + cyan("https://hughsibbele.github.io/Canvas-Agent"));
      console.log();
      console.log("  When you're ready, re-run:");
      console.log(bold("    npx -y canvas-agent setup\n"));
      return;
    }

    // ── Step 2: Get Canvas URL ──

    console.log(bold("  Step 1: Your School's Canvas\n"));

    let hostname = "";
    let apiUrl = "";

    while (true) {
      const rawUrl = await rl.question(
        "  Your Canvas address (e.g., myschool.instructure.com): "
      );
      if (!rawUrl.trim()) continue;

      const normalized = normalizeCanvasUrl(rawUrl);
      hostname = normalized.hostname;
      apiUrl = normalized.apiUrl;

      if (!hostname.includes(".")) {
        console.log(red("  ✗") + ` That doesn't look like a web address. Try again.\n`);
        continue;
      }

      console.log(dim(`    → ${apiUrl}`));
      console.log(dim("    Checking that this is a real Canvas site..."));

      // Verify the URL actually points to a Canvas instance BEFORE we tell
      // the user to visit it. This catches typos like .org instead of .com
      // (which can send users to scam domains) before any browser navigation
      // or token generation happens.
      const reachability = await checkCanvasReachability(apiUrl);
      if (!reachability.ok) {
        console.log(red("  ✗") + ` ${reachability.error}\n`);
        continue;
      }
      console.log(green("  ✓") + " Canvas found.");
      break;
    }

    // ── Step 3: Get Canvas API Token ──

    console.log(bold("\n  Step 2: Canvas API Token\n"));
    console.log("  We need an access token from Canvas. Here's how:\n");

    const settingsUrl = `https://${hostname}/profile/settings`;

    // We intentionally DO NOT auto-open this URL in the user's browser.
    // Auto-opening a URL the user just typed means a typo can steer their
    // browser directly into a scam domain (push-notification spam, fake
    // captchas, etc.) before they have a chance to notice. Instead, print
    // the URL, let the user see it, and let them click or copy it. The
    // reachability check above also guarantees this is really Canvas —
    // but showing the URL gives the user a final visual confirmation.
    console.log("  1. Open this link in your browser:");
    console.log("       " + cyan(settingsUrl));
    console.log(
      "     " + dim("(Most terminals let you Cmd+click the link. Otherwise, copy and paste it.)")
    );
    console.log("  2. Scroll down to " + bold('"Approved Integrations"'));
    console.log("  3. Click " + bold('"+ New Access Token"'));
    console.log("  4. For Purpose, type: " + dim("Canvas Agent"));
    console.log("  5. Click " + bold('"Generate Token"') + " and copy the token shown");
    console.log("  6. Come back here and paste the token below\n");

    let token = "";
    while (true) {
      token = (await rl.question("  Paste your token here: ")).trim();
      if (!token) continue;

      // ── Step 4: Validate ──

      console.log(dim("    Checking..."));
      const result = await validateCredentials(apiUrl, token);

      if (result.valid) {
        console.log(green("  ✓") + ` Connected! Welcome, ${bold(result.name || "there")}.\n`);
        break;
      } else {
        console.log(red("  ✗") + ` ${result.error}\n`);
        const retry = await rl.question("  Try again? (y/n): ");
        if (retry.trim().toLowerCase() !== "y") {
          console.log("\n  No worries — run this wizard again when you're ready:");
          console.log(bold("    npx -y canvas-agent setup\n"));
          return;
        }

        // Let them fix the URL too
        const fixUrl = await rl.question("  Change Canvas address too? (y/n): ");
        if (fixUrl.trim().toLowerCase() === "y") {
          const rawUrl = await rl.question(
            "  Canvas address: "
          );
          const normalized = normalizeCanvasUrl(rawUrl);
          hostname = normalized.hostname;
          apiUrl = normalized.apiUrl;
          console.log(dim(`    → ${apiUrl}\n`));
        }
        console.log();
      }
    }

    // ── Step 3: Choose scope (Claude Code targets only) ──
    //
    // Scope is a Claude Code concept — Claude Desktop's config is a single
    // global file with no per-folder behavior. So we only ask when Claude
    // Code is one of the install targets. When Desktop is *also* a target,
    // chooseScope() shows an extra note so the user understands the choice
    // only narrows Claude Code.

    let scopeChoice: ScopeChoice = { scope: "user" };
    if (hasClaudeCode) {
      try {
        scopeChoice = await chooseScope(rl, hasClaudeDesktop);
      } catch (e: any) {
        console.log(red("  ✗") + ` ${e.message}\n`);
        console.log("  Re-run this wizard when you're ready:");
        console.log(bold("    npx -y canvas-agent setup\n"));
        return;
      }
    }

    // ── Step 4: Register MCP server in each detected target ──

    // Step number depends on whether we asked about scope above. If we
    // skipped scope (Desktop-only setup) this is Step 3; otherwise Step 4.
    const connectStepNum = hasClaudeCode ? 4 : 3;
    console.log(bold(`  Step ${connectStepNum}: Connecting to Claude\n`));

    // Each target is attempted independently. A failure in one doesn't
    // abort the other — users should get whatever we can successfully
    // install for them, and we report per-target results so they can see
    // exactly what happened.
    let codeResult: RegisterResult | null = null;
    let desktopResult: RegisterResult | null = null;

    if (hasClaudeCode) {
      console.log("  Registering with Claude Code...");
      codeResult = registerWithClaudeCode(apiUrl, token, scopeChoice);
      if (codeResult.ok) {
        console.log(green("  ✓") + " Claude Code\n");
      } else {
        console.log(yellow("  ⚠") + " Claude Code — could not register.");
        const detail = codeResult.error
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n");
        console.log(dim(detail) + "\n");
      }
    }

    if (hasClaudeDesktop) {
      console.log("  Configuring Claude Desktop...");
      desktopResult = registerWithDesktop(apiUrl, token);
      if (desktopResult.ok) {
        console.log(green("  ✓") + " Claude Desktop\n");
      } else {
        console.log(yellow("  ⚠") + " Claude Desktop — could not configure.");
        const detail = desktopResult.error
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n");
        console.log(dim(detail) + "\n");
      }
    }

    const codeOk = codeResult?.ok ?? false;
    const desktopOk = desktopResult?.ok ?? false;

    // If NOTHING succeeded, fall back to printing the config for manual install.
    if (!codeOk && !desktopOk) {
      console.log(red("  ✗") + " Canvas Agent could not be installed automatically.\n");
      printManualConfig(apiUrl, token);
      console.log("  Copy the JSON above and add it to your Claude configuration.");
      console.log("  For help, visit: " + cyan("https://hughsibbele.github.io/Canvas-Agent") + "\n");
      return;
    }

    // ── Done ──

    console.log(cyan("  ╔══════════════════════════════════════╗"));
    console.log(cyan("  ║") + green("          Setup Complete!              ") + cyan("║"));
    console.log(cyan("  ╚══════════════════════════════════════╝"));
    console.log();

    // Summary of where Canvas Agent ended up
    if (codeOk && desktopOk) {
      console.log(
        bold("  Canvas Agent is installed in both Claude Code and Claude Desktop.")
      );
    } else if (codeOk) {
      console.log(bold("  Canvas Agent is installed in Claude Code."));
    } else {
      console.log(bold("  Canvas Agent is installed in Claude Desktop."));
    }
    console.log();

    // Per-target launch instructions. We show every surface that succeeded
    // so the user knows how to reach Canvas Agent from whichever tool they
    // prefer to open first.
    if (codeOk) {
      console.log("  " + bold("To use it in Claude Code:"));
      if (scopeChoice.scope === "user") {
        console.log("    1. Open Terminal and type: " + bold("claude"));
        console.log('    2. Try asking: ' + dim('"List my Canvas courses"'));
      } else {
        // Local scope — user needs to launch claude from the registered folder.
        const folderPath = scopeChoice.folderPath;
        console.log("    Canvas Agent is installed in this folder:");
        console.log("    " + cyan(folderPath));
        console.log();
        console.log("    1. Open Terminal");
        console.log("    2. Go to your Canvas folder:");
        console.log("       " + bold(`cd "${folderPath}"`));
        console.log("    3. Type: " + bold("claude"));
        console.log('    4. Try asking: ' + dim('"List my Canvas courses"'));
        console.log();
        console.log("    " + dim("Tip: copy-paste the whole thing —"));
        console.log("    " + dim(`cd "${folderPath}" && claude`));
      }
      console.log();
    }

    if (desktopOk) {
      console.log("  " + bold("To use it in Claude Desktop:"));
      console.log("    1. Quit and restart Claude Desktop if it's running");
      console.log('    2. Try asking: ' + dim('"List my Canvas courses"'));
      console.log();
    }

    console.log("  For help: " + cyan("https://hughsibbele.github.io/Canvas-Agent"));
    console.log();
  } finally {
    rl.close();
  }
}
