#!/usr/bin/env bash
# TRIADMIND_BOOTSTRAP_VERSION=1.0
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

TRIADMIND_COMMAND='node --import tsx cli.ts'

run_triadmind() {
  local args="$*"
  eval "${TRIADMIND_COMMAND} ${args}"
}

run_triadmind "sync --force"
run_triadmind "runtime --visualize --view full"
printf "n\n" | eval "${TRIADMIND_COMMAND} plan --no-open --view architecture"
eval "${TRIADMIND_COMMAND} verify --strict --json" > .triadmind/bootstrap-verify.json

echo "[TriadMind] bootstrap verify written: .triadmind/bootstrap-verify.json"
