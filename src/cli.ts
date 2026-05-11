#!/usr/bin/env node

const command = process.argv[2];

if (command === "setup") {
  const { runSetup } = await import("./setup.js");
  await runSetup();
} else if (command === "reveal") {
  const { runReveal } = await import("./reveal.js");
  await runReveal();
} else if (command === "vault-gc") {
  const { runVaultGc } = await import("./vault-gc.js");
  await runVaultGc();
} else {
  // v2: the canvas-agent bin starts the core MCP server (79 tools + describe_canvas_mcps).
  // Admin and extras are mounted via their own bins (canvas-agent-admin, canvas-agent-extras).
  await import("./servers/core.js");
}
