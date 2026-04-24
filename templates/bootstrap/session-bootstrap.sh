#!/usr/bin/env bash
# TRIADMIND_BOOTSTRAP_VERSION={{BOOTSTRAP_VERSION}}
set -euo pipefail

{{TRIADMIND_COMMAND}} sync --force
{{TRIADMIND_COMMAND}} runtime --visualize --view full
printf "n\n" | {{TRIADMIND_COMMAND}} plan --no-open --view architecture
{{TRIADMIND_COMMAND}} verify --strict --json > .triadmind/bootstrap-verify.json

echo "[TriadMind] bootstrap verify written: .triadmind/bootstrap-verify.json"
