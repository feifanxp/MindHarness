# AGENTS: MindRoom Chat

## Mission

MindRoom Chat is built on Cinny to provide a Matrix client optimized for MindRoom AI agent workflows.

MindRoom depends on rapid message edits for streaming.
Reliable edit rendering is mandatory.
In addition, thread UX and tool-call visibility are core to product usability.

## First read (mandatory)

All agents must start with `FORK_CHANGES.md` (Runbook section).

It is the single source of truth for:

- architecture notes,
- implementation plan,
- execution order,
- validation/review process,
- current status and next steps.

Treat the Runbook section in `FORK_CHANGES.md` as a living document and keep it updated continuously.

## UI design

For UI changes, read [docs/ui-design.md](docs/ui-design.md) before choosing materials, headers, scrolling behavior, or component styling.
Reuse the shared primitives described there and update the guide when an intentional design decision changes.

## Working agreement

- Implement in small logical steps.
- Validate every step (`typecheck`, `build`, and lint when feasible).
- Require independent review after each logical step (separate agent/subagent when available; otherwise an independent second self-review).
- Commit frequently with focused messages.
- Add/update tests whenever behavior changes.
- Format prose with one sentence per line; do not hard-wrap lines at a fixed character width.
- Open pull requests as ready for review, never as drafts.
  After opening a PR, wait for all AI reviewers to finish, validate every finding, and address all confirmed items before considering the work complete.
- Always put screenshots of user-visible changes (before and after when fixing a visual bug) in the PR description.
  Upload them with `gh pr create --attach ./shot.png` or `gh pr edit --attach ./shot.png`; a `![alt](./shot.png)` reference in the body is rewritten to the uploaded image.
  Never attach screenshots the owner shared privately; take your own from a fixture or test account.

## Testing notes

- Run the full browser suite with `npm run test:e2e:parallel -- --jobs 8`.
  Start with `npm run test:e2e:parallel -- --list` to inspect coverage without starting services.
  Read `docs/testing.md` for prerequisites, external worker/SSO fixtures, reports, reruns, and Linux browser containers.
  The runner isolates accounts and artifacts per spec and runs timing-sensitive probes sequentially after the parallel queue.
  Do not replace this with Playwright `--workers=8`: tests within a spec share mutable accounts.
- For room/thread behavior, prefer dedicated behavioral tests over growing `RoomTimeline.test.ts` further.
  Route, filter, compact/expanded, and cache interactions regress across surfaces and are easier to verify in focused unit files plus live Playwright specs.
- When changing thread summaries, deep links, or room view mode behavior, verify both room overview and thread banner surfaces.
  They must share one resolution path and upgrade cleanly from cached state to newer live data.
- Run `npm test` before finalizing changes.
  Keep room timeline coverage in normal Vitest discovery; if a room test file becomes too large, split it by behavior instead of adding bespoke runners or name-pattern wrappers.
