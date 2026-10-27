$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'package-cpanel.ps1') -Target cloudways
