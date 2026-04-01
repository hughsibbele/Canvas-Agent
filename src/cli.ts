#!/usr/bin/env node

const command = process.argv[2];

if (command === "setup") {
  const { runSetup } = await import("./setup.js");
  await runSetup();
} else {
  await import("./index.js");
}
