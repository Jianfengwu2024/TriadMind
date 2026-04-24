# TRIADMIND_BOOTSTRAP_VERSION={{BOOTSTRAP_VERSION}}
$ErrorActionPreference = 'Stop'

{{TRIADMIND_COMMAND}} sync --force
{{TRIADMIND_COMMAND}} runtime --visualize --view full
"n" | {{TRIADMIND_COMMAND}} plan --no-open --view architecture
{{TRIADMIND_COMMAND}} verify --strict --json | Out-File -FilePath ".triadmind/bootstrap-verify.json" -Encoding utf8

Write-Host "[TriadMind] bootstrap verify written: .triadmind/bootstrap-verify.json"
