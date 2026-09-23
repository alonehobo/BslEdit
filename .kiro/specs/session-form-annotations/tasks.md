# Задачи: сессионные аннотации форм

Статус: Ready
Spec-Version: 2
Revision: 2
Spec-Interaction: staged
Approval: user; revision=2; 2026-09-23 — задачи согласованы пользователем
Upstream: design.md@3

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
  - _Verify: из корня репозитория выполнить `npm run test:unit --workspace=1c-form-viewer`; ожидается успешное завершение._
  - _Evidence: native-сервер собран; целевые тесты `answers initialize...` и `keeps several previews...` прошли (2/2). Полный `test:unit`: 25/32, семь существующих несвязанных проверок падают на fixtures/path/presentation-контрактах._

- [ ] 1.2 Добавить пользовательский режим аннотирования
  - _Kind: implementation_
  - _Outcome: В пользовательском превью можно добавить красивую текстовую аннотацию к элементу и удалить её._
  - _Context: [Решение](design.md#implementation); `packages/1c-form-viewer/ui/agent-viewer.js`, функции `renderCurrent`, `findDom`, `loadResolved`; `packages/1c-form-viewer/ui/index.template.html` — заголовок страницы._
  - _Changes: Подключить полную локальную MIT-копию `neat-annotations.css`; добавить кнопку режима; по щелчку запросить непустой текст и отправить аннотацию серверной сессии; отрисовать через безопасный DOM с `textContent`; добавить удаление; при reload убрать подписи. Не менять `1c-preview-core`._
  - _Acceptance: Аннотация указывает на выбранный элемент; HTML показывается буквально; удаление синхронно убирает подпись и запись; вне режима работает обычное выделение._
  - _Requirements: 1.1, 1.2, 1.4, 1.5_
  - _Boundary: Native preview browser UI_
  - _Depends: 1.1_
  - _Files: `packages/1c-form-viewer/ui/index.template.html`; `packages/1c-form-viewer/ui/agent-viewer.js`; `packages/1c-form-viewer/ui/agent-viewer.css`; `packages/1c-form-viewer/ui/neat-annotations.css` (create); `packages/1c-form-viewer/tests/browser.e2e.test.ts`_
  - _Verify: из корня репозитория выполнить `npm test --workspace=1c-form-viewer` и `git diff --check`; ожидается успешное завершение сценария добавления, чтения и удаления без регрессий пакета._
  - _Evidence: pending_

## Implementation Notes

Задача 1.1 реализована и проверена целевыми native-контракт тестами.
