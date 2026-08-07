#Requires -Version 5.1
<#
  见行/净土 R2 一键整桶备份
  - 自动下载便携版 rclone（若本目录没有）
  - 读取 config.ini
  - 同步：课表 config/ + 文字 + 音频 + 视频
#>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ToolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ToolDir

function Pause-Exit([int]$code = 0) {
  Write-Host ''
  Write-Host '按任意键关闭…' -ForegroundColor DarkGray
  $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  exit $code
}

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  R2 整桶备份（课表+文字+音视频）' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

$configPath = Join-Path $ToolDir 'config.ini'
$examplePath = Join-Path $ToolDir 'config.example.ini'
if (-not (Test-Path $configPath)) {
  if (Test-Path $examplePath) { Copy-Item $examplePath $configPath }
  Write-Host '还没有配置。已生成 config.ini，请填写后重新运行。' -ForegroundColor Yellow
  Write-Host "文件位置: $configPath"
  Start-Process notepad.exe $configPath
  Pause-Exit 1
}

function Get-IniValue([string]$text, [string]$key) {
  foreach ($line in ($text -split "`r?`n")) {
    $t = $line.Trim()
    if ($t -match '^\s*#' -or $t -eq '') { continue }
    if ($t -match "^\s*$([regex]::Escape($key))\s*=\s*(.*)$") {
      return $Matches[1].Trim()
    }
  }
  return ''
}

$raw = Get-Content -Path $configPath -Raw -Encoding UTF8
$accountId = Get-IniValue $raw 'account_id'
$accessKey = Get-IniValue $raw 'access_key_id'
$secretKey = Get-IniValue $raw 'secret_access_key'
$bucket = Get-IniValue $raw 'bucket'
$localDir = Get-IniValue $raw 'local_dir'

if (-not $accountId -or -not $accessKey -or -not $secretKey -or -not $bucket -or -not $localDir) {
  Write-Host 'config.ini 里还有空项，请补全后重试。' -ForegroundColor Red
  Start-Process notepad.exe $configPath
  Pause-Exit 1
}

# --- 确保 rclone ---
$rclone = Join-Path $ToolDir 'rclone.exe'
if (-not (Test-Path $rclone)) {
  Write-Host '首次运行：正在下载便携版 rclone…' -ForegroundColor Yellow
  $zip = Join-Path $ToolDir 'rclone-tmp.zip'
  $tmp = Join-Path $ToolDir 'rclone-tmp'
  try {
    $api = Invoke-RestMethod -Uri 'https://api.github.com/repos/rclone/rclone/releases/latest' -Headers @{ 'User-Agent' = 'jianxing-r2-backup' }
    $asset = $api.assets | Where-Object { $_.name -match 'windows-amd64\.zip$' } | Select-Object -First 1
    if (-not $asset) { throw '找不到 windows-amd64 下载地址' }
    Write-Host ("下载: " + $asset.name)
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $found = Get-ChildItem -Path $tmp -Filter rclone.exe -Recurse | Select-Object -First 1
    if (-not $found) { throw '解压后未找到 rclone.exe' }
    Copy-Item $found.FullName $rclone -Force
    Write-Host 'rclone 已就绪。' -ForegroundColor Green
  }
  catch {
    Write-Host ("下载 rclone 失败: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host '也可手动把 rclone.exe 放到本文件夹后再运行。' -ForegroundColor Yellow
    Write-Host 'https://rclone.org/downloads/'
    Pause-Exit 1
  }
  finally {
    if (Test-Path $zip) { Remove-Item $zip -Force -ErrorAction SilentlyContinue }
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

# --- 写临时 rclone.conf（不常驻密钥到用户目录）---
$conf = Join-Path $ToolDir 'rclone.conf'
$endpoint = "https://$accountId.r2.cloudflarestorage.com"
@"
[r2]
type = s3
provider = Cloudflare
access_key_id = $accessKey
secret_access_key = $secretKey
endpoint = $endpoint
acl = private
no_check_bucket = true
"@ | Set-Content -Path $conf -Encoding ASCII

if (-not (Test-Path $localDir)) {
  New-Item -ItemType Directory -Force -Path $localDir | Out-Null
}

Write-Host "桶: $bucket"
Write-Host "本地: $localDir"
Write-Host '开始同步（只下载/更新，不会删你本地多出来的文件用 -- 见下）…'
Write-Host ''

# sync：使本地与远端一致（远端删了，本地也会删）。备份场景更常见用 copy 保本地多份。
# 师兄要的是「云上有的都备份下来」：用 copy 更安全，误删云文件不会清掉本地历史。
$args = @(
  'copy', "r2:$bucket", $localDir,
  '--config', $conf,
  '--progress',
  '--transfers', '4',
  '--checkers', '8'
)

& $rclone @args
$code = $LASTEXITCODE

Write-Host ''
if ($code -eq 0) {
  Write-Host '备份完成。课表(config/) + 文字 + 音频 + 视频应已在本地目录。' -ForegroundColor Green
  Write-Host $localDir
}
else {
  Write-Host ("备份出错，rclone 退出码: $code") -ForegroundColor Red
  Write-Host '请检查 config.ini 的账号 ID、密钥、桶名是否正确。' -ForegroundColor Yellow
}

# 不删除 rclone.conf 方便排错；若担心密钥，可改成每次删
# Remove-Item $conf -Force -ErrorAction SilentlyContinue

Pause-Exit $code
