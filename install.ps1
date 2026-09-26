<#
.SYNOPSIS
    Устанавливает последний релиз BslEdit (MCP-сервер 1C Form Viewer и BSLEdit)
    в папку пользователя и подключает MCP-сервер к AI-агентам.

.DESCRIPTION
    Скачивает с GitHub Releases архивы 1c-form-viewer-native-*-win-x64.zip и
    BSLEdit.zip, проверяет SHA256, распаковывает в
    %LOCALAPPDATA%\Programs\BslEdit, регистрирует протокол bsledit: и
    подключает MCP-сервер к Claude Code, Codex и Cursor (к тем, что найдены).
    Права администратора не нужны. Повторный запуск обновляет установку.

    Без -Viewer скрипт спрашивает, чем показывать формы пользователю:
      Browser — окно Edge/Chrome;
      BSLEdit — окно редактора BSLEdit (ключ --editor MCP-сервера).

.EXAMPLE
    irm https://raw.githubusercontent.com/alonehobo/BslEdit/main/install.ps1 | iex

.EXAMPLE
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/alonehobo/BslEdit/main/install.ps1))) -Viewer BSLEdit -Agents claude -NonInteractive
#>
[CmdletBinding()]
param(
    # Чем открывать формы для пользователя: Browser или BSLEdit.
    [string]$Viewer,
    # Каким агентам подключить MCP: claude, codex, cursor, all, none. По умолчанию — всем найденным.
    [string[]]$Agents = @('auto'),
    # Разрешённые папки (--root). По умолчанию — рабочая папка агента, в которой он запущен.
    [string[]]$Root = @(),
    # Куда ставить.
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\BslEdit'),
    # Тег релиза, например v2.0.0. По умолчанию — последний.
    [string]$Version = 'latest',
    # Не задавать вопросов (для агентов и автоматизации). Без -Viewer выбирается Browser.
    [switch]$NonInteractive,
    # Не трогать настройки агентов, только скачать и распаковать.
    [switch]$SkipAgentSetup,
    # Не регистрировать протокол bsledit: и не создавать ярлык (портативная копия).
    [switch]$NoRegister
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = 'alonehobo/BslEdit'
$ServerName = 'one-c-form-viewer'
$CodexServerName = 'one_c_form_viewer'

function Write-Step([string]$text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Note([string]$text) { Write-Host "    $text" }
function Write-Warn([string]$text) { Write-Host "    ! $text" -ForegroundColor Yellow }

if ($env:OS -ne 'Windows_NT') { throw 'Установщик рассчитан на Windows. На Linux/macOS используйте Node-сервер: packages/1c-form-viewer/README.md.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Нужна 64-битная Windows.' }

# --- Выбор способа показа -----------------------------------------------------
if ($Viewer -and @('Browser', 'BSLEdit') -notcontains $Viewer) { throw "-Viewer: ожидается Browser или BSLEdit, получено '$Viewer'" }
if ($Viewer) { $Viewer = @('Browser', 'BSLEdit') | Where-Object { $_ -eq $Viewer } }
if (-not $Viewer) {
    if ($NonInteractive) {
        $Viewer = 'Browser'
    } else {
        Write-Host ''
        Write-Host 'Как показывать формы 1С, когда вы просите агента «покажи форму»?'
        Write-Host '  1) В окне браузера (Edge/Chrome)'
        Write-Host '  2) В редакторе BSLEdit'
        $answer = Read-Host 'Ваш выбор [1]'
        $Viewer = if ($answer -match '^\s*(2|b|bsl)') { 'BSLEdit' } else { 'Browser' }
    }
}
Write-Step "Способ показа: $Viewer"

# --- Релиз -------------------------------------------------------------------
$headers = @{ 'User-Agent' = 'BslEdit-installer'; 'Accept' = 'application/vnd.github+json' }
$apiUrl = if ($Version -eq 'latest') { "https://api.github.com/repos/$Repo/releases/latest" } else { "https://api.github.com/repos/$Repo/releases/tags/$Version" }
Write-Step "Ищу релиз ($Version)"
$release = Invoke-RestMethod -Uri $apiUrl -Headers $headers
Write-Note "$($release.name) ($($release.tag_name))"

function Get-Asset([string]$pattern) {
    $asset = $release.assets | Where-Object { $_.name -like $pattern } | Select-Object -First 1
    if (-not $asset) { throw "В релизе $($release.tag_name) нет файла $pattern" }
    return $asset
}
$mcpAsset = Get-Asset '1c-form-viewer-native-*-win-x64.zip'
$editorAsset = Get-Asset 'BSLEdit.zip'
$sumsAsset = $release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' } | Select-Object -First 1

$temp = Join-Path ([IO.Path]::GetTempPath()) ("bsledit-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null

try {
    $sums = @{}
    if ($sumsAsset) {
        $sumsFile = Join-Path $temp 'SHA256SUMS.txt'
        Invoke-WebRequest -Uri $sumsAsset.browser_download_url -OutFile $sumsFile -Headers $headers -UseBasicParsing
        foreach ($line in Get-Content $sumsFile) {
            if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') { $sums[$Matches[2].Trim()] = $Matches[1].ToLower() }
        }
    } else {
        Write-Warn 'SHA256SUMS.txt не найден в релизе — контрольные суммы не проверяются.'
    }

    function Get-VerifiedArchive($asset) {
        $file = Join-Path $temp $asset.name
        Write-Step "Скачиваю $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) МБ)"
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $file -Headers $headers -UseBasicParsing
        if ($sums.ContainsKey($asset.name)) {
            $actual = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLower()
            if ($actual -ne $sums[$asset.name]) { throw "Контрольная сумма $($asset.name) не совпадает" }
            Write-Note 'SHA256 совпадает'
        }
        return $file
    }
    $mcpZip = Get-VerifiedArchive $mcpAsset
    $editorZip = Get-VerifiedArchive $editorAsset

    # --- Распаковка ----------------------------------------------------------
    $mcpDir = Join-Path $InstallDir 'mcp'
    $editorDir = Join-Path $InstallDir 'bsledit'
    $mcpExe = Join-Path $mcpDir '1c-form-viewer.exe'
    $editorExe = Join-Path $editorDir 'BSLEdit.exe'

    $running = Get-Process -Name '1c-form-viewer', 'BSLEdit' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) }
    if ($running) {
        $list = ($running | ForEach-Object { "$($_.Name) (PID $($_.Id))" }) -join ', '
        throw "Запущены процессы из папки установки: $list. Закройте BSLEdit и агентов (Claude Code, Codex, Cursor, VS Code) и повторите."
    }

    function Expand-Clean([string]$zip, [string]$target) {
        $staging = "$target.new"
        if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
        Expand-Archive -Path $zip -DestinationPath $staging -Force
        if (Test-Path $target) { Remove-Item -Recurse -Force $target }
        Move-Item $staging $target
    }
    Write-Step "Устанавливаю в $InstallDir"
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Expand-Clean $mcpZip $mcpDir
    Expand-Clean $editorZip $editorDir
    if (-not (Test-Path $mcpExe)) { throw "После распаковки нет $mcpExe" }
    if (-not (Test-Path $editorExe)) { throw "После распаковки нет $editorExe" }
    $serverVersion = (& $mcpExe --version 2>$null | Select-Object -First 1)
    Write-Note "MCP-сервер: $serverVersion"
    Set-Content -Path (Join-Path $InstallDir 'VERSION.txt') -Value $release.tag_name -Encoding UTF8
} finally {
    Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
}

# --- Протокол bsledit: и ярлык ------------------------------------------------
if (-not $NoRegister) {
Write-Step 'Регистрирую BSLEdit (протокол bsledit:, кнопка «Открыть в BSLEdit»)'
$proc = Start-Process -FilePath $editorExe -ArgumentList '--register-protocol' -PassThru -Wait -WindowStyle Hidden
if ($proc.ExitCode -ne 0) { Write-Warn "BSLEdit --register-protocol вернул код $($proc.ExitCode)" }

try {
    $programs = [Environment]::GetFolderPath('Programs')
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut((Join-Path $programs 'BSLEdit.lnk'))
    $lnk.TargetPath = $editorExe
    $lnk.WorkingDirectory = $editorDir
    $lnk.Save()
    Write-Note 'Ярлык BSLEdit добавлен в меню «Пуск»'
} catch { Write-Warn "Ярлык не создан: $($_.Exception.Message)" }
}

# --- Аргументы MCP-сервера ----------------------------------------------------
$serverArgs = @('--stdio')
foreach ($r in $Root) { $serverArgs += @('--root', [IO.Path]::GetFullPath($r)) }
if ($Viewer -eq 'BSLEdit') { $serverArgs += @('--editor', $editorExe) }

# --- Подключение к агентам ----------------------------------------------------
$configured = @()
if (-not $SkipAgentSetup) {
    $wanted = @($Agents | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
    $cursorDir = Join-Path $env:USERPROFILE '.cursor'
    function Test-Agent([string]$name) {
        if ($wanted -contains 'none') { return $false }
        if ($wanted -contains $name -or $wanted -contains 'all') { return $true }
        if ($wanted -notcontains 'auto') { return $false }
        switch ($name) {
            'claude' { return [bool](Get-Command claude -ErrorAction SilentlyContinue) }
            'codex'  { return [bool](Get-Command codex -ErrorAction SilentlyContinue) }
            'cursor' { return (Test-Path $cursorDir) }
        }
    }

    if (Test-Agent 'claude') {
        Write-Step 'Claude Code'
        if (Get-Command claude -ErrorAction SilentlyContinue) {
            & claude mcp remove --scope user $ServerName *> $null
            & claude mcp add --transport stdio --scope user $ServerName -- $mcpExe @serverArgs
            if ($LASTEXITCODE -eq 0) { $configured += 'Claude Code'; Write-Note "сервер $ServerName добавлен (scope user)" }
            else { Write-Warn 'claude mcp add завершился с ошибкой' }
        } else { Write-Warn 'команда claude не найдена в PATH' }
    }

    if (Test-Agent 'codex') {
        Write-Step 'Codex'
        if (Get-Command codex -ErrorAction SilentlyContinue) {
            & codex mcp remove $CodexServerName *> $null
            & codex mcp add $CodexServerName -- $mcpExe @serverArgs
            if ($LASTEXITCODE -eq 0) { $configured += 'Codex'; Write-Note "сервер $CodexServerName добавлен" }
            else { Write-Warn 'codex mcp add завершился с ошибкой' }
        } else { Write-Warn 'команда codex не найдена в PATH' }
    }

    if (Test-Agent 'cursor') {
        Write-Step 'Cursor'
        New-Item -ItemType Directory -Force -Path $cursorDir | Out-Null
        $cursorConfig = Join-Path $cursorDir 'mcp.json'
        $config = $null
        if (Test-Path $cursorConfig) {
            $raw = Get-Content -Raw -Path $cursorConfig
            if ($raw.Trim()) { $config = $raw | ConvertFrom-Json }
            Copy-Item $cursorConfig "$cursorConfig.bak" -Force
        }
        if (-not $config) { $config = New-Object PSObject }
        if (-not $config.PSObject.Properties['mcpServers']) { $config | Add-Member -NotePropertyName mcpServers -NotePropertyValue (New-Object PSObject) }
        $entry = [pscustomobject]@{ type = 'stdio'; command = $mcpExe; args = $serverArgs }
        if ($config.mcpServers.PSObject.Properties['oneCFormViewer']) { $config.mcpServers.oneCFormViewer = $entry }
        else { $config.mcpServers | Add-Member -NotePropertyName oneCFormViewer -NotePropertyValue $entry }
        $json = $config | ConvertTo-Json -Depth 20
        [IO.File]::WriteAllText($cursorConfig, $json, (New-Object Text.UTF8Encoding($false)))
        $configured += 'Cursor'
        Write-Note "обновлён $cursorConfig (копия: mcp.json.bak)"
    }
}

# --- Итог ---------------------------------------------------------------------
Write-Host ''
Write-Host "Готово: $($release.tag_name) установлен в $InstallDir" -ForegroundColor Green
Write-Note "MCP-сервер: $mcpExe"
Write-Note "BSLEdit:    $editorExe"
Write-Note "Показ форм: $Viewer"
$quotedArgs = ($serverArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
Write-Note ('Команда MCP: "' + $mcpExe + '" ' + $quotedArgs)
if ($configured.Count) { Write-Note ("Подключено к: " + ($configured -join ', ') + '. Перезапустите агента.') }
elseif (-not $SkipAgentSetup) { Write-Warn 'Ни один агент не настроен — подключите вручную: guide/mcp.md#подключение' }
if (-not (Get-Command msedge -ErrorAction SilentlyContinue) -and -not (Test-Path "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") -and -not (Test-Path "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")) {
    Write-Warn 'Microsoft Edge не найден: MCP-серверу нужен Edge или Chrome.'
}
