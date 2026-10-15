<#
.SYNOPSIS
  Sample CPU and memory of one process (e.g. the uvicorn backend) into a CSV file.
.DESCRIPTION
  Writes "timestamp,cpu_percent,working_set_mb,private_mb,threads,handles" once per
  interval until the process exits or -StopFile appears. cpu_percent is relative to
  ONE logical core (200 = two cores busy). Used by bin/test-load.sh on Windows.
.EXAMPLE
  powershell -NoProfile -File tests/load/monitor-process.ps1 -ProcessId 1234 -OutFile r.csv -StopFile stop.flag
#>
param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$StopFile = '',
  [double]$IntervalSeconds = 1
)

$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($OutFile, "timestamp,cpu_percent,working_set_mb,private_mb,threads,handles`n", $utf8)

try { $proc = Get-Process -Id $ProcessId -ErrorAction Stop } catch { Write-Error "Process $ProcessId not found"; exit 1 }
$prevCpu = $proc.TotalProcessorTime.TotalSeconds
$prevTime = Get-Date

while ($true) {
  Start-Sleep -Milliseconds ([int]($IntervalSeconds * 1000))
  if ($StopFile -and (Test-Path $StopFile)) { break }
  try { $proc = Get-Process -Id $ProcessId -ErrorAction Stop } catch { break }
  $now = Get-Date
  $cpu = $proc.TotalProcessorTime.TotalSeconds
  $elapsed = ($now - $prevTime).TotalSeconds
  $pct = if ($elapsed -gt 0) { 100 * ($cpu - $prevCpu) / $elapsed } else { 0 }
  $line = [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0},{1:F1},{2:F1},{3:F1},{4},{5}',
    $now.ToString('o'), $pct, ($proc.WorkingSet64 / 1MB), ($proc.PrivateMemorySize64 / 1MB), $proc.Threads.Count, $proc.HandleCount)
  [IO.File]::AppendAllText($OutFile, "$line`n", $utf8)
  $prevCpu = $cpu
  $prevTime = $now
}
