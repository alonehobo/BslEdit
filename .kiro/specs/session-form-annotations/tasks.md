# Задачи: сессионные аннотации форм

Статус: Ready
Spec-Version: 2
Revision: 4
Spec-Interaction: staged
Approval: delegated; revision=4; 2026-09-24 — пользователь поручил поправить спеку и реализовать исправления, затем привести спеку в порядок и коммитить
Upstream: design.md@5

## Реализация

- [x] 1.1 Добавить сессионный контракт аннотаций
  - _Kind: implementation_
  - _Outcome: `PreviewServer::Session` хранит независимый список аннотаций, а `preview(operation="annotations")` возвращает его по `preview_id`._
  - _Context: [Решение](design.md#implementation); `packages/1c-form-viewer/native/mcp-server.cpp`, `PreviewServer::Session`, `McpApp::handle` — существующие сессии и маршрутизация preview._
  - _Changes: Добавить минимальную структуру записи, счётчик и массив в `Session`; HTTP-операции страницы для добавления и удаления; чтение через новую операцию `annotations`; очистку при reload и закрытии сессии. Не создавать отдельное хранилище и не писать файлы._
  - _Acceptance: Две формы имеют независимые списки; видимая страница и MCP читают один список; reload очищает список; прежние операции `preview` сохраняют контракт._
  - _Requirements: 1.3, 1.5_
  - _Boundary: PreviewServer session and MCP contract_
  - _Depends: none_
  - _Files: `packages/1c-form-viewer/native/mcp-server.cpp`; `packages/1c-form-viewer/tests/native-contract.test.ts`_
  - _Verify: из корня репозитория выполнить `npm run test:unit --workspace=1c-form-viewer`; проверить отдельно целевые native-контрактные тесты, если полный набор падает на несвязанных сценариях._
  - _Evidence: native-сервер собран; целевые тесты `answers initialize...` и `keeps several previews...` прошли (2/2). Полный `test:unit`: 25/32, семь существующих несвязанных проверок падают на fixtures/path/presentation-контрактах._

- [x] 1.2 Добавить пользовательский режим аннотирования
  - _Kind: implementation_
  - _Outcome: В пользовательском превью можно добавить красивую текстовую аннотацию к элементу и удалить её._
  - _Context: [Решение](design.md#implementation); `packages/1c-form-viewer/ui/agent-viewer.js`, функции `renderCurrent`, `findDom`, `loadResolved`; `packages/1c-form-viewer/ui/index.template.html` — заголовок страницы._
  - _Changes: Подключить полную локальную MIT-копию `neat-annotations.css`; добавить кнопку режима; по щелчку запросить непустой текст и отправить аннотацию серверной сессии; отрисовать через безопасный DOM с `textContent`; добавить удаление; при reload убрать подписи. Не менять `1c-preview-core`._
  - _Acceptance: Аннотация указывает на выбранный элемент; HTML показывается буквально; удаление синхронно убирает подпись и запись; вне режима работает обычное выделение._
  - _Requirements: 1.1, 1.2, 1.4, 1.5_
  - _Boundary: Native preview browser UI_
  - _Depends: 1.1_
  - _Files: `packages/1c-form-viewer/ui/index.template.html`; `packages/1c-form-viewer/ui/agent-viewer.js`; `packages/1c-form-viewer/ui/agent-viewer.css`; `packages/1c-form-viewer/ui/neat-annotations.css` (create); `packages/1c-form-viewer/tests/browser.e2e.test.ts`_
  - _Verify: из корня репозитория выполнить `npm test --workspace=1c-form-viewer` и `git diff --check`; отдельно подтвердить сценарий аннотаций, если полный пакет падает на несвязанной проверке._
  - _Evidence: `build:assets` прошёл; целевой browser E2E подтвердил добавление, буквальный HTML и удаление, после чего дошёл до существующей несвязанной проверки вертикального скролла spreadsheet._

## Доведение до согласованного поведения

- [x] 2.1 Отделить загрузку документа от аннотаций
  - _Kind: implementation_
  - _Outcome: Native `state.json` возвращает аннотации вместе с документом; общая страница загружает Node-превью и native-превью без обязательного запроса аннотаций._
  - _Requirements: 1.3, 1.7_
  - _Context: [Контракт и жизненный цикл](design.md#lifecycle); `packages/1c-form-viewer/native/mcp-server.cpp`, `PreviewServer::stateJson`; `packages/1c-form-viewer/ui/agent-viewer.js`, `loadRevision`, `renderCurrent`; `packages/1c-form-viewer/src/static-server.ts`, обработчик `state.json` — отсутствие поля у Node._
  - _Changes: Добавить `annotations` в native-снимок; в `loadRevision` использовать это поле для списка и доступности режима. При отсутствии поля не показывать режим аннотирования и завершать загрузку документа. Проверить native- и Node-сценарии отдельно. Сохранить POST/DELETE аннотаций и MCP-чтение native-only; Node-сервер и `1c-preview-core` не менять._
  - _Files: `packages/1c-form-viewer/native/mcp-server.cpp`, `PreviewServer::stateJson`; `packages/1c-form-viewer/ui/agent-viewer.js`, `loadRevision` и показ режима; `packages/1c-form-viewer/tests/native-contract.test.ts`; `packages/1c-form-viewer/tests/annotations.e2e.test.ts` (create); `packages/1c-form-viewer/tests/browser.e2e.test.ts`._
  - _Depends: 1.1, 1.2_
  - _Acceptance: В native-снимке есть актуальный список; Node-снимок без поля открывается и поддерживает навигацию без мока `/annotations`; наличие пустого native-списка не скрывает доступный режим._
  - _Verify: из корня репозитория после сборки assets и native-сервера запустить тест нескольких превью в `native-contract.test.ts` с `NATIVE_MCP_EXE` и `tsx --test packages/1c-form-viewer/tests/annotations.e2e.test.ts` с Edge/Playwright. Проверить native-снимок и загрузку Node-превью без мока `/annotations`._
  - _Evidence: `build:assets` и `tsc --noEmit` прошли; отдельный Edge E2E без мока `/annotations` подтвердил загрузку Node-превью, переключение вкладки, скрытую кнопку и отсутствие запросов `/annotations`. Native-контрактный тест подтвердил пустой и заполненный массив в `state.json`._

- [x] 2.2 Очищать аннотации при повторном открытии файла
  - _Kind: implementation_
  - _Outcome: Повторный `open_preview` того же файла сохраняет `preview_id` и URL, но открывает пустой список аннотаций._
  - _Requirements: 1.5_
  - _Context: [Контракт и жизненный цикл](design.md#lifecycle); `packages/1c-form-viewer/native/mcp-server.cpp`, `PreviewServer::openSession`, `PreviewServer::setDocument`; `packages/1c-form-viewer/tests/native-contract.test.ts`, тест `the native server keeps several previews open`._
  - _Changes: При переиспользовании `Session` в `openSession` очистить список и счётчик аннотаций; сохранить идентификатор и URL, обновить ревизию. Дополнить native-контрактный тест проверкой списка до и после повторного открытия._
  - _Files: `packages/1c-form-viewer/native/mcp-server.cpp`, `PreviewServer::openSession`; `packages/1c-form-viewer/tests/native-contract.test.ts`._
  - _Depends: 1.1_
  - _Acceptance: После добавления аннотации повторное открытие того же файла возвращает прежние `preview_id` и URL и пустой список; соседнее превью не меняется._
  - _Verify: из корня репозитория после сборки native-сервера запустить тест нескольких превью в `native-contract.test.ts` с `NATIVE_MCP_EXE`; проверить очистку, прежние ID/URL и изоляцию соседнего превью._
  - _Evidence: native-сервер собран; целевой тест нескольких превью прошёл: прежние `preview_id`/URL сохранены, список после повторного открытия пуст, счётчик вновь выдал `a1`, соседнее превью не изменилось._

- [x] 2.3 Сохранять метки после переключения вкладок
  - _Kind: implementation_
  - _Outcome: Метки нескольких аннотаций вновь привязываются к элементу после перерисовки вкладки, не меняя DOM формы._
  - _Requirements: 1.2, 1.6_
  - _Context: [Контракт и жизненный цикл](design.md#lifecycle); `packages/1c-form-viewer/ui/agent-viewer.js`, `renderAnnotations`, `updateAnnotationPositions`, `switchTab`, `findDom`; `packages/1c-form-viewer/tests/annotations.e2e.test.ts`, тест переключения вкладок._
  - _Changes: После щелчка пользователя по вкладке и после команды агента повторно находить узел по `elementId` и пересчитывать положение метки; сохранить метки вне DOM формы и несколько записей для одного элемента. Проверить оба пути отдельным browser E2E, не зависящим от spreadsheet scroll. Не менять `1c-preview-core`._
  - _Files: `packages/1c-form-viewer/ui/agent-viewer.js`, `switchTab` и позиционирование меток; `packages/1c-form-viewer/tests/annotations.e2e.test.ts` (create)._
  - _Depends: 1.2_
  - _Acceptance: Щелчок пользователя и команда агента переключают вкладку; при уходе невидимые метки скрыты, после возврата все метки вновь стоят у нужного элемента; обычная навигация сохраняется._
  - _Verify: из корня репозитория после сборки assets запустить `tsx --test packages/1c-form-viewer/tests/annotations.e2e.test.ts` с Edge/Playwright; проверить обе метки после возврата на вкладку независимо от spreadsheet scroll._
  - _Evidence: отдельный Edge E2E прошёл (2/2 сценария файла): две метки скрываются при переходе пользователя и агента на другую вкладку и показываются после возврата; метки остаются вне DOM формы. `1c-preview-core` не менялся._

## Implementation Notes

Задачи 1.1 и 1.2 реализованы. Целевые native-контракт тесты прошли; UI-сценарий аннотаций прошёл внутри существующего browser E2E до его несвязанной проверки spreadsheet scroll.

Ревью-исправление: клиент повторно загружает список при каждой ревизии, отображает несколько комментариев у одного элемента отдельными метками вне DOM формы, пересчитывает их положение при прокрутке и скрывает режим для макетов. Целевой browser E2E проходит все проверки аннотаций, но весь сценарий по-прежнему падает на существующей проверке вертикального скролла spreadsheet (`maxY=0`). `build:assets` и `git diff --check` прошли.

Задачи 2.1–2.3 реализованы и проверены целевыми тестами. Полный `native-contract.test.ts`: 5/7; два падения относятся к прежним проверкам канонизации пути и удаления профиля скрытого браузера. Существующий большой browser E2E после прохождения проверок аннотаций по-прежнему падает на вертикальном скролле spreadsheet (`maxY=0`).

## Исправления по ревью

- [x] 3.1 Сохранять метки изначально неактивной вкладки
  - _Kind: implementation_
  - _Outcome: Аннотация из снимка получает метку и появляется после первого открытия своей вкладки._
  - _Requirements: 1.6_
  - _Context: [Контракт и жизненный цикл](design.md#lifecycle); `agent-viewer.js`, `renderAnnotations` и `updateAnnotationPositions`._
  - _Changes: Создавать метку без текущего DOM-узла и скрывать её до появления элемента; проверить Edge E2E._
  - _Files: `packages/1c-form-viewer/ui/agent-viewer.js`; `packages/1c-form-viewer/tests/annotations.e2e.test.ts`._
  - _Depends: 2.3_
  - _Acceptance: При первом переходе на ранее неактивную вкладку метка становится видимой без reload._
  - _Verify: `tsx --test packages/1c-form-viewer/tests/annotations.e2e.test.ts` после `build:assets`._
  - _Evidence: Edge E2E 4/4: метка изначально скрытой вкладки появилась при первом переходе через `selectElement`; Node-превью без аннотаций, возврат меток и порядок загрузки ревизий также прошли._

- [x] 3.2 Защитить мутации от устаревшего снимка
  - _Kind: implementation_
  - _Outcome: Старый POST и DELETE не изменяют аннотации повторно открытой сессии._
  - _Requirements: 1.4, 1.5_
  - _Context: [Контракт и жизненный цикл](design.md#lifecycle); `PreviewServer::Session`, HTTP-маршрут и `loadRevision`._
  - _Changes: Передавать ревизию в обеих мутациях; сравнивать её с ревизией сессии под той же блокировкой, возвращать 409 без изменения данных. Не применять запоздалый успешный ответ к новому снимку._
  - _Files: `packages/1c-form-viewer/native/mcp-server.cpp`; `packages/1c-form-viewer/ui/agent-viewer.js`; `packages/1c-form-viewer/tests/native-contract.test.ts`._
  - _Depends: 2.1, 2.2_
  - _Acceptance: Устаревшие POST/DELETE дают 409, новый `a1` сохраняется; успешный ответ старой ревизии не меняет новый клиентский список._
  - _Verify: целевой native-контрактный тест с `NATIVE_MCP_EXE` и отдельный Edge E2E._
  - _Evidence: целевой native-контрактный тест прошёл: старые POST и DELETE вернули 409 после повторного открытия, старый POST вернул 409 после reload, новый `a1` сохранился до удаления актуальной ревизией. Edge E2E 4/4 включает управляемый порядок завершения загрузок; `tsc --noEmit` прошёл._

Ревью после 3.1–3.2 выявило два пропущенных пути. `selectElement` теперь
обновляет положение меток после переключения страницы через `highlight`;
Edge E2E проверяет первую активацию скрытой вкладки через `selectElement`.
Асинхронная загрузка снимка сверяет токен перед применением результата;
запоздавшая загрузка не возвращает старые аннотации и ревизию после нового
снимка или reload. Edge E2E с управляемым порядком завершения загрузок
подтвердил это поведение. После исправления `build:assets`, Edge E2E (4/4),
целевой native-контрактный тест и `tsc --noEmit` прошли.
