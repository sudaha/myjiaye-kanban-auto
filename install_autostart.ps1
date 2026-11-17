$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runLoop = Join-Path $root 'run_loop.bat'

Write-Host '--- ZYCG Board auto-start setup ---'

# 1) Startup-folder shortcut (runs at user logon, no admin needed)
try {
  $ws = New-Object -ComObject WScript.Shell
  $lnkPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'ZYCGBoard.lnk'
  $sc = $ws.CreateShortcut($lnkPath)
  $sc.TargetPath = $runLoop
  $sc.WorkingDirectory = $root
  $sc.WindowStyle = 7
  $sc.Description = 'ZYCG board autostart (minimized)'
  $sc.Save()
  Write-Host ('[OK] startup shortcut: ' + $lnkPath)
} catch {
  Write-Host ('[!] startup shortcut failed: ' + $_.Exception.Message)
}

# 2) Scheduled task at system startup (more robust; needs admin)
try {
  $tr = '"' + $runLoop + '"'
  schtasks /create /tn 'ZYCGBoard' /tr $tr /sc onstart /f | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host '[OK] scheduled task ZYCGBoard (at startup).'
  } else {
    Write-Host '[i] scheduled task not created (run as Administrator for boot-start). Startup shortcut still works.'
  }
} catch {
  Write-Host ('[i] scheduled task skipped: ' + $_.Exception.Message)
}

Write-Host '--- done ---'
Write-Host 'Note: for a truly unattended machine, enable auto-logon or run the scheduled task as SYSTEM.'
