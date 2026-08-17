$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (Get-Command py -ErrorAction SilentlyContinue) {
  & py -3 ".\build.py"
} else {
  & python ".\build.py"
}
if ($LASTEXITCODE -ne 0) { throw "build.py failed: $LASTEXITCODE" }
