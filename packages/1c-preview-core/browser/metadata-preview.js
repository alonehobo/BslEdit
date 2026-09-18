/* The object window of the 1C Designer for a metadata object's own descriptor:
 * the root XML of an external data processor or report, or of a configuration
 * object (Catalogs/Имя.xml, Documents/Имя.xml, ...).
 *
 * The descriptor alone holds the object's whole structure — attributes with
 * their types, tabular sections with their columns, the names of forms,
 * templates and commands — so it is drawn as the tree the Designer shows. The
 * forms and templates themselves live in their own files below <Имя>/; a node
 * that has such a file carries its path relative to that folder in `open`, and
 * the host decides whether and how to open it.
 *
 * Form and template descriptors (Forms/Имя.xml) and Configuration.xml are also
 * MetaDataObject documents but are not claimed: the first ones stand for their
 * layouts, and the configuration is not an object window. */
(function (root) {
'use strict';

var XU = root.XmlUtil;
var localName = XU.localName;
var namedChildren = XU.namedChildren;
var firstChild = XU.firstChild;
var textOf = XU.textOf;
var localizedFrom = XU.localizedFrom;

var NOT_OBJECTS = {
    Configuration: true, Form: true, CommonForm: true, Template: true, CommonTemplate: true,
    Language: true, Subsystem: true, Style: true, StyleItem: true, CommonPicture: true
};

var KIND_TITLES = {
    ExternalDataProcessor: 'Внешняя обработка', ExternalReport: 'Внешний отчет',
    DataProcessor: 'Обработка', Report: 'Отчет', Catalog: 'Справочник', Document: 'Документ',
    DocumentJournal: 'Журнал документов', Enum: 'Перечисление', Constant: 'Константа',
    InformationRegister: 'Регистр сведений', AccumulationRegister: 'Регистр накопления',
    AccountingRegister: 'Регистр бухгалтерии', CalculationRegister: 'Регистр расчета',
    ChartOfCharacteristicTypes: 'План видов характеристик', ChartOfAccounts: 'План счетов',
    ChartOfCalculationTypes: 'План видов расчета', BusinessProcess: 'Бизнес-процесс',
    Task: 'Задача', ExchangePlan: 'План обмена', CommonModule: 'Общий модуль',
    SessionParameter: 'Параметр сеанса', CommonAttribute: 'Общий реквизит',
    DefinedType: 'Определяемый тип', FilterCriterion: 'Критерий отбора',
    SettingsStorage: 'Хранилище настроек', CommonCommand: 'Общая команда',
    CommandGroup: 'Группа команд', Role: 'Роль', EventSubscription: 'Подписка на событие',
    ScheduledJob: 'Регламентное задание', FunctionalOption: 'Функциональная опция',
    FunctionalOptionsParameter: 'Параметр функциональных опций', WebService: 'Web-сервис',
    HTTPService: 'HTTP-сервис', WSReference: 'WS-ссылка', Sequence: 'Последовательность',
    ExternalDataSource: 'Внешний источник данных', IntegrationService: 'Сервис интеграции',
    DocumentNumerator: 'Нумератор документов', Subsystem: 'Подсистема'
};

/* Collections in the order the Designer lists them. */
var GROUPS = [
    { tag: 'Dimension', title: 'Измерения', item: 'Измерение' },
    { tag: 'Resource', title: 'Ресурсы', item: 'Ресурс' },
    { tag: 'Attribute', title: 'Реквизиты', item: 'Реквизит' },
    { tag: 'AddressingAttribute', title: 'Реквизиты адресации', item: 'Реквизит адресации' },
    { tag: 'AccountingFlag', title: 'Признаки учета', item: 'Признак учета' },
    { tag: 'ExtDimensionAccountingFlag', title: 'Признаки учета субконто', item: 'Признак учета субконто' },
    { tag: 'EnumValue', title: 'Значения', item: 'Значение' },
    { tag: 'Column', title: 'Графы', item: 'Графа' },
    { tag: 'TabularSection', title: 'Табличные части', item: 'Табличная часть' },
    { tag: 'Form', title: 'Формы', item: 'Форма' },
    { tag: 'Command', title: 'Команды', item: 'Команда' },
    { tag: 'Template', title: 'Макеты', item: 'Макет' },
    { tag: 'Recalculation', title: 'Перерасчеты', item: 'Перерасчет' },
    { tag: 'Operation', title: 'Операции', item: 'Операция' },
    { tag: 'URLTemplate', title: 'Шаблоны URL', item: 'Шаблон URL' }
];

/* Collections the Designer lists for a kind even when they are empty. */
var OBJECT_GROUPS = ['Attribute', 'TabularSection', 'Form', 'Command', 'Template'];
var REGISTER_GROUPS = ['Dimension', 'Resource', 'Attribute', 'Form', 'Command', 'Template'];
var ALWAYS_GROUPS = {
    ExternalDataProcessor: ['Attribute', 'TabularSection', 'Form', 'Template'],
    ExternalReport: ['Attribute', 'TabularSection', 'Form', 'Template'],
    DataProcessor: OBJECT_GROUPS, Report: OBJECT_GROUPS, Catalog: OBJECT_GROUPS, Document: OBJECT_GROUPS,
    ChartOfCharacteristicTypes: OBJECT_GROUPS, ChartOfCalculationTypes: OBJECT_GROUPS,
    ExchangePlan: OBJECT_GROUPS, BusinessProcess: OBJECT_GROUPS,
    Task: ['AddressingAttribute', 'Attribute', 'TabularSection', 'Form', 'Command', 'Template'],
    ChartOfAccounts: ['Attribute', 'AccountingFlag', 'ExtDimensionAccountingFlag', 'TabularSection',
        'Form', 'Command', 'Template'],
    InformationRegister: REGISTER_GROUPS, AccumulationRegister: REGISTER_GROUPS,
    AccountingRegister: REGISTER_GROUPS,
    CalculationRegister: REGISTER_GROUPS.concat(['Recalculation']),
    Enum: ['EnumValue', 'Form', 'Command', 'Template'],
    DocumentJournal: ['Column', 'Form', 'Command', 'Template']
};

/* Kinds that carry attributes, tabular sections, forms and templates. */
var STRUCTURED = {
    ExternalDataProcessor: true, ExternalReport: true, DataProcessor: true, Report: true,
    Catalog: true, Document: true, ChartOfCharacteristicTypes: true, ChartOfAccounts: true,
    ChartOfCalculationTypes: true, BusinessProcess: true, Task: true, ExchangePlan: true
};

var MODULES = {
    ExternalDataProcessor: ['ObjectModule'], ExternalReport: ['ObjectModule'],
    CommonModule: ['Module'], Constant: ['ValueManagerModule', 'ManagerModule']
};
var MODULE_TITLES = {
    ObjectModule: 'Модуль объекта', ManagerModule: 'Модуль менеджера',
    RecordSetModule: 'Модуль набора записей', ValueManagerModule: 'Модуль менеджера значения',
    Module: 'Модуль', CommandModule: 'Модуль команды'
};

var PROPERTY_TITLES = {
    Name: 'Имя', Synonym: 'Синоним', Comment: 'Комментарий', Type: 'Тип',
    PasswordMode: 'Режим пароля', Format: 'Формат', EditFormat: 'Формат редактирования',
    ToolTip: 'Подсказка', MarkNegatives: 'Выделять отрицательные', Mask: 'Маска',
    MultiLine: 'Многострочный режим', ExtendedEdit: 'Расширенное редактирование',
    MinValue: 'Минимальное значение', MaxValue: 'Максимальное значение',
    FillChecking: 'Проверка заполнения', ChoiceFoldersAndItems: 'Выбор групп и элементов',
    ChoiceParameterLinks: 'Связи параметров выбора', ChoiceParameters: 'Параметры выбора',
    QuickChoice: 'Быстрый выбор', CreateOnInput: 'Создание при вводе', ChoiceForm: 'Форма выбора',
    LinkByType: 'Связь по типу', ChoiceHistoryOnInput: 'История выбора при вводе',
    DefaultForm: 'Основная форма', AuxiliaryForm: 'Дополнительная форма',
    DefaultSettingsForm: 'Основная форма настроек', AuxiliarySettingsForm: 'Дополнительная форма настроек',
    DefaultVariantForm: 'Основная форма варианта', MainDataCompositionSchema: 'Основная схема компоновки данных',
    VariantsStorage: 'Хранилище вариантов', SettingsStorage: 'Хранилище настроек',
    DefaultObjectForm: 'Основная форма объекта', DefaultFolderForm: 'Основная форма группы',
    DefaultListForm: 'Основная форма списка', DefaultChoiceForm: 'Основная форма для выбора',
    DefaultFolderChoiceForm: 'Основная форма выбора группы', DefaultRecordForm: 'Основная форма записи',
    AuxiliaryObjectForm: 'Дополнительная форма объекта', AuxiliaryListForm: 'Дополнительная форма списка',
    AuxiliaryChoiceForm: 'Дополнительная форма для выбора', AuxiliaryFolderForm: 'Дополнительная форма группы',
    Indexing: 'Индексирование', FullTextSearch: 'Полнотекстовый поиск', Use: 'Использование',
    FillFromFillingValue: 'Заполнять из данных заполнения', FillValue: 'Значение заполнения',
    DataHistory: 'История данных', UseStandardCommands: 'Использовать стандартные команды',
    IncludeHelpInContents: 'Включать в содержание справки', ExtendedPresentation: 'Расширенное представление',
    Explanation: 'Пояснение', ObjectPresentation: 'Представление объекта',
    ListPresentation: 'Представление списка', ExtendedObjectPresentation: 'Расширенное представление объекта',
    ExtendedListPresentation: 'Расширенное представление списка', TemplateType: 'Тип макета',
    FormType: 'Тип формы', Group: 'Группа', Representation: 'Отображение', Picture: 'Картинка',
    Shortcut: 'Сочетание клавиш', OnMainServerUnavalableBehavior: 'Поведение при недоступности сервера',
    CommandParameterType: 'Тип параметра команды', ParameterUseMode: 'Режим использования параметра',
    ModifiesData: 'Изменяет данные', LineNumberLength: 'Длина номера строки',
    CodeLength: 'Длина кода', DescriptionLength: 'Длина наименования', Hierarchical: 'Иерархический',
    NumberLength: 'Длина номера', NumberType: 'Тип номера', Posting: 'Проведение',
    Master: 'Ведущее', MainFilter: 'Основной отбор', DenyIncompleteValues: 'Запрет незаполненных значений',
    Balance: 'Баланс', AccountingFlag: 'Признак учета', ExtDimensionAccountingFlag: 'Признак учета субконто',
    Server: 'Сервер', ClientManagedApplication: 'Клиент (управляемое приложение)',
    ExternalConnection: 'Внешнее соединение', Global: 'Глобальный', ServerCall: 'Вызов сервера',
    Privileged: 'Привилегированный', ReturnValuesReuse: 'Повторное использование возвращаемых значений',
    ClientOrdinaryApplication: 'Клиент (обычное приложение)',
    HierarchyType: 'Вид иерархии', LimitLevelCount: 'Ограничивать количество уровней',
    LevelCount: 'Количество уровней', FoldersOnTop: 'Группы сверху', Owners: 'Владельцы',
    SubordinationUse: 'Использование подчинения', CodeType: 'Тип кода',
    CodeAllowedLength: 'Допустимая длина кода', CodeSeries: 'Серии кодов',
    CheckUnique: 'Контроль уникальности', Autonumbering: 'Автонумерация',
    DefaultPresentation: 'Основное представление', PredefinedDataUpdate: 'Обновление предопределенных данных',
    EditType: 'Способ редактирования', ChoiceMode: 'Режим выбора', InputByString: 'Ввод по строке',
    SearchStringModeOnInputByString: 'Режим поиска строки при вводе по строке',
    FullTextSearchOnInputByString: 'Полнотекстовый поиск при вводе по строке',
    ChoiceDataGetModeOnInputByString: 'Режим получения данных выбора при вводе по строке',
    AuxiliaryFolderChoiceForm: 'Дополнительная форма выбора группы', BasedOn: 'Ввод на основании',
    DataLockFields: 'Поля блокировки данных', DataLockControlMode: 'Режим управления блокировкой данных',
    UpdateDataHistoryImmediatelyAfterWrite: 'Обновлять историю данных сразу после записи',
    ExecuteAfterWriteDataHistoryVersionProcessing: 'Выполнять обработку версий истории данных после записи',
    Numerator: 'Нумератор', NumberAllowedLength: 'Допустимая длина номера',
    NumberPeriodicity: 'Периодичность номера', RealTimePosting: 'Оперативное проведение',
    RegisterRecordsDeletion: 'Удаление движений', RegisterRecordsWritingOnPost: 'Запись движений при проведении',
    SequenceFilling: 'Заполнение последовательностей', RegisterRecords: 'Движения',
    PostInPrivilegedMode: 'Привилегированный режим при проведении',
    UnpostInPrivilegedMode: 'Привилегированный режим при отмене проведения',
    InformationRegisterPeriodicity: 'Периодичность', WriteMode: 'Режим записи',
    MainFilterOnPeriod: 'Основной отбор по периоду', RegisterType: 'Вид регистра',
    EnableTotalsSplitting: 'Разрешить разделение итогов', EnableTotalsSliceFirst: 'Разрешить итоги среза первых',
    EnableTotalsSliceLast: 'Разрешить итоги среза последних', ChartOfAccounts: 'План счетов',
    Correspondence: 'Корреспонденция', ExtDimensionTypes: 'Виды субконто',
    MaxExtDimensionCount: 'Максимальное количество субконто', CharacteristicExtValues: 'Дополнительные значения характеристик',
    QuickChoiceOnInputByString: 'Быстрый выбор при вводе по строке', Addressing: 'Адресация',
    Task: 'Задача', RegisteredDocuments: 'Регистрируемые документы', DistributedInfoBase: 'Распределенная информационная база',
    BusinessProcess: 'Бизнес-процесс', BaseCalculationTypes: 'Базовые виды расчета', Schedule: 'График',
    Periodicity: 'Периодичность'
};

/* Metadata classes in the Designer's spelling, for lists of object references
 * (register records, input on basis, owners). */
var MD_CLASSES = {
    Catalog: 'Справочник', Document: 'Документ', Enum: 'Перечисление', DocumentJournal: 'ЖурналДокументов',
    InformationRegister: 'РегистрСведений', AccumulationRegister: 'РегистрНакопления',
    AccountingRegister: 'РегистрБухгалтерии', CalculationRegister: 'РегистрРасчета',
    ChartOfCharacteristicTypes: 'ПланВидовХарактеристик', ChartOfAccounts: 'ПланСчетов',
    ChartOfCalculationTypes: 'ПланВидовРасчета', BusinessProcess: 'БизнесПроцесс', Task: 'Задача',
    ExchangePlan: 'ПланОбмена', DataProcessor: 'Обработка', Report: 'Отчет', Constant: 'Константа',
    Sequence: 'Последовательность', DocumentNumerator: 'НумераторДокументов'
};
var STANDARD_ATTRIBUTES = {
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
    BegOfBasePeriod: 'БазовыйПериодНачало', EndOfBasePeriod: 'БазовыйПериодКонец'
};

/* Reference types of the object classes, for the standard Ref/Parent/Owner. */
var REF_TYPES = {
    Catalog: 'CatalogRef', Document: 'DocumentRef', Enum: 'EnumRef', BusinessProcess: 'BusinessProcessRef',
    Task: 'TaskRef', ExchangePlan: 'ExchangePlanRef', ChartOfAccounts: 'ChartOfAccountsRef',
    ChartOfCharacteristicTypes: 'ChartOfCharacteristicTypesRef',
    ChartOfCalculationTypes: 'ChartOfCalculationTypesRef'
};
var BOOLEAN_STANDARD = {
    Posted: true, DeletionMark: true, IsFolder: true, Predefined: true, Active: true, ThisNode: true,
    Started: true, Completed: true, Executed: true, OffBalance: true, TurnoversOnly: true,
    ReversingEntry: true, ActionPeriodIsBasic: true
};

/* Lists of object references the object keeps among its own properties,
 * drawn as groups of the tree so every entry opens. */
var LINK_GROUPS = [
    { key: 'Owners', tag: 'Owners', title: 'Владельцы' },
    { key: 'RegisterRecords', tag: 'RegisterRecords', title: 'Движения' },
    { key: 'BasedOn', tag: 'BasedOn', title: 'Ввод на основании' }
];
/* Single references among the properties, gathered in one group. */
var LINKED_PROPERTIES = ['Numerator', 'ChartOfAccounts', 'ChartOfCalculationTypes', 'ExtDimensionTypes',
    'CharacteristicExtValues', 'Task', 'BusinessProcess', 'BaseCalculationTypes', 'Schedule'];

/* One entry of an object reference list: Document.Имя -> Документ.Имя,
 * Catalog.Имя.StandardAttribute.Code -> Код, Catalog.Имя.Attribute.Артикул -> Артикул. */
function referencePresentation(raw) {
    var parts = String(raw || '').split('.');
    var standard = parts.indexOf('StandardAttribute');
    if (standard >= 0 && parts[standard + 1]) return STANDARD_ATTRIBUTES[parts[standard + 1]] || parts[standard + 1];
    if (parts.length > 3) return parts[parts.length - 1];
    if (MD_CLASSES[parts[0]]) parts[0] = MD_CLASSES[parts[0]];
    return parts.join('.');
}

var VALUE_TITLES = {
    'true': 'Да', 'false': 'Нет', ShowError: 'Выдавать ошибку', DontCheck: 'Не проверять',
    Auto: 'Авто', Use: 'Использовать', DontUse: 'Не использовать', Items: 'Элементы',
    Folders: 'Группы', FoldersAndItems: 'Группы и элементы', Index: 'Индексировать',
    DontIndex: 'Не индексировать', IndexWithAdditionalOrder: 'Индексировать с доп. упорядочиванием',
    Variable: 'Переменная', Fixed: 'Фиксированная', Nonnegative: 'Неотрицательное', Any: 'Любой',
    SpreadsheetDocument: 'Табличный документ', BinaryData: 'Двоичные данные',
    DataCompositionSchema: 'Схема компоновки данных', TextDocument: 'Текстовый документ',
    HTMLDocument: 'HTML документ', GeographicalSchema: 'Географическая схема',
    GraphicalSchema: 'Графическая схема', AddIn: 'Внешняя компонента',
    DataCompositionAppearanceTemplate: 'Макет оформления компоновки данных',
    Managed: 'Управляемая', Ordinary: 'Обычная', Allow: 'Разрешить', Deny: 'Запретить',
    Single: 'Однократный', Multiple: 'Многократный', Date: 'Дата', Time: 'Время',
    DateTime: 'Дата и время', String: 'Строка', Number: 'Число',
    HierarchyFoldersAndItems: 'Иерархия групп и элементов', HierarchyOfItems: 'Иерархия элементов',
    ToItems: 'Элементам', ToFolders: 'Группам', ToFoldersAndItems: 'Группам и элементам',
    AsDescription: 'В виде наименования', AsCode: 'В виде кода', AsNumber: 'В виде номера',
    InDialog: 'В диалоге', InList: 'В списке', BothWays: 'Обоими способами',
    Begin: 'С начала строки', AnyPart: 'Любая часть', Directly: 'Непосредственно', Background: 'Фоново',
    Automatic: 'Автоматический', Year: 'В пределах года', Quarter: 'В пределах квартала',
    Month: 'В пределах месяца', Day: 'В пределах дня', Nonperiodical: 'Непериодический',
    WholeCatalog: 'Во всем справочнике', WithinSubordination: 'В пределах подчинения',
    WithinOwnerSubordination: 'В пределах подчинения владельцу',
    AutoDelete: 'Удалять автоматически', AutoDeleteOnUnpost: 'Удалять автоматически при отмене проведения',
    AutoDeleteOff: 'Не удалять автоматически', WriteSelected: 'Записывать выбранные',
    WriteModified: 'Записывать модифицированные', AutoFill: 'Заполнять автоматически',
    AutoFillOff: 'Не заполнять автоматически', Independent: 'Независимый',
    RecorderSubordinate: 'Подчинение регистратору', Balance: 'Остатки', Turnovers: 'Обороты',
    Second: 'В пределах секунды', RecorderPosition: 'Позиция регистратора', Whole: 'Во всей информационной базе'
};

/* Designer-internal or already-shown properties never listed in the inspector. */
var SKIP_PROPERTIES = {
    Name: true, Synonym: true, Comment: true, Type: true, StandardAttributes: true,
    Characteristics: true, InternalInfo: true, StandardTabularSections: true
};

/* An object is mostly opened for its forms and templates: the data groups
 * start folded, forms and templates open. Standard attributes sit behind a
 * button in the Designer and start folded too. */
var FOLDED_AT_START = ['StandardAttribute', 'Dimension', 'Resource', 'Attribute', 'AddressingAttribute',
    'AccountingFlag', 'ExtDimensionAccountingFlag', 'EnumValue', 'Column', 'TabularSection'];

function initialViewState() {
    var collapsed = {};
    for (var i = 0; i < FOLDED_AT_START.length; i++) collapsed['group:' + FOLDED_AT_START[i]] = true;
    return { collapsed: collapsed, selected: '' };
}

var viewState = initialViewState();

function resetViewState() {
    viewState = initialViewState();
}

function objectElement(doc) {
    var top = doc && doc.documentElement;
    if (!top || localName(top) !== 'MetaDataObject') return null;
    var kids = top.children || [];
    for (var i = 0; i < kids.length; i++) {
        if (firstChild(kids[i], 'Properties')) return kids[i];
    }
    return null;
}

function detect(xml) {
    if (!xml || typeof xml !== 'string') return false;
    if (xml.indexOf('MetaDataObject') < 0 || xml.indexOf('v8.1c.ru/8.3/MDClasses') < 0) return false;
    var m = xml.match(/<(?:\w+:)?MetaDataObject\b[^>]*>\s*<(?:\w+:)?(\w+)[\s>]/);
    if (!m || NOT_OBJECTS[m[1]]) return false;
    return /<(?:\w+:)?Properties[\s>]/.test(xml);
}

function valueTitle(value) {
    var s = String(value);
    return Object.prototype.hasOwnProperty.call(VALUE_TITLES, s) ? VALUE_TITLES[s] : s;
}

function typeName(raw) {
    var shown = root.FormPreview && root.FormPreview.typePresentation
        ? root.FormPreview.typePresentation(raw) : '';
    return shown || raw;
}

/* v8:TypeDescription as the Designer spells it: Строка(50), Число(15, 2),
 * Дата(дата), СправочникСсылка.Контрагенты, joined for a composite type. */
function typePresentation(typeEl) {
    if (!typeEl) return '';
    var parts = [];
    var stringQ = firstChild(typeEl, 'StringQualifiers');
    var numberQ = firstChild(typeEl, 'NumberQualifiers');
    var dateQ = firstChild(typeEl, 'DateQualifiers');
    var kids = typeEl.children || [];
    for (var i = 0; i < kids.length; i++) {
        var tag = localName(kids[i]);
        if (tag !== 'Type' && tag !== 'TypeSet') continue;
        var raw = textOf(kids[i]);
        if (!raw) continue;
        var low = raw.toLowerCase();
        var shown = typeName(raw);
        if (low === 'xs:string' && stringQ) {
            var length = parseInt(textOf(firstChild(stringQ, 'Length')), 10) || 0;
            var fixed = textOf(firstChild(stringQ, 'AllowedLength')) === 'Fixed';
            shown += '(' + (length > 0 ? length : 'неогр.') + (fixed ? ', фикс.' : '') + ')';
        } else if (low === 'xs:decimal' && numberQ) {
            shown += '(' + (textOf(firstChild(numberQ, 'Digits')) || '0') + ', '
                + (textOf(firstChild(numberQ, 'FractionDigits')) || '0')
                + (textOf(firstChild(numberQ, 'AllowedSign')) === 'Nonnegative' ? '; неотрицательное' : '') + ')';
        } else if (low === 'xs:datetime' && dateQ) {
            var part = textOf(firstChild(dateQ, 'DateFractions'));
            shown += part === 'Date' ? '(дата)' : part === 'Time' ? '(время)' : '(дата и время)';
        }
        parts.push(shown);
    }
    return parts.join(', ');
}

function isNil(el) {
    var attrs = el && el.attributes;
    if (!attrs) return false;
    if (typeof el.getAttribute === 'function') {
        var nil = el.getAttribute('xsi:nil');
        if (nil === 'true') return true;
    }
    for (var i = 0; i < attrs.length; i++) {
        var a = attrs[i];
        if (a && /(^|:)nil$/.test(a.name || '') && a.value === 'true') return true;
    }
    return false;
}

/* One property's value as text: localized strings pick the UI language,
 * references keep only the name after the last dot for forms, and structured
 * values collapse to their text. */
function propertyValue(el) {
    if (!el || isNil(el)) return '';
    var tag = localName(el);
    if (tag === 'Type' || tag === 'CommandParameterType') return typePresentation(el);
    if (firstChild(el, 'item') && (firstChild(firstChild(el, 'item'), 'content')
            || firstChild(firstChild(el, 'item'), 'lang'))) return localizedFrom(el);
    if (el.children && el.children.length) {
        /* A list of references (<xr:Item>, <xr:Field>) reads as a list. */
        var items = [];
        for (var k = 0; k < el.children.length; k++) {
            var itemTag = localName(el.children[k]);
            if (itemTag !== 'Item' && itemTag !== 'Field') { items = null; break; }
            items.push(referencePresentation(textOf(el.children[k])));
        }
        if (items && items.length) return items.join(', ');
        var text = textOf(el);
        return text.length > 200 ? text.slice(0, 200) + '…' : text;
    }
    return valueTitle(textOf(el));
}

function propertyRows(props) {
    var rows = [];
    var kids = (props && props.children) || [];
    for (var i = 0; i < kids.length; i++) {
        var key = localName(kids[i]);
        if (SKIP_PROPERTIES[key]) continue;
        var value = propertyValue(kids[i]);
        if (!value) continue;
        rows.push({ key: key, label: PROPERTY_TITLES[key] || key, value: value });
    }
    return rows;
}

function shortFormName(ref) {
    var s = String(ref || '');
    var at = s.lastIndexOf('.');
    return at >= 0 ? s.slice(at + 1) : s;
}

function readNode(el, group, parentId, objectName) {
    var props = firstChild(el, 'Properties');
    var name = props ? textOf(firstChild(props, 'Name')) : textOf(el);
    var id = (parentId ? parentId + '.' : '') + group.tag + '.' + name;
    var node = {
        id: id,
        kind: group.tag,
        kindTitle: group.item,
        name: name,
        synonym: props ? localizedFrom(firstChild(props, 'Synonym')) : '',
        comment: props ? textOf(firstChild(props, 'Comment')) : '',
        type: props ? typePresentation(firstChild(props, 'Type')) : '',
        properties: props ? propertyRows(props) : [],
        children: [],
        open: ''
    };
    if (!parentId) {
        if (group.tag === 'Form') node.open = 'Forms/' + name + '/Ext/Form.xml';
        else if (group.tag === 'Template') node.open = 'Templates/' + name + '/Ext/Template.xml';
        else if (group.tag === 'Command') node.open = 'Commands/' + name + '/Ext/CommandModule.bsl';
    }
    /* A tabular section (and a register's recalculation) lists its own columns. */
    var childObjects = firstChild(el, 'ChildObjects');
    if (childObjects) {
        var columns = namedChildren(childObjects, 'Attribute');
        for (var i = 0; i < columns.length; i++) {
            node.children.push(readNode(columns[i], GROUPS[2], id, objectName));
        }
    }
    return node;
}

function boolProp(props, key) {
    return textOf(firstChild(props, key)) === 'true';
}

function refItems(el) {
    var out = [];
    var kids = (el && el.children) || [];
    for (var i = 0; i < kids.length; i++) {
        var value = textOf(kids[i]).trim();
        if (value) out.push(value);
    }
    return out;
}

/* The Designer's type of a standard attribute, from the object's own
 * settings (code and number kind and length, owners); '' when it is not
 * fixed by the descriptor alone. */
function standardType(key, kind, name, props) {
    var own = REF_TYPES[kind] ? typeName('cfg:' + REF_TYPES[kind] + '.' + name) : '';
    function sized(typeKey, lengthKey) {
        var length = textOf(firstChild(props, lengthKey)) || '0';
        return textOf(firstChild(props, typeKey)) === 'Number' ? 'Число(' + length + ', 0)' : 'Строка(' + length + ')';
    }
    if (BOOLEAN_STANDARD[key]) return 'Булево';
    switch (key) {
    case 'Ref': case 'Parent': return own;
    case 'Owner':
        return refItems(firstChild(props, 'Owners')).map(function (ref) {
            var parts = ref.split('.');
            return REF_TYPES[parts[0]] ? typeName('cfg:' + REF_TYPES[parts[0]] + '.' + parts[1]) : ref;
        }).join(', ');
    case 'Code': return sized('CodeType', 'CodeLength');
    case 'Description': return 'Строка(' + (textOf(firstChild(props, 'DescriptionLength')) || '0') + ')';
    case 'Number': return sized('NumberType', 'NumberLength');
    case 'Date': case 'Period': case 'ExchangeDate': return 'Дата(дата и время)';
    case 'PredefinedDataName': return 'Строка(неогр.)';
    case 'RecordType': return kind === 'AccumulationRegister' ? 'ВидДвиженияНакопления' : 'ВидДвиженияБухгалтерии';
    }
    return '';
}

/* Standard attributes the object really has: the descriptor lists them all,
 * the Designer hides the ones its settings switch off. */
function standardVisible(key, kind, props) {
    if (kind === 'Catalog' || kind === 'ChartOfCharacteristicTypes') {
        var hierarchical = boolProp(props, 'Hierarchical');
        if (key === 'Owner') return refItems(firstChild(props, 'Owners')).length > 0;
        if (key === 'Parent') return hierarchical;
        if (key === 'IsFolder') return hierarchical && textOf(firstChild(props, 'HierarchyType')) !== 'HierarchyOfItems';
    }
    if (key === 'Code' && firstChild(props, 'CodeLength')) return textOf(firstChild(props, 'CodeLength')) !== '0';
    if (key === 'Description' && firstChild(props, 'DescriptionLength'))
        return textOf(firstChild(props, 'DescriptionLength')) !== '0';
    if (key === 'Number' && firstChild(props, 'NumberLength')) return textOf(firstChild(props, 'NumberLength')) !== '0';
    if (kind === 'InformationRegister') {
        var subordinate = textOf(firstChild(props, 'WriteMode')) === 'RecorderSubordinate';
        if (key === 'Recorder' || key === 'LineNumber' || key === 'Active') return subordinate;
        if (key === 'Period') return textOf(firstChild(props, 'InformationRegisterPeriodicity')) !== 'Nonperiodical';
    }
    return true;
}

function standardNodes(props, kind, name) {
    var out = [];
    var holder = firstChild(props, 'StandardAttributes');
    var kids = (holder && holder.children) || [];
    var seen = {};
    for (var i = 0; i < kids.length; i++) {
        var key = kids[i].getAttribute ? kids[i].getAttribute('name') : '';
        if (!key || seen[key] || !standardVisible(key, kind, props)) continue;
        seen[key] = true;
        var shown = STANDARD_ATTRIBUTES[key] || key;
        var synonym = localizedFrom(firstChild(kids[i], 'Synonym'));
        out.push({
            id: 'StandardAttribute.' + key, kind: 'StandardAttribute', kindTitle: 'Стандартный реквизит', key: key,
            name: shown, synonym: synonym, comment: textOf(firstChild(kids[i], 'Comment')),
            type: standardType(key, kind, name, props), properties: propertyRows(kids[i]),
            children: [], open: ''
        });
    }
    return out;
}

/* One entry of a relation group: another object of the configuration. `path`
 * is where its descriptor lies, when the configuration root is known. */
function refNode(groupTag, ref, path, title, hint, hintLabel) {
    var cls = String(ref).split('.')[0];
    return {
        id: groupTag + ':' + ref, kind: 'Ref', refClass: cls, ref: ref,
        kindTitle: KIND_TITLES[cls] || cls, name: title || referencePresentation(ref),
        synonym: hint || '', hintLabel: hintLabel || '', comment: '', type: '', properties: [], children: [],
        open: path || ''
    };
}

/* Document.Имя.TabularSection.Товары.Attribute.Номенклатура -> Товары.Номенклатура. */
function memberPresentation(path) {
    return String(path).split('.').filter(function (part, i, all) {
        return !(i % 2 === 0 && i + 1 < all.length && /^(TabularSection|Attribute|Dimension|Resource|StandardAttribute|AddressingAttribute|Command)$/.test(part));
    }).join('.');
}

function relationsPath(ctx, ref) {
    var rel = root.MetadataRelations;
    return ctx && ctx.relations && ctx.relations.root && rel ? rel.objectPath(ctx.relations.root, ref) : '';
}

function linkGroups(props, ctx) {
    var out = [];
    for (var g = 0; g < LINK_GROUPS.length; g++) {
        var spec = LINK_GROUPS[g];
        var refs = refItems(firstChild(props, spec.key));
        if (!refs.length) continue;
        out.push({
            id: 'group:' + spec.tag, kind: spec.tag, title: spec.title, link: true,
            items: refs.map(function (ref) { return refNode(spec.tag, ref, relationsPath(ctx, ref)); })
        });
    }
    var linked = [];
    for (var p = 0; p < LINKED_PROPERTIES.length; p++) {
        var key = LINKED_PROPERTIES[p];
        var el = firstChild(props, key);
        var values = el && el.children && el.children.length ? refItems(el) : [textOf(el).trim()];
        for (var v = 0; v < values.length; v++) {
            if (!values[v] || values[v].split('.').length !== 2) continue;
            linked.push(refNode('Linked', values[v], relationsPath(ctx, values[v]), '', PROPERTY_TITLES[key] || key,
                'Свойство'));
        }
    }
    if (linked.length) out.push({ id: 'group:Linked', kind: 'Linked', title: 'Связанные объекты', link: true, items: linked });
    return out;
}

/* Groups the configuration scan found (metadata-relations.js). */
function relationGroups(ctx) {
    var out = [];
    var relations = ctx && ctx.relations;
    var groups = (relations && relations.groups) || [];
    for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        if (!group.items.length) continue;
        out.push({
            id: 'group:' + group.tag, kind: group.tag, title: group.title, link: true,
            items: group.items.map(function (it) {
                /* A group of one class (registrars are documents) names its
                 * members without the class. */
                return refNode(group.tag, it.ref, it.path, it.title || (group.single ? it.ref.split('.')[1] : ''),
                    (it.detail || []).map(memberPresentation).join(', '), 'Реквизиты');
            })
        });
    }
    return out;
}

function predefinedGroup(ctx) {
    var list = ctx && ctx.relations && ctx.relations.predefined;
    if (!list || !list.length) return null;
    var items = [];
    var parents = [];
    for (var i = 0; i < list.length; i++) {
        var it = list[i];
        var hint = [it.code, it.description].filter(Boolean).join(' ');
        var node = {
            id: 'Predefined.' + it.name, kind: 'Predefined', kindTitle: it.folder ? 'Предопределенная группа'
                : 'Предопределенный элемент',
            name: it.name, synonym: it.description, comment: '', type: '',
            properties: [it.code ? { key: 'Code', label: 'Код', value: it.code } : null,
                it.description ? { key: 'Description', label: 'Наименование', value: it.description } : null]
                .filter(Boolean),
            children: [], open: '', hint: hint
        };
        /* The tree shows two levels below a group; deeper items join their
         * top-level ancestor. */
        parents[it.depth] = node;
        if (it.depth > 0 && parents[0]) parents[0].children.push(node);
        else items.push(node);
    }
    return { id: 'group:Predefined', kind: 'Predefined', title: 'Предопределенные', items: items };
}

/* Groups placed after the forms, commands and templates: where the object is
 * listed across the configuration rather than what it holds. */
/* Groups the object window itself draws: the object's data and its forms and
 * templates. Registers keep dimensions and resources, enums their values,
 * journals their columns — these are their attributes. */
var WINDOW_GROUPS = {
    Dimension: true, Resource: true, Attribute: true, AddressingAttribute: true, AccountingFlag: true,
    ExtDimensionAccountingFlag: true, EnumValue: true, Column: true, TabularSection: true,
    Form: true, Template: true
};

var CONTEXT_GROUPS = { Subsystems: true, FunctionalOptions: true, EventSubscriptions: true,
    DefinedTypes: true, FilterCriteria: true };

function parse(xml, ctx) {
    var doc;
    try {
        doc = new DOMParser().parseFromString(String(xml || '').replace(/^﻿/, ''), 'application/xml');
    } catch (e) {
        return { error: 'Не удалось разобрать XML: ' + e.message };
    }
    var obj = objectElement(doc);
    if (!obj) return { error: 'Это не объект метаданных 1С.' };
    var kind = localName(obj);
    var props = firstChild(obj, 'Properties');
    var name = textOf(firstChild(props, 'Name'));
    var childObjects = firstChild(obj, 'ChildObjects');
    var model = {
        kind: kind,
        kindTitle: KIND_TITLES[kind] || kind,
        name: name,
        synonym: localizedFrom(firstChild(props, 'Synonym')),
        comment: textOf(firstChild(props, 'Comment')),
        properties: propertyRows(props),
        forms: [],
        groups: [],
        modules: [],
        nodes: {}
    };
    /* The object's own default and auxiliary forms, shown in the header. */
    var pkids = props.children || [];
    for (var p = 0; p < pkids.length; p++) {
        var key = localName(pkids[p]);
        if (!/Form$/.test(key) || key === 'ChoiceForm') continue;
        var ref = textOf(pkids[p]);
        if (!ref) continue;
        var own = ref.indexOf('.Form.') >= 0 && ref.split('.')[1] === name;
        model.forms.push({
            key: key, label: PROPERTY_TITLES[key] || key, value: shortFormName(ref),
            ref: ref, formId: own ? 'Form.' + shortFormName(ref) : ''
        });
    }
    var standard = standardNodes(props, kind, name);
    if (standard.length) {
        model.groups.push({ id: 'group:StandardAttribute', kind: 'StandardAttribute',
            title: 'Стандартные реквизиты', items: standard });
    }
    var relations = linkGroups(props, ctx).concat(relationGroups(ctx));
    var predefined = predefinedGroup(ctx);
    for (var g = 0; g < GROUPS.length; g++) {
        var group = GROUPS[g];
        /* Relations of the object go between its data and its forms. */
        if (group.tag === 'Form') {
            if (predefined) model.groups.push(predefined);
            for (var r = 0; r < relations.length; r++)
                if (!CONTEXT_GROUPS[relations[r].kind]) model.groups.push(relations[r]);
        }
        var els = childObjects ? namedChildren(childObjects, group.tag) : [];
        if (!els.length && (ALWAYS_GROUPS[kind] || []).indexOf(group.tag) < 0) continue;
        var entry = { id: 'group:' + group.tag, kind: group.tag, title: group.title, items: [] };
        for (var i = 0; i < els.length; i++) entry.items.push(readNode(els[i], group, '', name));
        model.groups.push(entry);
    }
    for (var c = 0; c < relations.length; c++)
        if (CONTEXT_GROUPS[relations[c].kind]) model.groups.push(relations[c]);
    var modules = MODULES[kind] || (STRUCTURED[kind] ? ['ObjectModule', 'ManagerModule']
        : /Register$/.test(kind) ? ['RecordSetModule', 'ManagerModule'] : ['ManagerModule']);
    for (var m = 0; m < modules.length; m++) {
        model.modules.push({ id: 'module:' + modules[m], title: MODULE_TITLES[modules[m]] || modules[m],
            open: 'Ext/' + modules[m] + '.bsl' });
    }
    model.object = {
        id: 'object', kind: kind, kindTitle: model.kindTitle, name: name, synonym: model.synonym,
        comment: model.comment, type: '', properties: model.properties, children: [], open: ''
    };
    function index(node) {
        model.nodes[node.id] = node;
        for (var c = 0; c < node.children.length; c++) index(node.children[c]);
    }
    for (var gi = 0; gi < model.groups.length; gi++) {
        for (var ii = 0; ii < model.groups[gi].items.length; ii++) index(model.groups[gi].items[ii]);
    }
    return { model: model };
}

// ------------------------------------------------------------------ outline

/* Source line of each node: its <Name> (or, for a name-only child such as a
 * form in an external object, the <Form>Имя</Form> element), searched after
 * the line of its parent so equal column names in two sections stay apart. */
function lineFinder(xml) {
    var lines = String(xml || '').split(/\r?\n/);
    return function (needles, after) {
        for (var i = Math.max(0, (after || 1) - 1); i < lines.length; i++) {
            for (var n = 0; n < needles.length; n++) {
                if (lines[i].indexOf(needles[n]) >= 0) return i + 1;
            }
        }
        return 0;
    };
}

function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function outline(model, xml) {
    var out = [];
    if (!model) return out;
    var find = lineFinder(xml);
    var childrenAt = find(['<ChildObjects>'], 1) || 1;
    /* The object itself heads the list: selecting it shows its own properties. */
    out.push({
        type: 'form', tag: 'MdObject', itemKind: 'metadata', mdKind: model.kind, object: true,
        id: 'object', name: model.name, title: model.name, line: find(['<Name>'], 1) || 1,
        depth: 0, hasChildren: false, node: model.object
    });
    function push(node, depth, after) {
        var name = xmlEscape(node.name);
        var needles = node.ref ? ['>' + xmlEscape(node.ref) + '<']
            : node.key ? ['StandardAttribute name="' + node.key + '"']
            : ['<Name>' + name + '</Name>', '<' + node.kind + '>' + name + '</' + node.kind + '>'];
        var line = find(needles, node.key ? 1 : after) || after;
        out.push({
            type: 'form', tag: 'Md' + node.kind, itemKind: 'metadata', mdKind: node.kind, refClass: node.refClass || '',
            id: node.id, name: node.name, title: node.name, typeName: node.type,
            line: line, depth: depth, hasChildren: node.children.length > 0, node: node
        });
        for (var i = 0; i < node.children.length; i++) push(node.children[i], depth + 1, line);
    }
    for (var g = 0; g < model.groups.length; g++) {
        var group = model.groups[g];
        out.push({
            type: 'form', tag: 'MdGroup', itemKind: 'metadata', mdKind: group.kind, group: true,
            id: group.id, name: group.title, title: group.title, line: childrenAt, depth: 0,
            hasChildren: group.items.length > 0, group_: group
        });
        for (var i = 0; i < group.items.length; i++) push(group.items[i], 1, childrenAt);
    }
    return out;
}

function byName(list) {
    return list.slice().sort(function (a, b) {
        return String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
    });
}

/* Sorting by name keeps the tree: groups stay in the Designer's order and the
 * members of each group (and the columns of each tabular section) are sorted
 * among themselves. */
function outlineSortByName(items) {
    var roots = [];
    var stack = [];
    for (var i = 0; i < items.length; i++) {
        var node = { item: items[i], kids: [] };
        var depth = items[i].depth || 0;
        while (stack.length && (stack[stack.length - 1].item.depth || 0) >= depth) stack.pop();
        (stack.length ? stack[stack.length - 1].kids : roots).push(node);
        stack.push(node);
    }
    var out = [];
    function walk(list, sorted) {
        var order = sorted ? list.slice().sort(function (a, b) {
            return String(a.item.name).toLowerCase().localeCompare(String(b.item.name).toLowerCase());
        }) : list;
        for (var k = 0; k < order.length; k++) {
            out.push(order[k].item);
            walk(order[k].kids, true);
        }
    }
    walk(roots, false);
    return out;
}

function outlineHidden(items, index, collapsed) {
    if (!items || !collapsed || index < 0) return false;
    var d = items[index].depth || 0;
    for (var i = index - 1; i >= 0 && d > 0; i--) {
        var pd = items[i].depth || 0;
        if (pd < d) {
            if (items[i].id && collapsed[items[i].id]) return true;
            d = pd;
        }
    }
    return false;
}

function outlineExpandTo(items, id, collapsed) {
    if (!items || !id || !collapsed) return false;
    var idx = -1;
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return false;
    var d = items[idx].depth || 0;
    var changed = false;
    for (var j = idx - 1; j >= 0 && d > 0; j--) {
        var pd = items[j].depth || 0;
        if (pd < d) {
            if (items[j].id && collapsed[items[j].id]) {
                delete collapsed[items[j].id];
                changed = true;
            }
            d = pd;
        }
    }
    return changed;
}

function outlineCollapseAll(items, collapsed) {
    for (var k in collapsed) {
        if (Object.prototype.hasOwnProperty.call(collapsed, k)) delete collapsed[k];
    }
    for (var i = 0; items && i < items.length; i++) {
        if (items[i].hasChildren && items[i].id) collapsed[items[i].id] = true;
    }
    return collapsed;
}

/* The Designer's own tree pictures: frames of the platform's metadata strip
 * (std-pictures/ObektyMetadannykh.png, «ОбъектыМетаданных», 16x16 each), by frame index. */
var STRIP = 'std-pictures/ObektyMetadannykh.png';
var ICONS = {
    Attribute: 52, Dimension: 65, Resource: 67, AddressingAttribute: 52, AccountingFlag: 52,
    ExtDimensionAccountingFlag: 52, Column: 52, EnumValue: 1, TabularSection: 55, Form: 59,
    Command: 82, Template: 81, Recalculation: 52, Operation: 52, URLTemplate: 52,
    StandardAttribute: 52, Predefined: 1, Owners: 4, Subordinates: 4, RegisterRecords: 14, Registrars: 5,
    BasedOn: 5, BasisFor: 5, Linked: 3, Journals: 6, Sequences: 94, Subsystems: 2, FunctionalOptions: 26,
    EventSubscriptions: 83, DefinedTypes: 29, FilterCriteria: 25
};
var KIND_ICONS = {
    Constant: 3, Catalog: 4, Document: 5, DocumentJournal: 6, Enum: 7, Report: 8, ExternalReport: 8,
    DataProcessor: 9, ExternalDataProcessor: 9, ChartOfCharacteristicTypes: 10, ChartOfAccounts: 11,
    ChartOfCalculationTypes: 12, InformationRegister: 13, AccumulationRegister: 14,
    AccountingRegister: 15, CalculationRegister: 16, BusinessProcess: 17, Task: 18,
    CommonModule: 21, Role: 22, ExchangePlan: 23, Subsystem: 2, FilterCriterion: 25, EventSubscription: 83,
    DocumentNumerator: 94, DefinedType: 29, FunctionalOption: 26, Sequence: 94
};

function spriteStyle(frame) {
    return frame == null ? '' : 'background-image:url("' + STRIP + '");background-position:-' + (frame * 16) + 'px 0';
}

/* A typed node (attribute, dimension, column...) takes the same picture its
 * type gets in the form viewer's attribute list: string, number, date,
 * boolean, a catalog or document reference. */
function typeIcon(typeName) {
    var forms = root.FormPreview;
    return typeName && forms && forms.attributeIcon ? forms.attributeIcon(typeName) : null;
}

function outlineIcon(it) {
    var typed = it && !it.object && !it.group ? typeIcon(it.typeName) : null;
    if (typed) return typed;
    var frame = it && it.object ? KIND_ICONS[it.mdKind] : it && it.refClass ? KIND_ICONS[it.refClass]
        : ICONS[it && it.mdKind];
    return frame == null ? { cls: 'md-icon', icon: 'box' } : { cls: 'md-icon md-sprite', sprite: spriteStyle(frame) };
}

function itemKey(it) {
    return it ? String(it.id || '') : '';
}

// ---------------------------------------------------------------- inspector

/* Rights as the Designer's role editor names them. */
var RIGHT_TITLES = {
    Read: 'Чтение', Insert: 'Добавление', Update: 'Изменение', Delete: 'Удаление', View: 'Просмотр',
    Edit: 'Редактирование', Use: 'Использование', Get: 'Получение', Set: 'Установка',
    InputByString: 'Ввод по строке', Posting: 'Проведение', UndoPosting: 'Отмена проведения',
    InteractiveInsert: 'Интерактивное добавление', InteractiveDelete: 'Интерактивное удаление',
    InteractiveSetDeletionMark: 'Интерактивная пометка удаления',
    InteractiveClearDeletionMark: 'Интерактивное снятие пометки удаления',
    InteractiveDeleteMarked: 'Интерактивное удаление помеченных',
    InteractivePosting: 'Интерактивное проведение',
    InteractivePostingRegular: 'Интерактивное проведение неоперативное',
    InteractiveUndoPosting: 'Интерактивная отмена проведения',
    InteractiveChangeOfPosted: 'Интерактивное изменение проведенных',
    InteractiveInsertFolder: 'Интерактивное добавление групп',
    InteractiveDeletePredefinedData: 'Интерактивное удаление предопределенных данных',
    InteractiveSetDeletionMarkPredefinedData: 'Интерактивная пометка удаления предопределенных данных',
    InteractiveClearDeletionMarkPredefinedData: 'Интерактивное снятие пометки удаления предопределенных данных',
    InteractiveDeleteMarkedPredefinedData: 'Интерактивное удаление помеченных предопределенных данных',
    InteractiveActivate: 'Интерактивная активация', InteractiveStart: 'Интерактивный старт',
    InteractiveExecute: 'Интерактивное выполнение', Start: 'Старт', Execute: 'Выполнение',
    TotalsControl: 'Управление итогами', ReadDataHistory: 'Чтение истории данных',
    ViewDataHistory: 'Просмотр истории данных', UpdateDataHistory: 'Изменение истории данных',
    UpdateDataHistorySettings: 'Изменение настроек истории данных',
    UpdateDataHistoryOfMissingData: 'Изменение истории данных отсутствующих данных',
    UpdateDataHistoryVersionComment: 'Изменение комментария версии истории данных',
    EditDataHistoryVersionComment: 'Редактирование комментария версии истории данных',
    SwitchToDataHistoryVersion: 'Переход на версию истории данных',
    ReadDataHistoryOfMissingData: 'Чтение истории данных отсутствующих данных'
};

/* The Roles tab of the structure panel: one row per role that grants
 * anything on the object (metadata-relations.js loadRoles). */
function rolesOutline(roles) {
    return (roles || []).map(function (r) {
        var restricted = r.rights.some(function (x) { return x.restricted; });
        return {
            type: 'form', tag: 'MdRole', itemKind: 'metadata', mdKind: 'Role', refClass: 'Role',
            id: 'role:' + r.role, name: r.role, title: r.title || r.role, line: 1, depth: 0, hasChildren: false,
            typeName: r.rights.length + (restricted ? ' · RLS' : ''), role: r
        };
    });
}

function rightTitle(name) {
    return RIGHT_TITLES[name] || name;
}

/* The rights the roles grant, in the role editor's order (unknown ones last,
 * as written) — the checkboxes of the Roles tab filter. */
function rightsInOrder(roles) {
    var seen = {};
    var extra = [];
    (roles || []).forEach(function (r) {
        r.rights.forEach(function (x) {
            if (seen[x.name]) return;
            seen[x.name] = true;
            if (!RIGHT_TITLES[x.name]) extra.push(x.name);
        });
    });
    return Object.keys(RIGHT_TITLES).filter(function (k) { return seen[k]; }).concat(extra);
}

function inspector(entry) {
    if (!entry) return null;
    if (entry.role) {
        var role = entry.role;
        return {
            name: role.title || role.role, typeName: 'Роль ' + role.role, heading: 'Права на объект',
            rows: role.rights.map(function (x) {
                return { label: rightTitle(x.name), value: x.restricted ? 'Да, с ограничением (RLS)' : 'Да' };
            }),
            groups: [], open: role.path, openTitle: 'Открыть роль'
        };
    }
    if (entry.group) {
        var group = entry.group_ || {};
        return {
            name: entry.name, typeName: '', heading: 'Состав',
            /* Typed members read as name → type; the rest (forms, templates)
             * as kind → name, so a long name never lands in the label column
             * with nothing beside it. */
            rows: (group.items || []).map(function (it) {
                var detail = it.type || (it.synonym !== it.name ? it.synonym : '');
                return detail ? { label: it.name, value: detail } : { label: it.kindTitle, value: it.name };
            }),
            groups: []
        };
    }
    var node = entry.node;
    if (!node) return null;
    if (entry.object) {
        var own = [{ label: 'Имя', value: node.name }];
        if (node.synonym) own.push({ label: 'Синоним', value: node.synonym });
        if (node.comment) own.push({ label: 'Комментарий', value: node.comment });
        return {
            name: node.name, typeName: node.kindTitle, heading: 'Свойства', rows: own,
            groups: node.properties.length ? [{
                label: 'Свойства объекта (' + node.properties.length + ')', open: true,
                items: node.properties.map(function (r) { return { label: r.label, value: r.value }; })
            }] : []
        };
    }
    if (node.kind === 'Ref') {
        var refRows = [{ label: 'Объект', value: node.name }, { label: 'Вид', value: node.kindTitle }];
        if (node.synonym) refRows.push({ label: node.hintLabel || 'Синоним', value: node.synonym });
        return {
            name: node.name, typeName: node.kindTitle, heading: 'Свойства', rows: refRows, groups: [],
            open: node.open, openTitle: 'Открыть объект'
        };
    }
    var rows = [{ label: 'Имя', value: node.name }];
    if (node.synonym) rows.push({ label: 'Синоним', value: node.synonym });
    if (node.comment) rows.push({ label: 'Комментарий', value: node.comment });
    if (node.type) rows.push({ label: 'Тип', value: node.type });
    var groups = [];
    if (node.children.length) {
        groups.push({
            label: 'Реквизиты (' + node.children.length + ')', open: true,
            items: node.children.map(function (c) { return { label: c.name, value: c.type || '' }; })
        });
    }
    if (node.properties.length) {
        groups.push({
            label: 'Прочие свойства', open: !node.children.length,
            items: node.properties.map(function (r) { return { label: r.label, value: r.value }; })
        });
    }
    return {
        name: node.name, typeName: node.kindTitle, heading: 'Свойства', rows: rows, groups: groups,
        open: node.open, openTitle: node.kind === 'Template' ? 'Открыть макет'
            : node.kind === 'Command' ? 'Открыть модуль команды' : 'Открыть форму'
    };
}

// ------------------------------------------------------------------- render

function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function spriteEl(frame) {
    var span = el('span', 'md-icon md-sprite');
    if (frame != null) span.setAttribute('style', spriteStyle(frame));
    return span;
}

function iconEl(kind, typeName, refClass) {
    if (refClass) return spriteEl(KIND_ICONS[refClass]);
    var typed = typeIcon(typeName);
    if (!typed) return spriteEl(ICONS[kind]);
    if (typed.asset) {
        var img = el('img', 'md-icon ' + typed.cls);
        img.src = typed.asset;
        img.alt = '';
        return img;
    }
    if (typed.ch) return el('span', 'md-icon md-type-ch ' + typed.cls, typed.ch);
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'md-icon md-type-svg ' + typed.cls);
    var use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + (typed.icon || 'box'));
    svg.appendChild(use);
    return svg;
}

function field(label, value) {
    var row = el('div', 'md-field');
    row.appendChild(el('label', 'md-field-label', label));
    var box = el('div', 'md-input', value || '');
    box.title = value || '';
    row.appendChild(box);
    return row;
}

function render(model, container, options) {
    options = options || {};
    container.innerHTML = '';
    container.className = 'md-root';
    if (!model) {
        container.appendChild(el('div', 'md-empty', 'Нет модели объекта'));
        return;
    }
    var win = el('div', 'md-window');
    var caption = el('div', 'md-caption');
    if (KIND_ICONS[model.kind] != null) caption.appendChild(spriteEl(KIND_ICONS[model.kind]));
    caption.appendChild(el('span', '', model.kindTitle + ': ' + model.name));
    caption.title = 'Свойства объекта';
    caption.addEventListener('click', function () { select('object', true); });
    win.appendChild(caption);
    var body = el('div', 'md-body');
    win.appendChild(body);

    body.appendChild(field('Имя:', model.name));
    body.appendChild(field('Синоним:', model.synonym));
    body.appendChild(field('Комментарий:', model.comment));

    function open(rel) {
        if (rel && options.onOpen) options.onOpen(rel);
    }

    if (model.forms.length) {
        var box = el('fieldset', 'md-forms');
        box.appendChild(el('legend', '', 'Формы'));
        for (var f = 0; f < model.forms.length; f++) {
            var form = model.forms[f];
            var row = el('div', 'md-field');
            row.appendChild(el('label', 'md-field-label', form.label + ':'));
            var value = el('div', 'md-input');
            var target = form.formId && model.nodes[form.formId];
            if (target && target.open && options.onOpen) {
                var link = el('a', 'md-link', form.value);
                link.href = '#';
                link.title = 'Открыть форму';
                link.addEventListener('click', (function (rel) {
                    return function (e) { e.preventDefault(); open(rel); };
                })(target.open));
                value.appendChild(link);
            } else {
                value.textContent = form.value;
            }
            /* The Designer's magnifier inside the field opens the form. */
            if (target && target.open && options.onOpen) {
                var openBtn = el('button', 'md-field-button');
                openBtn.type = 'button';
                openBtn.title = 'Открыть форму';
                openBtn.addEventListener('click', (function (rel) {
                    return function () { open(rel); };
                })(target.open));
                value.appendChild(openBtn);
            }
            row.appendChild(value);
            box.appendChild(row);
        }
        body.appendChild(box);
    }

    var tree = el('div', 'md-tree');
    tree.tabIndex = 0;
    var rowsById = {};
    var parentsOf = {};

    function addRow(id, depth, kind, isGroup, label, type, hint, hasKids, openRel, refClass) {
        var row = el('div', 'md-row' + (isGroup ? ' md-group' : ''));
        row.setAttribute('data-id', id);
        row.style.paddingLeft = (4 + depth * 18) + 'px';
        var twisty = el('span', 'md-twisty', hasKids ? (viewState.collapsed[id] ? '⊞' : '⊟') : '');
        if (hasKids) twisty.setAttribute('data-fold', id);
        row.appendChild(twisty);
        row.appendChild(iconEl(kind, isGroup ? '' : type, refClass));
        row.appendChild(el('span', 'md-name', label));
        if (type) row.appendChild(el('span', 'md-type', type));
        if (hint) row.title = hint;
        if (openRel) {
            row.setAttribute('data-open', openRel);
            /* A command need not have a module of its own. */
            if (kind === 'Command' && options.probe) {
                options.probe(openRel).then(function (exists) {
                    if (!exists) row.removeAttribute('data-open');
                });
            }
        }
        tree.appendChild(row);
        rowsById[id] = row;
        return row;
    }

    var ordered = options.sortByName ? byName : function (list) { return list; };
    for (var g = 0; g < model.groups.length; g++) {
        var group = model.groups[g];
        /* The window keeps the object's own structure; commands, standard
         * attributes and relations live in the structure panel only. */
        if (!WINDOW_GROUPS[group.kind]) continue;
        addRow(group.id, 0, group.kind, true, group.title, '', '', group.items.length > 0, '');
        var groupItems = ordered(group.items);
        for (var i = 0; i < groupItems.length; i++) {
            var node = groupItems[i];
            parentsOf[node.id] = [group.id];
            addRow(node.id, 1, node.kind, false, node.name, node.type,
                node.synonym && node.synonym !== node.name ? node.synonym : '', node.children.length > 0, node.open,
                node.refClass);
            var columns = ordered(node.children);
            for (var c = 0; c < columns.length; c++) {
                var col = columns[c];
                parentsOf[col.id] = [group.id, node.id];
                addRow(col.id, 2, col.kind, false, col.name, col.type,
                    col.synonym && col.synonym !== col.name ? col.synonym : '', false, '');
            }
        }
    }

    function applyFolds() {
        for (var id in rowsById) {
            if (!Object.prototype.hasOwnProperty.call(rowsById, id)) continue;
            var hidden = false;
            var parents = parentsOf[id] || [];
            for (var p = 0; p < parents.length; p++) hidden = hidden || !!viewState.collapsed[parents[p]];
            rowsById[id].style.display = hidden ? 'none' : '';
            var tw = rowsById[id].firstChild;
            if (tw && tw.getAttribute('data-fold'))
                tw.textContent = viewState.collapsed[id] ? '⊞' : '⊟';
        }
    }

    function select(id, notify) {
        viewState.selected = id || '';
        caption.classList.toggle('md-selected', viewState.selected === 'object');
        for (var key in rowsById) {
            if (Object.prototype.hasOwnProperty.call(rowsById, key))
                rowsById[key].classList.toggle('md-selected', key === viewState.selected);
        }
        if (notify && options.onSelect) options.onSelect({ id: id });
    }

    tree.addEventListener('click', function (e) {
        var row = e.target.closest && e.target.closest('.md-row');
        if (!row) return;
        var id = row.getAttribute('data-id');
        var fold = e.target.closest('.md-twisty');
        if (fold && fold.getAttribute('data-fold')) {
            if (viewState.collapsed[id]) delete viewState.collapsed[id];
            else viewState.collapsed[id] = true;
            applyFolds();
            return;
        }
        select(id, true);
    });
    tree.addEventListener('dblclick', function (e) {
        var row = e.target.closest && e.target.closest('.md-row');
        if (!row) return;
        var rel = row.getAttribute('data-open');
        if (rel) { open(rel); return; }
        var id = row.getAttribute('data-id');
        if (row.querySelector('.md-twisty[data-fold]')) {
            if (viewState.collapsed[id]) delete viewState.collapsed[id];
            else viewState.collapsed[id] = true;
            applyFolds();
        }
    });
    tree.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || !viewState.selected) return;
        var row = rowsById[viewState.selected];
        var rel = row && row.getAttribute('data-open');
        if (rel) { e.preventDefault(); open(rel); }
    });

    body.appendChild(tree);

    if ((model.modules.length && options.onOpen) || options.onHelp) {
        var footer = el('div', 'md-footer');
        /* The Designer's «Справка»: shown by the host once it knows the
         * object has help pages. */
        if (options.onHelp) {
            var help = el('button', 'md-button md-help-button');
            help.type = 'button';
            help.hidden = true;
            help.appendChild(el('span', '', 'Справка'));
            help.addEventListener('click', function () { options.onHelp(); });
            footer.appendChild(help);
        }
        for (var m = 0; m < model.modules.length; m++) {
            var button = el('button', 'md-button');
            button.type = 'button';
            button.appendChild(el('span', '', model.modules[m].title));
            /* Modules are optional: hide the button once the host says the
             * file is not there. */
            if (options.probe) {
                (function (btn, rel) {
                    options.probe(rel).then(function (exists) { if (!exists) btn.hidden = true; });
                })(button, model.modules[m].open);
            }
            button.addEventListener('click', (function (rel) {
                return function () { open(rel); };
            })(model.modules[m].open));
            footer.appendChild(button);
        }
        body.appendChild(footer);
    }

    container.appendChild(win);
    applyFolds();
    if (viewState.selected && rowsById[viewState.selected]) select(viewState.selected, false);
    container._mdSelect = function (id) {
        var parents = parentsOf[id] || [];
        var changed = false;
        for (var p = 0; p < parents.length; p++) {
            if (viewState.collapsed[parents[p]]) { delete viewState.collapsed[parents[p]]; changed = true; }
        }
        if (changed) applyFolds();
        select(id, false);
        var row = rowsById[id];
        if (row && row.scrollIntoView) {
            try { row.scrollIntoView({ block: 'nearest' }); } catch (err) { row.scrollIntoView(); }
        }
        return row || null;
    };
}

function highlight(container, id) {
    if (!container || !container._mdSelect) return null;
    return container._mdSelect(String(id || ''));
}

root.MetadataPreview = {
    detect: detect,
    parse: parse,
    render: render,
    outline: outline,
    outlineIcon: outlineIcon,
    outlineHidden: outlineHidden,
    outlineExpandTo: outlineExpandTo,
    outlineCollapseAll: outlineCollapseAll,
    outlineSortByName: outlineSortByName,
    highlight: highlight,
    itemKey: itemKey,
    rolesOutline: rolesOutline,
    rightTitle: rightTitle,
    rightsInOrder: rightsInOrder,
    inspector: inspector,
    resetViewState: resetViewState,
    typePresentation: typePresentation
};

})(window);
