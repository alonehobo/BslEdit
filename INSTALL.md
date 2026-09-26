# Установка BslEdit

Этот файл написан и для людей, и для AI-агентов. Если пользователь дал агенту
ссылку на репозиторий и попросил «установи», агенту достаточно этого файла.

## Быстро

PowerShell, без прав администратора:

```powershell
irm https://raw.githubusercontent.com/alonehobo/BslEdit/main/install.ps1 | iex
```

Скрипт спросит, чем показывать формы, скачает последний релиз, проверит
SHA256, поставит всё в `%LOCALAPPDATA%\Programs\BslEdit` и подключит
MCP-сервер к найденным агентам (Claude Code, Codex, Cursor). Повторный запуск
обновляет установку.

## Инструкция для AI-агента

Выполняй по шагам. Не устанавливай ничего сверх описанного.

1. **Проверь среду.** Нужна Windows 10/11 x64. На Linux/macOS инсталлятора
   нет: используй Node-сервер из
   [packages/1c-form-viewer/README.md](packages/1c-form-viewer/README.md#nodejs-сервер-linux-macos-windows).
2. **Спроси пользователя** (скрипт в неинтерактивном режиме сам не спрашивает):
   - *Как показывать формы, когда просят «покажи форму»?* `Browser` — окно
     Edge/Chrome (по умолчанию); `BSLEdit` — окно редактора BSLEdit, где форму
     можно сразу править.
   - *Ограничить ли доступ сервера папками?* По умолчанию сервер видит только
     рабочую папку, из которой запущен агент (проект). Если пользователь
     назовёт папки с выгрузками конфигураций — передай их в `-Root`.
   Если пользователь просил «просто поставь» — бери значения по умолчанию.
3. **Запусти установщик** неинтерактивно, подставив ответы и своё имя
   агента (`claude`, `codex`, `cursor`; несколько — через запятую):

   ```powershell
   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/alonehobo/BslEdit/main/install.ps1))) -NonInteractive -Viewer Browser -Agents claude
   ```

   С ограничением папок: `-Root 'C:\Work\Conf1','C:\Work\Conf2'`.
   Если скрипт уже лежит в клоне репозитория:
   `& ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 .\install.ps1))) -NonInteractive -Viewer BSLEdit -Agents claude`
   (файл без BOM, поэтому `powershell -File` в Windows PowerShell 5.1 исказит
   русские сообщения; `pwsh -File` работает).
4. **Проверь результат.** Скрипт печатает путь к серверу и итоговую команду MCP.
   - Claude Code: `claude mcp list` — есть `one-c-form-viewer`.
   - Codex: `codex mcp list` — есть `one_c_form_viewer`.
   - Cursor: в `%USERPROFILE%\.cursor\mcp.json` есть `oneCFormViewer`.
   - `"%LOCALAPPDATA%\Programs\BslEdit\mcp\1c-form-viewer.exe" --version` печатает версию.
5. **Скажи пользователю перезапустить агента** — новые MCP-серверы
   подхватываются при старте сессии. После перезапуска можно просить «покажи
   форму …».
6. **Если скрипт упал** — покажи пользователю текст ошибки. Частые причины:
   - «Запущены процессы из папки установки» — попроси пользователя закрыть
     BSLEdit и агентов, которые держат сервер, и повтори. Сам процессы не
     завершай.
   - Нет доступа к `api.github.com` — скачай архивы вручную (раздел ниже).
   - `claude`/`codex` не найден в PATH — подключи вручную по
     [guide/mcp.md](guide/mcp.md#подключение), путь к exe — из вывода скрипта.

Для другого агента (не Claude Code/Codex/Cursor) запусти с `-Agents none` и
подключи STDIO-сервер вручную: команда — путь к `1c-form-viewer.exe`,
аргументы — строка «Команда MCP» из вывода скрипта.

## Параметры install.ps1

| Параметр | Значение |
|---|---|
| `-Viewer Browser\|BSLEdit` | Чем показывать формы пользователю. Без параметра скрипт спрашивает; с `-NonInteractive` — `Browser` |
| `-Agents` | `auto` (по умолчанию — все найденные), `claude`, `codex`, `cursor`, `all`, `none` |
| `-Root <папки>` | Разрешённые папки (`--root`). По умолчанию — рабочая папка агента |
| `-InstallDir <папка>` | Куда ставить, по умолчанию `%LOCALAPPDATA%\Programs\BslEdit` |
| `-Version <тег>` | Конкретный релиз, например `v2.0.0`; по умолчанию последний |
| `-NonInteractive` | Не задавать вопросов |
| `-SkipAgentSetup` | Только скачать и распаковать |
| `-NoRegister` | Не регистрировать протокол `bsledit:` и не создавать ярлык |

## Что делает скрипт

- `mcp\` — MCP-сервер `1c-form-viewer.exe` с папкой `app`.
- `bsledit\` — редактор `BSLEdit.exe`; ярлык в меню «Пуск»;
  `BSLEdit.exe --register-protocol` — эта копия становится основной для
  кнопки «Открыть в BSLEdit» в превью.
- Регистрирует сервер у агентов для всего пользователя:
  - Claude Code: `claude mcp add --scope user one-c-form-viewer -- <exe> --stdio [...]`;
  - Codex: `codex mcp add one_c_form_viewer -- <exe> --stdio [...]`;
  - Cursor: запись `oneCFormViewer` в `~/.cursor/mcp.json` (прежний файл
    сохраняется как `mcp.json.bak`).
- При `-Viewer BSLEdit` добавляет серверу `--editor <путь к BSLEdit.exe>`:
  `open_preview` с `audience="user"` открывает форму в BSLEdit вместо браузера.
  Скрытое превью для самого агента всегда рисуется в браузере, поэтому Edge
  или Chrome нужен в обоих режимах.

Не ставится: плагин Total Commander (`BSLView.zip` — открыть архив в Total
Commander) и расширение VS Code (Marketplace: **1C Form Viewer**). В VS Code
MCP-сервер уже встроен в расширение — ставить его отдельно не нужно.

## Сменить способ показа или обновить

Запусти скрипт снова с нужным `-Viewer` — он перезапишет установку и
регистрацию у агентов.

## Ручная установка

1. Скачай `1c-form-viewer-native-<версия>-win-x64.zip` и `BSLEdit.zip` со
   страницы [Releases](https://github.com/alonehobo/BslEdit/releases), сверь
   SHA256 с `SHA256SUMS.txt`.
2. Распакуй каждый архив целиком в постоянную папку.
3. Подключи сервер по [guide/mcp.md](guide/mcp.md#подключение); для показа в
   BSLEdit добавь аргументы `--editor <путь к BSLEdit.exe>`.

## Удаление

```powershell
claude mcp remove --scope user one-c-form-viewer
codex mcp remove one_c_form_viewer
& "$env:LOCALAPPDATA\Programs\BslEdit\bsledit\BSLEdit.exe" --unregister
Remove-Item -Recurse "$env:LOCALAPPDATA\Programs\BslEdit"
```

Из `~/.cursor/mcp.json` удали запись `oneCFormViewer`.
