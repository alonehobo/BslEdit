/* DOM helpers shared by the XML-backed previews (form-preview, template-preview).
 *
 * 1C dumps use namespace prefixes inconsistently between Designer and project-format exports, so
 * every lookup goes through localName() rather than tagName. Load this before
 * the preview modules. */
(function (root) {
'use strict';

/* Tag name without its namespace prefix. */
function localName(el) {
    if (!el) return '';
    var n = el.localName || el.tagName || '';
    var i = n.indexOf(':');
    return i >= 0 ? n.slice(i + 1) : n;
}

/* Direct children named `tag`, prefix-insensitive. */
function namedChildren(parent, tag) {
    var out = [];
    if (!parent) return out;
    var kids = parent.children || [];
    for (var i = 0; i < kids.length; i++) {
        if (localName(kids[i]) === tag) out.push(kids[i]);
    }
    return out;
}

function firstChild(parent, tag) {
    var list = namedChildren(parent, tag);
    return list.length ? list[0] : null;
}

/* Collapsed text: for captions, names and other single-line values. */
function textOf(el) {
    if (!el) return '';
    return String(el.textContent || '').replace(/\s+/g, ' ').trim();
}

/* Text with line breaks kept: template cells may hold multi-line content. */
function rawText(el) {
    if (!el) return '';
    return String(el.textContent || '').replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
}

/* v8:LocalStringType — <item><lang/><content/></item> repeated per language.
 * Picks the UI language, then Russian, then whatever came first. `read` selects
 * the text extractor: collapsed for captions, raw for template cells. */
function localizedFrom(el, read) {
    if (!el) return '';
    read = read || textOf;
    var items = [];
    var localized = false;
    function walk(node) {
        if (!node || !node.children) return;
        for (var i = 0; i < node.children.length; i++) {
            var c = node.children[i];
            if (localName(c) === 'item') {
                localized = true;
                var lang = '', content = '';
                for (var j = 0; j < c.children.length; j++) {
                    var p = c.children[j];
                    var pn = localName(p);
                    if (pn === 'lang') lang = textOf(p);
                    else if (pn === 'content') content = read(p);
                }
                if (content) items.push({ lang: lang, content: content });
            } else {
                walk(c);
            }
        }
    }
    walk(el);
    /* Items with empty content only: the text is empty, not the glued
     * language codes ("ruen") that reading the whole element would give. */
    if (!items.length) return localized ? '' : read(el);
    var want = '';
    try { want = String((navigator && navigator.language) || '').toLowerCase(); } catch (e) { want = ''; }
    var base = want.split('-')[0];
    for (var i = 0; i < items.length; i++) {
        var lg = String(items[i].lang || '').toLowerCase();
        if (lg === want || lg === 'ru' || (base && lg.split('-')[0] === base)) return items[i].content;
    }
    return items[0].content;
}

/* ------------------------------------------------------------ platform terms
 *
 * 1C writes metadata references, standard commands, type names, style items
 * and enumeration values in English even in a Russian configuration. Every
 * inspector, tooltip and tree shows them the way the Russian Designer does,
 * and they all ask here: a viewer that kept its own partial list used to leak
 * whatever that list missed (Catalog.X.Command.Y, «Search string addition»).
 * A viewer's own dictionary still wins; these are the common fallback. */

var MD_CLASSES = {
    Catalog: 'Справочник', Document: 'Документ', DocumentJournal: 'ЖурналДокументов', Enum: 'Перечисление',
    Report: 'Отчет', DataProcessor: 'Обработка', ChartOfCharacteristicTypes: 'ПланВидовХарактеристик',
    ChartOfAccounts: 'ПланСчетов', ChartOfCalculationTypes: 'ПланВидовРасчета',
    InformationRegister: 'РегистрСведений', AccumulationRegister: 'РегистрНакопления',
    AccountingRegister: 'РегистрБухгалтерии', CalculationRegister: 'РегистрРасчета',
    BusinessProcess: 'БизнесПроцесс', Task: 'Задача', ExchangePlan: 'ПланОбмена', Constant: 'Константа',
    CommonForm: 'ОбщаяФорма', CommonCommand: 'ОбщаяКоманда', CommandGroup: 'ГруппаКоманд',
    CommonModule: 'ОбщийМодуль', CommonAttribute: 'ОбщийРеквизит', CommonTemplate: 'ОбщийМакет',
    CommonPicture: 'ОбщаяКартинка', SessionParameter: 'ПараметрСеанса', Role: 'Роль', Subsystem: 'Подсистема',
    FunctionalOption: 'ФункциональнаяОпция', FunctionalOptionsParameter: 'ПараметрФункциональныхОпций',
    DefinedType: 'ОпределяемыйТип', FilterCriterion: 'КритерийОтбора', SettingsStorage: 'ХранилищеНастроек',
    EventSubscription: 'ПодпискаНаСобытие', ScheduledJob: 'РегламентноеЗадание', StyleItem: 'ЭлементСтиля',
    Style: 'Стиль', Language: 'Язык', XDTOPackage: 'ПакетXDTO', WebService: 'WebСервис',
    HTTPService: 'HTTPСервис', WSReference: 'WSСсылка', Sequence: 'Последовательность',
    DocumentNumerator: 'НумераторДокументов', ExternalDataSource: 'ВнешнийИсточникДанных',
    IntegrationService: 'СервисИнтеграции', Bot: 'Бот', Interface: 'Интерфейс', Configuration: 'Конфигурация',
    ExternalDataProcessor: 'ВнешняяОбработка', ExternalReport: 'ВнешнийОтчет',
    WebSocketClient: 'WebSocketКлиент', PaletteColor: 'ЦветПалитры'
};

/* Segments between the names of a metadata path. */
var MD_PARTS = {
    Attribute: 'Реквизит', TabularSection: 'ТабличнаяЧасть', Form: 'Форма', Command: 'Команда',
    StandardCommand: 'СтандартнаяКоманда', Template: 'Макет', EnumValue: 'ЗначениеПеречисления',
    Dimension: 'Измерение', Resource: 'Ресурс', StandardAttribute: 'СтандартныйРеквизит',
    StandardTabularSection: 'СтандартнаяТабличнаяЧасть', AccountingFlag: 'ПризнакУчета',
    ExtDimensionAccountingFlag: 'ПризнакУчетаСубконто', AddressingAttribute: 'РеквизитАдресации',
    Column: 'Графа', Recalculation: 'Перерасчет', Operation: 'Операция', Parameter: 'Параметр',
    URLTemplate: 'ШаблонURL', Method: 'Метод', Item: 'Элемент', Characteristic: 'Характеристика',
    Predefined: 'Предопределенный', Subsystem: 'Подсистема'
};
/* Parts that are a value rather than a kind followed by a name. */
var MD_TAILS = { EmptyRef: 'ПустаяСсылка' };

var STD_ATTRIBUTES = {
    Description: 'Наименование', Code: 'Код', Number: 'Номер', Date: 'Дата', Ref: 'Ссылка',
    Owner: 'Владелец', Parent: 'Родитель', Posted: 'Проведен', DeletionMark: 'ПометкаУдаления',
    Period: 'Период', Recorder: 'Регистратор', LineNumber: 'НомерСтроки', Active: 'Активность',
    IsFolder: 'ЭтоГруппа', Predefined: 'Предопределенный', PredefinedDataName: 'ИмяПредопределенныхДанных',
    Order: 'Порядок', RecordType: 'ВидДвижения', Type: 'ТипЗначения', ValueType: 'ТипЗначения',
    ThisNode: 'ЭтотУзел', SentNo: 'НомерОтправленного', ReceivedNo: 'НомерПринятого',
    ExchangeDate: 'ДатаОбмена', Started: 'Стартован', Completed: 'Завершен', HeadTask: 'ВедущаяЗадача',
    Executed: 'Выполнена', BusinessProcess: 'БизнесПроцесс', RoutePoint: 'ТочкаМаршрута',
    CalculationType: 'ВидРасчета', Account: 'Счет', OffBalance: 'Забалансовый',
    ExtDimensionType: 'ВидСубконто', TurnoversOnly: 'ТолькоОбороты', ReversingEntry: 'Сторно',
    RegistrationPeriod: 'ПериодРегистрации', PeriodAdjustment: 'ПериодКорректировки',
    ActionPeriod: 'ПериодДействия', ActionPeriodIsBasic: 'ПериодДействияБазовый',
    BegOfActionPeriod: 'ПериодДействияНачало', EndOfActionPeriod: 'ПериодДействияКонец',
    BegOfBasePeriod: 'БазовыйПериодНачало', EndOfBasePeriod: 'БазовыйПериодКонец',
    ExtDimension: 'Субконто', AccountDr: 'СчетДт', AccountCr: 'СчетКт', Kind: 'Вид', Value: 'Значение',
    Key: 'Ключ', Presentation: 'Представление'
};

/* Words of a form's data paths besides attribute names: Items.Список.CurrentData.Ref. */
var PATH_WORDS = {
    Items: 'Элементы', CurrentData: 'ТекущиеДанные', CurrentRow: 'ТекущаяСтрока', RegisterRecords: 'Движения',
    DefaultPicture: 'СтандартнаяКартинка', RowsPicture: 'КартинкаСтрок', SelectedRows: 'ВыделенныеСтроки',
    CurrentItem: 'ТекущийЭлемент', SettingsComposer: 'КомпоновщикНастроек', RowsCount: 'КоличествоСтрок',
    Settings: 'Настройки', UserSettings: 'ПользовательскиеНастройки', FixedSettings: 'ФиксированныеНастройки',
    Filter: 'Отбор', ConditionalAppearance: 'УсловноеОформление', Selection: 'Выбор', Structure: 'Структура',
    DataParameters: 'ПараметрыДанных', OutputParameters: 'ПараметрыВывода'
};

/* Standard command captions (the platform's own, as the command bar shows them). */
var STD_COMMANDS = {
    Abort: 'Прервать', Activate: 'Активировать', Add: 'Добавить', AddAutoGroupField: 'Новое авто поле',
    AddFilterItem: 'Добавить новый элемент', AddFilterItemGroup: 'Добавить новую группу',
    AddGroupField: 'Новое поле', AddMultiple: 'Добавить несколько', AddOrderItem: 'Добавить новый элемент порядка',
    AddSelectedField: 'Добавить новое поле', AlignBottom: 'Вниз', AlignCenter: 'По центру',
    AlignJustify: 'По ширине', AlignLeft: 'Влево', AlignMiddle: 'По середине', AlignRight: 'Вправо',
    AlignTop: 'Вверх', Back: 'Назад', BackColor: 'Цвет фона', Begin: 'К началу', Bold: 'Полужирный',
    BorderAll: 'Граница везде', BorderBottom: 'Граница снизу', BorderColor: 'Цвет границы',
    BorderInside: 'Граница внутри', BorderLeft: 'Граница слева', BorderNone: 'Нет границы',
    BorderOutline: 'Граница вокруг', BorderRight: 'Граница справа', BorderTop: 'Граница сверху',
    BulletedList: 'Маркированный список', Cancel: 'Отмена', CancelEdit: 'Отменить редактирование',
    CancelSearch: 'Отменить поиск', Change: 'Изменить', ChangeHistory: 'История изменений',
    ChangeSettingsStructure: 'Изменить состав настроек', ChangeVariant: 'Изменить вариант',
    CheckAll: 'Установить пометки', Choose: 'Выбрать', ChooseAll: 'Выбрать все', ClearAll: 'Очистить все',
    ClearContent: 'Очистить содержимое', Close: 'Закрыть', CollapseAllGroups: 'Свернуть все группы',
    CompactViewMode: 'Компактный режим просмотра', Copy: 'Скопировать', CopyToClipboard: 'Копировать',
    Create: 'Создать', CreateBasedOn: 'Создать на основании', CreateByParameter: 'Создать по параметру', CreateFolder: 'Создать группу',
    CreateListItem: 'Создать элемент списка', CustomizeForm: 'Изменить форму', CutToClipboard: 'Вырезать',
    DecreaseFontSize: 'Уменьшить размер шрифта', DecreaseIndent: 'Уменьшить отступ', Delete: 'Удалить',
    DeleteColumns: 'Удалить колонки', DeleteRows: 'Удалить строки', Detailed: 'Подробно',
    DynamicListStandardSettings: 'Стандартные настройки', Edit: 'Редактирование', End: 'К концу',
    EndEdit: 'Завершить редактирование', Execute: 'Выполнить', ExecuteAndClose: 'Выполнить и закрыть',
    Expand: 'Развернуть', ExpandAllGroups: 'Развернуть все группы', Filter: 'Отбор', Find: 'Найти',
    FindByCurrentValue: 'Найти по текущему значению', FindInList: 'Найти в списке', FindNext: 'Найти следующий',
    FindPrevious: 'Найти предыдущий', FixTable: 'Зафиксировать таблицу', Font: 'Шрифт', Forward: 'Вперед',
    Generate: 'Сформировать', GetURL: 'Получить ссылку', GoBack: 'Назад', GoForward: 'Вперед', Group: 'Сгруппировать',
    GroupFilterItems: 'Сгруппировать условия', Help: 'Справка', HierarchicalList: 'Иерархический список',
    Hyperlink: 'Вставить гиперссылку', Ignore: 'Пропустить', IncreaseFontSize: 'Увеличить размер шрифта',
    IncreaseIndent: 'Увеличить отступ', InputOnBasis: 'Ввести на основании',
    InsertColumnsLeft: 'Вставить колонки слева', InsertColumnsRight: 'Вставить колонки справа',
    InsertRowsBottom: 'Вставить строки снизу', InsertRowsTop: 'Вставить строки сверху', Italic: 'Курсив',
    LevelDown: 'Уровень вниз', LevelUp: 'Уровень вверх', LineSpacing: 'Междустрочный интервал', List: 'Список',
    ListSettings: 'Настроить список', LoadDynamicListSettings: 'Загрузить настройки',
    LoadReportSettings: 'Загрузить настройки', LoadSettings: 'Загрузить настройки', LoadVariant: 'Выбрать вариант',
    Merge: 'Объединить', MoveDown: 'Переместить вниз', MoveItem: 'Переместить в группу', MoveUp: 'Переместить вверх',
    NewWindow: 'Новое окно', No: 'Нет', NumberedList: 'Нумерованный список', OK: 'ОК', Open: 'Открыть',
    OpenList: 'Открыть список', OutputList: 'Вывести список', PageSetup: 'Параметры страницы',
    PasteFromClipboard: 'Вставить', Pickup: 'Подбор', Picture: 'Вставить картинку', Post: 'Провести',
    PostAndClose: 'Провести и закрыть', Preview: 'Предварительный просмотр', Print: 'Печать',
    PrintImmediately: 'Печать сразу', Properties: 'Свойства', Redo: 'Вернуть', Refresh: 'Обновить',
    ReportSettings: 'Настройки', Reread: 'Перечитать', RestoreValues: 'Восстановить значения', Retry: 'Повторить',
    Save: 'Сохранить', SaveAs: 'Сохранить как', SaveDynamicListSettings: 'Сохранить настройки',
    SaveReportSettings: 'Сохранить настройки', SaveSettings: 'Сохранить настройки', SaveValues: 'Сохранить значения',
    SaveVariant: 'Сохранить вариант', SearchEverywhere: 'Найти везде', SearchHistory: 'История поиска',
    SelectAll: 'Выделить все', SetDateInterval: 'Установить период', SetDeletionMark: 'Пометить на удаление',
    ShowGroups: 'Отображать группы', ShowInList: 'Показать в списке', ShowMultipleSelection: 'Выбрать несколько',
    ShowRowRearrangement: 'Переставить строки', SortListAsc: 'Сортировать по возрастанию',
    SortListDesc: 'Сортировать по убыванию', StandardSettings: 'Стандартные настройки', Start: 'Старт',
    StartAndClose: 'Стартовать и закрыть', Strikeout: 'Перечеркивание', SwitchActivity: 'Переключить активность',
    TextColor: 'Цвет текста', ThickBorderBottom: 'Толстая граница снизу', ThickBorderOutline: 'Толстая граница вокруг',
    ThickBorderTop: 'Толстая граница сверху', Today: 'Сегодня', Tree: 'Дерево', TurnUseOff: 'Выключить все',
    TurnUseOn: 'Включить все', UncheckAll: 'Снять пометки', Underline: 'Подчеркивание', Undo: 'Отменить',
    UndoPosting: 'Отмена проведения', Ungroup: 'Разгруппировать', UnselectAll: 'Снять выделение',
    UseFieldAsValue: 'Использовать в качестве значения поле',
    UserSettingItemProperties: 'Свойства элемента пользовательских настроек', UserSettings: 'Пользовательские настройки',
    Write: 'Записать', WriteAndClose: 'Записать и закрыть', WriteChanges: 'Записать изменения', Yes: 'Да'
};
/* Identifiers the Designer spells differently from the caption run together. */
var STD_COMMAND_IDENTS = {
    SetDeletionMark: 'УстановитьПометкуУдаления', CopyToClipboard: 'КопироватьВБуферОбмена',
    CancelEdit: 'ОтменитьРедактирование', Help: 'Справка', PrintImmediately: 'ПечатьСразу',
    DynamicListStandardSettings: 'СтандартныеНастройкиДинамическогоСписка'
};

/* Type names outside the configuration (cfg:*Ref.X is composed below). */
var TYPES = {
    DynamicList: 'ДинамическийСписок', SpreadsheetDocument: 'ТабличныйДокумент', TextDocument: 'ТекстовыйДокумент',
    ValueListType: 'СписокЗначений', ValueList: 'СписокЗначений', ValueTable: 'ТаблицаЗначений',
    ValueTree: 'ДеревоЗначений', TypeDescription: 'ОписаниеТипов', StandardPeriod: 'СтандартныйПериод',
    StandardBeginningDate: 'СтандартнаяДатаНачала', SettingsComposer: 'КомпоновщикНастроек',
    FormattedDocument: 'ФорматированныйДокумент', FormattedString: 'ФорматированнаяСтрока',
    FixedArray: 'ФиксированныйМассив', FixedStructure: 'ФиксированнаяСтруктура', FixedMap: 'ФиксированноеСоответствие',
    Array: 'Массив', Structure: 'Структура', Map: 'Соответствие', AnyRef: 'ЛюбаяСсылка', AnyIBRef: 'ЛюбаяСсылка',
    ConstantsSet: 'НаборКонстант', GanttChart: 'ДиаграммаГанта', Chart: 'Диаграмма', Dendrogram: 'Дендрограмма',
    GraphicalSchema: 'ГрафическаяСхема', FlowchartContextType: 'ТипКонтекстаГрафическойСхемы',
    GeographicalSchema: 'ГеографическаяСхема', PDFDocument: 'PDFДокумент', HTMLDocument: 'HTMLДокумент',
    Planner: 'Планировщик', Color: 'Цвет', Font: 'Шрифт', Picture: 'Картинка', Border: 'Рамка',
    Line: 'Линия', ValueStorage: 'ХранилищеЗначения', BinaryData: 'ДвоичныеДанные', UUID: 'УникальныйИдентификатор',
    Null: 'Null', UndefinedValue: 'Неопределено', Type: 'Тип', string: 'Строка', decimal: 'Число',
    boolean: 'Булево', dateTime: 'Дата', base64Binary: 'ДвоичныеДанные', ChartOfCharacteristicTypesCharacteristic: 'Характеристика',
    Characteristic: 'Характеристика', DataCompositionSettings: 'НастройкиКомпоновкиДанных',
    DataCompositionSchema: 'СхемаКомпоновкиДанных', ReportBuilder: 'ПостроительОтчета', Query: 'Запрос',
    UserSettingsGroup: 'ГруппаПользовательскихНастроек', FormChoiceListDesTimeValue: 'Значение',
    DesignTimeRef: 'Ссылка'
};
/* cfg: types are an object class run together with its role: CatalogRef,
 * InformationRegisterRecordSet. Longer roles first. */
var TYPE_ROLES = [
    ['RoutePointRef', 'ТочкаМаршрутаСсылка'], ['TabularSectionRow', 'СтрокаТабличнойЧасти'],
    ['RecordManager', 'МенеджерЗаписи'], ['RecordSet', 'НаборЗаписей'], ['RecordKey', 'КлючЗаписи'],
    ['TabularSection', 'ТабличнаяЧасть'], ['ValueManager', 'МенеджерЗначения'], ['Manager', 'Менеджер'],
    ['Selection', 'Выборка'], ['Object', 'Объект'], ['List', 'Список'], ['Ref', 'Ссылка']
];

/* Style items the platform predefines; one written by the configuration keeps its own name. */
var STYLE_ITEMS = {
    AccentColor: 'ЦветАкцента', ActivityColor: 'ЦветАктивности', AuxiliaryNavigationColor: 'ЦветДополнительнойНавигации',
    BorderColor: 'ЦветРамки', ButtonBackColor: 'ЦветФонаКнопки', ButtonBorderColor: 'ЦветРамкиКнопки',
    ButtonTextColor: 'ЦветТекстаКнопки', FieldAlternativeBackColor: 'АльтернативныйЦветФонаПоля',
    FieldBackColor: 'ЦветФонаПоля', FieldSelectedTextColor: 'ЦветТекстаВыделенияПоля',
    FieldSelectionBackColor: 'ЦветФонаВыделенияПоля', FieldTextColor: 'ЦветТекстаПоля', FormBackColor: 'ЦветФонаФормы',
    FormTextColor: 'ЦветТекстаФормы', ImportantColor: 'ЦветВажного', NavigationColor: 'ЦветНавигации',
    NegativeTextColor: 'ЦветОтрицательногоЧисла', ReportHeaderBackColor: 'ЦветФонаШапкиОтчета',
    ReportLineColor: 'ЦветЛинииОтчета', SpecialTextColor: 'ЦветОсобогоТекста', TableFooterBackColor: 'ЦветФонаПодвалаТаблицы',
    TableFooterTextColor: 'ЦветТекстаПодвалаТаблицы', TableHeaderBackColor: 'ЦветФонаШапкиТаблицы',
    TableHeaderTextColor: 'ЦветТекстаШапкиТаблицы', ToolTipBackColor: 'ЦветФонаПодсказки', ToolTipTextColor: 'ЦветТекстаПодсказки',
    ExtraLargeTextFont: 'ОченьКрупныйШрифтТекста', LargeTextFont: 'КрупныйШрифтТекста', NormalTextFont: 'ОбычныйШрифтТекста',
    SmallTextFont: 'МелкийШрифтТекста', TextFont: 'ШрифтТекста', ControlBorder: 'РамкаЭлементаУправления',
    /* sys: fonts and win: colors of the operating system. */
    ANSIFixedFont: 'ANSIШрифтМоноширинный', ANSIVariableFont: 'ANSIШрифтПропорциональный',
    DefaultGUIFont: 'ШрифтДиалоговИМеню', OEMFixedFont: 'OEMШрифтМоноширинный', SystemFont: 'СистемныйШрифт',
    ActiveBorder: 'ГраницаАктивногоОкна', ActiveTitleBar: 'ЗаголовокАктивногоОкна',
    ActiveTitleBarText: 'ТекстЗаголовкаАктивногоОкна', ApplicationWorkspace: 'РабочаяОбластьПриложения',
    ButtonDarkShadow: 'ТеньКнопкиТемная', ButtonFace: 'Кнопка', ButtonHighlight: 'КнопкаПодсвеченная',
    ButtonLightShadow: 'ТеньКнопкиСветлая', ButtonShadow: 'ТеньКнопки', ButtonText: 'ТекстКнопки', Desktop: 'РабочийСтол',
    DisabledText: 'ТекстНедоступный', Highlight: 'Подсвеченный', HighlightText: 'ТекстПодсвеченный',
    InactiveBorder: 'ГраницаНеактивногоОкна', InactiveTitleBar: 'ЗаголовокНеактивногоОкна',
    InactiveTitleBarText: 'ТекстЗаголовкаНеактивногоОкна', MenuBar: 'СтрокаМеню', MenuItemText: 'ТекстПунктаМеню',
    ScrollBar: 'ПолосаПрокрутки', ToolTip: 'Подсказка', ToolTipText: 'ТекстПодсказки', WindowBackground: 'ФонОкна',
    WindowFrame: 'РамкаОкна', WindowText: 'ТекстОкна'
};
var WEB_COLORS = {
    AliceBlue: 'АкварельноСиний', AntiqueWhite: 'АнтикБелый', Aqua: 'ЦианАкварельный', Aquamarine: 'Аквамарин',
    Azure: 'Лазурный', Beige: 'Бежевый', Bisque: 'СветлоКоричневый', Black: 'Черный', BlanchedAlmond: 'БледноМиндальный',
    Blue: 'Синий', BlueViolet: 'СинеФиолетовый', Brown: 'Коричневый', BurlyWood: 'Древесный', CadetBlue: 'СероСиний',
    Chartreuse: 'ЗеленоватоЖелтый', Chocolate: 'Шоколадный', Coral: 'Коралловый', CornFlowerBlue: 'Васильковый',
    CornSilk: 'ШелковыйОттенок', Cream: 'Кремовый', Crimson: 'Малиновый', Cyan: 'Циан', DarkBlue: 'ТемноСиний',
    DarkCyan: 'ЦианТемный', DarkGoldenRod: 'ТемноЗолотистый', DarkGray: 'ТемноСерый', DarkGreen: 'ТемноЗеленый',
    DarkKhaki: 'ХакиТемный', DarkMagenta: 'ФуксинТемный', DarkOliveGreen: 'ТемноОливковоЗеленый',
    DarkOrange: 'ТемноОранжевый', DarkOrchid: 'ОрхидеяТемный', DarkRed: 'ТемноКрасный', DarkSalmon: 'ЛососьТемный',
    DarkSeaGreen: 'ЦветМорскойВолныТемный', DarkSlateBlue: 'ТемноГрифельноСиний', DarkSlateGray: 'ТемноГрифельноСерый',
    DarkTurquoise: 'ТемноБирюзовый', DarkViolet: 'ТемноФиолетовый', DeepPink: 'НасыщенноРозовый',
    DeepSkyBlue: 'НасыщенноНебесноГолубой', DimGray: 'ТусклоСерый', DodgerBlue: 'СинеСерый', FireBrick: 'Кирпичный',
    FloralWhite: 'ЦветокБелый', ForestGreen: 'ЗеленыйЛес', Fuchsia: 'Фуксия', Gainsboro: 'СеребристоСерый',
    GhostWhite: 'ПризрачноБелый', Gold: 'Золотой', Goldenrod: 'Золотистый', Gray: 'Серый', Green: 'Зеленый',
    GreenYellow: 'ЗеленоЖелтый', HoneyDew: 'Роса', HotPink: 'ТеплоРозовый', IndianRed: 'Киноварь', Indigo: 'Индиго',
    Ivory: 'СлоноваяКость', Khaki: 'Хаки', Lavender: 'БледноЛиловый', LavenderBlush: 'ГолубойСКраснымОттенком',
    LawnGreen: 'ЗеленаяЛужайка', LemonChiffon: 'Лимонный', LightBlue: 'Голубой', LightCoral: 'СветлоКоралловый',
    LightCyan: 'ЦианСветлый', LightGoldenRod: 'СветлоЗолотистый', LightGoldenRodYellow: 'СветлоЖелтыйЗолотистый',
    LightGray: 'СветлоСерый', LightGreen: 'СветлоЗеленый', LightPink: 'СветлоРозовый', LightSalmon: 'ЛососьСветлый',
    LightSeaGreen: 'ЦветМорскойВолныСветлый', LightSkyBlue: 'СветлоНебесноГолубой', LightSlateBlue: 'СветлоГрифельноСиний',
    LightSlateGray: 'СветлоГрифельноСерый', LightSteelBlue: 'ГолубойСоСтальнымОттенком', LightYellow: 'СветлоЖелтый',
    Lime: 'ЗеленоватоЛимонный', LimeGreen: 'ЛимонноЗеленый', Linen: 'Льняной', Magenta: 'Фуксин', Maroon: 'ТемноБордовый',
    MediumAquaMarine: 'НейтральноАквамариновый', MediumBlue: 'НейтральноСиний', MediumGray: 'НейтральноСерый',
    MediumGreen: 'НейтральноЗеленый', MediumOrchid: 'ОрхидеяНейтральный', MediumPurple: 'НейтральноПурпурный',
    MediumSeaGreen: 'ЦветМорскойВолныНейтральный', MediumSlateBlue: 'НейтральноГрифельноСиний',
    MediumSpringGreen: 'НейтральноВесеннеЗеленый', MediumTurquoise: 'НейтральноБирюзовый',
    MediumVioletRed: 'НейтральноФиолетовоКрасный', MidnightBlue: 'ПолночноСиний', MintCream: 'МятныйКрем',
    MistyRose: 'ТусклоРозовый', Moccasin: 'ЗамшаСветлый', NavajoWhite: 'НавахоБелый', Navy: 'Ультрамарин',
    OldLace: 'СтароеКружево', Olive: 'Оливковый', Olivedrab: 'ТусклоОливковый', Orange: 'Оранжевый',
    OrangeRed: 'ОранжевоКрасный', Orchid: 'Орхидея', PaleGoldenrod: 'БледноЗолотистый', PaleGreen: 'БледноЗеленый',
    PaleTurquoise: 'БледноБирюзовый', PaleVioletRed: 'БледноКрасноФиолетовый', PapayaWhip: 'ТопленоеМолоко',
    PeachPuff: 'Персиковый', Peru: 'НейтральноКоричневый', Pink: 'Розовый', Plum: 'Сливовый',
    PowderBlue: 'СинийСПороховымОттенком', Purple: 'Пурпурный', Red: 'Красный', RosyBrown: 'РозовоКоричневый',
    RoyalBlue: 'КоролевскиГолубой', SaddleBrown: 'КожаноКоричневый', Salmon: 'Лосось', SandyBrown: 'ПесочноКоричневый',
    Seagreen: 'ЦветМорскойВолны', SeaShell: 'Перламутровый', Sienna: 'Охра', Silver: 'Серебряный',
    SkyBlue: 'НебесноГолубой', SlateBlue: 'ГрифельноСиний', SlateGray: 'ГрифельноСерый', Snow: 'Белоснежный',
    SpringGreen: 'ВесеннеЗеленый', SteelBlue: 'СинийСоСтальнымОттенком', Tan: 'РыжеватоКоричневый',
    Teal: 'ЦианНейтральный', Thistle: 'БледноСиреневый', Tomato: 'Томатный', Turquoise: 'Бирюзовый',
    Violet: 'Фиолетовый', VioletRed: 'КрасноФиолетовый', Wheat: 'Пшеничный', White: 'Белый',
    WhiteSmoke: 'ДымчатоБелый', Yellow: 'Желтый', YellowGreen: 'ЖелтоЗеленый'
};
var COLOR_PREFIXES = { style: '', sys: '', win: 'ЦветаWindows.', web: 'WebЦвета.' };

/* Enumeration values the viewers' own per-property lists do not cover,
 * written as the Russian identifier (shown split into words). A value that
 * means different things under different properties goes into VALUES_BY_KEY. */
var VALUES = {
    /* Standard command groups and command group categories. */
    NavigationPanelImportant: 'ПанельНавигации.Важное', NavigationPanelOrdinary: 'ПанельНавигации.Обычное',
    NavigationPanelSeeAlso: 'ПанельНавигации.СмТакже', ActionsPanelCreate: 'ПанельДействий.Создать',
    ActionsPanelReports: 'ПанельДействий.Отчеты', ActionsPanelTools: 'ПанельДействий.Сервис',
    FormCommandBarImportant: 'КоманднаяПанельФормы.Важное', FormCommandBarCreateBasedOn: 'КоманднаяПанельФормы.СоздатьНаОсновании',
    FormNavigationPanelImportant: 'ПанельНавигацииФормы.Важное', FormNavigationPanelGoTo: 'ПанельНавигацииФормы.Перейти',
    FormNavigationPanelSeeAlso: 'ПанельНавигацииФормы.СмТакже', NavigationPanel: 'ПанельНавигации',
    ActionsPanel: 'ПанельДействий', FormCommandBar: 'КоманднаяПанельФормы', FormNavigationPanel: 'ПанельНавигацииФормы',
    /* Metadata properties. */
    TransformValues: 'ПреобразовыватьЗначения', DeleteData: 'УдалятьДанные', ForItem: 'ДляЭлемента',
    ForFolder: 'ДляГруппы', ForFolderAndItem: 'ДляГруппыИЭлемента', DuringSession: 'НаВремяСеанса',
    DuringRequest: 'НаВремяВызова', DontAutoUpdate: 'НеОбновлятьАвтоматически', AutoUpdate: 'ОбновлятьАвтоматически',
    QuickChoice: 'БыстрыйВыбор', FromForm: 'ИзФормы', Independently: 'Независимо',
    IndependentlyAndSimultaneously: 'НезависимоИСовместно', AutoUse: 'ИспользоватьАвтоматически',
    WholeCharacteristicKind: 'ВоВсемПланеВидовХарактеристик', WholeChartOfAccounts: 'ВоВсемПланеСчетов',
    OnActionPeriod: 'ПоПериодуДействия', Separate: 'Разделять', DontSeparate: 'НеРазделять',
    ActivePassive: 'АктивноПассивный', Active: 'Активный', Passive: 'Пассивный', DontUse: 'НеИспользовать',
    Use: 'Использовать', Auto: 'Авто', Clear: 'Очищать', DontChange: 'НеИзменять',
    /* Form item additions and borders. */
    SearchStringRepresentation: 'СтрокаПоиска', ViewStatusRepresentation: 'СостояниеПросмотра',
    SearchControl: 'УправлениеПоиском', WithoutBorder: 'БезРамки', DoubleUnderline: 'ДвойноеПодчеркивание',
    Embossed: 'Выпуклая', Indented: 'Вдавленная', Overline: 'ЧертаСверху', Rounded: 'Скругленная',
    Absolute: 'Абсолютный', PictureAndText: 'КартинкаИТекст', Picture: 'Картинка', Text: 'Текст',
    Variable: 'Переменная', Fixed: 'Фиксированная', Nonnegative: 'Неотрицательное', Any: 'Любой',
    ShowError: 'ВыдаватьОшибку', DontCheck: 'НеПроверять'
};
var VALUES_BY_KEY = {
    Period: { Custom: 'ПроизвольныйПериод' }, variant: { Custom: 'ПроизвольныйПериод' },
    ParameterUseMode: { Single: 'Одиночный', Multiple: 'Множественный' },
    Border: { Single: 'Одинарная', Double: 'Двойная', Underline: 'Подчеркивание' },
    style: { Single: 'Одинарная', Double: 'Двойная', Underline: 'Подчеркивание' }
};
(function () {
    var periods = ['Custom:ПроизвольныйПериод', 'Today:Сегодня', 'Yesterday:Вчера', 'Tomorrow:Завтра',
        'ThisWeek:ЭтаНеделя', 'ThisTenDays:ЭтаДекада', 'ThisMonth:ЭтотМесяц', 'ThisQuarter:ЭтотКвартал',
        'ThisHalfYear:ЭтоПолугодие', 'ThisYear:ЭтотГод', 'LastWeek:ПрошлаяНеделя', 'LastTenDays:ПрошлаяДекада',
        'LastMonth:ПрошлыйМесяц', 'LastQuarter:ПрошлыйКвартал', 'LastHalfYear:ПрошлоеПолугодие', 'LastYear:ПрошлыйГод',
        'NextWeek:СледующаяНеделя', 'NextTenDays:СледующаяДекада', 'NextMonth:СледующийМесяц',
        'NextQuarter:СледующийКвартал', 'NextHalfYear:СледующееПолугодие', 'NextYear:СледующийГод',
        'FromBeginningOfThisWeek:СНачалаЭтойНедели', 'FromBeginningOfThisTenDays:СНачалаЭтойДекады',
        'FromBeginningOfThisMonth:СНачалаЭтогоМесяца', 'FromBeginningOfThisQuarter:СНачалаЭтогоКвартала',
        'FromBeginningOfThisHalfYear:СНачалаЭтогоПолугодия', 'FromBeginningOfThisYear:СНачалаЭтогоГода',
        'TillEndOfThisWeek:ДоКонцаЭтойНедели', 'TillEndOfThisTenDays:ДоКонцаЭтойДекады',
        'TillEndOfThisMonth:ДоКонцаЭтогоМесяца', 'TillEndOfThisQuarter:ДоКонцаЭтогоКвартала',
        'TillEndOfThisHalfYear:ДоКонцаЭтогоПолугодия', 'TillEndOfThisYear:ДоКонцаЭтогоГода', 'Month:Месяц'];
    for (var i = 0; i < periods.length; i++) {
        var p = periods[i].split(':');
        VALUES_BY_KEY.Period[p[0]] = VALUES_BY_KEY.variant[p[0]] = p[1];
    }
})();

/* Metadata and structured-value property names none of the viewers list. */
var PROPERTIES = {
    TypeReductionMode: 'Режим сокращения типа', UseInTotals: 'Использовать в итогах', Location: 'Расположение',
    PrivilegedGetMode: 'Привилегированный режим при получении', Content: 'Состав', Source: 'Источник',
    Event: 'Событие', Handler: 'Обработчик', Namespace: 'URI пространства имен', References: 'Ссылки',
    Predefined: 'Предопределенный', MethodName: 'Имя метода', RestartCountOnFailure: 'Количество повторов при аварийном завершении',
    RestartIntervalOnFailure: 'Интервал повтора при аварийном завершении', RecordPresentation: 'Представление записи',
    ExtendedRecordPresentation: 'Расширенное представление записи', XDTOReturningValueType: 'Тип возвращаемого значения XDTO',
    Nillable: 'Возможно пустое', Transactioned: 'В транзакции', ProcedureName: 'Имя процедуры', Key: 'Ключ',
    Template: 'Макет', Description: 'Описание', Category: 'Категория', ReuseSessions: 'Повторное использование сеансов',
    SessionMaxAge: 'Время жизни сеанса', CreateTaskInPrivilegedMode: 'Привилегированный режим при создании задачи',
    IncludeConfigurationExtensions: 'Включать расширения конфигурации', DescriptorFileName: 'Имя файла описания',
    XDTOPackages: 'Пакеты XDTO', AutoUse: 'Автоиспользование', DataSeparation: 'Разделение данных',
    SeparatedDataUse: 'Использование разделяемых данных', UsersSeparation: 'Разделение пользователей',
    AuthenticationSeparation: 'Разделение аутентификации', ConfigurationExtensionsSeparation: 'Разделение расширений конфигурации',
    ScheduleLink: 'Связь с графиком', RootURL: 'Корневой URL', BaseDimension: 'Базовое измерение',
    AddressingDimension: 'Измерение адресации', PeriodAdjustmentLength: 'Длина периода корректировки',
    ActionPeriod: 'Период действия', BasePeriod: 'Базовый период', ChartOfCalculationTypes: 'План видов расчета',
    CodeMask: 'Маска кода', AutoOrderByCode: 'Автоупорядочивание по коду', OrderLength: 'Длина порядка',
    DependenceOnCalculationTypes: 'Зависимость от видов расчета', ActionPeriodUse: 'Использование периода действия',
    DataSeparationValue: 'Значение разделения данных', DataSeparationUse: 'Использование разделения данных',
    ConditionalSeparation: 'Условное разделение', TaskNumberAutoPrefix: 'Автопрефикс номера задачи',
    MainAddressingAttribute: 'Основной реквизит адресации', CurrentPerformer: 'Текущий исполнитель',
    ScheduleValue: 'Значение графика', ScheduleDate: 'Дата графика', Schedule: 'Расписание', Use: 'Использование',
    /* Children of structured form properties. */
    ExcludedCommand: 'Исключенная команда', Item: 'Элемент', Type: 'Тип', Common: 'Общая', Value: 'Значение',
    variant: 'Вариант', startDate: 'Начало', endDate: 'Окончание', Link: 'Связь', Name: 'Имя',
    DataPath: 'Путь к данным', ValueChange: 'Изменение значения', style: 'Стиль', width: 'Толщина',
    Ref: 'Картинка', LoadTransparent: 'Загружать прозрачность', LinkItem: 'Элемент связи',
    StringQualifiers: 'Квалификаторы строки', NumberQualifiers: 'Квалификаторы числа',
    DateQualifiers: 'Квалификаторы даты', Length: 'Длина', AllowedLength: 'Допустимая длина',
    Digits: 'Разрядность', FractionDigits: 'Точность', AllowedSign: 'Допустимый знак',
    DateFractions: 'Состав даты', ChartType: 'Тип диаграммы', CommandSet: 'Состав команд',
    AdditionSource: 'Источник добавления', UserVisible: 'Пользовательская видимость',
    ChoiceParameters: 'Параметры выбора', ChoiceParameterLinks: 'Связи параметров выбора',
    TypeLink: 'Связь по типу', RowFilter: 'Отбор строк', ChoiceButtonPicture: 'Картинка кнопки выбора',
    MinValue: 'Минимальное значение', MaxValue: 'Максимальное значение', Border: 'Рамка',
    AvailableTypes: 'Доступные типы', Period: 'Период'
};

var terms = { pictures: {} };

/* Other modules add what they own (form-preview: the standard pictures). */
function registerTerms(extra) {
    if (extra && extra.pictures) terms.pictures = extra.pictures;
}

function own(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : '';
}

/* A Russian identifier as words: ПанельНавигацииОбычное -> «Панель навигации обычное».
 * All-caps abbreviations (XDTO, URL) and dotted parts stay as written. */
function identWords(ident) {
    return String(ident || '').split('.').map(function (part) {
        var t = part.replace(/([а-яёa-z0-9])([А-ЯЁA-Z])/g, '$1 $2')
            .replace(/([А-ЯЁA-Z]+)([А-ЯЁA-Z][а-яёa-z])/g, '$1 $2');
        var words = t.split(' ');
        for (var i = 1; i < words.length; i++) {
            if (!/^[А-ЯЁA-Z0-9]{2,}$/.test(words[i])) words[i] = words[i].charAt(0).toLowerCase() + words[i].slice(1);
        }
        return words.join(' ');
    }).join('.');
}

function stdCommandTitle(name) {
    return own(STD_COMMANDS, name);
}

function stdCommandIdent(name) {
    var ident = own(STD_COMMAND_IDENTS, name);
    if (ident) return ident;
    var title = own(STD_COMMANDS, name);
    if (!title) return name;
    return title.replace(/[^\sА-Яа-яЁёA-Za-z0-9]/g, '').split(/\s+/).map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1);
    }).join('');
}

var IDENT = /^[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*$/;

/* Catalog.Товары.Command.Печать -> Справочник.Товары.Команда.Печать;
 * Form.StandardCommand.Close -> Форма.СтандартнаяКоманда.Закрыть. Anything
 * that is not a metadata path comes back as it was. */
function metadataRef(text) {
    var raw = String(text == null ? '' : text).trim();
    var parts = raw.split('.');
    if (parts.length < 2) return raw;
    for (var i = 0; i < parts.length; i++) if (!IDENT.test(parts[i])) return raw;
    var head = parts[0];
    var out = [];
    var start;
    if (own(MD_CLASSES, head)) { out.push(MD_CLASSES[head], parts[1]); start = 2; }
    else if (head === 'Form') { out.push('Форма'); start = 1; }
    else if (head === 'Item') { out.push('Элемент'); start = 1; }
    else return raw;
    for (var p = start; p < parts.length; p++) {
        var part = parts[p];
        if (own(MD_TAILS, part)) { out.push(MD_TAILS[part]); continue; }
        var kind = own(MD_PARTS, part);
        if (!kind) { out.push(part); continue; }
        out.push(kind);
        if (p + 1 >= parts.length) continue;
        var name = parts[++p];
        if (part === 'StandardCommand') out.push(stdCommandIdent(name));
        else if (part === 'StandardAttribute') out.push(own(STD_ATTRIBUTES, name) || name);
        else out.push(name);
    }
    return out.join('.');
}

/* Объект.Number -> Объект.Номер, Items.Список.CurrentData.Ref ->
 * Элементы.Список.ТекущиеДанные.Ссылка. The first segment names an
 * attribute of the form and is kept unless it is one of the platform words. */
function dataPath(text) {
    var raw = String(text == null ? '' : text);
    var parts = raw.split('.');
    if (parts.length < 2 && !own(PATH_WORDS, raw)) return raw;
    return parts.map(function (part, i) {
        var bare = part.replace(/\[\d+\]$/, '');
        var index = part.slice(bare.length);
        if (i === 0) return (bare === 'Items' ? PATH_WORDS.Items : bare) + index;
        /* Table footers: Объект.Товары.TotalСумма -> Объект.Товары.ИтогСумма. */
        var total = /^Total([А-ЯЁ].*)$/.exec(bare);
        return (own(PATH_WORDS, bare) || stdAttributeNumbered(bare) || (total ? 'Итог' + total[1] : '') || bare) + index;
    }).join('.');
}
/* ExtDimension1 -> Субконто1. */
function stdAttributeNumbered(name) {
    var m = /^(.*?)(\d*)$/.exec(name);
    var ru = own(STD_ATTRIBUTES, m[1]);
    return ru ? ru + m[2] : '';
}

/* One type name without qualifiers: cfg:CatalogRef.X, v8:ValueListType,
 * mxl:SpreadsheetDocument. Empty when the name is not a platform type. */
function typeName(text) {
    var raw = String(text == null ? '' : text).trim();
    var m = /^(?:([A-Za-z0-9]+):)?([A-Za-z][A-Za-z0-9]*)(?:\.(.*))?$/.exec(raw);
    if (!m) return '';
    var name = m[2], rest = m[3] ? '.' + m[3] : '';
    var plain = own(TYPES, name);
    if (plain) return plain + rest;
    if (own(MD_CLASSES, name)) return MD_CLASSES[name] + rest;
    for (var i = 0; i < TYPE_ROLES.length; i++) {
        var role = TYPE_ROLES[i][0];
        if (name.length > role.length && name.slice(-role.length) === role) {
            var cls = own(MD_CLASSES, name.slice(0, -role.length));
            if (cls) return cls + TYPE_ROLES[i][1] + rest;
        }
    }
    if (name === 'ConstantValueManager') return 'КонстантаМенеджерЗначения' + rest;
    if (name === 'ConstantsSet') return 'НаборКонстант' + rest;
    return '';
}

/* style:FormTextColor -> ЦветТекстаФормы, web:Red -> WebЦвета.Красный,
 * style:ПоясняющийТекст -> ПоясняющийТекст. */
function styleRef(text) {
    var m = /^(style|sys|win|web):([\wА-Яа-яЁё]+)$/.exec(String(text == null ? '' : text).trim());
    if (!m) return '';
    var name = m[2];
    if (m[1] === 'web') return COLOR_PREFIXES.web + (own(WEB_COLORS, name) || name);
    return COLOR_PREFIXES[m[1]] + (own(STYLE_ITEMS, name) || name);
}

/* StdPicture.Print -> БиблиотекаКартинок.Печать, CommonPicture.X -> ОбщаяКартинка.X. */
function pictureRef(text) {
    var m = /^(StdPicture|CommonPicture)\.([\wА-Яа-яЁё]+)$/.exec(String(text == null ? '' : text).trim());
    if (!m) return '';
    if (m[1] === 'CommonPicture') return 'ОбщаяКартинка.' + m[2];
    return 'БиблиотекаКартинок.' + (own(terms.pictures, m[2]) || m[2]);
}

function enumValue(value, key) {
    var v = String(value);
    var byKey = key && own(VALUES_BY_KEY, String(key).replace(/^.*[.:]/, ''));
    var ident = byKey && own(byKey, v) || own(VALUES, v);
    return ident ? identWords(ident) : '';
}

/* The Russian name of a property no viewer lists itself, or ''. */
function propertyName(key) {
    return own(PROPERTIES, String(key || '').replace(/^.*:/, ''));
}

/* Everything a single value may be, most specific first; the text itself
 * when it is none of them (a user string, a number, a name). */
function presentValue(value, key) {
    if (value === true || value === 'true') return 'Да';
    if (value === false || value === 'false') return 'Нет';
    var s = String(value == null ? '' : value);
    var t = s.trim();
    if (!t) return s;
    return enumValue(t, key) || styleRef(t) || pictureRef(t)
        || (/^[A-Za-z0-9]+:/.test(t) ? typeName(t) : '')
        || (t.indexOf('.') > 0 ? metadataRefOrPath(t) : typeName(t))
        || s;
}
function metadataRefOrPath(t) {
    var ref = metadataRef(t);
    if (ref !== t) return ref;
    var type = typeName(t);
    return type || '';
}

root.XmlUtil = {
    localName: localName,
    namedChildren: namedChildren,
    firstChild: firstChild,
    textOf: textOf,
    rawText: rawText,
    localizedFrom: localizedFrom,
    terms: {
        register: registerTerms,
        identWords: identWords,
        metadataRef: metadataRef,
        dataPath: dataPath,
        typeName: typeName,
        styleRef: styleRef,
        pictureRef: pictureRef,
        enumValue: enumValue,
        propertyName: propertyName,
        stdCommandTitle: stdCommandTitle,
        stdCommandIdent: stdCommandIdent,
        presentValue: presentValue,
        mdClass: function (name) { return own(MD_CLASSES, name); },
        stdAttribute: function (name) { return own(STD_ATTRIBUTES, name) || stdAttributeNumbered(String(name || '')); }
    }
};

})(window);
