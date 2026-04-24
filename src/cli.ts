#!/usr/bin/env node

const command = process.argv[2];

if (command === "setup") {
  const { runSetup } = await import("./setup.js");
  await runSetup();
} else if (command === "reveal") {
  const { runReveal } = await import("./reveal.js");
  await runReveal();
} else {
  await import("./index.js");
}
