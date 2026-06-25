#!/usr/bin/env -S node --no-warnings

// Suppress Node.js experimental-feature warnings (node:sqlite) from cluttering CLI output.
process.on("warning", (w) => {
  if (w.name === "ExperimentalWarning") return;
  process.stderr.write(`Warning: ${w.message}\n`);
});

/**
 * recall — local-first, context-aware idea & decision memory for developers.
 *
 * Usage:
 *   recall add "<text>" [--file <path>] [--repo <path>]
 *   recall ingest <path> [--watch]
 *   recall recall ["<query>"] [--limit <n>]
 *   recall list [--repo] [--open]
 *   recall resolve <id>
 *   recall digest
 *   recall mcp
 *   recall serve [--port <n>] [--open]
 */

import { Command } from "commander";
import { addIdea } from "../commands/add.js";
import { ingestCommand } from "../commands/ingest.js";
import { recallCommand } from "../commands/recall.js";
import { listCommand } from "../commands/list.js";
import { resolveCommand } from "../commands/resolve.js";
import { detachCommand } from "../commands/detach.js";
import { digestCommand } from "../commands/digest.js";
import { mcpCommand } from "../commands/mcp-cmd.js";
import { serveCommand } from "../commands/serve.js";
import { configureAi, aiStatus, aiLock } from "../commands/ai.js";
import { generateHandoffCommand } from "../commands/generate-handoff.js";
import type { HandoffTarget, ProviderKind } from "../ai/types.js";

const program = new Command();

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

program
  .name("recall")
  .description(
    "Local-first idea & decision memory for developers — with MCP server for coding agents."
  )
  .version("0.1.0");

// ── recall add ───────────────────────────────────────────────────────────────
program
  .command("add <text>")
  .description("Capture a thought and link it to the current git context.")
  .option("--file <path>", "File path to attach as context")
  .option("--repo <path>", "Override repo root (default: cwd)")
  .option("--decision <text>", "Structured decision summary")
  .option("--why <text>", "Reasoning behind the decision")
  .option("--alternative <text>", "Rejected alternative; can be passed multiple times", collect, [])
  .option("--tradeoff <text>", "Known tradeoff; can be passed multiple times", collect, [])
  .option("--evidence <text>", "Evidence, source, discussion, or observation")
  .option("--outcome <text>", "Expected or observed outcome")
  .action(async (text: string, opts) => {
    await run(addIdea(text, opts));
  });

// ── recall ingest ─────────────────────────────────────────────────────────────
program
  .command("ingest <path>")
  .description("Ingest an Obsidian vault, Logseq graph, or markdown folder.")
  .option("--watch", "Watch for changes (phase 2; currently a no-op)")
  .action(async (vaultPath: string, opts) => {
    await run(ingestCommand(vaultPath, opts));
  });

// ── recall recall ─────────────────────────────────────────────────────────────
program
  .command("recall [query]")
  .description(
    "Surface ideas relevant to the current context (+ optional query)."
  )
  .option("--limit <n>", "Number of results", (v) => parseInt(v, 10), 5)
  .action(async (query: string | undefined, opts) => {
    await run(recallCommand(query, opts));
  });

// ── recall list ───────────────────────────────────────────────────────────────
program
  .command("list")
  .description("List ideas, optionally scoped to the current repo or open only.")
  .option("--repo", "Scope to current git repo")
  .option("--open", "Show only open (unresolved) ideas")
  .action(async (opts) => {
    await run(listCommand(opts));
  });

// ── recall resolve ────────────────────────────────────────────────────────────
program
  .command("resolve <id>")
  .description("Mark an idea as resolved. Accepts full UUID or 8-char prefix.")
  .action(async (id: string) => {
    await run(resolveCommand(id));
  });

program
  .command("detach <id>")
  .description("Remove repository, branch, file, commit, and error context from a memory.")
  .action(async (id: string) => {
    await run(detachCommand(id));
  });

// ── recall digest ─────────────────────────────────────────────────────────────
program
  .command("digest")
  .description("Show recent captures + resurfaced ideas for the current context.")
  .action(async () => {
    await run(digestCommand());
  });

// ── recall mcp ────────────────────────────────────────────────────────────────
program
  .command("mcp")
  .description("Start the MCP server (stdio transport).")
  .action(async () => {
    await run(mcpCommand());
  });

// ── recall serve ─────────────────────────────────────────────────────────────────────────────────────────────────────
program
  .command("serve")
  .description("Start the local web UI (default: http://localhost:4321).")
  .option("--port <n>", "Port to listen on", (v) => parseInt(v, 10), 4321)
  .option("--open", "Open browser automatically")
  .action(async (opts) => {
    await run(serveCommand(opts));
  });

const ai = program.command("ai").description("Configure encrypted AI providers.");
ai.command("configure").option("--provider <type>", "ollama, openai, or anthropic").option("--name <name>").option("--model <model>").option("--base-url <url>").action(async (opts) => run(configureAi({ ...opts, provider: opts.provider as ProviderKind | undefined })));
ai.command("status").action(async () => run(aiStatus()));
ai.command("lock").action(async () => run(aiLock()));

program.command("generate <memory-id>").description("Generate an AI implementation handoff from one memory.").requiredOption("--target <target>", "codex, claude, copilot, or generic").option("--types <types>", "comma-separated spec,prompt,skill", "spec,prompt,skill").option("--out <directory>", "output directory", ".recall-handoff").option("--instructions <text>").option("--provider <id>").option("--force").action(async (memoryId, opts) => run(generateHandoffCommand(memoryId, { ...opts, target: opts.target as HandoffTarget })));

// ─── Error handler ────────────────────────────────────────────────────────────

async function run(promise: Promise<void>): Promise<void> {
  try {
    await promise;
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
