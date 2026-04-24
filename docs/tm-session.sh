#!/usr/bin/env bash
# TriadMind one-shot daily session bootstrap (Linux/macOS)
set -euo pipefail

triadmind bootstrap doctor --json
triadmind sync --force
triadmind runtime --visualize --view full
printf "n\n" | triadmind plan --no-open --view architecture
triadmind verify --strict --json > .triadmind/bootstrap-verify.json
triadmind govern ci --policy .triadmind/govern-policy.json --json > .triadmind/govern-report.json

echo "[TriadMind] session gate passed."
echo "[TriadMind] verify report: .triadmind/bootstrap-verify.json"
echo "[TriadMind] govern report: .triadmind/govern-report.json"
