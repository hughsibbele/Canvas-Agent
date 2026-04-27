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
  await import("./index.js");
}
