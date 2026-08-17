$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$SrcDir = Join-Path $Root "src"
$OutDir = Join-Path $Root "out"
$Log = Join-Path $Root "run.log"
$Ffmpeg = Join-Path $Root "..\jx-video-helper\ffmpeg\ffmpeg.exe"
$Wrangler = Join-Path $Root "..\..\node_modules\.bin\wrangler.cmd"
$Repo = Resolve-Path (Join-Path $Root "..\..")
$MediaBase = "https://media.jianxing.win"

New-Item -ItemType Directory -Force -Path $SrcDir, $OutDir | Out-Null

function Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  Add-Content -Path $Log -Value $line -Encoding UTF8
  Write-Output $line
}

if (-not (Test-Path $Ffmpeg)) { throw "missing ffmpeg: $Ffmpeg" }
if (-not (Test-Path $Wrangler)) { throw "missing wrangler: $Wrangler" }

function Test-Mp4Ok([string]$path) {
  if (-not (Test-Path $path)) { return $false }
  if ((Get-Item $path).Length -lt 1000000) { return $false }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Ffmpeg -v error -i $path -t 0 -f null NUL 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Get-HdVideo([string]$hd, [string]$src) {
  if (Test-Mp4Ok $src) { return }
  if (Test-Path $src) {
    Log "src invalid/truncated, re-download"
    Remove-Item $src -Force -ErrorAction SilentlyContinue
  }
  $url = "$MediaBase/$hd"
  Log "download $url"
  $ok = $false
  for ($try = 1; $try -le 4; $try++) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & curl.exe -L --fail --retry 3 -C - --connect-timeout 30 --max-time 0 -o $src $url
    $curlExit = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($curlExit -eq 0 -and (Test-Mp4Ok $src)) { $ok = $true; break }
    if ($curlExit -eq 0 -and (Test-Path $src)) {
      Log "file looks complete but is not a valid mp4, discard"
      Remove-Item $src -Force -ErrorAction SilentlyContinue
    }
    Log "curl try $try failed (exit=$curlExit), retry..."
    Start-Sleep -Seconds (10 * $try)
  }
  if (-not $ok) {
    Log "curl failed, fallback wrangler get"
    Remove-Item $src -Force -ErrorAction SilentlyContinue
    & $Wrangler r2 object get ("jianxing-files/" + $hd) --remote --file $src
    if ($LASTEXITCODE -ne 0 -or -not (Test-Mp4Ok $src)) { throw "download failed: $hd" }
  }
}

Set-Location $Repo
$catUrl = "https://jianxing.win/api/catalog?lite=1"
$cat = Invoke-RestMethod -Uri $catUrl -TimeoutSec 60
$jobs = @()
foreach ($mod in $cat.modules) {
  foreach ($ch in $mod.chapters) {
    foreach ($les in $ch.lessons) {
      $hd = [string]$les.videoPath
      if (-not $hd) { continue }
      if ($les.videoPathSd) {
        Log "SKIP already has sd: $hd -> $($les.videoPathSd)"
        continue
      }
      $sd = $hd
      if ($sd.ToLower().EndsWith(".mp4")) {
        $sd = $sd.Substring(0, $sd.Length - 4) + "-sd.mp4"
      } else {
        $sd = $sd + "-sd.mp4"
      }
      $jobs += [pscustomobject]@{
        Title = $les.title
        Slug = $les.slug
        Hd = $hd
        Sd = $sd
      }
    }
  }
}

$doneFile = Join-Path $Root "done.tsv"
$doneSlugs = @{}
if (Test-Path $doneFile) {
  Get-Content $doneFile -Encoding UTF8 | ForEach-Object {
    $p = $_.Split("`t")
    if ($p[0]) { $doneSlugs[$p[0]] = $true }
  }
}
$jobs = @($jobs | Where-Object { -not $doneSlugs.ContainsKey($_.Slug) })
Log ("TODO {0} videos" -f $jobs.Count)
$i = 0
foreach ($job in $jobs) {
  $i++
  $safe = ($job.Slug -replace '[^\w\-]', '_')
  $src = Join-Path $SrcDir ($safe + ".mp4")
  $dest = Join-Path $OutDir ($safe + "-sd.mp4")
  Log ("==== [{0}/{1}] {2} ====" -f $i, $jobs.Count, $job.Title)
  Log ("HD $($job.Hd)")
  Log ("SD $($job.Sd)")

  Get-HdVideo $job.Hd $src
  Log ("src size={0:N0}" -f (Get-Item $src).Length)

  if (-not (Test-Path $dest) -or (Get-Item $dest).Length -lt 1000000) {
    Log "transcode 480p + aac128 + faststart..."
    & $Ffmpeg -y -i $src -vf "scale=-2:480" -c:v libx264 -preset veryfast -crf 26 -c:a aac -b:a 128k -ar 44100 -ac 2 -movflags +faststart $dest
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dest)) { throw "ffmpeg failed: $($job.Title)" }
  }
  Log ("sd size={0:N0}" -f (Get-Item $dest).Length)

  Log "upload..."
  & $Wrangler r2 object put ("jianxing-files/" + $job.Sd) --remote --file $dest --ct "video/mp4" --cc "public, max-age=31536000"
  if ($LASTEXITCODE -ne 0) { throw "upload failed: $($job.Sd)" }

  $catFile = Join-Path $Root "catalog.json"
  Log "patch catalog..."
  & $Wrangler r2 object get "jianxing-files/config/catalog.json" --remote --file $catFile
  if ($LASTEXITCODE -ne 0) { throw "get catalog failed" }
  python (Join-Path $Root "patch_catalog.py") $catFile $job.Slug $job.Sd
  if ($LASTEXITCODE -ne 0) { throw "patch catalog failed" }
  & $Wrangler r2 object put "jianxing-files/config/catalog.json" --remote --file $catFile --ct "application/json; charset=utf-8"
  if ($LASTEXITCODE -ne 0) { throw "put catalog failed" }

  $done = Join-Path $Root "done.tsv"
  "{0}`t{1}`t{2}" -f $job.Slug, $job.Hd, $job.Sd | Add-Content -Path $done -Encoding UTF8

  Remove-Item $src -Force -ErrorAction SilentlyContinue
  Remove-Item $dest -Force -ErrorAction SilentlyContinue
  Log "ok, cleaned local files"
}

Log "ALL TRANSCODE/UPLOAD DONE. patch catalog next."
