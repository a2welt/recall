<p align="center"><img src="ui/public/icon.svg" width="96" alt="Recall logo" /></p>

<h1 align="center">Recall</h1>

<p align="center">
  <strong>Your code remembers what changed. Recall remembers why.</strong><br />
  A local context-memory layer for software decisions and coding agents.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-5363e6" /></a>
  <img alt="Node 22.5+" src="https://img.shields.io/badge/node-%3E%3D22.5-357c65" />
  <img alt="Local first" src="https://img.shields.io/badge/data-local--first-17282c" />
</p>

Six weeks after a feature ships, the code is still thereâ€”but its reasoning is gone. Why is the retry limit two? Why was Redis rejected? Which migration already failed? A new developer or coding agent sees the implementation, not the decisions that shaped it.

Recall captures that reasoning while it is fresh, links it to the repository, branch, and file where it matters, then resurfaces it when the same context returns. Use the visual dashboard, CLI, or MCP server from an AI coding tool.

No account is required. The desktop application binds to localhost and stores readable memories in one SQLite database on your computer.

## Why Recall?

Source control records *what* changed. Issue trackers record *what* was requested. Chat history disappears into old sessions. Recall preserves the missing engineering layer: **why a decision was made, what was rejected, what failed before, and what the next developer must not rediscover**.

- Return to a branch and recover its decisions.
- Organize memories into projects and lifecycle stages.
- Explore topic hubs in an animated, zoomable memory galaxy.
- Capture from the CLI, dashboard, MCP clients, Markdown folders, or an optional mobile PWA.
- Turn one memory into editable `SPEC.md`, `PROMPT.md`, and `SKILL.md` implementation handoffs.
- Keep the core workflow entirely local, including AI generation through Ollama.

## Features

| Area | What it provides |
| --- | --- |
| Local dashboard | Search, capture, projects, lifecycle, priorities, topics, and memory management |
| Memory galaxy | Interactive canvas graph with topic/project hubs and zoom controls |
| Context-aware recall | Repository, branch, file, semantic meaning, keywords, status, and recencyâ€”with an explanation |
| CLI | Fast capture, recall, ingestion, digest, resolution, and generation commands |
| MCP server | Shared memory tools for Codex, Claude Code, Cursor, and other MCP clients |
| AI handoffs | Reviewable specifications, prompts, skills, ZIP export, Ollama/OpenAI/Anthropic-compatible providers |
| Optional mobile companion | Installable Android PWA, offline capture, Android Share target, encrypted synchronization |

## Quick start from source

### Requirements

- Node.js 22.5 or newer (Recall uses the built-in `node:sqlite` module)
- npm
- Git is optional, but enables repository-aware context

```bash
git clone https://github.com/A2Welt/Recall.git
cd Recall
npm ci
npm run build
npm link
recall serve --open
```

Without `npm link`, run it directly:

```bash
node dist/cli/index.js serve --open
```

The dashboard is available at `http://127.0.0.1:4321`. The server listens only on the loopback interface.

The first meaning-based query builds a persistent local semantic index and may download the embedding model once. Embeddings and inference remain on your machine; later searches reuse the stored index.

## The workflow: leave reasoning where future work can find it

```bash
cd ~/code/my-app

# Capture the decision where it was made. Repository and branch are automatic.
recall add "Payment retry policy" \
  --decision "Keep retries at two" \
  --why "A third attempt exceeds the payment provider's idempotency window" \
  --alternative "Unlimited retries: rejected because duplicate charge risk increases" \
  --tradeoff "Some transient failures require manual recovery" \
  --file src/payments/retry.ts

# Weeks later, ask in different words from the same repository.
recall recall "why only two payment retries"

# See every unresolved decision attached to this codebase.
recall list --repo --open
```

The same flow works through MCP: an agent records a significant decision with `capture_idea`, then a future session calls `recall_ideas` with its current repository, branch, and file. Recall becomes continuity between sessions without giving the agent access to unrelated memories.

## CLI reference

| Command | Description |
| --- | --- |
| `recall add "<text>" [--file <path>] [--repo <path>] [--why <text>]` | Capture a memory with current Git context and optional decision rationale |
| `recall ingest <path>` | Incrementally import an Obsidian vault, Logseq graph, or Markdown folder |
| `recall recall ["<query>"] [--limit <n>]` | Retrieve contextually relevant memories |
| `recall list [--repo] [--open]` | List memories, optionally filtered |
| `recall resolve <id>` | Resolve a memory using its UUID or unique prefix |
| `recall detach <id>` | Remove incorrect repository/file context without deleting the memory |
| `recall digest` | Show recent and resurfaced memories |
| `recall serve [--port <n>] [--open]` | Start the local dashboard |
| `recall mcp` | Start the stdio MCP server |
| `recall ai configure` | Configure an encrypted AI provider |
| `recall ai status` / `recall ai lock` | Inspect or lock provider configuration |
| `recall generate <id> --target <target> --types <list> --out <dir>` | Generate an implementation handoff |

Run `recall --help` or `recall <command> --help` for complete options.

## Connect an MCP client

A source checkout can be connected to any MCP client with:

```json
{
  "mcpServers": {
    "recall": {
      "command": "node",
      "args": ["/absolute/path/to/Recall/dist/cli/index.js", "mcp"]
    }
  }
}
```

The MCP server exposes:

- `capture_idea` — store a memory from an agent session. Repository and branch are auto-detected from the server's working directory (a stdio MCP server runs inside the agent's workspace), so the agent can omit context entirely. It also accepts optional structured decision fields: `decision`, `why`, `alternatives`, `tradeoffs`, `evidence`, and `outcome`.
- `recall_ideas` â€” retrieve relevant decisions for the current context.
- `list_open_ideas` â€” inspect unresolved work.
- `resolve_idea` â€” close a completed thread.

### Make agents capture decisions automatically

MCP tools are model-invoked: an agent only records a decision when it chooses to call `capture_idea`. To make capture effectively automatic, add a standing instruction to your agent's project memory â€” `CLAUDE.md` for Claude Code, `AGENTS.md` for Codex and Cursor. Paste this block:

```md
## Recall memory (MCP)

This workspace has the `recall` MCP server connected.

- **At the start of a task**, call `recall_ideas` with the current branch to load prior
  decisions. Treat them as context, but verify against the current code.
- **Whenever you make a significant decision** â€” choosing an approach, rejecting an
  alternative, recording a known limitation, or noting why something failed â€” immediately
  call `capture_idea`. Put the short human-readable summary in `content`, and when known,
  fill the structured `decision`, `why`, `alternatives`, `tradeoffs`, `evidence`, and
  `outcome` fields. Repository and branch are detected automatically; pass `file` when the
  decision is local to one file.
- **Do not** capture routine steps, restated requirements, or anything already obvious
  from the code. One memory per genuine decision.
- **When a captured thread is resolved**, call `resolve_idea` with its id.
```

For **deterministic** capture that does not depend on the model remembering, Claude Code [hooks](https://docs.claude.com/en/docs/claude-code/hooks) can shell out to the CLI on a `Stop` event:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "recall add \"Session summary: <fill in>\"" }] }
    ]
  }
}
```

The CLI captures git context from the current directory, so hook-driven captures are repo-scoped automatically. Codex has no hook system; rely on the `AGENTS.md` instruction there.

## How context-aware recall works

Recall combines several signals instead of treating memory as a flat notes list:

1. Repository, branch, and file proximity.
2. SQLite FTS5 keyword relevance.
3. Persistent, on-device semantic similarity.
4. Open/resolved status and recency.

Every result includes a short reason explaining why it surfaced. Recall does not silently read arbitrary repository files when generating AI handoffs; only the selected memory and its stored metadata are sent.

## AI implementation handoffs

Open a memory in the dashboard and choose **Generate implementation package**, or use:

```bash
recall ai configure
recall generate <memory-id> --target codex --types spec,prompt,skill --out .recall-handoff
```

Recall supports Ollama, OpenAI-compatible APIs, and Anthropic-compatible APIs. Provider configuration is encrypted using scrypt and AES-256-GCM. The passphrase is not stored, decrypted credentials remain in process memory only, and dashboard sessions automatically lock after inactivity.

## Where data is stored

The SQLite database is created outside the repository:

| Platform | Default database path |
| --- | --- |
| Windows | `%LOCALAPPDATA%\recall\Data\recall.db` |
| macOS | `~/Library/Application Support/recall/recall.db` |
| Linux | `~/.local/share/recall/recall.db` |

Back up `recall.db` to preserve memories. WAL sidecar files may exist while Recall is running, so stop the server before taking a raw file copy.

Encrypted AI and mobile configuration also live in the operating systemâ€™s application config directory, never in this repository or browser local storage.

## Optional mobile companion

The desktop application is completely usable without Cloudflare or any hosted service. Mobile synchronization is an optional, self-hosted companion composed of a static PWA, a small Cloudflare Worker, and a D1 database containing ciphertext only.

The phone can capture offline, receive a read-only encrypted library snapshot, group memories by topic or project, and accept shared text from Google Keep and other Android apps. Follow [the self-hosting guide](docs/mobile-capture.md) to deploy your own instance.

## Privacy and security model

- No account, advertising, analytics, or telemetry.
- The desktop HTTP server binds to `127.0.0.1` only.
- Readable memories remain in local SQLite.
- AI is disabled until the user configures a provider and explicitly generates an artifact.
- Ollama provides an entirely local AI path.
- Mobile relay data is encrypted on-device with AES-256-GCM; the relay never receives the encryption key.
- Secrets, databases, local Wrangler configuration, generated artifacts, and environment files are ignored by Git.

Please report security issues according to [SECURITY.md](SECURITY.md).

## Development

```bash
npm ci
npm run build
npm test
```

Worker development is separate:

```bash
cd workers-sync
npm ci
npm run type-check
npm run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Project status

Recall is early-stage software. Database migrations are additive, but APIs and UI behavior may still change before a stable release. Back up important data and review generated AI artifacts before using them.

## License

Recall is available under the [MIT License](LICENSE).

