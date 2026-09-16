<#
.SYNOPSIS
  Manual one-shot sync of this machine's AI CLI usage data to the Token Manager VPS.

.DESCRIPTION
  The Mac boxes run scripts/sync-data.sh from cron; this is the same idea for a
  Windows machine that should not have anything running in the background — you
  double-click scripts/sync.bat (or run this script) whenever you feel like it.

  Only files touched since the last successful run are sent, bundled into one
  tar.gz so a sync is a single scp instead of hundreds of round trips. Server
  side dedup is exact, so re-sending a file never double-counts.

.PARAMETER Full
  Ignore the local watermark and re-send everything.

.PARAMETER NoRestart
  Upload only; leave the parsing to the server's own cron (every 6 hours).

.EXAMPLE
  .\sync-windows.ps1
  .\sync-windows.ps1 -Full
#>
param(
  [switch]$Full,
  [switch]$NoRestart,
  [string]$VpsHost = $(if ($env:TOKEN_MANAGER_VPS) { $env:TOKEN_MANAGER_VPS } else { 'root@198.98.53.225' }),
  [string]$RemoteData = '/opt/token-manager-data'
)

$ErrorActionPreference = 'Stop'

$StateFile = Join-Path $env:LOCALAPPDATA 'token-manager-sync\state.json'
$Machine = ($env:COMPUTERNAME -replace '[^A-Za-z0-9_-]', '').ToLower()

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

# Fail with one readable line instead of a PowerShell stack trace, and leave
# no half-built bundle behind. The watermark is only written on success, so a
# failed run simply re-sends the same files next time.
trap {
  Say ''
  Say "同步失败: $($_.Exception.Message)" 'Red'
  if ($work -and (Test-Path $work)) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
  exit 1
}

# --- watermark -------------------------------------------------------------
$since = [datetime]::MinValue
if (-not $Full -and (Test-Path $StateFile)) {
  try {
    $since = [datetime]::Parse(
      (Get-Content $StateFile -Raw | ConvertFrom-Json).lastSync,
      $null,
      [System.Globalization.DateTimeStyles]::RoundtripKind
    ).ToUniversalTime()
  } catch {
    Say "状态文件读不出来，这次按全量处理" 'Yellow'
  }
}
$startedAt = (Get-Date).ToUniversalTime()
Say ("[1/5] 上次同步: " + $(if ($since -eq [datetime]::MinValue) { '从未 (全量)' } else { $since.ToString('yyyy-MM-dd HH:mm:ss') + ' UTC' }))

# --- stage -----------------------------------------------------------------
$work = Join-Path $env:TEMP ("tm-sync-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$stage = Join-Path $work 'stage'
New-Item -ItemType Directory -Force -Path $stage | Out-Null

function Copy-Newer([string]$SourceDir, [string]$StageSubdir) {
  if (-not (Test-Path $SourceDir)) { return 0 }
  $root = (Resolve-Path $SourceDir).Path.TrimEnd('\')
  $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter *.jsonl |
    Where-Object { $_.LastWriteTimeUtc -gt $since })
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($root.Length).TrimStart('\')
    $dest = Join-Path $stage (Join-Path $StageSubdir $rel)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    Copy-Item -LiteralPath $f.FullName -Destination $dest
  }
  return $files.Count
}

# A live SQLite DB is mid-write and in WAL mode, so copying the file is not
# safe — the backup API gives a consistent single-file snapshot (same thing
# sync-data.sh does with `sqlite3 .backup` on the Macs).
$backupPy = Join-Path $work 'backup.py'
@'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
with dst:
    src.backup(dst)
dst.close()
src.close()
'@ | Set-Content -LiteralPath $backupPy -Encoding UTF8

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
$python = if ($pythonCmd) { $pythonCmd.Source } else { $null }

function Copy-SqliteSnapshot([string]$SourceDb, [string]$DestRelative) {
  if (-not (Test-Path $SourceDb)) { return $false }
  if (-not $python) {
    Say "  ! 找不到 python，跳过 $SourceDb（复制 WAL 数据库不安全）" 'Yellow'
    return $false
  }
  $dest = Join-Path $stage $DestRelative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
  & $python $backupPy $SourceDb $dest
  if ($LASTEXITCODE -ne 0) { throw "sqlite 快照失败: $SourceDb" }
  return $true
}

Say '[2/5] 打包本机数据...'
$claude = Copy-Newer "$env:USERPROFILE\.claude\projects" 'claude-projects'
$codex = Copy-Newer "$env:USERPROFILE\.codex\sessions" 'codex-sessions'
$openclaw = Copy-Newer "$env:USERPROFILE\.openclaw\agents" 'openclaw-agents'
Say "  Claude Code: $claude 个会话文件"
Say "  Codex:       $codex 个会话文件"
if ($openclaw -gt 0) { Say "  OpenClaw:    $openclaw 个会话文件" }

# One snapshot per machine; the collector reads every .db in the directory.
$opencode = Copy-SqliteSnapshot "$env:USERPROFILE\.local\share\opencode\opencode.db" "opencode\opencode-$Machine.db"
if ($opencode) { Say '  OpenCode:    1 个数据库快照' }

$antigravity = 0
$agDir = "$env:USERPROFILE\.gemini\antigravity-cli\conversations"
if (Test-Path $agDir) {
  foreach ($db in Get-ChildItem -LiteralPath $agDir -Filter *.db -File) {
    # Filenames are the conversation id the collector uses as session_id — keep them.
    if (Copy-SqliteSnapshot $db.FullName "antigravity-conversations\$($db.Name)") { $antigravity++ }
  }
  if ($antigravity -gt 0) { Say "  Antigravity: $antigravity 个数据库快照" }
}

if (-not (Get-ChildItem -LiteralPath $stage -Recurse -File)) {
  Say '没有新数据，本次不用上传。' 'Green'
  Remove-Item -LiteralPath $work -Recurse -Force
  exit 0
}

$bundle = Join-Path $work 'bundle.tgz'
& tar.exe -czf $bundle -C $stage .
if ($LASTEXITCODE -ne 0) { throw '打包失败' }
$sizeMB = [math]::Round((Get-Item $bundle).Length / 1MB, 1)

# --- upload ----------------------------------------------------------------
Say "[3/5] 上传 $sizeMB MB 到 $VpsHost ..."
$remoteTgz = "/tmp/tm-sync-$Machine.tgz"
& scp -q $bundle "${VpsHost}:${remoteTgz}"
if ($LASTEXITCODE -ne 0) { throw "scp 失败（先确认 ssh $VpsHost 能免密登录）" }

Say '[4/5] 服务端解包...'
$unpack = "set -e; mkdir -p $RemoteData/claude-projects $RemoteData/codex-sessions $RemoteData/openclaw-agents $RemoteData/opencode $RemoteData/antigravity-conversations; tar xzf $remoteTgz -C $RemoteData; rm -f $remoteTgz; du -sh $RemoteData"
& ssh $VpsHost $unpack
if ($LASTEXITCODE -ne 0) { throw '远端解包失败' }

# --- trigger ---------------------------------------------------------------
if ($NoRestart) {
  Say '[5/5] 已上传，等服务端 cron 解析（每 6 小时一次）。' 'Green'
} else {
  Say '[5/5] 触发解析（重启服务，启动时会跑一次全量 sync）...'
  # Remember where the log ends, restart, then wait for the startup sync to
  # finish and show only what it appended. A fixed sleep reported the previous
  # run's numbers. Single quotes on the remote side on purpose: Windows
  # PowerShell strips double quotes from native-command arguments, which turned
  # the pipe in an earlier version into a local one.
  $trigger = @'
L=/root/.pm2/logs/token-manager-out-0.log; sz=$(stat -c %s $L); pm2 restart token-manager >/dev/null 2>&1; for i in $(seq 1 90); do sleep 2; tail -c +$((sz+1)) $L | grep -q 'Running on http' && break; done; tail -c +$((sz+1)) $L | grep -E 'synced|migrate'
'@
  & ssh $VpsHost $trigger.Trim()
}

# --- watermark: only advance after everything above succeeded --------------
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StateFile) | Out-Null
@{ lastSync = $startedAt.ToString('o'); machine = $Machine } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
Remove-Item -LiteralPath $work -Recurse -Force

Say ''
Say "完成 ✔  https://token.zaaac.vip 刷新即可看到。" 'Green'
