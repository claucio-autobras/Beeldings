#!/bin/bash
set -euo pipefail

# Static regression guard: starting the workspace and running post-merge must
# never invoke the GitHub daemon or a command that publishes to the remote.

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

project_workflow="$(
  awk '
    /^\[\[workflows\.workflow\]\]$/ {
      if (in_project) exit
      in_project = 0
    }
    /^name = "Project"$/ { in_project = 1 }
    in_project { print }
  ' .replit
)"

if printf '%s\n' "$project_workflow" |
  grep -Eiq 'GitHub sync|github-sync-daemon|scripts/sync-github\.sh[[:space:]]+(push|push-snapshot|init-base)'; then
  echo "FAIL: the Project workflow contains an automatic GitHub sync trigger." >&2
  exit 1
fi

if grep -Eiq 'github-sync-daemon|scripts/sync-github\.sh' scripts/post-merge.sh; then
  echo "FAIL: post-merge contains an automatic GitHub synchronization command." >&2
  exit 1
fi

if grep -Eiq 'name = "GitHub sync"|github-sync-daemon' .replit; then
  echo "FAIL: .replit still registers the automatic GitHub sync daemon." >&2
  exit 1
fi

echo "PASS: workspace startup and post-merge have no automatic GitHub sync."