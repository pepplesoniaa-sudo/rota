# Git conventions

Rules for commits, branches, `.gitignore`, the CI workflow and the two files in `docs/`. Read this file before you commit, push, merge, or change `.gitignore` or `.github/workflows/ci.yml`.

**How this file relates to AGENTS.md.** It adds detail to AGENTS.md and never relaxes it. Ids such as (S-19) or (A-16) point to AGENTS.md. `FR-` and `PRD` ids point to the PRD v1.1. If this file seems to disagree with AGENTS.md or the PRD, they win: stop and ask (AGENTS section 7).

**The PRD says almost nothing about git.** It requires a CI run of lint, typecheck and tests (PRD 13, phase 0) and a fresh clone that reaches a passing k6 run in under 15 minutes (PRD 11). Everything else here protects those two things, the secrets, and the record of Rox's decisions.

**Every numbered rule here is a failure rule.** Breaking one means the task failed even if the code builds, the tests pass and the feature works. Cite the ids you checked in your task report.

---

## 1. What never enters the repository

- **GIT-1. No secrets, ever** (A-16, B-17, B-31). Never commit `.env` or any `.env.*` file except `.env.example`, which holds placeholders only. Never commit a Flutterwave key, the webhook hash, a JWT secret, the card-token encryption key, a database or Redis URL with a password, a Resend key, a `*.pem` or `*.p8` file, an Expo or EAS token, or a card token. CI fails if any tracked file contains `FLWSECK`, `FLWPUBK` or `-----BEGIN`, using a `git grep` step (no new dependency). If a secret was ever committed, stop and tell Rox. Rewriting history does not undo a leak, because the key must be rotated.

- **GIT-2. No generated output.** `.gitignore` covers `node_modules/`, `.next/`, `dist/`, `coverage/`, `.expo/`, `apps/mobile/ios/`, `apps/mobile/android/`, the generated Prisma client, `*.log` and k6 output files. The native folders are produced by `expo prebuild` and are never edited by hand. Native changes go through `app.config.ts` and config plugins.

- **GIT-3. These are always committed:** `pnpm-lock.yaml` (L-21), every folder in `prisma/migrations/`, every file in `prisma/sql/`, `.env.example`, `infra/k6/` scripts, and `README.md`. A change to `schema.prisma` and the migration it needs go in the same commit (DB-9).

## 2. History and branches

- **GIT-4. `main` is always green.** Do work on a short-lived branch off `main`. Merge into `main` only when every AGENTS.md 6.1 check passes in CI. Never push a commit to `main` that fails a check.

- **GIT-5. Never rewrite shared history.** Never force-push `main`, never rebase or amend a commit that is already on `main`, and never delete `main` or a branch that is not yours. On your own unmerged branch, `git push --force-with-lease` is allowed.

- **GIT-6. CI is never weakened.** `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter api build`, `prisma validate`, the migration drift check (DB-9) and the secret check (GIT-1). Never remove a step, add `continue-on-error`, add an `if:` that skips a step, or move a check out of CI to make it pass.

- **GIT-7. No new dependency arrives in a lockfile change** (AGENTS 6.1). A diff to `pnpm-lock.yaml` adds only packages named in AGENTS.md section 2 and their own dependencies. A version bump stays inside the locked major (L-1 to L-24).

## 3. The two files in `docs/`

- **GIT-8. Never change the PRD.** No commit modifies, moves or deletes `docs/Rota-PRD-v1.1.md`. Only Rox replaces it.

- **GIT-9. `docs/decisions.md` is append-only.** Add each of Rox's answers as a new dated entry at the top, quoting the question and the answer (AGENTS 7.8). Never edit or delete a past entry. A later answer supersedes an earlier one with a new entry that names the one it replaces.

## 4. Repository scope

- **GIT-10. One repository, Rota only.** Never add a git submodule, subtree or remote that points at Matinee or any other project, and never copy files in from one (AGENTS section 1).

---

## Defaults, not failure rules

These keep history readable. Follow them. A reviewer may ask you to fix them, but breaking one is not a failed task.

- **Commit messages** (S-19): `type(scope): summary`, in the imperative, 72 characters at most. Types: `feat`, `fix`, `test`, `refactor`, `chore`, `docs`, `ci`, `build`. The scope is the area folder (`swaps`, `billing`, `auth`, `infra`, `mobile`). Put the requirement id first in the summary when one applies: `feat(swaps): FR-23 manager approval`.
- **One logical change per commit** (S-19). A feature commit includes its tests.
- **Branch names:** `phase-<n>/<short-name>`, for example `phase-2/swap-approval`.
- **Merging:** squash merge a branch into `main`, with the squash message in the commit format above.
