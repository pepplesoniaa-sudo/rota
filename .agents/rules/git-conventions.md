---
trigger: model_decision
description: Use before you commit, push, branch or merge, and before you change .gitignore, .github/workflows/ci.yml or docs/decisions.md.
---

# Git conventions

Ids like (S-19) point to AGENTS.md, FR- and PRD ids to the PRD v1.1. The PRD asks only for a CI run of lint, typecheck and tests (PRD 13, phase 0) and a fresh clone that reaches a passing k6 run in under 15 minutes (PRD 11). These rules protect those two, the secrets, and the record of Rox's decisions.

## 1. What enters the repository

- **GIT-1. No secrets, ever** (A-16, B-17, B-31). Never commit `.env` or any `.env.*` file except `.env.example`, which holds placeholders only. Never commit a Flutterwave key, the webhook hash, a JWT secret, the card-token key, a database or Redis URL with a password, a Resend key, a `*.pem` or `*.p8` file, an Expo or EAS token, or a card token. CI fails if a tracked file contains `FLWSECK`, `FLWPUBK` or `-----BEGIN`, using a `git grep` step (no new dependency). If a secret was ever committed, stop and tell Rox. Why: anyone with the repo can use a committed key, and rewriting history does not undo the leak; only rotating the key does.
- **GIT-2. No generated output.** `.gitignore` covers `node_modules/`, `.next/`, `dist/`, `coverage/`, `.expo/`, `apps/mobile/ios/`, `apps/mobile/android/`, any custom Prisma client `output` folder, `*.log` and k6 output files. Native changes go through `app.config.ts` and config plugins, never hand edits to the native folders. Why: generated files go stale and swamp diffs, and `expo prebuild` overwrites hand edits.
- **GIT-3. These are always committed:** `pnpm-lock.yaml` (L-21), every folder in `prisma/migrations/`, every file in `prisma/sql/`, `.env.example`, `infra/k6/` scripts and `README.md`. A `schema.prisma` change and its migration go in one commit (DB-9). A lockfile diff adds only packages named in AGENTS.md section 2 and their own dependencies, inside the locked major. Why: the PRD 11 fresh-clone run needs every one of these, and the lockfile is where an unlisted package shows up.

## 2. History and branches

- **GIT-4. `main` is always green.** Work on a short-lived branch off `main`. A branch reaches `main` only after every AGENTS.md 6.1 check passes in CI. Never push a commit to `main` that fails a check. Who performs the merge is not set in AGENTS.md or the PRD: ask Rox before your first merge. Why: a red `main` blocks every later branch, and the PRD 11 fresh clone is taken from `main`.
- **GIT-5. Never rewrite shared history.** Never force-push `main`, never rebase or amend a commit already on `main`, and never delete `main` or a branch that is not yours. On your own unmerged branch, `git push --force-with-lease` is allowed. Why: other clones and CI runs point at those commits.
- **GIT-6. CI is never weakened.** `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter api build`, `prisma validate`, the drift check (DB-9) and the secret check (GIT-1). Never remove a step, add `continue-on-error`, add an `if:` that skips a step, or move a check out of CI. Why: a weakened step lets a broken commit look green.

## 3. Decisions and scope

- **GIT-7. `docs/decisions.md` is append-only** (AGENTS 7.8). Add each answer from Rox as a new dated entry at the top, quoting the question and the answer. Never edit or delete a past entry. A later answer supersedes an earlier one with a new entry that names the one it replaces. Why: the source-of-truth order in AGENTS section 1 ranks this file above the PRD, so its history must show which answer stands.
- **GIT-8. One repository, Rota only** (AGENTS section 1). Never add a git submodule, subtree or remote that points at Matinee or any other project. Why: a link to another repo is the easiest way for its code or config to leak in.

## Defaults, not failure rules

Follow these. They keep history readable and tie each commit to a requirement id. A reviewer may ask you to fix them, but breaking one is not a failed task.

- **Commit message** (S-19): `type(scope): summary`, imperative, 72 characters at most. Types: `feat`, `fix`, `test`, `refactor`, `chore`, `docs`, `ci`, `build`. Scope is the area: `swaps`, `billing`, `auth`, `infra`, `mobile`. Put the requirement id first when one applies: `feat(swaps): FR-23 manager approval`.
- **Branch name:** `phase-<n>/<short-name>`, for example `phase-2/swap-approval`.
- **Merge:** squash merge into `main`, with the squash message in the format above.