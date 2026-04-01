/**
 * Interactive setup wizard for Canvas Agent.
 * Guides non-technical users through connecting Canvas to Claude.
 * Uses only Node.js built-ins — no external dependencies.
 */

import { createInterface } from "readline/promises";
import { execSync } from "child_process";
import { stdin, stdout, platform } from "process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
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

function isClaudeInstalled(): boolean {
  try {
    execSync("claude --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function openBrowser(url: string): void {
  try {
    const cmd =
      platform === "darwin"
        ? "open"
        : platform === "win32"
          ? "start"
          : "xdg-open";
    execSync(`${cmd} "${url}"`, { stdio: "ignore" });
  } catch {
    // Silently fail — we print the URL as fallback
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

function registerWithClaudeCode(apiUrl: string, token: string): boolean {
  try {
    execSync(
      `claude mcp add -s user -e "CANVAS_API_URL=${apiUrl}" -e "CANVAS_API_TOKEN=${token}" canvas-agent -- npx -y canvas-agent`,
      { stdio: "inherit" }
    );
    return true;
  } catch {
    return false;
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

function registerWithDesktop(apiUrl: string, token: string): boolean {
  const configPath = getDesktopConfigPath();
  if (!configPath) return false;

  try {
    // Read existing config or start fresh
    let config: any = {};
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } else {
      // Ensure parent directory exists
      const dir = join(configPath, "..");
      mkdirSync(dir, { recursive: true });
    }

    // Merge in our MCP server entry
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
    return true;
  } catch {
    return false;
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

    // ── Step 1: Check for Claude Code ──

    const hasClaude = isClaudeInstalled();
    let useDesktop = false;

    if (hasClaude) {
      console.log(green("  ✓") + " Claude Code is installed.\n");
    } else {
      console.log(yellow("  ⚠") + " Claude Code not found.\n");
      console.log("  Canvas Agent works best with Claude Code.");
      console.log("  To install it, run:\n");
      console.log(bold("    npm install -g @anthropic-ai/claude-code\n"));
      console.log("  Then run this setup again.\n");

      const answer = await rl.question(
        "  Continue with Claude Desktop setup instead? (y/n): "
      );
      if (answer.trim().toLowerCase() !== "y") {
        console.log("\n  No problem! Install Claude Code and run this again:");
        console.log(bold("    npx -y canvas-agent setup\n"));
        return;
      }
      useDesktop = true;
      console.log();
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
      break;
    }

    // ── Step 3: Get Canvas API Token ──

    console.log(bold("\n  Step 2: Canvas API Token\n"));
    console.log("  We need an access token from Canvas. Here's how:\n");
    console.log(`  1. Log in to Canvas at ${cyan(`https://${hostname}`)}`);
    console.log("  2. Click your profile picture (top left) → " + bold("Settings"));
    console.log("  3. Scroll down to " + bold('"Approved Integrations"'));
    console.log("  4. Click " + bold('"+ New Access Token"'));
    console.log("  5. For Purpose, type: " + dim("Canvas Agent"));
    console.log("  6. Click " + bold('"Generate Token"') + " and copy the token shown\n");

    const settingsUrl = `https://${hostname}/profile/settings`;
    console.log(`  Opening ${cyan(settingsUrl)} in your browser...`);
    openBrowser(settingsUrl);
    console.log();

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

    // ── Step 5: Register MCP server ──

    console.log(bold("  Step 3: Connecting to Claude\n"));

    let registered = false;

    if (!useDesktop) {
      // Try Claude Code first
      console.log("  Registering Canvas Agent with Claude Code...\n");
      registered = registerWithClaudeCode(apiUrl, token);

      if (registered) {
        console.log(green("\n  ✓") + " Registered with Claude Code!\n");
      } else {
        console.log(yellow("\n  ⚠") + " Could not register automatically.\n");
        // Fall through to Desktop or manual
        useDesktop = true;
      }
    }

    if (useDesktop && !registered) {
      console.log("  Setting up Claude Desktop...");
      registered = registerWithDesktop(apiUrl, token);

      if (registered) {
        console.log(green("  ✓") + " Configured Claude Desktop!\n");
        console.log(dim("    Restart Claude Desktop for changes to take effect.\n"));
      }
    }

    if (!registered) {
      printManualConfig(apiUrl, token);
      console.log("  Copy the JSON above and add it to your Claude configuration.");
      console.log("  For help, visit: " + cyan("https://hughsibbele.github.io/Canvas-Agent") + "\n");
    }

    // ── Done ──

    console.log(cyan("  ╔══════════════════════════════════════╗"));
    console.log(cyan("  ║") + green("          Setup Complete!              ") + cyan("║"));
    console.log(cyan("  ╚══════════════════════════════════════╝"));
    console.log();

    if (!useDesktop) {
      console.log("  To start using Canvas Agent:");
      console.log("  1. Open a terminal and type: " + bold("claude"));
      console.log('  2. Try asking: ' + dim('"List my Canvas courses"'));
    } else {
      console.log("  To start using Canvas Agent:");
      console.log("  1. Restart Claude Desktop");
      console.log('  2. Try asking: ' + dim('"List my Canvas courses"'));
    }
    console.log();
    console.log("  For help: " + cyan("https://hughsibbele.github.io/Canvas-Agent"));
    console.log();
  } finally {
    rl.close();
  }
}
