$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$stage = Join-Path $PSScriptRoot "dist\见行视频助手"
New-Item -ItemType Directory -Force -Path $stage | Out-Null

python -m PyInstaller --noconfirm --clean --windowed --onedir `
  --name "见行视频助手" `
  --version-file ".\file_version.txt" `
  --distpath ".\dist" `
  --workpath ".\build" `
  --specpath "." `
  ".\jx_video_helper.py"

Copy-Item -Force ".\ffmpeg\ffmpeg.exe" (Join-Path $stage "ffmpeg.exe")
Copy-Item -Force ".\ffmpeg\ffprobe.exe" (Join-Path $stage "ffprobe.exe")
Copy-Item -Force ".\使用说明.txt" (Join-Path $stage "使用说明.txt")

$zip = Join-Path $PSScriptRoot "dist\jianxing-video-helper.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip -Force
Write-Output "ZIP $zip $((Get-Item $zip).Length)"
