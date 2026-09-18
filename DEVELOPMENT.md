# Разработка

Документ для тех, кто собирает проект из исходников. Описание возможностей для
пользователей — в [README](README.md) и папке [guide](guide).

## Требования

- Visual Studio 2022 (или Build Tools) с компонентом «Desktop development with C++»
- Windows SDK 10.0
- Node.js LTS — для тестов, сборки MCP и расширения VS Code

Monaco (`web\vs`) и WebView2 SDK (`webview2sdk\`) скачиваются автоматически при
первой сборке (`tools\fetch-monaco.ps1`, `tools\fetch-webview2.ps1`) и в git не
хранятся.

## Сборка

```batch
build.bat
```

Собирает `BSLView.wlx` (32-bit), `BSLView.wlx64` (64-bit), `BSLEdit.exe` и
распакованный нативный MCP в `releases\Last version\MCP\`.

Отдельные продукты:

```powershell
npm run build:mcp      # нативный MCP-сервер
npm run build:vscode   # расширение VS Code
```

## Тесты

```batch
tools\run-tests.bat
```

C++: определение кодировки, побайтовый round-trip при сохранении,
JSON-экранирование.

```bash
npm test
```

JS: рендереры форм и макетов, оболочка просмотрщика, MCP, расширение VS Code.
В конце прогон проверяет, что сгенерированные копии ядра не разошлись с
оригиналом.

## Общее ядро

Рендереры форм и макетов, реестр форматов и чтение файлов 1С лежат в
`packages/1c-preview-core` и используются всеми продуктами. Копии в `web/`,
`packages/1c-form-viewer-vscode/media/` и т. п. генерируются и в git не хранятся —
правьте ядро, а не копию:

```bash
npm run sync     # разложить ядро по продуктам
npm run verify   # проверить, что копии совпадают
```

## Установка локальной сборки в Total Commander

Закройте Total Commander (при выходе он перезаписывает `wincmd.ini`) и выполните:

```powershell
powershell -ExecutionPolicy Bypass -File tools\install-tc.ps1 -TcDir "C:\Path\To\Total Commander"
```

Скрипт копирует плагин с папкой `web`, регистрирует его в `wincmd.ini` без
дублей (с резервной копией `wincmd.ini.bak`) и дописывает в `BSLView.ini` только
отсутствующие ключи. Поднять BSLView выше конкурирующих плагинов:

```powershell
powershell -ExecutionPolicy Bypass -File tools\install-tc.ps1 -TcDir "..." -PromoteBefore "MarkdownView,XMLReview"
```

## Релиз

```powershell
npm run release -- -ReleaseId v2.0.0
```

Собирает и тестирует все продукты. Результат:

- `releases/<release-id>/` — неизменяемый комплект: `BSLView.zip`,
  `BSLEdit.zip`, ZIP нативного MCP, VSIX, `manifest.json`, `SHA256SUMS.txt`;
- `releases/Last version/` — последний успешный комплект с именами без версий;
- `releases/LATEST.txt` — имя последнего комплекта.

`-SkipTests` пропускает тесты (не для официального выпуска), `-Force`
перезаписывает существующий `release-id`.

Версии продуктов:

| Продукт | Где задаётся |
|---|---|
| Нативный MCP | `packages/1c-form-viewer/package.json` |
| Расширение VS Code | `packages/1c-form-viewer-vscode/package.json` |
| Плагин и BSLEdit | номер релиза (тег) |

## Структура

| Путь | Описание |
|---|---|
| `main.cpp` | Точка входа WLX-плагина |
| `bsledit.cpp` | Точка входа BSLEdit |
| `bslcommon.cpp/h` | Чтение и атомарная запись файлов с сохранением кодировки |
| `webview2host.cpp/h` | WebView2: общее окружение, прогретые экземпляры |
| `browserhost.cpp/h`, `bslhighlight.cpp/h` | Fallback через IE и C++ подсветчик |
| `web/` | Интерфейс: Monaco, панель структуры, SARIF |
| `packages/1c-preview-core/` | Общее ядро: формы, макеты, MXL, контекст конфигурации |
| `packages/1c-form-viewer/` | Нативный MCP-сервер (`native/mcp-server.cpp`) |
| `packages/1c-form-viewer-vscode/` | Расширение VS Code |
| `guide/` | Пользовательская документация |
| `tests/`, `tools/` | Тесты, сборка, диагностика |
