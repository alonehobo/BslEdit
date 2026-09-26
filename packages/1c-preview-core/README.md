# 1c-preview-core

Общая база всех продуктов репозитория: WLX-плагина Total Commander, BSLEdit,
MCP-сервера `1c-form-viewer` и расширения VS Code. Одни и те же файлы 1С должны
распознаваться и рисоваться одинаково везде — поэтому всё, что это решает,
лежит здесь и нигде больше.

Пакет не публикуется. Он подключается как workspace-зависимость и раскладывается
по потребителям на этапе сборки.

## Что внутри

| Путь | Назначение |
|------|------------|
| `browser/xml-util.js` | Общие XML-хелперы (`XmlUtil`) |
| `browser/form-preview.js` | Разбор и визуальный макет управляемых форм (`Form.xml`) |
| `browser/template-preview.js` | Сетка табличного документа (`Template.xml`) |
| `browser/mxl-preview.js` | Разбор `.mxl` (MXL8) в ту же модель сетки |
| `browser/providers.js` | Реестр форматов: кто claim-ит файл и кто его рисует |
| `browser/form-preview-85.css`, `platform-85-assets.js`, `platform-*.png` | Оформление и картинки интерфейса 8.5 |
| `browser/dcs-preview.js` | Схема компоновки данных (СКД) |
| `browser/metadata-preview.js`, `metadata-relations.js`, `configuration-preview.js` | Объекты метаданных, их связи, конфигурация |
| `browser/proj-form-converter.js`, `proj-metadata-converter.js` | Формат проекта (`Form.form`, `.mxlx`, `.mdo`) в модель выгрузки |
| `browser/*-diff.js`, `*-diff-view.js`, `diff-nav.js` | Сравнение форм, макетов и СКД, общая навигация по изменениям |
| `browser/form-edit.js`, `template-edit.js`, `form-validate.js`, `template-markup.js`, `xlsx-template.js` | Точечная правка, проверка и разметка форм и макетов, конвертация xlsx |
| `browser/session-annotations.js`, `.css` | Аннотации пользователя и агента в превью |
| `layout/` | Модель раскладки фиксированных пар (см. `layout/README.md`) |
| `browser/viewer.css` | Стили превью |
| `browser/icons.svg` | SVG-спрайт иконок оболочки |
| `node/document.cjs` | Кодировки, дескрипторы форм, метаданные объекта |
| `assets.manifest.json` | **Единственный** список ассетов и порядок их загрузки |

## Правило

Копии ядра — в `web/` и в `media/`/`core/` расширения —
**сгенерированные** и в git не хранятся. Правьте оригинал в этом пакете:

```bash
npm run sync
```

```bash
npm run verify
```

и сборку нативного MCP, так что расхождение не доедет до релиза.

## Добавить формат

Одна запись в `browser/providers.js` и, если появился новый файл, одна строка в
`assets.manifest.json`. Больше ничего: ни в одном из трёх хостов нет ни списка
ассетов, ни своей ветки `detect`.
