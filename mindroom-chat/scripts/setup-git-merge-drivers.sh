#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dot_git="$repo_root/.git"

git_args=(-C "$repo_root")
if [[ -f "$dot_git" ]]; then
  git_dir="$(sed 's/^gitdir: //' "$dot_git")"
  if [[ "$git_dir" != /* ]]; then
    git_dir="$repo_root/$git_dir"
  fi
  git_args=(--git-dir "$git_dir" --work-tree "$repo_root")
fi

git "${git_args[@]}" config merge.mindroom-wrapper.name "MindRoom fork wrapper rebase driver"
git "${git_args[@]}" config merge.mindroom-wrapper.driver "node scripts/git-merge-mindroom-wrapper.mjs %O %A %B %P"

echo "Configured merge.mindroom-wrapper for this repository."
