# TriadMind one-shot daily session bootstrap (Windows PowerShell)
$ErrorActionPreference = 'Stop'

triadmind bootstrap doctor --json
triadmind sync --force
triadmind runtime --visualize --view full
"n" | triadmind plan --no-open --view architecture
triadmind verify --strict --json | Out-File -FilePath ".triadmind/bootstrap-verify.json" -Encoding utf8
triadmind govern ci --policy .triadmind/govern-policy.json --json | Out-File -FilePath ".triadmind/govern-report.json" -Encoding utf8

Write-Host "[TriadMind] session gate passed."
Write-Host "[TriadMind] verify report: .triadmind/bootstrap-verify.json"
Write-Host "[TriadMind] govern report: .triadmind/govern-report.json"
