# 1C Form Viewer — native MCP

Это самостоятельный Windows MCP-сервер. Других вариантов сервера в проекте нет.

Приложение само читает XML/MXL и поднимает защищённый localhost-сервер. По
умолчанию рендерер работает в скрытом headless Microsoft Edge (или Google Chrome):
окно не появляется, а `preview` (`operation="inspect"`) и `capture_preview`
работают как обычно.
`open_preview` требует `audience`: `user` — пользователь просит показать или
открыть форму, открывается окно на его экране; `agent` — превью нужно только
агенту, рендер скрытый (старый `show: true` равен `audience: "user"`). Скрытый
браузер завершается вместе с сервером и по `preview` с `operation="close"`.

Каждый открытый файл — отдельное превью со своим `previewId` и ссылкой
`http://127.0.0.1:<port>/<token>/<previewId>/index.html`: следующий
`open_preview` не заменяет предыдущие, повторное открытие того же файла
сохраняет ссылку. `preview` принимает `preview_id` (по умолчанию — последнее
использованное превью), `operation="url"` перечисляет все открытые,
`operation="close"` с `preview_id` закрывает одно, без него — все. Скрытый
рендерер держит одну страницу и переходит к превью, которому адресована команда.

```toml
[mcp_servers.one_c_form_viewer_native]
command = "C:\\Tools\\1c-form-viewer-native\\1c-form-viewer.exe"
args = ["--stdio", "--allow-any-path"]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Инструменты макета печатной формы собирают `Template.xml` из `.xlsx`
(`convert_xlsx_to_template`), показывают и проверяют разметку (`list_markup`,
`validate_template`) и правят макет одним инструментом `edit_template` с параметром `operation`.
Флаг `--no-template-edit-tools` скрывает `edit_template`.
Управляемую форму показывают и проверяют `list_form_elements` и `validate_form`,
правит `edit_form` (`set_properties`, `move_element`, `remove_element`); флаг
`--no-form-edit-tools` скрывает `edit_form`;
преобразование выполняет общий JS-код core в той же скрытой странице, а
сервер читает и пишет файлы (только внутри разрешённых корней).

Поддерживаются открытие файла, переключение вкладок формы, инспекция, выделение
элемента, прокрутка и захват PNG. Команды просмотра выполняются JavaScript-кодом
самой открытой страницы через loopback-мост; браузером приложение не управляет.
Descriptor `Forms/ИмяФормы.xml` автоматически открывает фактический макет
`Forms/ИмяФормы/Ext/Form.xml`, если он существует.

Доступ к файлам лучше ограничить:

```toml
args = ["--stdio", "--root", "C:\\Work\\Configuration"]
```

`--allow-any-path` разрешает передавать любые локальные пути, в том числе для
записи инструментами макета.

Если клиент сам открывает возвращаемый `previewUrl`, запуск и скрытого, и
видимого браузера отключается флагом `--no-open-browser`.

Флаги `--open-vscode-browser --vscode-uri-scheme <scheme>` предназначены для
VSIX `1C Form Viewer`: сервер передаёт loopback URL зарегистрированному
URI-handler расширения, а тот открывает страницу во внутреннем Simple Browser.
Standalone-конфигурациям эти флаги добавлять не нужно.
