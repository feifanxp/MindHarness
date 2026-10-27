# MindRoom Chat: Agent Guide

## Why this fork exists

MindRoom Chat is a MindRoom-focused Matrix client built on Cinny.

MindRoom streams AI responses over Matrix by sending frequent `m.replace` edits. The prior Element-based fork had stale-edit rendering failures that break streaming UX. Cinny is being adopted because its edit rendering is more reliable and its codebase is smaller/easier to evolve.

Primary product goals in this fork:

1. Thread-first UX (agent conversations happen in threads and must be first-class).
2. MindRoom tool-trace rendering (`<tool>`, `<tool-group>`, `<think>`, etc.).
3. MindRoom `!` command autocomplete that sends plain text.

## Canonical working document

Read the Runbook section in `FORK_CHANGES.md` first.

The Runbook section in `FORK_CHANGES.md` is the canonical, living implementation guide. All agents are expected to update it as work progresses (status, decisions, risks, validation, and next steps), including after context compaction.

For UI changes, read [docs/ui-design.md](docs/ui-design.md) and keep it aligned with intentional changes to shared visual behavior.

## Git safety — MANDATORY

**NEVER run `git reset --hard`, `git checkout -- .`, `git clean -f`, or any command that discards uncommitted working-tree changes.** Not even to "clean up" after a failed operation. Uncommitted changes may be hours of unsaved work. If the working tree is dirty and you need a clean state, use `git stash` first and tell the user. Always ask before running any destructive git command.

## Required delivery process

For each logical implementation step:

1. Implement one bounded step only.
2. Update the Runbook section in `FORK_CHANGES.md` with what changed and what is next.
3. Validate with:
   - `npm run typecheck`
   - `npm run build`
   - `npm run lint` (when feasible)
4. Run an independent review pass:
   - preferred: separate agent/subagent,
   - fallback: second independent self-review pass.
5. Commit a focused change.

Keep commits small and frequent.
