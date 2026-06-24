# Contributing to Recall

Thank you for improving Recall. Keep contributions focused, testable, and consistent with its local-first security model.

## Development setup

```bash
git clone https://github.com/A2Welt/Recall.git
cd Recall
npm ci
npm run build
```

Start the compiled application:

```bash
node dist/cli/index.js serve --open
```

For UI development, run `npm run dev` and separately rebuild or watch the server with `npm run dev:server`.

## Before opening a pull request

1. Keep readable user data local unless the user explicitly enables a remote feature.
2. Never add credentials, local databases, pairing links, provider configuration, or deployment IDs.
3. Run `npm run build` and `npm test`.
4. For Worker changes, run `npm ci` and `npm run type-check` inside `workers-sync`.
5. Document new commands, configuration, migrations, and security boundaries.
6. Include tests for data handling, migrations, provider adapters, and API behavior where practical.

## Design principles

- Local-first is the default, not a premium mode.
- Context should be explainable; show why a memory surfaced.
- User memories are untrusted input when constructing AI prompts.
- External providers receive the minimum explicitly selected context.
- Deletion, export, and backup behavior must be clear.
- Mobile relay services must not be able to decrypt user content.

## Pull requests

Describe the problem, the behavioral change, verification performed, and any privacy or migration impact. Avoid combining unrelated refactors with a feature or bug fix.

By contributing, you agree that your contribution is licensed under the project’s MIT License.
