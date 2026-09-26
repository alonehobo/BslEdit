# 1C Form Viewer для VS Code

> Часть проекта [BSLEdit / BSLView](https://github.com/alonehobo/BslEdit):
> редактор и просмотрщик модулей и форм 1С. Значок «BE» — BSLEdit.

Расширение открывает визуальный preview управляемых форм 1С,
`Template.xml` и текстовых MXL во внутреннем Simple Browser VS Code. Используются
те же renderer-ы, что и в BSLView и `1c-form-viewer`.

Начиная с версии 0.2.0 расширение также содержит MCP-сервер. VS Code
регистрирует его автоматически как `1C Form Viewer`. Агенты, использующие
общий каталог MCP-инструментов VS Code (например, Agent mode в VS Code Chat),
получают `open_preview`, `capture_preview` и `preview` (инспекция, вкладки,
выделение, прокрутка, перечитывание, закрытие и аннотации — пометки
пользователя к элементам и ячейкам, которые агент читает и на которые отвечает)
без отдельной установки MCP-пакета, а
также инструменты макета печатной формы: конвертация из xlsx, разметка, проверка
и правка `Template.xml` (README пакета `1c-form-viewer`, раздел «Макет печатной
формы»). Инструменты правки отключаются настройкой
`1cFormViewer.mcp.templateEditTools`: просмотр, конвертация и проверка остаются.

## Установка

В VS Code откройте Extensions (`Ctrl+Shift+X`), найдите `1C Form Viewer` от
издателя `alonehobo` и нажмите Install. Из командной строки:

```powershell
code --install-extension alonehobo.1c-form-viewer-vscode
```

Для открытого `.xml`, `.mxl` или макета `.mxlx` кнопка `1C Preview` доступна в статус-баре
справа внизу и, если хватает места, в заголовке редактора. Также остаются
Command Palette и контекстное меню файла.

![Кнопка открытия визуального preview формы](images/open-preview-button.png)

## Использование

1. Откройте `.xml`, `.mxl` или `.mxlx` в VS Code.
2. Запустите `1C: Open Visual Preview` через Command Palette или контекстное
   меню файла.
3. Выберите элемент в дереве слева, чтобы подсветить его в макете. Кнопка `☰`
   скрывает и снова показывает панель элементов, когда форме нужна вся ширина.

Preview не изменяет файл. После сохранения или внешнего изменения исходника он
перечитывается автоматически.

## MCP в VS Code Chat

При отправке сообщения в Agent mode VS Code активирует расширение, запускает
встроенный сервер по STDIO и запрашивает у него `initialize` и `tools/list`.
Сервер сообщает агенту, что эти инструменты нужно использовать для
визуального просмотра, навигации, сравнения и создания снимков `Form.xml`,
`Template.xml` и MXL. Пользователю не нужно явно писать имя инструмента:
достаточно, например, попросить «покажи внешний вид этой формы 1С» или
«сравни расположение элементов формы со скриншотом». Вызов `open_preview`
открывает результат во внутреннем Simple Browser этого же окна VS Code.

С `base_path` или `base_revision` (`HEAD`, ветка, коммит, `index`)
`open_preview` показывает сравнение форм, макетов и СКД с навигацией по
изменениям (F7).

Встроенный MCP по умолчанию может читать только поддерживаемые файлы из папок
текущего workspace. Дополнительные каталоги можно перечислить в настройке
`1cFormViewer.mcp.additionalRoots`. Настройка
`1cFormViewer.mcp.allowAnyPath` снимает это ограничение и потому по умолчанию
выключена. Сам сервер можно отключить через `1cFormViewer.mcp.enabled`.

Для проверки регистрации выполните `MCP: List Servers` и выберите
`1C Form Viewer`. При первом запуске VS Code попросит подтвердить доверие к
локальному серверу. Нативная сборка входит в VSIX, отдельные Node.js, npm и
установка пакета `1c-form-viewer` не нужны.

## Подключение к разным агентам

### Почему VSIX недостаточно для каждого агента

Расширение публикует встроенный MCP в общий каталог **самого VS Code**. Этот
каталог автоматически использует VS Code Agent mode / GitHub Copilot. Однако
расширения Codex и Claude Code ведут собственные списки MCP-серверов, а Cursor
использует свой `mcp.json`. Установка одного VSIX поэтому не может автоматически
изменять конфигурацию всех остальных агентов.

Для VS Code Agent достаточно VSIX. Для Codex, Cursor, Claude Code и других
агентов с собственным MCP-каталогом скачайте из того же релиза архив
`1c-form-viewer-native-<версия>-win-x64.zip` и распакуйте его в постоянный
каталог, например `C:\Tools\1c-form-viewer-native`. Не указывайте в настройках
путь внутрь `.vscode\extensions`: после обновления VSIX эта версионная папка
изменится и подключение сломается.

Во всех примерах ниже замените путь к EXE и `C:\Path\To\Workspace` своими
значениями. `--root` безопаснее, чем `--allow-any-path`: сервер сможет читать
поддерживаемые файлы только внутри указанных каталогов. Несколько корней
задаются повторением `--root PATH`.

### VS Code Agent mode / GitHub Copilot

При установке этого VSIX ничего добавлять в конфигурацию не нужно: расширение
активируется после запуска VS Code и публикует встроенный сервер через
MCP-каталог VS Code.

1. Откройте workspace с выгрузкой конфигурации 1С.
2. Выполните **MCP: List Servers** → **1C Form Viewer** и при необходимости
   подтвердите доверие локальному серверу.
3. В окне Chat проверьте через **Configure Tools**, что инструменты
   `open_preview` и `capture_preview` включены.
4. Напишите, например: «Покажи визуальный макет формы “Реализация товаров и
   услуг”. Не открывай XML и не запускай 1С».

Если исходники находятся вне открытого workspace, добавьте их родительский
каталог в настройку VS Code:

```json
{
  "1cFormViewer.mcp.additionalRoots": [
    "D:\\1C\\MyConfiguration"
  ]
}
```

После изменения настройки выполните **MCP: List Servers** →
**1C Form Viewer** → **Restart**. Ручной `.vscode/mcp.json` для этого режима
не нужен. Подробности: [MCP developer guide VS Code](https://code.visualstudio.com/api/extension-guides/ai/mcp).

Если используется отдельный EXE без VSIX, добавьте в
`.vscode/mcp.json`:

```json
{
  "servers": {
    "oneCFormViewer": {
      "type": "stdio",
      "command": "C:\\Tools\\1c-form-viewer-native\\1c-form-viewer.exe",
      "args": [
        "--stdio",
        "--root",
        "C:\\Path\\To\\Workspace"
      ]
    }
  }
}
```

### HTTP-подключение без пути к EXE (Claude Code, Codex, Cursor)

Путь к EXE внутри VSIX содержит версию расширения и меняется после каждого
обновления. Поэтому расширение также публикует тот же MCP-сервер по постоянному
адресу **http://127.0.0.1:47391/mcp** (Streamable HTTP). Достаточно один раз
указать URL:

```powershell
claude mcp add --transport http --scope user one-c-form-viewer http://127.0.0.1:47391/mcp
```

```json
{
  "mcpServers": {
    "one-c-form-viewer": { "type": "http", "url": "http://127.0.0.1:47391/mcp" }
  }
}
```

- Сервер работает, пока открыт VS Code с расширением; порт занимает первое окно.
- Доступ только с loopback, без токена; сервер может читать любые
  поддерживаемые файлы (`--allow-any-path`), поэтому путь к выгрузке задавать
  не нужно.
- Настройки: `1cFormViewer.mcp.http.enabled`, `1cFormViewer.mcp.http.port`.

### Codex IDE extension для VS Code

Регистрация через `vscode.lm.registerMcpServerDefinitionProvider` относится к
каталогу MCP самого VS Code и не добавляет сервер в Codex. Codex IDE extension,
Codex CLI и ChatGPT desktop app используют общую конфигурацию MCP на одном
Codex host.

В расширении Codex откройте меню шестерёнки → **MCP servers** → **Add server**,
выберите **STDIO** и задайте:

- Name: `one_c_form_viewer`
- Command: `C:\Tools\1c-form-viewer-native\1c-form-viewer.exe`
- Arguments: `--stdio`, `--root`, `C:\Path\To\Workspace`

Сохраните сервер и нажмите **Restart extension**.

То же самое можно сделать во встроенном терминале VS Code:

```powershell
codex mcp add one_c_form_viewer -- "C:\Tools\1c-form-viewer-native\1c-form-viewer.exe" --stdio --root "C:\Path\To\Workspace"
```

Эквивалент для `~/.codex/config.toml` или проектного `.codex/config.toml`:

```toml
[mcp_servers.one_c_form_viewer]
command = "C:\\Tools\\1c-form-viewer-native\\1c-form-viewer.exe"
args = ["--stdio", "--root", "C:\\Path\\To\\Workspace"]
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "writes"
```

Проверить подключение можно в **MCP servers**, командой `codex mcp list` или
через `/mcp` в Codex CLI. Официальная инструкция:
[Model Context Protocol в Codex](https://developers.openai.com/codex/mcp/).

### Cursor Agent

Cursor — отдельный редактор, а не расширение VS Code, и каталог MCP VS Code он
не читает. Для личного абсолютного пути рекомендуется глобальный
`~/.cursor/mcp.json`; проектный `.cursor/mcp.json` используйте только если путь
к EXE одинаков и доступен всей команде:

```json
{
  "mcpServers": {
    "oneCFormViewer": {
      "type": "stdio",
      "command": "C:\\Tools\\1c-form-viewer-native\\1c-form-viewer.exe",
      "args": [
        "--stdio",
        "--root",
        "C:\\Path\\To\\Workspace"
      ]
    }
  }
}
```

После сохранения откройте **Cursor Settings → Tools & MCP** и убедитесь, что
сервер включён и его инструменты появились в `Available Tools`. Официальная
инструкция: [Model Context Protocol в Cursor](https://prod.cursor.com/docs/mcp).

### Claude Code extension для VS Code

Claude Code extension использует конфигурацию Claude Code и не наследует
MCP-каталог VS Code. Откройте встроенный терминал VS Code в корне проекта и
добавьте сервер в личный scope текущего проекта:

```powershell
claude mcp add --transport stdio --scope local one-c-form-viewer -- "C:\Tools\1c-form-viewer-native\1c-form-viewer.exe" --stdio --root "C:\Path\To\Workspace"
```

`--scope local` не записывает машинно-зависимый абсолютный путь в Git. Если
сервер и путь подготовлены одинаково для всей команды, можно сознательно
использовать `--scope project`; тогда Claude создаст общий `.mcp.json`.

Проверка в терминале:

```powershell
claude mcp get one-c-form-viewer
claude mcp list
```

В окне Claude Code выполните `/mcp`. Если сервер был добавлен во время уже
открытой сессии, перезапустите сессию или расширение. Официальная инструкция:
[MCP в Claude Code](https://code.claude.com/docs/en/mcp).

### Другие агентские расширения VS Code

Cline, Roo Code и другие расширения могут иметь собственный раздел MCP. Если
сервер `1C Form Viewer` не появился в их списке после установки VSIX, добавьте
standalone EXE как локальный STDIO server по общей схеме:

```json
{
  "mcpServers": {
    "oneCFormViewer": {
      "type": "stdio",
      "command": "C:\\Tools\\1c-form-viewer-native\\1c-form-viewer.exe",
      "args": [
        "--stdio",
        "--root",
        "C:\\Path\\To\\Workspace"
      ]
    }
  }
}
```

Точное имя файла настроек и кнопки перезапуска нужно брать из документации
конкретного агентского расширения. Признак успешного подключения одинаков:
сервер запущен, а в списке доступны `open_preview`, `capture_preview` и
`preview`.

### Диагностика

- `Path is outside the allowed roots` — для встроенного VS Code MCP добавьте
  каталог в `1cFormViewer.mcp.additionalRoots`; для standalone повторите
  `--root` с нужным родительским каталогом.
- Сервер виден, но агент его не вызывает — включите инструменты MCP в tool
  picker и явно попросите «покажи форму визуально, не открывай XML».
- `spawn ... ENOENT` — путь к `1c-form-viewer.exe` неверен либо архив был
  перемещён после настройки.
- После обновления native ZIP заменяйте содержимое постоянного каталога, не
  меняя путь в конфигурации агента.

## Разработка

Из корня репозитория:

```powershell
```

Для локального запуска откройте корень репозитория в VS Code и нажмите `F5`,
выбрав конфигурацию `Run 1C Form Viewer Extension`. Откроется отдельное окно
`Extension Development Host`; в нём запустите `1C: Open Visual Preview`.

Для создания полного комплекта релизных сборок из корня репозитория:

```powershell
$root = "C:\Path\To\bsl-viewer"
Set-Location $root
npm run release -- -ReleaseId v1.3.0
$vsix = Get-Item "$root\releases\Last version\1c-form-viewer-vscode-win32-x64.vsix" -ErrorAction Stop
code --install-extension $vsix.FullName --force
```

Готовые VSIX больше не следует оставлять в корне репозитория или в каталоге
пакета. Версионные файлы лежат в `releases/<release-id>/`, а безномерная копия
последнего успешного комплекта — в `releases/Last version/`.

Сборка ассетов выполняется из корневой папки `web/`:

```powershell
npm run build --workspace=1c-form-viewer-vscode
```
