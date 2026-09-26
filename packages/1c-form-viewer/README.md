# 1C Form Viewer — native MCP

Самостоятельный MCP-сервер для Windows x64. Он визуально открывает
управляемые формы 1С, `Template.xml` и MXL без установки 1С, Node.js или npm,
а также собирает макет печатной формы из `.xlsx`.

Сервер поставляется как архив `1c-form-viewer-native-<версия>-win-x64.zip`.
`1c-form-viewer.exe` самодостаточен: интерфейс и renderer-ы лежат внутри него,
рядом ничего держать не нужно. При первом запуске он распаковывает их в
`%LOCALAPPDATA%\1c-form-viewer`; ключ `--assets DIR` подменяет их рабочей копией.

## Возможности

- `open_preview(path)` открывает `Form.xml`, `Template.xml` или MXL. Путь к
  descriptor `Forms/ИмяФормы.xml` автоматически преобразуется во вложенный
  `Forms/ИмяФормы/Ext/Form.xml`.
- `capture_preview()` возвращает PNG видимой области, документа или элемента.
- `preview(operation, …)` — работа с открытым превью одним инструментом:
  `inspect` (элементы, страницы, вкладки и области прокрутки), `switch_tab`,
  `select`, `scroll`, `reload`, `url` (адрес для клиента со своим браузером) и
  `close`.
- Во внутреннем браузерном режиме панель элементов скрывается и возвращается
  кнопкой `☰` в заголовке preview.

Инструменты просмотра не изменяют исходные файлы; пишут только инструменты
правки макета из раздела ниже. По умолчанию разрешайте только нужный каталог
через `--root`; `--allow-any-path` следует использовать лишь осознанно. В ответе
`open_preview` доступны исходный `requestedPath`, фактический `resolvedPath`,
`previewUrl` и тип документа `kind`; XML-код в результат инструмента не
возвращается.

## Макет печатной формы

Агент собирает и правит `Ext/Template.xml` и сразу видит результат: после каждой
правки открытый preview обновляется, `capture_preview()` снимает его, области
видны на полях, параметры — как `<Имя>`.

**Всегда доступны**

- `convert_xlsx_to_template(xlsx_path, output_path)` — макет из `.xlsx`: текст,
  шрифты, цвета, заливка, рамки, выравнивание, ширины колонок (как при импорте
  платформой), высоты строк, объединения, стили колонок и строк, числовые форматы
  и форматы дат, колонтитулы, параметры страницы и область печати, картинки с
  привязкой к ячейкам. Именованный диапазон Excel становится областью, ячейка ровно
  `[Имя]` — параметром, текст с `[Имя]` внутри — шаблоном. Сводка перечисляет
  то, что не перенесено (формулы — только значения, фигуры и диаграммы, условное
  форматирование, сквозные строки печати).
- `list_markup(path)` — области сверху вниз с их параметрами, пересечения
  `Строки|Колонки` для `ПолучитьОбласть`, параметры расшифровки, имена внутри
  шаблонов, параметры печати и колонтитулы.
- `validate_template(path)` — ссылки на форматы, шрифты, линии и картинки,
  ячейки и объединения за границами, области и их имена, область печати.

**Правка — один инструмент `edit_template(path, operation, …)`** (отключается флагом
`--no-template-edit-tools`):

| operation | Что делает |
|---|---|
| `set_area` | Добавляет, заменяет или удаляет именованную область |
| `set_parameter` | Ячейка — параметр, шаблон или текст; параметр расшифровки |
| `set_format` | Шрифт, выравнивание, размещение, отступ, цвета, рамки, формат данных, защита для диапазона |
| `insert_rows`, `delete_rows`, `insert_columns`, `delete_columns` | Вставка и удаление со сдвигом объединений, областей и рисунков |
| `merge_cells` | Объединение и разъединение ячеек |
| `set_size` | Ширины колонок (в единицах макета) и высоты строк (в пунктах, 0 — авто) |
| `set_print_settings` | Ориентация, масштаб, «вписать в страницу», бумага, поля в мм, область печати |
| `set_header_footer` | Колонтитулы: тексты слотов (`[&НомерСтраницы]` и др.) и шрифт |

Одна схема вместо восьми отдельных инструментов занимает меньше контекста агента и отключается одной
галочкой в клиенте.

Строки и колонки нумеруются с 1, как в preview и конфигураторе. Файлы пишутся
только внутри разрешённых корней, через временный файл; конвертер заменяет
существующий макет лишь с `overwrite: true`. Правки меняют только нужные
элементы: остальной XML, порядок элементов и переводы строк сохраняются.

`--no-template-edit-tools` оставляет агенту просмотр, конвертацию из xlsx,
`list_markup` и `validate_template`, а `edit_template` не попадает в список и
инструкции сервера — для тех, кто правит макеты другими средствами (например,
скиллами DSL) и не хочет занимать ими контекст агента.

## Управляемая форма

Агент правит `Ext/Form.xml` точечно: меняются только затронутые узлы, остальной
файл (BOM, CRLF, табуляция, порядок атрибутов) остаётся байт в байт. Путь можно
передать и на описатель `Forms/ИмяФормы.xml`. Открытый preview обновляется.

**Всегда доступны**

- `list_form_elements(path)` — дерево элементов: имя, вид, родитель, путь к данным.
- `validate_form(path)` — уникальность id, companion-узлы (контекстное меню,
  расширенная подсказка, панели таблицы), пути к данным и реквизиты, команды
  кнопок, обработчики событий, основной реквизит, версия формата.

**Правка — `edit_form(path, operation, …)`** (отключается флагом `--no-form-edit-tools`):

| operation | Что делает |
|---|---|
| `set_properties` | Свойства элемента или формы по именам узлов XML (`Title`, `Visible`, `Width`, `HorizontalStretch`, `TitleLocation`, `Group`…); многоязычные — строкой (ru) или `{ru, en}`; `null` — вернуть к умолчанию. Значения перечислений проверяются, новый узел встаёт в порядке схемы. Цвет — `style:Имя`, `web:Имя`, `win:Имя` или `#RRGGBB`; шрифт — `{ref: "style:Имя"}` либо `{face, height, bold, italic, underline, strikeout, scale}`; картинка — `CommonPicture.Имя` или `StdPicture.Имя` |
| `add_element` | Новый элемент: `element`, `kind`, `into` и/или `after`/`before`, `properties`. Companion-узлы (контекстное меню, расширенная подсказка, панели таблицы) и id создаются сами |
| `move_element` | Перенос в группу, страницу, таблицу, командную панель или форму; `after`/`before` — место среди соседей |
| `remove_element` | Удаление вместе с companion-узлами и вложенными элементами; отказ, если на элемент ссылаются стандартные команды или условное оформление (`force: true` — удалить всё равно) |

| `set_attribute` | Реквизит формы: `name`, `type` (`string`, `string(100)`, `string(1,fixed)`, `boolean`, `number(15,2)`, `number(15,2,nonnegative)`, `date`, `dateTime`, `time`, `CatalogRef.Имя`, `DocumentObject.Имя`, `EnumRef.Имя`, `DefinedType.Имя`, `ValueTable`, составной через `\|`, либо готовое имя с префиксом), `title`, `main`, `saved_data`, `fill_check`, `columns` (колонки реквизита-таблицы: `[{name, type, title, remove}]`, id нумеруются внутри реквизита); `remove: true` удаляет |
| `set_command` | Команда формы: `name`, `action` (имя процедуры модуля), `title`, `tooltip`, `shortcut`, `representation`, `modifies_saved_data`, `current_row_use`; `remove: true` удаляет |

Удаление реквизита или команды отклоняется, пока на них ссылается путь к данным
или кнопка (`force: true` — удалить всё равно). Квалификаторы типа, порядок узлов
и место секций сняты с рабочей конфигурации (130 932 реквизита, 58 471 команда).

Не правятся: список выбора (значения произвольных типов 1С), таблицы ролей и
функциональных опций, а также модуль формы (`Module.bsl`) — процедуры-обработчики
и `Элементы.<Имя>` в коде остаются на пользователе.

Модель элементов (companion-узлы, допустимые вложения, проверки) перенесена из
навыков [cc-1c-skills](https://github.com/Nikolay-Shirokov/cc-1c-skills) (MIT).

Словарь свойств (вид значения, допустимые константы, порядок узлов по схеме)
производен от продуктов 1С, поэтому в репозиторий не выкладывается и собирается
локально. Без него `edit_form` работает, но значения и имена свойств не
проверяются, а новый узел ставится перед companion-узлами, а не строго по схеме.

## Node.js-сервер (Linux, macOS, Windows)

Рядом с нативным exe есть кроссплатформенный Node.js-вариант того же сервера:
те же десять инструментов, тот же stdio-протокол и те же схемы. Нужен Node.js
20+ и Chromium.

```bash
npm install
npm run start:node --workspace=1c-form-viewer -- --stdio --root /path/to/workspace
```

`start:node` собирает ассеты (`build:assets`) и компилирует сервер в `dist/`;
далее сервер можно запускать напрямую: `node dist/mcp-server.js --stdio --root …`.
На Linux и macOS рендеринг идёт через Chromium из playwright-core — один раз
выполните `npx playwright-core install chromium-headless-shell` (на чистом
Linux также `npx playwright-core install-deps chromium`, либо поставьте
системный Chromium и укажите его в `ONE_C_FORM_VIEWER_CHROMIUM`). На Windows

Отличия от нативного сервера: окно `audience="user"` открывается командой
платформы (`xdg-open`, `open`, `start`) в браузере по умолчанию, а не в
BSLEdit; все превью живут в одном headless-браузере, каждое в своём контексте;
трансформы (list/validate/edit форм и макетов, конвертация xlsx) выполняются в
процессе сервера, без страницы браузера; запись файла не проверяет, открыт ли
он в BSLEdit; `base_revision` читает версию из git через `git` из `PATH`, а не
через код BSLEdit.

Схемы инструментов Node-сервер берёт у нативного: `src/tool-schemas.ts`
генерируется из `native/mcp-server.cpp` командой
пока они расходятся. После правки схем нативного сервера запускайте генератор.

## Подключение

В примерах сервер распакован в `C:\Tools\1c-form-viewer-native`, а файлы 1С
находятся в `C:\Path\To\Workspace`.

### Codex

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
```

### VS Code Agent mode / GitHub Copilot

Расширение `1C Form Viewer` регистрирует встроенный EXE автоматически. Для
встроенного сервера `open_preview` открывает форму во внутреннем Simple Browser
VS Code. Для
отдельно распакованного сервера используйте `.vscode/mcp.json`:

```json
{
  "servers": {
    "oneCFormViewer": {
      "type": "stdio",
      "command": "C:\\Tools\\1c-form-viewer-native\\1c-form-viewer.exe",
      "args": ["--stdio", "--root", "C:\\Path\\To\\Workspace"]
    }
  }
}
```

### Cursor

Добавьте в проектный `.cursor/mcp.json` или глобальный `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "oneCFormViewer": {
      "type": "stdio",
      "command": "C:\\Tools\\1c-form-viewer-native\\1c-form-viewer.exe",
      "args": ["--stdio", "--root", "C:\\Path\\To\\Workspace"]
    }
  }
}
```

### Claude Code

```powershell
claude mcp add --transport stdio --scope local one-c-form-viewer -- "C:\Tools\1c-form-viewer-native\1c-form-viewer.exe" --stdio --root "C:\Path\To\Workspace"
```

Проверка: `claude mcp get one-c-form-viewer` или `claude mcp list`.

## Сборка

```powershell
npm run build:native --workspace=1c-form-viewer
```

Сборка создаёт `artifacts/1c-form-viewer-native-win-x64` и используется при
упаковке VS Code-расширения. Устанавливаемого npm MCP-пакета нет: Node.js-вариант
сервера (см. «Node.js-сервер» выше) запускается из рабочей копии репозитория.

Исходник сервера: `native/mcp-server.cpp`. Web-интерфейс собирается из общего
`1c-preview-core` и файлов `ui/`.
