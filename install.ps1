# AE-MCP-IMT — install on Windows (PowerShell 5.1+).
#   .\install.ps1              check -> build -> live self-test -> write client configs (asks first)
#   .\install.ps1 -Yes         same, without questions
#   .\install.ps1 -NoConfig    check, build and self-test only; print the config instead
# If scripts are blocked: powershell -ExecutionPolicy Bypass -File .\install.ps1
# Not verified by Immersive Media Technologies on Windows yet (we run macOS) — reports welcome.
param([switch]$Yes, [switch]$NoConfig)
$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Fail = $false
function Ok($m)   { Write-Host "  ok   $m" -ForegroundColor Green }
function Warn($m) { Write-Host " warn  $m" -ForegroundColor Yellow }
function Bad($m)  { Write-Host " FAIL  $m" -ForegroundColor Red; $script:Fail = $true }
function Ask($q)  { if ($Yes) { return $true }; $r = Read-Host "$q [y/N]"; return ($r -eq 'y' -or $r -eq 'Y') }

Write-Host "`nAE-MCP-IMT — environment check`n-----------------------------------------------"
$AeExe = $null
if ($env:AE_MCP_EXE -and (Test-Path $env:AE_MCP_EXE)) { $AeExe = $env:AE_MCP_EXE }
else {
  foreach ($y in 2026, 2025, 2024) {
    $c = "$env:ProgramFiles\Adobe\Adobe After Effects $y\Support Files\AfterFX.exe"
    if (Test-Path $c) { $AeExe = $c; break }
  }
}
if ($AeExe) { Ok "After Effects: $AeExe" } else { Bad "After Effects 2024-2026 not found under $env:ProgramFiles\Adobe (set AE_MCP_EXE to AfterFX.exe)" }

$NodeBin = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($NodeBin) {
  $major = [int]((& $NodeBin -v) -replace '^v(\d+).*', '$1')
  if ($major -ge 22) { Ok "Node $(& $NodeBin -v) — $NodeBin" } else { Bad "Node.js >= 22 required (found $(& $NodeBin -v))" }
} else { Bad "Node.js >= 22 not found — install from https://nodejs.org or use the Claude Desktop extension (.mcpb), which needs no Node" }
if ($Fail) { Write-Host "`nStopped." -ForegroundColor Red; exit 1 }

Write-Host "`nBuild`n-----------------------------------------------"
Set-Location $Here
if (Test-Path 'package-lock.json') { npm ci --no-audit --no-fund 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { npm install --no-audit --no-fund 2>&1 | Out-Null } }
else { npm install --no-audit --no-fund 2>&1 | Out-Null }
if (Test-Path 'node_modules') { Ok 'dependencies installed' } else { Bad 'npm install failed'; exit 1 }
npm run build 2>&1 | Out-Null
if (Test-Path 'dist\index.js') { Ok 'server built: dist\index.js' } else { Bad 'build produced no dist\index.js'; exit 1 }

Write-Host "`nLive check against After Effects`n-----------------------------------------------"
if (-not (Get-Process -Name 'AfterFX' -ErrorAction SilentlyContinue)) {
  Warn 'After Effects is not running — skipping the live check (start it and run .\install.ps1 again)'
} else {
  $env:AE_MCP_EXE = $AeExe
  $out = & $NodeBin "$Here\tools\selftest.mjs" 2>$null | Out-String
  if ($out -match '"ok":\s*true') {
    $v = [regex]::Match($out, '"version":\s*"([^"]*)"').Groups[1].Value
    Ok "After Effects answers: $v"
  } else { Bad 'After Effects did not answer (AE -> Edit -> Preferences -> Scripting & Expressions -> Allow Scripts to Write Files and Access Network)'; Write-Host $out }
}

$entry = "$Here\dist\index.js"
$serverJson = @"
{
      "command": "$($NodeBin -replace '\\', '\\')",
      "args": ["$($entry -replace '\\', '\\')"],
      "env": { "AE_MCP_EXE": "$($AeExe -replace '\\', '\\')", "MCP_TIMEOUT": "120000" }
    }
"@
Write-Host "`nConnect`n-----------------------------------------------"
function Write-ClientConfig($file, $label) {
  if (-not (Ask "Add the server to $label ($file)?")) { return }
  $dir = Split-Path -Parent $file
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  if (Test-Path $file) { Copy-Item $file "$file.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" }
  $js = @'
const fs = require('fs'); const [file, node, entry, ae] = process.argv.slice(2);
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.aftereffects = { command: node, args: [entry], env: { AE_MCP_EXE: ae, MCP_TIMEOUT: '120000' } };
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
'@
  $tmp = Join-Path $env:TEMP 'aemcp-write-config.js'
  Set-Content -Path $tmp -Value $js -Encoding UTF8
  & $NodeBin $tmp $file $NodeBin $entry $AeExe
  Ok "$label`: mcpServers.aftereffects written (restart $label)"
}
if ($NoConfig) {
  Write-Host "Add to your client's MCP config:`n`n  `"mcpServers`": { `"aftereffects`": $serverJson }`n"
} else {
  Write-ClientConfig "$env:APPDATA\Claude\claude_desktop_config.json" 'Claude Desktop'
  Write-ClientConfig "$env:USERPROFILE\.cursor\mcp.json" 'Cursor'
  Write-ClientConfig "$env:USERPROFILE\.gemini\config\mcp_config.json" 'Google Antigravity'
  Write-Host ""
  Write-Host "Other clients: `"mcpServers`": { `"aftereffects`": $serverJson }"
}
Write-Host "`nFirst session on a new machine: add AE_MCP_READONLY=1 to env and work on a COPY of the project —"
Write-Host "the server edits the open document. MCP_TIMEOUT=120000: a cold AE start does not fit the default 30 s.`n"
