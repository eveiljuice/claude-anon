# claude anon — лаунчер полного инкогнито (спека §2.1).
# Поднимает отдельный профиль CLAUDE_CONFIG_DIR, глушит память/телеметрию
# на env-уровне, ставит заголовок окна и запускает claude с модом.
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$home_            = $env:USERPROFILE
$profileDir       = Join-Path $home_ '.claude-anon'
$claudeJsonSrc    = Join-Path $home_ '.claude.json'
$claudeJsonDst    = Join-Path $profileDir '.claude.json'
$credentialsSrc   = Join-Path (Join-Path $home_ '.claude') '.credentials.json'
$credentialsDst   = Join-Path $profileDir '.credentials.json'
$settingsPath     = Join-Path $profileDir 'settings.json'
$modDir           = Join-Path (Join-Path $PSScriptRoot 'mod') 'claude-anon'

$envNames = @(
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_ANON',
    'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
    'CLAUDE_CODE_DISABLE_CLAUDE_MDS',
    'DISABLE_TELEMETRY',
    'DISABLE_ERROR_REPORTING',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'CLAUDE_BRAND'
)

$oldTitle = $Host.UI.RawUI.WindowTitle

if ($DryRun) {
    Write-Host "claude anon (DryRun) — что было бы сделано:"
    Write-Host "  mkdir if missing:    $profileDir"
    Write-Host "  copy if missing:     $claudeJsonSrc -> $claudeJsonDst"
    Write-Host "  copy if missing:     $credentialsSrc -> $credentialsDst"
    Write-Host "  write settings.json: cleanupPeriodDays=0, autoMemoryEnabled=false (merge, без BOM) -> $settingsPath"
    Write-Host "  env:                 $envNames"
    Write-Host "  title:               'Claude Code Anon' (было: '$oldTitle'), восстановление при выходе"
    Write-Host "  run:                 claude --plugin-dir $modDir"
    exit 0
}

New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

if ((Test-Path -LiteralPath $claudeJsonSrc) -and -not (Test-Path -LiteralPath $claudeJsonDst)) {
    Copy-Item -LiteralPath $claudeJsonSrc -Destination $claudeJsonDst
}
if ((Test-Path -LiteralPath $credentialsSrc) -and -not (Test-Path -LiteralPath $credentialsDst)) {
    Copy-Item -LiteralPath $credentialsSrc -Destination $credentialsDst
}

# settings.json: лаунчер владеет двумя ключами, остальное содержимое профиля сохраняем.
# BOM запрещён (Windows-грабли: UTF-8 BOM ломает разбор UTF-8-файлов движком).
$utf8NoBom  = New-Object System.Text.UTF8Encoding($false)
$settings   = $null
if (Test-Path -LiteralPath $settingsPath) {
    try { $settings = Get-Content -Raw -Encoding UTF8 -LiteralPath $settingsPath | ConvertFrom-Json } catch { $settings = $null }
}
if ($null -eq $settings -or $settings -isnot [System.Management.Automation.PSCustomObject]) {
    $settings = New-Object System.Management.Automation.PSCustomObject
}
$settings | Add-Member -NotePropertyName cleanupPeriodDays -NotePropertyValue 0 -Force
$settings | Add-Member -NotePropertyName autoMemoryEnabled -NotePropertyValue $false -Force
$settingsText = $settings | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($settingsPath, $settingsText + "`n", $utf8NoBom)

$env:CLAUDE_CONFIG_DIR = $profileDir
$env:CLAUDE_ANON = '1'
$env:CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
$env:CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1'
$env:DISABLE_TELEMETRY = '1'
$env:DISABLE_ERROR_REPORTING = '1'
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
$env:CLAUDE_BRAND = 'Claude Anon'

$Host.UI.RawUI.WindowTitle = 'Claude Code Anon'

try {
    & claude --plugin-dir $modDir @args
    if ($LASTEXITCODE -ne 0) {
        Write-Host "claude завершился с кодом $LASTEXITCODE" -ForegroundColor Yellow
    }
}
finally {
    $Host.UI.RawUI.WindowTitle = $oldTitle
    foreach ($name in $envNames) {
        Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
}