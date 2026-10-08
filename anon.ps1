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
$keybindingsSrc   = Join-Path (Join-Path $home_ '.claude') 'keybindings.json'
$keybindingsDst   = Join-Path $profileDir 'keybindings.json'
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
    Write-Host "  keybindings.json:    if missing -> копия $keybindingsSrc, иначе штатный шаблон (shift+tab=command:anon, meta+m=cycleMode)"
    Write-Host "  write settings.json: cleanupPeriodDays=0, autoMemoryEnabled=false (merge, без BOM) -> $settingsPath"
    Write-Host "  env:                 $envNames"
    Write-Host "  title:               'Claude Code Anon' (было: '$oldTitle'), восстановление при выходе"
    Write-Host "  run:                 claude --plugin-dir $modDir"
    exit 0
}

New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

# BOM запрещён (Windows-грабли: UTF-8 BOM ломает разбор UTF-8-файлов движком).
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if ((Test-Path -LiteralPath $claudeJsonSrc) -and -not (Test-Path -LiteralPath $claudeJsonDst)) {
    Copy-Item -LiteralPath $claudeJsonSrc -Destination $claudeJsonDst
}
if ((Test-Path -LiteralPath $credentialsSrc) -and -not (Test-Path -LiteralPath $credentialsDst)) {
    Copy-Item -LiteralPath $credentialsSrc -Destination $credentialsDst
}
# Кейбиндинги: Shift+Tab = command:anon, meta+m = родной цикл режимов.
# Биндинг живёт ТОЛЬКО в анон-профиле (CLAUDE_CONFIG_DIR), не в ~/.claude:
# глобальный файл действовал бы во всех сессиях, где мода нет — shift+tab
# сабмитил бы "/anon" и CC отвечал «Unknown command». Если в глобальном
# файле есть свои биндинги — копируем их, иначе пишем штатный шаблон.
# Если missing — не трогаем: правки пользователя в анон-профиле сохраняются.
if (-not (Test-Path -LiteralPath $keybindingsDst)) {
    $keybindingsText = $null
    if (Test-Path -LiteralPath $keybindingsSrc) {
        # Копия содержимого (не файла) — чтобы писать без BOM, чем бы оно ни было в источнике.
        try { $keybindingsText = Get-Content -Raw -Encoding UTF8 -LiteralPath $keybindingsSrc } catch { $keybindingsText = $null }
    }
    if ($null -eq $keybindingsText -or $keybindingsText.Trim() -eq '') {
        $keybindingsText = @"
{
  "`$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "`$docs": "https://code.claude.com/docs/en/keybindings",
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "shift+tab": "command:anon",
        "meta+m": "chat:cycleMode"
      }
    }
  ]
}
"@
    }
    [System.IO.File]::WriteAllText($keybindingsDst, $keybindingsText + "`n", $utf8NoBom)
}

# settings.json: лаунчер владеет двумя ключами, остальное содержимое профиля сохраняем.
$settings   = $null
if (Test-Path -LiteralPath $settingsPath) {
    try { $settings = Get-Content -Raw -Encoding UTF8 -LiteralPath $settingsPath | ConvertFrom-Json } catch { $settings = $null }
}
if ($null -eq $settings -or $settings -isnot [System.Management.Automation.PSCustomObject]) {
    $settings = [pscustomobject]@{}
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