/* Visual preview of 1C managed forms (Designer Ext/Form.xml).
 *
 * Layout and widget mockups follow CDT 41 form editor
 * (https://github.com/lekot/VScodePluginFor1CDev, MIT).
 * This module is read-only: it does not write XML back. */
(function (root) {
'use strict';

var CONTAINER_TAGS = {
    UsualGroup: 1, Pages: 1, Page: 1, Table: 1, AutoCommandBar: 1,
    CommandBar: 1, Form: 1, Group: 1, CollapsibleGroup: 1, ButtonGroup: 1, Popup: 1,
    ColumnGroup: 1
};
var SKIP_TAGS = {
    ChildItems: 1, Events: 1, Attributes: 1, Commands: 1, Parameters: 1,
    CommandSet: 1, ExtendedTooltip: 1, ContextMenu: 1
};
var EXTRA_CHILD_TAGS = ['AutoCommandBar', 'SearchStringAddition', 'ViewStatusAddition',
    'SearchControlAddition', 'ExtendedTooltip', 'ContextMenu'];
/* Font-like properties carry everything in attributes, so scalarOf() would drop
 * them; they are parsed separately into `<Tag>Spec` keys that prop() never sees. */
var FONT_TAGS = {
    Font: 'FontSpec', TitleFont: 'TitleFontSpec', HeaderFont: 'HeaderFontSpec',
    FooterFont: 'FooterFontSpec'
};
/* Schema-complex values that also need their complete authored XML shape.
 * Existing renderer projections remain in properties; this mirror is shared
 * by every owner type and intentionally includes empty/nil values. */
var STRUCTURED_COMPLEX_TAGS = {
    UserVisible: 1, CommandSet: 1, FooterPicture: 1, ChoiceButtonPicture: 1,
    MultipleValuesFont: 1, MultipleValuesPicture: 1, MinValue: 1, MaxValue: 1,
    ChoiceParameterLinks: 1, ChoiceParameters: 1, AvailableTypes: 1,
    ChoiceList: 1, TypeLink: 1, Parameter: 1, BeginOfRepresentationPeriod: 1,
    EndOfRepresentationPeriod: 1, Border: 1, MobileDeviceCommandBarContent: 1,
    AssociatedTableElementId: 1, Period: 1, TopLevelParent: 1, RowFilter: 1,
    Source: 1, AdditionSource: 1, BackPicture: 1, CreateButtonsGroupPicture: 1,
    WindowViewMode: 1, CollapsedRepresentationItem: 1
};
var CHAR_PX = 8;
var DEFAULT_FIELD_CHARS = 20;
/* Reference Taxi layout constants and property defaults. Unknown DataPath
 * still uses DEFAULT_FIELD_CHARS so fields without metadata do not collapse
 * to the 4-char "property info missing" fallback. */
var TYPE_DEFAULT_MULTI_CHARS = 15;
var TYPE_DEFAULT_REF_CHARS = 15;
var TYPE_DEFAULT_MAX_CHARS = 40;
var TYPE_DEFAULT_MIN_CHARS = 6;
var TYPE_DEFAULT_PICTURE_CHARS = 2;
var TYPE_PRESENTATION_LENGTH_CAP = 50;
var TYPE_BOOLEAN_CHARS = 10;
var TYPE_GEOGRAPHICAL_SCHEMA_CHARS = 20;
var TYPE_TABLE_NUMBER_HEADER_CHARS = 10;
var TYPE_TABLE_STRING_HEADER_CHARS = 20;
/* The type presentation length, then the property defaults
 * subtracts 7/3/2 and (compat > 8.3.6) adds 2 → Taxi 17/9/8. */
var TYPE_DATE_PRESENTATION_CHARS = 10;
var TYPE_TIME_PRESENTATION_CHARS = 8;
var TYPE_DATETIME_PRESENTATION_CHARS = 22;
/* The reference char-unit ruler micro-form resolves Width 5/10/20/40 to
 * 60/110/210/410 px. The browser keeps its established 8px rendering grid,
 * but responsive decisions must see the reference's 10px authored normal-width grid. */
var REF_AUTHORED_CHAR_PX = 10;
var ROW_PX = 18;
/* The reference Taxi layout uses different spacing scales on the two axes.
 * These are layout units at the baseline browser profile; font-dependent
 * element sizes are still measured from the DOM instead of copied verbatim.
 * The vertical Half/OneAndHalf steps are the large-font 4.5/13.5 of the reference
 * layout contract rounded up, not accumulated: the reference paints every Half gap as
 * a full 5px band. This is visible on #F0F0F0 column groups holding white
 * cards, where the gap itself is the grey separator between them - carrying
 * 4.5 through instead leaves the second and third band a pixel short. */
var TAXI_LAYOUT_METRICS = {
    horizontalSpacing: { none: 0, half: 5, single: 10, oneandhalf: 15, double: 20 },
    verticalSpacing: { none: 0, half: 5, single: 9, oneandhalf: 14, double: 18 },
    averageCharacterWidth: 10,
    /* An automatic input publishes a 40-unit value lane plus the editor's
     * horizontal inset when an authored AlwaysHorizontal row owns scrolling. */
    automaticEditorPresentationWidth: 410,
    commandBarHeight: 27,
    textBoxLineHeight: 30,
    textBoxChromeHeight: 5,
    checkBoxHeight: 17,
    radioButtonHeight: 17,
    buttonHeight: 27,
    buttonCaptionChromeWidth: 27,
    iconButtonWidth: 28,
    /* A button-style extended tooltip owns an 8px help glyph after a 7px
     * flex gap. The authored editor maximum is a content lane, so its two
     * one-pixel borders remain part of the painted editor envelope. */
    tooltipButtonWidth: 8,
    tooltipButtonGap: 7,
    inputBorderChromeWidth: 2,
    authoredEditorInsetWidth: 10,
    /* AutoMaxWidth=false + MaxWidth: the platform TextBox paints the full
     * char-unit ruler band MaxWidth*10+10 (MaxWidth 12/14/16/17/28/29/34 ->
     * 130/150/170/180/290/300/350), with or without choice/clear buttons.
     * A 6px inset instead leaves such fields 4px narrow. */
    autoMaxEditorPaintInset: 10,
    inputButtonLaneWidth: 21,
    viewStatusHeight: 23,
    sideTitleGap: 5,
    topTitleGap: 4,
    compactRowGap: 3,
    rowGap: 9,
    logicalColumnAllocationGap: 10,
    pagePadding: { horizontal: 10, vertical: 9 },
    /* ThroughAlign side-title cell beyond the glyph: pagePadding (10) plus the
     * 1px field-item selection shell. The editor border must not be added on
     * top — it lives inside the measured frame (a 161.6px glyph puts the
     * editor at x=191, track 173). */
    throughAlignTitleChrome: 11,
    /* Win32/reference window bounds exceed the managed form client by this amount.
     * This is host chrome, not an inset of the form layout coordinate space. */
    windowChrome: { width: 21, height: 44 },
    compressedElementMinimumWidth: 10,
    compressedFieldMinimumWidth: 71,
    /* The char-unit ruler keeps an input editor at roughly 70 px when the reference
     * evaluates the later responsive fallbacks. This decision width must not
     * leak into the browser's ordinary dimension allocator. */
    responsiveCompressedElementMinimumWidth: 70,
    /* TitleOnTop compresses a long automatic caption to about 97 px at
     * the last left-title width before promoting it. */
    compressedTitleMaximumWidth: 100
};
/* The reference layout units are not CSS pixels. The current 12px browser Taxi profile
 * maps one horizontal unit to 0.8px and one vertical unit to 4/3px; this
 * preserves the Single gap while retaining the reference's axis-aware
 * semantic scale (including None and OneAndHalf). */
var TAXI_BROWSER_METRICS = {
    horizontalSpacing: { none: 0, half: 4, single: 8, oneandhalf: 12, double: 16 },
    verticalSpacing: { none: 0, half: 5, single: 9, oneandhalf: 14, double: 18 },
    averageCharacterScale: 0.7
};
/* Horizontal layout strategy values, in increasing order of compression. */
var HORIZONTAL_STRATEGY_VALUES = {
    'auto': 0,
    'smart-compress-to-recommended-width': 3,
    'vertical-grouping': 6,
    'dont-align-buttons': 7,
    'smart-compress-to-min-width': 8,
    'dont-align-titles': 10,
    'titles-on-top': 11,
    'compress-width': 13
};
/* Managed-form container dimensions use the form grid, not the input-field
 * character box. Configurator maps a group's Width to 10 px columns and its
 * Height to 16 px rows at the 12 px Taxi baseline. */
var GROUP_COL_PX = 10;
var GROUP_ROW_PX = 16;
var TABLE_COL_PX = 9;
var RARE_TAGS = {
    TrackBarField: 1, ProgressBarField: 1, TextDocumentField: 1,
    SpreadSheetDocumentField: 1, HTMLDocumentField: 1, ChartField: 1,
    GanttChartField: 1, PlannerField: 1, GraphicalSchemaField: 1,
    FormattedDocumentField: 1, PictureField: 1, CalendarField: 1,
    PeriodField: 1, GeographicsField: 1, PDFDocumentField: 1
};
var FORM_TAGS = {
    InputField: 1, CheckBoxField: 1, RadioButtonField: 1, RadioButton: 1,
    LabelField: 1, LabelDecoration: 1, PictureDecoration: 1, Button: 1,
    Hyperlink: 1, Table: 1, UsualGroup: 1, Pages: 1, Page: 1,
    AutoCommandBar: 1, CommandBar: 1, SearchStringAddition: 1, ValueList: 1,
    ListBox: 1, ListField: 1, ButtonGroup: 1, PictureField: 1, ColumnGroup: 1,
    ViewStatusAddition: 1, SearchControlAddition: 1, Popup: 1
};

var activePageIdByPagesKey = Object.create(null);
var collapsedGroupByKey = Object.create(null);

/* Shared XML helpers live in xml-util.js; aliased locally for brevity. */
var XU = root.XmlUtil;
var localName = XU.localName;
var namedChildren = XU.namedChildren;
var firstChild = XU.firstChild;
var textOf = XU.textOf;

function detect(xml) {
    if (!xml || typeof xml !== 'string') return false;
    if (xml.indexOf('xcf/logform') >= 0) return true;
    if (!/<Form[\s>]/i.test(xml) && !/<form[\s>]/i.test(xml)) return false;
    if (xml.indexOf('<ChildItems') < 0 && xml.indexOf('<AutoCommandBar') < 0) return false;
    for (var tag in FORM_TAGS) {
        if (xml.indexOf('<' + tag) >= 0) return true;
    }
    return false;
}

function localizedFrom(el) {
    /* Localized captions are normally one line, but an explicit newline in
     * v8:content is an authored layout boundary (the reference keeps it in field and
     * decoration titles). Normalize indentation without flattening lines. */
    return XU.localizedFrom(el, function (node) {
        return XU.rawText(node).replace(/[ \t]+/g, ' ')
            .replace(/ *\n */g, '\n').trim();
    });
}

function scalarOf(el) {
    if (!el) return '';
    if (el.children && el.children.length) {
        for (var i = 0; i < el.children.length; i++) {
            if (localName(el.children[i]) === 'item') return localizedFrom(el);
        }
        var parts = [];
        for (var j = 0; j < el.children.length; j++) {
            var t = textOf(el.children[j]);
            if (t) parts.push(t);
        }
        if (parts.length === 1) return parts[0];
        if (parts.length) return parts.join(', ');
    }
    return textOf(el);
}

function absPictureOf(el) {
    if (!el) return '';
    for (var i = 0; i < el.children.length; i++) {
        if (localName(el.children[i]) !== 'Abs') continue;
        var file = textOf(el.children[i]).trim();
        return file ? 'Abs:' + file : '';
    }
    return '';
}

function refOf(el) {
    if (!el) return '';
    for (var i = 0; i < el.children.length; i++) {
        var n = localName(el.children[i]);
        if (n === 'Ref' || n === 'ref') return textOf(el.children[i]);
    }
    return '';
}

/* 1C keeps fonts in attributes: <Font ref="style:..." height="11" bold="true"/>.
 * `kind` is Absolute / StyleItem / WindowsFont; a StyleItem font may still
 * override single traits, so absent attributes stay undefined and only the
 * explicit ones win over whatever the style name suggests. */
function parseFont(el) {
    if (!el) return null;
    function flag(name) {
        var v = el.getAttribute(name);
        if (v == null || v === '') return null;
        return !isFalse(v);
    }
    var height = parseFloat(el.getAttribute('height'));
    var scale = parseFloat(el.getAttribute('scale'));
    var spec = {
        kind: el.getAttribute('kind') || '',
        ref: el.getAttribute('ref') || '',
        faceName: el.getAttribute('faceName') || '',
        height: isNaN(height) ? 0 : height,
        scale: isNaN(scale) ? 0 : scale,
        bold: flag('bold'),
        italic: flag('italic'),
        underline: flag('underline'),
        strikeout: flag('strikeout')
    };
    var authoredKeys = [];
    var fontKeys = ['kind', 'ref', 'faceName', 'height', 'scale', 'bold', 'italic', 'underline', 'strikeout'];
    for (var i = 0; i < fontKeys.length; i++) {
        if (el.getAttribute(fontKeys[i]) != null) authoredKeys.push(fontKeys[i]);
    }
    Object.defineProperty(spec, '_authoredKeys', { value: authoredKeys, enumerable: false });
    if (!spec.ref && !spec.faceName && !spec.height && spec.bold == null
        && spec.italic == null && spec.underline == null && spec.strikeout == null)
        return null;
    return spec;
}

function parseProperties(el) {
    var props = {};
    if (!el) return props;
    for (var i = 0; i < el.children.length; i++) {
        var c = el.children[i];
        var tag = localName(c);
        if (tag === 'CommandSet') {
            props.ExcludedCommands = parseExcludedCommands(c);
            continue;
        }
        if (FONT_TAGS[tag]) {
            var spec = parseFont(c);
            if (spec) props[FONT_TAGS[tag]] = spec;
            continue;
        }
        if (!tag || SKIP_TAGS[tag] || tag === 'ChildItems') continue;
        if (EXTRA_CHILD_TAGS.indexOf(tag) >= 0) continue;
        if (tag === 'Title') {
            props.Title = localizedFrom(c);
            /* Captions are trimmed; a flat button still paints authored leading
             * spaces («   Отправлено за месяц:»), so remember them. */
            var titleLead = /^[ \t]+/.exec(XU.localizedFrom(c, function (node) { return XU.rawText(node); }) || '');
            /* Not an authored property: hidden from the inspector and the writer. */
            if (titleLead) Object.defineProperty(props, 'TitleLeadingSpaces', { value: titleLead[0].length });
            var titleFormatted = c.getAttribute('formatted');
            if (titleFormatted != null && titleFormatted !== '') props.TitleFormatted = titleFormatted;
        }
        else if (tag === 'InputHint') props.InputHint = localizedFrom(c);
        else if (tag === 'ChoiceList') props.ChoiceListItems = parseChoiceList(c);
        else if (tag === 'Picture' || tag === 'HeaderPicture' || tag === 'ValuesPicture' || tag === 'RowsPicture')
            props[tag] = refOf(c) || absPictureOf(c) || scalarOf(c);
        else props[tag] = scalarOf(c);
    }
    return props;
}

function parseItemProperties(el) {
    var props = parseProperties(el);
    var attrs = (el && el.attributes) || [];
    function add(name, value, qualifiedName) {
        if (!name || name === 'name' || name === 'id' || name === 'version'
            || name === 'xmlns' || /^xmlns:/.test(qualifiedName || '')) return;
        props[name] = value == null ? '' : String(value);
    }
    if (typeof attrs.length === 'number') {
        for (var i = 0; i < attrs.length; i++) {
            var attr = attrs[i];
            add(attr.localName || attr.name || '', attr.value, attr.name);
        }
    } else {
        /* The dependency-free test DOM represents NamedNodeMap as a plain
         * object. Supporting both shapes keeps the parser helper testable
         * without changing browser behaviour. */
        for (var key in attrs) {
            if (Object.prototype.hasOwnProperty.call(attrs, key)) add(key, attrs[key], key);
        }
    }
    return props;
}

function copyPropertyMap(properties) {
    var copy = {};
    for (var key in properties || {}) {
        if (Object.prototype.hasOwnProperty.call(properties, key)) copy[key] = properties[key];
    }
    return copy;
}

/* Lossless semantic XML tree for complex values that are not consumed by the
 * renderer yet. Qualified element/attribute names, child order, repetition,
 * attributes and leaf text are retained; insignificant formatting whitespace
 * is intentionally not model data. */
function parseStructuredXmlValue(el) {
    if (!el) return null;
    var value = { name: el.tagName || el.nodeName || localName(el), attributes: {}, children: [] };
    var attrs = el.attributes || [];
    function addAttribute(name, attrValue) {
        if (name) value.attributes[name] = attrValue == null ? '' : String(attrValue);
    }
    if (typeof attrs.length === 'number') {
        for (var i = 0; i < attrs.length; i++) {
            var attr = attrs[i];
            addAttribute(attr.name || attr.nodeName || attr.localName, attr.value);
        }
    } else {
        for (var key in attrs) {
            if (Object.prototype.hasOwnProperty.call(attrs, key)) addAttribute(key, attrs[key]);
        }
    }
    for (var c = 0; el.children && c < el.children.length; c++)
        value.children.push(parseStructuredXmlValue(el.children[c]));
    if (!value.children.length) value.text = textOf(el);
    return value;
}

function parseStructuredProperties(el) {
    var out = {};
    if (!el) return out;
    for (var i = 0; i < el.children.length; i++) {
        var child = el.children[i];
        var name = localName(child);
        if (!STRUCTURED_COMPLEX_TAGS[name]) continue;
        var value = parseStructuredXmlValue(child);
        if (!Object.prototype.hasOwnProperty.call(out, name)) out[name] = value;
        else if (Array.isArray(out[name])) out[name].push(value);
        else out[name] = [out[name], value];
    }
    return out;
}

function structuredLocalName(value) {
    var name = value && value.name != null ? String(value.name) : '';
    var colon = name.indexOf(':');
    return colon >= 0 ? name.slice(colon + 1) : name;
}

function structuredAttribute(value, name) {
    var attrs = value && value.attributes;
    if (!attrs) return '';
    var wanted = String(name || '').toLowerCase();
    for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        var local = key.indexOf(':') >= 0 ? key.slice(key.indexOf(':') + 1) : key;
        if (local.toLowerCase() === wanted) return String(attrs[key] == null ? '' : attrs[key]);
    }
    return '';
}

function structuredChildren(value, name) {
    var children = (value && value.children) || [];
    if (!name) return children.slice();
    var wanted = String(name).toLowerCase();
    return children.filter(function (child) {
        return structuredLocalName(child).toLowerCase() === wanted;
    });
}

function structuredDescendants(value, names) {
    var wanted = {};
    for (var i = 0; i < names.length; i++) wanted[String(names[i]).toLowerCase()] = true;
    var out = [];
    function walk(node) {
        var children = (node && node.children) || [];
        for (var c = 0; c < children.length; c++) {
            if (wanted[structuredLocalName(children[c]).toLowerCase()]) out.push(children[c]);
            walk(children[c]);
        }
    }
    walk(value);
    return out;
}

function structuredIsNil(value) {
    return /^(true|1)$/i.test(structuredAttribute(value, 'nil'));
}

function structuredText(value) {
    return String(value && value.text != null ? value.text : '').trim();
}

function structuredHasPayload(value, ignoredNames) {
    if (!value || structuredIsNil(value)) return false;
    var ignored = {};
    for (var i = 0; ignoredNames && i < ignoredNames.length; i++)
        ignored[String(ignoredNames[i]).toLowerCase()] = true;
    if (structuredText(value)) return true;
    var attrs = value.attributes || {};
    for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        var local = key.indexOf(':') >= 0 ? key.slice(key.indexOf(':') + 1) : key;
        if (local.toLowerCase() !== 'type' && local.toLowerCase() !== 'nil'
            && String(attrs[key] == null ? '' : attrs[key]).trim()) return true;
    }
    var children = value.children || [];
    for (var c = 0; c < children.length; c++) {
        if (ignored[structuredLocalName(children[c]).toLowerCase()]) continue;
        if (structuredHasPayload(children[c])) return true;
    }
    return false;
}

function normalizeStructuredPicture(value) {
    if (!value || structuredIsNil(value)) return null;
    var refs = structuredDescendants(value, ['Ref']);
    var ref = refs.length ? structuredText(refs[0]) : structuredText(value);
    if (!ref) return null;
    var transparent = structuredDescendants(value, ['LoadTransparent']);
    return {
        ref: ref,
        loadTransparent: transparent.length ? !/^(false|0)$/i.test(structuredText(transparent[0])) : null
    };
}

function normalizeStructuredBorder(value) {
    if (!value || structuredIsNil(value)) return null;
    var styles = structuredDescendants(value, ['style']);
    var width = parseFloat(structuredAttribute(value, 'width'));
    return {
        width: isNaN(width) ? null : width,
        style: styles.length ? structuredText(styles[0]) : ''
    };
}

function meaningfulPeriodDate(value) {
    value = String(value || '').trim();
    return value && !/^0001-01-01(?:T00:00:00(?:\.0+)?(?:Z|[+-]\d\d:\d\d)?)?$/i.test(value);
}

function normalizeStructuredPeriod(value) {
    if (!value || structuredIsNil(value)) return { active: false, variant: '', begin: '', end: '' };
    var variants = structuredDescendants(value, ['variant']);
    var begins = structuredDescendants(value, ['begin', 'beginDate', 'start', 'startDate',
        'BeginOfRepresentationPeriod']);
    var ends = structuredDescendants(value, ['end', 'endDate', 'finish', 'finishDate',
        'EndOfRepresentationPeriod']);
    var variant = variants.length ? structuredText(variants[0]) : '';
    var begin = begins.length ? structuredText(begins[0]) : '';
    var end = ends.length ? structuredText(ends[0]) : '';
    var custom = /^custom$/i.test(variant);
    var active = custom ? !!(meaningfulPeriodDate(begin) || meaningfulPeriodDate(end))
        : !!(variant || meaningfulPeriodDate(begin) || meaningfulPeriodDate(end)
            || structuredHasPayload(value, ['variant']));
    return { active: active, variant: variant, begin: begin, end: end };
}

function normalizeStructuredRowFilter(value) {
    return { active: structuredHasPayload(value), value: value || null };
}

function normalizeChoiceParameterLinks(value) {
    if (!value || structuredIsNil(value)) return [];
    var items = structuredChildren(value);
    var out = [];
    for (var i = 0; i < items.length; i++) {
        var paths = structuredDescendants(items[i], ['dataPath']);
        var link = {
            name: structuredAttribute(items[i], 'name'),
            mode: structuredAttribute(items[i], 'mode'),
            dataPath: paths.length ? structuredText(paths[0]) : ''
        };
        if (link.name || link.mode || link.dataPath) out.push(link);
    }
    return out;
}

function normalizeChoiceParameters(value) {
    if (!value || structuredIsNil(value)) return [];
    var items = structuredChildren(value);
    var out = [];
    for (var i = 0; i < items.length; i++) {
        var names = structuredDescendants(items[i], ['name']);
        var values = structuredDescendants(items[i], ['value']);
        var nameNode = null;
        var valueNode = null;
        for (var n = 0; n < names.length; n++) {
            if (structuredText(names[n])) { nameNode = names[n]; break; }
        }
        for (var v = 0; v < values.length; v++) {
            if (structuredText(values[v]) || structuredIsNil(values[v])) { valueNode = values[v]; break; }
        }
        var parameter = {
            name: nameNode ? structuredText(nameNode) : structuredAttribute(items[i], 'name'),
            value: valueNode && !structuredIsNil(valueNode) ? structuredText(valueNode) : null,
            type: valueNode ? structuredAttribute(valueNode, 'type') : ''
        };
        if (parameter.name || parameter.value != null || parameter.type) out.push(parameter);
    }
    return out;
}

function applyStructuredRuntime(item) {
    var values = item && item.structuredProperties;
    if (!values) return item;
    var runtime = {};
    if (item.tag === 'Table') {
        if (values.Period) runtime.period = normalizeStructuredPeriod(values.Period);
        if (values.RowFilter) runtime.rowFilter = normalizeStructuredRowFilter(values.RowFilter);
    }
    if (item.tag === 'InputField') {
        if (values.ChoiceParameterLinks)
            runtime.choiceParameterLinks = normalizeChoiceParameterLinks(values.ChoiceParameterLinks);
        if (values.ChoiceParameters)
            runtime.choiceParameters = normalizeChoiceParameters(values.ChoiceParameters);
    }
    if (values.FooterPicture) runtime.footerPicture = normalizeStructuredPicture(values.FooterPicture);
    if (values.BackPicture) runtime.backPicture = normalizeStructuredPicture(values.BackPicture);
    if (values.CreateButtonsGroupPicture)
        runtime.createButtonsGroupPicture = normalizeStructuredPicture(values.CreateButtonsGroupPicture);
    if (values.Border) runtime.border = normalizeStructuredBorder(values.Border);
    if (Object.keys(runtime).length) item.runtime = runtime;
    return item;
}

function parseChildItems(section) {
    var out = [];
    if (!section) return out;
    for (var i = 0; i < section.children.length; i++) {
        var el = section.children[i];
        var tag = localName(el);
        if (!tag || SKIP_TAGS[tag]) continue;
        out.push(parseElement(el));
    }
    return out;
}

/* Form.xml stores event identifiers in the platform's English schema names,
 * while the configurator shows their Russian event names. Keep this lookup
 * at the presentation boundary: event identity and handler navigation still
 * use the original XML identifier. The aliases cover names emitted by older
 * form exports as well as the current schema. Unknown/custom identifiers are
 * deliberately left untouched. */
var EVENT_TITLES = {
    /* Form events. */
    OnCreateAtServer: 'ПриСозданииНаСервере',
    OnOpen: 'ПриОткрытии',
    BeforeClose: 'ПередЗакрытием',
    OnClose: 'ПриЗакрытии',
    BeforeWrite: 'ПередЗаписью',
    BeforeWriteAtServer: 'ПередЗаписьюНаСервере',
    OnWriteAtServer: 'ПриЗаписиНаСервере',
    AfterWriteAtServer: 'ПослеЗаписиНаСервере',
    AfterWrite: 'ПослеЗаписи',
    OnReadAtServer: 'ПриЧтенииНаСервере',
    NotificationProcessing: 'ОбработкаОповещения',
    ChoiceProcessing: 'ОбработкаВыбора',
    NewWriteProcessing: 'ОбработкаЗаписиНового',
    NewObjectWriteProcessing: 'ОбработкаЗаписиНовогоОбъекта',
    ActivationProcessing: 'ОбработкаАктивизации',
    RefreshRequestProcessing: 'ОбработкаЗапросаОбновления',
    FillCheckProcessing: 'ОбработкаПроверкиЗаполнения',
    FillCheckProcessingAtServer: 'ОбработкаПроверкиЗаполненияНаСервере',
    BeforeLoadDataFromSettingsAtServer: 'ПередЗагрузкойДанныхИзНастроекНаСервере',
    OnLoadDataFromSettingsAtServer: 'ПриЗагрузкеДанныхИзНастроекНаСервере',
    OnLoadUserSettingsAtServer: 'ПриЗагрузкеПользовательскихНастроекНаСервере',
    OnSaveDataInSettingsAtServer: 'ПриСохраненииДанныхВНастройкахНаСервере',
    OnSaveUserSettingsAtServer: 'ПриСохраненииПользовательскихНастроекНаСервере',
    URLProcessing: 'ОбработкаНавигационнойСсылки',
    NavigationProcessing: 'ОбработкаПерехода',
    OnChangeDisplaySettings: 'ПриИзмененииПараметровЭкрана',
    OnReopen: 'ПриПовторномОткрытии',
    ExternalEvent: 'ВнешнееСобытие',

    /* Fields, buttons and decorations. */
    OnChange: 'ПриИзменении',
    StartChoice: 'НачалоВыбора',
    Choice: 'Выбор',
    ValueChoice: 'ВыборЗначения',
    ChoiceFromList: 'ВыборИзСписка',
    ChoiceProcessingAtServer: 'ОбработкаВыбораНаСервере',
    AutoComplete: 'АвтоПодбор',
    Clearing: 'Очистка',
    Opening: 'Открытие',
    Click: 'Нажатие',
    OnClick: 'Нажатие',
    TextEditEnd: 'ОкончаниеВводаТекста',
    EditTextChange: 'ИзменениеТекста',
    Creating: 'Создание',
    OnStartEdit: 'ПриНачалеРедактирования',
    OnEditEnd: 'ПриОкончанииРедактирования',
    OnEndEdit: 'ПриОкончанииРедактирования',
    BeforeEditEnd: 'ПередОкончаниемРедактирования',

    /* Tables and pages. */
    Selection: 'Выбор',
    OnActivateRow: 'ПриАктивизацииСтроки',
    OnActivateField: 'ПриАктивизацииПоля',
    OnActivateCell: 'ПриАктивизацииЯчейки',
    OnActivateColumn: 'ПриАктивизацииКолонки',
    OnCurrentPageChange: 'ПриСменеСтраницы',
    OnCurrentParentChange: 'ПриСменеТекущегоРодителя',
    OnRowOutput: 'ПриВыводеСтроки',
    OnDataGet: 'ПриПолученииДанных',
    OnCheckChange: 'ПриИзмененииФлажка',
    BeforeRowChange: 'ПередНачаломИзменения',
    BeforeAddRow: 'ПередНачаломДобавления',
    BeforeDeleteRow: 'ПередУдалением',
    AfterDeleteRow: 'ПослеУдаления',
    AfterDeleteLine: 'ПослеУдаления',
    BeforeExpand: 'ПередРазворачиванием',
    BeforeCollapse: 'ПередСворачиванием',

    /* Drag-and-drop and calendar events. */
    StartDrag: 'НачалоПеретаскивания',
    DragStart: 'НачалоПеретаскивания',
    DragCheck: 'ПроверкаПеретаскивания',
    Drag: 'Перетаскивание',
    DragEnd: 'ОкончаниеПеретаскивания',
    Drop: 'ОкончаниеПеретаскивания',
    OnPeriodOutput: 'ПриВыводеПериода',

    /* Reports, documents and rarer field events found in real configurations. */
    DetailProcessing: 'ОбработкаРасшифровки',
    AdditionalDetailProcessing: 'ОбработкаДополнительнойРасшифровки',
    BeforeLoadUserSettingsAtServer: 'ПередЗагрузкойПользовательскихНастроекНаСервере',
    BeforeLoadVariantAtServer: 'ПередЗагрузкойВариантаНаСервере',
    OnLoadVariantAtServer: 'ПриЗагрузкеВариантаНаСервере',
    OnSaveVariantAtServer: 'ПриСохраненииВариантаНаСервере',
    OnUpdateUserSettingSetAtServer: 'ПриОбновленииСоставаПользовательскихНастроекНаСервере',
    BeforePrint: 'ПередПечатью',
    DocumentComplete: 'ДокументСформирован',
    MultipleValuesDelete: 'УдалениеНесколькихЗначений',
    OnActivate: 'ПриАктивизации',
    OnChangeAreaContent: 'ПриИзмененииСодержимогоОбласти',
    OnGetDataAtServer: 'ПриПолученииДанныхНаСервере',
    OnMainServerAvailabilityChange: 'ПриИзмененииДоступностиОсновногоСервера',
    StartListChoice: 'НачалоВыбораИзСписка',
    Tuning: 'Настройка',
    URLGetProcessing: 'ОбработкаПолученияНавигационнойСсылки',
    URLListGetProcessing: 'ОбработкаПолученияСпискаНавигационныхСсылок'
};

function eventTitle(name) {
    var raw = String(name || '');
    return EVENT_TITLES[raw] || raw;
}

function parseEvents(section) {
    var out = [];
    if (!section) return out;
    for (var i = 0; i < section.children.length; i++) {
        var el = section.children[i];
        if (localName(el) !== 'Event') continue;
        var event = {
            name: el.getAttribute('name') || '',
            handler: textOf(el)
        };
        var callType = el.getAttribute('callType') || el.getAttribute('CallType') || '';
        if (callType) event.callType = callType;
        out.push(event);
    }
    return out;
}

function hasEvent(owner, name) {
    var events = (owner && owner.events) || [];
    for (var i = 0; i < events.length; i++) {
        var eventName = typeof events[i] === 'string' ? events[i] : events[i] && events[i].name;
        if (eventName === name) return true;
    }
    return false;
}

function activeEvents(model) {
    var out = [];
    var attached = ['contextMenu', 'autoCommandBar', 'extendedTooltip',
        'searchStringAddition', 'viewStatusAddition', 'searchControlAddition'];
    function collect(owner, scope) {
        var events = (owner && owner.events) || [];
        for (var i = 0; i < events.length; i++) {
            var event = typeof events[i] === 'string' ? { name: events[i] } : events[i] || {};
            var handler = String(event.handler || '').trim();
            if (!handler) continue;
            var entry = {
                scope: scope,
                ownerType: scope === 'form' ? 'Form' : (owner.tag || ''),
                ownerName: owner.name || '',
                ownerId: owner.id || '',
                name: event.name || '',
                handler: handler
            };
            if (event.callType) entry.callType = event.callType;
            out.push(entry);
        }
    }
    function walk(item) {
        if (!item) return;
        collect(item, 'item');
        for (var a = 0; a < attached.length; a++) {
            if (item[attached[a]]) walk(item[attached[a]]);
        }
        var children = item.childItems || [];
        for (var i = 0; i < children.length; i++) walk(children[i]);
    }
    if (!model) return out;
    collect(model, 'form');
    if (model.autoCommandBar) walk(model.autoCommandBar);
    var roots = model.childItemsRoot || [];
    for (var i = 0; i < roots.length; i++) walk(roots[i]);
    return out;
}

function parseElement(el) {
    var tag = localName(el);
    var childSection = null;
    var extras = {};
    var events = [];
    for (var i = 0; i < el.children.length; i++) {
        var n = localName(el.children[i]);
        if (n === 'ChildItems') childSection = el.children[i];
        else if (EXTRA_CHILD_TAGS.indexOf(n) >= 0) extras[n] = parseElement(el.children[i]);
        else if (n === 'Events') events = parseEvents(el.children[i]);
    }
    var authoredProperties = parseItemProperties(el);
    var item = {
        tag: tag,
        name: el.getAttribute('name') || '',
        id: el.getAttribute('id') || '',
        properties: authoredProperties,
        /* Later normalization resolves inherited commands and structured
         * runtime values in `properties`. Keep the XML-authored map untouched
         * so the inspector never presents a derived value as user-defined. */
        authoredProperties: copyPropertyMap(authoredProperties),
        childItems: parseChildItems(childSection),
        events: events
    };
    var structuredProperties = parseStructuredProperties(el);
    if (Object.keys(structuredProperties).length) {
        item.structuredProperties = structuredProperties;
        /* Compatibility for consumers of the first InputField-only slice. */
        if (tag === 'InputField') item.complexProperties = structuredProperties;
    }
    applyStructuredRuntime(item);
    if (extras.AutoCommandBar) item.autoCommandBar = extras.AutoCommandBar;
    if (extras.SearchStringAddition) item.searchStringAddition = extras.SearchStringAddition;
    /* The loupe beside a search needs the owning table (dynamic list or not). */
    if (extras.SearchStringAddition && tag === 'Table')
        Object.defineProperty(extras.SearchStringAddition, '_fpOwnerTable', { value: item, configurable: true });
    if (extras.ViewStatusAddition) item.viewStatusAddition = extras.ViewStatusAddition;
    if (extras.SearchControlAddition) item.searchControlAddition = extras.SearchControlAddition;
    if (extras.ExtendedTooltip) item.extendedTooltip = extras.ExtendedTooltip;
    if (extras.ContextMenu) item.contextMenu = extras.ContextMenu;
    return item;
}


function parseExcludedCommands(el) {
    var out = [];
    if (!el) return out;
    for (var i = 0; i < el.children.length; i++) {
        var c = el.children[i];
        if (localName(c) !== 'ExcludedCommand') continue;
        var name = textOf(c);
        if (name) out.push(name);
    }
    return out;
}

function parseChoiceList(el) {
    var out = [];
    if (!el) return out;
    for (var i = 0; i < el.children.length; i++) {
        var itemEl = el.children[i];
        if (localName(itemEl) !== 'Item' && localName(itemEl) !== 'item') continue;
        var pres = '';
        for (var j = 0; j < itemEl.children.length; j++) {
            var ch = itemEl.children[j];
            var cn = localName(ch);
            if (cn === 'Presentation') {
                var direct = localizedFrom(ch);
                if (direct) pres = direct;
            } else if (cn === 'Value') {
                var vp = firstChild(ch, 'Presentation');
                if (vp) {
                    var nested = localizedFrom(vp);
                    if (nested) pres = nested;
                }
                /* Some project-format exports leave both Presentation nodes empty and
                 * serialize an enum DesignTimeRef as the only stable label.
                 * The reference paints that serialized value name verbatim in the form
                 * designer; humanizing it changes both text and row geometry. */
                if (!pres) {
                    var value = firstChild(ch, 'Value');
                    var ref = value && textOf(value);
                    if (ref) pres = lastSeg(ref);
                }
            }
        }
        if (pres) out.push(pres);
    }
    return out;
}

/* Preserve the authored v8:TypeDescription as data rather than inferring it
 * back from the few scalar hints used by the renderer. Type and TypeSet are
 * distinct XSD members; qualifier values remain strings so decimal and enum
 * spellings are not normalized away. */
function parseTypeDescriptionNode(typeEl) {
    if (!typeEl) return null;
    var result = { types: [], typeSets: [], typeIds: [] };
    function addUnique(list, value) {
        value = String(value == null ? '' : value).trim();
        if (value && list.indexOf(value) < 0) list.push(value);
    }
    function qualifier(name, fields) {
        var node = firstChild(typeEl, name);
        if (!node) return null;
        var out = {};
        for (var i = 0; i < fields.length; i++) {
            var child = firstChild(node, fields[i][0]);
            if (child) out[fields[i][1]] = textOf(child);
        }
        return out;
    }
    for (var i = 0; i < typeEl.children.length; i++) {
        var child = typeEl.children[i];
        var name = localName(child);
        if (name === 'Type') addUnique(result.types, textOf(child));
        else if (name === 'TypeSet') addUnique(result.typeSets, textOf(child));
        else if (name === 'TypeId') addUnique(result.typeIds, textOf(child));
    }
    var stringQ = qualifier('StringQualifiers', [
        ['Length', 'length'], ['AllowedLength', 'allowedLength']
    ]);
    var numberQ = qualifier('NumberQualifiers', [
        ['Digits', 'digits'], ['FractionDigits', 'fractionDigits'], ['AllowedSign', 'allowedSign']
    ]);
    var dateQ = qualifier('DateQualifiers', [['DateFractions', 'dateFractions']]);
    var binaryQ = qualifier('BinaryDataQualifiers', [
        ['Length', 'length'], ['AllowedLength', 'allowedLength']
    ]);
    if (stringQ) result.stringQualifiers = stringQ;
    if (numberQ) result.numberQualifiers = numberQ;
    if (dateQ) result.dateQualifiers = dateQ;
    if (binaryQ) result.binaryDataQualifiers = binaryQ;
    return result;
}

function parseTypeDescription(el) {
    return parseTypeDescriptionNode(firstChild(el, 'Type'));
}

function typeLengthOf(el) {
    var type = parseTypeDescription(el);
    var value = type && type.stringQualifiers && type.stringQualifiers.length;
    if (value == null || value === '') return 0;
    var found = parseInt(value, 10);
    if (found === 0) return -1;
    if (found > 0) return found;
    return 0;
}

/* Keep only actual type members. scalarOf(Type) also includes qualifiers,
 * which would turn a user-facing type into e.g. "xs:string, 20, Variable". */
function typeRefsOf(el) {
    var type = parseTypeDescription(el);
    if (!type) return '';
    /* Renderer compatibility: a TypeSet is an authored constraint, not a
     * resolved concrete type. It lives in typeDescription but must not make
     * legacy field-kind/width inference pretend the runtime type is known. */
    return type.types.join(', ');
}

/* NumberQualifiers gives the exact width 1C reserves for a number: total
 * significant digits, digits after the decimal point, and whether a minus
 * sign is possible. Digits/FractionDigits are siblings of Length under the
 * same <Type>, so this walks the subtree the same way typeLengthOf does. */
function typeNumberQualifiersOf(el) {
    var type = parseTypeDescription(el);
    var q = type && type.numberQualifiers;
    if (!q) return null;
    var digits = parseInt(q.digits, 10);
    var fractionDigits = parseInt(q.fractionDigits, 10) || 0;
    var allowedSign = q.allowedSign || '';
    if (digits == null || isNaN(digits) || digits <= 0) return null;
    return { digits: digits, fractionDigits: fractionDigits, allowedSign: allowedSign };
}

/* DateQualifiers/DateFractions tells whether a date field shows the date, the
 * time, or both - each needs a different reserved width (10/8/19 chars). */
function typeDateFractionOf(el) {
    var type = parseTypeDescription(el);
    return type && type.dateQualifiers ? type.dateQualifiers.dateFractions || '' : '';
}

function parseNamedList(section, itemTag) {
    var out = [];
    if (!section) return out;
    var items = namedChildren(section, itemTag);
    for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var columns = [];
        function parseAttributeColumn(columnEl, fullPath) {
            var typeDescription = parseTypeDescription(columnEl);
            return {
                name: columnEl.getAttribute('name') || '',
                path: fullPath || '',
                additional: !!fullPath,
                id: columnEl.getAttribute('id') || '',
                properties: parseProperties(columnEl),
                typeDescription: typeDescription,
                typeRefs: typeRefsOf(columnEl),
                stringLen: typeLengthOf(columnEl),
                numberQ: typeNumberQualifiersOf(columnEl),
                dateFraction: typeDateFractionOf(columnEl)
            };
        }
        function appendColumn(columnEl, fullPath) {
            var column = parseAttributeColumn(columnEl, fullPath);
            columns.push(column);
            return column;
        }
        var colRoot = firstChild(el, 'Columns');
        var columnStructure = null;
        if (colRoot) {
            columnStructure = { columns: [], additionalColumns: [] };
            /* Walk authored children in order. Empty AdditionalColumns blocks
             * are meaningful schema nodes even though they add no entries to
             * the compatible flat renderer index. */
            for (var c = 0; c < colRoot.children.length; c++) {
                var columnNode = colRoot.children[c];
                var columnTag = localName(columnNode);
                if (columnTag === 'Column') {
                    columnStructure.columns.push(appendColumn(columnNode, ''));
                } else if (columnTag === 'AdditionalColumns') {
                    var tablePath = columnNode.getAttribute('table') || '';
                    var block = { table: tablePath, columns: [] };
                    for (var bc = 0; bc < columnNode.children.length; bc++) {
                        if (localName(columnNode.children[bc]) !== 'Column') continue;
                        var blockName = columnNode.children[bc].getAttribute('name') || '';
                        var blockPath = tablePath && blockName ? tablePath + '.' + blockName : blockName;
                        block.columns.push(appendColumn(columnNode.children[bc], blockPath));
                    }
                    columnStructure.additionalColumns.push(block);
                }
            }
        }
        /* ValueTable attributes serialize nested XDTO/value-table members as
         * AdditionalColumns table="Root.Parent.Child". Ignoring these nodes
         * loses exact qualifiers such as INN=10 and KPP=9, so those controls
         * fall back to a generic 20-character field. */
        var additional = namedChildren(el, 'AdditionalColumns');
        for (var ac = 0; ac < additional.length; ac++) {
            var tablePath = additional[ac].getAttribute('table') || '';
            var legacyBlock = { table: tablePath, columns: [] };
            if (!columnStructure) columnStructure = { columns: [], additionalColumns: [] };
            var extraColumns = namedChildren(additional[ac], 'Column');
            for (var ec = 0; ec < extraColumns.length; ec++) {
                var extraName = extraColumns[ec].getAttribute('name') || '';
                legacyBlock.columns.push(appendColumn(extraColumns[ec], tablePath && extraName
                    ? tablePath + '.' + extraName : extraName));
            }
            columnStructure.additionalColumns.push(legacyBlock);
        }
        var settingsEl = firstChild(el, 'Settings');
        var settings = null;
        if (settingsEl) {
            var mainTableEl = firstChild(settingsEl, 'MainTable');
            settings = {
                type: settingsEl.getAttribute('xsi:type') || settingsEl.getAttribute('type') || '',
                mainTable: mainTableEl ? textOf(mainTableEl) : '',
                structuredValue: parseStructuredXmlValue(settingsEl)
            };
        }
        var typeDescription = parseTypeDescription(el);
        var entry = {
            name: el.getAttribute('name') || itemTag,
            id: el.getAttribute('id') || '',
            properties: parseProperties(el),
            typeDescription: typeDescription,
            typeRefs: typeRefsOf(el),
            columns: columns,
            stringLen: typeLengthOf(el),
            numberQ: typeNumberQualifiersOf(el),
            dateFraction: typeDateFractionOf(el)
        };
        if (columnStructure) entry.columnStructure = columnStructure;
        if (settings) entry.settings = settings;
        out.push(entry);
    }
    return out;
}

function findFormRoot(doc) {
    if (!doc || !doc.documentElement) return null;
    var root = doc.documentElement;
    if (localName(root) === 'Form') return root;
    var all = doc.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
        if (localName(all[i]) === 'Form') return all[i];
    }
    return null;
}

/* Folded groups and the selected tab are UI state of one loaded document:
 * element ids repeat across unrelated forms and must not carry over. They are
 * not parse output, so a host clears them when it opens a different file.
 * Doing it inside parse() looked equivalent and was not — parse() also runs on
 * every keystroke while a form is edited, and resetting there re-opened every
 * collapsed group and snapped the preview back to the first tab as the user
 * typed. */
function resetViewState() {
    collapsedGroupByKey = Object.create(null);
    activePageIdByPagesKey = Object.create(null);
}

function parse(xml, objectMetaXml, styleItems, baseFormXml, commonCommandXml, commonPictures, refMetaXml) {
    if (!xml || typeof xml !== 'string') return { error: 'Пустой XML' };
    var doc;
    try {
        doc = new DOMParser().parseFromString(xml, 'application/xml');
    } catch (e) {
        return { error: 'Не удалось разобрать XML' };
    }
    var parseErr = doc.querySelector('parsererror');
    if (parseErr) return { error: textOf(parseErr) || 'Ошибка разбора XML' };
    var form = findFormRoot(doc);
    if (!form) return { error: 'В файле нет корневого элемента Form' };
    var auto = firstChild(form, 'AutoCommandBar');
    var baseForm = firstChild(form, 'BaseForm');
    var externalBaseCommands = [];
    var externalBaseAttributes = [];
    var externalBaseItems = [];
    var externalBaseBar = null;
    if (baseFormXml) {
        try {
            var baseDoc = new DOMParser().parseFromString(baseFormXml, 'application/xml');
            var externalBase = findFormRoot(baseDoc);
            if (externalBase) {
                externalBaseCommands = parseNamedList(firstChild(externalBase, 'Commands'), 'Command');
                externalBaseAttributes = parseNamedList(firstChild(externalBase, 'Attributes'), 'Attribute');
                externalBaseItems = parseChildItems(firstChild(externalBase, 'ChildItems'));
                var externalBar = firstChild(externalBase, 'AutoCommandBar');
                if (externalBar) externalBaseBar = parseElement(externalBar);
            }
        } catch (e) { /* an unavailable or malformed base form is optional */ }
    }
    var commands = mergeNamedItems(
        parseNamedList(firstChild(form, 'Commands'), 'Command'),
        mergeNamedItems(parseNamedList(firstChild(baseForm, 'Commands'), 'Command'), externalBaseCommands)
    );
    var model = {
        /* The Form root is a container element like any group: its own
         * properties drive the caption, the command bar position, the form
         * width and the layout of the top-level children. */
        tag: 'Form',
        name: form.getAttribute('name') || '',
        properties: parseItemProperties(form),
        childItemsRoot: parseChildItems(firstChild(form, 'ChildItems')),
        autoCommandBar: auto ? parseElement(auto) : null,
        attributes: parseNamedList(firstChild(form, 'Attributes'), 'Attribute'),
        baseAttributes: mergeNamedItems(
            parseNamedList(firstChild(baseForm, 'Attributes'), 'Attribute'),
            externalBaseAttributes
        ),
        commands: commands,
        excludedCommands: parseExcludedCommands(firstChild(form, 'CommandSet')),
        commandInterface: parseCommandInterface(form),
        commonCommands: parseCommonCommands(commonCommandXml),
        commonPictures: commonPictures || {},
        commandGroups: parseCommandGroups(commonCommandXml),
        version: form.getAttribute('version') || '',
        adoptedForm: !!baseForm,
        objectMeta: parseObjectMeta(objectMetaXml),
        refMeta: parseRefMetas(refMetaXml),
        styleItems: styleItems || {}
    };
    mergeAdoptedItemProperties(model.childItemsRoot,
        parseChildItems(firstChild(baseForm, 'ChildItems')), externalBaseItems);
    /* The form command bar is serialized the same way: CommandName=0 on the
     * extension button, the real command on the configuration's button. */
    if (model.autoCommandBar && externalBaseBar) {
        var snapshotBar = firstChild(baseForm, 'AutoCommandBar');
        mergeAdoptedItemProperties([model.autoCommandBar],
            snapshotBar ? [parseElement(snapshotBar)] : [], [externalBaseBar]);
    }
    var formStructuredProperties = parseStructuredProperties(form);
    if (Object.keys(formStructuredProperties).length)
        model.structuredProperties = formStructuredProperties;
    applyStructuredRuntime(model);
    model.events = parseEvents(firstChild(form, 'Events'));
    restoreInheritedCommandRefs(model);
    fillCommonCommands(model);
    attachItemSourcedSearch(model);
    attachFormSourcedListCommands(model);
    attachFormattedDocumentCommands(model);
    fillCreateBasedOnMenus(model);
    markForeignSearchCommands(model);
    markUnpaintedStdPictureHyperlinks(model);
    applyTypeDefaultsToModel(model);
    foldObjectCopyIntoMore(model);
    return { model: model };
}

/* Form commands may be independent CommonCommand objects or commands nested
 * in another metadata object. The host supplies the applicable descriptors as
 * a key -> XML map. Keep malformed/absent optional metadata non-fatal. */
function parseCommonCommands(xmlByName) {
    var out = {};
    for (var key in xmlByName || {}) {
        if (!Object.prototype.hasOwnProperty.call(xmlByName, key)) continue;
        var xml = xmlByName[key];
        try {
            var doc = new DOMParser().parseFromString(xml, 'application/xml');
            if (doc.querySelector && doc.querySelector('parsererror')) continue;
            var command = null;
            var objectFqn = /^@(?:global-)?fqn:/i.test(key) ? key.replace(/^@(?:global-)?fqn:/i, '') : '';
            var objectCommandName = objectFqn ? objectFqn.replace(/^.*\.Command\./i, '') : '';
            function findCommand(node) {
                if (!node || command) return;
                if (localName(node) === 'CommonCommand' && !objectFqn) { command = node; return; }
                if (localName(node) === 'Command' && objectFqn) {
                    var candidateProperties = firstChild(node, 'Properties') || node;
                    if (textOf(firstChild(candidateProperties, 'Name')) === objectCommandName) { command = node; return; }
                }
                for (var i = 0; node.children && i < node.children.length; i++) findCommand(node.children[i]);
            }
            findCommand(doc.documentElement);
            if (!command) continue;
            var properties = firstChild(command, 'Properties') || command;
            var name = textOf(firstChild(properties, 'Name')) || key;
            var parsed = parseProperties(properties);
            var synonym = localizedFrom(firstChild(properties, 'Synonym'));
            var tooltip = localizedFrom(firstChild(properties, 'ToolTip'));
            if (synonym) parsed.Title = synonym;
            if (tooltip) parsed.ToolTip = tooltip;
            if (/^@global:/i.test(key)) parsed.GlobalApplicable = 'true';
            if (objectFqn) {
                if (/^@global-fqn:/i.test(key)) parsed.GlobalApplicable = 'true';
                parsed.CommandFqn = objectFqn;
            }
            if (out[name] && isTrue(prop(out[name], ['GlobalApplicable'])))
                parsed.GlobalApplicable = 'true';
            out[objectFqn || name] = { name: name, properties: parsed };
        } catch (e) { /* optional configuration context */ }
    }
    return out;
}

function parseCommandGroups(xmlByName) {
    var out = {};
    for (var key in xmlByName || {}) {
        if (!Object.prototype.hasOwnProperty.call(xmlByName, key) || !/^@group:/i.test(key)) continue;
        try {
            var doc = new DOMParser().parseFromString(xmlByName[key], 'application/xml');
            var group = null;
            function findGroup(node) {
                if (!node || group) return;
                if (localName(node) === 'CommandGroup') { group = node; return; }
                for (var i = 0; node.children && i < node.children.length; i++) findGroup(node.children[i]);
            }
            findGroup(doc.documentElement);
            if (!group) continue;
            var properties = firstChild(group, 'Properties') || group;
            var name = textOf(firstChild(properties, 'Name')) || key.replace(/^@group:/i, '');
            var parsed = parseProperties(properties);
            var synonym = localizedFrom(firstChild(properties, 'Synonym'));
            if (synonym) parsed.Title = synonym;
            out[name] = { name: name, properties: parsed };
        } catch (e) { /* optional configuration context */ }
    }
    return out;
}

/* An extension serializes only its changed commands at the top level. The
 * inherited command metadata (caption, picture, representation) remains in
 * BaseForm and is required to draw the resulting form rather than the delta. */
/* An extension dump of an adopted form keeps only what the extension changed
 * against its own <BaseForm> snapshot: DataPath, Title, Picture and the other
 * inherited values are omitted and live on the configuration's form item of
 * the same name. Merge per property three ways — the extension value when it
 * differs from its snapshot, otherwise the current configuration value.
 * Without it every field reads as orphaned and the whole form paints empty. */
function mergeAdoptedItemProperties(items, snapshotItems, baseItems) {
    if (!baseItems || !baseItems.length) return;
    /* A table's own command bar and context menu hang off the item, not its
     * childItems (e.g. mark/unmark buttons that are CommandName=0 in an
     * extension and Form.Command.* in the configuration). */
    var ATTACHED = ['autoCommandBar', 'contextMenu'];
    function nested(it) {
        var out = (it.childItems || []).slice();
        for (var a = 0; a < ATTACHED.length; a++) if (it[ATTACHED[a]]) out.push(it[ATTACHED[a]]);
        return out;
    }
    function index(list, byName) {
        for (var i = 0; list && i < list.length; i++) {
            var it = list[i];
            if (it && it.name && !byName[it.name]) byName[it.name] = it;
            if (it) index(nested(it), byName);
        }
        return byName;
    }
    var base = index(baseItems, {});
    var snapshot = index(snapshotItems, {});
    function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
    (function fill(list) {
        for (var i = 0; list && i < list.length; i++) {
            var item = list[i];
            if (!item) continue;
            var from = base[item.name];
            var snap = snapshot[item.name];
            /* The extension may turn a data field into another data field kind
             * (e.g. LabelField -> InputField); the binding is still the
             * configuration's. */
            if (from && (from.tag === item.tag
                || (ORPHAN_DATA_FIELD_TAGS[from.tag] && ORPHAN_DATA_FIELD_TAGS[item.tag]))) {
                var own = item.properties;
                var snapProps = snap ? snap.properties : {};
                for (var key in from.properties) {
                    if (!Object.prototype.hasOwnProperty.call(from.properties, key)) continue;
                    var has = Object.prototype.hasOwnProperty.call(own, key);
                    var snapHas = Object.prototype.hasOwnProperty.call(snapProps, key);
                    /* Removed by the extension: the snapshot had it, the extension does not. */
                    if (!has && snapHas) continue;
                    if (has && !(snapHas && same(own[key], snapProps[key]))) continue;
                    own[key] = from.properties[key];
                }
            }
            fill(nested(item));
        }
    })(items);
}

/* Form attributes as the platform sees them. An extension dump of an adopted
 * form writes only the attributes the extension added; the inherited ones
 * (the main Объект among them) come from the base form. The outline keeps
 * reading model.attributes so it never lists an inherited attribute as own. */
function formAttributes(model) {
    if (!model) return [];
    if (!model.adoptedForm) return model.attributes || [];
    return mergeNamedItems(model.attributes, model.baseAttributes);
}

/* An object form's own Copy (Form.StandardCommand.Copy) with an automatic
 * location lives in «Еще», like Reread: the reference does not show
 * «Скопировать» on the bar. A list form forwards Copy to its dynamic list
 * and keeps it on the row, so only object forms qualify. */
function foldObjectCopyIntoMore(model) {
    var main = mainAttribute(model);
    if (!main || !/Object(\.|$)|Объект(\.|$)/.test(String(prop(main, ['Type']) || ''))) return;
    walkFormItems({ childItems: model.autoCommandBar ? [model.autoCommandBar] : [] }, function (item) {
        if (!item || item.tag !== 'Button') return;
        if (!/^Form\.StandardCommand\.Copy$/i.test(String(prop(item, ['CommandName']) || ''))) return;
        if (prop(item, ['LocationInCommandBar', 'ПоложениеВКоманднойПанели'])) return;
        item.properties.LocationInCommandBar = 'InAdditionalSubmenu';
    });
}

function mergeNamedItems(primary, fallback) {
    var out = (primary || []).slice();
    var known = {};
    for (var i = 0; i < out.length; i++) if (out[i] && out[i].name) known[out[i].name] = true;
    for (var j = 0; fallback && j < fallback.length; j++) {
        var item = fallback[j];
        if (item && item.name && !known[item.name]) out.push(item);
    }
    return out;
}

function inheritedCommandName(item, commands) {
    if (!item || !item.name || String(prop(item, ['CommandName', 'Command'])).trim() !== '0') return '';
    var itemName = String(item.name).toLowerCase();
    var best = '';
    for (var i = 0; commands && i < commands.length; i++) {
        var name = String(commands[i] && commands[i].name || '');
        var low = name.toLowerCase();
        if (low && itemName.slice(-low.length) === low && name.length > best.length) best = name;
    }
    return best;
}

function restoreInheritedCommandRefs(model) {
    if (!model) return;
    walkFormItems({ childItems: model.childItemsRoot, autoCommandBar: model.autoCommandBar }, function (item) {
        if (!item || (item.tag !== 'Button' && item.tag !== 'Hyperlink')) return;
        var name = inheritedCommandName(item, model.commands);
        if (name) {
            item.properties.CommandName = 'Form.Command.' + name;
            return;
        }
    });
}

/* Auto / Top / Bottom / None. 1C draws the form command bar at the top unless
 * the form says otherwise; `None` means there is no bar at all. */
function commandBarLocation(item) {
    var v = String(prop(item, ['CommandBarLocation', 'ПоложениеКоманднойПанели']) || '')
        .toLowerCase().replace(/[\s_-]+/g, '');
    if (!v) return 'auto';
    if (v === 'none' || v.indexOf('нет') >= 0) return 'none';
    if (v === 'bottom' || v.indexOf('низ') >= 0) return 'bottom';
    if (v === 'top' || v.indexOf('верх') >= 0) return 'top';
    return 'auto';
}

function displayItems(model) {
    if (!model) return [];
    var items = model.childItemsRoot || [];
    var loc = commandBarLocation(model);
    if (loc === 'none') return items;
    var bar = formCommandBar(model);
    if (bar && !isEmptyCommandBar(bar))
        return loc === 'bottom' ? items.concat([bar]) : [bar].concat(items);
    return items;
}

function isEmptyCommandBar(bar) {
    if (!bar) return true;
    var kids = (bar && bar.childItems) || [];
    for (var i = 0; i < kids.length; i++) {
        /* A Visible=false command is not allocated a slot, so a bar left with
         * only hidden children draws nothing: 1C then omits the bar itself
         * rather than reserving an empty strip. */
        if (!isFalse(prop(kids[i], ['Visible', 'visible']))) return false;
    }
    return isFalse(prop(bar, ['Autofill']));
}

/* A Table bound to the form's main dynamic list with CommandBarLocation=Auto
 * draws no bar of its own in the reference: its commands belong to the form bar.
 * Only the filter chips stay above the grid, whether that bar is authored or
 * empty. */
function tableBarMergedIntoForm(table, model) {
    if (!table || !model || commandBarLocation(table) !== 'auto') return false;
    var main = mainAttribute(model);
    if (!main || !/DynamicList|ДинамическийСписок/i.test(String(prop(main, ['Type']) || ''))) return false;
    return String(prop(table, ['DataPath']) || '') === main.name;
}

function tableCommandBarVisible(table, model) {
    if (!table || commandBarLocation(table) === 'none') return false;
    if (tableBarMergedIntoForm(table, model)) return false;
    return !table.autoCommandBar || !isEmptyCommandBar(table.autoCommandBar);
}

function groupHasFields(item) {
    if (!item) return false;
    var tag = item.tag || '';
    if (tag === 'InputField' || tag === 'CheckBoxField' || tag === 'Table'
        || tag === 'RadioButtonField' || tag === 'ValueList') return true;
    var kids = item.childItems || [];
    for (var i = 0; i < kids.length; i++) {
        if (groupHasFields(kids[i])) return true;
    }
    return false;
}

function normKey(k) { return String(k || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, ''); }

function prop(item, aliases) {
    var properties = item && item.properties;
    if (!properties) return '';
    var map = {};
    for (var k in properties) {
        if (!Object.prototype.hasOwnProperty.call(properties, k)) continue;
        map[normKey(k)] = properties[k];
    }
    var ignored = item.runtime && item.runtime.ignoredProps;
    for (var i = 0; i < aliases.length; i++) {
        if (ignored && ignored[normKey(aliases[i])]) continue;
        var v = map[normKey(aliases[i])];
        if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
}

function isFalse(v) {
    var s = String(v || '').toLowerCase().replace(/[\s_-]+/g, '');
    return s === 'false' || s === '0' || s === 'нет' || s === 'no';
}

var PATH_CAPTIONS = {
    Number: 'Номер', Date: 'Дата', Ref: 'Ссылка', Description: 'Наименование', Code: 'Код',
    LineNumber: 'N', OffBalance: 'Забалансовый', Owner: 'Владелец', Parent: 'Родитель',
    DeletionMark: 'Пометка удаления', Posted: 'Проведен', Predefined: 'Предопределенный',
    TurnoversOnly: 'ТолькоОбороты',
    /* Examples: a «ВидСубконто» column, «Порядок:», «Этот узел:». */
    ExtDimensionType: 'ВидСубконто', Order: 'Порядок', ThisNode: 'Этот узел'
};
/* DataPath may name a standard attribute in Russian while metadata stores it
 * under the English name (and vice versa). */
var STD_ATTRIBUTE_ALIASES = {
    Владелец: 'Owner', Родитель: 'Parent', Наименование: 'Description', Код: 'Code',
    Ссылка: 'Ref', ПометкаУдаления: 'DeletionMark', Забалансовый: 'OffBalance',
    Вид: 'Kind', Выполнена: 'Executed', БизнесПроцесс: 'BusinessProcess',
    Номер: 'Number', Дата: 'Date', Проведен: 'Posted', НомерСтроки: 'LineNumber',
    Предопределенный: 'Predefined', Порядок: 'Order', ТипЗначения: 'ValueType'
};
(function () {
    var keys = Object.keys(STD_ATTRIBUTE_ALIASES);
    for (var i = 0; i < keys.length; i++) STD_ATTRIBUTE_ALIASES[STD_ATTRIBUTE_ALIASES[keys[i]]] = keys[i];
})();
var STD_COMMANDS = {
    Help: '?', Write: 'Записать', Post: 'Провести', Close: 'Закрыть',
    WriteAndClose: 'Записать и закрыть', PostAndClose: 'Провести и закрыть',
    UndoPosting: 'Отменить проведение', Start: 'Старт', StartAndClose: 'Стартовать и закрыть',
    SetDeletionMark: 'Пометить на удаление', Delete: 'Удалить', Reread: 'Перечитать',
    ShowInList: 'Показать в списке', CustomizeForm: 'Изменить форму',
    Add: 'Добавить', Create: 'Создать', Copy: 'Скопировать', Change: 'Изменить', Find: 'Найти...',
    MoveUp: 'Переместить вверх', MoveDown: 'Переместить вниз', SelectAll: 'Выделить все',
    SortListAsc: 'Сортировать по возрастанию', SortListDesc: 'Сортировать по убыванию',
    OutputList: 'Вывести список', ShowMultipleSelection: 'Показать множественный выбор',
    ListSettings: 'Настройка списка', LoadDynamicListSettings: 'Загрузить настройки списка',
    SaveDynamicListSettings: 'Сохранить настройки списка',
    DynamicListStandardSettings: 'Стандартные настройки',
    Choose: 'Выбрать', Cancel: 'Отмена', Refresh: 'Обновить', OK: 'OK',
    FindByCurrentValue: 'Найти по текущему значению', CancelSearch: 'Отменить поиск',
    ChangeHistory: 'История изменений', SetDateInterval: 'Установить период',
    OpenList: 'Открыть список', Generate: 'Сформировать', Print: 'Печать'
};
var PIC_ICON = {
    Write: 'save', WriteAndClose: 'save', Post: 'file-check', PostAndClose: 'file-check',
    UndoPosting: 'arrow-back-up',
    DataHistory: 'data-history', History: 'history',
    Print: 'printer', Help: 'help', Find: 'search', Search: 'search',
    Create: 'plus', Add: 'plus', CreateListItem: 'plus', Delete: 'x', InputFieldClear: 'x', Copy: 'file-plus', CloneListItem: 'file-plus',
    Change: 'pencil', Undo: 'arrow-back-up', Redo: 'arrow-forward-up',
    MoveUp: 'arrow-up', MoveDown: 'arrow-down', Calendar: 'calendar',
    Choose: 'dots', DropList: 'chevron-down', Clear: 'x', Picture: 'photo',
    Folder: 'folder', Information: 'info-circle', Warning: 'alert-triangle',
    QueryWizard: 'help', Report: 'table', Spreadsheet: 'table', InputField: 'forms',
    Check: 'checkbox', Filter: 'filter', Barcode: 'barcode', Scale: 'scale',
    Calculate: 'calculator', CustomizeForm: 'adjustments', Generate: 'sparkles',
    Fill: 'sparkles', OutputList: 'printer', Sort: 'arrows-sort', EndEdit: 'square',
    Refresh: 'refresh', SortListAsc: 'sort-ascending', SortListDesc: 'sort-descending',
    ShowMultipleSelection: 'checkbox', ListSettings: 'filter',
    LoadDynamicListSettings: 'folder', SaveDynamicListSettings: 'save',
    DynamicListStandardSettings: 'arrow-back-up', Setting: 'settings'
};

/* Platform picture library (БиблиотекаКартинок) shipped as files in
 * std-pictures/, named by their Russian names. Form.xml refers to them by the
 * English name (StdPicture.Write), so this maps English → Russian. A Russian
 * ref (БиблиотекаКартинок.Записать) resolves by the file name directly. */
var STD_PICTURE_RU = {
    SwitchActivity: 'ПереключитьАктивность',
    DataCompositionOutputParameters: 'ПараметрыВыводаКомпоновкиДанных',
    DataCompositionOutputParametersDisabled: 'ПараметрыВыводаКомпоновкиДанныхНедоступные',
    DataCompositionFilter: 'ОтборКомпоновкиДанных',
    DataCompositionFilterDisabled: 'ОтборКомпоновкиДанныхНедоступный',
    DataCompositionConditionalAppearance: 'УсловноеОформлениеКомпоновкиДанных',
    DataCompositionConditionalAppearanceDisabled: 'УсловноеОформлениеКомпоновкиДанныхНедоступное',
    DataCompositionSettingsWizard: 'КонструкторНастроекКомпоновкиДанных',
    DataCompositionNewGroup: 'НоваяГруппировкаКомпоновкиДанных',
    DataCompositionNewNestedScheme: 'НоваяВложеннаяСхемаКомпоновкиДанных',
    DataCompositionNewTable: 'НоваяТаблицаКомпоновкиДанных',
    DataCompositionNewChart: 'НоваяДиаграммаКомпоновкиДанных',
    DataCompositionDataParameters: 'ПараметрыДанныхКомпоновкиДанных',
    DataCompositionOrder: 'ПорядокКомпоновкиДанных',
    DataCompositionOrderDisabled: 'ПорядокКомпоновкиДанныхНедоступный',
    DataCompositionSelection: 'ВыборКомпоновкиДанных',
    DataCompositionSelectionDisabled: 'ВыборКомпоновкиДанныхНедоступный',
    DataCompositionUserFields: 'ПользовательскиеПоляКомпоновкиДанных',
    DataCompositionGroupFields: 'ПоляГруппировкиКомпоновкиДанных',
    DataCompositionGroupFieldsDisabled: 'ПоляГруппировкиКомпоновкиДанныхНедоступные',
    DataCompositionStandardSettings: 'СтандартнаяНастройкаКомпоновкиДанных',
    DataCompositionAvailableFields: 'ДоступныеПоляКомпоновкиДанных',
    AppearanceCheckBox: 'ОформлениеФлажок',
    AppearanceCheckIcon: 'ОформлениеЗнакФлажок',
    AppearanceCross: 'ОформлениеКрест',
    AppearanceCrossIcon: 'ОформлениеЗнакКрест',
    AppearanceExclamationMark: 'ОформлениеВосклицательныйЗнак',
    AppearanceExclamationMarkIcon: 'ОформлениеЗнакВосклицательныйЗнак',
    AppearanceDownArrowGray: 'ОформлениеСтрелкаВнизСерая',
    AppearanceDownArrowRed: 'ОформлениеСтрелкаВнизКрасная',
    AppearanceUpArrowGreen: 'ОформлениеСтрелкаВверхЗеленая',
    AppearanceUpArrowGray: 'ОформлениеСтрелкаВверхСерая',
    AppearanceRightArrowGray: 'ОформлениеСтрелкаВправоСерая',
    AppearanceRightArrowYellow: 'ОформлениеСтрелкаВправоЖелтая',
    AppearanceCircleGreen: 'ОформлениеКругЗеленый',
    AppearanceCircleRed: 'ОформлениеКругКрасный',
    AppearanceCircleYellow: 'ОформлениеКругЖелтый',
    AppearanceCircleBlack: 'ОформлениеКругЧерный',
    AppearanceCircleEmpty: 'ОформлениеКругПустой',
    AppearanceCircleFilled: 'ОформлениеКругЗаполненный',
    AppearanceCircleOneFourthFilled: 'ОформлениеКругЗаполненныйНаОднуЧетверть',
    AppearanceCircleTwoFourthsFilled: 'ОформлениеКругЗаполненныйНаДвеЧетверти',
    AppearanceCircleThreeFourthsFilled: 'ОформлениеКругЗаполненныйНаТриЧетверти',
    AppearanceFlagRed: 'ОформлениеФлагКрасный',
    AppearanceFlagGreen: 'ОформлениеФлагЗеленый',
    AppearanceFlagYellow: 'ОформлениеФлагЖелтый',
    AppearanceStarFilled: 'ОформлениеЗвездаЗаполненная',
    AppearanceStarEmpty: 'ОформлениеЗвездаПустая',
    AppearanceStarHalfFilled: 'ОформлениеЗвездаЗаполненнаяНаполовину',
    AppearanceTriangleUpGreen: 'ОформлениеТреугольникВверхЗеленый',
    AppearanceTriangleDownRed: 'ОформлениеТреугольникВнизКрасный',
    AppearanceDashYellow: 'ОформлениеДефисЖелтый',
    GotoExternalURL: 'ПерейтиПоВнешнейНавигационнойСсылке',
    InputFieldSelect: 'ПолеВводаВыбрать',
    AddListItem: 'ДобавитьЭлементСписка',
    BusinessProcessStart: 'СтартБизнесПроцесса',
    GroupConversation: 'ГрупповоеОбсуждение',
    ChooseFromList: 'ВыбратьИзСписка',
    CollaborationSystemUser: 'ПользовательСистемыВзаимодействия',
    CollaborationSystemIntegrationUser: 'ПользовательИнтеграцииСистемыВзаимодействия',
    CollaborationSystemExternalUser: 'ВнешнийПользовательСистемыВзаимодействия',
    UserWithAuthentication: 'ПользовательСАутентификацией',
    UserWithoutNecessaryProperties: 'ПользовательБезНеобходимыхСвойств',
    QueryWizardCreateTempTableDropQuery: 'КонструкторЗапросаСоздатьЗапросУничтоженияВременнойТаблицы',
    QueryWizardTableParameters: 'КонструкторЗапросаПараметрыТаблицы',
    QueryWizardCreateNestedQuery: 'КонструкторЗапросаСоздатьВложенныйЗапрос',
    QueryWizardNestedQuery: 'КонструкторЗапросаВложенныйЗапрос',
    QueryWizardTempTable: 'КонструкторЗапросаВременнаяТаблица',
    SpreadsheetInsertComment: 'ТабличныйДокументВставитьПримечание',
    SpreadsheetDeleteComment: 'ТабличныйДокументУдалитьПримечание',
    ClearFilter: 'ОтключитьОтбор',
    EditInDialog: 'РедактироватьВДиалоге',
    FunctionsMenuCommand: 'КомандаМенюФункций',
    StartVideoConference: 'НачатьВидеоконференцию',
    Notify: 'Оповещать',
    DoNotNotify: 'НеОповещать',
    DoNotDisturb: 'НеБеспокоить',
    SendingError: 'ОшибкаОтправки',
    Disconnect: 'РазорватьСоединение',
    ViewByOwner: 'ПросмотрПоВладельцу',
    ParametersSetting: 'НастройкаПараметров',
    ActivateTask: 'АктивироватьЗадачу', ActiveUsers: 'АктивныеПользователи',
    AddToFavorites: 'ДобавитьВИзбранное', Attach: 'Прикрепить',
    BusinessProcess: 'БизнесПроцесс', BusinessProcessObject: 'БизнесПроцессОбъект',
    BorderAll: 'ГраницаВезде', BorderInside: 'ГраницаВнутри', BorderOutside: 'ГраницаВокруг',
    BorderTop: 'ГраницаСверху', BorderLeft: 'ГраницаСлева', BorderBottom: 'ГраницаСнизу',
    BorderRight: 'ГраницаСправа', BorderColor: 'ЦветГраницы', NoBorder: 'НетГраницы',
    ThickBorderOutside: 'ТолстаяГраницаВокруг', ThickBorderTop: 'ТолстаяГраницаСверху',
    ThickBorderBottom: 'ТолстаяГраницаСнизу',
    Calculator: 'Калькулятор', Calendar: 'Календарь', CalculationType: 'ВидРасчета',
    Catalog: 'Справочник', CatalogObject: 'СправочникОбъект',
    Change: 'Изменить', ChangeForm: 'ИзменитьФорму', ChangeListItem: 'ИзменитьЭлементСписка',
    ChartOfAccounts: 'ПланСчетов', ChartOfAccountsObject: 'ПланСчетовОбъект',
    ChartOfCalculationTypes: 'ПланВидовРасчета', ChartOfCalculationTypesObject: 'ПланВидовРасчетаОбъект',
    ChartOfCharacteristicTypes: 'ПланВидовХарактеристик',
    ChartOfCharacteristicTypesObject: 'ПланВидовХарактеристикОбъект',
    CheckAll: 'УстановитьФлажки', UncheckAll: 'СнятьФлажки', ShadeCheckBoxes: 'ЗатенитьФлажки',
    CheckSyntax: 'СинтаксическийКонтроль', Clear: 'Очистить', Close: 'Закрыть',
    CloneListItem: 'СкопироватьЭлементСписка', CloneObject: 'СкопироватьОбъект',
    Collapse: 'СВЕРНУТЬ', CollapseAll: 'СвернутьВсе', Expand: 'Развернуть', ExpandAll: 'РазвернутьВсе',
    ColumnWidth: 'ШиринаКолонки', RowHeight: 'ВысотаСтроки', Comment: 'Комментарий',
    ComparisonType: 'ВидСравнения', Constant: 'Константа',
    CreateFolder: 'СоздатьГруппу', CreateListItem: 'СоздатьЭлементСписка', NewGroup: 'НоваяГруппа',
    CreateDocument: 'СоздатьДокумент', CreateInitialImage: 'СоздатьНачальныйОбраз',
    Credit: 'Кредит', Debit: 'Дебет', DebitCredit: 'ДебетКредит',
    CustomizeForm: 'ИзменитьФорму', CustomizeList: 'НастроитьСписок',
    DataHistory: 'ИсторияДанных', DataSearch: 'ПоискДанных', Decode: 'Расшифровать',
    Decrypt: 'Расшифровать', Encrypt: 'Зашифровать', Encrypted: 'Зашифрован',
    Delete: 'Удалить', DeleteDirectly: 'УдалитьНепосредственно', DeleteListItem: 'УдалитьЭлементСписка',
    DeleteListItemDirectly: 'УдалитьЭлементСпискаНепосредственно',
    Details: 'Расшифровка', DialogExclamation: 'ДиалогВосклицание', DialogInformation: 'ДиалогИнформация',
    DialogQuestion: 'ДиалогВопрос', DialogStop: 'ДиалогСтоп',
    Document: 'Документ', DocumentObject: 'ДокументОбъект', DocumentJournal: 'ЖурналДокументов',
    Documentation: 'Документация', EndEdit: 'ЗакончитьРедактирование',
    Enum: 'Перечисление', EventLog: 'ЖурналРегистрации', EventLogByUser: 'ЖурналРегистрацииПоПользователю',
    ExchangePlan: 'ПланОбмена', ExchangePlanObject: 'ПланОбменаОбъект',
    ExecuteTask: 'ВыполнитьЗадачу', ExternalDataSource: 'ВнешнийИсточникДанных',
    ExternalDataSourceCube: 'ВнешнийИсточникДанныхКуб',
    ExternalDataSourceDimensionTable: 'ВнешнийИсточникДанныхКубТаблицаИзмерения',
    ExternalDataSourceTable: 'ВнешнийИсточникДанныхТаблица',
    ExternalDataSourceFunction: 'ВнешнийИсточникДанныхФункция',
    Favorites: 'Избранное', FilterByCurrentValue: 'ОтборПоТекущемуЗначению', FilterCriterion: 'КритерийОтбора',
    FilterAndSort: 'ОтборИСортировка', FilterHistory: 'ИсторияОтборов', FilterByType: 'ОтборПоВиду',
    CancelSearch: 'ОтменитьПоиск', SearchControl: 'УправлениеПоиском',
    Find: 'Найти', FindInList: 'НайтиВСписке', FindInTree: 'НайтиВДереве', FindInContent: 'НайтиВСодержании',
    FindByNumber: 'НайтиПоНомеру', FindNext: 'НайтиСледующий', FindPrevious: 'НайтиПредыдущий',
    Folder: 'Папка', Font: 'Шрифт', TextColor: 'ЦветТекста', BackColor: 'ЦветФона',
    Form: 'Форма', FormHelp: 'СправкаФормы', FormattedString: 'ФорматированнаяСтрока', Frame: 'Рамка',
    Forward: 'Вперед', Back: 'Назад', GoForward: 'ПерейтиВперед', GoBack: 'ПерейтиНазад',
    GoToBegin: 'ПерейтиКНачалу', GoToEnd: 'ПерейтиККонцу', Next: 'Следующий', Previous: 'Предыдущий',
    GanttChart: 'ДиаграммаГанта', Chart: 'Диаграмма', Dendrogram: 'Дендрограмма', PivotChart: 'СводнаяДиаграмма',
    GeographicalSchema: 'ГеографическаяСхема', GraphicalSchema: 'ГрафическаяСхема',
    GetURL: 'ПолучитьНавигационнуюСсылку', NavigateToURL: 'ПерейтиПоНавигационнойСсылке',
    NavigateToExternalURL: 'ПерейтиПоВнешнейНавигационнойСсылке',
    Help: 'Справка', HierarchicalList: 'ИерархическийСписок', HierarchicalView: 'ИерархическийПросмотр',
    History: 'История', Information: 'Информация', InformationRegister: 'РегистрСведений',
    InformationRegisterRecord: 'РегистрСведенийЗапись', AccountingRegister: 'РегистрБухгалтерии',
    AccumulationRegister: 'РегистрНакопления', CalculationRegister: 'РегистрРасчета',
    InputFieldCalculator: 'ПолеВводаКалькулятор', InputFieldCalendar: 'ПолеВводаКалендарь',
    InputFieldChoose: 'ПолеВводаВыбрать', InputFieldChoice: 'ПолеВводаВыбрать',
    InputFieldChooseType: 'ПолеВводаВыбратьТип', InputFieldClear: 'ПолеВводаОчистить',
    InputFieldOpen: 'ПолеВводаОткрыть', InputOnBasis: 'ВводНаОсновании',
    InsertRows: 'ВставкаСтрок', Paste: 'ВставитьИзБуфераОбмена',
    ListViewMode: 'РежимПросмотраСписка', ListViewModeHierarchicalList: 'РежимПросмотраСпискаИерархическийСписок',
    ListViewModeList: 'РежимПросмотраСпискаСписок', ListViewModeTree: 'РежимПросмотраСпискаДерево',
    ListSettings: 'НастройкаСписка', Load: 'Загрузить', LoadReportSettings: 'ЗагрузитьНастройкиОтчета',
    MarkToDelete: 'ПометитьНаУдаление', SetListItemDeletionMark: 'УстановитьПометкуУдаленияЭлементаСписка',
    Magnifier: 'Лупа', Message: 'Сообщение', MetadataObjects: 'ОбъектыМетаданных',
    MoveDown: 'ПереместитьВниз', MoveLeft: 'ПереместитьВлево', MoveRight: 'ПереместитьВправо',
    MoveUp: 'ПереместитьВверх', MoveItem: 'ПеренестиЭлемент', NestedTable: 'ВложеннаяТаблица',
    NewWindow: 'НовоеОкно', Note: 'Заметка', OpenFile: 'ОткрытьФайл', SaveFile: 'СохранитьФайл', SaveAs: 'СохранитьКак',
    Organization: 'Организация', OutputList: 'ВывестиСписок', Parameters: 'Параметры',
    Picture: 'Картинка', Post: 'Провести', UndoPosting: 'ОтменаПроведения', Print: 'Печать',
    PrintImmediately: 'ПечатьСразу', Properties: 'Свойства', Question: 'Вопрос',
    QueryWizard: 'КонструкторЗапроса', Refresh: 'Обновить', Reread: 'Перечитать', Rename: 'Переименовать',
    Replace: 'Заменить', Report: 'Отчет', Reports: 'Отчеты', ReportSettings: 'НастройкиОтчета',
    SaveReportSettings: 'СохранитьНастройкиОтчета', SaveReportVariant: 'СохранитьВариантОтчета',
    RestoreValues: 'ВосстановитьЗначения', SaveValues: 'СохранитьЗначения',
    ScheduledJob: 'РегламентноеЗадание', ScheduledJobs: 'РегламентныеЗадания',
    SelectFromList: 'ВыбратьИзСписка', ChooseValue: 'ВыбратьЗначение', ChooseType: 'ВыбратьТип',
    SetDateInterval: 'УстановитьИнтервал', SetTime: 'УстановитьВремя', Settings: 'Настройки',
    Setting: 'Настройка', ShowData: 'ПоказатьДанные', ShowInList: 'ПоказатьВСписке',
    ShowOnMap: 'ПоказатьНаКарте', SortListAsc: 'СортироватьСписокПоВозрастанию',
    SortListDesc: 'СортироватьСписокПоУбыванию', SortList: 'СортироватьСписок', Sort: 'Сортировка',
    SpreadsheetShowGrid: 'ТабличныйДокументОтображатьСетку',
    SpreadsheetShowHeaders: 'ТабличныйДокументОтображатьЗаголовки',
    SpreadsheetShowGroups: 'ТабличныйДокументОтображатьГруппировки',
    SpreadsheetShowNotes: 'ТабличныйДокументОтображатьПримечания',
    SpreadsheetReadOnly: 'ТабличныйДокументТолькоПросмотр',
    SpreadsheetInsertNote: 'ТабличныйДокументВставитьПримечание',
    SpreadsheetDeleteNote: 'ТабличныйДокументУдалитьПримечание',
    SpreadsheetInsertPageBreak: 'ТабличныйДокументВставитьРазрывСтраницы',
    SpreadsheetDeletePageBreak: 'ТабличныйДокументУдалитьРазрывСтраницы',
    Stop: 'Остановить', StartBusinessProcess: 'СтартБизнесПроцесса', Structure: 'Структура',
    Subsystem: 'Подсистема', Task: 'Задача', TaskObject: 'ЗадачаОбъект', Today: 'Сегодня',
    ArrowUp: 'СтрелкаВверх', ArrowDown: 'СтрелкаВниз', ArrowLeft: 'СтрелкаВлево', ArrowRight: 'СтрелкаВправо',
    LevelUp: 'УровеньВверх', LevelDown: 'УровеньВниз', SelectTopLevel: 'ВыбратьВерхнийУровень',
    User: 'Пользователь', Warning: 'Предупреждение', Write: 'Записать', WriteAndClose: 'ЗаписатьИЗакрыть',
    WriteChanges: 'ЗаписатьИзменения', ReadChanges: 'ПрочитатьИзменения',
    ZoomIn: 'УвеличитьМасштаб', ZoomOut: 'УменьшитьМасштаб', ChangeScale: 'ИзменитьМасштаб',
    Generate: 'Сформировать', GenerateReport: 'СформироватьОтчет',
    DataProcessor: 'Обработка', Attribute: 'Реквизит', Dimension: 'Измерение',
    Resource: 'Ресурс', Protection: 'Защита', Certificate: 'Сертификат', Signature: 'Подпись',
    FixTable: 'ЗафиксироватьТаблицу', ReplaceTable: 'КонструкторЗапросаЗаменитьТаблицу',
    ToggleActivity: 'ПереключитьАктивность', Hint: 'Подсказка', Tooltip: 'Подсказка',
    ShowPassword: 'ПоказатьПароль', HidePassword: 'СкрытьПароль', Mark: 'Пометка', Grouping: 'Группировка',
    Submenu: 'Подменю', Appearance: 'Оформление', SettingsStorage: 'ХранилищеНастроек',
    CustomExpression: 'ПроизвольноеВыражение', QualityCheck: 'ПроверкаКачества', Success: 'Успешно',
    Send: 'Отправить', Receive: 'Получить', Notifications: 'Оповещения', Discussions: 'Обсуждения',
    NewDiscussion: 'НовоеОбсуждение', SendMessage: 'ОтправитьСообщение', Address: 'Адрес',
    Partner: 'Партнер', Item: 'Элемент', Enterprise: 'Предприятие', Empty: 'Пустая',
    RotateClockwise: 'ПовернутьПоЧасовойСтрелке', RotateCounterclockwise: 'ПовернутьПротивЧасовойСтрелки',
    Label: 'Метка', Symbol: 'Символ', ChangeHistory: 'ИсторияИзменений', MessageHistory: 'ИсторияСообщений',
    QuickAccess: 'БыстрыйДоступ', Underline: 'Подчеркивание', PasswordShow: 'ПоказатьПароль'
};

var STD_PICTURE_SVG = /^(ВнешнийПользовательСистемыВзаимодействия|ГрупповоеОбсуждение|Диалог(Вопрос|Восклицание|Информация|Стоп)|Избранное|ИзменитьМасштаб|Информация|ИсторияИзменений|ИсторияСообщений|Календарь|Калькулятор|КомандаМенюФункций|Метка|Настройка|НачатьВидеоконференцию|НовоеОбсуждение|Оповещать|Оповещения|Папка|Параметры|ПерейтиПо(Внешней)?НавигационнойСсылке|Повернуть(По|Против)ЧасовойСтрелк[еи]|ПоискДанных|ПоказатьПароль|ПолучитьНавигационнуюСсылку|Пользователь(Интеграции)?СистемыВзаимодействия|Прикрепить|СкрытьПароль|Сообщение|СохранитьКак|Справка|ЦветГраницы|ОтправитьСообщение)$/;

/* URL of the platform picture file for a StdPicture/БиблиотекаКартинок ref,
 * or '' when the library has no such picture. */
function stdPictureUrl(ref) {
    var m = String(ref || '').trim().match(/^(?:StdPicture|БиблиотекаКартинок)\.([A-Za-zА-Яа-яЁё0-9_]+)$/);
    if (!m) return '';
    var ru = Object.prototype.hasOwnProperty.call(STD_PICTURE_RU, m[1]) ? STD_PICTURE_RU[m[1]] : m[1];
    if (!/^[А-Яа-яЁё0-9]+$/.test(ru)) return '';
    return 'std-pictures/' + encodeURIComponent(ru) + (STD_PICTURE_SVG.test(ru) ? '.svg' : '.png');
}

function objectMetaCandidates(formPath) {
    var p = String(formPath || '').replace(/[/]+/g, '\\').replace(/\\+$/, '');
    var parts = p.split('\\').filter(Boolean);
    if (parts.length < 5) return [];
    if (!/^form\.xml$/i.test(parts[parts.length - 1])) return [];
    if (!/^ext$/i.test(parts[parts.length - 2])) return [];
    if (!/^forms$/i.test(parts[parts.length - 4])) return [];
    var objectName = parts[parts.length - 5];
    var parent = parts.slice(0, parts.length - 5).join('\\');
    var objectDir = parent ? parent + '\\' + objectName : objectName;
    return [
        (parent ? parent + '\\' : '') + objectName + '.xml',
        objectDir + '\\' + objectName + '.xml'
    ];
}

function metaProps(el) {
    return firstChild(el, 'Properties') || el;
}

function ingestStandardAttributes(el, prefix, captions, fillChecking) {
    if (!el) return;
    for (var i = 0; i < el.children.length; i++) {
        var c = el.children[i];
        if (localName(c) !== 'StandardAttribute') continue;
        var n = c.getAttribute('name') || '';
        if (!n) continue;
        var key = prefix ? prefix + '.' + n : n;
        var syn = localizedFrom(firstChild(c, 'Synonym'));
        if (!syn && PATH_CAPTIONS[n]) syn = PATH_CAPTIONS[n];
        if (syn) captions[key] = syn;
        /* Standard attributes carry their own xr:FillChecking: a BusinessProcess
         * Date=ShowError, or catalog Владелец/Родитель/Наименование, are
         * red-dotted in the reference. */
        var fill = fillChecking ? textOf(firstChild(c, 'FillChecking')) : '';
        if (fill) fillChecking[key] = fill;
    }
}

function ingestAttribute(el, prefix, captions, stringLen, types, fillChecking, numberQ, dateFraction, multiLine) {
    var p = metaProps(el);
    var n = textOf(firstChild(p, 'Name')) || el.getAttribute('name') || '';
    if (!n) return;
    var key = prefix ? prefix + '.' + n : n;
    var syn = localizedFrom(firstChild(p, 'Synonym'));
    if (syn) captions[key] = syn;
    var type = typeRefsOf(p) || scalarOf(firstChild(p, 'Type'));
    if (type) types[key] = type;
    var fill = textOf(firstChild(p, 'FillChecking'));
    if (fill) fillChecking[key] = fill;
    var len = typeLengthOf(p);
    if (len < 0) stringLen[key] = 0;
    else if (len > 0) stringLen[key] = len;
    var nq = typeNumberQualifiersOf(p);
    if (nq) numberQ[key] = nq;
    var df = typeDateFractionOf(p);
    if (df) dateFraction[key] = df;
    if (multiLine && textOf(firstChild(p, 'MultiLine')) === 'true') multiLine[key] = true;
}

function ingestChildObjects(el, prefix, captions, stringLen, types, fillChecking, numberQ, dateFraction, multiLine) {
    if (!el) return;
    for (var i = 0; i < el.children.length; i++) {
        var c = el.children[i];
        var tag = localName(c);
        if (tag === 'Attribute' || tag === 'Dimension' || tag === 'Resource'
            || tag === 'AccountingFlag' || tag === 'ExtDimensionAccountingFlag'
            || tag === 'AddressingAttribute') ingestAttribute(c, prefix, captions, stringLen, types, fillChecking, numberQ, dateFraction, multiLine);
        else if (tag === 'TabularSection') {
            var tp = metaProps(c);
            var tn = textOf(firstChild(tp, 'Name'));
            if (!tn) continue;
            var tkey = prefix ? prefix + '.' + tn : tn;
            var tsyn = localizedFrom(firstChild(tp, 'Synonym'));
            if (tsyn) captions[tkey] = tsyn;
            ingestStandardAttributes(firstChild(tp, 'StandardAttributes'), tkey, captions, fillChecking);
            ingestChildObjects(firstChild(c, 'ChildObjects'), tkey, captions, stringLen, types, fillChecking, numberQ, dateFraction, multiLine);
        }
    }
}

function parseObjectMeta(xml) {
    if (!xml || typeof xml !== 'string' || xml.indexOf('MetaDataObject') < 0) return null;
    var doc;
    try { doc = new DOMParser().parseFromString(xml, 'application/xml'); }
    catch (e) { return null; }
    if (doc.querySelector && doc.querySelector('parsererror')) return null;
    var root = doc.documentElement;
    if (!root || localName(root) !== 'MetaDataObject') return null;
    var obj = root.children && root.children[0];
    if (!obj) return null;
    var props = firstChild(obj, 'Properties');
    var captions = {};
    var stringLen = {};
    var types = {};
    var fillChecking = {};
    var numberQ = {};
    var dateFraction = {};
    var multiLine = {};
    var name = '';
    var synonym = '';
    var listPresentation = '';
    var objectBelonging = '';
    var descriptionLength = 0;
    var codeLength = 0;
    var codeType = '';
    var hierarchical = false;
    var hierarchyType = '';
    var autonumbering = '';
    if (props) {
        autonumbering = textOf(firstChild(props, 'Autonumbering'));
        name = textOf(firstChild(props, 'Name'));
        hierarchical = /^true$/i.test(textOf(firstChild(props, 'Hierarchical')));
        hierarchyType = textOf(firstChild(props, 'HierarchyType'));
        synonym = localizedFrom(firstChild(props, 'Synonym'));
        listPresentation = localizedFrom(firstChild(props, 'ListPresentation'));
        objectBelonging = textOf(firstChild(props, 'ObjectBelonging'));
        descriptionLength = parseInt(textOf(firstChild(props, 'DescriptionLength')), 10) || 0;
        codeLength = parseInt(textOf(firstChild(props, 'CodeLength')), 10) || 0;
        codeType = textOf(firstChild(props, 'CodeType'));
        if (descriptionLength > 0) {
            stringLen.Description = descriptionLength;
            stringLen['Наименование'] = descriptionLength;
            types.Description = types['Наименование'] = 'xs:string';
        }
        /* Code is a string of CodeLength (or a number of that many digits);
         * without it the field would fall back to the 20-char default. */
        if (codeLength > 0) {
            if (!codeType || /^string|строка$/i.test(codeType)) {
                stringLen.Code = stringLen['Код'] = codeLength;
                types.Code = types['Код'] = 'xs:string';
            } else {
                types.Code = types['Код'] = 'xs:decimal';
                numberQ.Code = numberQ['Код'] = { digits: codeLength, fractionDigits: 0, allowedSign: 'Nonnegative' };
            }
        }
        ingestStandardAttributes(firstChild(props, 'StandardAttributes'), '', captions, fillChecking);
        /* Owner is typed by the catalog's Owners list (a CatalogRef owner gets
         * list and open buttons). */
        var owners = firstChild(props, 'Owners');
        var ownerTypes = [];
        for (var oi = 0; owners && oi < owners.children.length; oi++) {
            var ownerRef = textOf(owners.children[oi]).match(/^(\w+)\.(.+)$/);
            if (ownerRef) ownerTypes.push('cfg:' + ownerRef[1] + 'Ref.' + ownerRef[2]);
        }
        if (ownerTypes.length && !types.Owner) types.Owner = types['Владелец'] = ownerTypes.join(', ');
    }
    ingestChildObjects(firstChild(obj, 'ChildObjects'), '', captions, stringLen, types, fillChecking, numberQ, dateFraction, multiLine);
    var kindTag = localName(obj);
    var kind = '';
    if (/Catalog/i.test(kindTag)) kind = 'catalog';
    else if (/Document/i.test(kindTag)) kind = 'document';
    /* Folder hierarchy offers «Создать группу»: ChartOfCharacteristicTypes
     * with Hierarchical and Catalog with HierarchyFoldersAndItems.
     * ChartOfAccounts hierarchy has no folders. */
    var hasFolders = hierarchical && (/^ChartOfCharacteristicTypes$/.test(kindTag)
        || (kind === 'catalog' && !/HierarchyOfItems/i.test(hierarchyType)));
    /* A DefinedType resolves to its member types; nested TypeSets stay
     * unresolved (no definedType). */
    var definedType = null;
    if (kindTag === 'DefinedType' && props) {
        var td = parseTypeDescription(props);
        if (td && td.types.length && !td.typeSets.length) {
            definedType = {
                types: td.types.join(', '),
                stringLen: typeLengthOf(props),
                numberQ: typeNumberQualifiersOf(props),
                dateFraction: typeDateFractionOf(props)
            };
        }
    }
    return {
        definedType: definedType,
        hasFolders: hasFolders,
        name: name,
        synonym: synonym,
        listPresentation: listPresentation,
        captions: captions,
        stringLen: stringLen,
        types: types,
        fillChecking: fillChecking,
        numberQ: numberQ,
        dateFraction: dateFraction,
        multiLine: multiLine,
        kind: kind,
        objectBelonging: objectBelonging,
        /* 'false' keeps Code/Number editable. */
        autonumbering: autonumbering,
        /* Set by form-context.js when <object>/Ext/Help.xml exists. */
        hasHelp: xml.indexOf('<!--fp-object-help-->') >= 0,
        descriptionLength: descriptionLength,
        codeLength: codeLength,
        codeType: codeType
    };
}

function catalogPresentationLength(om) {
    if (!om || om.kind !== 'catalog') return 0;
    var codeType = String(om.codeType || '');
    var stringCode = !codeType || /^string|строка$/i.test(codeType);
    var length = stringCode ? om.descriptionLength : om.codeLength;
    return length > 0 ? length : 0;
}

function indexCatalogRefChars(om, refChars) {
    if (!om || !om.name || !refChars) return;
    var length = catalogPresentationLength(om);
    if (length <= 0) return;
    refChars['cfg:CatalogRef.' + om.name] = length;
    refChars['CatalogRef.' + om.name] = length;
}

function parseRefMetas(map) {
    var out = {};
    if (!map) return out;
    for (var key in map) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
        var parsed = parseObjectMeta(map[key]);
        if (parsed) out[key] = parsed;
    }
    return out;
}

function collectCatalogRefChars(model) {
    var refChars = {};
    indexCatalogRefChars(model && model.objectMeta, refChars);
    var extras = (model && model.refMeta) || {};
    for (var key in extras) {
        if (Object.prototype.hasOwnProperty.call(extras, key))
            indexCatalogRefChars(extras[key], refChars);
    }
    return refChars;
}

function catalogRefCharsForTypes(types, index) {
    var map = index && index.refChars;
    if (!map || !types) return 0;
    for (var i = 0; i < types.length; i++) {
        var raw = String(types[i] || '');
        if (map[raw] > 0) return map[raw];
        var stripped = raw.replace(/^(?:cfg):/i, '');
        if (map[stripped] > 0) return map[stripped];
        if (map['cfg:' + stripped] > 0) return map['cfg:' + stripped];
    }
    return 0;
}

function parseCommandInterface(form) {
    var bar = firstChild(firstChild(form, 'CommandInterface'), 'CommandBar');
    var out = [];
    if (!bar) return out;
    var items = namedChildren(bar, 'Item');
    for (var i = 0; i < items.length; i++) {
        var el = items[i];
        out.push({
            command: textOf(firstChild(el, 'Command')),
            group: textOf(firstChild(el, 'CommandGroup')),
            index: textOf(firstChild(el, 'Index')),
            defaultVisible: textOf(firstChild(el, 'DefaultVisible')),
            visible: scalarOf(firstChild(el, 'Visible'))
        });
    }
    return out;
}

function commonCommandButtons(model) {
    var entries = (model && model.commandInterface) || [];
    var metadata = (model && model.commonCommands) || {};
    var out = [];
    var seen = {};
    for (var i = 0; i < entries.length; i++) {
        var fqn = String(entries[i].command || '');
        var match = fqn.match(/^CommonCommand\.(.+)$/i);
        if (!match) continue;
        var name = match[1];
        var meta = metadata[name];
        if (!meta) continue;
        /* CommandInterface describes a possible placement, not proof that the
         * command accepts the form's main parameter. The loader marks only
         * commands that pass the metadata applicability check. Rendering a
         * merely referenced command adds buttons which the reference suppresses. */
        if (!isTrue(prop(meta, ['GlobalApplicable']))) continue;
        var group = String(prop(meta, ['Group']) || '');
        /* Navigation-panel common commands and CreateBasedOn commands have a
         * different UI owner. Only FormCommandBar groups expand the empty
         * CommandSource=Form insertion point in the top bar. */
        if (!/^FormCommandBar/i.test(group) || /CreateBasedOn/i.test(group)) continue;
        var dedupe = fqn.toLowerCase();
        if (seen[dedupe]) continue;
        seen[dedupe] = true;
        out.push(syntheticBtn('_common' + i + '_' + name,
            rawTitle(meta) || humanizeIdent(name), pictureRef(meta),
            representationOf(meta) || 'Auto', {
                CommandName: fqn,
                ToolTip: prop(meta, ['ToolTip']),
                CommonCommandGroup: group
            }));
    }
    return out;
}

/* The reference does not use discovery/XML order for automatically applicable form
 * commands. It first partitions them by the standard command-bar category,
 * then compares the localized presentation inside that category. Keep this
 * deterministic even in runtimes whose localeCompare implementation differs. */
function generatedFormCommandGroupRank(groupRef) {
    var group = String(groupRef || '').toLowerCase();
    if (group === 'formcommandbar') return 0;
    if (group === 'formcommandbarimportant') return 1;
    return 2;
}

function russianCommandSortKey(value) {
    return String(value || '').toLowerCase().replace(/ё/g, 'е~');
}

function generatedFormCommandContributionRank(commandName, model, commandMeta) {
    var fqn = String(commandName || '');
    if (/^CommonCommand\./i.test(fqn)) return 0;
    var match = fqn.match(/^([^.]+)\.([^.]+)\.Command\./i);
    var objectMeta = model && model.objectMeta;
    var kind = String(objectMeta && objectMeta.kind || '');
    var expectedKind = kind === 'document' ? 'Document' : (kind === 'catalog' ? 'Catalog' : '');
    var ownerName = String(objectMeta && objectMeta.name || '').toLowerCase();
    if (match && ownerName && match[2].toLowerCase() === ownerName
        && (!expectedKind || match[1].toLowerCase() === expectedKind.toLowerCase())) return 0;
    var parameterType = String(prop(commandMeta, ['CommandParameterType']) || '').toLowerCase();
    var referenceKind = kind === 'document' ? 'documentref' : (kind === 'catalog' ? 'catalogref' : '');
    if (ownerName && referenceKind
        && parameterType.indexOf('cfg:' + referenceKind + '.' + ownerName) >= 0) return 0;
    /* Other reference kinds (a ChartOfAccountsRef attribute sorts among the
     * owner's attributes by caption). */
    if (ownerName && !referenceKind) {
        var at = parameterType.indexOf('ref.' + ownerName);
        var after = parameterType.charAt(at + 4 + ownerName.length);
        if (at > 0 && /cfg:[a-z]+$/.test(parameterType.slice(0, at))
            && !/[0-9a-zа-яё_]/.test(after)) return 0;
    }
    /* The reference keeps a parameterized command with an explicit reference to the
     * current object in the ordinary alphabetic segment. Indirect applicability
     * through a DefinedType is a later contribution segment. */
    return 1;
}

function compareGeneratedFormCommands(left, right) {
    var leftGroup = prop(left, ['CommonCommandGroup']);
    var rightGroup = prop(right, ['CommonCommandGroup']);
    var rank = generatedFormCommandGroupRank(leftGroup) - generatedFormCommandGroupRank(rightGroup);
    if (rank) return rank;
    rank = Number(prop(left, ['GeneratedContributionRank']) || 0)
        - Number(prop(right, ['GeneratedContributionRank']) || 0);
    if (rank) return rank;
    var leftTitle = russianCommandSortKey(rawTitle(left));
    var rightTitle = russianCommandSortKey(rawTitle(right));
    if (leftTitle < rightTitle) return -1;
    if (leftTitle > rightTitle) return 1;
    var leftIdentity = russianCommandSortKey(prop(left, ['CommandName']) || left.name);
    var rightIdentity = russianCommandSortKey(prop(right, ['CommandName']) || right.name);
    return leftIdentity < rightIdentity ? -1 : (leftIdentity > rightIdentity ? 1 : 0);
}

function globalCommonCommandItems(model) {
    var metadata = (model && model.commonCommands) || {};
    var groups = (model && model.commandGroups) || {};
    var excluded = {};
    var entries = (model && model.commandInterface) || [];
    for (var e = 0; e < entries.length; e++) {
        if (!isFalse(entries[e].defaultVisible) && !isFalse(entries[e].visible)) continue;
        excluded[String(entries[e].command || '').toLowerCase()] = true;
    }
    var grouped = {};
    var createBasedOn = [];
    var loose = [];
    var groupPopups = [];
    for (var name in metadata) {
        if (!Object.prototype.hasOwnProperty.call(metadata, name)) continue;
        var meta = metadata[name];
        if (!isTrue(prop(meta, ['GlobalApplicable']))) continue;
        var fqn = String(prop(meta, ['CommandFqn']) || ('CommonCommand.' + name));
        var groupRef = String(prop(meta, ['Group']) || '');
        /* The designer keeps a command-bar command the form's CommandInterface
         * marks invisible; only create-based-on entries leave the bar. */
        if (excluded[fqn.toLowerCase()] && /CreateBasedOn/i.test(groupRef)) continue;
        var button = syntheticBtn('_global_' + name, rawTitle(meta) || humanizeIdent(name),
            pictureRef(meta), representationOf(meta) || 'Auto', {
                CommandName: fqn,
                CommonCommandGroup: groupRef,
                GeneratedContributionRank: generatedFormCommandContributionRank(fqn, model, meta)
            });
        var match = groupRef.match(/^CommandGroup\.(.+)$/i);
        if (match) (grouped[match[1]] || (grouped[match[1]] = [])).push(button);
        else if (/^FormCommandBarCreateBasedOn/i.test(groupRef)) createBasedOn.push(button);
        else if (/^FormCommandBar/i.test(groupRef)) loose.push(button);
    }
    for (var groupName in grouped) {
        if (!Object.prototype.hasOwnProperty.call(grouped, groupName)) continue;
        var groupMeta = groups[groupName];
        groupPopups.push({
            tag: 'Popup', name: '_global_group_' + groupName, id: '',
            properties: {
                Title: (groupMeta && rawTitle(groupMeta)) || humanizeIdent(groupName),
                Picture: groupMeta ? pictureRef(groupMeta) : '',
                /* A reusable group may advertise Picture, while its expansion
                 * in FormCommandPanelGlobalCommands is picture plus caption. */
                Representation: 'PictureAndText'
            },
            childItems: grouped[groupName]
        });
    }
    /* [CMD-GROUP-OBJECTS] the reference orders reusable group popups by caption
     * («Настройки» before «Органайзер»). */
    groupPopups.sort(function (a, b) {
        var ka = russianCommandSortKey(a.properties.Title), kb = russianCommandSortKey(b.properties.Title);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    loose.sort(compareGeneratedFormCommands);
    if (createBasedOn.length) {
        loose.push({
            tag: 'Popup', name: '_global_create_based_on', id: '',
            properties: { Title: 'Создать на основании', Representation: 'Text' },
            childItems: createBasedOn
        });
    }
    /* Reusable CommandGroup popups are a later platform segment. In the reference they
     * follow CreateBasedOn instead of competing with leaf commands by title. */
    return loose.concat(groupPopups);
}

function detachCreateBasedOnPopup(root) {
    var detached = null;
    function visit(container) {
        var kids = container && container.childItems;
        if (!kids || detached) return;
        for (var i = 0; i < kids.length; i++) {
            if (isCreateBasedOnPopup(kids[i])) {
                detached = kids.splice(i, 1)[0];
                return;
            }
            visit(kids[i]);
            if (detached) return;
        }
    }
    visit(root);
    return detached;
}

function mergePopupCommands(target, source) {
    if (!target || !source) return target;
    var existing = {};
    walkFormItems(target, function (item) {
        var command = String(prop(item, ['CommandName', 'Command']) || '').toLowerCase();
        if (command) existing[command] = true;
    });
    var additions = [];
    var sourceKids = source.childItems || [];
    for (var i = 0; i < sourceKids.length; i++) {
        var command = String(prop(sourceKids[i], ['CommandName', 'Command']) || '').toLowerCase();
        if (command && existing[command]) continue;
        if (command) existing[command] = true;
        additions.push(sourceKids[i]);
    }
    target.childItems = (target.childItems || []).concat(additions);
    return target;
}

function normalizeGeneratedFormCommands(items) {
    var seen = {};
    var leaves = [];
    var tail = [];
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var command = String(prop(item, ['CommandName', 'Command']) || '').toLowerCase();
        if (command && seen[command]) continue;
        if (command) seen[command] = true;
        if (item && item.tag === 'Popup') tail.push(item);
        else leaves.push(item);
    }
    leaves.sort(compareGeneratedFormCommands);
    return leaves.concat(tail);
}

/* A body CommandBar with CommandSource=Item.<Table> is that table's bar when
 * the table hides its own: it carries the table's search string too. */
function attachItemSourcedSearch(model) {
    if (!model) return;
    var tables = {};
    walkFormItems({ childItems: model.childItemsRoot }, function (item) {
        if (item && item.tag === 'Table' && item.name) tables[item.name] = item;
    });
    walkFormItems({ childItems: model.childItemsRoot }, function (item) {
        if (!item || item.tag !== 'CommandBar') return;
        var source = /^Item\.(.+)$/.exec(String(prop(item, ['CommandSource']) || ''));
        var table = source && tables[source[1]];
        /* A group such as ГруппаСтандартныеКомандыСписка carries the search of the
         * main list whose own bar is merged into the form. */
        if (!table || !table.searchStringAddition
            || additionHidden(table, 'SearchStringLocation')
            || isFalse(prop(table, ['Visible', 'visible']))) return;
        /* A table without a bar (or with a non-autofilled own bar) searches in
         * CommandSource=Item.<Table> unless the visible autofilled form bar
         * already took the search. Hidden table: no search anywhere. */
        if (!tableBarMergedIntoForm(table, model)) {
            var ownBar = table.autoCommandBar;
            if (commandBarLocation(table) !== 'none' && !(ownBar && isFalse(prop(ownBar, ['Autofill'])))) return;
            if (tableSearchWithoutBarHoistedToForm(table, model) || tableSearchHoistedToForm(table, model)) return;
        }
        var kids = item.childItems || (item.childItems = []);
        for (var i = 0; i < kids.length; i++) if (kids[i] && kids[i].tag === 'SearchStringAddition') return;
        var at = kids.length;
        for (var h = 0; h < kids.length; h++) if (isHelpItem(kids[h])) { at = h; break; }
        kids.splice(at, 0, table.searchStringAddition);
    });
}

/* A CommandBar with CommandSource=Item.<FormattedDocumentField> is filled with
 * the field's formatting commands («Шрифт», A+, A-, «Полужирный», «Курсив»,
 * «Подчеркивание», «Цвет фона», «Цвет текста», picture). */
function attachFormattedDocumentCommands(model) {
    if (!model) return;
    var documents = {};
    walkFormItems({ childItems: model.childItemsRoot }, function (item) {
        if (item && item.tag === 'FormattedDocumentField' && item.name) documents[item.name] = item;
    });
    walkFormItems({ childItems: model.childItemsRoot }, function (item) {
        if (!item || item.tag !== 'CommandBar' || isFalse(prop(item, ['Autofill']))) return;
        var source = /^Item\.(.+)$/.exec(String(prop(item, ['CommandSource']) || ''));
        if (!source || !documents[source[1]] || (item.childItems && item.childItems.length)) return;
        function group(name, buttons) {
            return { tag: 'ButtonGroup', name: name, id: '', properties: {}, childItems: buttons };
        }
        function std(name, title, picture) {
            return syntheticBtn('_fmt' + name, title, picture || '', picture ? 'Picture' : 'Text', {
                CommandName: 'Item.' + source[1] + '.StandardCommand.' + name
            });
        }
        item.childItems = [
            group('_fmtFont', [std('Font', 'Шрифт'), std('IncreaseFontSize', 'Увеличить шрифт', 'StdPicture.IncreaseFontSize'),
                std('DecreaseFontSize', 'Уменьшить шрифт', 'StdPicture.DecreaseFontSize')]),
            group('_fmtStyle', [std('Bold', 'Полужирный'), std('Italic', 'Курсив'), std('Underline', 'Подчеркивание')]),
            group('_fmtColor', [std('BackColor', 'Цвет фона'), std('TextColor', 'Цвет текста')]),
            std('InsertPicture', 'Вставить картинку', 'StdPicture.InsertPicture')
        ];
        /* The rest of the formatting set lives in «Еще», which the reference always
         * shows at the bar's right edge. */
        [['Strikeout', 'Зачеркнутый'], ['AlignLeft', 'По левому краю'], ['AlignCenter', 'По центру'],
            ['AlignRight', 'По правому краю'], ['AlignJustify', 'По ширине']].forEach(function (extra) {
            var button = std(extra[0], extra[1]);
            button.properties.LocationInCommandBar = 'InAdditionalSubmenu';
            item.childItems.push(button);
        });
    });
}

/* With the root bar not autofilled, a body CommandBar with CommandSource=Form
 * is the form bar: it paints «Создать», «Скопировать», authored commands
 * and then «Поиск (Ctrl+F)». */
function attachFormSourcedListCommands(model) {
    if (!model) return;
    var rootBar = model.autoCommandBar;
    /* A hidden root bar hands over the same way (CommandBarLocation=None: the
     * body bar carries the list search). */
    if (!rootBar || (!isFalse(prop(rootBar, ['Autofill'])) && commandBarLocation(model) !== 'none')) return;
    var host = null;
    var helpHost = null;
    walkFormItems({ childItems: model.childItemsRoot }, function (item) {
        if (!item || String(prop(item, ['CommandSource']) || '').trim() !== 'Form') return;
        if (!host && item.tag === 'CommandBar') host = item;
        if (!helpHost && (item.tag === 'CommandBar' || item.tag === 'ButtonGroup')) helpHost = item;
    });
    /* The object's or form's «?» follows the bar that replaces the root one
     * (possibly a bottom ButtonGroup). */
    var objectMeta = model.objectMeta;
    var helpKids = helpHost && (helpHost.childItems || (helpHost.childItems = []));
    if (helpKids && objectMeta && objectMeta.hasHelp && !commandExcluded(model, 'Help')
        && !helpKids.some(function (kid) { return kid && isHelpItem(kid); }))
        helpKids.push(syntheticBtn('_stdHelp', '?', 'StdPicture.Help', 'Picture', {
            CommandName: 'Form.StandardCommand.Help'
        }));
    if (!host) return;
    var listItems = mainListStandardItems(model);
    if (!listItems.length) return;
    var kids = host.childItems || (host.childItems = []);
    for (var i = 0; i < kids.length; i++)
        if (kids[i] && /^_stdList/.test(String(kids[i].name || ''))) return;
    var have = collectStdCommandKeys(kids);
    var buttons = [];
    var search = null;
    for (var j = 0; j < listItems.length; j++) {
        var it = listItems[j];
        if (it.tag === 'SearchStringAddition') { search = it; continue; }
        var key = stdCommandKey(it);
        if (key && have[key]) continue;
        buttons.push(it);
    }
    if (buttons.length) Array.prototype.unshift.apply(kids, buttons);
    if (search && !kids.some(function (kid) { return kid && kid.tag === 'SearchStringAddition'; })) {
        var at = kids.length;
        for (var h = 0; h < kids.length; h++) if (isHelpItem(kids[h])) { at = h; break; }
        kids.splice(at, 0, search);
    }
}

function fillCommonCommands(model) {
    var generated = normalizeGeneratedFormCommands(
        commonCommandButtons(model).concat(globalCommonCommandItems(model)));
    if (!generated.length) return;
    var bar = model && model.autoCommandBar;
    if (!bar) {
        model.autoCommandBar = {
            tag: 'AutoCommandBar', name: 'ФормаКоманднаяПанель', id: '-1',
            properties: {}, childItems: generated
        };
        return;
    }
    var existing = {};
    walkFormItems(bar, function (item) {
        var command = String(prop(item, ['CommandName', 'Command']) || '').toLowerCase();
        if (command) existing[command] = true;
    });
    generated = generated.filter(function (item) {
        return !existing[String(prop(item, ['CommandName'])).toLowerCase()];
    });
    if (!generated.length) return;
    var insertion = null;
    walkFormItems(bar, function (item) {
        if (insertion || !item || (item.tag !== 'ButtonGroup' && item.tag !== 'CommandBar')) return;
        var source = String(prop(item, ['CommandSource']) || '');
        if (/^(?:Form|FormCommandPanelGlobalCommands)$/i.test(source)
            || /ГлобальныеКоманды|GlobalCommands/i.test(item.name || '')) insertion = item;
    });
    /* CommandBarLocation=None is often paired with a visible custom bar whose
     * CommandSource=Form. Only then fall back from the
     * hidden root bar to a form-sourced bar in the body. */
    /* A root bar with Autofill=false does not take platform commands either;
     * a form-sourced ButtonGroup in the body does (inside the list bar, or a
     * FormCommandPanelGlobalCommands group). */
    var rootNoAutofill = isFalse(prop(bar, ['Autofill']));
    if (!insertion && (commandBarLocation(model) === 'none' || rootNoAutofill)) {
        walkFormItems({ childItems: model.childItemsRoot }, function (item) {
            if (insertion || !item || (item.tag !== 'CommandBar' && item.tag !== 'ButtonGroup')) return;
            if (/^(?:Form|FormCommandPanelGlobalCommands)$/i.test(String(prop(item, ['CommandSource']) || '')))
                insertion = item;
        });
    }
    if (!insertion && rootNoAutofill) return;
    var authoredCreateBasedOn = detachCreateBasedOnPopup(bar);
    if (authoredCreateBasedOn) {
        if (!authoredCreateBasedOn.properties) authoredCreateBasedOn.properties = {};
        authoredCreateBasedOn.properties.Representation = 'Text';
        var createIndex = -1;
        for (var g = 0; g < generated.length; g++) {
            if (isCreateBasedOnPopup(generated[g])) { createIndex = g; break; }
        }
        if (createIndex >= 0) {
            generated[createIndex] = mergePopupCommands(authoredCreateBasedOn, generated[createIndex]);
        } else {
            createIndex = generated.length;
            for (var p = 0; p < generated.length; p++) {
                if (/^_global_group_/i.test(String(generated[p] && generated[p].name || ''))) {
                    createIndex = p;
                    break;
                }
            }
            generated.splice(createIndex, 0, authoredCreateBasedOn);
        }
    }
    if (insertion && insertion.tag === 'CommandBar') {
        generated = generated.filter(function (item) {
            return !/CreateBasedOn/i.test(String(prop(item, ['CommonCommandGroup']) || ''));
        });
    }
    /* A command the insertion bar already authors is not generated twice:
     * it stays in «Еще» (InAdditionalSubmenu). */
    if (insertion) {
        var authored = {};
        walkFormItems(insertion, function (item) {
            var command = String(prop(item, ['CommandName', 'Command']) || '').toLowerCase();
            if (command) authored[command] = true;
        });
        generated = generated.filter(function (item) {
            return !authored[String(prop(item, ['CommandName']) || '').toLowerCase()];
        });
    }
    /* A form-sourced ButtonGroup in a root bar with Autofill=false stands for
     * the whole platform segment: the reference also puts the object's standard Write
     * there and the «Создать на основании» popup before reusable group popups
     * (e.g. a task form: Записать, Выполнено, Перенаправить..., Создать на
     * основании, Органайзер). */
    if (insertion && insertion.tag === 'ButtonGroup' && rootNoAutofill) {
        var kind = formObjectKind(model);
        var present = collectStdCommandKeys(bar.childItems || []);
        var leading = [];
        if ((kind === 'catalog' || kind === 'document' || isWritableReferenceObjectForm(model))
            && !present.write && !commandExcluded(model, 'Write'))
            leading.push(syntheticBtn('_stdWrite', 'Записать', '', 'Text', {
                CommandName: 'Form.StandardCommand.Write'
            }));
        if (!generated.some(isCreateBasedOnPopup) && !authoredCreateBasedOn) {
            var basedOn = createBasedOnButtons(model);
            if (basedOn.length) {
                var at = generated.length;
                for (var gp = 0; gp < generated.length; gp++) {
                    if (/^_global_group_/i.test(String(generated[gp] && generated[gp].name || ''))) { at = gp; break; }
                }
                generated.splice(at, 0, {
                    tag: 'Popup', name: '_stdCreateBasedOn', id: '',
                    properties: { Title: 'Создать на основании', Representation: 'Text' },
                    childItems: basedOn
                });
            }
        }
        generated = leading.concat(generated);
    }
    if (insertion && insertion.tag === 'CommandBar' && (insertion.childItems || []).length) {
        /* An authored form-sourced bar keeps the root bar's segments: its
         * pictorial items, then the generated commands, then its text
         * buttons (appended last, they would fall into «Еще»). */
        var barPrimary = [];
        var barTrailing = [];
        insertion.childItems.forEach(function (item) {
            var rep = representationOf(item);
            (rep === 'picture' || rep === 'pictureandtext' ? barPrimary : barTrailing).push(item);
        });
        insertion.childItems = barPrimary.concat(generated, barTrailing);
    } else if (insertion) insertion.childItems = (insertion.childItems || []).concat(generated);
    else {
        /* Navigation is the authored platform segment immediately following
         * persistence actions. Generated global leaves, CreateBasedOn and
         * reusable command groups follow it; unrelated local commands remain
         * after the generated contribution. */
        var navigation = [];
        var local = [];
        (bar.childItems || []).forEach(function (item) {
            (isNavigationPopup(item) ? navigation : local).push(item);
        });
        /* The reference keeps authored pictorial actions in the primary command segment,
         * then contributes applicable global commands, while authored text
         * actions remain in the trailing segment. */
        var localPrimary = [];
        var localTrailing = [];
        local.forEach(function (item) {
            /* A command may carry a metadata picture even when its authored
             * button representation is text. The reference keeps that button in the
             * trailing text segment; only the button's explicit visual
             * representation makes it part of the primary pictorial segment. */
            if (representationOf(item) === 'picture'
                || representationOf(item) === 'pictureandtext') localPrimary.push(item);
            else {
                item._fpCommandSegment = 'trailing-text';
                localTrailing.push(item);
            }
        });
        bar.childItems = navigation.concat(localPrimary, generated, localTrailing);
    }
}

function isCreateBasedOnPopup(item) {
    if (!item || item.tag !== 'Popup') return false;
    var name = String(item.name || '');
    var title = rawTitle(item) || '';
    return /СоздатьНаОсновании|CreateBasedOn/i.test(name) || /создать на основании/i.test(title);
}

function isBasedOnCommand(entry) {
    var cmd = String((entry && entry.command) || '');
    var group = String((entry && entry.group) || '');
    if (/FormCommandBarCreateBasedOn/i.test(group)) return true;
    if (/\.StandardCommand\.CreateBasedOn$/i.test(cmd)) return true;
    if (/CreateBasedOn|СоздатьНаОсновании|ВводНаОсновании/i.test(cmd)) return true;
    return false;
}

function basedOnTitle(cmd) {
    var parts = String(cmd || '').split('.');
    if (parts.length >= 4 && /StandardCommand/i.test(parts[2]))
        return humanizeIdent(parts[1]);
    if (parts.length >= 4 && /^Command$/i.test(parts[2]))
        return humanizeIdent(parts[parts.length - 1]);
    if (parts.length >= 2 && /^CommonCommand$/i.test(parts[0]))
        return humanizeIdent(parts[1]);
    return humanizeIdent(lastSeg(cmd));
}

function createBasedOnButtons(model) {
    var list = (model && model.commandInterface) || [];
    var out = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!isBasedOnCommand(e)) continue;
        var cmd = e.command;
        if (!cmd || seen[cmd]) continue;
        if (/^CommonCommand\./i.test(cmd) && isFalse(e.defaultVisible)) continue;
        seen[cmd] = true;
        out.push(syntheticBtn('_basedOn' + i, basedOnTitle(cmd), '', 'Text', {
            CommandName: cmd
        }));
    }
    return out;
}

function applyCreateBasedOnPicture(popup, owner) {
    var picture = owner && owner.runtime && owner.runtime.createButtonsGroupPicture;
    if (!popup || !picture || !picture.ref) return popup;
    if (!popup.properties) popup.properties = {};
    if (!popup.properties.Picture) popup.properties.Picture = picture.ref;
    if (!popup.properties.Representation || /^text$/i.test(popup.properties.Representation))
        popup.properties.Representation = 'PictureAndText';
    return popup;
}

function ensureCreateBasedOnPopup(popup, model) {
    if (!isCreateBasedOnPopup(popup)) return;
    applyCreateBasedOnPicture(popup, model);
    if (popupHasCommands(popup)) return;
    var btns = createBasedOnButtons(model);
    if (!btns.length) return;
    popup.childItems = btns;
    if (!popup.properties) popup.properties = {};
    popup.properties.Representation = 'Text';
}

function walkFormItems(item, fn) {
    if (!item) return;
    fn(item);
    if (item.autoCommandBar) walkFormItems(item.autoCommandBar, fn);
    var kids = item.childItems || [];
    for (var i = 0; i < kids.length; i++) walkFormItems(kids[i], fn);
}

function fillCreateBasedOnMenus(model) {
    if (!model) return;
    walkFormItems({
        childItems: model.childItemsRoot,
        autoCommandBar: model.autoCommandBar
    }, function (item) {
        if (item.tag === 'Popup') ensureCreateBasedOnPopup(item, model);
    });
}

/* The reference binds a table's Find/CancelSearch only inside that table's own
 * AutoCommandBar. A button placed in another CommandBar keeps the raw command
 * unresolved and is painted as a text button captioned with its element name
 * (the longer CancelSearch twin then overflows into «Еще»). */
/* The reference paints nothing for a hyperlink button whose only face is a platform
 * StdPicture taken from its form command when the button has no authored
 * size: the platform Image is 0x0, yet its group still spends the item gap on it
 * (a field row of 124 px becomes 134 px = 124 + 10). Such buttons are absent
 * from the reference with or without functional options. The same hyperlink
 * is painted with a CommonPicture or with an authored Height. */
function markUnpaintedStdPictureHyperlinks(model) {
    if (!model || !model.commands) return;
    var commands = commandIndex(model.commands);
    walkFormItems({ childItems: model.childItemsRoot }, function (item) {
        if (item.tag !== 'Button') return;
        if (String(prop(item, ['Type']) || '').toLowerCase().replace(/[\s_-]+/g, '') !== 'hyperlink') return;
        if (pictureRef(item) || prop(item, ['Width']) || prop(item, ['Height'])) return;
        var name = String(prop(item, ['CommandName']) || '').match(/^Form\.Command\.([^.]+)$/i);
        var command = name && commands[name[1]];
        if (!command || !/^StdPicture\./i.test(String(pictureRef(command) || prop(command, ['Picture']) || ''))) return;
        var rep = representationOf(item);
        if (rep === 'auto') rep = representationOf(command);
        if (rep === 'picture') item._fpUnpaintedPicture = true;
    });
}

function markForeignSearchCommands(model) {
    if (!model) return;
    function markOwnBar(table) {
        if (!table.autoCommandBar) return;
        walkFormItems(table.autoCommandBar, function (item) { item._fpOwnTableBar = table.name; });
    }
    var root = { childItems: model.childItemsRoot, autoCommandBar: model.autoCommandBar };
    walkFormItems(root, function (item) { if (item.tag === 'Table') markOwnBar(item); });
    walkFormItems(root, function (item) {
        if (item.tag !== 'Button') return;
        var match = String(prop(item, ['CommandName']) || '')
            .match(/^Form\.Item\.([^.]+)\.StandardCommand\.(?:Find|CancelSearch)$/i);
        if (match && item._fpOwnTableBar !== match[1]) item._fpUnresolvedCommand = true;
    });
}

/* Inside its own table bar an Auto Find/CancelSearch button is a text command
 * in the reference (repres="Text" with «Найти...» and «Отменить поиск»). */
var OWN_TABLE_SEARCH_TITLES = { find: 'Найти...', cancelsearch: 'Отменить поиск' };

function ownTableSearchCommand(item) {
    if (!item || !item._fpOwnTableBar || item._fpUnresolvedCommand) return '';
    var match = String(prop(item, ['CommandName']) || '')
        .match(/^Form\.Item\.[^.]+\.StandardCommand\.(Find|CancelSearch)$/i);
    return match ? match[1].toLowerCase() : '';
}

function tableBarItems(table, model) {
    var std = tableStdCommands(table, model);
    var bar = table && table.autoCommandBar;
    var kids = ((bar && bar.childItems) || []).slice();
    /* A visible SearchStringAddition is the managed client's representation
     * of Find/CancelSearch. Configurations often keep those standard-command
     * buttons in AutoCommandBar as generated metadata, but the reference consumes them
     * into the search chrome instead of painting duplicate toolbar commands. */
    if (table && table.searchStringAddition && !additionHidden(table, 'SearchStringLocation')) {
        kids = kids.filter(function (item) {
            var commandName = String(prop(item, ['CommandName']) || '');
            return !/\.StandardCommand\.(?:Find|CancelSearch)$/i.test(commandName);
        });
    }
    for (var i = 0; i < kids.length; i++) {
        if (isCreateBasedOnPopup(kids[i]))
            applyCreateBasedOnPicture(kids[i], table);
    }
    if (tableIsList(table, model) && !kids.some(isCreateBasedOnPopup)) {
        var btns = createBasedOnButtons(model);
        if (btns.length) {
            var generatedPopup = {
                tag: 'Popup',
                name: '_stdCreateBasedOn',
                id: '',
                properties: { Title: 'Создать на основании', Representation: 'Text' },
                childItems: btns
            };
            applyCreateBasedOnPicture(generatedPopup, table);
            kids.unshift(generatedPopup);
        }
    }
    /* An authored standard command replaces its synthesized twin (e.g.
     * MoveUp/MoveDown placed in an authored button group). */
    var authoredStd = {};
    walkFormItems({ childItems: kids }, function (item) {
        var match = String(prop(item, ['CommandName']) || '').match(/\.StandardCommand\.(\w+)$/);
        if (match) authoredStd[match[1].toLowerCase()] = true;
    });
    var STD_TWINS = { _stdUp: 'moveup', _stdDown: 'movedown', _stdAdd: 'add', _stdCreate: 'create', _stdCopy: 'copy' };
    std = std.filter(function (item) {
        var twin = item && STD_TWINS[item.name];
        return !(twin && authoredStd[twin]);
    });
    var items = std.concat(kids);
    /* Row move commands need an editable row order: a ReadOnly table or
     * ChangeRowOrder=false paints no ↑/↓, synthesized or authored. */
    if (table && (isTrue(prop(table, ['ReadOnly', 'ТолькоПросмотр']))
        || isFalse(prop(table, ['ChangeRowOrder', 'ИзменятьПорядокСтрок']))))
        items = items.filter(function (item) {
            return !(item && (item.name === '_stdUp' || item.name === '_stdDown'
                || /StandardCommand\.Move(?:Up|Down)$/.test(String(prop(item, ['CommandName']) || ''))));
        });
    return items;
}

function buildCaptionIndex(model) {
    var captions = {};
    var stringLen = {};
    var types = {};
    var fillChecking = {};
    var numberQ = {};
    var dateFraction = {};
    var stringCharPx = {};
    var mainNames = {};
    var attrs = formAttributes(model);
    for (var i = 0; i < attrs.length; i++) {
        var a = attrs[i];
        if (!a || !a.name) continue;
        if (isTrue(prop(a, ['MainAttribute']))) mainNames[a.name] = true;
        var t = rawTitle(a);
        if (t) captions[a.name] = t;
        /* A TypeSet-only attribute (cfg:DefinedType.X) has empty typeRefs; keep
         * the set so expandDefinedTypes can resolve it. */
        var at = a.typeRefs || definedTypeSetsOf(a) || prop(a, ['Type']);
        if (at) types[a.name] = at;
        if (a.stringLen < 0) stringLen[a.name] = 0;
        else if (a.stringLen > 0) stringLen[a.name] = a.stringLen;
        if (a.numberQ) numberQ[a.name] = a.numberQ;
        if (a.dateFraction) dateFraction[a.name] = a.dateFraction;
        var fill = prop(a, ['FillCheck', 'FillChecking', 'ПроверкаЗаполнения']);
        if (fill) fillChecking[a.name] = fill;
        var cols = a.columns || [];
        for (var c = 0; c < cols.length; c++) {
            var col = cols[c];
            if (!col || !col.name) continue;
            var colPath = col.path || (a.name + '.' + col.name);
            var ct = rawTitle(col);
            if (ct) captions[colPath] = ct;
            var colType = col.typeRefs || definedTypeSetsOf(col) || prop(col, ['Type']);
            if (colType) types[colPath] = colType;
            if (col.stringLen < 0) stringLen[colPath] = 0;
            else if (col.stringLen > 0) stringLen[colPath] = col.stringLen;
            if (col.additional) stringCharPx[colPath] = GROUP_COL_PX;
            if (col.numberQ) numberQ[colPath] = col.numberQ;
            if (col.dateFraction) dateFraction[colPath] = col.dateFraction;
        }
    }
    var om = model && model.objectMeta;
    if (om) {
        var oc = om.captions || {};
        for (var k in oc) {
            if (Object.prototype.hasOwnProperty.call(oc, k) && !captions[k]) captions[k] = oc[k];
        }
        var ol = om.stringLen || {};
        for (var k2 in ol) {
            if (Object.prototype.hasOwnProperty.call(ol, k2) && stringLen[k2] == null)
                stringLen[k2] = ol[k2];
        }
        var ot = om.types || {};
        for (var k3 in ot) {
            if (Object.prototype.hasOwnProperty.call(ot, k3) && !types[k3]) types[k3] = ot[k3];
        }
        var onq = om.numberQ || {};
        for (var k5 in onq) {
            if (Object.prototype.hasOwnProperty.call(onq, k5) && !numberQ[k5]) numberQ[k5] = onq[k5];
        }
        var odf = om.dateFraction || {};
        for (var k6 in odf) {
            if (Object.prototype.hasOwnProperty.call(odf, k6) && !dateFraction[k6]) dateFraction[k6] = odf[k6];
        }
    }
    expandDefinedTypes(model, types, stringLen, numberQ, dateFraction);
    return {
        captions: captions, mainNames: mainNames, stringLen: stringLen,
        /* Kept apart: the object's FillChecking applies through the main
         * attribute only. Merged, an object attribute would shadow a form
         * attribute of the same name, and list-form filters would be underlined
         * although the reference leaves them plain. */
        types: types, fillChecking: fillChecking, objectFillChecking: (om && om.fillChecking) || {},
        numberQ: numberQ,
        dateFraction: dateFraction, stringCharPx: stringCharPx,
        multiLine: (om && om.multiLine) || {},
        refChars: collectCatalogRefChars(model)
    };
}

/* A field typed cfg:DefinedType.X paints the controls of the defined type's
 * members (CatalogRef -> dropdown arrow, not the "..." of an unresolved type
 * set). Replace each resolvable DefinedType.X member with its composition and
 * fill absent qualifiers. */
function definedTypeSetsOf(entry) {
    var sets = entry && entry.typeDescription && entry.typeDescription.typeSets;
    if (!sets || !sets.length) return '';
    var defined = sets.filter(function (set) { return /^(?:cfg:)?DefinedType\./i.test(set); });
    return defined.length === sets.length ? defined.join(', ') : '';
}

function expandDefinedTypes(model, types, stringLen, numberQ, dateFraction) {
    var refMeta = model && model.refMeta;
    if (!refMeta || !types) return;
    for (var key in types) {
        if (!Object.prototype.hasOwnProperty.call(types, key)) continue;
        var value = types[key];
        if (typeof value !== 'string' || !/DefinedType\./i.test(value)) continue;
        var changed = false;
        var parts = splitValueTypes(value).map(function (part) {
            var m = /^(?:cfg:)?DefinedType\.(.+)$/i.exec(part);
            var meta = m && refMeta['DefinedType.' + m[1]];
            var def = meta && meta.definedType;
            if (!def || !def.types) return part;
            changed = true;
            if (stringLen[key] == null && def.stringLen) stringLen[key] = def.stringLen < 0 ? 0 : def.stringLen;
            if (!numberQ[key] && def.numberQ) numberQ[key] = def.numberQ;
            if (!dateFraction[key] && def.dateFraction) dateFraction[key] = def.dateFraction;
            return def.types;
        });
        if (changed) types[key] = parts.join(', ');
    }
}

function captionForPath(path, index) {
    if (!path || !index || !index.captions) return '';
    return lookupPathMap(index.captions, path, index.mainNames) || '';
}

function lookupStringLen(lens, key) {
    if (!key || !lens || !Object.prototype.hasOwnProperty.call(lens, key)) return null;
    return lens[key] | 0;
}

function metaStringLen(item, ctx) {
    var index = ctx && ctx.captionIndex;
    if (!item || !index || !index.stringLen) return 0;
    var value = lookupPathMap(index.stringLen, prop(item, ['DataPath']), index.mainNames);
    return value == null ? 0 : value;
}

/* Unlike metaStringLen(), this distinguishes an absent qualifier (null) from
 * an unlimited string (0), which matters in the displayed type. */
function metaStringLengthQualifier(item, ctx) {
    var index = ctx && ctx.captionIndex;
    if (!item || !index) return null;
    return lookupPathMap(index.stringLen, prop(item, ['DataPath']), index.mainNames);
}

/* Same three-tier DataPath resolution as metaStringLen (exact path, then the
 * path with a stripped main-attribute prefix, then the last segment), reused
 * for any per-path lookup map keyed the same way. */
function lookupPathMap(map, path, mainNames, noAlias) {
    if (!map) return null;
    if (Object.prototype.hasOwnProperty.call(map, path)) return map[path];
    /* Runtime value-table paths carry row selectors (`Table[0].Column`) while
     * AdditionalColumns.table stores the same path without them. */
    var normalized = String(path || '').replace(/\[\d+\]/g, '');
    if (normalized !== path && Object.prototype.hasOwnProperty.call(map, normalized))
        return map[normalized];
    var parts = normalized.split('.');
    if (parts.length >= 2 && mainNames && mainNames[parts[0]]) {
        var rest = parts.slice(1).join('.');
        if (Object.prototype.hasOwnProperty.call(map, rest)) return map[rest];
    }
    var last = lastSeg(path);
    if (Object.prototype.hasOwnProperty.call(map, last)) return map[last];
    var alias = STD_ATTRIBUTE_ALIASES[last];
    if (alias && !noAlias) {
        var aliased = normalized.slice(0, normalized.length - last.length) + alias;
        if (aliased !== normalized) return lookupPathMap(map, aliased, mainNames, true);
    }
    return null;
}

function metaNumberQualifiers(item, ctx) {
    var index = ctx && ctx.captionIndex;
    if (!item || !index) return null;
    return lookupPathMap(index.numberQ, prop(item, ['DataPath']), index.mainNames);
}

function metaDateFraction(item, ctx) {
    var index = ctx && ctx.captionIndex;
    if (!item || !index) return '';
    var path = prop(item, ['DataPath']);
    var resolved = lookupPathMap(index.dateFraction, path, index.mainNames);
    if (resolved) return resolved;
    /* Date is a standard Document member and is absent from the form's
     * authored Attributes in many generated forms. The platform type of that
     * member is Date+Time, so its width must not fall back to date-only. */
    var normalized = String(path || '').replace(/\[\d+\]/g, '');
    var parts = normalized.split('.');
    if (parts.length >= 2 && index.mainNames && index.mainNames[parts[0]]) {
        var ownerType = String(index.types && index.types[parts[0]] || '');
        var member = parts.slice(1).join('.');
        if (/^cfg:Document(?:Object|Ref)\./i.test(ownerType) && /^(?:Date|Дата)$/i.test(member))
            return 'DateTime';
    }
    return '';
}

function isUnlimitedString(item, ctx) {
    var index = ctx && ctx.captionIndex;
    if (!item || !index || !index.stringLen) return false;
    return lookupPathMap(index.stringLen, prop(item, ['DataPath']), index.mainNames) === 0;
}

function isMultilineField(item, ctx) {
    if (!item) return false;
    if (isTrue(prop(item, ['MultiLine']))) return true;
    if (isFalse(prop(item, ['MultiLine']))) return false;
    if (isTrue(prop(item, ['ListChoiceMode'])) || isTrue(prop(item, ['DropListButton'])))
        return false;
    var h = parseInt(prop(item, ['Height', 'Высота']), 10);
    if (h > 1) return true;
    /* The attribute's own MultiLine (metadata) makes an unconfigured field a
     * text area (e.g. a task's Описание). */
    if (item.tag === 'InputField' && ctx && ctx.captionIndex
        && lookupPathMap(ctx.captionIndex.multiLine, prop(item, ['DataPath']), ctx.captionIndex.mainNames)
        && isUnlimitedString(item, ctx)) return true;
    /* Wrap is emitted for many ordinary scalar/reference fields too, so its
     * presence alone does not make a text area.  For an unlimited string it
     * does distinguish the text-area form from an ordinary one-line field.
     * Wrap=false stays one line. */
    if (isTrue(prop(item, ['Wrap'])) && isUnlimitedString(item, ctx)) return true;
    return false;
}

function lastSeg(s) {
    if (!s) return '';
    var parts = String(s).split('.');
    return parts[parts.length - 1];
}

function humanizeIdent(s) {
    if (!s) return '';
    var t = String(s).replace(/[_]+/g, ' ');
    t = t.replace(/([а-яёa-z])([А-ЯЁA-Z])/g, '$1 $2');
    t = t.replace(/([А-ЯЁA-Z]+)([А-ЯЁA-Z][а-яёa-z])/g, '$1 $2');
    /* A number glued to an identifier part is its own word: the reference renders
     * ДолжностьЗамещаласьМенее12Месяцев as "менее 12 месяцев". Only the
     * boundaries the platform also splits are cut - a digit followed by a
     * lower-case letter stays inside its word (Форма1с). */
    t = t.replace(/([А-ЯЁA-Zа-яёa-z])([0-9])/g, '$1 $2');
    t = t.replace(/([0-9])([А-ЯЁA-Z])/g, '$1 $2');
    var words = t.replace(/\s+/g, ' ').trim().split(' ');
    for (var i = 1; i < words.length; i++) {
        /* Preserve all-caps abbreviations (НДС, РНПТ, URL), but sentence-case
         * ordinary PascalCase identifier parts like Без/По/Продажи. A single
         * capital letter is a preposition (ОтразитьВТрудовойКнижке), never an
         * abbreviation, so it is lower-cased with the rest. */
        if (!/^[А-ЯЁA-Z0-9][А-ЯЁA-Z0-9]+$/.test(words[i]))
            words[i] = words[i].charAt(0).toLowerCase() + words[i].slice(1);
    }
    return words.join(' ');
}

function isTrue(v) {
    var s = String(v || '').toLowerCase().replace(/[\s_-]+/g, '');
    return s === 'true' || s === '1' || s === 'yes' || s === 'да';
}

function representationOf(item) {
    var v = String(prop(item, ['Representation', 'Отображение']) || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!v || v === 'auto' || v === 'авто') return 'auto';
    if (v.indexOf('pictureandtext') >= 0 || v.indexOf('textpicture') >= 0
        || v.indexOf('картинкаитекст') >= 0 || v.indexOf('тексткартинка') >= 0) return 'pictureandtext';
    if (v === 'picture' || v.indexOf('картинк') >= 0) return 'picture';
    if (v === 'text' || v.indexOf('текст') >= 0) return 'text';
    if (v === 'none' || v.indexOf('нет') >= 0) return 'none';
    return 'auto';
}

function groupRep(item) {
    return representationOf(item);
}

function pagesRep(item) {
    var raw = prop(item, ['PagesRepresentation', 'ПредставлениеСтраниц']);
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (v === 'none' || v.indexOf('нет') >= 0) return 'none';
    if (v.indexOf('bottom') >= 0 || v.indexOf('низ') >= 0 || v.indexOf('внизу') >= 0) return 'bottom';
    return 'top';
}

function inAdditionalBar(item) {
    var v = String(prop(item, ['LocationInCommandBar', 'ПоложениеВКоманднойПанели']) || '').toLowerCase();
    /* A Picture-only CustomizeForm/Help without an authored Picture has no bar
     * face in the reference and lives only in «Еще» (a standard-commands
     * group then shows just «Еще»). */
    if (item && !/^_std/.test(String(item.name || ''))
        && /StandardCommand\.(?:CustomizeForm|Help)$/.test(String(prop(item, ['CommandName']) || ''))
        && String(prop(item, ['Representation']) || '').toLowerCase() === 'picture' && !pictureRef(item))
        return true;
    /* A table Delete button without an authored location is never on the bar
     * row: the reference keeps it in «Еще». */
    if (item && !v && /StandardCommand\.Delete$/.test(String(prop(item, ['CommandName']) || '')))
        return true;
    /* Likewise a table's own Change (row edit) is absent from the reference
     * bar row. */
    if (item && !v && /^Form\.Item\.[^.]+\.StandardCommand\.Change$/.test(String(prop(item, ['CommandName']) || '')))
        return true;
    /* InCommandBar and InCommandBarAndInAdditionalSubmenu stay on the main
     * row. Only InAdditionalSubmenu is overflow-only. Matching "additional"
     * first sent wizard Next/Cancel into More. */
    if (v.indexOf('incommandbar') >= 0 || v.indexOf('команднойпанели') >= 0)
        return false;
    if (v.indexOf('additional') >= 0 || v.indexOf('дополн') >= 0) return true;
    var short = cmdShort(item);
    if (/CustomizeForm|ShowMultipleSelection|OutputList|ListSettings|LoadDynamicListSettings|SaveDynamicListSettings|DynamicListStandardSettings/i.test(short))
        return true;
    /* The reference places the object form's Reread, ShowInList and
     * SetDeletionMark in the additional submenu; an authored Auto button
     * keeps that default. */
    if (/^Form\.StandardCommand\.(?:Reread|ShowInList|SetDeletionMark)$/i.test(String(prop(item, ['CommandName']) || '')))
        return true;
    /* A list form's own bar keeps Create/Copy/Find on the row and folds the
     * remaining dynamic-list commands into «Еще». */
    if (/^Form\.StandardCommand\.(?:Change|Refresh|FindByCurrentValue|CancelSearch|ChangeHistory)$/i.test(String(prop(item, ['CommandName']) || '')))
        return true;
    return false;
}

function isDeadCommand(item) {
    if (!item || (item.tag !== 'Button' && item.tag !== 'Hyperlink')) return false;
    var cmd = String(prop(item, ['CommandName', 'Command']) || '').trim();
    /* Extension dumps write CommandName=0 when the inherited command cannot be
     * named in this XML. An explicit title still describes a real, visible
     * button and must win over that unresolved reference. */
    return cmd === '0' && !rawTitle(item);
}

function commandBarHasOnlyHyperlinks(item) {
    var kids = (item && item.childItems || []).filter(function (child) {
        return child && (child.tag === 'Button' || child.tag === 'Popup' || child.tag === 'Hyperlink')
            && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
    });
    if (!kids.length) return false;
    return kids.every(function (child) {
        var t = String(prop(child, ['Type']) || '').toLowerCase().replace(/[\s_-]+/g, '');
        return t.indexOf('hyperlink') >= 0;
    });
}

function metaType(item, ctx) {
    var index = ctx && ctx.captionIndex;
    if (!item || !index || !index.types) return '';
    var path = prop(item, ['DataPath']);
    var types = index.types;
    var resolved = lookupPathMap(types, path, index.mainNames);
    if (resolved) return resolved;
    var normalized = String(path || '').replace(/\[\d+\]/g, '');
    var parts = normalized.split('.');
    if (parts.length >= 2 && index.mainNames && index.mainNames[parts[0]]) {
        var ownerType = String(types[parts[0]] || '');
        var member = parts.slice(1).join('.');
        /* Date is a standard Document member and is therefore usually absent
         * from the authored Attributes/ChildObjects XML. Infer it only from a
         * typed document owner; a user attribute merely named Date/Дата must
         * never become a calendar field by spelling alone. */
        if (/^cfg:Document(?:Object|Ref)\./i.test(ownerType) && /^(?:Date|Дата)$/i.test(member))
            return 'xs:dateTime';
        /* Parent is a standard hierarchical-catalog reference and is usually
         * absent from the authored form Attributes. Preserve the concrete
         * catalog type so its native dropdown/open buttons can be derived
         * from type semantics instead of the field's human-readable title. */
        /* Hierarchical charts have the same standard Parent: ChartOfCharacteristicTypes
         * and ChartOfAccounts parents paint arrow + open in the reference. */
        if (/^cfg:(?:Catalog|ChartOfCharacteristicTypes|ChartOfAccounts)Object\./i.test(ownerType)
            && /^(?:Parent|Родитель)$/i.test(member))
            return ownerType.replace(/^cfg:(Catalog|ChartOfCharacteristicTypes|ChartOfAccounts)Object\./i, 'cfg:$1Ref.');
    }
    return '';
}

/* Present XML namespace names in the spelling used by 1C developers.
 * Unknown members stay verbatim; the preview must not invent a type. */
function typePresentation(type) {
    var raw = String(type || '').trim();
    if (!raw) return '';
    var scalar = {
        'xs:string': 'Строка', string: 'Строка', text: 'Строка',
        'xs:decimal': 'Число', decimal: 'Число', number: 'Число',
        'xs:boolean': 'Булево', boolean: 'Булево', bool: 'Булево',
        'xs:datetime': 'Дата', datetime: 'Дата', date: 'Дата',
        'v8:uuid': 'УникальныйИдентификатор', uuid: 'УникальныйИдентификатор',
        'v8:valuetable': 'ТаблицаЗначений', valuetable: 'ТаблицаЗначений', table: 'ТаблицаЗначений',
        'v8:valuetree': 'ДеревоЗначений', valuetree: 'ДеревоЗначений', tree: 'ДеревоЗначений',
        'v8:valuelist': 'СписокЗначений', valuelist: 'СписокЗначений',
        'v8:dynamiclist': 'ДинамическийСписок', dynamiclist: 'ДинамическийСписок',
        'v8:binarydata': 'ДвоичныеДанные', binarydata: 'ДвоичныеДанные', binary: 'ДвоичныеДанные',
        'v8:valuestorage': 'ХранилищеЗначения', valuestorage: 'ХранилищеЗначения',
        'v8:valueslist': 'СписокЗначений', valueslist: 'СписокЗначений', list: 'СписокЗначений',
        'v8ui:formattedstring': 'ФорматированнаяСтрока', formattedstring: 'ФорматированнаяСтрока',
        'core:undefinedvalue': 'Неопределено', undefinedvalue: 'Неопределено',
        'functional options': 'Функциональные опции', functionaloptions: 'ФункциональныеОпции',
        functionaloption: 'ФункциональнаяОпция'
    };
    var cfgKinds = {
        Catalog: 'Справочник', CatalogRef: 'СправочникСсылка', CatalogObject: 'СправочникОбъект',
        Document: 'Документ', DocumentRef: 'ДокументСсылка', DocumentObject: 'ДокументОбъект',
        Enum: 'Перечисление',
        BusinessProcess: 'БизнесПроцесс', BusinessProcessRef: 'БизнесПроцессСсылка', BusinessProcessObject: 'БизнесПроцессОбъект',
        Task: 'Задача', TaskRef: 'ЗадачаСсылка', TaskObject: 'ЗадачаОбъект',
        ChartOfAccounts: 'ПланСчетов',
        ChartOfCalculationTypes: 'ПланВидовРасчета',
        ChartOfCharacteristicTypes: 'ПланВидовХарактеристик',
        ExchangePlan: 'ПланОбмена',
        EnumRef: 'ПеречислениеСсылка',
        ChartOfCharacteristicTypesRef: 'ПланВидовХарактеристикСсылка',
        ChartOfCharacteristicTypesObject: 'ПланВидовХарактеристикОбъект',
        ChartOfAccountsRef: 'ПланСчетовСсылка', ChartOfAccountsObject: 'ПланСчетовОбъект',
        ChartOfCalculationTypesRef: 'ПланВидовРасчетаСсылка',
        ChartOfCalculationTypesObject: 'ПланВидовРасчетаОбъект',
        ExchangePlanRef: 'ПланОбменаСсылка', ExchangePlanObject: 'ПланОбменаОбъект',
        DefinedType: 'ОпределяемыйТип', ExternalReportObject: 'ВнешнийОтчетОбъект',
        FunctionalOption: 'ФункциональнаяОпция', FunctionalOptions: 'ФункциональныеОпции'
    };
    var plainKinds = {
        FunctionalOption: 'ФункциональнаяОпция', FunctionalOptions: 'ФункциональныеОпции'
    };
    var parts = [];
    var depth = 0;
    var start = 0;
    for (var index = 0; index < raw.length; index++) {
        if (raw[index] === '(') depth++;
        else if (raw[index] === ')' && depth > 0) depth--;
        else if (raw[index] === ',' && depth === 0) {
            parts.push(raw.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(raw.slice(start).trim());
    return parts.map(function (part) {
        var exact = scalar[part.toLowerCase()];
        if (exact) return exact;
        var simple = part.match(/^(string|text|decimal|number|boolean|bool|datetime|date|uuid|valuetable|valuetree|valuelist|dynamiclist|binarydata|binary|valuestorage|valueslist|list|table|tree|formattedstring|undefinedvalue)(\s*\(.*\))$/i);
        if (simple && scalar[simple[1].toLowerCase()])
            return scalar[simple[1].toLowerCase()] + simple[2];
        var m = part.match(/^(cfg:)?([^\.]+)(?:\.(.*))?$/);
        if (m) {
            var kind = m[1] ? cfgKinds[m[2]] : plainKinds[m[2]];
            if (kind) return kind + (m[3] ? '.' + m[3] : '');
        }
        return part;
    }).join(', ');
}

function isNavigationPopup(item) {
    if (!item || item.tag !== 'Popup') return false;
    var semantic = String((item && item.name) || '') + ' ' + String(rawTitle(item) || '');
    return /ПодменюПерейти|(?:^|\s|_)Перейти(?:$|\s|_)/i.test(semantic)
        || /(?:^|\s|_)Navigate(?:$|\s|_)/i.test(semantic);
}

function itemTypePresentation(item, ctx) {
    var raw = metaType(item, ctx);
    if (!raw) return '';
    var stringLen = metaStringLengthQualifier(item, ctx);
    var numberQ = metaNumberQualifiers(item, ctx);
    var dateFraction = String(metaDateFraction(item, ctx) || '').toLowerCase();
    return String(raw).split(/\s*,\s*/).map(function (part) {
        var shown = typePresentation(part);
        var low = part.toLowerCase();
        if (low === 'xs:string' && stringLen != null)
            return shown + '(' + (stringLen > 0 ? stringLen : 'неогр.') + ')';
        if (low === 'xs:decimal' && numberQ) {
            var number = shown + '(' + numberQ.digits + ', ' + numberQ.fractionDigits;
            if (/nonnegative|неотриц/i.test(numberQ.allowedSign || '')) number += '; неотрицательное';
            return number + ')';
        }
        if (low === 'xs:datetime' && dateFraction) {
            if (dateFraction === 'date') return shown + '(дата)';
            if (dateFraction === 'time') return shown + '(время)';
            if (dateFraction === 'datetime') return shown + '(дата и время)';
        }
        return shown;
    }).join(', ');
}

function hasMainBarChildren(item) {
    var kids = item && item.childItems || [];
    for (var i = 0; i < kids.length; i++) {
        var it = kids[i];
        if (!it || isFalse(prop(it, ['Visible', 'visible']))) continue;
        if (isDeadCommand(it) || inAdditionalBar(it)) continue;
        if (it.tag === 'Popup' && !popupHasCommands(it)) continue;
        if (it.tag === 'ButtonGroup') {
            if (hasMainBarChildren(it)) return true;
            continue;
        }
        return true;
    }
    return false;
}

function popupHasCommands(item) {
    var kids = item && item.childItems || [];
    for (var i = 0; i < kids.length; i++) {
        var it = kids[i];
        if (!it || isFalse(prop(it, ['Visible', 'visible']))) continue;
        if (it.tag === 'Button' || it.tag === 'Hyperlink') {
            if (isDeadCommand(it) || inAdditionalBar(it)) continue;
            return true;
        }
        if (it.tag === 'ButtonGroup' || it.tag === 'Popup') {
            if (popupHasCommands(it)) return true;
        }
    }
    return false;
}

function popupMenuEntries(item) {
    var out = [];
    function walk(list) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (!it || isFalse(prop(it, ['Visible', 'visible']))) continue;
            if (it.tag === 'ButtonGroup') { walk(it.childItems); continue; }
            if (it.tag === 'Button' || it.tag === 'Hyperlink' || it.tag === 'Popup') {
                if (isDeadCommand(it) || inAdditionalBar(it)) continue;
                out.push(it);
            }
        }
    }
    walk(item && item.childItems);
    return out;
}

function closeAllPopups(root) {
    if (!root) return;
    var open = root.querySelectorAll('.fp-popup-open');
    for (var i = 0; i < open.length; i++) open[i].classList.remove('fp-popup-open');
    var panels = root._fpPortalPanels || [];
    for (var p = panels.length - 1; p >= 0; p--) restorePopupPanel(panels[p]);
    root._fpPortalPanels = [];
}

function restorePopupPanel(panel) {
    if (!panel || !panel._fpPopupHome) return;
    var home = panel._fpPopupHome;
    panel.style.display = '';
    panel.style.position = '';
    panel.style.left = '';
    panel.style.top = '';
    panel.style.minWidth = '';
    if (home.parent) {
        if (home.next && home.next.parentNode === home.parent)
            home.parent.insertBefore(panel, home.next);
        else
            home.parent.appendChild(panel);
    }
    panel._fpPopupHome = null;
}

function openPopupPanel(root, owner, anchor, panel, minW, outerOwner) {
    if (!root || !owner || !panel) return;
    closeAllPopups(root);
    owner.classList.add('fp-popup-open');
    if (outerOwner && outerOwner.classList) outerOwner.classList.add('fp-popup-open');

    var doc = root.ownerDocument || document;
    if (doc && doc.body && panel.parentNode !== doc.body) {
        panel._fpPopupHome = { parent: panel.parentNode, next: panel.nextSibling };
        doc.body.appendChild(panel);
        if (!root._fpPortalPanels) root._fpPortalPanels = [];
        root._fpPortalPanels.push(panel);
    }
    /* Once portalled, the descendant selector that normally reveals the menu
       no longer applies. Show it before measuring so offsetHeight is real. */
    panel.style.display = 'block';
    positionFixedPopup(anchor, panel, minW);
}

function positionFixedPopup(anchor, panel, minW) {
    if (!anchor || !panel || !anchor.getBoundingClientRect) return;
    var r = anchor.getBoundingClientRect();
    var vw = (window.innerWidth || 800);
    var vh = (window.innerHeight || 600);
    panel.style.position = 'fixed';
    var min = minW || 280;
    var left = Math.round(r.left);
    var pw = panel.offsetWidth || min;
    var ph = panel.offsetHeight || 160;
    if (left + pw > vw - 8) left = Math.max(8, vw - pw - 8);
    if (left < 8) left = 8;
    var top = Math.round(r.bottom);
    if (top + ph > vh - 8 && r.top > Math.min(ph, vh / 2))
        top = Math.max(8, Math.round(r.top - ph));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.minWidth = Math.max(min, Math.round(r.width)) + 'px';
}

function bindPopupToggle(wrap, btn, ctx, item) {
    if (!wrap || !btn) return;
    btn.disabled = false;
    btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var was = wrap.classList.contains('fp-popup-open');
        closeAllPopups(ctx && ctx.root);
        if (item) {
            selectIn(ctx.root, itemKey(item), ctx);
            if (ctx.onSelect) ctx.onSelect(item);
        }
        if (was) return;
        var menu = wrap.querySelector('.fp-popup-menu');
        openPopupPanel(ctx && ctx.root, wrap, btn, menu, 180);
    });
}

function bindGroupPopupToggle(wrap, btn, ctx, item) {
    if (!wrap || !btn) return;
    var group = wrap.querySelector('.fp-popup-group');
    var body = wrap.querySelector('.fp-popup-group-body');
    btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        /* Group PopUp is an expanded logical group in the reference's designer canvas.
         * Keep the caption selectable without converting its inline body to
         * the runtime overlay used outside the mockup. */
        if (group && group.classList && group.classList.contains('fp-popup-designer-inline')
            && group.closest && group.closest('.fp-body.fp-mockup')) {
            if (item) {
                selectIn(ctx.root, itemKey(item), ctx);
                if (ctx.onSelect) ctx.onSelect(item);
            }
            return;
        }
        var was = !!(group && group.classList.contains('fp-popup-open'));
        closeAllPopups(ctx && ctx.root);
        if (item) {
            selectIn(ctx.root, itemKey(item), ctx);
            if (ctx.onSelect) ctx.onSelect(item);
        }
        if (was || !group) return;
        openPopupPanel(ctx && ctx.root, group, btn, body, 320, wrap);
    });
}

function bindCollapsibleToggle(wrap, btn, ctx, item) {
    if (!wrap || !btn) return;
    var group = wrap.querySelector('.fp-collapsible-group');
    var arrow = btn.querySelector('.fp-collapse-arrow');
    btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!group) return;
        var collapsed = !group.classList.contains('fp-collapsed');
        group.classList.toggle('fp-collapsed', collapsed);
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
        collapsedGroupByKey[itemKey(item)] = collapsed;
        if (item && ctx) {
            selectIn(ctx.root, itemKey(item), ctx);
            if (ctx.onSelect) ctx.onSelect(item);
        }
    });
}

function makePopupMenuEntries(entries, ctx) {
    var menu = el('div', 'fp-popup-menu');
    if (!entries.length) {
        menu.appendChild(el('div', 'fp-popup-empty', 'Нет команд'));
        return menu;
    }
    for (var i = 0; i < entries.length; i++) {
        (function (it) {
            var row = el('button', 'fp-popup-entry');
            row.type = 'button';
            row.dataset.id = itemKey(it);
            var cap = displayLabel(it, ctx, it.tag) || titleOf(it, ctx) || it.name || '—';
            if (it.tag === 'Popup') cap = cap.replace(/\s*▾\s*$/, '') + ' ▸';
            if (hasButtonIcon(it, ctx)) {
                appendPictureIcon(row, buttonPictureRef(it, ctx), ctx,
                    iconIdFor(it, ctx));
            }
            row.appendChild(el('span', 'fp-popup-entry-text', cap));
            row.title = cap;
            row.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                closeAllPopups(ctx && ctx.root);
                selectIn(ctx.root, itemKey(it), ctx);
                if (ctx.onSelect) ctx.onSelect(it);
            });
            menu.appendChild(row);
        })(entries[i]);
    }
    return menu;
}

function makePopupMenu(item, ctx) {
    return makePopupMenuEntries(popupMenuEntries(item), ctx);
}

/* More is not a dead-end caption: both explicitly additional commands and
 * commands hidden by responsive fitting remain inspectable from its menu.
 * Popup/group wrappers are flattened because their original toolbar owner is
 * hidden; keeping only the wrapper would produce an entry that cannot open. */
function commandBarMenuEntries(items) {
    var out = [];
    function walk(list) {
        for (var i = 0; list && i < list.length; i++) {
            var it = list[i];
            if (!it || isFalse(prop(it, ['Visible', 'visible'])) || isDeadCommand(it)) continue;
            if (it.tag === 'ButtonGroup' || it.tag === 'Popup') {
                if (it.childItems && it.childItems.length) walk(it.childItems);
                else if (it.tag === 'Popup') out.push(it);
                continue;
            }
            if (it.tag === 'Button' || it.tag === 'Hyperlink') out.push(it);
        }
    }
    walk(items);
    return out;
}

function refreshCommandBarMoreMenu(more, overflowNodes, ctx) {
    if (!more) return;
    if (more.classList.contains('fp-popup-open')) closeAllPopups(ctx && ctx.root);
    var entries = commandBarMenuEntries(more._fpBaseEntries || []);
    for (var i = 0; overflowNodes && i < overflowNodes.length; i++) {
        var item = overflowNodes[i] && overflowNodes[i]._fpItem;
        if (item) entries = entries.concat(commandBarMenuEntries([item]));
    }
    var old = more._fpMenu || more.querySelector('.fp-popup-menu');
    var menu = makePopupMenuEntries(entries, ctx || more._fpCtx || {});
    if (old && old.parentNode === more) more.replaceChild(menu, old);
    else more.appendChild(menu);
    more._fpMenu = menu;
}

function collectAdditionalBarItems(item, acc) {
    var kids = item && item.childItems || [];
    for (var i = 0; i < kids.length; i++) {
        var it = kids[i];
        if (!it || isFalse(prop(it, ['Visible', 'visible']))) continue;
        if (it.tag === 'ButtonGroup') {
            collectAdditionalBarItems(it, acc);
            continue;
        }
        if (isDeadCommand(it)) continue;
        if (inAdditionalBar(it)) acc.push(it);
    }
}

function pinCommandBarTail(bar) {
    if (!bar) return;
    var old = bar.querySelector('.fp-bar-spacer');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var search = bar.querySelector('.fp-search-item');
    var searchControl = bar.querySelector('.fp-search-control-item');
    if (search && !searchControl) {
        var sca = searchControlForBar(search, bar);
        if (sca) searchControl = makeSearchControlItem(sca);
    }
    var more = bar.querySelector('.fp-more-item');
    var help = bar.querySelector('.fp-help-item');
    /* The reference pins «?» after «Еще» even when authored commands follow it in the
     * bar (Help before an authored command). */
    if (help && help._fpPinTail === undefined) help._fpPinTail = true;
    if (search) bar.appendChild(search);
    if (search && searchControl) bar.appendChild(searchControl);
    if (more) bar.appendChild(more);
    if (help && help._fpPinTail !== false) bar.appendChild(help);
    var first = search || more || (help && help._fpPinTail !== false ? help : null);
    /* A document root bar lays its permanent More button in the ordinary
     * command rhythm. Inserting the catalog-style flexible tail spacer costs
     * two gaps plus its minimum width and needlessly moves the final generated
     * popup into overflow. */
    var packedDocumentRoot = bar.classList
        && bar.classList.contains('fp-document-posting-commandbar');
    /* A bottom dialog bar is packed right as a whole: ОК/Отмена/«?». */
    var bottomDialogBar = bar.classList && bar.classList.contains('fp-form-bar-bottom');
    if (first && !packedDocumentRoot && !bottomDialogBar) bar.insertBefore(el('div', 'fp-bar-spacer'), first);
}

function commandBarMore(bar) {
    return bar && bar.querySelector('.fp-more-item');
}

function createResponsiveMore(bar) {
    var moreBtn = el('button', 'fp-button fp-popup');
    moreBtn.type = 'button';
    setPopupCaption(moreBtn, 'Еще');
    var moreWrap = el('div', 'fp-item fp-control fp-bar-item fp-more-item fp-responsive-more fp-popup-wrap');
    moreWrap._fpBaseEntries = [];
    moreWrap._fpCtx = bar._fpCtx;
    moreWrap.appendChild(moreBtn);
    moreWrap._fpMenu = makePopupMenuEntries([], bar._fpCtx || {});
    moreWrap.appendChild(moreWrap._fpMenu);
    bindPopupToggle(moreWrap, moreBtn, bar._fpCtx || {}, null);
    var help = bar.querySelector('.fp-help-item');
    if (help) bar.insertBefore(moreWrap, help);
    else bar.appendChild(moreWrap);
    return moreWrap;
}

function commandBarSiblingLaneBudget(viewportRight, ownerLeft, trailingWidths, gap) {
    var trailing = 0;
    for (var i = 0; trailingWidths && i < trailingWidths.length; i++)
        trailing += Math.max(0, Number(trailingWidths[i]) || 0);
    if (trailingWidths && trailingWidths.length)
        trailing += Math.max(0, Number(gap) || 0) * trailingWidths.length;
    return Math.max(0, Math.floor((Number(viewportRight) || 0)
        - (Number(ownerLeft) || 0) - trailing));
}

function commandBarLeadingContributionCount(items) {
    if (!items || items.length < 2) return 0;
    var count = 1;
    while (count < items.length) {
        var align = String(prop(items[count], ['GroupHorizontalAlign',
            'ГоризонтальноеПоложениеВГруппе']) || '').toLowerCase();
        if (align.indexOf('left') < 0 && align.indexOf('лев') < 0) break;
        count++;
    }
    /* A lone leading command is ordinary source order. An explicitly Left
     * neighbour creates the reference's primary contribution segment; when a local bar
     * overflows, the following automatic segment moves to More as a unit. */
    return count > 1 ? count : 0;
}

function adaptivePrimaryCommandText(item) {
    if (!item || representationOf(item) !== 'picture' || !rawTitle(item)) return '';
    var align = String(prop(item, ['GroupHorizontalAlign',
        'ГоризонтальноеПоложениеВГруппе']) || '').toLowerCase();
    return align.indexOf('left') >= 0 || align.indexOf('лев') >= 0
        ? plainFormattedText(rawTitle(item)) : '';
}

function setAdaptivePrimaryCommandText(node, active) {
    if (!node || !node.querySelector) return;
    var button = node.querySelector('.fp-button');
    if (!button) return;
    var existing = button.querySelector('.fp-adaptive-primary-text');
    if (!active) {
        if (!existing) return;
        existing.parentNode.removeChild(existing);
        var restoredIcons = button.querySelectorAll('.fp-btn-icon');
        for (var r = 0; r < restoredIcons.length; r++) restoredIcons[r].style.display = '';
        button.classList.add('fp-icon-btn');
        return;
    }
    var title = adaptivePrimaryCommandText(node._fpItem);
    if (!title || existing) return;
    var icons = button.querySelectorAll('.fp-btn-icon');
    for (var i = 0; i < icons.length; i++) icons[i].style.display = 'none';
    button.classList.remove('fp-icon-btn');
    button.appendChild(el('span', 'fp-btn-text fp-adaptive-primary-text', title));
}

function resetLocalCommandBarLane(bar) {
    if (!bar || !bar._fpLocalLaneBaseStyle) return;
    var base = bar._fpLocalLaneBaseStyle;
    bar.style.width = base.width;
    bar.style.minWidth = base.minWidth;
    bar.style.maxWidth = base.maxWidth;
    bar.style.flex = base.flex;
    bar._fpLocalLaneApplied = false;
}

function intrinsicCommandBarSiblingWidth(sibling, siblingStyle) {
    if (!sibling) return 0;
    var saved = {
        width: sibling.style.width,
        minWidth: sibling.style.minWidth,
        maxWidth: sibling.style.maxWidth,
        flex: sibling.style.flex
    };
    /* Horizontal allocation may have stretched a following group to consume
     * the previous viewport's surplus. Measure its max-content basis instead
     * of feeding that transient allocation into the command-bar lane. */
    sibling.style.width = 'max-content';
    sibling.style.minWidth = '0';
    sibling.style.maxWidth = 'none';
    sibling.style.flex = '0 0 auto';
    var width = Math.max(sibling.getBoundingClientRect().width, sibling.scrollWidth || 0);
    sibling.style.width = saved.width;
    sibling.style.minWidth = saved.minWidth;
    sibling.style.maxWidth = saved.maxWidth;
    sibling.style.flex = saved.flex;
    return width
        + (parseFloat(siblingStyle.marginLeft) || 0)
        + (parseFloat(siblingStyle.marginRight) || 0);
}

function localCommandBarLaneBudget(bar, scrollport) {
    if (!bar || !scrollport || !bar.closest) return 0;
    var owner = bar.closest('.fp-item[data-tag="CommandBar"], .fp-item[data-tag="AutoCommandBar"]');
    var row = owner && owner.parentElement;
    if (!owner || !row || !row.classList
        || !row.classList.contains('fp-children-horizontal')) return 0;
    var item = owner._fpItem;
    if (!item || !isFalse(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))) return 0;
    var trailing = [];
    var passedOwner = false;
    for (var i = 0; i < row.children.length; i++) {
        var sibling = row.children[i];
        if (sibling === owner) { passedOwner = true; continue; }
        if (!passedOwner || !sibling.classList || !sibling.classList.contains('fp-item')) continue;
        var siblingStyle = getComputedStyle(sibling);
        if (siblingStyle.display === 'none' || siblingStyle.position === 'absolute') continue;
        trailing.push(intrinsicCommandBarSiblingWidth(sibling, siblingStyle));
    }
    if (!trailing.length) return 0;
    var portRect = scrollport.getBoundingClientRect();
    var ownerRect = owner.getBoundingClientRect();
    var rowStyle = getComputedStyle(row);
    var gap = parseFloat(rowStyle.columnGap || rowStyle.gap || '') || 0;
    return commandBarSiblingLaneBudget(portRect.left + scrollport.clientWidth,
        ownerRect.left, trailing, gap);
}

/* The 1C command bar moves trailing commands into "More" when the form is too
 * narrow.  A horizontal scrollbar is not part of the platform UI and, on
 * command-heavy forms, makes mutually exclusive commands look duplicated. */
function fitCommandBar(bar) {
    if (!bar || !bar.isConnected) return;
    var adaptiveLabels = bar.querySelectorAll('.fp-adaptive-primary-text');
    for (var adaptiveIndex = 0; adaptiveIndex < adaptiveLabels.length; adaptiveIndex++) {
        var adaptiveItem = adaptiveLabels[adaptiveIndex].closest('.fp-bar-item');
        if (adaptiveItem) setAdaptivePrimaryCommandText(adaptiveItem, false);
    }
    /* Every pass starts from the authored/CSS basis. The previous fitted
     * width is output, never input; this makes ResizeObserver and repeated
     * strategy passes converge to the same sibling allocation. */
    resetLocalCommandBarLane(bar);
    /* Nested popup wrappers can add up to four layout pixels to scrollWidth
     * through borders and subpixel rounding even when every painted control is
     * inside the bar. The reference keeps such a fitting command visible. */
    var overflowEpsilon = 4;
    var savedMeasure = null;
    var pageScrollport = bar.closest ? bar.closest('.fp-pages-active-panel') : null;
    var bodyScrollport = bar.closest ? bar.closest('.fp-body') : null;
    /* Prefer the outer body only when it owns a reachable horizontal canvas.
     * In an ordinary form the active page remains the relevant constraint. */
    var authoredWideTable = bar.closest ? bar.closest('[data-fp-table-widget-width]') : null;
    var bodyOwnsHorizontalCanvas = bodyScrollport && (
        (bodyScrollport.classList && bodyScrollport.classList.contains('fp-window-overflow'))
        || (authoredWideTable && bar.clientWidth > bodyScrollport.clientWidth + 1));
    var scrollport = bodyOwnsHorizontalCanvas
        || (bodyScrollport && bodyScrollport.scrollWidth > bodyScrollport.clientWidth + 1)
        ? bodyScrollport : (pageScrollport || bodyScrollport);
    if (scrollport && scrollport.clientWidth && bar.clientWidth) {
        var barRect = bar.getBoundingClientRect();
        var portRect = scrollport.getBoundingClientRect();
        var inset = Math.max(0, barRect.left - portRect.left + (scrollport.scrollLeft || 0));
        /* A wide authored form/table can deliberately extend the horizontal
         * scroll canvas beyond the visible viewport.  Its command bar may use
         * that reachable logical width; clamping it to clientWidth hides one
         * command too many even though the user can scroll to the whole bar. */
        var authoredBarExtent = bodyOwnsHorizontalCanvas && scrollport === bodyScrollport
            ? inset + bar.clientWidth : 0;
        var scrollExtent = Math.max(scrollport.clientWidth, scrollport.scrollWidth || 0,
            authoredBarExtent);
        var available = Math.max(0, scrollExtent - inset);
        var localLane = localCommandBarLaneBudget(bar, scrollport);
        if (localLane > 0) available = Math.min(available, localLane);
        /* An authored-width table has already allocated this toolbar's
         * logical band in fitAuthoredTableWidths. Re-clamping that band to an
         * ancestor viewport discards reachable horizontal canvas space. */
        if (!authoredWideTable && (localLane > 0 || available + 1 < bar.clientWidth)) {
            savedMeasure = {
                width: bar.style.width, minWidth: bar.style.minWidth,
                maxWidth: bar.style.maxWidth, flex: bar.style.flex,
                persistLocalLane: localLane > 0, laneWidth: available
            };
            if (localLane > 0 && !bar._fpLocalLaneBaseStyle)
                bar._fpLocalLaneBaseStyle = {
                    width: savedMeasure.width, minWidth: savedMeasure.minWidth,
                    maxWidth: savedMeasure.maxWidth, flex: savedMeasure.flex
                };
            bar.style.width = available + 'px';
            bar.style.minWidth = '0';
            bar.style.maxWidth = available + 'px';
            bar.style.flex = '0 0 ' + available + 'px';
        }
    }
    function restoreMeasure() {
        if (!savedMeasure) return;
        bar.style.width = savedMeasure.width;
        bar.style.minWidth = savedMeasure.minWidth;
        bar.style.maxWidth = savedMeasure.maxWidth;
        bar.style.flex = savedMeasure.flex;
        if (savedMeasure.persistLocalLane) {
            var compactWidth = savedMeasure.settledWidthHint
                || Math.ceil(bar.getBoundingClientRect().width || bar.scrollWidth || 0);
            var settledWidth = Math.min(savedMeasure.laneWidth, compactWidth || savedMeasure.laneWidth);
            bar.style.width = settledWidth + 'px';
            bar.style.minWidth = '0';
            bar.style.maxWidth = settledWidth + 'px';
            bar.style.flex = '0 0 ' + settledWidth + 'px';
            bar._fpLocalLaneApplied = true;
        }
    }
    var previouslyHidden = bar.querySelectorAll('.fp-bar-overflow-hidden');
    for (var h = 0; h < previouslyHidden.length; h++)
        previouslyHidden[h].classList.remove('fp-bar-overflow-hidden');

    var more = commandBarMore(bar);
    if (more && more.classList.contains('fp-responsive-more')) {
        if (more.classList.contains('fp-popup-open')) closeAllPopups(bar._fpCtx && bar._fpCtx.root);
        more.parentNode.removeChild(more);
        more = null;
    }
    if (more && more._fpBaseTitle === undefined) {
        var existingButton = more.querySelector('.fp-button');
        more._fpBaseTitle = existingButton ? existingButton.title || '' : '';
    }
    if (more) {
        var resetButton = more.querySelector('.fp-button');
        if (resetButton) resetButton.title = more._fpBaseTitle || '';
    }
    pinCommandBarTail(bar);

    /* SearchStringAddition shrinks from 260px down to 140px through its flex
     * band before authored commands move into More; unlike ordinary commands,
     * search remains visible (a bar with room keeps a full 260px search).
     * It regrows once commands have left. */
    var searchControl = bar.querySelector('.fp-search-control-item');
    if (searchControl && bar.scrollWidth > bar.clientWidth + overflowEpsilon)
        searchControl.classList.add('fp-bar-overflow-hidden');

    if (bar.scrollWidth <= bar.clientWidth + overflowEpsilon) {
        if (more) refreshCommandBarMoreMenu(more, [], bar._fpCtx || {});
        restoreMeasure();
        return;
    }
    if (!more) {
        more = createResponsiveMore(bar);
        more._fpBaseTitle = '';
        pinCommandBarTail(bar);
    }
    var candidates = [];
    var helpItem = bar.querySelector('.fp-help-item');
    /* Help is a fixed tail only when it is the final authored main-row item.
     * A later main popup keeps authored priority and Help may overflow. */
    var pinHelp = !helpItem || helpItem._fpPinTail !== false;
    var toolbarItems = bar.querySelectorAll('.fp-bar-item');
    for (var i = 0; i < toolbarItems.length; i++) {
        var node = toolbarItems[i];
        if (!node.classList || !node.classList.contains('fp-bar-item')) continue;
        if (node === more || node.classList.contains('fp-search-item')
            || node.classList.contains('fp-search-control-item')
            || (pinHelp && node.classList.contains('fp-help-item'))) continue;
        if (node._fpItem && node._fpItem.tag === 'ButtonGroup') continue;
        if (node.closest && node.closest('.fp-popup-menu')) continue;
        candidates.push(node);
    }
    /* A command bar is a sequence of groups (authored ButtonGroup/Popup,
     * generated global and CreateBasedOn segments), and the reference fills it in that
     * order: commands overflow strictly from the end. How many commands a
     * group shows therefore depends on how much room the groups before it
     * took: an early group keeps its commands while a later one moves into
     * More. */
    var hideOrder = candidates.slice().reverse();
    /* SearchStringAddition is fixed toolbar chrome in the managed client.
     * Under width pressure commands move into More, while the search field
     * remains on the bar. Hiding it here made command-dense table parts lose
     * search altogether. */
    var overflowTitles = [];
    var overflowNodes = [];
    if (bar._fpRightLanePrimary && candidates.length) {
        for (var rp = 1; rp < candidates.length; rp++) {
            candidates[rp].classList.add('fp-bar-overflow-hidden');
            overflowNodes.push(candidates[rp]);
            var rightCaption = String(candidates[rp].textContent || '').trim();
            if (rightCaption) overflowTitles.push(rightCaption);
        }
        candidates[0].classList.remove('fp-bar-overflow-hidden');
        refreshCommandBarMoreMenu(more, overflowNodes, bar._fpCtx || {});
        restoreMeasure();
        return;
    }
    var leadingCount = localLane > 0
        ? commandBarLeadingContributionCount(candidates.map(function (node) {
            return node && node._fpItem;
        })) : 0;
    /* The reference sizes the lane with the primary contribution already captioned
     * (a «Сохранить» caption is 89px of text, not a 30px picture), so the
     * caption must be in place before anything overflows. */
    for (var primaryText = 1; primaryText < leadingCount; primaryText++)
        setAdaptivePrimaryCommandText(candidates[primaryText], true);
    for (var c = 0; c < hideOrder.length && bar.scrollWidth > bar.clientWidth + overflowEpsilon; c++) {
        var candidate = hideOrder[c];
        if (candidate.classList.contains('fp-bar-overflow-hidden')) continue;
        candidate.classList.add('fp-bar-overflow-hidden');
        overflowNodes.unshift(candidate);
        var caption = String(candidate.textContent || '').trim();
        if (caption) overflowTitles.unshift(caption);
    }
    if (leadingCount > 0) {
        /* First let the ordinary fitter establish the native owner lane. The
         * contribution collapse changes what is painted, not the lane already
         * negotiated with following siblings. */
        if (savedMeasure && savedMeasure.persistLocalLane) {
            var measuredStyle = {
                width: bar.style.width, minWidth: bar.style.minWidth,
                maxWidth: bar.style.maxWidth, flex: bar.style.flex
            };
            bar.style.width = savedMeasure.width;
            bar.style.minWidth = savedMeasure.minWidth;
            bar.style.maxWidth = savedMeasure.maxWidth;
            bar.style.flex = savedMeasure.flex;
            savedMeasure.settledWidthHint = Math.ceil(
                bar.getBoundingClientRect().width || bar.scrollWidth || 0);
            bar.style.width = measuredStyle.width;
            bar.style.minWidth = measuredStyle.minWidth;
            bar.style.maxWidth = measuredStyle.maxWidth;
            bar.style.flex = measuredStyle.flex;
        }
        for (var primary = 1; primary < leadingCount; primary++)
            setAdaptivePrimaryCommandText(candidates[primary], true);
        for (var secondary = leadingCount; secondary < candidates.length; secondary++)
            candidates[secondary].classList.add('fp-bar-overflow-hidden');
        overflowNodes = [];
        overflowTitles = [];
        for (var hiddenIndex = 0; hiddenIndex < candidates.length; hiddenIndex++) {
            var hiddenNode = candidates[hiddenIndex];
            if (!hiddenNode.classList.contains('fp-bar-overflow-hidden')) continue;
            overflowNodes.push(hiddenNode);
            var hiddenCaption = String(hiddenNode.textContent || '').trim();
            if (hiddenCaption) overflowTitles.push(hiddenCaption);
        }
    }
    refreshCommandBarMoreMenu(more, overflowNodes, bar._fpCtx || {});
    var moreButton = more.querySelector('.fp-button');
    if (moreButton) {
        var titles = [];
        if (more._fpBaseTitle) titles.push(more._fpBaseTitle);
        if (overflowTitles.length) titles.push(overflowTitles.join(', '));
        moreButton.title = titles.join(', ');
    }
    restoreMeasure();
}

function observeCommandBar(bar) {
    if (!bar) return;
    fitCommandBar(bar);
    if (typeof ResizeObserver === 'undefined') return;
    /* Same-frame refit, see observeFormViewport. Only a width change alters
     * which commands fit; height changes and the fit's own result are skipped. */
    var fittedWidth = bar.clientWidth;
    var observer = new ResizeObserver(function () {
        if (!bar.isConnected || bar.clientWidth === fittedWidth) return;
        fitCommandBar(bar);
        fittedWidth = bar.clientWidth;
    });
    observer.observe(bar);
    bar._fpResizeObserver = observer;
}

function hasPicture(item) {
    return !!pictureRef(item);
}

function pictureRef(item) {
    if (!item) return '';
    var raw = String(prop(item, ['Picture', 'HeaderPicture', 'ValuesPicture']) || '').trim();
    /* An item's own picture file (xr:Abs) resolves by its owner's name; see
     * form-context.js referencedItemPictures. */
    var abs = raw.match(/^Abs:(.+)$/);
    if (abs) return item.name ? '@item:' + item.name + '/' + abs[1] : '';
    /* The reference's designer paints no image for ExecuteTask: «Выполнено» in
     * the bar and «Выполнена» in the body are text only. */
    if (/^(?:StdPicture|БиблиотекаКартинок)\.(?:ExecuteTask|ВыполнитьЗадачу)$/i.test(raw)) return '';
    return raw;
}

function cmdShort(item) {
    return lastSeg(prop(item, ['CommandName', 'Command']));
}

function commandMeta(item, ctx, key) {
    var short = cmdShort(item);
    if (!short || !ctx) return '';
    /* An authored button bound to CommonCommand.X takes caption, picture and
     * representation from the common command descriptor, exactly like a
     * Form.Command button does from the form command. */
    var fqn = String(prop(item, ['CommandName', 'Command']) || '');
    var common = fqn.match(/^CommonCommand\.(.+)$/i);
    var all = ctx.model && ctx.model.commonCommands;
    /* Another object's command (DataProcessor.X.Command.Y) likewise brings
     * its picture. */
    var c = common ? all && all[common[1]]
        : (/^\w+\.[^.]+\.Command\.[^.]+$/.test(fqn) && all && all[fqn])
            || (ctx.commands && ctx.commands[short]);
    if (!c) return '';
    if (key === 'picture') return pictureRef(c) || prop(c, ['Picture']);
    if (key === 'title') return rawTitle(c);
    if (key === 'rep') return representationOf(c);
    return '';
}

function picKey(ref) {
    var s = lastSeg(ref);
    return s.replace(/^StdPicture\./i, '').replace(/^CommonPicture\./i, '');
}

function iconIdFromRef(ref) {
    var key = picKey(ref);
    if (!key) return '';
    /* Form.xml may carry an opaque resource id (0:<UUID>) instead of a
     * named picture. It is not an icon name, so allow semantic fallbacks. */
    if (/^0:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(ref || '').trim())) return '';
    if (PIC_ICON[key]) return PIC_ICON[key];
    var low = key.toLowerCase();
    if (/write|save|запис/i.test(low)) return 'save';
    if (/post|провест/i.test(low)) return 'file-check';
    if (/print|печат/i.test(low)) return 'printer';
    if (/help|справк/i.test(low)) return 'help';
    if (/find|search|поиск/i.test(low)) return 'search';
    if (/add|plus|созда/i.test(low)) return 'plus';
    if (/delete|удал/i.test(low)) return 'x';
    if (/copy|копир/i.test(low)) return 'copy';
    if (/moveup|стрелкавверх|вверх/i.test(low)) return 'arrow-up';
    if (/movedown|стрелкавниз|вниз/i.test(low)) return 'arrow-down';
    if (/moveleft|влево|стрелкавлево/i.test(low)) return 'arrow-left';
    if (/moveright|вправо|стрелкавправо/i.test(low)) return 'arrow-right';
    if (/calendar|дата/i.test(low)) return 'calendar';
    if (/партнер|partner|user|пользоват|сотрудник/i.test(low)) return 'user';
    if (/warning|внимание|предупрежд/i.test(low)) return 'alert-triangle';
    if (/info|information/i.test(low)) return 'info-circle';
    if (/report|отчет|spreadsheet|табличн/i.test(low)) return 'table';
    if (/barcode|штрих/i.test(low)) return 'barcode';
    if (/fill|заполн|шаблон|generate/i.test(low)) return 'sparkles';
    if (/flag|флаг/i.test(low)) return 'flag';
    if (/выполняютс/i.test(low)) return 'player-play';
    if (/выполненн/i.test(low)) return 'checkbox';
    if (/undo/i.test(low)) return 'arrow-back-up';
    if (/redo/i.test(low)) return 'arrow-forward-up';
    if (/refresh|обнов/i.test(low)) return 'refresh';
    if (/longoperation|длительнаяоперация/i.test(low)) return 'loader';
    if (/раздел/i.test(low)) return 'copy';
    if (/folder|папк/i.test(low)) return 'folder';
    if (/filter|отбор|отобр/i.test(low)) return 'filter';
    if (/scale|весы|взвеш/i.test(low)) return 'scale';
    if (/nabor|набор|series|серии/i.test(low)) return 'box';
    if (/карт[аоуы]|карточк|card/i.test(low)) return 'credit-card';
    if (/запрещ|запрет|недоступ|блокир/i.test(low)) return 'ban';
    if (/превышен|расхожден|ошибк|error/i.test(low)) return 'alert-triangle';
    /* An unmapped CommonPicture belongs to the configuration, not to the
     * platform, so nothing can resolve it here. A neutral picture placeholder
     * is honest about that; a shape like a box would read as a real icon. */
    return 'photo';
}

function iconIdFor(item, ctx) {
    var ref = pictureRef(item) || commandMeta(item, ctx, 'picture');
    if (ref) {
        var fromRef = iconIdFromRef(ref);
        if (fromRef) return fromRef;
    }
    var short = cmdShort(item);
    if (short && PIC_ICON[short]) return PIC_ICON[short];
    if (isHelpItem(item)) return 'help';
    var title = rawTitle(item) || (ctx && short && ctx.commandTitles && ctx.commandTitles[short]) || '';
    var name = String((item && item.name) || '');
    var semanticIcon = iconIdFromRef(title) || iconIdFromRef(name) || iconIdFromRef(short);
    if (semanticIcon) return semanticIcon;
    if (/штрих/i.test(name) || /штрих/i.test(title)) return 'barcode';
    if (/серии/i.test(name) || /серии/i.test(title)) return 'box';
    if (/тсд|вес/i.test(name)) return 'scale';
    if (/набор/i.test(name)) return 'box';
    if (/раздел/i.test(name) || /раздел/i.test(short)) return 'copy';
    if (/обнов/i.test(name) || short === 'Refresh') return 'refresh';
    if (/запрещ|запрет/i.test(name) || /запрещ|запрет/i.test(title)) return 'ban';
    if (/карт[аоуы]|карточк/i.test(name) || /карт[аоуы]|карточк/i.test(title)) return 'credit-card';
    return 'photo';
}

function svgIcon(name, cls) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', cls || 'fp-btn-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + (name || 'box'));
    svg.appendChild(use);
    return svg;
}

function commonPictureResource(ref, ctx) {
    if (!ctx || !ctx.commonPictures) return null;
    if (/^@item:/.test(String(ref || ''))) return ctx.commonPictures[ref] || null;
    if (!/^CommonPicture\./i.test(String(ref || ''))) return null;
    var name = String(ref).replace(/^CommonPicture\./i, '');
    if (ctx.commonPictures[name]) return ctx.commonPictures[name];
    var low = name.toLowerCase();
    for (var key in ctx.commonPictures) {
        if (Object.prototype.hasOwnProperty.call(ctx.commonPictures, key) && key.toLowerCase() === low)
            return ctx.commonPictures[key];
    }
    return null;
}

function bytesFromBase64(value) {
    var raw = atob(String(value || ''));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

function bytesToBase64(bytes) {
    var chunks = [];
    for (var i = 0; i < bytes.length; i += 0x8000)
        chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
    return btoa(chunks.join(''));
}

async function readStreamLimited(stream, maximum) {
    var reader = stream.getReader();
    var chunks = [], size = 0;
    for (;;) {
        var part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maximum) { await reader.cancel(); return null; }
        chunks.push(part.value);
    }
    var out = new Uint8Array(size), offset = 0;
    for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], offset); offset += chunks[i].byteLength; }
    return out;
}

/* 1C's scalable Picture.zip is a regular ZIP. Newer bundles often contain
 * Picture.png, but real configurations also use manifest-selected density
 * variants (l.png/l.gif/100.gif) and even extensionless SVG files. Read the
 * central directory rather than trusting local-header sizes: ZIP writers may
 * put those sizes in a trailing data descriptor. */
async function zipPictureDataUrl(resource) {
    if (!resource || !resource.data) return '';
    if (resource._pictureUrlPromise) return resource._pictureUrlPromise;
    resource._pictureUrlPromise = (async function () {
        var bytes = bytesFromBase64(resource.data);
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        var entries = [];
        for (var p = 0; p + 46 <= bytes.length; p++) {
            if (view.getUint32(p, true) !== 0x02014b50) continue;
            var method = view.getUint16(p + 10, true);
            var compressed = view.getUint32(p + 20, true);
            var unpacked = view.getUint32(p + 24, true);
            var nameLen = view.getUint16(p + 28, true);
            var extraLen = view.getUint16(p + 30, true);
            var commentLen = view.getUint16(p + 32, true);
            var localOffset = view.getUint32(p + 42, true);
            if (p + 46 + nameLen + extraLen + commentLen > bytes.length) return '';
            var nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
            var name = new TextDecoder('utf-8').decode(nameBytes).replace(/\\/g, '/');
            entries.push({ name: name, method: method, compressed: compressed,
                unpacked: unpacked, localOffset: localOffset });
            p += 45 + nameLen + extraLen + commentLen;
        }
        async function unpack(entry) {
            if (!entry || entry.unpacked > 16 * 1024 * 1024 || entry.localOffset + 30 > bytes.length) return null;
            var local = entry.localOffset;
            if (view.getUint32(local, true) !== 0x04034b50) return null;
            var localName = view.getUint16(local + 26, true);
            var localExtra = view.getUint16(local + 28, true);
            var start = local + 30 + localName + localExtra;
            if (start + entry.compressed > bytes.length) return null;
            var packed = bytes.subarray(start, start + entry.compressed);
            if (entry.method === 0) return packed;
            if (entry.method !== 8 || typeof DecompressionStream === 'undefined') return null;
            var stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return readStreamLimited(stream, 16 * 1024 * 1024);
        }
        function entryNamed(name) {
            var low = String(name || '').replace(/\\/g, '/').toLowerCase();
            for (var i = 0; i < entries.length; i++)
                if (entries[i].name.toLowerCase() === low) return entries[i];
            return null;
        }
        /* The current managed client follows the manifest and prefers the
         * plain ldpi variant at 96 DPI. Picture.png is commonly the legacy
         * version8_2 face and must only be a fallback when the manifest has no
         * current-interface variant. */
        var preferredNames = [];
        var manifestBytes = await unpack(entryNamed('manifest.xml'));
        if (manifestBytes) {
            var manifestXml = new TextDecoder('utf-8').decode(manifestBytes);
            var variants = [], variantRe = /<PictureVariant\b([^>]*)\/?\s*>/gi, variantMatch;
            while ((variantMatch = variantRe.exec(manifestXml))) {
                var attrs = variantMatch[1];
                var nameMatch = attrs.match(/\bname\s*=\s*["']([^"']+)["']/i);
                if (!nameMatch) continue;
                var density = (attrs.match(/\bscreenDensity\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
                var iface = (attrs.match(/\binterfaceVariant\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
                var densityRank = /^ldpi$/i.test(density) ? 0 : /^bldpi$/i.test(density) ? 1 : 2;
                var interfaceRank = !iface ? 0 : /^version8_2$/i.test(iface) ? 1 : 2;
                variants.push({ name: nameMatch[1], rank: densityRank * 10 + interfaceRank });
            }
            variants.sort(function (a, b) { return a.rank - b.rank; });
            for (var v = 0; v < variants.length; v++) preferredNames.push(variants[v].name);
        }
        preferredNames.push('100.png', 'Picture.png', 'Picture.gif', 'Picture.svg', '100.gif',
            'l.png', 'l.gif', 'l.svg', 'l');
        var entry = null;
        for (var n = 0; n < preferredNames.length && !entry; n++) entry = entryNamed(preferredNames[n]);
        if (!entry) {
            for (var e = 0; e < entries.length; e++) {
                if (/\.(?:png|gif|svg|jpe?g|webp)$/i.test(entries[e].name)) { entry = entries[e]; break; }
            }
        }
        var unpackedBytes = await unpack(entry);
        if (!unpackedBytes || !unpackedBytes.length || unpackedBytes.length > 16 * 1024 * 1024) return '';
        var mime = '';
        if (unpackedBytes.length >= 8 && unpackedBytes[0] === 0x89 && unpackedBytes[1] === 0x50
            && unpackedBytes[2] === 0x4e && unpackedBytes[3] === 0x47) mime = 'image/png';
        else if (unpackedBytes.length >= 6 && unpackedBytes[0] === 0x47 && unpackedBytes[1] === 0x49
            && unpackedBytes[2] === 0x46 && unpackedBytes[3] === 0x38) mime = 'image/gif';
        else if (unpackedBytes.length >= 3 && unpackedBytes[0] === 0xff && unpackedBytes[1] === 0xd8
            && unpackedBytes[2] === 0xff) mime = 'image/jpeg';
        else {
            var head = new TextDecoder('utf-8').decode(unpackedBytes.subarray(0, Math.min(256, unpackedBytes.length)))
                .replace(/^\uFEFF/, '').trimStart();
            if (/^<svg\b/i.test(head)) mime = 'image/svg+xml';
        }
        if (!mime) return '';
        return 'data:' + mime + ';base64,' + bytesToBase64(unpackedBytes);
    })().catch(function () { return ''; });
    return resource._pictureUrlPromise;
}

function appendPictureIcon(parent, ref, ctx, fallbackName, cls) {
    var resource = commonPictureResource(ref, ctx);
    var iconClass = cls || 'fp-btn-icon';
    if (resource && /^image\//.test(String(resource.mime || '')) && resource.data) {
        var direct = el('img', iconClass);
        direct.alt = '';
        direct.setAttribute('aria-hidden', 'true');
        direct.src = 'data:' + resource.mime + ';base64,' + resource.data;
        parent.appendChild(direct);
        return direct;
    }
    /* The generated "История изменений" (DataHistory) common command uses the
     * platform's pencil+clock Taxi glyph, not a plain pencil or a generic
     * outline. Prefer the exact resource over the outline fallback: the latter
     * is visually close but has different stroke geometry and colours at
     * this size. */
    if (fallbackName === 'data-history') {
        var platformHistory = el('img', iconClass);
        platformHistory.alt = '';
        platformHistory.setAttribute('aria-hidden', 'true');
        platformHistory.src = 'platform-data-history.png';
        parent.appendChild(platformHistory);
        return platformHistory;
    }
    var stdUrl = resource ? '' : stdPictureUrl(ref);
    if (stdUrl) {
        /* The platform library file itself; a host that did not ship
         * std-pictures/ falls back to the outline sprite. */
        var std = el('img', iconClass);
        std.alt = '';
        std.setAttribute('aria-hidden', 'true');
        std.onerror = function () {
            if (std.parentNode) std.parentNode.replaceChild(svgIcon(fallbackName || 'photo', iconClass), std);
        };
        std.src = stdUrl;
        parent.appendChild(std);
        return std;
    }
    var fallback = svgIcon(fallbackName || 'photo', iconClass);
    parent.appendChild(fallback);
    if (resource && resource.mime === 'application/zip') {
        fallback.classList.add('fp-picture-loading');
        zipPictureDataUrl(resource).then(function (url) {
            if (!url || !fallback.parentNode) {
                fallback.classList.remove('fp-picture-loading');
                return;
            }
            var image = el('img', iconClass);
            image.alt = '';
            image.setAttribute('aria-hidden', 'true');
            image.src = url;
            fallback.parentNode.replaceChild(image, fallback);
        });
    }
    return fallback;
}

function appendBackgroundPicture(parent, picture, ctx) {
    if (!parent || !picture || !picture.ref) return null;
    var backdrop = el('span', 'fp-back-picture');
    if (picture.loadTransparent === false) backdrop.classList.add('fp-back-picture-opaque');
    backdrop.dataset.pictureRef = picture.ref;
    appendPictureIcon(backdrop, picture.ref, ctx,
        iconIdFromRef(picture.ref) || 'photo', 'fp-back-picture-image');
    parent.classList.add('fp-has-back-picture');
    parent.insertBefore(backdrop, parent.firstChild);
    return backdrop;
}

/* Editor-button glyphs the reference paints as small bitmaps, not scalable icons:
 * «i-px-*» reproduce them pixel for pixel in the 20×23 cell. */
var PIXEL_BUTTON_GLYPHS = { 'caret-down': 1, dots: 1, x: 1, 'open-1c': 1 };

function iconBtn(name) {
    var span = el('span', 'fp-input-btn');
    if (PIXEL_BUTTON_GLYPHS[name]) span.appendChild(svgIcon('px-' + name, 'fp-btn-icon fp-px-glyph'));
    else span.appendChild(svgIcon(name, 'fp-btn-icon'));
    return span;
}

function isHelpItem(item) {
    var short = cmdShort(item);
    return short === 'Help' || /справк/i.test(rawTitle(item) || '') || /Help/i.test(String((item && item.name) || ''));
}

function charSize(raw) {
    var n = parseInt(raw, 10);
    if (!n || n < 0) return 0;
    return n * CHAR_PX;
}

/* An authored field Width describes the text area on the managed-form grid,
 * while the platform TextBox publishes the complete value control. Reference
 * char-unit ruler measurements are exact at 96 DPI: 5/10/20/40 ->
 * 60/110/210/410 px. Keep this conversion separate from labels and container
 * dimensions, whose authored units have different chrome. */
function authoredFieldWidthPx(raw, tag) {
    var n = parseInt(raw, 10);
    if (!n || n < 0) return 0;
    if (tag === 'InputField' || tag === 'ValueList' || tag === 'LabelField')
        return n * REF_AUTHORED_CHAR_PX + 10;
    if (isContainer(tag) && tag !== 'Table') return n * GROUP_COL_PX;
    return n * CHAR_PX;
}

function authoredEditorPaintWidth(raw, tag, buttons) {
    var declared = authoredFieldWidthPx(raw, tag);
    if (!declared || (tag !== 'InputField' && tag !== 'ValueList')) return declared;
    var appended = Math.max(0, Number(buttons) || 0);
    /* Width is the editable text lane. Drop-list, choice and calendar
     * affordances are appended native tracks, not pixels taken from it. */
    return declared + (appended ? 1 + appended * 21 : 0);
}

/* A fixed short text or list editor keeps the Width text lane and appends
 * its buttons: Width 6 paints 70 + 21, W12 151, W10 110 in the reference.
 * Without the lane the caret overpainted the trailing «?». */
function horizontalDecorationWidthPx(item, tag, parentMeta) {
    if (tag !== 'LabelDecoration' || !parentMeta || parentMeta.orientation !== 'horizontal') return 0;
    var chars = parseInt(prop(item, ['Width', 'Ширина']), 10) || 0;
    return chars > 0 ? chars * REF_AUTHORED_CHAR_PX : 0;
}

function fixedShortEditorWidth(item, tag, ctx) {
    if (tag !== 'InputField') return 0;
    var chars = parseInt(prop(item, ['Width', 'Ширина']), 10) || 0;
    if (chars <= 0 || chars >= 20) return 0;
    if (!isFalse(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))) return 0;
    if (isFalse(prop(item, ['AutoMaxWidth']))) return 0;
    var kind = fieldKind(item, ctx);
    if (kind !== 'list' && kind !== 'text') return 0;
    return authoredEditorPaintWidth(chars, tag, inputButtonKinds(item, ctx).length);
}

function authoredAutoMaxEditorPaintWidth(item, tag, parentMeta, ctx) {
    if (tag !== 'InputField' && tag !== 'ValueList' && tag !== 'LabelField') return 0;
    var width = parseInt(prop(item, ['Width', 'Ширина']), 10) || 0;
    var maximum = parseInt(prop(item, ['MaxWidth', 'МаксимальнаяШирина']), 10) || 0;
    /* When Width is omitted, only an authored horizontal row owns this finite
     * lane. In a vertical column MaxWidth remains a cap and must yield to the
     * available width; freezing it there clips appended input buttons. */
    if (!width && (!parentMeta || parentMeta.orientation !== 'horizontal')) return 0;
    /* An extension placeholder can carry only a MaxWidth while its DataPath
     * lives on the adopted base-form item. Until that semantic merge happens,
     * treating the cap as a requested paint width lets the editor overpaint
     * the following sibling. A bound field has the full reference width contract. */
    if (!width && !prop(item, ['DataPath', 'ПутьКДанным'])) return 0;
    if (!maximum || !isFalse(prop(item, ['AutoMaxWidth']))) return 0;
    /* In a horizontal row AutoMaxWidth=false publishes MaxWidth as the TextBox
     * even when Width is smaller: the reference paints ИНН MaxWidth=17 (≈177px), not
     * Width=15 (160px), and КПП starts at that trailing edge. Vertical columns
     * still keep Width as the paint band so MaxWidth remains a stretch cap. */
    if (width && maximum > width
        && parentMeta && parentMeta.orientation === 'horizontal')
        return autoMaxEditorBandWidth(maximum);
    if (width) return 0;
    /* AutoMaxWidth=false without Width used to omit the editor inset and
     * painted the field 6px narrower than the reference, shifting the next
     * one left. The full char-unit ruler +10 (170) is still too much for
     * this lane. */
    return shortNumberBand(item, ctx, autoMaxEditorBandWidth(maximum))
        + autoMaxAppendedButtonsPx(item, tag, ctx);
}

/* Taxi packs the buttons beside a MaxWidth lane that did not clamp the data
 * length: a Date field (9 chars, MaxWidth 9) paints 100 + 21px, while a
 * reference (15 > 11) keeps its caret inside. */
function autoMaxAppendedButtonsPx(item, tag, ctx) {
    if (tag !== 'InputField' || !ctx || defaultWidthClampsButtons(item, ctx)) return 0;
    if (fieldKind(item, ctx) !== 'date') return 0;
    var buttons = inputButtonKinds(item, ctx).length;
    return buttons ? 1 + buttons * 21 : 0;
}

/* A number narrower than its MaxWidth keeps its data length: Number(2,0)
 * paints 30px in the reference under MaxWidth 12, while Number(15,3) fills
 * the 130px MaxWidth band. */
function shortNumberBand(item, ctx, band) {
    if (!ctx || !band || fieldKind(item, ctx) !== 'number') return band;
    var nq = metaNumberQualifiers(item, ctx);
    if (!nq || !(parseInt(nq.digits, 10) > 0)) return band;
    return Math.min(band, numberDefaultChars(nq) * REF_AUTHORED_CHAR_PX + TAXI_LAYOUT_METRICS.autoMaxEditorPaintInset);
}

/* MaxWidth band of a text editor. The reference paints the full char-unit ruler
 * MaxWidth*10+10 in vertical columns and horizontal rows alike. A row whose
 * summed bands exceed the available width is compressed by the allocator
 * instead, which is what the reference does rather than scrolling the window. */
function autoMaxEditorBandWidth(maxChars) {
    maxChars = Math.max(0, Number(maxChars) || 0);
    if (!maxChars) return 0;
    return maxChars * REF_AUTHORED_CHAR_PX + TAXI_LAYOUT_METRICS.autoMaxEditorPaintInset;
}

/* An explicitly authored side caption remains a side caption even for a
 * multiline editor. Width is the native TextBox paint band in that contract:
 * HorizontalStretch may allocate a wider owner row, but it does not turn the
 * editor itself into the owner of the trailing space. Auto captions retain the
 * responsive promotion used by narrow side columns. */
function multilineFieldLayoutContract(options) {
    options = options || {};
    var loc = String(options.location || 'left');
    var raw = String(options.authoredTitleLocation || '').toLowerCase()
        .replace(/[ _-]+/g, '');
    var explicitLeft = raw === 'left' || raw === 'слева';
    var paintWidth = Math.max(0, Number(options.authoredPaintWidth) || 0);
    var titleCellChrome = Math.max(0, Number(options.titleCellChrome) || 0);
    var paintHeight = Math.max(0, Number(options.authoredPaintHeight) || 0);
    var captionLineHeight = Math.max(0, Number(options.captionLineHeight) || 0);
    var removedTopTitleBand = Math.max(0, Number(options.removedTopTitleBand) || 0);
    var multiline = !!options.multiline;
    var explicitSideContract = multiline && loc === 'left' && explicitLeft;
    return {
        /* A bounded multiline editor puts its Auto caption on top: an authored
         * Width, or MaxWidth with AutoMaxWidth=false (e.g. MaxWidth=63). */
        location: multiline && loc === 'left' && (paintWidth || options.boundedWidth) && !explicitLeft ? 'top' : loc,
        editorPaintMaximum: explicitSideContract ? paintWidth : 0,
        titleCellChrome: explicitSideContract ? titleCellChrome : 0,
        editorTopInset: explicitSideContract && options.verticalStretch ? captionLineHeight : 0,
        editorPaintHeight: explicitSideContract && options.verticalStretch && paintHeight
            ? Math.max(0, paintHeight - removedTopTitleBand) : 0
    };
}

function applyMultilineEditorPaintBand(inputWrap, contract) {
    var width = contract && Number(contract.editorPaintMaximum);
    if (!inputWrap || !width || width <= 0) return false;
    inputWrap.style.width = width + 'px';
    inputWrap.style.maxWidth = width + 'px';
    inputWrap.style.flex = '0 1 ' + width + 'px';
    var row = inputWrap.parentNode;
    var label = row && row.querySelector && row.querySelector('.fp-field-label');
    var chrome = Math.max(0, Number(contract.titleCellChrome) || 0);
    if (label && chrome) {
        /* The native RichElement title cell keeps the Page's horizontal inset,
         * one rendered Single-spacing lane and the TextBox border lane around
         * its label. border-box keeps later ThroughAlign passes from counting
         * that chrome twice. */
        label.style.paddingRight = chrome + 'px';
        label.style.boxSizing = 'border-box';
    }
    return true;
}

function applyMultilineEditorVerticalBand(inputWrap, contract) {
    var height = contract && Number(contract.editorPaintHeight);
    if (!inputWrap || !height || height <= 0) return false;
    inputWrap.style.height = height + 'px';
    inputWrap.style.minHeight = height + 'px';
    inputWrap.style.maxHeight = height + 'px';
    inputWrap.style.marginTop = Math.max(0, Number(contract.editorTopInset) || 0) + 'px';
    return true;
}

/* DirectWrite advances the glyph run of a compact reference side caption slightly
 * wider than Chromium's canvas at the same nominal Taxi font. Keep that paint
 * correction local to the authored editor/action row: editor Width and row
 * allocation stay on their already-resolved semantic bands. */
function authoredEditorActionCaptionWidth(glyphWidth) {
    return Math.ceil(Math.max(0, Number(glyphWidth) || 0) * 1.09);
}


/* Heights in 1C are counted in text lines, not characters. */
function charHeight(raw) {
    var n = parseInt(raw, 10);
    if (!n || n < 0) return 0;
    return n * ROW_PX;
}

function authoredControlHeightPx(raw, tag) {
    var n = parseInt(raw, 10);
    if (!n || n < 0) return 0;
    if (tag === 'InputField' || tag === 'ValueList' || tag === 'LabelField')
        return n * TAXI_LAYOUT_METRICS.textBoxLineHeight - TAXI_LAYOUT_METRICS.textBoxChromeHeight;
    return n * ROW_PX;
}

function htmlDocumentAuthoredSize(item) {
    var widthUnits = parseInt(prop(item, ['Width', 'Ширина']), 10) || 0;
    var heightUnits = parseInt(prop(item, ['Height', 'Высота']), 10) || 0;
    return {
        width: widthUnits > 0 ? widthUnits * GROUP_COL_PX : 0,
        /* Native HTML publishes 1 -> 20px and 5 -> 132px at Taxi/96 DPI.
         * These are document rows (28px) with one shared 8px chrome band. */
        height: heightUnits > 0 ? heightUnits * 28 - 8 : 0
    };
}

function chartAuthoredSize(item) {
    var widthUnits = parseInt(prop(item, ['Width', 'Ширина']), 10) || 0;
    var heightUnits = parseInt(prop(item, ['Height', 'Высота']), 10) || 0;
    var maxHeightUnits = parseInt(prop(item, ['MaxHeight', 'МаксимальнаяВысота']), 10) || 0;
    return {
        width: widthUnits > 0 ? widthUnits * GROUP_COL_PX : 0,
        /* MaxHeight is a cap, not a preferred size. Treating it as Height
         * locks a chart at 240px and clips the plot inside Pages. */
        height: heightUnits > 0 ? heightUnits * GROUP_ROW_PX : 0,
        maxHeight: maxHeightUnits > 0 ? maxHeightUnits * GROUP_ROW_PX : 0
    };
}

function chartFillRemainingHeight(maxHeight, remaining) {
    var maxH = Math.max(0, Number(maxHeight) || 0);
    var space = Math.max(0, Math.floor(Number(remaining) || 0));
    if (space > 0) return maxH ? Math.min(maxH, space) : space;
    return maxH;
}

function hasCalendarChoicePicture(item) {
    return /InputFieldCalendar|Calendar|Календар/i.test(
        prop(item, ['ChoiceButtonPicture', 'КартинкаКнопкиВыбора']));
}

function fieldKind(item, ctx) {
    if (isTrue(prop(item, ['MultiLine']))) return 'text';
    if (isTrue(prop(item, ['ListChoiceMode'])) || isTrue(prop(item, ['DropListButton']))) return 'list';
    /* Some dynamically bound fields have no DataPath at design time. The
     * standard calendar picture is then the only reliable type marker. */
    if (hasCalendarChoicePicture(item)) return 'date';
    var type = String(metaType(item, ctx)).toLowerCase();
    /* A reference is named after the object it points at, so `CatalogRef.
     * PhoneNumber` and `CatalogRef.UpdateDate` carry `number` and `date` in
     * their spelling without being either. Settle the reference first, then
     * match the primitive kinds against the type name alone — everything after
     * the first dot is an object name, not a type. */
    if (/ref\.|object\.|reference/.test(type)) return 'ref';
    var dot = type.indexOf('.');
    var primitive = dot >= 0 ? type.slice(0, dot) : type;
    if (/datetime|date/.test(primitive)) return 'date';
    if (/decimal|number|integer|int\b/.test(primitive)) return 'number';
    if (/string|boolean/.test(primitive)) return 'text';
    var choice = prop(item, ['ChoiceButton']);
    if (isTrue(choice)) return 'ref';
    return 'text';
}

function formatPlaceholder(item, ctx) {
    /* A ReadOnly number used to print a sample "0", and a null format
     * (ЧН=0,00) "0,00". The reference's designer leaves the box empty like every other
     * unbound editor (e.g. read-only totals). */
    return '';
}

function isHyperlinkItem(item) {
    return isTrue(prop(item, ['Hyperlink', 'Hiperlink']));
}

function compactTag(tag) {
    return tag === 'CheckBoxField' || tag === 'Button' || tag === 'Hyperlink'
        || tag === 'Popup' || tag === 'LabelDecoration' || tag === 'PictureDecoration'
        || tag === 'PictureField' || tag === 'LabelField' || tag === 'RadioButton'
        || tag === 'RadioButtonField';
}

function authoredTriState(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    if (isTrue(raw)) return true;
    if (isFalse(raw)) return false;
    return null;
}

function splitValueTypes(type) {
    return String(type || '').split(',').map(function (part) {
        return part.replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
}

function valueTypeKind(type) {
    var raw = String(type || '').trim();
    if (!raw) return '';
    var name = raw.replace(/^(?:cfg|xs|v8|v8ui|core):/i, '');
    var low = name.toLowerCase();
    if (/^enumref\./i.test(name) || /^перечислениессылка\./i.test(name)) return 'enum';
    if (/ref\./i.test(name) || /ссылка\./i.test(name)) return 'ref';
    if (low === 'boolean' || low === 'bool') return 'boolean';
    if (low === 'decimal' || low === 'number' || low === 'integer') return 'number';
    if (low === 'datetime' || low === 'date') return 'date';
    if (low === 'geographicalschema' || low === 'географическаясхема') return 'geographicalSchema';
    if (low === 'string' || low === 'text') return 'string';
    if (low === 'picture' || low === 'image') return 'picture';
    if (low === 'binarydata' || low === 'binary') return 'binary';
    if (low === 'typedescription') return 'typeDescription';
    if (low === 'valuelist' || low === 'valueslist') return 'valueList';
    if (low === 'color') return 'color';
    if (low === 'font') return 'font';
    if (low === 'standardperiod') return 'standardPeriod';
    if (low === 'standardbeginningdate') return 'standardBeginningDate';
    if (/^datacomposition/i.test(name)) return 'dataComposition';
    return 'other';
}

function dateFractionKey(fraction, typeKind) {
    var key = String(fraction || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (key === 'time') return 'time';
    if (key === 'date') return 'date';
    if (key === 'datetime') return 'datetime';
    return typeKind === 'date' ? 'datetime' : '';
}

function isTypeSetName(type) {
    var name = String(type || '').trim().replace(/^cfg:/i, '');
    return /^(?:AnyRef|AnyIBRef|DefinedType\.|(?:Catalog|Document|ChartOfAccounts|ChartOfCharacteristicTypes|ChartOfCalculationTypes|BusinessProcess|Task|ExchangePlan|Enum)Ref$)/i
        .test(name);
}

/* Type features from the reference property defaults. */
function typeFeaturesOf(types, dateFraction, numberQ) {
    var features = { selection: 'none', clear: false, adjust: false, open: false };
    if (!types || !types.length) return features;
    /* A composite type, or a type set (AnyIBRef, AnyRef, DefinedType.X,
     * CatalogRef) whose members are not resolved here, picks the value type
     * in a dialog: the reference paints a bare choice button. */
    if (types.length > 1 || isTypeSetName(types[0])) {
        features.selection = 'dialog';
        features.composite = true;
        return features;
    }
    var kind = valueTypeKind(types[0]);
    if (kind === 'date') {
        var fraction = dateFractionKey(dateFraction, 'date');
        if (fraction === 'date' || fraction === 'datetime') features.selection = 'dialog';
    } else if (kind === 'number') {
        var scale = numberQ ? parseInt(numberQ.fractionDigits, 10) || 0 : 0;
        if (scale !== 0) features.selection = 'dialog';
    } else if (kind === 'boolean') {
        features.selection = 'finiteSet';
    } else if (kind === 'typeDescription' || kind === 'color' || kind === 'font'
        || kind === 'standardPeriod') {
        features.selection = 'dialog';
    } else if (kind === 'valueList' || kind === 'dataComposition') {
        features.selection = 'dialog';
        features.clear = true;
    } else if (kind === 'standardBeginningDate') {
        features.selection = 'combined';
    } else if (kind === 'ref') {
        features.selection = 'extended';
        features.open = true;
    } else if (kind === 'enum') {
        features.selection = 'extended';
    }
    return features;
}

/* Both defaults below return layout width units: the reference uses Date 9,
 * DateTime 17 and a Time length above 6 (MaxWidth 6 clamps it and drops
 * buttonsCount), and numbers exactly as the Taxi 5.4|5.5/8 value
 * (15,2 -> 15; 17,3+ -> 15). A DateTime 19 / Time 6 / digits+sign+separators
 * width disagrees with the reference. */
function dateDefaultChars(fraction) {
    var key = dateFractionKey(fraction, 'date');
    var length = TYPE_DATETIME_PRESENTATION_CHARS;
    if (key === 'time') length = TYPE_TIME_PRESENTATION_CHARS - 2;
    else if (key === 'date') length = TYPE_DATE_PRESENTATION_CHARS - 3;
    else length = TYPE_DATETIME_PRESENTATION_CHARS - 7;
    return length + 2;
}

function numberDefaultChars(nq) {
    var precision = nq ? parseInt(nq.digits, 10) || 0 : 0;
    if (precision <= 0) return TYPE_DEFAULT_MULTI_CHARS;
    var scale = parseInt(nq.fractionDigits, 10) || 0;
    var length = precision;
    if (scale !== 0) {
        length++;
        if (precision === scale) length++;
    }
    if (!/nonnegative/i.test(String(nq.allowedSign || ''))) length++;
    var numLength = precision - scale;
    var triadCnt = Math.floor(numLength / 3);
    if (triadCnt !== 0 && numLength % 3 === 0) triadCnt--;
    length += triadCnt;
    var converted = length * (length >= 6 ? 5.4 : 5.5) / 8;
    return Math.ceil(converted);
}

/* The reference default data length before the Taxi dataMaxLength clamp. */
function presentationLengthOf(types, options) {
    options = options || {};
    var stringLen = options.stringLen;
    if (!types || !types.length) return DEFAULT_FIELD_CHARS;
    /* A document reference presents «<Документ> № … от …», longer than the
     * 40-unit band: such fields (also with several document types) paint 408px. */
    if (types.every(function (type) { return /(?:^|[:.])DocumentRef\./.test(String(type)); }))
        return TYPE_DEFAULT_MAX_CHARS;
    if (types.length !== 1) return TYPE_DEFAULT_MULTI_CHARS;
    var kind = valueTypeKind(types[0]);
    var length = 0;
    if (kind === 'string' || kind === 'binary') {
        length = stringLen > 0 ? stringLen : 0;
    } else if (kind === 'date') {
        length = dateDefaultChars(options.dateFraction);
    } else if (kind === 'number') {
        length = numberDefaultChars(options.numberQ);
    } else if (kind === 'boolean') {
        length = TYPE_BOOLEAN_CHARS;
    } else if (kind === 'picture') {
        length = TYPE_DEFAULT_PICTURE_CHARS;
    } else if (kind === 'geographicalSchema') {
        length = TYPE_GEOGRAPHICAL_SCHEMA_CHARS;
    } else if (kind === 'ref') {
        length = options.refChars > 0 ? options.refChars : TYPE_DEFAULT_REF_CHARS;
    } else if (kind === 'enum') {
        length = TYPE_DEFAULT_REF_CHARS;
    } else {
        length = TYPE_DEFAULT_MULTI_CHARS;
    }
    if (length === 0) length = kind === 'picture' ? TYPE_DEFAULT_PICTURE_CHARS : TYPE_DEFAULT_MULTI_CHARS;
    if (kind === 'ref' && !options.uncappedRef) length = Math.min(length, TYPE_DEFAULT_REF_CHARS);
    return Math.min(length, TYPE_PRESENTATION_LENGTH_CAP);
}

function defaultCharsOf(types, options) {
    return Math.min(presentationLengthOf(types, options), TYPE_DEFAULT_MAX_CHARS);
}

/* LogFormElementsDefFilter packs a default Width as dataLength plus
 * buttonsCount lanes, except when dataLength was clamped: to an authored
 * MaxWidth under AutoMaxWidth=false, or to dataMaxLength (40) otherwise.
 * A clamped width drops buttonsCount; the buttons sit inside that band. */
function defaultWidthClampsButtons(item, ctx) {
    var length = item && item.runtime && item.runtime.presentationLength;
    if (length == null) {
        var info = typeInfoFromItem(item, ctx);
        length = presentationLengthOf(info.types, info);
    }
    if (isFalse(prop(item, ['AutoMaxWidth']))) {
        var maxChars = parseInt(prop(item, ['MaxWidth', 'МаксимальнаяШирина']), 10) || 0;
        return maxChars > 0 && maxChars < length;
    }
    return length > TYPE_DEFAULT_MAX_CHARS;
}

function choiceButtonRepresentationOf(item, selection) {
    var raw = String(prop(item, ['ChoiceButtonRepresentation']) || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (raw && raw !== 'auto' && raw !== 'авто') {
        if (raw === 'showindroplist') return 'showInDropList';
        if (raw.indexOf('droplist') >= 0 && raw.indexOf('inputfield') >= 0)
            return 'showInDropListAndInInputField';
        if (raw.indexOf('inputfield') >= 0 || raw.indexOf('полевода') >= 0) return 'showInInputField';
    }
    if (selection === 'extended') return 'showInDropList';
    return 'showInInputField';
}

/* Reference Taxi input-field button resolution. Omitted = Auto. */
function resolveInputFieldButtons(item, features, options) {
    options = options || {};
    features = features || { selection: 'none', clear: false, adjust: false, open: false };
    var selection = features.selection || 'none';
    /* A ReadOnly editor is not interactive, and the reference's designer paints it as a
     * plain box: no choice, open, clear or spin chrome (e.g. read-only totals).
     * The value type still decides the editor's band, so only the affordances
     * are dropped. Opening the value is not editing: a ReadOnly reference keeps
     * its open button. */
    if (isTrue(prop(item, ['ReadOnly', 'ТолькоПросмотр']))) {
        var readOnlyOpen = authoredTriState(prop(item, ['OpenButton']));
        if (readOnlyOpen == null) readOnlyOpen = !!features.open && !options.multiValue;
        /* The composite value's type dialog stays, greyed (e.g. an Owner of two
         * catalogs). */
        var readOnlyChoice = authoredTriState(prop(item, ['ChoiceButton']));
        if (readOnlyChoice == null) readOnlyChoice = !!features.composite;
        return {
            choiceButton: readOnlyChoice, dropListButton: false, openButton: readOnlyOpen,
            clearButton: false, spinButton: false, choiceListButton: false,
            choiceButtonRepresentation: choiceButtonRepresentationOf(item, selection)
        };
    }
    var listChoice = isTrue(prop(item, ['ListChoiceMode']));
    var quickChoice = authoredTriState(prop(item, ['QuickChoice']));
    if (quickChoice == null) quickChoice = false;
    var choice = authoredTriState(prop(item, ['ChoiceButton']));
    if (choice == null) {
        if (listChoice) choice = false;
        else if (selection === 'dialog' || selection === 'combined') choice = true;
        else if (selection === 'extended') choice = !quickChoice;
        else choice = false;
    }
    var drop = authoredTriState(prop(item, ['DropListButton']));
    if (drop == null) {
        if (selection === 'combined' || listChoice) drop = true;
        else drop = selection === 'finiteSet' || selection === 'extended';
    }
    var openBtn = authoredTriState(prop(item, ['OpenButton']));
    if (openBtn == null) openBtn = !!features.open && !options.multiValue;
    var clearBtn = authoredTriState(prop(item, ['ClearButton']));
    if (clearBtn == null) clearBtn = !!features.clear && !options.multiValue;
    var spinBtn = authoredTriState(prop(item, ['SpinButton', 'КнопкаРегулирования']));
    if (spinBtn == null) spinBtn = !!features.adjust;
    var choiceList = authoredTriState(prop(item, ['ChoiceListButton']));
    if (choiceList == null) choiceList = false;
    return {
        choiceButton: choice,
        dropListButton: drop,
        openButton: openBtn,
        clearButton: clearBtn,
        spinButton: spinBtn,
        choiceListButton: choiceList,
        choiceButtonRepresentation: choiceButtonRepresentationOf(item, selection)
    };
}

function inputButtonKindsFromButtons(item, ctx, buttons) {
    var kinds = [];
    var kind = fieldKind(item, ctx);
    var representation = buttons.choiceButtonRepresentation;
    var choiceInInput = representation !== 'showInDropList';
    if (kind === 'date' && buttons.choiceButton)
        kinds.push(hasCalendarChoicePicture(item) ? 'calendar' : 'dots');
    if (buttons.dropListButton || buttons.choiceListButton) kinds.push('caret-down');
    /* ExtendedEditMultipleValues adds no chrome in the designer (Код and
     * strings have no «...», references keep open). */
    if (choiceInInput && buttons.choiceButton && kind !== 'date') kinds.push('dots');
    if (isTrue(prop(item, ['CreateButton']))) kinds.push('plus');
    /* Reference paint order: clear and spin precede open. */
    if (buttons.clearButton) kinds.push('x');
    if (buttons.spinButton) kinds.push('spin');
    if (buttons.openButton) kinds.push('open-1c');
    return kinds;
}

function typeInfoFromItem(item, ctx) {
    var type = metaType(item, ctx);
    var types = splitValueTypes(type);
    var stringLen = metaStringLen(item, ctx);
    if (stringLen < 0) stringLen = 0;
    return {
        types: types,
        stringLen: stringLen,
        numberQ: metaNumberQualifiers(item, ctx),
        dateFraction: metaDateFraction(item, ctx),
        refChars: catalogRefCharsForTypes(types, ctx && ctx.captionIndex)
    };
}

/* Every runtime key applyTypeDefaultsToItem writes. They are derived from
 * type metadata, not authored state, so isPaintlessLabelField ignores them. */
var DERIVED_TYPE_RUNTIME_KEYS = { typeFeatures: 1, inputButtons: 1, inputButtonKinds: 1,
    defaultChars: 1, presentationLength: 1, minChars: 1, maxChars: 1, buttonsCount: 1, ignoredProps: 1 };

function applyTypeDefaultsToItem(item, ctx) {
    if (!item) return item;
    var info = typeInfoFromItem(item, ctx);
    var features = typeFeaturesOf(info.types, info.dateFraction, info.numberQ);
    var buttons = resolveInputFieldButtons(item, features, {
        multiValue: false
    });
    var runtime = item.runtime || {};
    runtime.typeFeatures = features;
    runtime.inputButtons = buttons;
    runtime.inputButtonKinds = inputButtonKindsFromButtons(item, ctx, buttons);
    var presentationLength = presentationLengthOf(info.types, info);
    runtime.defaultChars = Math.min(presentationLength, TYPE_DEFAULT_MAX_CHARS);
    runtime.presentationLength = presentationLength;
    runtime.minChars = Math.min(runtime.defaultChars, TYPE_DEFAULT_MIN_CHARS);
    runtime.maxChars = TYPE_DEFAULT_MAX_CHARS;
    runtime.buttonsCount = runtime.inputButtonKinds.length;
    /* With automatic maximum width a serialized MaxWidth below the type's
     * presentation is not a cap in the reference: a reference with MaxWidth 8
     * paints the full 410px column. A larger MaxWidth (e.g. 29) still bounds
     * the stretch. */
    var ignoredMaxChars = parseInt(prop(item, ['MaxWidth', 'МаксимальнаяШирина']), 10) || 0;
    if (item.tag === 'InputField' && ignoredMaxChars > 0 && ignoredMaxChars < runtime.defaultChars
        && !isFalse(prop(item, ['AutoMaxWidth'])) && !charSize(prop(item, ['Width', 'Ширина']))) {
        runtime.ignoredProps = {};
        runtime.ignoredProps[normKey('MaxWidth')] = 1;
        runtime.ignoredProps[normKey('МаксимальнаяШирина')] = 1;
    }
    item.runtime = runtime;
    return item;
}

function applyTypeDefaultsToModel(model) {
    if (!model) return model;
    var ctx = { captionIndex: buildCaptionIndex(model) };
    var attached = ['contextMenu', 'autoCommandBar', 'extendedTooltip',
        'searchStringAddition', 'viewStatusAddition', 'searchControlAddition'];
    function walk(item) {
        if (!item) return;
        applyTypeDefaultsToItem(item, ctx);
        for (var a = 0; a < attached.length; a++) {
            if (item[attached[a]]) walk(item[attached[a]]);
        }
        var children = item.childItems || [];
        for (var i = 0; i < children.length; i++) walk(children[i]);
    }
    if (model.autoCommandBar) walk(model.autoCommandBar);
    var roots = model.childItemsRoot || [];
    for (var r = 0; r < roots.length; r++) walk(roots[r]);
    return model;
}

function defaultFieldChars(item, ctx) {
    if (item && item.runtime && item.runtime.defaultChars != null)
        return item.runtime.defaultChars;
    var info = typeInfoFromItem(item, ctx);
    return defaultCharsOf(info.types, info);
}

function compactQualifiedSingleFieldWidth(item, tag, parentMeta, ctx) {
    if (tag !== 'InputField' || !parentMeta || parentMeta.orientation !== 'horizontal'
        || !parentMeta.singleInputChild || fieldKind(item, ctx) !== 'text'
        || charSize(prop(item, ['Width', 'Ширина']))
        || charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))
        || prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание'])) return 0;
    var length = metaStringLen(item, ctx);
    var nativeWidth = length > 0 ? length * REF_AUTHORED_CHAR_PX + 10 : 0;
    /* Below the generic 80px browser floor the qualifier is the stronger reference
     * presentation contract. Wider strings remain ordinary stretch owners. */
    return nativeWidth > 0 && nativeWidth < 80 ? nativeWidth : 0;
}

/* A pure select (ListChoiceMode, TextEdit=false) in a vertical column treats
 * Width as its initial size and grows to the 40-char band (W18 paints 410px
 * in the reference). */
function verticalSelectBandStretch(item, tag, parentMeta) {
    return tag === 'InputField' && !!parentMeta && parentMeta.orientation === 'vertical'
        && parentMeta.tag !== 'Page'
        && !!charSize(prop(item, ['Width', 'Ширина']))
        && (parseInt(prop(item, ['Width', 'Ширина']), 10) || 0) < TYPE_DEFAULT_MAX_CHARS
        && !charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))
        && !isFalse(prop(item, ['AutoMaxWidth']))
        && !String(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']) || '').trim()
        && isTrue(prop(item, ['ListChoiceMode']))
        && isFalse(prop(item, ['TextEdit']));
}

function vertBandStretch(item, tag, parentMeta, ctx) {
    if (verticalSelectBandStretch(item, tag, parentMeta)) return true;
    return tag === 'InputField' && !!parentMeta && parentMeta.orientation === 'vertical'
        && !!parentMeta.explicitWidth && parentMeta.tag !== 'Page'
        && !charSize(prop(item, ['Width', 'Ширина']))
        && !charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))
        && !isFalse(prop(item, ['AutoMaxWidth']))
        && titleLocation(item) !== 'top' && fieldKind(item, ctx) === 'ref';
}

/* [PINNED-TAIL-BAR] A CommandBar row has a pinned tail when it holds a search
 * addition, a help button or an InAdditionalSubmenu («Еще») button. */
function commandBarHasPinnedTail(item) {
    var kids = (item && item.childItems) || [];
    for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (!kid || isFalse(prop(kid, ['Visible', 'visible']))) continue;
        if (kid.tag === 'SearchStringAddition' || isHelpItem(kid) || inAdditionalBar(kid)) return true;
        if (kid.tag === 'ButtonGroup' && commandBarHasPinnedTail(kid)) return true;
    }
    return false;
}

function wantsHStretch(item, tag, parentMeta, ctx) {
    var hs = prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']);
    if (isFalse(hs)) return false;
    /* MaxWidth with AutoMaxWidth=false is a cap, including when Stretch is
     * explicitly true. Honouring Stretch first made one field of an
     * AlwaysHorizontal pair eat the leftover and shove the other. */
    /* A LabelField is the exception: the reference stretches AutoMaxWidth=false
     * + MaxWidth LabelFields, and its grid column takes the row surplus when
     * the owner is wider than its content: an authored group Width (W91 gives
     * the label column 503) or a flattened Page row. A trailing hyperlink and
     * button then sit on the right. Without such an owner the column stays at
     * MaxWidth (e.g. 100px), so do not grow there. */
    var cappedLabelFieldStretch = tag === 'LabelField'
        && isFalse(prop(item, ['AutoMaxWidth']))
        && charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))
        && !charSize(prop(item, ['Width', 'Ширина']))
        && parentMeta && parentMeta.orientation === 'horizontal'
        && (parentMeta.authoredWidth > 0 || parentMeta.tag === 'Page');
    if (cappedLabelFieldStretch) return true;
    if ((tag === 'InputField' || tag === 'LabelField' || tag === 'ValueList')
        && isFalse(prop(item, ['AutoMaxWidth']))
        && charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))
        && !charSize(prop(item, ['Width', 'Ширина']))) return false;
    if (isTrue(hs)) return true;
    /* [W-DATE] A date field without Width/MaxWidth does not stretch by
     * default (Date 121px, DateTime 180px). */
    if (tag === 'InputField' && fieldKind(item, ctx) === 'date' && !isMultilineField(item, ctx)
        && !charSize(prop(item, ['Width', 'Ширина']))
        && !charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))) return false;
    /* HorizontalLocation=Right is a compact trailing cluster. A title on the
     * CommandBar must not promote it to a full-row stretch owner, or Далее
     * stays on the left of a 100% toolbar. */
    if ((tag === 'CommandBar' || tag === 'AutoCommandBar')
        && /right|прав/i.test(String(prop(item, ['HorizontalLocation', 'ГоризонтальноеПоложение']) || '')))
        return false;
    /* [PINNED-TAIL-BAR] the reference stretches an authored CommandBar whose row ends in
     * the pinned «Еще»/«?»/search tail, so the tail reaches the owner's right
     * edge. */
    if (tag === 'CommandBar' && !String(hs || '').trim() && commandBarHasPinnedTail(item)) return true;
    if (compactQualifiedSingleFieldWidth(item, tag, parentMeta, ctx)) return false;
    if ((tag === 'InputField' || tag === 'LabelField' || tag === 'ValueList')
        && isFalse(prop(item, ['AutoMaxWidth']))
        && charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))) return false;
    /* [W-NUM-WRAP] A Width/MaxWidth-less number field outside the Form root
     * keeps its type band (Number(7,2) in a horizontal group: 81px). */
    var numWrapNoStretch = tag === 'InputField' && parentMeta && parentMeta.tag !== 'Form'
        && fieldKind(item, ctx) === 'number'
        && !charSize(prop(item, ['Width', 'Ширина']))
        && !charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))
        /* A shown tooltip (ShowRight/ShowBottom) still needs the row surplus,
         * otherwise the field overlaps its tooltip text. */
        && !/^show/i.test(String(prop(item, ['ToolTipRepresentation']) || ''));
    if (!numWrapNoStretch && refDefaultWrapperStretch(item, parentMeta, ctx)) return true;
    if (tag === 'SpreadSheetDocumentField' || tag === 'HTMLDocumentField'
        || tag === 'TextDocumentField' || tag === 'FormattedDocumentField') return true;
    /* AutoMaxWidth=false without a MaxWidth lifts the width cap entirely, so a
     * data-bound LabelField consumes the free space of its horizontal row.
     * That is how 1C pushes the trailing hyperlink of a header row to the right
     * edge; a LabelField otherwise stays compact. */
    if (tag === 'LabelField' && prop(item, ['DataPath'])
        && isFalse(prop(item, ['AutoMaxWidth']))
        && !charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))
        && !charSize(prop(item, ['Width', 'Ширина']))
        && parentMeta && parentMeta.orientation === 'horizontal') return true;
    /* MaxWidth with the default AutoMaxWidth is only a cap: the reference
     * stretches such an InputField up to it (default 15 chars, 203px normal,
     * stretch=Hor). The 15-char reference default otherwise leaves 120px. */
    if (tag === 'InputField' && !String(hs || '').trim()
        && !charSize(prop(item, ['Width', 'Ширина']))
        && charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))
        && !isFalse(prop(item, ['AutoMaxWidth']))) return true;
    if (compactTag(tag)) return false;
    if (tag === 'Table') return true;
    if (tag === 'Pages' && pagesRep(item) !== 'none') return true;
    if (tag === 'InputField' && titleLocation(item) === 'top') return true;
    if (tag === 'InputField' && isMultilineField(item, ctx)) return true;
    /* An ordinary input directly owned by a vertical group consumes that
     * group's value column in 1C. Compact pairs remain compact because their
     * immediate parent is horizontal, and explicit HorizontalStretch=false
     * has already returned above. This is what makes scalar requisites such
     * as OGRN, Region and Representative reach the common right edge. */
    if (tag === 'InputField' && parentMeta && parentMeta.orientation === 'vertical'
        && !(parentMeta.tag === 'Page' && parentMeta.hasCommandBarChild)
        && !parentMeta.explicitWidth) {
        var hasWidth = charSize(prop(item, ['Width', 'Ширина']));
        var hasMaxWidth = charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']));
        if (!hasWidth && !hasMaxWidth) return true;
        /* A generated one-field column uses Width as its initial size and lets
         * that sole value consume the column (for example the footer phone).
         * In multi-field totals Width remains the compact column width. */
        if (hasWidth && !hasMaxWidth && parentMeta.singleInputChild
            && !isFalse(prop(item, ['AutoMaxWidth']))) return true;
    }
    /* In a vertical group with its own Width a bare ref value still grows to
     * its presentation band (group W83: 407px in the reference); the cap is
     * applied with the decoration-titled case. */
    if (vertBandStretch(item, tag, parentMeta, ctx)) return true;
    /* Configurator-generated explicit field rows carry Width on the enclosing
     * horizontal group and put the actual field title in a LabelDecoration.
     * In that layout an untitled presentation-heavy value consumes the
     * remainder of the row; dates and numbers retain their compact width.
     * Keeping this conditional on that serialized row marker preserves compact
     * side-title fields in ordinary horizontal groups. */
    /* The same generated row without a group Width: a sized LabelDecoration
     * stands in for the title, and the reference stretches the untitled value
     * up to its default maximum width. */
    if (tag === 'InputField' && parentMeta
        && (parentMeta.explicitWidth || parentMeta.decorationTitledField)
        && titleLocation(item) === 'none' && !isTumbler(item)) {
        var kind = fieldKind(item, ctx);
        if (kind === 'text' || kind === 'ref' || kind === 'list') return true;
    }
    /* Followed by a data LabelField on its row, the uncapped editor keeps its
     * default presentation band (205px in the reference); the label owns the
     * rest of the row. */
    if (tag === 'InputField' && isFalse(prop(item, ['AutoMaxWidth']))
        && !charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))
        && !charSize(prop(item, ['Width', 'Ширина']))
        && !(parentMeta && parentMeta.inputThenLabelField)) return true;
    /* A width-hungry field cannot grow when one of its wrapper groups keeps
     * shrink-to-content width. 1C propagates that requirement through usual
     * groups; do the same, while an explicit HorizontalStretch=false above
     * remains the hard stop handled at the beginning of this function. */
    if (isContainer(tag) && item && item.childItems) {
        var ownMeta = layoutMeta(item);
        /* A repeated selector tuple owns several equivalent automatic value
         * tracks. It therefore publishes stretch through its transparent
         * wrapper instead of leaving only the first titled selector elastic. */
        if (ownMeta.compoundSelectorChildren && ownMeta.compoundSelectorChildren.length)
            return true;
        /* A horizontal logical row exposes its automatic value track to its
         * immediate parent. The ignore flag below prevents that local default
         * from leaking through every transparent ancestor. */
        if (ownMeta.defaultStretchChild
            && charSize(prop(ownMeta.defaultStretchChild, ['Width', 'Ширина']))
            && !(parentMeta && parentMeta.ignoreDefaultWrapperStretch))
            return true;
        /* A default on a child's RichElement is local to that generated
         * group. Unlike explicit HorizontalStretch, it must not make every
         * transparent ancestor width-hungry. */
        ownMeta.ignoreDefaultWrapperStretch = true;
        var visibleChildren = item.childItems.filter(function (child) {
            return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
        });
        var scalarWithNote = visibleChildren.length === 2
            && visibleChildren.some(function (child) { return child.tag === 'InputField'; })
            && visibleChildren.some(function (child) {
                return child.tag === 'LabelDecoration'
                    && charSize(prop(child, ['MaxWidth', 'МаксимальнаяШирина']));
            });
        /* A scalar selector followed by a bounded explanatory note is a
         * compact native block. The selector's default presentation width
         * must not make the transparent top-level wrapper consume the form. */
        if (scalarWithNote) return false;
        for (var i = 0; i < item.childItems.length; i++) {
            var child = item.childItems[i];
            if (!child || isFalse(prop(child, ['Visible', 'visible']))) continue;
            /* [RIGHT-BAR-OWNER] A right-located CommandBar lane needs a full-width owner
             * (ОК/Отмена on the right edge). */
            if (child.tag === 'CommandBar'
                && /right|прав/i.test(String(prop(child, ['HorizontalLocation', 'ГоризонтальноеПоложение']) || '')))
                return true;
            if (wantsHStretch(child, child.tag || '', ownMeta, ctx)) return true;
        }
    }
    var cw = parentMeta && parentMeta.childItemsWidth;
    /* [W-NUM-WRAP] holds under ChildItemsWidth too: in a LeftWide group the
     * number field keeps 81px with the next field right after it. */
    if ((cw === 'equal' || cw === 'leftwidest' || cw === 'rightwidest') && !numWrapNoStretch) return true;
    return false;
}

/* The schema default is attached to RichElement,
 * not to every input field: every titled direct child of the root panel gets
 * it, while a nested horizontal group gives it only to its first source
 * child. Vertical groups never supply this default. A title inferred merely
 * from DataPath/name does not count; an explicit title or command title does. */
/* Reference dynamic label height: only a wrappable text (an ASCII
 * space) with no fixed height and no explicit stretch=false gets the
 * horizontal content stretch and width-dependent height. */
function labelDecorationCanDynamicHeight(item) {
    if (!item) return false;
    if (isFalse(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))
        || isFalse(prop(item, ['VerticalStretch', 'ВертикальноеРастягивание']))) return false;
    if ((parseInt(prop(item, ['Height', 'Высота']), 10) || 0) > 0
        || (parseInt(prop(item, ['MaxHeight', 'МаксимальнаяВысота']), 10) || 0) > 0) return false;
    return String(rawTitle(item) || '').indexOf(' ') >= 0;
}

/* An untitled string editor leading a horizontal row paints the 40-unit
 * band, and the next item follows it directly: a 410px «Комментарий» with
 * «Ответственный» 10px after it, likewise an untitled «Наименование» next
 * to «Код», or an untitled reference filter. Only when every later editor
 * of the row is fixed: several automatic filters in one row share the
 * window evenly. */
function untitledLeadingStringEditor(item, parentMeta, ctx) {
    return !!(item && parentMeta && item.tag === 'InputField' && !rawTitle(item)
        && parentMeta.orientation === 'horizontal'
        && parentMeta.firstSourceChild === item
        && !charSize(prop(item, ['Width', 'Ширина']))
        && !charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))
        && !isFalse(prop(item, ['AutoMaxWidth']))
        && !isFalse(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))
        && !isMultilineField(item, ctx)
        /* A titled reference keeps its 15-char default (202px); only an untitled
         * one takes the band. */
        && (fieldKind(item, ctx) === 'text'
            || (fieldKind(item, ctx) === 'ref' && titleLocation(item) === 'none'))
        && (parentMeta.visibleChildren || []).every(function (kid) {
            return kid === item || !automaticWidthEditor(kid, ctx);
        }));
}

/* An editor whose width the reference still decides: no Width, no stretch=false, and a
 * reference, list or long/unlimited string (a String(9) «Код» is fixed by its
 * type). */
function automaticWidthEditor(item, ctx) {
    if (!item || (item.tag !== 'InputField' && item.tag !== 'LabelField')) return false;
    if (isFalse(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))) return false;
    if (charSize(prop(item, ['Width', 'Ширина']))) return false;
    var kind = fieldKind(item, ctx);
    if (kind === 'ref' || kind === 'list') return true;
    if (kind !== 'text') return false;
    var length = metaStringLen(item, ctx);
    return !length || length >= 40;
}

function refDefaultWrapperStretch(item, parentMeta, ctx) {
    if (!item || !parentMeta) return false;
    if (parentMeta.ignoreDefaultWrapperStretch) return false;
    if (item.tag === 'LabelDecoration' && !labelDecorationCanDynamicHeight(item)) return false;
    /* A generated horizontal value row has one automatic growth owner. When
     * the row contains a later editable value (possibly followed by compact
     * actions), the reference gives that value the surplus instead of stretching the
     * first titled control. This is the same topology used by compound
     * selector rows such as number + reference + hyperlink. */
    if (parentMeta.compoundSelectorChildren
        && parentMeta.compoundSelectorChildren.indexOf(item) >= 0) return true;
    if (parentMeta.defaultStretchChild)
        return parentMeta.defaultStretchChild === item;
    if (isFalse(prop(item, ['ShowTitle', 'ПоказыватьЗаголовок']))) return false;
    var title = rawTitle(item);
    if (!title) {
        var commandName = lastSeg(prop(item, ['CommandName', 'Command']));
        title = commandName && ctx && ctx.commandTitles ? ctx.commandTitles[commandName] : '';
    }
    if (!title) return false;
    if (parentMeta.tag === 'Form') return true;
    return parentMeta.orientation === 'horizontal'
        && parentMeta.groupMode !== 'auto'
        && parentMeta.firstSourceChild === item;
}

function defaultFieldWidthPx(item, ctx) {
    var chars = defaultFieldChars(item, ctx);
    var index = ctx && ctx.captionIndex;
    var charPx = index
        ? lookupPathMap(index.stringCharPx, prop(item, ['DataPath']), index.mainNames)
        : null;
    return chars * (charPx || CHAR_PX);
}

function defaultEditorPaintWidth(item, ctx, tag, appendedButtons) {
    var width = defaultFieldWidthPx(item, ctx);
    if ((tag === 'InputField' || tag === 'ValueList') && !defaultWidthClampsButtons(item, ctx))
        width += Math.max(0, Number(appendedButtons) || 0) * 21;
    return width;
}

function tableWidthMetrics(item) {
    var authoredWidth = parseInt(prop(item, ['Width', 'Ширина']), 10);
    var authoredMaximum = parseInt(prop(item, ['MaxWidth', 'МаксимальнаяШирина']), 10);
    /* The reference's table generator gives a Table without Width min(88, 40 + 12(n-3))
     * form units, n = the table's generated top-level columns/column groups
     * (Visible=false items are not generated; command bars and additions are
     * not columns), e.g. 5 visible of 6 -> 64, 4 of 5 -> 52. A hidden
     * LineNumber column is the known exception the reference still generates.
     * At Taxi/96 DPI a form width unit is exactly 10px.  With explicit
     * HorizontalStretch=false the table group publishes the same value
     * as min/normal/max; MaxWidth is irrelevant because there is no growth. */
    var columns = (item.childItems || []).filter(function (child) {
        return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
    }).length;
    var defaultWidth = Math.min(88, 40 + Math.max(0, columns - 3) * 12);
    var preferred = (authoredWidth > 0 ? authoredWidth : defaultWidth) * REF_AUTHORED_CHAR_PX;
    var fixed = isFalse(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']));
    return {
        preferred: preferred,
        minimum: fixed ? preferred : Math.min(preferred, TAXI_LAYOUT_METRICS.compressedElementMinimumWidth),
        maximum: fixed ? preferred
            : (authoredMaximum > 0 ? authoredMaximum * REF_AUTHORED_CHAR_PX : Infinity),
        fixed: fixed
    };
}

function tableWidgetWidthMetrics(gridWidth, chromeWidths) {
    var grid = Math.max(0, Number(gridWidth) || 0);
    var widget = grid;
    for (var i = 0; chromeWidths && i < chromeWidths.length; i++) {
        var chrome = Math.max(0, Number(chromeWidths[i]) || 0);
        if (chrome > widget) widget = chrome;
    }
    return { grid: grid, widget: Math.ceil(widget) };
}

function dimensionBands(item, tag, parentMeta, ctx) {
    var authoredWidth = fixedShortEditorWidth(item, tag, ctx)
        || horizontalDecorationWidthPx(item, tag, parentMeta)
        || authoredFieldWidthPx(prop(item, ['Width', 'Ширина']), tag);
    var compactQualifiedWidth = compactQualifiedSingleFieldWidth(item, tag, parentMeta, ctx);
    var authoredMaxWidth = authoredFieldWidthPx(prop(item, ['MaxWidth', 'МаксимальнаяШирина']), tag);
    /* An authored Width is allowed to underspecify the editor, but it cannot
     * make a Date+Time value lose its time lane. The reference applies the native value
     * presentation minimum after reading Width/MaxWidth. */
    var dateTimeMinimum = tag === 'InputField'
        && fieldKind(item, ctx) === 'date'
        && String(metaDateFraction(item, ctx)).toLowerCase() === 'datetime'
        ? defaultFieldChars(item, ctx) * CHAR_PX + 20 : 0;
    if (authoredWidth && dateTimeMinimum) authoredWidth = Math.max(authoredWidth, dateTimeMinimum);
    if (authoredMaxWidth && dateTimeMinimum) authoredMaxWidth = Math.max(authoredMaxWidth, dateTimeMinimum);
    var explicitMaxChars = parseInt(prop(item, ['MaxWidth', 'МаксимальнаяШирина']), 10) || 0;
    var fixedAutoMaximum = !authoredWidth && explicitMaxChars > 0
        && isFalse(prop(item, ['AutoMaxWidth']))
        && (tag === 'InputField' || tag === 'LabelField' || tag === 'ValueList');
    if (fixedAutoMaximum)
        authoredMaxWidth = parentMeta && parentMeta.orientation === 'horizontal'
            ? shortNumberBand(item, ctx, explicitMaxChars * REF_AUTHORED_CHAR_PX)
                + autoMaxAppendedButtonsPx(item, tag, ctx)
            : explicitMaxChars * REF_AUTHORED_CHAR_PX;
    var authoredHeight = authoredControlHeightPx(prop(item, ['Height', 'Высота']), tag);
    var authoredMaxHeight = authoredControlHeightPx(prop(item, ['MaxHeight', 'МаксимальнаяВысота']), tag);
    var hStretch = wantsHStretch(item, tag, parentMeta, ctx);
    var vStretch = wantsVStretch(item, tag, ctx);
    var normalWidth = authoredWidth || compactQualifiedWidth;
    var recommendedWidth = authoredWidth || compactQualifiedWidth;
    var tableSizing = tag === 'Table' ? tableWidthMetrics(item) : null;
    if (tableSizing) normalWidth = recommendedWidth = tableSizing.preferred;
    if (!normalWidth && (tag === 'InputField' || tag === 'ValueList' || tag === 'LabelField')) {
        /* A page-local command lane followed by a filter editor is the native
         * toolbar/filter pattern. It is not stretched to the page, but its
         * automatic presentation band is 40 form units plus editor chrome. */
        if (tag === 'InputField' && parentMeta && parentMeta.tag === 'Page'
            && parentMeta.hasCommandBarChild && !fixedAutoMaximum)
            normalWidth = TYPE_DEFAULT_MAX_CHARS * REF_AUTHORED_CHAR_PX
                + TAXI_LAYOUT_METRICS.authoredEditorInsetWidth;
        else normalWidth = fixedAutoMaximum ? authoredMaxWidth : defaultFieldWidthPx(item, ctx);
        /* MaxWidth with the default AutoMaxWidth caps a platform TextBox whose
         * normal is the reference default data length on the char-unit ruler plus its
         * input buttons: 150+10+22 = 182, or 203 with an open button. */
        if (tag === 'InputField' && authoredMaxWidth && !fixedAutoMaximum
            && !isFalse(prop(item, ['AutoMaxWidth']))) {
            var nativeButtons = defaultWidthClampsButtons(item, ctx) ? 0 : inputButtonKinds(item, ctx).length;
            normalWidth = Math.min(authoredMaxWidth,
                defaultFieldChars(item, ctx) * REF_AUTHORED_CHAR_PX + 10 + nativeButtons * 21);
        }
        recommendedWidth = normalWidth;
        if (fixedAutoMaximum) {
            /* MaxWidth=false/MaxWidth is the generated normal ceiling, while
             * the responsive grid still remembers the value type's
             * ordinary recommendation. Logical subgrids need both: some use
             * the recommendation, whereas a String(255) reaches the authored
             * ceiling. */
            var nativeDefaultWidth = defaultFieldChars(item, ctx) * REF_AUTHORED_CHAR_PX + 10;
            recommendedWidth = Math.min(authoredMaxWidth, nativeDefaultWidth);
        }
    }
    if (!recommendedWidth) recommendedWidth = normalWidth;
    var normalHeight = authoredHeight || 0;
    var horizontalStretchPriority = isTrue(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']));
    var horizontalCompressPriority = isFalse(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))
        || compactTag(tag);
    var explicitFixedWidth = isFalse(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']));
    var fieldMinimum = (tag === 'InputField' || tag === 'ValueList' || tag === 'LabelField')
        ? 71 : TAXI_LAYOUT_METRICS.compressedElementMinimumWidth;
    return {
        horizontal: {
            min: tableSizing ? tableSizing.minimum
                /* AutoMaxWidth=false + MaxWidth on a number: the column min equals its
                 * max (minLength = maxLength = 161); a string keeps its
                 * compressible band (minWidth 71, width 121). */
                : (normalWidth ? (explicitFixedWidth || fixedAutoMaximum && fieldKind(item, ctx) === 'number' ? normalWidth : Math.min(normalWidth, fieldMinimum)) : 0),
            normal: normalWidth || 0,
            recommended: recommendedWidth || 0,
            max: tableSizing ? tableSizing.maximum
                : (authoredMaxWidth || (hStretch ? Infinity : (normalWidth || Infinity))),
            stretch: hStretch,
            stretchPriority: horizontalStretchPriority,
            compressPriority: !horizontalStretchPriority && horizontalCompressPriority
        },
        vertical: {
            min: normalHeight ? Math.min(normalHeight, ROW_PX) : 0,
            normal: normalHeight,
            recommended: normalHeight,
            max: authoredMaxHeight || (vStretch ? Infinity : (normalHeight || Infinity)),
            stretch: vStretch,
            stretchPriority: isTrue(prop(item, ['VerticalStretch'])),
            compressPriority: isFalse(prop(item, ['VerticalStretch']))
        }
    };
}

function distributeDimensionBands(entries, available) {
    entries = entries || [];
    var sizes = entries.map(function (entry) {
        var min = Math.max(0, Number(entry.min) || 0);
        var max = entry.max == null ? Infinity : Number(entry.max);
        if (!isFinite(max)) max = Infinity;
        var normal = Number(entry.normal);
        if (!isFinite(normal)) normal = min;
        return Math.max(min, Math.min(max, normal));
    });
    var target = Math.max(0, Number(available) || 0);
    var total = sizes.reduce(function (sum, value) { return sum + value; }, 0);
    var growing = target >= total;
    var remaining = Math.abs(target - total);
    var groups = growing
        ? [function (e) { return !!e.stretchPriority; },
            function (e) { return !e.stretchPriority && !e.compressPriority; },
            function (e) { return !!e.compressPriority; }]
        : [function (e) { return !!e.compressPriority; },
            function (e) { return !e.stretchPriority && !e.compressPriority; },
            function (e) { return !!e.stretchPriority; }];
    if (!growing) {
        /* Grid tracks publish two floors for titled TextBox rows:
         * minLengthWithNormalPriority keeps HorStretchPriority content, the
         * side title, whole while the value lanes give way;
         * minLengthWithStretchPriority lets that title wrap and is reached
         * only after the first floor is exhausted. The platform layout takes
         * a shortage in proportion to slack above the floor, but the reference
         * stretches that result on the client and slack weighting moves
         * header columns away from the reference, so the pass keeps the equal
         * water-fill. */
        var floors = [function (e) {
            var own = Math.max(0, Number(e.min) || 0);
            return e.minNormal == null ? own : Math.max(own, Number(e.minNormal) || 0);
        }, function (e) { return Math.max(0, Number(e.min) || 0); }];
        for (var f = 0; f < floors.length && remaining > 0.001; f++) {
            for (var cg = 0; cg < groups.length && remaining > 0.001; cg++) {
                var open = [];
                var slacks = entries.map(function (entry, index) {
                    var slack = groups[cg](entry) ? Math.max(0, sizes[index] - floors[f](entry)) : 0;
                    if (slack > 0.001) open.push(index);
                    return slack;
                });
                while (open.length && remaining > 0.001) {
                    var equalShare = remaining / open.length;
                    var still = [];
                    for (var o = 0; o < open.length; o++) {
                        var k = open[o];
                        var cut = Math.min(equalShare, slacks[k]);
                        sizes[k] -= cut;
                        slacks[k] -= cut;
                        remaining -= cut;
                        if (slacks[k] > 0.001) still.push(k);
                    }
                    open = still;
                }
            }
        }
        return sizes;
    }
    for (var g = 0; g < groups.length && remaining > 0.001; g++) {
        var active = [];
        for (var i = 0; i < entries.length; i++) if (groups[g](entries[i])) active.push(i);
        while (active.length && remaining > 0.001) {
            var share = remaining / active.length;
            /* The reference client stretch of a grid: surplus goes to growable tracks
             * in proportion to their standardLength, capped by each maximum,
             * leftovers redistributed. A track without a standard weighs its
             * length. */
            var standardSum = 0;
            for (var sw = 0; sw < active.length; sw++) {
                var weighted = entries[active[sw]];
                var ceiling = !growing ? 0 : weighted.max == null ? Infinity : Number(weighted.max);
                if (growing && !(ceiling > sizes[active[sw]] + 0.001)) continue;
                standardSum += Math.max(0, Number(weighted.standard) || 0) || Math.max(0, sizes[active[sw]]);
            }
            var next = [];
            var consumed = 0;
            for (var a = 0; a < active.length; a++) {
                var index = active[a];
                if (standardSum > 0.001)
                    share = remaining * (Math.max(0, Number(entries[index].standard) || 0)
                        || Math.max(0, sizes[index])) / standardSum;
                var boundary = growing
                    ? (entries[index].max == null ? Infinity : Number(entries[index].max))
                    : Math.max(0, Number(entries[index].min) || 0);
                if (!isFinite(boundary)) boundary = Infinity;
                var capacity = growing ? boundary - sizes[index] : sizes[index] - boundary;
                var change = Math.max(0, Math.min(share, capacity));
                sizes[index] += growing ? change : -change;
                consumed += change;
                if (capacity > change + 0.001) next.push(index);
            }
            if (consumed <= 0.001) break;
            remaining -= consumed;
            active = next;
        }
    }
    return sizes;
}

/* The reference lays out a horizontal logical grid from size bands and only then paints
 * controls into the allocated tracks. CSS flex cannot reproduce that contract:
 * it loses authored normal widths before the responsive decision and assigns
 * fractional remainder differently on every nesting level. This browser-safe
 * allocator keeps the existing priority order, then serializes integer tracks
 * with a stable source-order remainder. */
function allocateHorizontalDimensionBands(entries, available, childItemsWidth) {
    entries = (entries || []).map(function (entry) {
        var copy = {};
        for (var key in entry) if (Object.prototype.hasOwnProperty.call(entry, key)) copy[key] = entry[key];
        if (!copy.stretch) copy.max = Math.min(isFinite(Number(copy.max)) ? Number(copy.max) : Infinity,
            Math.max(0, Number(copy.normal) || 0));
        return copy;
    });
    if (!entries.length) return [];
    if (childItemsWidth === 'equal') {
        var equalNormal = entries.reduce(function (value, entry) {
            return Math.max(value, Number(entry.normal) || 0);
        }, 0);
        var equalMin = entries.reduce(function (value, entry) {
            return Math.max(value, Number(entry.min) || 0);
        }, 0);
        for (var e = 0; e < entries.length; e++) {
            if (!entries[e].stretch && entries[e].max <= entries[e].normal) continue;
            entries[e].normal = Math.max(equalNormal, entries[e].normal || 0);
            entries[e].min = Math.max(equalMin, entries[e].min || 0);
        }
    } else if ((childItemsWidth === 'leftwidest' || childItemsWidth === 'rightwidest') && entries.length > 1) {
        var widest = childItemsWidth === 'leftwidest' ? 0 : entries.length - 1;
        entries[widest].stretchPriority = true;
        entries[widest].compressPriority = false;
    }
    var exact = distributeDimensionBands(entries, available);
    var sizesTotal = Math.round(exact.reduce(function (sum, value) { return sum + value; }, 0));
    var lastFractional = -1;
    for (var lf = 0; lf < exact.length; lf++) if (Math.abs(exact[lf] - Math.round(exact[lf])) > 0.001) lastFractional = lf;
    if (lastFractional >= 0) {
        /* The reference client stretch rounds each track and hands the rounding
         * remainder to the last growing one. */
        var rounded = exact.map(function (value) { return Math.round(value); });
        var roundedTotal = rounded.reduce(function (sum, value) { return sum + value; }, 0);
        rounded[lastFractional] += sizesTotal - roundedTotal;
        return rounded;
    }
    var integers = exact.map(function (value) { return Math.floor(value); });
    var used = integers.reduce(function (sum, value) { return sum + value; }, 0);
    var exactUsed = Math.round(exact.reduce(function (sum, value) { return sum + value; }, 0));
    var remainder = Math.max(0, exactUsed - used);
    var order = exact.map(function (value, index) { return { index: index, fraction: value - Math.floor(value) }; });
    order.sort(function (a, b) { return b.fraction - a.fraction || a.index - b.index; });
    for (var r = 0; r < remainder && r < order.length; r++) integers[order[r].index]++;
    return integers;
}

/* A detached pair of vertical logical columns can expose two different
 * horizontal bands for its trailing value column: the type recommendation
 * and the authored normal ceiling. When the leading column is already at its
 * normal band and the parent has spare width, the reference spends that width restoring
 * the trailing normal track before leaving an unused tail. This is wrapper
 * allocation: the editor remains shrinkable and keeps its own authored max. */
function balancedBoundedLogicalPairWidth(entries) {
    if (!entries || entries.length !== 2) return 0;
    var leading = entries[0] || {};
    var trailing = entries[1] || {};
    var leadingNormal = Math.max(0, Number(leading.normal) || 0);
    var leadingRecommended = Math.max(0,
        Number(leading.recommended) || leadingNormal);
    var trailingNormal = Math.max(0, Number(trailing.normal) || 0);
    var trailingRecommended = Math.max(0,
        Number(trailing.recommended) || trailingNormal);
    var trailingMaximum = trailing.max == null ? Infinity : Number(trailing.max);
    if (trailing.stretch || Math.abs(leadingNormal - leadingRecommended) > 0.5
        || leadingNormal > trailingNormal + 0.5
        || trailingNormal <= trailingRecommended + 0.5
        || !isFinite(trailingMaximum)
        || trailingMaximum + 0.5 < trailingNormal) return 0;
    return trailingNormal;
}

function fitTrailingLogicalThroughAlignTrack(item) {
    var box = directLayoutChildren(item);
    if (!box || !box.querySelectorAll) return 0;
    var labels = collectFieldLabels(box, true);
    if (!labels.length) return 0;
    var glyphWidths = [];
    for (var i = 0; i < labels.length; i++)
        glyphWidths.push(throughAlignGlyphMetric(labels[i]));
    var width = throughAlignTitleTrackWidth(glyphWidths);
    for (var l = 0; l < labels.length; l++) labels[l].style.minWidth = width + 'px';
    return width;
}

function hasFixedHorizontalSize(item) {
    if (!item) return false;
    if (isFalse(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))
        && charSize(prop(item, ['Width', 'Ширина']))) return true;
    for (var i = 0; i < (item.childItems || []).length; i++) {
        var child = item.childItems[i];
        if (!child || isFalse(prop(child, ['Visible', 'visible']))) continue;
        if (hasFixedHorizontalSize(child)) return true;
    }
    return false;
}

function fieldHeight(item) {
    var h = parseInt(prop(item, ['Height', 'Высота']), 10);
    return h > 0 ? h : 0;
}

function tableHeaderRowCount(item) {
    if (isFalse(prop(item, ['Header', 'Шапка']))) return 0;
    var rows = Math.max(1, parseInt(prop(item, ['HeaderHeight']), 10) || 1);
    /* A spanning vertical group lays its stack out over several physical
     * columns; counting its flattened headerKids would overstate the rows. */
    if (tableHasSpanningColumnGroups(item))
        return Math.max(rows, tableHeaderGridLayout(item.childItems).rows);
    var columns = tableColumns(item);
    for (var i = 0; i < columns.length; i++) {
        if (isHeaderGroup(columns[i]) && headerKids(columns[i]).length) rows = Math.max(rows, 2);
        else if (isVerticalColumnGroup(columns[i])) rows = Math.max(rows, headerKids(columns[i]).length || 1);
        else rows = Math.max(rows, parseInt(prop(columns[i], ['HeaderHeight']), 10) || 1);
    }
    return rows;
}

function tableLeafFontHeight(item, specName) {
    var columns = tablePhysicalColumns(item);
    var height = 10;
    for (var i = 0; i < columns.length; i++) {
        var spec = columns[i] && columns[i].properties && columns[i].properties[specName];
        if (spec && parseFloat(spec.height) > 0) height = Math.max(height, parseFloat(spec.height));
    }
    return height;
}

function tableFontRowExtraPx(item, specName) {
    /* The reference's 10pt default row is 30px and a 14pt FontDef row is 40px;
     * interpolate the same 2.5px/pt scale for explicit column fonts. */
    return Math.max(0, Math.round((tableLeafFontHeight(item, specName) - 10) * 2.5));
}

function tableHeightMetrics(item) {
    var rawVariant = String(prop(item, ['HeightControlVariant']) || '').toLowerCase();
    var byContent = rawVariant === 'bycontent' || rawVariant === 'usecontentheight';
    var inRows = rawVariant === 'intablerows' || rawVariant === 'useheightintablerows';
    var directRows = parseInt(prop(item, ['HeightInTableRows', 'ВысотаВСтрокахТаблицы']), 10) || 0;
    var headerRows = tableHeaderRowCount(item);
    var footerRows = isTrue(prop(item, ['Footer', 'Подвал']))
        ? Math.max(1, parseInt(prop(item, ['FooterHeight']), 10) || 1) : 0;
    var bodyExtra = tableFontRowExtraPx(item, 'FontSpec');
    var headerExtra = tableFontRowExtraPx(item, 'TitleFontSpec');
    var footerExtra = tableFontRowExtraPx(item, 'FooterFontSpec');
    if (byContent) {
        /* Empty ByContent tables have a stable compact native band and do not
         * participate in vertical stretch. Runtime data is intentionally not
         * invented by the static preview. */
        return { mode: 'content', preferred: 123, minimum: 123, maximum: 123,
            headerRows: headerRows, footerRows: footerRows, bodyRows: 3,
            bodyRowHeight: 30 + bodyExtra, headerRowHeight: 30 + headerExtra,
            footerRowHeight: 30 + footerExtra, stretch: false };
    }
    var bodyRows = directRows;
    if (inRows) bodyRows = parseInt(prop(item, ['MaxRowsCount']), 10) || directRows || fieldHeight(item) || 8;
    var formRows = fieldHeight(item) || 8;
    var rowMode = inRows || directRows > 0;
    if (rowMode) formRows = bodyRows + headerRows + footerRows;
    var maximumRows = parseInt(prop(item, ['MaxHeight', 'МаксимальнаяВысота']), 10) || 0;
    var explicitMaximum = maximumRows > 0
        && isFalse(prop(item, ['AutoMaxHeight', 'АвтоМаксимальнаяВысота']));
    if (!rowMode && explicitMaximum) formRows = Math.min(formRows, maximumRows);
    var logicalBodyRows = rowMode ? bodyRows : Math.max(0, formRows - headerRows - footerRows);
    var preferred = logicalBodyRows * (30 + bodyExtra)
        + headerRows * (30 + headerExtra) + footerRows * (30 + footerExtra)
        + (headerRows ? 3 + headerRows - 1 : 1) + (footerRows ? footerRows + 1 : 0);
    var minimum;
    if (!headerRows && !footerRows) minimum = Math.min(Math.max(formRows - 1, 0), 3) * 31;
    else {
        var minimumBodyRows = Math.min(Math.max(logicalBodyRows, 1), footerRows ? 5 : 4);
        minimum = bodyExtra
            ? 3 + minimumBodyRows * (30 + bodyExtra)
            : 1 + minimumBodyRows * 31;
        minimum += headerRows * headerExtra + footerRows * footerExtra;
    }
    var maximum = 0;
    if (inRows && parseInt(prop(item, ['MaxRowsCount']), 10) > 0) maximum = preferred;
    else if (!rowMode && explicitMaximum) maximum = preferred;
    return { mode: rowMode ? 'rows' : 'form', preferred: preferred,
        minimum: minimum, maximum: maximum, headerRows: headerRows,
        footerRows: footerRows, bodyRows: logicalBodyRows,
        bodyRowHeight: 30 + bodyExtra, headerRowHeight: 30 + headerExtra,
        footerRowHeight: 30 + footerExtra, stretch: true };
}

function tableAuthoredHeightPx(item) {
    return tableHeightMetrics(item).preferred;
}

function tableCalibratedMinimumHeightPx(item) {
    return tableHeightMetrics(item).minimum;
}

function containsAuthoredHeightTable(item) {
    if (!item || isFalse(prop(item, ['Visible', 'visible']))) return false;
    if (item.tag === 'Table') {
        return parseInt(prop(item, ['HeightInTableRows', 'ВысотаВСтрокахТаблицы']), 10) > 0
            || parseInt(prop(item, ['Height', 'Высота']), 10) > 0;
    }
    for (var i = 0; i < (item.childItems || []).length; i++)
        if (containsAuthoredHeightTable(item.childItems[i])) return true;
    return false;
}

function isPictureLabelDisclosureRow(item) {
    if (!item || !isContainer(item.tag)) return false;
    var rawOrientation = prop(item, ['Group', 'GroupOrientation', 'Orientation', 'Layout',
        'Группировка', 'Ориентация', 'Расположение']);
    var orientation = normOrient(rawOrientation) || defaultContainerOrientation(item.tag);
    var kids = (item.childItems || []).filter(function (entry) {
        return entry && !isFalse(prop(entry, ['Visible', 'visible'])) && !isAdditionTag(entry.tag);
    });
    return orientation === 'horizontal' && kids.length === 2
        && kids[0].tag === 'PictureDecoration' && kids[1].tag === 'LabelField';
}

function pageTableChromeCadenceChildren(item) {
    if (!item || item.tag !== 'Page') return [];
    var kids = (item.childItems || []).filter(function (entry) {
        return entry && !isFalse(prop(entry, ['Visible', 'visible'])) && !isAdditionTag(entry.tag);
    });
    for (var i = 1; i + 1 < kids.length; i++) {
        if (!isPictureLabelDisclosureRow(kids[i - 1])
            || !isPictureLabelDisclosureRow(kids[i + 1])) continue;
        return kids.slice(0, i - 1).filter(containsAuthoredHeightTable);
    }
    return [];
}

var tabbedPageAncestorCache = typeof WeakMap === 'function' ? new WeakMap() : null;

/* True when a Page of a tabbed (non-None) Pages is an ancestor of item. */
function nestedInTabbedPage(item, ctx) {
    var model = ctx && ctx.model;
    if (!item || !model || !tabbedPageAncestorCache) return false;
    var cached = tabbedPageAncestorCache.get(model);
    if (!cached) {
        cached = typeof WeakSet === 'function' ? new WeakSet() : null;
        if (!cached) return false;
        var walk = function (node, insideTabbedPage) {
            var kids = node && node.childItems;
            if (!kids) return;
            for (var i = 0; i < kids.length; i++) {
                var kid = kids[i];
                if (!kid || typeof kid !== 'object') continue;
                if (insideTabbedPage) cached.add(kid);
                var enters = kid.tag === 'Page' && node.tag === 'Pages' && pagesRep(node) !== 'none';
                walk(kid, insideTabbedPage || enters);
            }
        };
        walk({ tag: '', childItems: model.childItemsRoot || model.childItems || [] }, false);
        tabbedPageAncestorCache.set(model, cached);
    }
    return cached.has(item);
}

function wantsVStretch(item, tag, ctx, ignoreOwnStretch) {
    var vs = prop(item, ['VerticalStretch']);
    if (isFalse(vs)) return false;
    if (tag === 'Table') return tableHeightMetrics(item).stretch;
    if (tag === 'SpreadSheetDocumentField') return true;
    /* Document fields fill the window unless sized: Height=1/5 fields keep
     * their size; a formatted document field fills too. */
    if (tag === 'HTMLDocumentField' || tag === 'TextDocumentField' || tag === 'FormattedDocumentField')
        return isTrue(vs) || !(fieldHeight(item) > 0);
    if (tag === 'Pages' &&pagesRep(item) !== 'none') {
        /* The default stretch of a tabbed Pages belongs to the outermost tab
         * set. A tab set nested in a page of another tab set stays at content
         * height unless it opts in explicitly: the reference paints the inner
         * Pages down to its last row while the outer Pages fills the window. */
        return isTrue(vs) || !nestedInTabbedPage(item, ctx);
    }
    if (tag === 'InputField') {
        if (fieldHeight(item) > 0) return false;
        if (isTrue(vs)) return true;
        /* A finite MaxHeight makes an otherwise multiline field content-sized.
         * It may grow up to that cap, but it does not request all remaining
         * form height and must not turn its wrapper/footer into a flex filler. */
        if (charHeight(prop(item, ['MaxHeight', 'МаксимальнаяВысота']))) return false;
        return isMultilineField(item, ctx);
    }
    /* Transparent wrapper groups and PagesRepresentation=None do not stop a
     * stretching control. Propagate its request so the nearest root column
     * gives that subtree only the remaining height, leaving later siblings
     * such as a footer visible. */
    if (isContainer(tag) && item && item.childItems) {
        var stretchChildren = item.childItems;
        var horizontal = layoutMeta(item).orientation === 'horizontal';
        /* Only the active page participates in layout. Looking through every
         * hidden alternative made an unrelated spreadsheet or text area turn
         * the visible compact page into a flex-filling panel. */
        if (tag === 'Pages') {
            var pages = item.childItems.filter(function (it) { return it && it.tag === 'Page'; });
            var activeId = activePageIdByPagesKey[itemKey(item)];
            var activePage = null;
            for (var p = 0; p < pages.length; p++) {
                if (activeId && itemKey(pages[p]) === activeId) { activePage = pages[p]; break; }
            }
            activePage = activePage || pages[0] || null;
            /* A hidden page with both an authored normal Height and explicit
             * VerticalStretch contributes a real growable band to its parent.
             * This is the preview-pane splitter pattern: the height is its
             * basis and the explicit flag opts the pane into surplus sharing. */
            if (pagesRep(item) === 'none' && activePage
                && isTrue(prop(activePage, ['VerticalStretch']))
                && parseInt(prop(activePage, ['Height', 'Высота']), 10) > 0) return true;
            /* With hidden tabs the page is only a local layout layer. Its own
             * VerticalStretch fills the already allocated Pages box, but must
             * not make a compact ancestor (for example a totals footer) claim
             * the form's remaining height. Real height-hungry page content,
             * such as a table or spreadsheet, still propagates through. */
            stretchChildren = pagesRep(item) === 'none' && activePage
                ? (activePage.childItems || [])
                : (activePage ? [activePage] : []);
        }
        for (var i = 0; i < stretchChildren.length; i++) {
            var child = stretchChildren[i];
            if (!child || isFalse(prop(child, ['Visible', 'visible']))) continue;
            var childTag = child.tag || '';
            /* In a horizontal row VerticalStretch on a wrapper group is a
             * cross-axis request: it fills the row's already allocated height,
             * but must not make the row claim the form's remaining height.
             * Ignore only the wrapper's own flag and still inspect its content,
             * so a table or multiline field nested in it can remain genuinely
             * height-hungry. */
            var crossAxisWrapper = horizontal && isContainer(childTag)
                && childTag !== 'Table' && childTag !== 'Pages';
            if (wantsVStretch(child, childTag, ctx, crossAxisWrapper)) return true;
        }
    }
    if (!ignoreOwnStretch && isTrue(vs)) return true;
    return false;
}

/* 1C font heights are points over a 9pt base, and the mockup's base is 12px. */
var FONT_BASE_PT = 9;
var FONT_BASE_PX = 12;

/* A StyleItem font is a name, not a value: the style table is not in Form.xml,
 * so only the traits the name states outright are honoured - the same way
 * BackColor/TextColor style names are matched. Explicit attributes always win. */
function fontCss(spec) {
    if (!spec) return null;
    var css = {};
    var ref = String(spec.ref || '');
    var bold = spec.bold;
    if (bold == null && /bold|важн|жирн/i.test(ref)) bold = true;
    if (bold != null) css.fontWeight = bold ? '700' : '400';
    var italic = spec.italic;
    if (italic == null && /italic|курсив/i.test(ref)) italic = true;
    if (italic != null) css.fontStyle = italic ? 'italic' : 'normal';
    var deco = [];
    if (spec.underline || (spec.underline == null && /underline|подчерк/i.test(ref))) deco.push('underline');
    if (spec.strikeout) deco.push('line-through');
    if (deco.length) css.textDecoration = deco.join(' ');
    var px = 0;
    if (spec.height > 0) px = spec.height * (FONT_BASE_PX / FONT_BASE_PT);
    /* ExtraLargeTextFont is an 18pt Taxi display caption. Match it before
     * the generic Large style instead of collapsing both to 15px. */
    else if (/extralarge|сверхкрупн/i.test(ref)) px = FONT_BASE_PX * 2;
    else if (/large|крупн/i.test(ref)) px = FONT_BASE_PX * 1.5;
    else if (/small|мелк/i.test(ref)) px = FONT_BASE_PX * 0.85;
    if (spec.scale > 0 && spec.scale !== 100) px = (px || FONT_BASE_PX) * (spec.scale / 100);
    /* A GDI font height is a whole pixel, round(pt * 96 / 72).
     * Fractional sizes (10pt = 13.3px) wrap captions 1C keeps on one line. */
    if (px > 0) css.fontSize = Math.max(7, Math.min(48, Math.round(px))) + 'px';
    if (spec.faceName) css.fontFamily = spec.faceName + ', Arial, sans-serif';
    for (var k in css) { if (Object.prototype.hasOwnProperty.call(css, k)) return css; }
    return null;
}

/* Reference Label line heights by font px:
 * 8pt 11→13, 9pt 12→15, 10pt 13→16, 11pt 15→17, 12pt 16→18, 14pt 19→22. */
var REF_LABEL_LINE_HEIGHTS = { 11: 13, 12: 15, 13: 16, 15: 17, 16: 18, 19: 22 };
function refLabelLineHeightPx(px) {
    var size = Math.round(Number(px) || 0);
    return REF_LABEL_LINE_HEIGHTS[size] || Math.round(size * 1.2);
}

function setFontCss(node, css) {
    if (!node || !css) return;
    for (var k in css) {
        if (Object.prototype.hasOwnProperty.call(css, k)) node.style[k] = css[k];
    }
}

/* Font styles the element's own text, TitleFont its caption. A LabelField
 * shows no value in the preview, so its Font lands on the caption we do draw -
 * otherwise bold "итого"-style labels would go flat. */
function applyFonts(div, item, tag) {
    var props = item && item.properties;
    if (!props) return;
    var body = fontCss(props.FontSpec);
    var title = fontCss(props.TitleFontSpec);
    if (props.FontSpec && /(?:^|:)LargeTextFont$/i.test(String(props.FontSpec.ref || '')))
        div.classList.add('fp-large-text-font');
    if (body) {
        var targets = div.querySelectorAll('.fp-label-decoration, .fp-input, .fp-btn-text, .fp-fallback-label');
        if (targets.length) {
            for (var i = 0; i < targets.length; i++) {
                setFontCss(targets[i], body);
                if (body.fontSize && targets[i].classList.contains('fp-label-decoration'))
                    targets[i].style.lineHeight = refLabelLineHeightPx(parseFloat(body.fontSize)) + 'px';
            }
        } else {
            /* A LabelField's Font is its value's; the caption keeps TitleFont
             * (a regular caption beside a bold value). */
            var one = div.querySelector('.fp-button, .fp-link, .fp-group-title, .fp-collapse-text')
                || (tag === 'LabelField' ? div.querySelector('.fp-labelfield-value') : null);
            setFontCss(one || div, body);
        }
        if (props.FontSpec && props.FontSpec.height > 0) {
            var fontWrap = div.querySelector('.fp-control-wrap');
            var fontPx = parseFloat(body.fontSize || '0');
            if (fontWrap && fontPx > 0) fontWrap.style.minHeight = Math.ceil(fontPx) + 'px';
        }
    }
    if (title) {
        var labels = div.querySelectorAll('.fp-field-label, .fp-group-title, .fp-collapse-text, .fp-popup-group-title');
        for (var j = 0; j < labels.length; j++) {
            setFontCss(labels[j], title);
            /* A group caption is a platform Label row: its font's line height
             * (TitleFont 8pt bold: 13 px + 4 px padding). */
            if (title.fontSize && labels[j].classList.contains('fp-group-title'))
                labels[j].style.lineHeight = refLabelLineHeightPx(parseFloat(title.fontSize)) + 'px';
        }
    }
}

function isTumbler(raw) {
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    return v.indexOf('tumbler') >= 0 || v.indexOf('switcher') >= 0 || v.indexOf('тумблер') >= 0;
}

function normPictureSize(raw) {
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!v) return '';
    if (v.indexOf('stretch') >= 0 || v.indexOf('растяг') >= 0) return 'stretch';
    if (v.indexOf('proportion') >= 0 || v.indexOf('пропорц') >= 0) return 'proportionally';
    if (v.indexOf('byfontsize') >= 0 || v.indexOf('поразмеру') >= 0) return 'byfontsize';
    if (v.indexOf('autosize') >= 0 || v.indexOf('авто') >= 0) return 'autosize';
    if (v.indexOf('real') >= 0 || v.indexOf('реальн') >= 0) return 'realsize';
    return '';
}

/* Only absolute colours can be drawn as-is; style names keep going through the
 * existing keyword matching, which is all Form.xml gives us. */
function absoluteColor(raw) {
    var v = String(raw || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(v) || /^#[0-9a-f]{6}$/i.test(v)) return v;
    if (/^web:[a-z]+$/i.test(v)) return v.slice(4);
    var rgb = v.match(/^(\d{1,3})\s*[,;]\s*(\d{1,3})\s*[,;]\s*(\d{1,3})$/);
    if (rgb) return 'rgb(' + rgb[1] + ',' + rgb[2] + ',' + rgb[3] + ')';
    return '';
}

/* 1C spells the `style:` prefix in either case, and the host that collected
 * the StyleItems files keys them by the name as written in its own file. Match
 * the name, not its spelling, or a `Style:Имя` reference silently loses its
 * colour while an identical `style:Имя` resolves. */
function styleItemLookup(styleItems, name) {
    if (!styleItems || !name) return '';
    if (Object.prototype.hasOwnProperty.call(styleItems, name)) return styleItems[name];
    var lower = String(name).toLowerCase();
    for (var key in styleItems) {
        if (Object.prototype.hasOwnProperty.call(styleItems, key) && key.toLowerCase() === lower)
            return styleItems[key];
    }
    return '';
}

/* Stable platform style identifiers belong to the Taxi palette even when a
 * configuration does not serialize a matching cf/StyleItems descriptor.
 * Keep this registry separate from configuration styles: an explicitly
 * supplied StyleItem is still the authoritative override, while unknown
 * platform-looking names remain unresolved instead of being guessed. */
var TAXI_PLATFORM_STYLE_COLORS = {
    tableheaderbackcolor: '#f5f5f5',
    specialtextcolor: '#ff0000',
    accentcolor: '#009646',
    auxiliarynavigationcolor: '#ffffd9',
    tablefooterbackcolor: '#fafafa',
    /* Caption ink in the reference: #4d4d4d. */
    buttontextcolor: '#4d4d4d'
};

function styleItemColor(raw, styleItems, seen) {
    var original = String(raw || '');
    var name = original.replace(/^style:/i, '');
    /* One style item may point at another, and the chain can close on itself
     * after any number of hops. Following it blindly overflowed the stack and
     * took the whole form preview down with it, so remember every name already
     * visited instead of only comparing against the immediate caller. */
    var visited = seen || Object.create(null);
    var visitKey = name.toLowerCase();
    if (visited[visitKey]) return '';
    visited[visitKey] = true;
    var configured = styleItemLookup(styleItems, name);
    if (configured) {
        var absolute = absoluteColor(configured);
        if (absolute) return absolute;
        if (/^web:[a-z]+$/i.test(configured)) return configured.slice(4);
        if (/^style:/i.test(configured)) return styleItemColor(configured, styleItems, visited);
    }
    /* Platform style names are stable API identifiers. Their light Taxi
     * palette is the only built-in mapping; configuration-owned names are
     * resolved from cf/StyleItems instead of guessed from their spelling. */
    return TAXI_PLATFORM_STYLE_COLORS[visitKey] || '';
}

function colorRgb(raw) {
    var color = absoluteColor(raw);
    var hex = color.match(/^#([0-9a-f]{6})$/i);
    if (hex) return [
        parseInt(hex[1].slice(0, 2), 16),
        parseInt(hex[1].slice(2, 4), 16),
        parseInt(hex[1].slice(4, 6), 16)
    ];
    var rgb = color.match(/^rgb\((\d+),(\d+),(\d+)\)$/i);
    return rgb ? [parseInt(rgb[1], 10), parseInt(rgb[2], 10), parseInt(rgb[3], 10)] : null;
}

function mixRgb(rgb, target, amount) {
    return 'rgb(' + rgb.map(function (value, i) {
        return Math.round(value + (target[i] - value) * amount);
    }).join(',') + ')';
}

function buttonColorGradient(raw) {
    var rgb = colorRgb(raw);
    if (!rgb) return '';
    var base = 'rgb(' + rgb.join(',') + ')';
    return 'linear-gradient(180deg, ' + mixRgb(rgb, [255, 255, 255], 2 / 15)
        + ' 0%, ' + base + ' 46%, ' + mixRgb(rgb, [0, 0, 0], 0.05) + ' 100%)';
}

function tooltipRepresentation(item) {
    var v = String(prop(item, ['ToolTipRepresentation', 'ОтображениеПодсказки']) || '')
        .toLowerCase().replace(/[\s_-]+/g, '');
    /* ShowAuto shows the text on the form with an automatic position, which
     * is below the item. */
    if (v === 'showauto' || v.indexOf('отображатьавто') >= 0) return 'bottom';
    if (!v || v === 'auto' || v.indexOf('авто') >= 0) return 'auto';
    if (v === 'none' || v.indexOf('нет') >= 0) return 'none';
    if (v.indexOf('button') >= 0 || v.indexOf('кнопк') >= 0) return 'button';
    if (v.indexOf('bottom') >= 0 || v.indexOf('снизу') >= 0) return 'bottom';
    if (v.indexOf('top') >= 0 || v.indexOf('сверху') >= 0) return 'top';
    if (v.indexOf('right') >= 0 || v.indexOf('справа') >= 0) return 'right';
    if (v.indexOf('left') >= 0 || v.indexOf('слева') >= 0) return 'left';
    if (v.indexOf('balloon') >= 0 || v.indexOf('облак') >= 0) return 'balloon';
    return 'auto';
}

function applyPageTooltip(container, page) {
    var rep = tooltipRepresentation(page);
    if (rep !== 'top' && rep !== 'bottom') return;
    var text = tooltipText(page);
    if (!text || !container) return;
    var note = el('div', 'fp-tooltip-text fp-page-tooltip fp-tooltip-' + rep, text);
    if (rep === 'top') container.insertBefore(note, container.firstChild);
    else container.appendChild(note);
}

function tooltipText(item) {
    if (!item) return '';
    var tip = item.extendedTooltip ? rawTitle(item.extendedTooltip) : '';
    if (tip) return plainFormattedText(tip);
    return plainFormattedText(prop(item, ['ToolTip', 'Подсказка']));
}

/* ShowBottom / ShowTop / ShowLeft / ShowRight put the extended tooltip on the
 * form as grey text; Button puts a link-like "?" next to the control, matching
 * the thin blue help marker used by Configurator. Anything else stays a hover
 * title, which is what 1C does too. */
function applyTooltip(div, item, inBar) {
    var text = tooltipText(item);
    var rep = tooltipRepresentation(item);
    /* The designer paints the «?» marker for Button even when the tooltip
     * text lives only on the command («Подробно ?»). */
    if (!text && !(rep === 'button' && !inBar && item && (item.tag === 'Button' || item.tag === 'Hyperlink')))
        return;
    if (rep === 'none') return;
    /* Inside a command bar 1C only ever shows the tooltip on hover, whatever
     * the representation says - a text line there would break the bar. */
    if (inBar || rep === 'auto' || rep === 'balloon') {
        div.title = div.title && div.title !== text ? div.title + '\n' + text : text;
        return;
    }
    if (rep === 'button') {
        var link = el('span', 'fp-tooltip-link', '?');
        link.title = text;
        div.appendChild(link);
        div.classList.add('fp-has-tooltip-link');
        return;
    }
    var note = el('span', 'fp-tooltip-text fp-tooltip-' + rep, text);
    if (rep === 'top' || rep === 'left') div.insertBefore(note, div.firstChild);
    else div.appendChild(note);
    div.classList.add('fp-tooltip-side-' + (rep === 'left' || rep === 'right' ? 'h' : 'v'));
}

/* A borderless, coloured AlwaysHorizontal row made only from text
 * decorations is the managed client's notification band. Its background
 * owns a real 5/6 px inset; treating the row as a transparent label wrapper
 * collapses the band to the glyph height and shifts every following root
 * item. */
function isCompactColorBand(item) {
    if (!item || !isContainer(item.tag || '') || !prop(item, ['BackColor', 'ЦветФона'])) return false;
    if (representationOf(item) !== 'none') return false;
    if (normGroupMode(prop(item, ['Group', 'GroupOrientation', 'Orientation', 'Layout'])) !== 'always-horizontal')
        return false;
    var children = (item.childItems || []).filter(function (child) {
        return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
    });
    return children.length > 0 && children.every(function (child) {
        return child.tag === 'LabelDecoration';
    });
}

var COMPACT_LIST_COLUMN_WIDTH = 64;

function isCompactHeaderlessListGroup(item, parentH) {
    if (!item || !parentH || !isContainer(item.tag || '')) return false;
    var visible = (item.childItems || []).filter(function (child) {
        return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
    });
    if (visible.length !== 1 || visible[0].tag !== 'Table') return false;
    var table = visible[0];
    if (!/^list$/i.test(String(prop(table, ['Representation']) || ''))) return false;
    if (!isFalse(prop(table, ['Header']))) return false;
    return true;
}

function detachedLogicalColumnHeightIsAdvisory(item, parentMeta, verticalStretch) {
    return !!(item && parentMeta && parentMeta.orientation === 'horizontal'
        && representationOf(item) === 'none'
        && isFalse(prop(item, ['United', 'Объединенная'])) && !verticalStretch);
}

function isTrailingVisibleChild(item, parentItem) {
    var kids = visibleLayoutChildren(parentItem);
    return !!(kids.length && kids[kids.length - 1] === item);
}

function applyItemMetrics(div, item, tag, parentMeta, ctx, parentItem) {
    if (!div || !item) return;
    var hs = prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']);
    var w = charSize(prop(item, ['Width', 'Ширина']));
    /* A LabelField value lane is on the reference char-unit ruler (Width 12 -> 130,
     * which also places the controls after it); the 8px grid left it 34px
     * short. */
    if (w && tag === 'LabelField') w = authoredFieldWidthPx(prop(item, ['Width', 'Ширина']), tag);
    var compactQualifiedWidth = compactQualifiedSingleFieldWidth(item, tag, parentMeta, ctx);
    if (!w && compactQualifiedWidth) {
        w = compactQualifiedWidth;
        div.classList.add('fp-compact-qualified-field');
    }
    var mw = charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']));
    var dateTimeMinimum = tag === 'InputField'
        && fieldKind(item, ctx) === 'date'
        && String(metaDateFraction(item, ctx)).toLowerCase() === 'datetime'
        ? defaultFieldChars(item, ctx) * CHAR_PX + 20 : 0;
    if (w && dateTimeMinimum) w = Math.max(w, dateTimeMinimum);
    if (mw && dateTimeMinimum) mw = Math.max(mw, dateTimeMinimum);
    var autoMaxWidthFalse = isFalse(prop(item, ['AutoMaxWidth']));
    var maxWidthChars = parseInt(prop(item, ['MaxWidth', 'МаксимальнаяШирина']), 10) || 0;
    if (maxWidthChars > 0
        && (tag === 'InputField' || tag === 'LabelField' || tag === 'ValueList')) {
        /* The painted editor and allocator use the same reference ruler. With Width
         * present the cap stayed on the 8px grid (MaxWidth 10 -> 80) while
         * dimensionBands published 110, so a stretched ReadOnly total
         * stopped 30px short of the reference's TextBox maximum. */
        mw = w ? Math.max(authoredFieldWidthPx(maxWidthChars, tag), dateTimeMinimum)
            : autoMaxEditorBandWidth(maxWidthChars);
    }
    /* A decoration-titled value stretches only to its type's presentation
     * band: a catalog with DescriptionLength 120 ends at 40 chars, 410px, in
     * the reference, not at the row edge. The 15-char ref default is the
     * initial width, not this cap. */
    if (!w && tag === 'InputField' && parentMeta && parentMeta.inputThenLabelField
        && isFalse(prop(item, ['AutoMaxWidth'])) && !charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина']))) {
        var rowButtons = defaultWidthClampsButtons(item, ctx) ? 0 : inputButtonKinds(item, ctx).length;
        w = authoredEditorPaintWidth(defaultCharsOf(typeInfoFromItem(item, ctx).types, typeInfoFromItem(item, ctx)),
            tag, rowButtons);
    }
    if (!mw && tag === 'InputField' && verticalSelectBandStretch(item, tag, parentMeta))
        mw = autoMaxEditorBandWidth(TYPE_DEFAULT_MAX_CHARS);
    if (!mw && !w && tag === 'InputField' && parentMeta
        && (parentMeta.decorationTitledField || vertBandStretch(item, tag, parentMeta, ctx))) {
        var capInfo = typeInfoFromItem(item, ctx);
        capInfo.uncappedRef = true;
        mw = autoMaxEditorBandWidth(Math.min(presentationLengthOf(capInfo.types, capInfo), TYPE_DEFAULT_MAX_CHARS));
    }
    /* Group*Align positions the element in its parent. HorizontalAlign and
     * VerticalAlign belong to the value inside a field/decoration and must not
     * move the entire control. */
    var ha = String(prop(item, ['GroupHorizontalAlign',
        'ГоризонтальноеПоложениеВГруппе']) || '').toLowerCase();
    if (!ha && (tag === 'CommandBar' || tag === 'AutoCommandBar'))
        ha = String(prop(item, ['HorizontalLocation', 'ГоризонтальноеПоложение']) || '').toLowerCase();
    /* A button is already inside the CommandBar's ordered lane. Its group
     * alignment must not become an auto margin between sibling commands: that
     * creates unmeasurable left overflow and defeats the More calculation. */
    if (parentMeta && (parentMeta.tag === 'CommandBar' || parentMeta.tag === 'AutoCommandBar')) ha = '';
    var va = String(prop(item, ['GroupVerticalAlign',
        'ВертикальноеПоложениеВГруппе']) || '').toLowerCase();
    var bands = dimensionBands(item, tag, parentMeta, ctx);
    if (parentMeta && parentMeta.compoundSelectorChildren
        && parentMeta.compoundSelectorChildren.indexOf(item) >= 0)
        div.classList.add('fp-compound-selector-track');
    var stretch = bands.horizontal.stretch;
    var vstretch = bands.vertical.stretch;
    var widthChars = parseInt(prop(item, ['Width', 'Ширина']), 10);
    if (div.dataset && !isNaN(widthChars) && widthChars > 0)
        div.dataset.fpAuthoredWidthPresent = '1';
    if (div.dataset && !isNaN(widthChars) && widthChars > 0)
        div.dataset.fpAuthoredDecisionWidth = String(fixedShortEditorWidth(item, tag, ctx)
            || widthChars * REF_AUTHORED_CHAR_PX);
    if (div.dataset && bands.horizontal.normal > 0) {
        div.dataset.fpAuthoredNormalWidth = String(bands.horizontal.normal);
        div.dataset.fpAuthoredRecommendedWidth = String(bands.horizontal.recommended || bands.horizontal.normal);
        div.dataset.fpWidthBandMin = String(bands.horizontal.min);
        div.dataset.fpWidthBandMax = isFinite(bands.horizontal.max)
            ? String(bands.horizontal.max) : '';
        div.dataset.fpWidthStretch = bands.horizontal.stretch ? '1' : '0';
        div.dataset.fpWidthStretchPriority = bands.horizontal.stretchPriority ? '1' : '0';
        div.dataset.fpWidthCompressPriority = bands.horizontal.compressPriority ? '1' : '0';
        var fixedShortWidth = fixedShortEditorWidth(item, tag, ctx);
        var declaredWidth = fixedShortWidth || authoredFieldWidthPx(prop(item, ['Width', 'Ширина']), tag);
        if (declaredWidth) div.dataset.fpDeclaredWidthBand = String(declaredWidth);
        if (fixedShortWidth) div.dataset.fpDeclaredIncludesButtons = '1';
    }
    if (div.dataset && isFalse(hs)) div.dataset.fpAuthoredFixedWidth = '1';
    if (tag === 'InputField' && !stretch && widthChars > 0) {
        var widthFieldKind = fieldKind(item, ctx);
        if (widthFieldKind === 'number') w = widthChars * 11;
        else if (widthFieldKind === 'date')
            /* Calendar chrome must not discard an authored Width: a string with a
             * calendar picture and Width=13 paints 162px. Treating it as a
             * DateTime floor left the editor at 129. */
            w = Math.max(w || 0, widthChars * REF_AUTHORED_CHAR_PX + 10);
        else if (widthChars >= 20 || isFalse(prop(item, ['AutoMaxWidth'])))
            w = widthChars * REF_AUTHORED_CHAR_PX + 10;
        else if (fixedShortEditorWidth(item, tag, ctx))
            w = fixedShortEditorWidth(item, tag, ctx);
    }
    if (tag === 'InputField' && !stretch && w
        && isTrue(prop(item, ['SpinButton', 'КнопкаРегулирования']))) w += 25;
    var parentH = parentMeta && parentMeta.orientation === 'horizontal';
    /* Compact controls stay content-sized even if metadata happens to carry a
     * stretch flag. The deliberate exceptions are an empty LabelDecoration,
     * which configurator-generated forms use as a flexible layout spacer (for
     * example before a right-aligned document total), and a LabelField whose
     * width cap the form has lifted - it absorbs the free width of its row. */
    var emptyStretchSpacer = (tag === 'LabelDecoration' && isTrue(hs)
        && !displayLabel(item, ctx, tag))
        || (tag === 'LabelField' && stretch && parentH);
    if ((compactTag(tag) && !emptyStretchSpacer) || !stretch) {
        /* A fixed-width descendant fixes only that control, not every wrapper
         * group above it. Treating it as a recursive lock made a whole header
         * column unshrinkable and starved its neighbouring status column. */
        /* A right-located command lane is a trailing cluster, not a column
         * that yields room. Letting it compress drives a feedback loop:
         * min-width 0 collapses the lane to 2 px, its icons paint
         * outside the box, the inflated row measurement pins the sibling
         * lane through caption-promotion overflow, and the squeeze deepens. */
        var isTrailingCommandLane = (tag === 'CommandBar' || tag === 'AutoCommandBar')
            && (ha.indexOf('right') >= 0 || ha.indexOf('прав') >= 0);
        var canCompressInRow = parentH && !compactTag(tag) && !isFalse(hs)
            && !isTrailingCommandLane;
        /* A fixed descendant gives its column a stronger preferred width, but
         * does not make the entire wrapper rigid. This mirrors 1C's header
         * layout: the Number field stays fixed while its left column yields a
         * little room to the status column. */
        var shrinkFactor = isContainer(tag) && hasFixedHorizontalSize(item) ? 0.25 : 1;
        div.style.flex = canCompressInRow ? ('0 ' + shrinkFactor + ' auto') : '0 0 auto';
        if (canCompressInRow) {
            /* Wrapper columns may shrink, but not below the intrinsic minimum
             * of their visible controls. This keeps adjacent buttons/fields
             * from painting over one another while still allowing the whole
             * three-column header to stay on one line. */
            div.style.minWidth = '0';
        }
        div.classList.add('fp-no-hstretch');
    } else {
        div.classList.add('fp-hstretch');
        if (parentH && splitterPane(item, ctx) && ownHorizontalStretch(item, tag, parentMeta, ctx))
            div.classList.add('fp-splitter-pane');
        /* Stretching siblings are the safest place to absorb a narrow
         * viewport. A slightly larger shrink factor preserves compact command
         * clusters in neighbouring columns without forcing a line wrap. */
        div.style.flex = parentH
            ? (isContainer(tag) && parentMeta && parentMeta.hasLargeFixedWidthChild ? '1 1 0' : '1 1.7 auto')
            : '0 0 auto';
        /* An unbounded min-content floor makes wide standard document headers
         * overflow, while a zero floor can crush a narrow status/FEO column
         * until its checkbox caption paints outside the form. Keep a small,
         * bounded control-sized floor and let wider columns absorb the rest. */
        if (parentH && isContainer(tag)) div.style.minWidth = 'min(128px, 100%)';
    }
    /* A stretching LabelField keeps its grid column growable: MaxWidth 33 gets
     * a 503px column, so the trailing hyperlink and button still reach the
     * right edge. */
    /* With the default AutoMaxWidth a MaxWidth is a cap as well: the next
     * field follows a MaxWidth 27 editor directly. */
    if (parentH && (autoMaxWidthFalse || tag === 'InputField') && mw && !w
        && (tag === 'InputField' || tag === 'ValueList'
            || (tag === 'LabelField' && !div.classList.contains('fp-hstretch')))) {
        /* MaxWidth still caps the layout slot when HorizontalStretch=true.
         * Growing only the transparent item wrapper leaves a large blank gap
         * before the next control (e.g. an OKPO/OGRN row). */
        div.style.flex = '0 1 auto';
        /* An empty data LabelField still occupies its MaxWidth band in the reference:
         * MaxWidth 28 keeps 280px before the following labels. */
        if (tag === 'LabelField' && !div.classList.contains('fp-hstretch')
            && prop(item, ['DataPath']) && maxWidthChars > 0)
            div.style.width = (maxWidthChars * REF_AUTHORED_CHAR_PX) + 'px';
    }
    if (vstretch) {
        var multilineEditor = tag === 'InputField' && isMultilineField(item, ctx);
        /* A text area never shrinks below its platform three-line box; the
         * form scrolls instead. */
        div.style.minHeight = '0';
        div.classList.add('fp-vstretch');
        if (multilineEditor) div.classList.add('fp-multiline-floor');
        if (div.dataset && multilineEditor)
            div.dataset.fpVerticalNormalHeight = '77';
        /* VerticalStretch works along the parent's vertical axis. In a
         * horizontal group it is a cross-axis stretch and must not turn into
         * horizontal flex-grow (a vertically stretched label would otherwise
         * consume the free width next to an input field). */
        if (parentH) div.style.alignSelf = 'stretch';
        else div.style.flex = '1 1 auto';
    }
    if (parentMeta && parentMeta.tableChromeCadenceChildren
        && parentMeta.tableChromeCadenceChildren.indexOf(item) >= 0)
        div.classList.add('fp-page-table-chrome-cadence');
    if (isCompactHeaderlessListGroup(item, parentH)) {
        /* A columnless List publishes the native compressed minimum of six
         * authored form units. Its enclosing titled group may be stretchable,
         * yet the reference gives the useful width to the neighbouring detail page. */
        div.classList.add('fp-compact-list-group');
        div.style.flex = '0 1 64px';
        div.style.width = '64px';
        div.style.minWidth = '60px';
        div.style.maxWidth = '64px';
    }
    if (isContainer(tag) && parentMeta && parentMeta.tag === 'Form'
        && representationOf(item) === 'none') {
        var compactTopChildren = (item.childItems || []).filter(function (child) {
            return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
        });
        var compactTopInput = compactTopChildren.filter(function (child) { return child.tag === 'InputField'; });
        var compactTopNote = compactTopChildren.filter(function (child) {
            return child.tag === 'LabelDecoration'
                && (!displayLabel(child, ctx, child.tag)
                    || charSize(prop(child, ['MaxWidth', 'МаксимальнаяШирина'])));
        });
        if (compactTopChildren.length === 2 && compactTopInput.length === 1 && compactTopNote.length === 1
            && compactTopChildren[0].tag === 'InputField'
            && compactTopChildren[1].tag === 'LabelDecoration') {
            div.style.width = '512px';
            div.style.maxWidth = '100%';
            div.style.minWidth = '0';
            div.style.flex = '0 1 512px';
        }
    }
    if (isContainer(tag) && tag !== 'Table' && tag !== 'Pages') {
        var groupWidth = parseInt(prop(item, ['Width', 'Ширина']), 10);
        var groupHeight = parseInt(prop(item, ['Height', 'Высота']), 10);
        if (groupWidth > 0) {
            div.classList.add('fp-sized-width');
            var groupWidthPx = groupWidth * GROUP_COL_PX;
            div.style.setProperty('--fp-authored-group-width', groupWidthPx + 'px');
            /* Width is the authored size of the group. 1C keeps it as a floor
             * and gives the window a scrollbar instead of squeezing the group
             * below it, so the floor belongs in both branches. */
            div.style.minWidth = groupWidthPx + 'px';
            /* Width is fixed only when stretching is explicitly disabled (or
             * no descendant requests it). Otherwise it is the flex basis: a
             * pair of Width=32 cards can evenly fill a Width=67 row. */
            if (stretch) {
                if (parentH) div.style.flex = '1 1 ' + groupWidthPx + 'px';
            } else if (isFalse(hs)) {
                div.style.width = groupWidthPx + 'px';
                /* flex addresses the parent main axis. In a vertical parent
                 * that axis is height, so pinning it here would cancel the
                 * vertical stretch applied above; the explicit width already
                 * fixes the horizontal size. */
                if (parentH) div.style.flex = '0 0 auto';
            } else if (parentH) {
                /* An authored group Width is a preferred/minimum layout band.
                 * Only explicit HorizontalStretch=false fixes the outer box;
                 * otherwise intrinsic row content may grow beyond the band. */
                div.style.flex = '0 1 auto';
            }
        }
        if (groupHeight > 0) {
            div.classList.add('fp-sized-height');
            var groupHeightPx = groupHeight * GROUP_ROW_PX;
            var detachedLogicalColumn = detachedLogicalColumnHeightIsAdvisory(
                item, parentMeta, vstretch);
            if (!detachedLogicalColumn) {
                div.style.minHeight = groupHeightPx + 'px';
                /* Height is a band, not permission to clip a native control
                 * row whose intrinsic box is taller than one group unit. */
                /* A titled ordinary group grows past its Height when its rows need
                 * more: a Height 6 group holding three label rows pushes the
                 * next group down in the reference instead of letting its
                 * content run into the next title. */
                if (!vstretch && !authoredContainerHeightUsesIntrinsicFloor(item)
                    && !(item.tag === 'UsualGroup' && showGroupTitle(item)))
                    div.style.height = groupHeightPx + 'px';
            }
        }
    }
    if (tag === 'HTMLDocumentField') {
        var htmlSize = htmlDocumentAuthoredSize(item);
        if (htmlSize.width && isFalse(hs)) {
            div.style.width = htmlSize.width + 'px';
            div.style.minWidth = htmlSize.width + 'px';
            div.style.maxWidth = htmlSize.width + 'px';
        }
        if (htmlSize.height && !vstretch) {
            div.style.height = htmlSize.height + 'px';
            div.style.minHeight = htmlSize.height + 'px';
            div.style.maxHeight = htmlSize.height + 'px';
        }
    }
    if (tag === 'ChartField') {
        var chartSize = chartAuthoredSize(item);
        if (chartSize.width && isFalse(hs)) {
            div.style.width = chartSize.width + 'px';
            div.style.minWidth = chartSize.width + 'px';
            div.style.maxWidth = chartSize.width + 'px';
        }
        if (chartSize.maxHeight) {
            div.style.maxHeight = chartSize.maxHeight + 'px';
            div.dataset.fpChartMaxHeight = String(chartSize.maxHeight);
        }
        if (chartSize.height && !vstretch) {
            div.style.height = chartSize.height + 'px';
            div.style.minHeight = chartSize.height + 'px';
        } else if (chartSize.maxHeight && !vstretch) {
            div.classList.add('fp-chart-fill-remaining');
        }
    }
    if (tag === 'Pages' && pagesRep(item) === 'none') {
        div.classList.add('fp-pages-none');
        if (widthChars > 0 && isFalse(hs)) {
            var flattenedPagesWidth = authoredFieldWidthPx(widthChars, 'Pages');
            div.classList.add('fp-sized-width');
            div.style.width = flattenedPagesWidth + 'px';
            div.style.minWidth = flattenedPagesWidth + 'px';
            div.style.maxWidth = flattenedPagesWidth + 'px';
            div.style.flex = '0 0 auto';
            div.style.alignSelf = 'flex-start';
        } else if (stretch) {
            div.style.width = '100%';
            div.style.alignSelf = 'stretch';
        } else {
            div.style.width = 'auto';
            if (!vstretch) div.style.flex = '0 0 auto';
            div.style.alignSelf = 'flex-start';
        }
    } else if (tag === 'Table' || tag === 'Pages') {
        if (tag === 'Table' && isFalse(hs)) {
            var tableWidth = tableWidthMetrics(item).preferred;
            div.classList.add('fp-table-authored-width');
            div.dataset.fpTableGridWidth = String(tableWidth);
            div.style.width = tableWidth + 'px';
            div.style.minWidth = tableWidth + 'px';
            div.style.maxWidth = 'none';
            div.style.alignSelf = 'flex-start';
            if (parentH) div.style.flex = '0 0 ' + tableWidth + 'px';
        } else {
            div.style.width = '100%';
            div.style.alignSelf = 'stretch';
        }
        if (tag === 'Pages') div.classList.add('fp-pages-tabs');
    }
    /* A Table's first .fp-input-wrap is its toolbar search: an authored
     * table Width 60 would pin the search to 480px and push «Добавить» out
     * of a 600px bar. */
    /* SearchStringAddition is fixed chrome: CSS gives it the platform 260/200px
     * band flush against «Еще». The editor default width shrank it to 160px
     * and left a gap before «Еще». */
    var inputWrap = tag === 'Table' || tag === 'SearchStringAddition' ? null
        : div.querySelector('.fp-input-wrap, .fp-labelfield-value');
    var resolvedPaintMaximum = 0;
    if (inputWrap) {
        var titleAbove = inputWrap.parentNode
            && (inputWrap.parentNode.classList.contains('fp-title-top')
                || inputWrap.parentNode.classList.contains('fp-title-bottom'));
        var automaticRowOwner = parentMeta && parentMeta.defaultStretchChild === item
            && !compactQualifiedWidth;
        var multilineLayout = multilineFieldLayoutContract({
            location: titleLocation(item, parentMeta),
            multiline: tag === 'InputField' && isMultilineField(item, ctx),
            authoredTitleLocation: prop(item, ['TitleLocation', 'ПоложениеЗаголовка']),
            authoredPaintWidth: authoredFieldWidthPx(prop(item, ['Width', 'Ширина']), tag),
            boundedWidth: isFalse(prop(item, ['AutoMaxWidth'])) && !!charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина'])),
            titleCellChrome: TAXI_LAYOUT_METRICS.pagePadding.horizontal
                + TAXI_BROWSER_METRICS.horizontalSpacing.single
                + TAXI_LAYOUT_METRICS.inputBorderChromeWidth,
            authoredPaintHeight: authoredControlHeightPx(prop(item, ['Height', 'Высота']), tag),
            verticalStretch: isTrue(prop(item, ['VerticalStretch', 'ВертикальноеРастягивание'])),
            captionLineHeight: ROW_PX - TAXI_LAYOUT_METRICS.inputBorderChromeWidth,
            removedTopTitleBand: ROW_PX - TAXI_LAYOUT_METRICS.inputBorderChromeWidth
                + TAXI_LAYOUT_METRICS.topTitleGap
                - TAXI_LAYOUT_METRICS.inputBorderChromeWidth / 2
        });
        if (!stretch && widthChars > 0 && parentMeta && parentMeta.authoredEditorActionRow) {
            var authoredPaintWidth = authoredEditorPaintWidth(
                prop(item, ['Width', 'Ширина']), tag,
                inputWrap.querySelectorAll('.fp-input-btn').length);
            if (authoredPaintWidth) w = authoredPaintWidth;
        }
        var authoredAutoMaximumPaint = authoredAutoMaxEditorPaintWidth(item, tag, parentMeta, ctx);
        var widthSlotPaint = widthChars > 0
            ? widthChars * REF_AUTHORED_CHAR_PX + TAXI_LAYOUT_METRICS.authoredEditorInsetWidth
            : 0;
        var editorOverpaint = 0;
        if (authoredAutoMaximumPaint) {
            resolvedPaintMaximum = authoredAutoMaximumPaint;
            /* Horizontal Width < MaxWidth: the reference's next sibling starts after the
             * painted MaxWidth, not the narrower Width slot. A negative-margin
             * overpaint kept the item at its Width and placed the following
             * button 18px too far left. */
            if (widthSlotPaint && authoredAutoMaximumPaint > widthSlotPaint) {
                if (parentMeta && parentMeta.orientation === 'horizontal')
                    w = authoredAutoMaximumPaint;
                else
                    editorOverpaint = authoredAutoMaximumPaint - widthSlotPaint;
            }
            else
                /* MaxWidth without Width: the slot is the full char-unit ruler band
                 * (MaxWidth*10+10) for the trailing editor as well. The reference keeps
                 * that paint inside the row and compresses the row instead of
                 * letting the last editor overpaint its slot (the editors end
                 * at the 72-unit column edge). */
                w = authoredAutoMaximumPaint;
        }
        if (applyMultilineEditorPaintBand(inputWrap, multilineLayout)) {
            resolvedPaintMaximum = multilineLayout.editorPaintMaximum;
        } else if (w) {
            if (automaticRowOwner) {
                /* Width is the normal band. Once the reference assigns the item the
                 * remainder track, its editor paints the complete track. */
                inputWrap.style.width = '100%';
                inputWrap.style.maxWidth = '100%';
                inputWrap.style.flex = '1 1 auto';
            } else if (titleAbove && (stretch || isTrue(hs))) {
                /* In a column layout flex-basis controls height, not width.
                 * Keep the serialized Width as a preference of the field
                 * item, while the editor itself follows the available column. */
                inputWrap.style.width = '100%';
                inputWrap.style.maxWidth = '100%';
                inputWrap.style.flex = '0 1 auto';
            } else if (stretch || isTrue(hs)) {
                /* A stretchable Width is the preferred size, not a hard lower
                 * bound. 1C compresses such fields when an AlwaysHorizontal
                 * header has to fit the form window. */
                if (editorOverpaint && !widthChars && authoredAutoMaximumPaint) {
                    inputWrap.style.width = authoredAutoMaximumPaint + 'px';
                    inputWrap.style.maxWidth = authoredAutoMaximumPaint + 'px';
                    inputWrap.style.flex = '0 0 auto';
                    inputWrap.style.marginRight = (-editorOverpaint) + 'px';
                } else {
                    /* The preferred width is the char-unit ruler paint (Width=60:
                     * 610px in the reference, not the 480px 8px lane); a zero
                     * minimum keeps it compressible. */
                    /* Only a sole editor of its row: several such editors
                     * share an AlwaysHorizontal header and are compressed to
                     * the window. */
                    var soleRowEditor = parentItem && (parentItem.childItems || []).filter(function (sib) {
                        return sib && (sib.tag === 'InputField' || sib.tag === 'LabelField');
                    }).length === 1;
                    var preferredPaint = soleRowEditor && widthChars > 0 && tag === 'InputField'
                        ? authoredEditorPaintWidth(widthChars, tag,
                            inputWrap.querySelectorAll('.fp-input-btn').length) : 0;
                    if (preferredPaint > w) {
                        w = preferredPaint;
                        inputWrap.style.minWidth = '0';
                        div.style.minWidth = '0';
                    }
                    inputWrap.style.width = w + 'px';
                    inputWrap.style.flex = '1 1 ' + w + 'px';
                    /* The automatic cap never undercuts the authored lane
                     * (Width=60: 610px in the reference). */
                    if (!mw && !isFalse(prop(item, ['AutoMaxWidth'])))
                        inputWrap.style.maxWidth = Math.max(50 * CHAR_PX + 10,
                            widthChars > 0 && tag === 'InputField'
                                ? authoredEditorPaintWidth(widthChars, tag,
                                    inputWrap.querySelectorAll('.fp-input-btn').length) : 0) + 'px';
                    /* A number keeps its authored Width lane (Width=5 with spin: 81px),
                     * so the following selector stays inside its column. */
                    if (tag === 'InputField' && widthChars > 0 && !isTrue(hs)
                        && fieldKind(item, ctx) === 'number') {
                        var numberLane = authoredEditorPaintWidth(widthChars, tag,
                            inputWrap.querySelectorAll('.fp-input-btn, .fp-spin').length);
                        inputWrap.style.width = numberLane + 'px';
                        inputWrap.style.maxWidth = numberLane + 'px';
                        inputWrap.style.flex = '0 0 auto';
                    }
                }
            } else if (authoredAutoMaximumPaint) {
                /* MaxWidth without Width is the preferred lane and the cap.
                 * Pinning minWidth to that cap made E-mail+phone rows
                 * overflow the 72-unit column, so the choice button sat past
                 * the right edge of the fields above.
                 * Width < MaxWidth in a horizontal row already grew `w` to the
                 * paint band above; leftover overpaint is only the vertical
                 * column case. */
                inputWrap.style.width = authoredAutoMaximumPaint + 'px';
                inputWrap.style.maxWidth = authoredAutoMaximumPaint + 'px';
                inputWrap.style.flex = '0 0 auto';
                if (!editorOverpaint && parentMeta && parentMeta.orientation === 'horizontal') {
                    /* The reference compresses an over-wide horizontal row by taking
                     * width from these MaxWidth bands (e.g. 260->258, 270->251)
                     * down to the 71px field minimum, instead of scrolling the
                     * window. */
                    inputWrap.style.flex = '0 1 auto';
                    inputWrap.style.minWidth = Math.min(authoredAutoMaximumPaint,
                        TAXI_LAYOUT_METRICS.compressedFieldMinimumWidth) + 'px';
                    div.style.minWidth = '0';
                    div.style.flexShrink = '1';
                }
                if (editorOverpaint)
                    inputWrap.style.marginRight = (-editorOverpaint) + 'px';
            } else if (parentMeta && parentMeta.orientation === 'vertical' && parentItem
                && parentMeta.explicitWidth && w >= parentMeta.explicitWidth
                && isFalse(prop(parentItem, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))) {
                /* A fixed-width column is a hard bound for its editors. A Width 55
                 * group compresses a Width 55 editor plus its caption so the
                 * editor ends on the column edge instead of widening the
                 * column. */
                inputWrap.style.width = w + 'px';
                inputWrap.style.minWidth = TAXI_LAYOUT_METRICS.compressedFieldMinimumWidth + 'px';
                inputWrap.style.flex = '0 1 auto';
            } else {
                /* A fixed Width is the text lane on the reference char-unit ruler with
                 * the value buttons appended: W11 paints 120px, W5 with two
                 * buttons 103px. */
                if ((tag === 'InputField' || tag === 'ValueList') && widthChars > 0
                    && !authoredAutoMaximumPaint && !(parentMeta && parentMeta.authoredEditorActionRow))
                    w = Math.max(w, authoredEditorPaintWidth(widthChars, tag,
                        inputWrap.querySelectorAll('.fp-input-btn').length));
                inputWrap.style.minWidth = w + 'px';
                inputWrap.style.width = w + 'px';
                inputWrap.style.flex = '0 0 auto';
            }
        } else if (stretch || isTrue(hs)) {
            if (automaticRowOwner) {
                /* The generated editor's automatic presentation lane is a
                 * 40-unit reference band plus its 10px editor inset. It may shrink
                 * under pressure, but the row's intrinsic width is calculated
                 * from this band rather than from the browser's 8px text grid. */
                var automaticOwnerWidth = TAXI_LAYOUT_METRICS.automaticEditorPresentationWidth;
                inputWrap.style.width = automaticOwnerWidth + 'px';
                inputWrap.style.maxWidth = automaticOwnerWidth + 'px';
                inputWrap.style.flex = '1 1 ' + automaticOwnerWidth + 'px';
            } else {
                inputWrap.style.flex = '1 1 auto';
                /* HorizontalStretch=true with a MaxWidth cap fills its column
                 * up to the cap (it ends at 410 like its siblings, not at its
                 * placeholder text). */
                if (tag === 'InputField' && isTrue(hs) && mw && !titleAbove
                    && parentMeta && parentMeta.orientation === 'vertical')
                    div.style.alignSelf = 'stretch';
                /* A generated field row (sized group + title decoration) caps
                 * its Width-less value at the same 40-unit band as its
                 * Width-carrying siblings, so they end on one edge. */
                if (tag === 'InputField' && parentMeta && parentMeta.explicitWidth
                    && parentMeta.orientation === 'horizontal'
                    && !isFalse(prop(item, ['AutoMaxWidth'])) && !mw) {
                    inputWrap.style.maxWidth = TAXI_LAYOUT_METRICS.automaticEditorPresentationWidth + 'px';
                    /* The untitled row ends with the editor, so a trailing
                     * tooltip «?» follows it instead of the row edge. */
                    var cappedRow = inputWrap.parentNode;
                    if (cappedRow && cappedRow.classList && cappedRow.classList.contains('fp-title-none'))
                        cappedRow.style.maxWidth = TAXI_LAYOUT_METRICS.automaticEditorPresentationWidth + 'px';
                }
                /* [W-NUM-CAP] A Width-less stretched number field keeps its
                 * type band plus buttons (Number(2,0)+SpinButton: 52px).
                 * The smaller cap wins. */
                if (tag === 'InputField' && !isTrue(hs) && !mw && fieldKind(item, ctx) === 'number'
                    && !isFalse(prop(item, ['AutoMaxWidth']))
                    && item.runtime && item.runtime.defaultChars > 0) {
                    var numberCap = authoredEditorPaintWidth(String(item.runtime.defaultChars), tag,
                        item.runtime.buttonsCount);
                    if (numberCap > 0) {
                        var prevNumberCap = parseFloat(inputWrap.style.maxWidth);
                        if (!(prevNumberCap > 0) || numberCap < prevNumberCap)
                            inputWrap.style.maxWidth = numberCap + 'px';
                        var numberInp = inputWrap.querySelector('.fp-input');
                        if (numberInp) numberInp.style.minWidth = '0';
                    }
                }
                /* [CAP40-COLUMN] A Width-less stretched text/ref/list editor in a
                 * vertical column paints at most the 40-unit band (about
                 * 407-411px). AutoMaxWidth=false and explicit HorizontalStretch
                 * reach the edge. The smaller cap wins. */
                if (tag === 'InputField' && !isFalse(prop(item, ['AutoMaxWidth'])) && !mw
                    && !isTrue(hs) && !titleAbove && !isMultilineField(item, ctx)
                    && parentMeta && parentMeta.orientation !== 'horizontal') {
                    var columnKind = fieldKind(item, ctx);
                    if (columnKind === 'text' || columnKind === 'ref' || columnKind === 'list') {
                        var columnCap = TAXI_LAYOUT_METRICS.automaticEditorPresentationWidth;
                        /* A short string stops at its own length (String(2) is 30px in
                         * the reference). */
                        if (columnKind === 'text') {
                            var columnTypes = typeInfoFromItem(item, ctx);
                            var columnChars = presentationLengthOf(columnTypes.types, columnTypes);
                            /* A long qualifier still paints the whole band: a CodeLength 36
                             * code is 410px in the reference, not 370. */
                            if (columnTypes.stringLen > 0 && columnChars > 0 && columnChars < 25)
                                columnCap = Math.min(columnCap, autoMaxEditorBandWidth(columnChars));
                            /* Below the generic 80px editor floor. */
                            if (columnCap < 80) {
                                inputWrap.style.minWidth = columnCap + 'px';
                                var shortInput = inputWrap.querySelector('.fp-input');
                                if (shortInput) shortInput.style.minWidth = '0';
                            }
                        }
                        var prevColumnCap = parseFloat(inputWrap.style.maxWidth);
                        if (!(prevColumnCap > 0) || columnCap < prevColumnCap)
                            inputWrap.style.maxWidth = columnCap + 'px';
                    }
                }
            }
        } else if (mw) {
            /* MaxWidth is only a cap. Using it as the actual width made every
             * MaxWidth=31 header field consume all 31 characters even when its
             * value type has a much smaller natural presentation. */
            var paintBand = semanticEditorPaintBand({
                maximum: mw,
                appendedChrome: (!autoMaxWidthFalse
                    && /button|кнопк/i.test(String(prop(item, ['ToolTipRepresentation']) || '')))
                    ? TAXI_LAYOUT_METRICS.tooltipButtonWidth
                        + TAXI_LAYOUT_METRICS.tooltipButtonGap
                        + TAXI_LAYOUT_METRICS.inputBorderChromeWidth
                    : 0,
                natural: defaultFieldWidthPx(item, ctx),
                autoMaxWidth: !autoMaxWidthFalse,
                /* A button-style extended tooltip is a sibling lane in the reference's
                 * rich editor group. It assigns the value editor its authored
                 * maximum before appending the tooltip affordance. */
                occupiesMaximum: !autoMaxWidthFalse
                    && /button|кнопк/i.test(String(prop(item, ['ToolTipRepresentation']) || ''))
            });
            resolvedPaintMaximum = paintBand.maximum;
            var preferred = paintBand.preferred;
            inputWrap.style.width = preferred + 'px';
            inputWrap.style.flex = titleAbove ? '0 0 auto' : '0 1 ' + preferred + 'px';
            inputWrap.style.maxWidth = paintBand.maximum + 'px';
        } else {
            var dw = defaultEditorPaintWidth(item, ctx, tag,
                inputWrap.querySelectorAll('.fp-input-btn').length);
            /* A Width-less non-stretched reference paints the char-unit ruler
             * lane the allocator already recommends (150+11+21n, e.g. 203 with
             * two buttons). */
            if (tag === 'InputField' && fieldKind(item, ctx) === 'ref'
                && !defaultWidthClampsButtons(item, ctx))
                /* The 40-unit band is the whole editor, buttons included
                 * (document references paint 408px). */
                dw = Math.min(TAXI_LAYOUT_METRICS.automaticEditorPresentationWidth,
                    authoredEditorPaintWidth(String(defaultFieldChars(item, ctx)), tag,
                        inputWrap.querySelectorAll('.fp-input-btn').length));
            if (tag === 'InputField' && parentMeta && parentMeta.tag === 'Page'
                && parentMeta.hasCommandBarChild) dw = 410;
            if (untitledLeadingStringEditor(item, parentMeta, ctx))
                dw = TAXI_LAYOUT_METRICS.automaticEditorPresentationWidth;
            /* [W-DATE] Date lane = chars + inset + appended 21px buttons
             * (121px = 100 + 21; DateTime 180px). */
            if (tag === 'InputField' && fieldKind(item, ctx) === 'date')
                dw = defaultFieldChars(item, ctx) * REF_AUTHORED_CHAR_PX + 10
                    + inputWrap.querySelectorAll('.fp-input-btn').length * 21;
            inputWrap.style.width = dw + 'px';
            inputWrap.style.flex = titleAbove ? '0 0 auto' : '0 1 ' + dw + 'px';
        }
        if (mw) inputWrap.style.maxWidth = (resolvedPaintMaximum || mw) + 'px';
        /* A stretching editor whose row slot is capped by MaxWidth fills the
         * cap. */
        if (mw && tag === 'InputField' && stretch && parentH && !autoMaxWidthFalse
            && div.style.flex === '0 1 auto' && inputWrap.style.flex === '1 1 auto')
            inputWrap.style.width = inputWrap.style.maxWidth;
        if (tag === 'InputField' || tag === 'ValueList') {
            var authoredControlHeight = authoredControlHeightPx(
                prop(item, ['Height', 'Высота']), tag);
            if (authoredControlHeight) {
                inputWrap.style.height = authoredControlHeight + 'px';
                inputWrap.style.minHeight = authoredControlHeight + 'px';
                if (!vstretch) inputWrap.style.maxHeight = authoredControlHeight + 'px';
            }
            applyMultilineEditorVerticalBand(inputWrap, multilineLayout);
        }
        var hint = prop(item, ['InputHint']);
        var inpEl = inputWrap.querySelector('.fp-input');
        if (hint && inpEl && !inpEl.value) inpEl.placeholder = hint;
    } else if (w && (tag === 'LabelField' || tag === 'LabelDecoration')) {
        var lab = div.querySelector('.fp-label');
        /* A LabelDecoration Width is on the reference's 10px text ruler: W16 spans
         * 160px, so every value of a label/value block starts on one column. */
        if (lab) lab.style.minWidth = (horizontalDecorationWidthPx(item, tag, parentMeta) || w) + 'px';
    }
    if (tag === 'LabelDecoration') {
        var textDecoration = div.querySelector('.fp-label-decoration');
        /* The reference generates maxWidth=40 for AutoMaxWidth labels.
         * The reference static-text calculation scales this by 10, independently of
         * the input editor's browser grid. An 8px cap spuriously wraps
         * long labels. */
        var textMaxChars = parseInt(prop(item, ['MaxWidth', 'МаксимальнаяШирина']), 10) || 0;
        var textCap = textMaxChars > 0 ? textMaxChars * REF_AUTHORED_CHAR_PX
            : (!w && !isFalse(prop(item, ['AutoMaxWidth'])) ? 40 * REF_AUTHORED_CHAR_PX : 0);
        if (textDecoration && textCap) {
            textDecoration.style.maxWidth = textCap + 'px';
            if (!w && labelDecorationCanDynamicHeight(item)
                && String(prop(item, ['TextBreak', 'TextBreakMode']) || 'WordBreak').toLowerCase() === 'wordbreak') {
                textDecoration.dataset.fpWrapNormalWidth = String(textCap);
            }
        }
    }
    if (tag === 'LabelDecoration' || tag === 'PictureDecoration') {
        var decorationHeight = charHeight(prop(item, ['Height', 'Высота']));
        if (decorationHeight) {
            div.style.height = decorationHeight + 'px';
            div.style.minHeight = decorationHeight + 'px';
            var decorationWrap = div.querySelector('.fp-control-wrap');
            if (decorationWrap) decorationWrap.style.height = '100%';
            /* The authored height bounds the picture paint too: a 24px
             * progress icon in a Height=1 (18px) PictureDecoration would paint
             * 6px over the following caption. */
            var boundedPicture = tag === 'PictureDecoration'
                && div.querySelector('.fp-picture-decoration');
            if (boundedPicture) {
                boundedPicture.classList.add('fp-picture-height-bound');
                div.classList.add('fp-decoration-height-bound');
            }
        }
    }
    if (ha.indexOf('right') >= 0 || ha.indexOf('прав') >= 0) {
        div.style.marginLeft = 'auto';
        div.classList.add('fp-align-right');
    } else if (ha.indexOf('center') >= 0 || ha.indexOf('центр') >= 0) {
        /* Auto margins centre the item on the parent horizontal axis in both
         * orientations: they split the free width of a row and centre the item
         * inside the column of a vertical group. */
        div.style.marginLeft = 'auto';
        div.style.marginRight = 'auto';
        div.classList.add('fp-align-center');
    } else if (ha.indexOf('left') >= 0 || ha.indexOf('лев') >= 0) {
        /* Explicit Left has to beat the margin-left:auto of a Right sibling,
         * which would otherwise carry this item to the right along with it. */
        div.style.marginRight = 'auto';
        div.classList.add('fp-align-left');
    }
    if (va.indexOf('bottom') >= 0 || va.indexOf('низ') >= 0) {
        if (parentH) div.style.alignSelf = 'flex-end';
        else div.style.marginTop = 'auto';
        div.classList.add('fp-align-bottom');
    } else if ((va.indexOf('center') >= 0 || va.indexOf('центр') >= 0) && parentH) {
        div.style.alignSelf = 'center';
    }
    var bc = prop(item, ['BackColor']);
    if (bc) {
        var bcl = bc.toLowerCase();
        if (/итог/i.test(bc)) div.classList.add('fp-totals-bg');
        if (/tooltip|подсказ/i.test(bcl)) div.classList.add('fp-tooltip-bg');
        else if (/выделен/i.test(bc)) div.classList.add('fp-highlight-bg');
    }
    var buttonTarget = (tag === 'Button' || tag === 'Popup' || tag === 'Hyperlink')
        ? div.querySelector('.fp-button, .fp-link') : null;
    var tc = prop(item, ['TextColor']);
    if (tc) {
        var tcAbs = absoluteColor(tc) || styleItemColor(tc, ctx && ctx.styleItems);
        var tcl = tc.toLowerCase();
        /* Hyperlink decorations and their formatted text spans both use the
         * --fp-link token. Override it at the rendered link as well as color:
         * otherwise .fp-rich-link still paints the glyphs blue. */
        var linkTarget = div.querySelector('.fp-link');
        var colorTarget = buttonTarget || linkTarget || div;
        if (tcAbs) {
            colorTarget.style.color = tcAbs;
            if (linkTarget) linkTarget.style.setProperty('--fp-link', tcAbs);
        }
        else if (/firebrick|красный|red|проблема/i.test(tcl)) colorTarget.classList.add('fp-text-danger');
        else if (/заголовокотчета|группавариантов/i.test(tcl)) colorTarget.classList.add('fp-text-accent');
        else if (/гиперссылка/i.test(tcl)) colorTarget.classList.add('fp-text-link');
        else if (/серый|gray|grey/i.test(tcl)) colorTarget.classList.add('fp-text-muted');
    }
    if (bc) {
        var bcAbs = absoluteColor(bc) || styleItemColor(bc, ctx && ctx.styleItems);
        if (bcAbs) {
            var bcTarget = buttonTarget || div.querySelector('.fp-input-wrap') || div;
            if (buttonTarget) {
                buttonTarget.style.background = buttonColorGradient(bcAbs) || bcAbs;
                var borderRgb = colorRgb(bcAbs);
                if (borderRgb) buttonTarget.style.borderColor = mixRgb(borderRgb, [0, 0, 0], 0.12);
            } else {
                bcTarget.style.backgroundColor = bcAbs;
                /* Descendants that have to merge into the colour they stand on
                 * (the active page tab) read it from here instead of assuming
                 * the white form background. */
                if (bcTarget === div) {
                    div.style.setProperty('--fp-surface', bcAbs);
                    div.classList.add('fp-backcolor');
                }
            }
        }
    }
    /* A vertical stack of authored white cards paints its Half/Single gaps on
     * the native section background. Transparent CSS would otherwise make the
     * cards merge into one white block and erase the reference's separators. */
    if (!bc && isNativeCardStack(item)) {
        div.classList.add('fp-native-card-stack');
    }
    var borderAbs = absoluteColor(prop(item, ['BorderColor', 'ЦветРамки']));
    if (borderAbs) {
        var bTarget = div.querySelector('.fp-input-wrap') || div;
        bTarget.style.borderColor = borderAbs;
    }
    var runtime = item.runtime || {};
    var chromeTarget = div.querySelector('.fp-input-wrap, .fp-table-mock, .fp-group-block, .fp-group-bare') || div;
    if (runtime.border) {
        var borderStyle = String(runtime.border.style || '').toLowerCase();
        if (/withoutborder|none|безрамк/.test(borderStyle)) {
            chromeTarget.style.borderWidth = '0';
            chromeTarget.style.borderStyle = 'none';
            chromeTarget.classList.add('fp-without-border');
        } else {
            if (runtime.border.width != null) chromeTarget.style.borderWidth = runtime.border.width + 'px';
            if (/dash/.test(borderStyle)) chromeTarget.style.borderStyle = 'dashed';
            else if (/dot/.test(borderStyle)) chromeTarget.style.borderStyle = 'dotted';
            else if (/double/.test(borderStyle)) chromeTarget.style.borderStyle = 'double';
            else if (borderStyle || runtime.border.width != null) chromeTarget.style.borderStyle = 'solid';
        }
        chromeTarget.dataset.borderStyle = runtime.border.style || '';
    }
    if (runtime.backPicture) appendBackgroundPicture(chromeTarget, runtime.backPicture, ctx);
    /* Enabled=false is 1C's "недоступен": the control still occupies its place
     * but its text goes grey. ReadOnly already has its own washed-out field.
     * The reference leaves a CommandBarButton drawn as usual whatever its
     * Enabled: #4d4d4d text and the #b2b2b2 frame. */
    if (isFalse(prop(item, ['Enabled', 'Доступность', 'Доступен'])) && !isCommandBarButton(item))
        div.classList.add('fp-disabled');
    /* Native tables publish MaxHeight as an explicit cap only when
     * AutoMaxHeight=false. The default automatic mode must not cap the
     * browser item merely because a serialized MaxHeight is present. */
    var mh = charHeight(prop(item, ['MaxHeight', 'МаксимальнаяВысота']));
    if (mh && tag !== 'ChartField' && !(tag === 'Table' && tableAuthoredHeightPx(item)))
        div.style.maxHeight = mh + 'px';
    var th = parseInt(prop(item, ['TitleHeight', 'ВысотаЗаголовка']), 10);
    if (th > 1) {
        var thLabel = div.querySelector('.fp-field-label');
        if (thLabel) {
            thLabel.style.whiteSpace = 'normal';
            thLabel.style.maxHeight = (th * 16) + 'px';
            div.classList.add('fp-title-multiline');
        }
    }
    var psize = normPictureSize(prop(item, ['PictureSize', 'РазмерКартинки']));
    if (psize && (tag === 'PictureDecoration' || tag === 'PictureField')) {
        if (tag === 'PictureDecoration' && psize === 'byfontsize')
            div.classList.add('fp-picture-byfontsize-control');
        var picBox = div.querySelector('.fp-picture-icon');
        if (picBox) {
            picBox.classList.add('fp-picture-' + psize);
            if (w) picBox.style.width = w + 'px';
            var picH = charHeight(prop(item, ['Height', 'Высота']));
            if (picH) picBox.style.height = picH + 'px';
        }
    }
    applyFonts(div, item, tag);
}

function syntheticBtn(name, title, picture, rep, extra) {
    var properties = {
        Title: title || '',
        Picture: picture || '',
        Representation: rep || (picture ? 'Picture' : 'Text')
    };
    if (extra) {
        for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] != null)
                properties[k] = extra[k];
        }
    }
    return {
        tag: 'Button',
        name: name,
        id: '',
        properties: properties,
        childItems: []
    };
}

function mainAttribute(model) {
    var attrs = formAttributes(model);
    var i;
    for (i = 0; i < attrs.length; i++) {
        if (isTrue(prop(attrs[i], ['MainAttribute']))) return attrs[i];
    }
    for (i = 0; i < attrs.length; i++) {
        var nm = String(attrs[i].name || '');
        if (nm === 'Объект' || nm === 'Object') return attrs[i];
    }
    return null;
}

function formObjectKind(model) {
    var attr = mainAttribute(model);
    var t = String(prop(attr, ['Type']) || '');
    if (/CatalogObject|СправочникОбъект/i.test(t)) return 'catalog';
    if (/DocumentObject|ДокументОбъект/i.test(t)) return 'document';
    return '';
}

function commandExcluded(model, name) {
    var list = (model && model.excludedCommands) || [];
    var want = String(name || '').toLowerCase();
    for (var i = 0; i < list.length; i++) {
        if (String(list[i]).toLowerCase() !== want) continue;
        /* Adopted extension objects serialize inherited standard buttons as
         * CommandName=0 and also list their commands as excluded. In the
         * resulting platform form those buttons are still inherited. */
        if (hasAdoptedStdPlaceholder(model, want)) return false;
        return true;
    }
    return false;
}

function stdCommandKey(item) {
    var short = String(cmdShort(item) || '').toLowerCase().replace(/[\s_-]+/g, '');
    var name = String((item && item.name) || '').toLowerCase().replace(/[\s_-]+/g, '');
    var title = String(rawTitle(item) || '').toLowerCase().replace(/[\s_-]+/g, '');
    var blob = short + ' ' + name + ' ' + title;
    if (/writeandclose|записатьизакрыть/.test(blob)) return 'writeandclose';
    if (/postandclose|провестиизакрыть/.test(blob)) return 'postandclose';
    if (/(^| )(write|записать|записатьдокумент)( |$)/.test(' ' + blob + ' ')
        || /(^|форма)записать$/.test(name)) return 'write';
    if (/(^| )(post|провести|провестидокумент)( |$)/.test(' ' + blob + ' ')
        || /(^|форма)провести$/.test(name)) return 'post';
    return short;
}

function hasAdoptedStdPlaceholder(model, key) {
    var belonging = String(model && model.objectMeta && model.objectMeta.objectBelonging || '').toLowerCase();
    if (belonging !== 'adopted' && !(model && model.adoptedForm)) return false;
    var found = false;
    function walk(items) {
        for (var i = 0; !found && items && i < items.length; i++) {
            var it = items[i];
            if (!it) continue;
            if (isDeadCommand(it) && stdCommandKey(it) === key) found = true;
            if (!found && it.childItems && it.childItems.length) walk(it.childItems);
        }
    }
    walk(model && model.autoCommandBar && model.autoCommandBar.childItems);
    return found;
}

function collectStdCommandKeys(items, acc) {
    var out = acc || {};
    if (!items) return out;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        /* An extension can keep a standard button's inherited name while its
         * CommandName is serialized as 0. Such a button is filtered later and
         * must not suppress the synthetic standard replacement. */
        if (!isDeadCommand(it)) {
            var key = stdCommandKey(it);
            if (key) out[key] = true;
        }
        if (it.childItems && it.childItems.length) collectStdCommandKeys(it.childItems, out);
    }
    return out;
}

/* Reference objects other than catalogs and documents get the same
 * Write / WriteAndClose pair in the form command bar. */
function isWritableReferenceObjectForm(model) {
    var t = String(prop(mainAttribute(model), ['Type']) || '');
    return /(?:ChartOfAccounts|ChartOfCalculationTypes|ChartOfCharacteristicTypes|ExchangePlan|Task|BusinessProcess)Object\./i.test(t);
}

function formStdCommandButtons(model) {
    var bar = model && model.autoCommandBar;
    if (bar && isFalse(prop(bar, ['Autofill']))) return [];
    var kind = formObjectKind(model);
    var out = [];
    if (kind === 'catalog' || isWritableReferenceObjectForm(model)) {
        if (!commandExcluded(model, 'WriteAndClose'))
            out.push(syntheticBtn('_stdWriteAndClose', 'Записать и закрыть', '', 'Text', {
                DefaultButton: 'true',
                CommandName: 'Form.StandardCommand.WriteAndClose'
            }));
        if (!commandExcluded(model, 'Write'))
            out.push(syntheticBtn('_stdWrite', 'Записать', '', 'Text', {
                CommandName: 'Form.StandardCommand.Write'
            }));
    } else if (kind === 'document') {
        if (!commandExcluded(model, 'PostAndClose'))
            out.push(syntheticBtn('_stdPostAndClose', 'Провести и закрыть', '', 'Text', {
                DefaultButton: 'true',
                CommandName: 'Form.StandardCommand.PostAndClose'
            }));
        if (!commandExcluded(model, 'Write'))
            out.push(syntheticBtn('_stdWrite', 'Записать', 'StdPicture.Write', 'Text', {
                CommandName: 'Form.StandardCommand.Write'
            }));
        if (!commandExcluded(model, 'Post'))
            out.push(syntheticBtn('_stdPost', 'Провести', 'StdPicture.Post', 'Text', {
                CommandName: 'Form.StandardCommand.Post'
            }));
    }
    /* The reference paints «?» for exactly the objects that carry help content
     * (e.g. a report: yes; documents and processors without help: no),
     * whatever the object kind. Without an owner descriptor fall back to the
     * catalog default. */
    var objectMeta = model && model.objectMeta;
    var hasHelp = objectMeta ? !!objectMeta.hasHelp : kind === 'catalog';
    if (hasHelp && !commandExcluded(model, 'Help'))
        out.push(syntheticBtn('_stdHelp', '?', 'StdPicture.Help', 'Picture', {
            CommandName: 'Form.StandardCommand.Help'
        }));
    return out;
}

/* In the root document command panel the reference renders the persistence trio as the
 * platform's primary text actions. This role wins over an authored Picture
 * representation (common in generated Form.xml). Nested CommandBar controls
 * are author-owned and deliberately remain untouched. */
function normalizeRootDocumentActions(items) {
    var changed = false;
    var out = (items || []).map(function (item) {
        if (!item) return item;
        var role = stdCommandKey(item);
        var picture = String(pictureRef(item) || '').toLowerCase().replace(/[ _-]+/g, '');
        /* CreateListItem is table-row chrome. When generated metadata reuses
         * it on a root document command, the reference keeps the authored command as a
         * text action instead of painting the table's plus glyph. */
        var rootTableGlyph = /(?:^|\.)createlistitem$/.test(picture);
        var forceText = role === 'postandclose' || role === 'write' || role === 'post'
            || rootTableGlyph;
        var children = item.childItems;
        var normalizedChildren = children;
        if (children && children.length) normalizedChildren = normalizeRootDocumentActions(children);
        if (!forceText && normalizedChildren === children) return item;
        changed = true;
        var copy = {};
        for (var key in item) {
            if (Object.prototype.hasOwnProperty.call(item, key)) copy[key] = item[key];
        }
        if (forceText) {
            copy.properties = {};
            var props = item.properties || {};
            for (var propName in props) {
                if (Object.prototype.hasOwnProperty.call(props, propName))
                    copy.properties[propName] = props[propName];
            }
            copy.properties.Representation = 'Text';
            if (rootTableGlyph) copy.rootTableGlyphText = true;
        }
        if (normalizedChildren !== children) copy.childItems = normalizedChildren;
        return copy;
    });
    return changed ? out : items;
}

function normalizeRootFormBar(bar, model) {
    if (!bar || formObjectKind(model) !== 'document') return bar;
    /* Change belongs to editable catalog object forms. Generated document
     * forms can still inherit a direct root placeholder, but the reference omits it
     * while preserving Change commands authored inside nested popups. */
    var rootItems = bar.childItems || [];
    var filtered = rootItems.filter(function (item) {
        return stdCommandKey(item) !== 'change';
    });
    var children = normalizeRootDocumentActions(filtered);
    if (children === bar.childItems) return bar;
    var copy = {};
    for (var key in bar) {
        if (Object.prototype.hasOwnProperty.call(bar, key)) copy[key] = bar[key];
    }
    copy.childItems = children;
    return copy;
}

/* The form's main dynamic list with CommandBarLocation=None hands its
 * standard Create/Copy and its search string to the form command bar. */
function hoistedMainListItems(model) {
    var bar = model && model.autoCommandBar;
    if (!model || (bar && isFalse(prop(bar, ['Autofill'])))) return [];
    return mainListStandardItems(model);
}

/* Records of a recorder-bound register are not created from its list: the reference
 * paints only the search for AccumulationRegister, while
 * InformationRegister/Task/ChartOf* /ExchangePlan lists keep Create/Copy. */
function mainListCreatesRows(main) {
    var mainTable = String((main && main.settings && main.settings.mainTable) || '').trim();
    return !/^(AccumulationRegister|AccountingRegister|CalculationRegister|РегистрНакопления|РегистрБухгалтерии|РегистрРасчета)\./i
        .test(mainTable);
}

/* The main dynamic list's standard Create/Copy and search string, whatever
 * bar ends up hosting them. */
function mainListStandardItems(model) {
    if (!model) return [];
    var main = mainAttribute(model);
    if (!main || !/DynamicList|ДинамическийСписок/i.test(String(prop(main, ['Type']) || ''))) return [];
    var table = null;
    walkFormItems({ childItems: model.childItemsRoot }, function (item) {
        if (table || !item || item.tag !== 'Table') return;
        if (String(prop(item, ['DataPath']) || '') === main.name) table = item;
    });
    if (!table || commandBarLocation(table) !== 'none') return [];
    var out = [];
    if (!isFalse(prop(table, ['ChangeRowSet'])) && mainListCreatesRows(main)) {
        if (!tableExcludes(table, ['Create', 'Add']))
            out.push(syntheticBtn('_stdListCreate', 'Создать', '', 'Text', {
                CommandName: 'Form.StandardCommand.Create'
            }));
        /* Only the list of the form's own folder-hierarchy object
         * (Создать | Создать группу | Скопировать). */
        var listOwnerMeta = model.objectMeta;
        var listMainTable = String((main.settings && main.settings.mainTable) || '');
        if (listOwnerMeta && listOwnerMeta.hasFolders && listOwnerMeta.name
            && listMainTable.split('.').pop() === listOwnerMeta.name
            && !tableExcludes(table, ['CreateFolder']))
            out.push(syntheticBtn('_stdListCreateFolder', 'Создать группу', '', 'Text', {
                CommandName: 'Form.StandardCommand.CreateFolder'
            }));
        if (!tableExcludes(table, ['Copy']))
            out.push(syntheticBtn('_stdListCopy', 'Скопировать', '', 'Text', {
                CommandName: 'Form.StandardCommand.Copy'
            }));
    }
    if (table.searchStringAddition && !additionHidden(table, 'SearchStringLocation'))
        out.push(table.searchStringAddition);
    /* Without a search string the list keeps its Find/CancelSearch text
     * commands («Найти...», «Отменить поиск»). */
    else if (additionHidden(table, 'SearchStringLocation')) {
        if (!tableExcludes(table, ['Find']))
            out.push(syntheticBtn('_stdListFind', 'Найти...', '', 'Text', {
                CommandName: 'Form.StandardCommand.Find'
            }));
        if (!tableExcludes(table, ['CancelSearch']))
            out.push(syntheticBtn('_stdListCancelSearch', 'Отменить поиск', '', 'Text', {
                CommandName: 'Form.StandardCommand.CancelSearch'
            }));
    }
    return out;
}

/* A table whose own bar is not autofilled keeps only its authored buttons;
 * its automatic search string belongs to the form command bar (beside
 * «Создать на основании»). */
function tableSearchHoistedToForm(table, model) {
    if (!table || !model || !table.searchStringAddition) return false;
    if (additionHidden(table, 'SearchStringLocation')) return false;
    if (String(prop(table, ['SearchStringLocation']) || 'Auto').toLowerCase() !== 'auto') return false;
    if (commandBarLocation(table) === 'none') return false;
    var tableBar = table.autoCommandBar;
    if (!tableBar || !isFalse(prop(tableBar, ['Autofill']))) return false;
    var formBar = model.autoCommandBar;
    if (formBar && isFalse(prop(formBar, ['Autofill']))) return false;
    if (commandBarLocation(model) === 'none') return false;
    /* Only a table on the form surface itself: one on a page keeps its
     * search out of the form bar. */
    var roots = model.childItemsRoot || [];
    for (var i = 0; i < roots.length; i++) {
        var root = roots[i];
        if (!root || isFalse(prop(root, ['Visible', 'visible']))) continue;
        if (root.tag === 'Table' && root.searchStringAddition
            && !additionHidden(root, 'SearchStringLocation')) return root === table;
    }
    return false;
}

/* A table with CommandBarLocation=None and automatic search puts its search
 * into the visible autofilled form bar, main list or not. A hidden form bar
 * drops it. */
function tableSearchWithoutBarHoistedToForm(table, model) {
    if (!table || !model || !table.searchStringAddition) return false;
    if (additionHidden(table, 'SearchStringLocation')) return false;
    if (String(prop(table, ['SearchStringLocation']) || 'Auto').toLowerCase() !== 'auto') return false;
    if (isFalse(prop(table, ['Visible', 'visible']))) return false;
    if (commandBarLocation(table) !== 'none') return false;
    var formBar = model.autoCommandBar;
    if (formBar && isFalse(prop(formBar, ['Autofill']))) return false;
    return commandBarLocation(model) !== 'none';
}

/* A non-autofilled table bar keeps a permanent «Еще» only when it holds a
 * standard table command other than Add (Change/Delete, or Delete alone). */
function tableBarHasPermanentMore(table) {
    var bar = table && table.autoCommandBar;
    if (!bar || !isFalse(prop(bar, ['Autofill']))) return true;
    var found = false;
    walkFormItems({ childItems: bar.childItems }, function (it) {
        if (!found && it && /\.StandardCommand\.(?!Add$)\w+$/i.test(String(prop(it, ['CommandName']) || '')))
            found = true;
    });
    return found;
}

function formCommandBar(model) {
    var hoisted = hoistedMainListItems(model);
    if (!hoisted.length && model) {
        walkFormItems({ childItems: model.childItemsRoot }, function (item) {
            if (!hoisted.length && item && item.tag === 'Table'
                && (tableSearchHoistedToForm(item, model) || tableSearchWithoutBarHoistedToForm(item, model)))
                hoisted.push(item.searchStringAddition);
        });
    }
    if (hoisted.length) {
        var hostBar = model.autoCommandBar;
        var hostCopy = { tag: 'AutoCommandBar', name: 'ФормаКоманднаяПанель', id: '-1', properties: {} };
        for (var hk in hostBar || {}) {
            if (Object.prototype.hasOwnProperty.call(hostBar, hk)) hostCopy[hk] = hostBar[hk];
        }
        var searchItems = hoisted.filter(function (it) { return it.tag === 'SearchStringAddition'; });
        var hoistedButtons = hoisted.filter(function (it) { return it.tag !== 'SearchStringAddition'; });
        hostCopy.childItems = hoistedButtons.concat((hostBar && hostBar.childItems) || [], searchItems);
        model = Object.create(model);
        model.autoCommandBar = hostCopy;
    }
    var bar = model && model.autoCommandBar;
    var std = formStdCommandButtons(model);
    if (!std.length) return normalizeRootFormBar(bar, model);
    var kids = (bar && bar.childItems) || [];
    var have = collectStdCommandKeys(kids);
    var extra = [];
    for (var i = 0; i < std.length; i++) {
        var key = stdCommandKey(std[i]);
        if (key && have[key]) continue;
        extra.push(std[i]);
    }
    if (!extra.length) return normalizeRootFormBar(bar, model);
    var merged = extra.concat(kids);
    if (!bar) {
        return normalizeRootFormBar({
            tag: 'AutoCommandBar',
            name: 'ФормаКоманднаяПанель',
            id: '-1',
            properties: {},
            childItems: merged
        }, model);
    }
    var copy = {};
    for (var k in bar) {
        if (Object.prototype.hasOwnProperty.call(bar, k)) copy[k] = bar[k];
    }
    copy.childItems = merged;
    return normalizeRootFormBar(copy, model);
}

function tableExcludes(table, names) {
    var list = table && table.properties && table.properties.ExcludedCommands;
    if (!list || !list.length) return false;
    var want = {};
    for (var i = 0; i < names.length; i++) want[String(names[i]).toLowerCase()] = true;
    for (var j = 0; j < list.length; j++) {
        if (want[String(list[j]).toLowerCase()]) return true;
    }
    return false;
}

function tableDataAttr(table, model) {
    var path = lastSeg(prop(table, ['DataPath']));
    if (!path || !model) return null;
    var attrs = formAttributes(model);
    if (!attrs.length) return null;
    for (var i = 0; i < attrs.length; i++) {
        if (attrs[i] && attrs[i].name === path) return attrs[i];
    }
    return null;
}

function tableIsDynamicList(table, model) {
    var attr = tableDataAttr(table, model);
    return !!(attr && /DynamicList|ДинамическийСписок/i.test(String(prop(attr, ['Type']) || '')));
}

/* SearchControlAddition (loupe) is painted only for a dynamic list, never
 * for a value table; in the form bar only for the main list. */
function searchControlForBar(search, bar) {
    var table = search && search._fpItem && search._fpItem._fpOwnerTable;
    var model = bar && bar._fpCtx && bar._fpCtx.model;
    if (!table || !model || !table.searchControlAddition) return null;
    if (additionHidden(table, 'SearchControlLocation') || !tableIsDynamicList(table, model)) return null;
    if (bar._fpFormRootBar) {
        var main = mainAttribute(model);
        if (!main || String(prop(table, ['DataPath']) || '') !== main.name) return null;
    }
    return table.searchControlAddition;
}

function makeSearchControlItem(item) {
    var wrap = el('div', 'fp-item fp-control fp-bar-item fp-search-control-item');
    wrap._fpItem = item;
    wrap.dataset.id = itemKey(item);
    wrap.dataset.tag = 'SearchControlAddition';
    var btn = el('button', 'fp-button fp-popup fp-search-control-btn');
    btn.type = 'button';
    btn.title = 'Управление поиском';
    btn.appendChild(svgIcon('search', 'fp-btn-icon'));
    var caret = el('span', 'fp-caret');
    caret.textContent = '▾';
    btn.appendChild(caret);
    wrap.appendChild(btn);
    return wrap;
}

function tableIsList(table, model) {
    var trep = String(prop(table, ['Representation']) || '').toLowerCase().replace(/[\s_-]+/g, '');
    var attr = tableDataAttr(table, model);
    if (attr && /DynamicList|ДинамическийСписок/i.test(String(prop(attr, ['Type']) || ''))) return true;
    /* A value table or tree attribute is an editable row set whatever its
     * Representation: Add/Move, not Create/Copy (e.g. an enum settings
     * form). */
    if (attr && /(^|:)(ValueTable|ValueTree|ТаблицаЗначений|ДеревоЗначений)$/i.test(String(prop(attr, ['Type']) || '').trim())) return false;
    /* Representation=List describes the table's visual mode too. A table
     * bound through the main object (Объект.ТабличнаяЧасть) is an editable
     * row set and therefore uses Add/Move, not a dynamic list's Create/Copy. */
    var path = String(prop(table, ['DataPath']) || '');
    var main = mainAttribute(model);
    var mainName = String(main && main.name || '');
    if (mainName && path.indexOf(mainName + '.') === 0) return false;
    return trep === 'list' || trep === 'tree' || trep === 'hierarchicallist';
}

function tableIsTree(table) {
    var trep = String(prop(table, ['Representation']) || '').toLowerCase().replace(/[\s_-]+/g, '');
    return trep === 'tree' || trep === 'hierarchicallist';
}

/* InitialTreeView says whether 1C opens the tree already unfolded. */
function treeExpanded(table) {
    var v = String(prop(table, ['InitialTreeView', 'НачальноеОтображениеДерева']) || '')
        .toLowerCase().replace(/[\s_-]+/g, '');
    if (!v) return false;
    /* NoExpand also contains "expand", so the negatives are checked first. */
    if (v.indexOf('no') === 0 || v.indexOf('dont') === 0 || v.indexOf('не') === 0) return false;
    return v.indexOf('expand') >= 0 || v.indexOf('разверн') >= 0;
}

function tableStdCommands(table, model) {
    var bar = table && table.autoCommandBar;
    if (bar && isFalse(prop(bar, ['Autofill']))) return [];
    var out = [];
    var isList = tableIsList(table, model);
    if (!table || !isFalse(prop(table, ['ChangeRowSet']))) {
        if (isList) {
            if (!tableExcludes(table, ['Create', 'Add']))
                out.push(syntheticBtn('_stdCreate', 'Создать', '', 'Text', {
                    CommandName: 'Form.StandardCommand.Create'
                }));
            if (!tableExcludes(table, ['Copy']))
                out.push(syntheticBtn('_stdCopy', 'Скопировать', 'StdPicture.CloneListItem', 'Picture', {
                    CommandName: 'Form.StandardCommand.Copy'
                }));
        } else if (!tableExcludes(table, ['Create', 'Add'])) {
            out.push(syntheticBtn('_stdAdd', 'Добавить', '', 'Text'));
        }
    }
    if (!isList && (!table || !isFalse(prop(table, ['ChangeRowOrder'])))) {
        /* Editable-table Add/Move actions use captions by default. An authored
         * button can still explicitly request Picture. */
        /* CommandSet exclusions apply to the move pair too: a table excluding
         * MoveUp/MoveDown gets a bar with Добавить only. */
        if (!tableExcludes(table, ['MoveUp']))
            out.push(syntheticBtn('_stdUp', 'Переместить вверх', '', 'Text'));
        if (!tableExcludes(table, ['MoveDown']))
            out.push(syntheticBtn('_stdDown', 'Переместить вниз', '', 'Text'));
    }
    return out;
}

function isAdditionTag(tag) {
    return tag === 'AutoCommandBar' || tag === 'SearchStringAddition'
        || tag === 'ViewStatusAddition' || tag === 'SearchControlAddition';
}

function additionHidden(item, locProp) {
    /* The chart of accounts' ExtDimensionTypes collection is not a searchable
     * tabular section: the reference paints neither the search string nor the filter
     * labels over «Виды субконто», whatever the additions say. */
    if (item && item.tag === 'Table' && /\.ExtDimensionTypes$/i.test(String(prop(item, ['DataPath']) || ''))
        && /^(?:SearchStringLocation|ViewStatusLocation|SearchControlLocation)$/.test(locProp)) return true;
    var v = String(prop(item, [locProp]) || '').toLowerCase().replace(/[\s_-]+/g, '');
    return v === 'none' || v.indexOf('нет') >= 0;
}

function isInCellGroup(it) {
    var g = String(prop(it, ['Group']) || '').toLowerCase().replace(/[\s_-]+/g, '');
    return g.indexOf('incell') >= 0 || g.indexOf('вячейк') >= 0;
}

function isHeaderGroup(it) {
    return it && it.tag === 'ColumnGroup' && !isInCellGroup(it) && isTrue(prop(it, ['ShowInHeader']));
}

/* ColumnGroup.Group defaults to Vertical in a managed form. Such a group is
 * one physical table column whose children are stacked in the header/cell.
 * Flattening an omitted Group made the children look like adjacent columns. */
function isVerticalColumnGroup(it) {
    if (!it || it.tag !== 'ColumnGroup' || isInCellGroup(it) || isHeaderGroup(it)) return false;
    var group = String(prop(it, ['Group']) || 'Vertical').toLowerCase().replace(/[\s_-]+/g, '');
    if (!(group === 'vertical' || group.indexOf('вертик') >= 0)) return false;
    /* A vertical stack whose only header row is a horizontal group (the
     * others ShowInHeader=false) is just that row of columns. */
    var shown = (it.childItems || []).filter(function (child) {
        return child && !SKIP_TAGS[child.tag] && !isAdditionTag(child.tag)
            && !isFalse(prop(child, ['ShowInHeader'])) && !isFalse(prop(child, ['Visible', 'visible']));
    });
    if (shown.length === 1 && shown[0].tag === 'ColumnGroup' && !isInCellGroup(shown[0])
        && !isHeaderGroup(shown[0])
        && /^horizontal$|горизонт/i.test(String(prop(shown[0], ['Group']) || ''))
        && (shown[0].childItems || []).filter(function (leaf) {
            return leaf && !SKIP_TAGS[leaf.tag] && !isAdditionTag(leaf.tag)
                && !isFalse(prop(leaf, ['ShowInHeader'])) && !isFalse(prop(leaf, ['Visible', 'visible']));
        }).length > 1) return false;
    return true;
}

function headerKids(group) {
    var out = [];
    function walk(list) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (!it || SKIP_TAGS[it.tag] || isAdditionTag(it.tag)) continue;
            /* A hidden column owns no header row (e.g. hidden columns under a
             * vertical group). */
            if (isFalse(prop(it, ['ShowInHeader'])) || isFalse(prop(it, ['Visible', 'visible']))) continue;
            if (it.tag === 'ColumnGroup') {
                if (isInCellGroup(it) || isHeaderGroup(it) || isVerticalColumnGroup(it)) out.push(it);
                else walk(it.childItems);
                continue;
            }
            out.push(it);
        }
    }
    walk(group && group.childItems);
    return out;
}

function inCellCaption(group, ctx) {
    if (isTrue(prop(group, ['ShowInHeader']))) {
        var gt = rawTitle(group);
        if (gt) return gt;
    }
    var parts = [];
    var hasGlyph = false;
    var kids = group.childItems || [];
    for (var i = 0; i < kids.length; i++) {
        var it = kids[i];
        if (!it || isFalse(prop(it, ['ShowInHeader']))) continue;
        var pic = pictureRef(it) || prop(it, ['HeaderPicture']);
        if (it.tag === 'PictureField' || (pic && (titleLocation(it) === 'none' || !rawTitle(it)))) {
            hasGlyph = true;
            continue;
        }
        if (titleLocation(it) === 'none') continue;
        var cap = columnCaption(it, ctx);
        if (cap) parts.push(cap);
    }
    if (parts.length) return parts.join(hasGlyph ? ' ' : ', ');
    return rawTitle(group) || '';
}

function tableColumns(item) {
    var out = [];
    function walk(list) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (!it || SKIP_TAGS[it.tag] || isAdditionTag(it.tag)
                || isFalse(prop(it, ['Visible', 'visible']))) continue;
            if (it.tag === 'ColumnGroup') {
                if (isInCellGroup(it) || isHeaderGroup(it) || isVerticalColumnGroup(it)) out.push(it);
                else walk(it.childItems);
                continue;
            }
            out.push(it);
        }
    }
    walk(item && item.childItems);
    return out;
}

/* Columns hidden from a grouped header are still real data columns. Header
 * visibility only suppresses their captions; it must not collapse the cells
 * or discard their configured widths. */
function tablePhysicalColumns(item) {
    var out = [];
    function walk(list) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (!it || SKIP_TAGS[it.tag] || isAdditionTag(it.tag)
                || isFalse(prop(it, ['Visible', 'visible']))) continue;
            if (it.tag === 'ColumnGroup' && !isInCellGroup(it) && !isVerticalColumnGroup(it)) {
                walk(it.childItems);
                continue;
            }
            out.push(it);
        }
    }
    walk(item && item.childItems);
    return out;
}

function headerShownChildren(it) {
    return (it && it.childItems || []).filter(function (child) {
        return child && !SKIP_TAGS[child.tag] && !isAdditionTag(child.tag)
            && !isFalse(prop(child, ['ShowInHeader'])) && !isFalse(prop(child, ['Visible', 'visible']));
    });
}

function isPlainHorizontalColumnGroup(it) {
    return !!(it && it.tag === 'ColumnGroup' && !isInCellGroup(it) && !isHeaderGroup(it)
        && /^horizontal$|горизонт/i.test(String(prop(it, ['Group']) || '')));
}

/* A vertical ColumnGroup whose stack holds a horizontal subgroup of several
 * columns spans those physical columns: in [Регистратор, (Период|Номер
 * строки|...)] the reference paints «Регистратор» over the subgroup's
 * columns. */
function isSpanningVerticalColumnGroup(it) {
    if (!isVerticalColumnGroup(it)) return false;
    var kids = headerShownChildren(it);
    for (var i = 0; i < kids.length; i++)
        if (isPlainHorizontalColumnGroup(kids[i]) && headerShownChildren(kids[i]).length > 1) return true;
    return false;
}

function tableHasSpanningColumnGroups(item) {
    var found = false;
    function walk(list) {
        if (!list || found) return;
        for (var i = 0; i < list.length && !found; i++) {
            var it = list[i];
            if (!it || it.tag !== 'ColumnGroup' || isFalse(prop(it, ['Visible', 'visible']))) continue;
            if (isInCellGroup(it)) continue;
            if (isSpanningVerticalColumnGroup(it)) { found = true; return; }
            walk(it.childItems);
        }
    }
    walk(item && item.childItems);
    return found;
}

function tableHeaderCell(item, col, span, row, rowSpan, group) {
    return { item: item, col: col, span: span, row: row, rowSpan: rowSpan, group: !!group, bottom: true };
}

/* Horizontal composition: parts side by side; the bottom cells of a shorter
 * part stretch down to the tallest part. */
function tableHeaderGridLayout(list) {
    var cols = [];
    var cells = [];
    var parts = [];
    var rows = 0;
    for (var i = 0; list && i < list.length; i++) {
        var it = list[i];
        if (!it || SKIP_TAGS[it.tag] || isAdditionTag(it.tag)
            || isFalse(prop(it, ['Visible', 'visible']))) continue;
        var part = tableHeaderNodeLayout(it);
        if (!part.cols.length) continue;
        parts.push({ offset: cols.length, layout: part });
        cols = cols.concat(part.cols);
        rows = Math.max(rows, part.rows);
    }
    for (var p = 0; p < parts.length; p++) {
        var pc = parts[p].layout.cells;
        for (var c = 0; c < pc.length; c++) {
            var cell = pc[c];
            cell.col += parts[p].offset;
            if (cell.bottom) cell.rowSpan = rows - cell.row;
            cells.push(cell);
        }
    }
    return { cols: cols, cells: cells, rows: rows };
}

function tableHeaderNodeLayout(it) {
    if (it.tag !== 'ColumnGroup' || isInCellGroup(it)) {
        var leafRows = it.tag === 'ColumnGroup' ? 1 : Math.max(1, parseInt(prop(it, ['HeaderHeight']), 10) || 1);
        return { cols: [it], cells: [tableHeaderCell(it, 0, 1, 0, leafRows, false)], rows: leafRows };
    }
    if (isHeaderGroup(it)) {
        var inner = tableHeaderGridLayout(it.childItems);
        if (!inner.cols.length || !headerKids(it).length)
            return { cols: inner.cols.length ? inner.cols : [it],
                cells: [tableHeaderCell(it, 0, Math.max(1, inner.cols.length), 0, 1, true)], rows: 1 };
        var hc = [tableHeaderCell(it, 0, inner.cols.length, 0, 1, true)];
        hc[0].bottom = false;
        for (var i = 0; i < inner.cells.length; i++) {
            inner.cells[i].row += 1;
            hc.push(inner.cells[i]);
        }
        return { cols: inner.cols, cells: hc, rows: inner.rows + 1 };
    }
    if (isSpanningVerticalColumnGroup(it)) {
        var kids = headerShownChildren(it);
        var partLayouts = [];
        var widest = null;
        for (var k = 0; k < kids.length; k++) {
            var pl = tableHeaderNodeLayout(kids[k]);
            if (!pl.cols.length) continue;
            partLayouts.push(pl);
            if (!widest || pl.cols.length > widest.cols.length) widest = pl;
        }
        if (!widest) return { cols: [it], cells: [tableHeaderCell(it, 0, 1, 0, 1, false)], rows: 1 };
        var width = widest.cols.length;
        var stacked = [];
        var rowOffset = 0;
        for (var s = 0; s < partLayouts.length; s++) {
            var part = partLayouts[s];
            var last = null;
            for (var pc = 0; pc < part.cells.length; pc++) {
                var cell = part.cells[pc];
                if (!last || cell.col + cell.span > last.col + last.span) last = cell;
            }
            for (var pc2 = 0; pc2 < part.cells.length; pc2++) {
                var cc = part.cells[pc2];
                if (last && (cc === last || cc.col + cc.span === last.col + last.span))
                    cc.span = width - cc.col;
                cc.row += rowOffset;
                if (s < partLayouts.length - 1) cc.bottom = false;
                stacked.push(cc);
            }
            rowOffset += part.rows;
        }
        return { cols: widest.cols, cells: stacked, rows: rowOffset };
    }
    if (isVerticalColumnGroup(it)) {
        var vk = headerKids(it);
        if (!vk.length) return { cols: [it], cells: [tableHeaderCell(it, 0, 1, 0, 1, false)], rows: 1 };
        var vc = [];
        for (var v = 0; v < vk.length; v++) {
            var vcell = tableHeaderCell(vk[v], 0, 1, v, 1, false);
            vcell.bottom = v === vk.length - 1;
            vc.push(vcell);
        }
        return { cols: [it], cells: vc, rows: vk.length };
    }
    return tableHeaderGridLayout(it.childItems);
}

function radioOptions(item) {
    var list = item && item.properties && item.properties.ChoiceListItems;
    if (list && list.length) return list.slice();
    /* A runtime-filled radio has no design-time items; the reference shows one
     * «<Значение N>» placeholder per authored column (ColumnsCount 2 gives
     * two), and three without ColumnsCount (radio buttons and tumbler alike). */
    var columns = parseInt(prop(item, ['ColumnsCount']), 10) || 3;
    var placeholders = [];
    for (var i = 1; i <= Math.min(columns, 8); i++) placeholders.push('<Значение ' + i + '>');
    return placeholders;
}

/* A boolean tumbler can replace the generic switch with two textual states.
 * 1C stores them in EditFormat (BT/BF or localized БИ/БЛ keys). */
function booleanTumblerOptions(item) {
    var fmt = prop(item, ['EditFormat', 'ФорматРедактирования']);
    if (!fmt) return [];
    var values = {};
    var re = /(?:^|;)\s*(BT|BF|БИ|БЛ)\s*=\s*(?:(['"])(.*?)\2|([^;]*?))\s*(?=;|$)/gi;
    var match;
    while ((match = re.exec(fmt)))
        values[match[1].toUpperCase()] = String(match[3] || match[4] || '').trim();
    var trueLabel = values.BT || values['БИ'] || '';
    var falseLabel = values.BF || values['БЛ'] || '';
    /* The managed-form tumbler lays out the enabled/True presentation first,
     * followed by the disabled/False presentation. This order is independent
     * of the unavailable runtime value. */
    return trueLabel && falseLabel ? [trueLabel, falseLabel] : [];
}

function firstVisibleColumnCaption(group, ctx) {
    var kids = group && group.childItems || [];
    for (var i = 0; i < kids.length; i++) {
        var child = kids[i];
        if (!child || SKIP_TAGS[child.tag] || isAdditionTag(child.tag)
            || isFalse(prop(child, ['Visible', 'visible']))) continue;
        if (child.tag === 'ColumnGroup') {
            var nested = firstVisibleColumnCaption(child, ctx);
            if (nested) return nested;
            continue;
        }
        if (isFalse(prop(child, ['ShowInHeader']))) continue;
        var caption = columnCaption(child, ctx);
        if (caption) return caption;
    }
    return '';
}

function columnCaption(col, ctx) {
    if (col && col.tag === 'ColumnGroup') {
        if (isInCellGroup(col)) return inCellCaption(col, ctx);
        /* A vertical group is represented by one physical column. Unless the
         * group explicitly owns the header, 1C uses the first visible child
         * caption (for example "Период" rather than "Даты начисления"). */
        if (isVerticalColumnGroup(col) && !isTrue(prop(col, ['ShowInHeader']))) {
            var childCaption = firstVisibleColumnCaption(col, ctx);
            if (childCaption) return childCaption;
        }
        return rawTitle(col) || titleOf(col, ctx) || col.name || '';
    }
    var loc = titleLocation(col);
    if (loc === 'none' || isFalse(prop(col, ['ShowInHeader']))) {
        if (col.tag === 'PictureField' || pictureRef(col) || prop(col, ['HeaderPicture'])) return '';
        if (loc === 'none') return '';
    }
    var t = titleOf(col, ctx);
    if (t) return t;
    var path = lastSeg(prop(col, ['DataPath']));
    if (path === 'LineNumber') return 'N';
    if (PATH_CAPTIONS[path]) return PATH_CAPTIONS[path];
    if (path) return path;
    return col.name || '';
}

function rawTitle(item) {
    return prop(item, ['Title', 'Заголовок']);
}

function titleOf(item, ctx) {
    if (!item) return '';
    var t = rawTitle(item);
    if (t) return t;
    var tag = item.tag || '';
    if (tag === 'LabelDecoration' || tag === 'PictureDecoration') return '';
    if (item._fpUnresolvedCommand) return String(item.name || '');
    var ownSearch = ownTableSearchCommand(item);
    if (ownSearch) return OWN_TABLE_SEARCH_TITLES[ownSearch];
    var cmd = prop(item, ['CommandName', 'Command']);
    if (cmd) {
        var short = lastSeg(cmd);
        if (/^CommonCommand\./i.test(String(cmd))) {
            var commonTitle = commandMeta(item, ctx, 'title');
            if (commonTitle) return commonTitle;
        } else if (ctx && ctx.commandTitles && ctx.commandTitles[short]) return ctx.commandTitles[short];
        /* Another object's command (Report.X.Command.Y): its synonym, keyed by fqn. */
        if (/^\w+\.[^.]+\.Command\.[^.]+$/.test(String(cmd))) {
            var foreignCmd = ctx && ctx.model && ctx.model.commonCommands && ctx.model.commonCommands[String(cmd)];
            var foreignTitle = foreignCmd && rawTitle(foreignCmd);
            if (foreignTitle) return foreignTitle;
        }
        var ownerCmd = /^(\w+)\.([^.]+)\.StandardCommand\.(OpenList|Create)$/.exec(String(cmd));
        var ownerMeta = ownerCmd && ctx && ctx.model && ctx.model.refMeta
            && ctx.model.refMeta[ownerCmd[1] + '.' + ownerCmd[2]];
        if (ownerMeta) {
            if (ownerCmd[3] === 'OpenList') return ownerMeta.listPresentation || ownerMeta.synonym || ownerCmd[2];
            if (ownerMeta.synonym) return ownerMeta.synonym;
        }
        if (STD_COMMANDS[short]) return STD_COMMANDS[short];
    }
    var path = prop(item, ['DataPath']);
    var cap = captionForPath(path, ctx && ctx.captionIndex);
    if (cap) return cap;
    var seg = lastSeg(path);
    if (PATH_CAPTIONS[seg]) return PATH_CAPTIONS[seg];
    /* An object requisite without a synonym is captioned by its name as
     * written («VINШасси:», a column «СрокВыполнения»); a dynamic list field
     * is still split into words («Точка маршрута»). */
    if (seg && /^(?:Объект|Object|Запись|Record)\./.test(String(path))) return seg;
    if (seg) return humanizeIdent(seg);
    if (item.name) return humanizeIdent(item.name);
    return '';
}

function displayLabel(item, ctx, tag) {
    if (titleLocation(item) === 'none') return '';
    var t = titleOf(item, ctx);
    if (t) return t;
    var rep = representationOf(item);
    if (rep === 'picture') return '';
    if (tag === 'InputField' || tag === 'CheckBoxField')
        return humanizeIdent(item.name || '');
    return '';
}

function groupBehavior(item) {
    var v = String(prop(item, ['Behavior', 'Поведение']) || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (v === 'popup' || v.indexOf('всплыв') >= 0) return 'popup';
    if (v === 'collapsible' || v.indexOf('свертываем') >= 0 || v.indexOf('сворачиваем') >= 0)
        return 'collapsible';
    return 'usual';
}

function initiallyCollapsed(item) {
    /* The configurator keeps collapsible groups expanded so their children
     * remain editable. Collapsed controls runtime startup, not designer view. */
    return false;
}

function isPopUpGroup(item) {
    return groupBehavior(item) === 'popup';
}

function showGroupTitle(item) {
    if (isPopUpGroup(item)) return !!rawTitle(item);
    var raw = prop(item, ['ShowTitle', 'ПоказыватьЗаголовок']);
    if (raw && isFalse(raw)) return false;
    return !!rawTitle(item);
}

function titleLocation(item, parentMeta) {
    var v = String(prop(item, ['TitleLocation', 'ПоложениеЗаголовка']) || '').toLowerCase().replace(/[ _-]+/g, '');
    /* Auto captions start on the left. 1C only moves them above the field when
     * a horizontal row actually runs out of room; that responsive pass happens
     * after layout in promoteOverflowingAutoTitles(). */
    /* A one-column radio list puts its Auto caption above the options; a row
     * of options (ColumnsCount omitted) keeps it on the left. */
    if (!v && item && item.tag === 'RadioButtonField'
        && String(prop(item, ['ColumnsCount', 'КоличествоКолонок']) || '') === '1'
        && !/tumbler|тумблер/i.test(String(prop(item, ['RadioButtonType', 'ВидПереключателя']) || '')))
        return 'top';
    if (!v) return 'left';
    if (v === 'none' || v.indexOf('нет') >= 0) return 'none';
    if (v === 'right' || v.indexOf('прав') >= 0) return 'right';
    if (v === 'top' || v.indexOf('верх') >= 0) return 'top';
    if (v === 'bottom' || v.indexOf('низ') >= 0) return 'bottom';
    return 'left';
}

function itemKey(it) {
    if (!it) return '';
    return it.id != null && String(it.id) !== '' ? String(it.id) : String(it.name || '');
}

function safeId(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_'); }

function isContainer(tag) { return !!(tag && CONTAINER_TAGS[tag]); }

function spacingUnits(kind, axis) {
    if (!kind) return null;
    if (kind === 'auto') return null;
    var scale = axis === 'vertical'
        ? TAXI_LAYOUT_METRICS.verticalSpacing
        : TAXI_LAYOUT_METRICS.horizontalSpacing;
    return Object.prototype.hasOwnProperty.call(scale, kind) ? scale[kind] : null;
}

function spacingPx(kind, axis) {
    if (!kind || kind === 'auto') return null;
    var scale = axis === 'vertical'
        ? TAXI_BROWSER_METRICS.verticalSpacing
        : TAXI_BROWSER_METRICS.horizontalSpacing;
    return Object.prototype.hasOwnProperty.call(scale, kind) ? scale[kind] : null;
}

function normGroupMode(raw) {
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!v) return '';
    if (v.indexOf('autoscreentypesensitive') >= 0
        || v.indexOf('автозавис') >= 0) return 'auto-screen-sensitive';
    if (v.indexOf('horizontalifpossible') >= 0
        || v.indexOf('горизонтальноесливозможно') >= 0) return 'horizontal-if-possible';
    if (v.indexOf('alwayshorizontal') >= 0
        || v.indexOf('всегдагоризонт') >= 0) return 'always-horizontal';
    if (v === 'auto' || v === 'авто') return 'auto';
    if (v.indexOf('horizontal') >= 0 || v.indexOf('horiz') >= 0 || v === 'row'
        || v.indexOf('leftright') >= 0 || v.indexOf('горизонт') >= 0 || v.indexOf('слеванаправо') >= 0)
        return 'horizontal';
    if (v.indexOf('vertical') >= 0 || v.indexOf('vert') >= 0 || v === 'column'
        || v.indexOf('topbottom') >= 0 || v.indexOf('вертикал') >= 0 || v.indexOf('сверхувниз') >= 0)
        return 'vertical';
    return '';
}

function normOrient(raw) {
    var mode = normGroupMode(raw);
    if (mode === 'vertical') return 'vertical';
    if (mode === 'horizontal' || mode === 'horizontal-if-possible'
        || mode === 'always-horizontal' || mode === 'auto-screen-sensitive') return 'horizontal';
    return null;
}

function normSpacing(raw) {
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!v) return '';
    if (v === 'auto' || v === 'авто') return 'auto';
    if (v === 'none' || v === 'нет') return 'none';
    if (v.indexOf('oneandhalf') >= 0 || v.indexOf('полутор') >= 0) return 'oneandhalf';
    if (v.indexOf('double') >= 0 || v.indexOf('двойн') >= 0) return 'double';
    if (v.indexOf('half') >= 0 || v.indexOf('половин') >= 0) return 'half';
    return 'single';
}

function normWidth(raw) {
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!v) return '';
    if (v === 'equal' || v.indexOf('равн') >= 0) return 'equal';
    if ((v.indexOf('left') >= 0 && v.indexOf('wide') >= 0) || v === 'leftwidest') return 'leftwidest';
    if ((v.indexOf('right') >= 0 && v.indexOf('wide') >= 0) || v === 'rightwidest') return 'rightwidest';
    return '';
}

function normThrough(raw) {
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (!v || v === 'auto' || v === 'авто') return 'auto';
    if (v.indexOf('dont') >= 0 || v.indexOf('неиспользов') >= 0 || v === 'no') return 'dontuse';
    if (v.indexOf('use') >= 0 || v === 'yes' || v === 'да') return 'use';
    return 'auto';
}

function normGroupRepresentation(raw) {
    var v = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    /* UsualGroupRepresentation is an EMF enum whose first/default literal is
     * None. An omitted XML value therefore is not the newer explicit Auto. */
    if (!v || v === 'none' || v === 'нет') return 'none';
    if (v.indexOf('strong') >= 0 || v.indexOf('сильн') >= 0) return 'strong-separation';
    if (v.indexOf('weak') >= 0 || v.indexOf('слаб') >= 0) return 'weak-separation';
    if (v.indexOf('normal') >= 0 || v.indexOf('обычн') >= 0) return 'normal-separation';
    return 'auto';
}

function effectiveThroughAlign(item, mode) {
    /* The reference logical-group preparation first requires United. Collapsible and
     * popup behavior disable through alignment after enum resolution. On the
     * desktop Taxi path Auto is true only for Representation=None. */
    if (isFalse(prop(item, ['United', 'Объединять']))) return 'dontuse';
    if (groupBehavior(item) !== 'usual') return 'dontuse';
    if (mode === 'use') return 'use';
    if (mode === 'dontuse') return 'dontuse';
    return normGroupRepresentation(prop(item, ['Representation', 'Отображение'])) === 'none'
        ? 'use' : 'dontuse';
}

function alignFlex(raw, kind) {
    var v = String(raw || '').toLowerCase();
    if (!String(raw || '').trim()) return '';
    if (v.indexOf('center') >= 0 || v.indexOf('центр') >= 0) return 'center';
    if (kind === 'h') {
        if (v.indexOf('right') >= 0 || v.indexOf('конец') >= 0 || v.indexOf('прав') >= 0) return 'flex-end';
        if (v.indexOf('left') >= 0 || v.indexOf('начал') >= 0 || v.indexOf('лев') >= 0) return 'flex-start';
    } else {
        if (v.indexOf('bottom') >= 0 || v.indexOf('низ') >= 0) return 'flex-end';
        if (v.indexOf('top') >= 0 || v.indexOf('верх') >= 0) return 'flex-start';
    }
    return '';
}

function defaultContainerOrientation(tag) {
    if (tag === 'UsualGroup' || tag === 'Group' || tag === 'CollapsibleGroup')
        return 'horizontal';
    return 'vertical';
}

function defaultContainerGroupMode(tag) {
    /* The reference's ordinary-group default is HorizontalIfPossible. Treating an
     * omitted Group as fixed Horizontal made the browser skip the same
     * responsive vertical fallback that the generated layout input receives. */
    if (tag === 'UsualGroup' || tag === 'Group' || tag === 'CollapsibleGroup'
        || tag === 'ButtonGroup' || tag === 'ColumnGroup')
        return 'horizontal-if-possible';
    return defaultContainerOrientation(tag);
}

function isLogicalSubgridGroup(item) {
    return String((item && item.tag) || '') === 'UsualGroup'
        && representationOf(item) === 'none'
        && isFalse(prop(item, ['United', 'Объединять']))
        && groupBehavior(item) === 'usual'
        && !tooltipText(item);
}

function isOrdinaryLayoutContainerTag(tag) {
    return tag === 'Form' || tag === 'UsualGroup' || tag === 'Group'
        || tag === 'CollapsibleGroup' || tag === 'Page';
}

/* UsualGroupRepresentation omitted XML is None, not Auto. representationOf()
 * still maps empty → Auto because buttons/fields use that enum. Group chrome
 * (fp-bare vs 4px item shell, group-bare vs group-block) must follow the EMF
 * group default — otherwise wrapper groups sit 4px taller than the
 * reference per omitted parent. */
function groupPaintIsNone(item) {
    var tag = String((item && item.tag) || '');
    if (tag === 'UsualGroup' || tag === 'Group' || tag === 'CollapsibleGroup')
        return normGroupRepresentation(prop(item, ['Representation', 'Отображение'])) === 'none';
    return representationOf(item) === 'none';
}

function isSpecialRowLayoutTag(tag) {
    return tag === 'Button' || tag === 'Hyperlink' || tag === 'Popup'
        || tag === 'RadioButtonField' || tag === 'RadioButton' || tag === 'Table'
        || tag === 'AutoCommandBar' || tag === 'CommandBar' || tag === 'ButtonGroup';
}

function authoredContainerHeightUsesIntrinsicFloor(item) {
    if (!item || !isContainer(item.tag || '')) return false;
    return (item.childItems || []).some(function (child) {
        return child && !isFalse(prop(child, ['Visible', 'visible']))
            && !isAdditionTag(child.tag)
            && (isSpecialRowLayoutTag(child.tag) || containsDesignerInlinePopUp(child));
    });
}

/* The reference's designer expands a vertical PopUp group in place, so an authored
 * Height on any ordinary ancestor is only a floor: clipping it to one row lets
 * the expanded body overlay the following siblings. */
function containsDesignerInlinePopUp(item) {
    if (!item || !isContainer(item.tag || '')) return false;
    if (isPopUpGroup(item) && normGroupMode(prop(item, ['Group', 'Группа'])) === 'vertical') return true;
    return visibleLayoutChildren(item).some(containsDesignerInlinePopUp);
}

function isEmptyLabelDecoration(item) {
    return !!(item && item.tag === 'LabelDecoration' && !rawTitle(item));
}

function visibleLayoutChildren(item) {
    return item && item.childItems ? item.childItems.filter(function (child) {
        return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
    }) : [];
}

function firstLayoutLeaf(item) {
    var current = item;
    for (var i = 0; i < 12 && current && isContainer(current.tag || ''); i++) {
        var kids = visibleLayoutChildren(current);
        if (!kids.length) return current;
        current = kids[0];
    }
    return current;
}

function isRadioLayoutLeaf(item) {
    var leaf = firstLayoutLeaf(item);
    return !!(leaf && (leaf.tag === 'RadioButtonField' || leaf.tag === 'RadioButton'));
}

function isEditorLayoutLeaf(item) {
    var leaf = firstLayoutLeaf(item);
    var tag = leaf && leaf.tag;
    return tag === 'InputField' || tag === 'CheckBoxField' || tag === 'LabelField';
}

function isTitledDecorationLeaf(item) {
    var leaf = firstLayoutLeaf(item);
    return !!(leaf && (leaf.tag === 'LabelDecoration' || leaf.tag === 'PictureDecoration')
        && !isEmptyLabelDecoration(leaf));
}

function pictureDecorationIconId(ref) {
    /* An unresolved decoration is an empty image surface in the reference. The generic
     * `photo` glyph is useful for command discovery, but turns absent metric
     * pictures into four visible fake icons in the rendered form. */
    var icon = iconIdFromRef(ref);
    return icon === 'photo' ? '' : icon;
}

function emptyDecorationIsCompactInParent(item, parentMeta) {
    /* With explicit VerticalSpacing=None an empty decoration contributes
     * only the compact logical spacer track. Omitted spacing is different:
     * the reference retains such a decoration as an authored section spacer. */
    if (!parentMeta || parentMeta.orientation !== 'vertical'
        || parentMeta.verticalSpacing !== 'none') return false;
    return isEmptyLabelDecoration(item);
}

/* Omitted VerticalSpacing keeps ordinary sibling controls on the compact
 * three-pixel cadence, but an authored spacer or the edge of a radio section
 * establishes the normal Taxi section boundary. Consecutive radio fields stay
 * compact; only the transition between a leaf section and its wrapper grows. */
function omittedVerticalSectionBoundary(previous, current, parent) {
    if (!previous || !current || !parent || layoutMeta(parent).orientation !== 'vertical'
        || String(prop(parent, ['VerticalSpacing', 'ВертикальныйИнтервал']) || '').trim()) return false;
    if (isRadioLayoutLeaf(previous) && isRadioLayoutLeaf(current)) return false;
    if (isRadioLayoutLeaf(previous) && isEditorLayoutLeaf(current)) return false;
    var prevLeaf = firstLayoutLeaf(previous);
    var currIsRadio = isRadioLayoutLeaf(current);
    var prevLeafIsField = !!(prevLeaf && !isContainer(prevLeaf.tag || ''));
    /* A dissolved Pages=None checkbox is a field, not a section
     * wrapper. Radio-edge 7px is for an empty/structural group or a titled
     * decoration wrapper, not for checkbox/input then radio. */
    if (prevLeafIsField && currIsRadio) {
        if (isEmptyLabelDecoration(previous) || isEmptyLabelDecoration(prevLeaf)) return true;
        return isTitledDecorationLeaf(previous) && isContainer(previous.tag || '')
            && previous.tag !== 'Pages';
    }
    var previousContainer = isContainer(previous.tag || '');
    var currentContainer = isContainer(current.tag || '');
    /* Representation=NormalSeparation is a Taxi section. Entering or leaving
     * it uses Single (9px), not the 3px compact field cadence, on both sides:
     * a None group followed by a NormalSeparation block also gets 9px.
     * Checking only the previous sibling leaves the block 10px too high
     * with the 34px row cadence. */
    if (previousContainer && currentContainer) {
        return (layoutMeta(previous).separated || layoutMeta(current).separated)
            && !isRadioLayoutLeaf(previous);
    }
    if (previousContainer === currentContainer) return false;
    return isEmptyLabelDecoration(previous)
        || previous.tag === 'RadioButtonField' || previous.tag === 'RadioButton'
        || current.tag === 'RadioButtonField' || current.tag === 'RadioButton';
}

function omittedVerticalSectionSpacing(previous, current) {
    var radioEdge = previous && (previous.tag === 'RadioButtonField' || previous.tag === 'RadioButton')
        || current && (current.tag === 'RadioButtonField' || current.tag === 'RadioButton')
        || isRadioLayoutLeaf(previous) || isRadioLayoutLeaf(current);
    /* The source radio edge is projected through both its RichElement lane and
     * the following wrapper. Each projected boundary contributes 7px; together
     * they reproduce the reference's section cadence without doubling the full 9px step.
     * Empty authored spacers still establish the full Single section step. */
    return radioEdge ? 7
        : TAXI_LAYOUT_METRICS.verticalSpacing.single;
}

function applyOmittedVerticalSectionBoundaries(box, parent) {
    if (!box || !box.children || !parent) return 0;
    /* The boundary tops the compact 3px cadence up to Single; the form root
     * already stacks its rows 9px apart (adding both gave 15px). */
    if (box.classList && box.classList.contains('fp-body')) return 0;
    var previous = null;
    var changed = 0;
    for (var i = 0; i < box.children.length; i++) {
        var node = box.children[i];
        if (!node.classList || !node.classList.contains('fp-item') || !node._fpItem) continue;
        if (omittedVerticalSectionBoundary(previous, node._fpItem, parent)) {
            var extra = omittedVerticalSectionSpacing(previous, node._fpItem)
                - TAXI_LAYOUT_METRICS.compactRowGap;
            /* Two wrappers already sit on the compact 3px row-gap. Subtracting
             * it again would leave the row 3px above the reference. */
            if (previous && isContainer(previous.tag || '')
                && isContainer(node._fpItem.tag || '')
                && isTitledDecorationLeaf(previous) && isRadioLayoutLeaf(node._fpItem))
                extra = omittedVerticalSectionSpacing(previous, node._fpItem);
            node.style.marginTop = extra + 'px';
            changed++;
        }
        previous = node._fpItem;
    }
    return changed;
}

function isOrdinaryRowControl(tag, parentMeta, inBar) {
    if (inBar || !parentMeta) return false;
    /* A fixed editor followed by its authored CommandBar is one native Taxi
     * row: the 25 px TextBox and 27 px bar share a 27 px flow band. The
     * transparent editor-selection shell must not inflate it to 29 px. */
    if (parentMeta.authoredFieldCommandRow) return !isSpecialRowLayoutTag(tag);
    if (!parentMeta.compactOrdinaryRows) return false;
    /* These controls own a special internal row/stack contract. Their wrapper
     * is deliberately left alone; only ordinary field/decorative shells are
     * paint-only in the compact source row. */
    return !isSpecialRowLayoutTag(tag);
}

function automaticCompoundSelectorChildren(visibleKids, groupMode) {
    if (!visibleKids || groupMode !== 'horizontal-if-possible' || visibleKids.length < 4)
        return [];
    var selectors = [];
    for (var i = 0; i < visibleKids.length; i++) {
        var child = visibleKids[i];
        if (child.tag !== 'InputField'
            || !isTrue(prop(child, ['ListChoiceMode']))
            || prop(child, ['HorizontalStretch', 'ГоризонтальноеРастягивание'])
            || charSize(prop(child, ['Width', 'Ширина']))
            || charSize(prop(child, ['MaxWidth', 'МаксимальнаяШирина']))) break;
        selectors.push(child);
    }
    if (selectors.length < 3 || !rawTitle(selectors[0])
        || titleLocation(selectors[0]) === 'none') return [];
    for (var s = 1; s < selectors.length; s++) {
        if (titleLocation(selectors[s]) !== 'none') return [];
    }
    /* A repeated selector tuple is one compound value followed by another
     * titled field. The trailing caption is the semantic boundary; without
     * it this is an ordinary sequence of independent fields. */
    var trailing = visibleKids.slice(selectors.length);
    if (!trailing.length || !trailing.every(function (child) {
        return child.tag === 'InputField' && titleLocation(child) !== 'none';
    })) return [];
    return selectors;
}

/* A pane the reference may put a splitter beside: more than one logical row high — a
 * multi-line element, or a group of several rows (the reference splitter rule;
 * whether it stretches is decided by the rendered fp-hstretch class). */
var SPLITTER_MULTILINE_TAGS = {
    Table: 1, TextDocumentField: 1, SpreadSheetDocumentField: 1, FormattedDocumentField: 1,
    HTMLDocumentField: 1, GraphicalSchemaField: 1, PlannerField: 1, ChartField: 1,
    GanttChartField: 1, DendrogramField: 1, Pages: 1
};
/* Stretch of the element itself: ChildItemsWidth=Equal shares the row but
 * gives a column no stretch of its own (a group holding only fixed fields
 * gets no splitter beside it in the reference). */
function ownHorizontalStretch(item, tag, parentMeta, ctx) {
    var plain = {};
    for (var key in parentMeta || {})
        if (Object.prototype.hasOwnProperty.call(parentMeta, key)) plain[key] = parentMeta[key];
    plain.childItemsWidth = '';
    return wantsHStretch(item, tag, plain, ctx) || carriesWrappingText(item);
}

/* Wrapping text stretches its column: a dynamic-height LabelDecoration or an
 * extended tooltip painted on the form (two columns with ShowAuto hints get
 * a splitter between them in the reference). */
function carriesWrappingText(item) {
    if (!item || isFalse(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))) return false;
    if (item.tag === 'LabelDecoration' && labelDecorationCanDynamicHeight(item)) return true;
    if (/^show(?:auto|bottom|top|left|right)$/i.test(String(prop(item, ['ToolTipRepresentation']) || ''))) return true;
    return isContainer(item.tag) && visibleLayoutChildren(item).some(carriesWrappingText);
}

function splitterPane(child, ctx) {
    if (!child) return false;
    /* A table grows only through a stretchable column: a table with one
     * HorizontalStretch=false column gets no splitter between it and its
     * neighbour in the reference. */
    if (child.tag === 'Table') return (child.childItems || []).some(function (column) {
        return column && !isFalse(prop(column, ['Visible', 'visible'])) && !isAdditionTag(column.tag)
            && column.tag !== 'CheckBoxField'
            && !isFalse(prop(column, ['HorizontalStretch', 'ГоризонтальноеРастягивание']));
    });
    if (SPLITTER_MULTILINE_TAGS[child.tag]) return true;
    if (child.tag === 'InputField' && isMultilineField(child, ctx)) return true;
    /* A title above its value is two logical rows. */
    if (!isContainer(child.tag)) return /^(?:InputField|LabelField)$/.test(child.tag)
        && titleLocation(child) === 'top';
    /* United=false detaches a column into its owner's grid: no splitter. */
    if (isFalse(prop(child, ['United', 'Объединять']))) return false;
    var kids = visibleLayoutChildren(child);
    var orientation = normOrient(prop(child, ['Group', 'GroupOrientation', 'Orientation', 'Layout',
        'Группировка', 'Ориентация', 'Расположение'])) || defaultContainerOrientation(child.tag);
    if (orientation === 'vertical' && kids.length > 1) return true;
    return kids.some(function (kid) { return splitterPane(kid, ctx); });
}

function layoutMeta(item) {
    var tag = String((item && item.tag) || '');
    var isPages = tag === 'Pages';
    var isBar = tag === 'AutoCommandBar' || tag === 'CommandBar' || tag === 'ButtonGroup';
    var rawO = isPages ? '' : prop(item, ['Group', 'GroupOrientation', 'Orientation', 'Layout',
        'Группировка', 'Ориентация', 'Расположение']);
    var groupMode = isPages ? 'vertical' : (normGroupMode(rawO) || '');
    var orientation = isPages ? 'vertical' : isBar ? (normOrient(rawO) || 'horizontal')
        : (normOrient(rawO) || defaultContainerOrientation(tag));
    if (!groupMode) groupMode = defaultContainerGroupMode(tag);
    var alwaysH = groupMode === 'always-horizontal';
    var responsiveGroup = groupMode === 'horizontal-if-possible'
        || groupMode === 'auto-screen-sensitive';
    var groupRepresentation = normGroupRepresentation(prop(item, ['Representation', 'Отображение']));
    var separated = groupRepresentation.indexOf('separation') >= 0;
    var united = !isFalse(prop(item, ['United', 'Объединять']));
    var logicalSubgrid = isLogicalSubgridGroup(item);
    var rawIndent = prop(item, ['IndentChildren', 'ShouldIndentChildren', 'ChildIndent']).toLowerCase();
    var indent = (rawIndent === 'true' || rawIndent === '1' || rawIndent === 'yes' || rawIndent === 'да') ? true
        : (rawIndent === 'false' || rawIndent === '0' || rawIndent === 'no' || rawIndent === 'нет') ? false
            : false;
    var bare = (tag === 'UsualGroup' || tag === 'Group' || tag === 'CollapsibleGroup' || tag === 'Page' || tag === 'ButtonGroup')
        && groupPaintIsNone(item);
    var hints = ['container', 'container-' + orientation];
    if (indent) hints.push('container-indent');
    if (bare) hints.push('container-bare');
    var noWrap = isBar || groupMode === 'horizontal' || groupMode === 'always-horizontal';
    if (noWrap) hints.push('nowrap');
    if (tag) hints.push('container-' + tag.toLowerCase());
    if (tag === 'AutoCommandBar') hints.push('container-buttons');
    if (tag === 'Page' || tag === 'Pages') hints.push('container-page');
    if (isPages) hints.push('container-pages-root');
    var hs = '', vs = '', cw = '', thMode = 'auto', th = 'dontuse',
        defaultHs = false, defaultVs = false,
        thScope = 'local', jc = '', ai = '';
    if (!isPages) {
        var rawHs = prop(item, ['HorizontalSpacing', 'ГоризонтальныйИнтервал']);
        var rawVs = prop(item, ['VerticalSpacing', 'ВертикальныйИнтервал']);
        hs = normSpacing(rawHs);
        vs = normSpacing(rawVs);
        cw = normWidth(prop(item, ['ChildItemsWidth', 'ШиринаДочернихЭлементов']));
        thMode = normThrough(prop(item, ['ThroughAlign', 'СквозноеВыравнивание']));
        if (cw === 'equal') hints.push('ciwidth-equal');
        else if (cw === 'leftwidest') hints.push('ciwidth-leftwidest');
        else if (cw === 'rightwidest') hints.push('ciwidth-rightwidest');
        /* HorizontalAlign/VerticalAlign arrange this container's children.
         * Group*Align positions the container itself and is handled by
         * applyItemMetrics; feeding it back here would also move its content. */
        var gh = prop(item, ['HorizontalAlign', 'ГоризонтальноеВыравнивание']);
        var gv = prop(item, ['VerticalAlign', 'ВертикальноеВыравнивание']);
        var h = alignFlex(gh, 'h');
        var v = alignFlex(gv, 'v');
        if (orientation === 'horizontal') { jc = h; ai = v; } else { jc = v; ai = h; }
        /* HorizontalLocation positions the CommandBar lane in its parent; it
         * does not reverse/align the buttons inside that lane. Group alignment
         * on the CommandBar item handles the former. Keeping flex-end here
         * clipped leading commands on the left and made overflow unmeasurable. */
    }
    var visibleKids = item && item.childItems ? item.childItems.filter(function (child) {
        return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
    }) : [];
    /* Taxi section-nav: AlwaysHorizontal + HorizontalSpacing=None + a row of
     * PagesRepresentation=None chips. Do not treat a lone right-aligned
     * Pages=None status label as a chip. */
    if (orientation === 'horizontal' && hs === 'none') {
        var nonePages = 0;
        for (var np = 0; np < visibleKids.length; np++) {
            if (visibleKids[np].tag === 'Pages' && pagesRep(visibleKids[np]) === 'none')
                nonePages++;
        }
        if (nonePages >= 3) hints.push('section-nav');
    }
    var compoundSelectorChildren = automaticCompoundSelectorChildren(visibleKids, groupMode);
    var leadingAuthoredEditors = 0;
    while (leadingAuthoredEditors < visibleKids.length
        && visibleKids[leadingAuthoredEditors].tag === 'InputField'
        && charSize(prop(visibleKids[leadingAuthoredEditors], ['Width', 'Ширина'])))
        leadingAuthoredEditors++;
    var authoredEditorActionRow = groupMode === 'horizontal'
        && leadingAuthoredEditors >= 2 && leadingAuthoredEditors < visibleKids.length
        && isFalse(prop(visibleKids[0], ['HorizontalStretch', 'ГоризонтальноеРастягивание']))
        && visibleKids.slice(leadingAuthoredEditors).every(function (child) {
            return child.tag === 'Button' || child.tag === 'Hyperlink';
        });
    var authoredFieldCommandRow = groupRepresentation === 'none' && united
        && visibleKids.length >= 2
        && visibleKids[0].tag === 'InputField'
        && visibleKids[1].tag === 'CommandBar'
        && isFalse(prop(visibleKids[0], ['HorizontalStretch', 'ГоризонтальноеРастягивание']))
        && isFalse(prop(visibleKids[1], ['HorizontalStretch', 'ГоризонтальноеРастягивание']))
        && visibleKids.slice(2).every(function (child) {
            return !isSpecialRowLayoutTag(child.tag);
        });
    /* The compact two-item source row is the topology demonstrated by both
     * document headers. Broader nested groups also serialize omitted spacing,
     * but their current button/radio paint must be corrected before enabling
     * that spacing recursively or their total height gets worse. */
    var fixedOrdinaryAxis = groupMode === 'vertical' || groupMode === 'horizontal'
        || groupMode === 'always-horizontal';
    var onlyDecorations = visibleKids.length === 2 && visibleKids.every(function (child) {
        return child.tag === 'PictureDecoration' || child.tag === 'LabelDecoration';
    });
    var selfStyled = !!String(prop(item, ['BackColor', 'ЦветФона']) || '').trim();
    var fusedFieldSurface = selfStyled && groupMode === 'always-horizontal'
        && visibleKids.every(function (child) { return child.tag === 'InputField'; });
    var decorationPair = onlyDecorations && groupRepresentation === 'none'
        && (groupMode === 'horizontal-if-possible' || selfStyled);
    var styledChildCount = visibleKids.filter(function (child) {
        return !!String(prop(child, ['BackColor', 'ЦветФона']) || '').trim();
    }).length;
    var compactOrdinaryRows = isOrdinaryLayoutContainerTag(tag) && united
        && visibleKids.length === 2
        && styledChildCount < visibleKids.length
        && (!selfStyled || decorationPair || fusedFieldSurface)
        && visibleKids.every(function (child) { return !isSpecialRowLayoutTag(child.tag); })
        && visibleKids.every(function (child) { return !isContainer(child.tag || ''); })
        && (decorationPair || (fixedOrdinaryAxis && !onlyDecorations));
    /* An inline vertical PopUp is painted as an expanded information stack in
     * The reference's designer. Its omitted VerticalSpacing therefore keeps the native
     * Single cadence across every ordinary child, not only the compact
     * two-control topology above. Keep data grids and other special layout
     * owners out of this rule: they establish their own chrome cadence. */
    var inlinePopupVerticalCadence = isOrdinaryLayoutContainerTag(tag) && united
        && groupMode === 'vertical' && groupRepresentation === 'none'
        && groupBehavior(item) === 'popup' && visibleKids.length > 1
        && visibleKids.every(function (child) { return !isSpecialRowLayoutTag(child.tag); });
    /* HorizontalIfPossible is selected after measurement; assigning its
     * initial horizontal axis here shifts responsive label/value grids that
     * The reference ultimately stacks vertically. Detached United=false groups are
     * projected into their parent's grid and do not own a split gap. */
    defaultHs = compactOrdinaryRows
        && (groupMode === 'horizontal' || groupMode === 'always-horizontal')
        && !String(rawHs || '').trim();
    /* Vertical Single 9px is same-control compact pairs: two InputFields
     * (document header) or two CheckBoxFields. A checkbox stacked with its
     * month field stays on omitted 3px — mixing those published 9px and
     * shoved the next field below the reference.
     * Chrome-drop via compactOrdinaryRows still applies. */
    var compactVerticalSingleCadence = compactOrdinaryRows && groupMode === 'vertical'
        && visibleKids.length === 2
        && visibleKids[0].tag === visibleKids[1].tag
        && (visibleKids[0].tag === 'InputField' || visibleKids[0].tag === 'CheckBoxField');
    defaultVs = (compactVerticalSingleCadence || inlinePopupVerticalCadence)
        && !String(rawVs || '').trim();
    /* Pages=None + following group is not two ordinary controls. Taxi keeps
     * 6px there. CompactOrdinaryRows would publish Single 9px and shift the
     * group by +3 without moving the field above. */
    var pagesNoneThenGroup = orientation === 'vertical' && visibleKids.length === 2
        && visibleKids[0].tag === 'Pages' && pagesRep(visibleKids[0]) === 'none'
        && isContainer(visibleKids[1].tag) && visibleKids[1].tag !== 'Pages'
        && !String(rawVs || '').trim();
    if (pagesNoneThenGroup) defaultVs = false;
    var defaultStretchChild = null;
    if (orientation === 'horizontal' && visibleKids.length > 1) {
        for (var stretchIndex = visibleKids.length - 1; stretchIndex > 0; stretchIndex--) {
            var stretchCandidate = visibleKids[stretchIndex];
            var stretchTag = String(stretchCandidate.tag || '');
            if (stretchTag !== 'InputField' && stretchTag !== 'ValueList' && stretchTag !== 'LabelField') continue;
            var explicitStretch = prop(stretchCandidate, ['HorizontalStretch', 'ГоризонтальноеРастягивание']);
            if (isTrue(explicitStretch) || isFalse(explicitStretch)) continue;


            var candidateTitleLocation = titleLocation(stretchCandidate);
            var trailingOnlyCompactActions = visibleKids.slice(stretchIndex + 1).every(function (child) {
                return child.tag === 'Button' || child.tag === 'Hyperlink'
                    || child.tag === 'PictureDecoration' || child.tag === 'LabelDecoration';
            });
            var allValueTracks = visibleKids.every(function (child) {
                return child.tag === 'InputField' || child.tag === 'ValueList' || child.tag === 'LabelField';
            });
            var followsFixedAuthoredTrack = allValueTracks
                && charSize(prop(stretchCandidate, ['Width', 'Ширина']))
                && visibleKids.slice(0, stretchIndex).some(function (child) {
                    return isFalse(prop(child, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))
                        && charSize(prop(child, ['Width', 'Ширина']));
                });
            var compoundSelectorRow = stretchIndex === 1 && visibleKids.length === 3
                && visibleKids[0].tag === 'InputField'
                && (visibleKids[2].tag === 'Button' || visibleKids[2].tag === 'Hyperlink')
                && candidateTitleLocation === 'none';
            if ((stretchIndex === visibleKids.length - 1 && followsFixedAuthoredTrack)
                || compoundSelectorRow) {
                defaultStretchChild = stretchCandidate;
                break;
            }
        }
    }
    /* Tables before a Page-local disclosure section keep the standard Taxi
     * cadence between toolbar, filter chips and grid. The topology, rather
     * than captions or element ids, identifies this generated detail page. */
    var tableChromeCadenceChildren = pageTableChromeCadenceChildren(item);
    th = effectiveThroughAlign(item, thMode);
    if (th === 'use') {
        hints.push('throughalign-use');
        /* ThroughAlign supplies the default cross-axis grid alignment. An
         * authored HorizontalAlign/VerticalAlign is stronger: preview pages
         * commonly center a compact message inside a tall allocated pane. */
        if (!ai) ai = 'stretch';
        /* Explicit Use requests the legacy broad alignment scope. Auto creates
         * master/slave columns only down one generated grid branch; merging
         * sibling columns into one text maximum is not that relationship. */
        thScope = thMode === 'use' ? 'across-columns' : 'linked-local';
    }
    /* The reference enables splitters for a group whose spacing along its axis is
     * Single or wider; the pairs themselves are marked fp-splitter-pane by
     * createItem (both stretch, both more than one row high). One-line
     * columns get none. */
    var automaticColumnSeparators = orientation === 'horizontal'
        && hs !== 'none' && hs !== 'half' && visibleKids.length > 1;
    return {
        tag: tag, orientation: orientation, groupMode: groupMode,
        authoredWidth: charSize(prop(item, ['Width', 'Ширина'])) || 0,
        responsiveGroup: responsiveGroup, noWrap: noWrap, shouldIndentChildren: !!indent,
        containerClassHints: hints, horizontalSpacing: hs, verticalSpacing: vs,
        defaultHorizontalSpacing: defaultHs, defaultVerticalSpacing: defaultVs,
        pagesNoneThenGroup: pagesNoneThenGroup,
        childItemsWidth: cw, throughAlignMode: thMode, throughAlign: th,
        throughAlignScope: thScope,
        groupRepresentation: groupRepresentation, united: united,
        logicalSubgrid: logicalSubgrid,
        compactOrdinaryRows: compactOrdinaryRows,
        compactDecorationRow: decorationPair,
        authoredEditorActionRow: authoredEditorActionRow,
        authoredFieldCommandRow: authoredFieldCommandRow,
        flexJustifyContent: jc, flexAlignItems: ai,
        separated: separated, automaticColumnSeparators: automaticColumnSeparators,
        explicitWidth: charSize(prop(item, ['Width', 'Ширина'])),
        hasLargeFixedWidthChild: visibleKids.some(function (child) {
            return isFalse(prop(child, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))
                && (parseInt(prop(child, ['Width', 'Ширина']), 10) || 0) >= 45;
        }),
        singleInputChild: visibleKids.length === 1 && visibleKids[0].tag === 'InputField',
        inputThenLabelField: orientation === 'horizontal' && visibleKids.length === 2
            && visibleKids[0].tag === 'InputField' && visibleKids[1].tag === 'LabelField'
            && !!prop(visibleKids[1], ['DataPath']),
        decorationTitledField: orientation === 'horizontal' && visibleKids.length === 2
            && visibleKids[0].tag === 'LabelDecoration'
            && charSize(prop(visibleKids[0], ['Width', 'Ширина']))
            && visibleKids[1].tag === 'InputField',
        hasCommandBarChild: visibleKids.some(function (child) {
            return child.tag === 'CommandBar' || child.tag === 'AutoCommandBar';
        }),
        firstSourceChild: item && item.childItems && item.childItems.length ? item.childItems[0] : null,
        visibleChildren: visibleKids,
        defaultStretchChild: defaultStretchChild,
        compoundSelectorChildren: compoundSelectorChildren,
        tableChromeCadenceChildren: tableChromeCadenceChildren
    };
}

function applyLayout(el, meta) {
    if (!el || !meta) return;
    var r = meta.pagesNoneThenGroup ? TAXI_LAYOUT_METRICS.compactRowGap * 2
        : meta.defaultVerticalSpacing ? TAXI_LAYOUT_METRICS.verticalSpacing.single
        : spacingPx(meta.verticalSpacing, 'vertical');
    var c = meta.defaultHorizontalSpacing ? TAXI_LAYOUT_METRICS.horizontalSpacing.single
        : spacingPx(meta.horizontalSpacing, 'horizontal');
    el.style.rowGap = r != null ? r + 'px' : '';
    el.style.columnGap = c != null ? c + 'px' : '';
    el.style.justifyContent = meta.flexJustifyContent || '';
    el.style.alignItems = meta.flexAlignItems || '';
    if (el.dataset) {
        el.dataset.fpGroupMode = meta.groupMode || '';
        el.dataset.fpGroupRepresentation = meta.groupRepresentation || '';
        el.dataset.fpUnited = meta.united ? '1' : '0';
        el.dataset.fpThroughAlign = meta.throughAlign || 'dontuse';
        el.dataset.fpThroughAlignMode = meta.throughAlignMode || 'auto';
        el.dataset.fpThroughAlignScope = meta.throughAlignScope || 'local';
        el.dataset.fpChildItemsWidth = meta.childItemsWidth || '';
        el.dataset.fpVerticalSpacingMode = meta.verticalSpacing || '';
        if (meta.hasLargeFixedWidthChild) el.dataset.fpHasLargeFixedWidthChild = '1';
        else delete el.dataset.fpHasLargeFixedWidthChild;
        el.dataset.fpSelectedOrientation = meta.orientation || 'vertical';
        if (meta.responsiveGroup) el.dataset.fpResponsiveGroup = '1';
        else delete el.dataset.fpResponsiveGroup;
        if (meta.compoundSelectorChildren && meta.compoundSelectorChildren.length) {
            el.dataset.fpCompoundSelectorCount = String(meta.compoundSelectorChildren.length);
            if (el.classList) el.classList.add('fp-compound-selector-row');
            if (!meta.horizontalSpacing)
                el.style.columnGap = TAXI_LAYOUT_METRICS.horizontalSpacing.oneandhalf + 'px';
        } else {
            delete el.dataset.fpCompoundSelectorCount;
            if (el.classList) el.classList.remove('fp-compound-selector-row');
        }
    }
}

function layoutClass(meta, opts) {
    opts = opts || {};
    var tag = meta && meta.tag ? String(meta.tag) : '';
    var orientation = (meta && meta.orientation) || 'vertical';
    var cls = [];
    if (opts.alias) cls.push(opts.alias);
    else if (!opts.skipChildren) cls.push('fp-children');
    cls.push('fp-children-' + orientation);
    if (meta && meta.shouldIndentChildren) cls.push('fp-children-indented');
    if (meta && meta.automaticColumnSeparators) cls.push('fp-auto-column-separators');
    if (meta && meta.logicalSubgrid) cls.push('fp-logical-subgrid');
    if (tag === 'AutoCommandBar') cls.push('fp-buttons-container');
    var hints = (meta && meta.containerClassHints) || [];
    if (hints.indexOf('nowrap') >= 0) cls.push('fp-children-nowrap');
    for (var i = 0; i < hints.length; i++) {
        cls.push('fp-' + String(hints[i]).replace(/[^a-z0-9_-]/gi, '-'));
    }
    return cls.join(' ');
}

function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;
    return n;
}

function formattedTextParts(value) {
    var source = String(value == null ? '' : value);
    var parts = [];
    var stack = [];
    var pos = 0;
    var args = [];
    function push(text, link) {
        if (!text) return;
        /* <b>…</> is bold. */
        var bold = stack.indexOf('b') >= 0;
        var underline = stack.indexOf('u') >= 0;
        /* <color #RRGGBB> or <colorstyle N:uuid>. The reference does not resolve a style
         * reference inside a formatted string and paints it magenta. */
        var color = '';
        for (var c = stack.length - 1; c >= 0 && !color; c--) {
            if (stack[c] === 'colorstyle') color = '#ff00ff';
            else if (stack[c] === 'color') color = absoluteColor(args[c]) || '';
        }
        var prev = parts.length ? parts[parts.length - 1] : null;
        if (prev && prev.link === link && !!prev.bold === bold && !!prev.underline === underline
            && (prev.color || '') === color) { prev.text += text; return; }
        var part = { text: text, link: link };
        if (bold) part.bold = true;
        if (underline) part.underline = true;
        if (color) part.color = color;
        parts.push(part);
    }
    while (pos < source.length) {
        var start = source.indexOf('<', pos);
        if (start < 0) {
            push(source.slice(pos), stack.indexOf('link') >= 0);
            break;
        }
        push(source.slice(pos, start), stack.indexOf('link') >= 0);

        /* In 1C formatted strings doubled angle brackets are escaped literal
         * brackets. They are often used for captions such as << Clear >>. */
        if (source.charAt(start + 1) === '<') {
            var escapedEnd = source.indexOf('>>', start + 2);
            if (escapedEnd < 0) {
                push(source.slice(start).replace(/<</g, '<').replace(/>>/g, '>'),
                    stack.indexOf('link') >= 0);
                break;
            }
            push('<' + source.slice(start + 2, escapedEnd) + '>', stack.indexOf('link') >= 0);
            pos = escapedEnd + 2;
            continue;
        }

        /* A link target may itself start with a literal '<', for example
         * <link < Clear>. The first following '>' still closes the tag. */
        var end = source.indexOf('>', start + 1);
        if (end < 0) {
            push(source.slice(start), stack.indexOf('link') >= 0);
            break;
        }
        var body = source.slice(start + 1, end).trim();
        if (body === '/') {
            if (stack.length) { stack.pop(); args.pop(); }
        } else if (body.charAt(0) === '/') {
            var closed = stack.lastIndexOf(body.slice(1).trim().toLowerCase());
            if (closed >= 0) { stack.splice(closed, 1); args.splice(closed, 1); }
        } else if (!/\/$/.test(body)) {
            var name = (body.match(/^\/?([^\s/>]+)/) || [])[1];
            if (name) {
                stack.push(String(name).toLowerCase());
                args.push(body.slice(name.length).trim());
            }
        }
        pos = end + 1;
    }
    return parts;
}

function plainFormattedText(value) {
    return formattedTextParts(value).map(function (part) { return part.text; }).join('');
}

function setFormattedText(node, value, forceLink, formatted) {
    if (!node) return false;
    node.textContent = '';
    if (formatted === false) {
        if (forceLink) node.appendChild(el('span', 'fp-rich-link', value));
        else node.textContent = value;
        return !!forceLink;
    }
    var parts = formattedTextParts(value);
    var hasLink = false;
    for (var i = 0; i < parts.length; i++) {
        var partNode;
        if (forceLink || parts[i].link) {
            partNode = el('span', 'fp-rich-link', parts[i].text);
            hasLink = true;
        } else {
            partNode = document.createTextNode(parts[i].text);
        }
        if (parts[i].underline || parts[i].color) {
            var styled = el('span', 'fp-rich-styled');
            if (parts[i].underline) styled.style.textDecoration = 'underline';
            if (parts[i].color) styled.style.color = parts[i].color;
            styled.appendChild(partNode);
            partNode = styled;
        }
        if (parts[i].bold) {
            var boldNode = el('b', 'fp-rich-bold');
            boldNode.appendChild(partNode);
            partNode = boldNode;
        }
        node.appendChild(partNode);
    }
    return hasLink;
}

function fallbackWidget(label, tag) {
    var w = el('div', 'fp-fallback-widget');
    w.appendChild(el('span', 'fp-fallback-label', label || '—'));
    w.appendChild(el('span', 'fp-fallback-tag', tag || 'Control'));
    return w;
}

function chartWidget() {
    /* A static stand-in for the platform line chart, laid out like the reference's:
     * value axis captions end at x=120, the first grid line is
     * 12px under the field top and the rows are 21px apart. */
    var chart = el('div', 'fp-chart-widget');
    var grid = '', labels = '', values = ['0,00002', '0,000018', '0,000016', '0,000014', '0,000012',
        '0,00001', '0,000008', '0,000006', '0,000004', '0,000002'];
    for (var i = 0; i < values.length; i++) {
        var y = 12 + i * 21;
        grid += 'M124 ' + y + 'H440';
        labels += '<text x="120" y="' + (y + 4) + '">' + values[i] + ' млрд руб</text>';
    }
    for (var x = 218; x <= 410; x += 96) grid += 'M' + x + ' 12V222';
    chart.innerHTML = '<svg class="fp-chart-svg" viewBox="0 0 450 240" preserveAspectRatio="none" aria-hidden="true">'
        + '<path class="fp-chart-grid" d="' + grid + '"/>'
        + '<g class="fp-chart-labels">' + labels + '</g>'
        + '<path class="fp-chart-line fp-chart-line-red" d="M170 240C190 -52 246 -52 266 240"/>'
        + '<path class="fp-chart-line fp-chart-line-blue" d="M266 240C286 -52 342 -52 362 240"/>'
        + '<path class="fp-chart-line fp-chart-line-yellow" d="M288 240C296 110 300 24 314 24C350 20 390 26 410 35"/>'
        + '<rect class="fp-chart-marker-red" x="214" y="8" width="8" height="8"/>'
        + '<path class="fp-chart-marker-blue" d="M314 7L319 12L314 17L309 12Z"/>'
        + '<circle class="fp-chart-marker-yellow" cx="314" cy="24" r="4"/>'
        + '<circle class="fp-chart-marker-yellow" cx="410" cy="35" r="4"/></svg>';
    return chart;
}

function referenceTypeSupportsOpen(type) {
    return /(?:^|:)(?:Catalog|Document|ChartOfAccounts|ChartOfCharacteristicTypes|ChartOfCalculationTypes|BusinessProcess|Task|ExchangePlan)Ref\./i
        .test(String(type || ''));
}

function inputButtonKinds(item, ctx) {
    if (item && item.runtime && item.runtime.inputButtonKinds)
        return item.runtime.inputButtonKinds.slice();
    var info = typeInfoFromItem(item, ctx);
    var features = typeFeaturesOf(info.types, info.dateFraction, info.numberQ);
    if (!info.types.length) {
        /* No resolved type: keep the previous authored-only fallback so a
         * standalone ChoiceButton still paints, and a typed-looking DataPath
         * without metadata does not invent chrome. */
        features = { selection: 'none', clear: false, adjust: false, open: false };
        if (fieldKind(item, ctx) === 'date') features.selection = 'dialog';
    }
    var buttons = resolveInputFieldButtons(item, features, {
        multiValue: false
    });
    return inputButtonKindsFromButtons(item, ctx, buttons);
}

function appendInputButtons(field, item, ctx) {
    var kinds = inputButtonKinds(item, ctx);
    for (var i = 0; i < kinds.length; i++) {
        var kind = kinds[i];
        if (kind === 'dots') {
        var choiceBtn = iconBtn('dots');
        choiceBtn.classList.add('fp-choice-button');
        var runtime = item && item.runtime;
        if (runtime && runtime.choiceParameterLinks && runtime.choiceParameterLinks.length)
            choiceBtn.dataset.choiceParameterLinks = JSON.stringify(runtime.choiceParameterLinks);
        if (runtime && runtime.choiceParameters && runtime.choiceParameters.length)
            choiceBtn.dataset.choiceParameters = JSON.stringify(runtime.choiceParameters);
        field.appendChild(choiceBtn);
        } else if (kind === 'spin') {
            /* SpinButton stacks the up/down pair at the right edge. */
            var spin = el('span', 'fp-spin');
            spin.appendChild(el('span', 'fp-spin-up', '▴'));
            spin.appendChild(el('span', 'fp-spin-down', '▾'));
            field.appendChild(spin);
        } else {
            field.appendChild(iconBtn(kind));
        }
    }
}

function withColon(label, loc) {
    if (!label || (loc !== 'left' && loc !== 'top')) return label;
    if (/[:：]$/.test(label)) return label;
    return label + ':';
}

function radioOptionsLayout(item, optionCount) {
    var columns = parseInt(prop(item, ['ColumnsCount']), 10) || 0;
    if (columns === 1)
        return { className: 'fp-radio-stack fp-radio-column', columns: 1 };
    if (columns > 1)
        return { className: 'fp-radio-stack fp-radio-grid', columns: columns };
    return {
        className: 'fp-radio-stack' + (optionCount <= 4 ? ' fp-radio-row' : ''),
        columns: 0
    };
}

function makeFieldInput(item, loc, label, ctx) {
    var multiline = isMultilineField(item, ctx);
    var multilineLayout = multilineFieldLayoutContract({
        location: loc,
        multiline: multiline,
        authoredTitleLocation: prop(item, ['TitleLocation', 'ПоложениеЗаголовка']),
        authoredPaintWidth: authoredFieldWidthPx(prop(item, ['Width', 'Ширина']), 'InputField'),
        boundedWidth: isFalse(prop(item, ['AutoMaxWidth'])) && !!charSize(prop(item, ['MaxWidth', 'МаксимальнаяШирина'])),
        titleCellChrome: TAXI_LAYOUT_METRICS.pagePadding.horizontal
            + TAXI_BROWSER_METRICS.horizontalSpacing.single
            + TAXI_LAYOUT_METRICS.inputBorderChromeWidth
    });
    loc = multilineLayout.location;
    var wrap = el('div', 'fp-control-wrap fp-field-row fp-title-' + loc);
    if (!prop(item, ['TitleLocation', 'ПоложениеЗаголовка']))
        wrap.classList.add('fp-title-auto');
    var shown = withColon(label, loc);
    if (shown && loc !== 'none') wrap.appendChild(el('span', 'fp-field-label', shown));
    if (shown && loc === 'left' && /\r?\n/.test(shown)) wrap.classList.add('fp-title-wrap');
    var field = el('div', 'fp-input-wrap');
    /* AutoMaxWidth=false with a MaxWidth and no Width: the platform TextBox keeps
     * that width (MaxWidth·10 + 11: MaxWidth 15 → 161) and its side caption
     * wraps in the narrow column instead of squeezing the editor to 90 px. */
    var fixedMaxChars = parseInt(prop(item, ['MaxWidth', 'МаксимальнаяШирина']), 10) || 0;
    if (!multiline && loc === 'left' && fixedMaxChars > 0
        && isFalse(prop(item, ['AutoMaxWidth'])) && !prop(item, ['Width', 'Ширина'])
        && fieldKind(item, ctx) === 'number') {
        field.style.minWidth = (fixedMaxChars * REF_AUTHORED_CHAR_PX + 11) + 'px';
        wrap.classList.add('fp-title-shrinks-for-editor');
    }
    var inp = el(multiline ? 'textarea' : 'input', 'fp-input');
    if (!multiline) inp.type = 'text';
    else {
        var rows = parseInt(prop(item, ['Height', 'Высота']), 10);
        /* Height=1 is still a real one-row multiline editor in 1C. The reference's
         * generated height=2 maps to about 55 px; with the browser's textarea
         * metrics the existing three-row fallback is the visual equivalent. */
        /* An explicit MultiLine=true without Height is the reference's 2-row 55 px
         * editor; a type-driven multiline keeps 3 rows = 85 px. */
        var defaultRows = isTrue(prop(item, ['MultiLine'])) ? 2 : 3;
        var editorRows = rows > 0 ? rows : defaultRows;
        inp.rows = editorRows;
        wrap.classList.add('fp-multiline');
        /* TextBox Height n is 25 + 30·(n−1) px; an omitted Height on
         * a multiline editor is 3 rows = 85 px. The browser's rows=3
         * textarea is only ~52 px. */
        field.style.minHeight = (25 + 30 * (editorRows - 1)) + 'px';
    }
    inp.readOnly = true;
    inp.tabIndex = -1;
    var ph = formatPlaceholder(item, ctx);
    /* PasswordMode replaces every character with a dot; there is no value in the
     * preview, so a fixed run of dots is what the field looks like when filled. */
    if (isTrue(prop(item, ['PasswordMode', 'РежимПароля']))) {
        inp.classList.add('fp-input-password');
        ph = '••••••••';
    }
    if (ph) inp.value = ph;
    if (isTrue(prop(item, ['ReadOnly'])) || isDefaultInactiveStandardField(item, ctx)) {
        inp.classList.add('fp-input-readonly');
        field.classList.add('fp-input-readonly-wrap');
    }
    /* AutoMarkIncomplete draws 1C's red dotted underline inside an empty field.
     * When the form leaves it on Auto, the bound object's FillChecking value
     * supplies the same mandatory-field decision as the platform. */
    if (marksIncomplete(item, ctx) && !isDefaultInactiveStandardField(item, ctx)) inp.classList.add('fp-input-incomplete');
    var ha = String(prop(item, ['HorizontalAlign']) || '').toLowerCase();
    if (ha.indexOf('right') >= 0 || ha.indexOf('прав') >= 0) inp.style.textAlign = 'right';
    field.appendChild(inp);
    if (!multiline) appendInputButtons(field, item, ctx);
    wrap.appendChild(field);
    /* A ReadOnly text area paints no side column in the reference, even with
     * ExtendedEditMultipleValues. */
    if (multiline && !isTrue(prop(item, ['ReadOnly', 'ТолькоПросмотр']))) {
        var sideButtons = el('div', 'fp-multiline-buttons');
        appendInputButtons(sideButtons, item, ctx);
        if (sideButtons.children.length) wrap.appendChild(sideButtons);
    }
    return wrap;
}

/* The object's Code (catalogs, charts) and Number (documents, business
 * processes, tasks) are inactive by default in the designer: the platform
 * assigns them. An authored Enabled/ReadOnly keeps its own state. */
function isDefaultInactiveStandardField(item, ctx) {
    var path = String(prop(item, ['DataPath']) || '');
    if (!/^(Объект|Object)\.(Code|Number|Код|Номер)$/i.test(path)) return false;
    /* The designer greys an automatically numbered code only. Exchange
     * plans, charts of accounts and of calculation types have no
     * Autonumbering at all: their code is typed in (ordinary editors in
     * the reference). */
    var meta = ctx && ctx.model && ctx.model.objectMeta;
    if (meta && !/^true$/i.test(meta.autonumbering || '')) return false;
    return !prop(item, ['Enabled', 'Доступность', 'Доступен']) && !prop(item, ['ReadOnly']);
}

/* A text popup: the reference draws the caption at the ordinary 13px inset and pins
 * the arrow 6px before the right border. The widths the command-bar rules tune
 * to the reference come from the caption in flow, so viewer.css keeps a
 * transparent copy of it in flow (::before from data-popup-label) and places
 * the real caption and arrow spans at the reference's insets. Width is
 * untouched whatever padding a context applies; the visible text stays real
 * DOM text and textContent stays «Еще ▾». */
function setPopupCaption(btn, label) {
    btn.textContent = '';
    btn.classList.add('fp-text-popup');
    btn.dataset.popupLabel = label;
    btn.appendChild(el('span', 'fp-popup-label', label + ' '));
    btn.appendChild(el('span', 'fp-popup-caret', '▾'));
}

function isCommandBarButton(item) {
    return !!item && item.tag === 'Button'
        && /^(CommandBarButton|КнопкаКоманднойПанели)$/i.test(String(prop(item, ['Type', 'Вид']) || ''));
}

/* Explicit AutoMarkIncomplete wins; otherwise the FillChecking of what the
 * field is bound to: an object attribute through the form's main attribute
 * («Объект.Контрагент»), or the form attribute itself («Сценарий»). */
function marksIncomplete(item, ctx) {
    var explicit = prop(item, ['AutoMarkIncomplete', 'АвтоОтметкаНезаполненного']);
    if (explicit) return isTrue(explicit);
    var index = ctx && ctx.captionIndex;
    if (!index || !index.fillChecking) return false;
    var path = String(prop(item, ['DataPath']) || '');
    var parts = path.split('.');
    var value = parts.length >= 2 && isMainAttributeName(parts[0], index)
        ? index.objectFillChecking[parts.slice(1).join('.')]
        : index.fillChecking[path];
    return /showerror|показыватьошибк/i.test(String(value || '').replace(/[ _-]+/g, ''));
}

/* An object-typed «Объект»/«Запись» without MainAttribute still supplies the
 * object metadata, so it binds like the main attribute. */
function isMainAttributeName(name, index) {
    return !!(index.mainNames && index.mainNames[name]) || /^(Объект|Object|Запись|Record)$/i.test(name);
}

/* Whether anything can put a glyph on this button: its own picture, its
 * command's picture, or a standard command the icon table covers. */
function hasButtonIcon(item, ctx) {
    if (isHelpItem(item)) return true;
    if (pictureRef(item) || commandMeta(item, ctx, 'picture')) return true;
    var short = cmdShort(item);
    return !!(short && PIC_ICON[short]);
}

/* The reference paints no command-inherited StdPicture beside text: e.g.
 * «Обновить отчет» (PictureAndText, StdPicture.Refresh), «Выполнить»,
 * «Выполнено»/«Отказать» are text. A CommonPicture from the command is
 * painted. */
function resolveButtonRep(item, ctx) {
    var rep = resolveButtonRepRaw(item, ctx);
    if (rep === 'pictureandtext' && !pictureRef(item)
        && /^StdPicture\./i.test(String(commandMeta(item, ctx, 'picture') || ''))) return 'text';
    return rep;
}

function resolveButtonRepRaw(item, ctx) {
    if (item && item._fpUnresolvedCommand) return 'text';
    var rep = representationOf(item);
    /* Representation=Picture/PictureAndText on a command that carries no
     * picture is drawn as plain text by 1C, not as a placeholder glyph. */
    if ((rep === 'picture' || rep === 'pictureandtext') && !hasButtonIcon(item, ctx)
        && (rawTitle(item) || commandMeta(item, ctx, 'title') || titleOf(item, ctx)))
        return 'text';
    if (rep !== 'auto') return rep;
    if (ownTableSearchCommand(item)) return 'text';
    var buttonType = String(prop(item, ['Type']) || '').toLowerCase().replace(/[\s_-]+/g, '');
    var commandRep = commandMeta(item, ctx, 'rep');
    /* The reference resolves Auto differently for a standalone UsualButton and for a
     * CommandBarButton. A usual button adopts the command's explicit visual
     * representation (the address-copy MoveUp/MoveDown buttons are the
     * canonical case). A command-bar button keeps its own Auto choice: this is
     * why commands such as "Изменить" and "Сохранить как черновик" remain
     * textual in the reference despite pictures on their Command objects. */
    /* A Hyperlink button follows the same rule: «Настройки» and «Новости»
     * links show pictures because their commands say so. */
    if ((buttonType.indexOf('usualbutton') >= 0 || buttonType.indexOf('hyperlink') >= 0)
        && commandRep && commandRep !== 'auto') {
        if ((commandRep === 'picture' || commandRep === 'pictureandtext') && !hasButtonIcon(item, ctx))
            return 'text';
        /* A hyperlink does not paint a StdPicture from its form Command: a
         * TextPicture + StdPicture.Change link is bare link text in the
         * reference. */
        if (buttonType.indexOf('hyperlink') >= 0 && commandRep === 'pictureandtext' && !pictureRef(item)
            && /^StdPicture\./i.test(String(commandMeta(item, ctx, 'picture') || '')))
            return 'text';
        return commandRep;
    }
    /* An Auto hyperlink on an Auto command with a CommonPicture shows the
     * picture before its text. A StdPicture here stays unpainted, see
     * markUnpaintedStdPictureHyperlinks. */
    if (buttonType.indexOf('hyperlink') >= 0 && !pictureRef(item)
        && /^CommonPicture\./i.test(String(commandMeta(item, ctx, 'picture') || ''))
        && hasButtonIcon(item, ctx))
        return 'pictureandtext';
    if (item && item.tag === 'Popup') {
        var pPic = pictureRef(item) || commandMeta(item, ctx, 'picture');
        if (pPic && rawTitle(item)) return 'pictureandtext';
        if (pPic) return 'picture';
        return 'text';
    }
    var shortCmd = cmdShort(item);
    var isDefault = isTrue(prop(item, ['DefaultButton']));
    var authoredPic = pictureRef(item);
    var pic = authoredPic || commandMeta(item, ctx, 'picture');
    /* These are the same standard commands inAdditionalBar() defaults into the
     * "Еще" overflow; an explicit LocationInCommandBar there pulls one onto the
     * bar itself, and 1C always draws it as a bare icon, never as raw text. */
    var iconStd = {
        MoveUp: 1, MoveDown: 1, Delete: 1, Copy: 1, Change: 1, Find: 1, Refresh: 1,
        UndoPosting: 1,
        SortListAsc: 1, SortListDesc: 1, OutputList: 1, CustomizeForm: 1,
        ShowMultipleSelection: 1, ListSettings: 1, LoadDynamicListSettings: 1,
        SaveDynamicListSettings: 1, DynamicListStandardSettings: 1
    };
    /* An Auto CommandBarButton bound to a form Command takes that Command's
     * explicit Text/Picture, and a Command picture with Auto representation
     * yields a bare picture, including buttons with their own Title (e.g.
     * table commands СкопироватьСтроки/ВставитьСтроки/ПоискПоШтрихкоду). */
    if (buttonType.indexOf('commandbarbutton') >= 0 && /^(?:Form\.Command|CommonCommand)\./i.test(String(prop(item, ['CommandName']) || ''))) {
        if (commandRep === 'text') return 'text';
        if (commandRep === 'picture') return hasButtonIcon(item, ctx) ? 'picture' : 'text';
        /* A Command with Representation=TextPicture. Posting commands stay textual
         * in Taxi whatever their command says («Провести» with
         * StdPicture.Post). */
        if (commandRep === 'pictureandtext') {
            var postingKey = stdCommandKey(item);
            if (/^(?:write|post|writeandclose|postandclose)$/.test(postingKey)) return 'text';
            return hasButtonIcon(item, ctx) ? 'pictureandtext' : 'text';
        }
        if (commandRep === 'auto' && commandMeta(item, ctx, 'picture')) return 'picture';
    }
    if (isDefault) return pic ? 'pictureandtext' : 'text';
    /* Auto belongs to the form button, not to the referenced Command object.
     * Command metadata supplies a caption and the bytes for an explicitly
     * requested picture, but does not silently change the button's visual
     * representation. Only a picture authored on the button wins here. */
    /* The same commands on a form-sourced list bar are text. */
    /* A table's own row moves are captions like the synthesized pair
     * («Переместить вверх/вниз»). */
    if ((shortCmd === 'MoveUp' || shortCmd === 'MoveDown')
        && /^Form\.Item\.[^.]+\.StandardCommand\./.test(String(prop(item, ['CommandName']) || '')))
        return 'text';
    if (iconStd[shortCmd] && !rawTitle(item)
        && !/^Form\.StandardCommand\.(?:Copy|Find)$/i.test(String(prop(item, ['CommandName']) || '')))
        return 'picture';
    if (rawTitle(item)) return authoredPic ? 'picture' : 'text';
    if (authoredPic) return 'picture';
    if (STD_COMMANDS[shortCmd]) return 'text';
    return 'text';
}

/* Picture ref of a command button. A standard command without an authored
 * picture paints the platform library picture of the same name (std-pictures/),
 * not an outline sprite glyph. */
function buttonPictureRef(item, ctx) {
    var ref = pictureRef(item) || commandMeta(item, ctx, 'picture');
    if (ref) return ref;
    var short = cmdShort(item);
    /* The platform library has no «Copy» picture: a row Copy paints
     * СкопироватьЭлементСписка, the green plus over a document. */
    if (short === 'Copy') short = 'CloneListItem';
    if (short && /StandardCommand\.[A-Za-z]+$/.test(String(prop(item, ['CommandName']) || ''))
        && stdPictureUrl('StdPicture.' + short))
        return 'StdPicture.' + short;
    return '';
}

function makeBarButton(item, tag, ctx) {
    var label = displayLabel(item, ctx, tag);
    var plainLabel = plainFormattedText(label);
    var btnType = String(prop(item, ['Type']) || '').toLowerCase();
    var isLink = tag === 'Hyperlink' || btnType.indexOf('hyperlink') >= 0;
    var isDefault = isTrue(prop(item, ['DefaultButton']));
    var rep = resolveButtonRep(item, ctx);
    var iconOnly = rep === 'picture' || isHelpItem(item);
    if (isHelpItem(item)) label = '?';
    var cls = isLink ? 'fp-link' : 'fp-button';
    /* WhenActive draws the shape only under the pointer; the designer shows it
     * flat, like None. */
    var shapeRep = String(prop(item, ['ShapeRepresentation']) || '').toLowerCase();
    if (!isLink && /^(?:none|whenactive)$/.test(shapeRep)) {
        cls += ' fp-button-shape-none' + (shapeRep === 'whenactive' ? ' fp-button-shape-when-active' : '');
        var titleSource = rawTitle(item) ? item
            : ctx && ctx.commands && ctx.commands[lastSeg(prop(item, ['CommandName', 'Command']) || '')];
        var leadingSpaces = Number(titleSource && titleSource.properties
            && titleSource.properties.TitleLeadingSpaces) || 0;
        if (leadingSpaces && plainLabel) plainLabel = new Array(leadingSpaces + 1).join(' ') + plainLabel;
    }
    if (isDefault) cls += ' fp-button-default';
    if (item && item.name === '_stdWrite') cls += ' fp-primary-write';
    /* The platform's own Post command opens a group of its own (20 px after
     * «Записать»); an authored Post button right after an authored Write
     * keeps the ordinary 9 px. */
    if (item && item.name === '_stdPost') cls += ' fp-std-post';
    /* A table's standard MoveUp/MoveDown pair is one segmented group in the reference. */
    if (item && (item.name === '_stdUp' || item.name === '_stdDown')) cls += ' fp-std-move fp-std-move-' + (item.name === '_stdUp' ? 'up' : 'down');
    var postingRole = stdCommandKey(item);
    if (postingRole === 'postandclose' || postingRole === 'write' || postingRole === 'post'
        || postingRole === 'writeandclose')
        cls += ' fp-document-posting-' + postingRole;
    if (isCreateBasedOnPopup(item)) cls += ' fp-create-based-on';
    if (item && /^_global_group_/i.test(String(item.name || '')))
        cls += ' fp-generated-command-group';
    if (item && item._fpCommandSegment === 'trailing-text')
        cls += ' fp-trailing-text-command';
    if (iconOnly) cls += ' fp-icon-btn';
    if (rep === 'pictureandtext') cls += ' fp-picture-text-btn';
    if (item && item.rootTableGlyphText) cls += ' fp-root-table-glyph-text';
    if (tag === 'Popup') cls += ' fp-popup';
    var btn = el(isLink ? 'a' : 'button', cls);
    if (!isLink) {
        btn.type = 'button';
        /* Preview buttons stay clickable so the host can select the matching
         * form element. They do not execute 1C commands: no business-action
         * handler is attached to them in the preview. */
    }
    var iconName = iconIdFor(item, ctx);
    var actualRef = buttonPictureRef(item, ctx);
    if (iconOnly && item && item._fpUnpaintedPicture) {
        btn.classList.add('fp-unpainted-picture');
        btn.title = plainLabel || item.name || '';
    } else if (iconOnly && isHelpItem(item) && !commonPictureResource(actualRef, ctx)) {
        /* Taxi paints the standard Help command as a bold black question mark,
         * not as a circled outline icon. An authored common picture wins. */
        btn.appendChild(el('span', 'fp-help-glyph', '?'));
        btn.title = plainLabel || item.name || '';
    } else if (iconOnly) {
        appendPictureIcon(btn, actualRef, ctx, iconName);
        btn.title = plainLabel || item.name || '';
    } else if (rep === 'pictureandtext') {
        appendPictureIcon(btn, actualRef, ctx, iconName);
        btn.appendChild(el('span', 'fp-btn-text', plainLabel || item.name || ''));
        if (tag === 'Popup') btn.appendChild(el('span', 'fp-caret', '▾'));
        btn.title = plainLabel || item.name || '';
    } else {
        if (tag === 'Popup') setPopupCaption(btn, plainLabel || 'Меню');
        else btn.textContent = plainLabel || '…';
        btn.title = plainLabel || item.name || '';
    }
    if (isHelpItem(item)) btn.classList.add('fp-help-btn');
    return btn;
}

/* Reference default header/footer column width. Number
 * min(precision+scale[+1 if scale], 10); String min(Length, 20). */
function tableColumnHeaderChars(col, ctx) {
    var info = typeInfoFromItem(col, ctx);
    var kinds = info.types.map(valueTypeKind);
    if (kinds.length !== 1) return 0;
    if (kinds[0] === 'number') {
        var nq = info.numberQ;
        var precision = nq ? parseInt(nq.digits, 10) || 0 : 0;
        var scale = nq ? parseInt(nq.fractionDigits, 10) || 0 : 0;
        var numLength = precision + scale;
        if (scale !== 0) numLength++;
        return Math.min(numLength, TYPE_TABLE_NUMBER_HEADER_CHARS);
    }
    if (kinds[0] === 'string') {
        var length = info.stringLen > 0 ? info.stringLen : 0;
        return length ? Math.min(length, TYPE_TABLE_STRING_HEADER_CHARS) : 0;
    }
    return 0;
}

/* TableColumn Width is not the complete painted width of the native editor.
 * The reference keeps a kind-specific presentation minimum for selector/reference/date
 * cells (including their button lane), even when the authored Width is small.
 * The minimum applies to the physical grid only; descendantTableColumn-
 * Recommendation intentionally ignores these widths when sizing an outer
 * responsive pair. */
function tableColumnNativeMinimumPx(col, ctx, authoredPx) {
    /* Managed-form table columns are serialized as InputField children of
     * Table/ColumnGroup, not as a separate TableColumn XML tag. */
    if (!col || col.tag === 'ColumnGroup') return 0;
    var kind = fieldKind(col, ctx);
    var buttonKinds = inputButtonKinds(col, ctx);
    var hasButton = buttonKinds && buttonKinds.length > 0;
    var rawWidth = parseInt(prop(col, ['Width', 'Ширина']), 10) || 0;
    var authored = Math.max(0, Number(authoredPx) || rawWidth * TABLE_COL_PX);
    /* HorizontalStretch makes Width a preferred band rather than a hard
     * physical minimum. Native table allocation may compress that preference
     * down to the editor's presentation lane. */
    var authoredFloor = isTrue(prop(col, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))
        ? 0 : authored;

    /* These are the fixed Taxi/96-DPI presentation lanes observed in the reference:
     * list/dropdown 97, reference 118 and date/calendar 129 px.  Do not
     * apply them to a plain, buttonless text cell: such a cell may be a
     * deliberately narrow code column. */
    if (kind === 'list' && hasButton) return Math.max(authoredFloor, 97);
    if (kind === 'ref' && hasButton) {
        /* A compact code selector with its Open lane disabled uses the same
         * 97px drop-list presentation as the reference; wider references retain the
         * ordinary 118px reference editor minimum. */
        if (rawWidth > 0 && rawWidth <= 6 && isFalse(prop(col, ['OpenButton'])))
            return Math.max(authoredFloor, 97);
        return Math.max(authoredFloor, 118);
    }
    if (kind === 'date' && hasButton) return Math.max(authoredFloor, 129);

    /* Long text/numeric columns use the ordinary 20/21-character native
     * presentation lane.  Short authored code columns stay short and receive
     * any spare table width through the browser's table allocator. */
    if (kind === 'text' || kind === 'number') {
        var metaLength = metaStringLen(col, ctx);
        var chars = defaultFieldChars(col, ctx);
        var longPresentation = rawWidth >= 17 || (metaLength > 0 && chars >= 20);
        if (longPresentation) {
            var natural = defaultFieldWidthPx(col, ctx);
            if (natural > 0) {
                if (rawWidth >= 17 && rawWidth < 20)
                    return Math.max(authoredFloor, 168);
                return Math.max(authoredFloor, Math.min(168, natural + 5));
            }
        }
    }
    return authored;
}

/* A column is as wide as its native physical editor minimum, else as wide as
 * its own Width/caption. The value is needed twice: on the header cell, and
 * on the body cells of a table whose Header=false leaves nothing else to hold
 * the columns apart. */
function columnWidthPx(col, ctx) {
    var rawWidth = parseInt(prop(col, ['Width', 'Ширина']), 10);
    var cw = rawWidth > 0 ? rawWidth * TABLE_COL_PX : 0;
    /* Width=1 is only a weight: the reference never paints the column narrower than its
     * caption lane («Период» 62, «Номер строки» 99, «Количество» 86 px). */
    if (rawWidth > 0 && rawWidth <= 2) {
        var lane = 0;
        if (isVerticalColumnGroup(col)) {
            var laneKids = headerKids(col);
            for (var lk = 0; lk < laneKids.length; lk++)
                lane = Math.max(lane, String(columnCaption(laneKids[lk], ctx) || '').length * 7 + 19);
        } else {
            lane = String(columnCaption(col, ctx) || '').length * 7 + 19;
        }
        cw = Math.max(cw, lane);
    }
    /* A ColumnGroup has no editor lane of its own: its authored Width is the
     * column (an InCell group would otherwise collapse to 0). */
    if (cw && col && col.tag === 'ColumnGroup') return cw;
    if (cw) return tableColumnNativeMinimumPx(col, ctx, cw);
    var fieldWidth = col && col.tag !== 'ColumnGroup' ? defaultFieldWidthPx(col, ctx) : 0;
    var cap = columnCaption(col, ctx) || (col && col.name) || '';
    /* A header caption is also a minimum: a short value qualifier must not
     * squeeze a descriptive heading into the neighbouring column. */
    var natural = Math.max(48, fieldWidth || 0, String(cap).length * GROUP_COL_PX);
    return Math.max(natural, tableColumnNativeMinimumPx(col, ctx, natural));
}

/* The browser's fixed-table allocator scales every authored <col> when their
 * sum is shorter than the grid viewport. The reference does not: physical column bands
 * retain their native minima and the trailing value column owns the remaining
 * stretch space. Keep this arithmetic pure so the contract is covered without
 * depending on browser raster/layout rounding. */
function allocateTableColumnWidths(minimumWidths, viewportWidth) {
    var widths = [];
    var total = 0;
    for (var i = 0; minimumWidths && i < minimumWidths.length; i++) {
        var width = Math.max(0, Math.ceil(Number(minimumWidths[i]) || 0));
        widths.push(width);
        total += width;
    }
    var target = Math.max(0, Math.floor(Number(viewportWidth) || 0));
    if (widths.length && target > total)
        widths[widths.length - 1] += target - total;
    return widths;
}

function makeColumnTh(col, ctx) {
    var cap = columnCaption(col, ctx);
    var pic = pictureRef(col) || prop(col, ['HeaderPicture']);
    /* A titled PictureField whose only picture is ValuesPicture shows its
     * caption in the header. */
    var titledValuesPicture = col.tag === 'PictureField' && cap && rawTitle(col)
        && !prop(col, ['HeaderPicture']) && !prop(col, ['Picture']);
    var th = el('th', col.tag === 'PictureField' && !titledValuesPicture ? 'fp-th-icon' : '');
    if (!titledValuesPicture && (col.tag === 'PictureField' || (pic && !cap))) {
        appendPictureIcon(th, pic, ctx, iconIdFromRef(pic || 'Picture') || 'photo');
        th.title = titleOf(col, ctx) || col.name || '';
    } else {
        th.textContent = cap || col.name || '—';
    }
    th.setAttribute('data-id', itemKey(col));
    var shownType = itemTypePresentation(col, ctx);
    if (shownType) th.title = 'Тип: ' + shownType;
    th.style.minWidth = columnWidthPx(col, ctx) + 'px';
    setFontCss(th, fontCss(col && col.properties && col.properties.TitleFontSpec));
    return th;
}

function createControl(item, tag, ctx, parentMeta) {
    var label = displayLabel(item, ctx, tag);
    var wrap = el('div', 'fp-control-wrap');
    var loc = titleLocation(item, parentMeta);
    if (tag === 'InputField' || tag === 'ValueList') {
        wrap = makeFieldInput(item, loc, label, ctx);
    } else if (tag === 'SearchStringAddition') {
        wrap.className = 'fp-control-wrap fp-search-wrap';
        var field = el('div', 'fp-input-wrap fp-search-field');
        var inp = el('input', 'fp-input');
        inp.type = 'text';
        inp.readOnly = true;
        inp.placeholder = 'Поиск (Ctrl+F)';
        field.appendChild(inp);
        field.appendChild(iconBtn('x'));
        wrap.appendChild(field);
    } else if (tag === 'ViewStatusAddition') {
        wrap.className = 'fp-control-wrap fp-chips';
        ['Поле1: Значение1', 'Поле2: Значение2'].forEach(function (t) {
            var chip = el('span', 'fp-chip', t);
            chip.appendChild(svgIcon('px-chip-x', 'fp-chip-x'));
            wrap.appendChild(chip);
        });
    } else if (tag === 'CheckBoxField') {
        wrap.className = 'fp-control-wrap fp-field-row fp-check-row';
        /* CheckBoxType=Tumbler/Switcher is 1C's sliding switch, not a box. */
        var cb;
        if (isTumbler(prop(item, ['CheckBoxType', 'ВидФлажка']))) {
            var boolOptions = booleanTumblerOptions(item);
            /* Without a format a Tumbler shows the Boolean presentations
             * («Истина | Ложь»); only a Switcher is the sliding switch. */
            if (!boolOptions.length && !/switcher/i.test(String(prop(item, ['CheckBoxType', 'ВидФлажка']) || '')))
                boolOptions = ['Истина', 'Ложь'];
            if (boolOptions.length) {
                cb = el('div', 'fp-segmented fp-boolean-segmented');
                boolOptions.forEach(function (opt) {
                    var state = el('button', 'fp-segmented-item', opt);
                    state.type = 'button';
                    state.disabled = true;
                    cb.appendChild(state);
                });
            } else {
                cb = el('span', 'fp-switch');
                cb.appendChild(el('span', 'fp-switch-knob'));
            }
            wrap.classList.add('fp-check-switch');
        } else {
            cb = el('input', 'fp-check');
            cb.type = 'checkbox';
            cb.disabled = true;
        }
        /* A left title joins the form's title column like an editor's. */
        /* [CHECK-ROOT-LEFT] A root-level check box without TitleLocation also
         * joins the title column. */
        var leftCheckTitle = loc === 'left' && (titleLocationAuthored(item)
            || (parentMeta && parentMeta.tag === 'Form'
                && !prop(item, ['TitleLocation', 'ПоложениеЗаголовка'])));
        if (leftCheckTitle) wrap.classList.add('fp-title-left');
        var lblCb = el('span', 'fp-field-label', leftCheckTitle ? withColon(label || '—', loc) : (label || '—'));
        if (loc === 'right' || loc === 'none') { wrap.appendChild(cb); if (loc !== 'none') wrap.appendChild(lblCb); }
        else { wrap.appendChild(lblCb); wrap.appendChild(cb); }
    } else if (tag === 'RadioButton' || tag === 'RadioButtonField') {
        wrap.className = 'fp-control-wrap fp-field-row fp-title-' + loc;
        if (label && loc !== 'none') wrap.appendChild(el('span', 'fp-field-label', withColon(label, loc)));
        var opts = radioOptions(item);
        var radioLayout = radioOptionsLayout(item, opts.length);
        /* RadioButtonType=Tumbler draws the choices as one segmented button.
           The designer has no value, so the reference presses none of the segments. */
        if (isTumbler(prop(item, ['RadioButtonType', 'ВидПереключателя']))) {
            var seg = el('div', 'fp-segmented');
            opts.forEach(function (opt) {
                var sb = el('button', 'fp-segmented-item', opt);
                sb.type = 'button';
                sb.disabled = true;
                seg.appendChild(sb);
            });
            wrap.appendChild(seg);
            return wrap;
        }
        var stack = el('div', radioLayout.className);
        if (radioLayout.columns > 1)
            stack.style.gridTemplateColumns = 'repeat(' + radioLayout.columns + ', max-content)';
        opts.forEach(function (opt, idx) {
            var lab = el('label', 'fp-radio-option');
            var rb = document.createElement('input');
            rb.type = 'radio';
            rb.disabled = true;
            rb.name = (item.id || item.name || 'radio') + '-fp';
            if (idx === 0) rb.checked = true;
            lab.appendChild(rb);
            lab.appendChild(el('span', '', opt));
            stack.appendChild(lab);
        });
        wrap.appendChild(stack);
    } else if (tag === 'ListBox' || tag === 'ListField') {
        wrap.className = 'fp-control-wrap fp-field-row';
        wrap.appendChild(el('span', 'fp-field-label', label || '—'));
        var list = el('div', 'fp-list-mock');
        ['Первый элемент', 'Второй элемент', 'Третий элемент'].forEach(function (opt, idx) {
            list.appendChild(el('div', 'fp-list-row' + (idx === 1 ? ' active' : ''), opt));
        });
        wrap.appendChild(list);
    } else if (tag === 'Button' || tag === 'Hyperlink') {
        wrap.appendChild(makeBarButton(item, tag, ctx));
    } else if (tag === 'Popup') {
        wrap.className = 'fp-control-wrap fp-popup-wrap';
        var pbtn = makeBarButton(item, tag, ctx);
        wrap.appendChild(pbtn);
        wrap.appendChild(makePopupMenu(item, ctx));
        wrap._popupBtn = pbtn;
    } else if (tag === 'LabelField') {
        /* A LabelField is a data field, not a caption: 1C draws its title at
         * TitleLocation and the bound value next to it. The preview has no
         * runtime values to draw, but the configurator still reserves the
         * value's layout space next to the title - so an empty slot is drawn
         * at the field's default width (applyItemMetrics sizes it exactly
         * like an InputField's box), styled as a link when Hiperlink=true.
         * A LabelField with no DataPath is a static caption with nothing to
         * reserve space for. `TitleLocation=None` hides both. */
        wrap.className = 'fp-control-wrap fp-field-row fp-title-' + loc;
        var lfTitle = withColon(label, loc);
        if (loc !== 'none') {
            if (lfTitle) wrap.appendChild(el('span', 'fp-field-label', lfTitle));
            if (prop(item, ['DataPath']))
                wrap.appendChild(el('span', 'fp-labelfield-value' + (isHyperlinkItem(item) ? ' fp-link' : '')));
        }
    } else if (tag === 'SpreadSheetDocumentField') {
        wrap.className = 'fp-control-wrap fp-spreadsheet-field';
        var viewport = el('div', 'fp-spreadsheet-viewport');
        var surface = el('div', 'fp-spreadsheet-surface');
        surface.appendChild(el('div', 'fp-spreadsheet-cell'));
        viewport.appendChild(surface);
        wrap.appendChild(viewport);
    } else if (tag === 'Table') {
        wrap.className = 'fp-control-wrap fp-table-widget';
        var tableRuntime = item.runtime || {};
        /* CommandBarLocation=None means the table has no bar at all; Bottom
         * moves it below the grid. Everything else keeps 1C's default Top. */
        var tblBarLoc = commandBarLocation(item);
        var toolbar = null;
        if (tableCommandBarVisible(item, ctx && ctx.model)) {
            toolbar = el('div', 'fp-table-toolbar fp-commandbar');
            var barSrc = item.autoCommandBar || { tag: 'AutoCommandBar', childItems: [], properties: {} };
            var barKids = tableBarItems(item, ctx && ctx.model);
            renderPreview(barKids, toolbar, ctx, barSrc);
            /* A non-autofilled own bar never gets the automatic search; an authored
             * SearchStringAddition already rendered in it is the only one. */
            var ownBarAutofill = !(item.autoCommandBar && isFalse(prop(item.autoCommandBar, ['Autofill'])));
            if (item.searchStringAddition && !additionHidden(item, 'SearchStringLocation')
                && ownBarAutofill && !toolbar.querySelector('.fp-search-item')
                && !tableSearchHoistedToForm(item, ctx && ctx.model)) {
                var sItem = item.searchStringAddition;
                var sdiv = el('div', 'fp-item fp-control fp-bar-item fp-search-item');
                sdiv.dataset.id = itemKey(sItem);
                sdiv._fpItem = sItem;
                sdiv.appendChild(createControl(sItem, 'SearchStringAddition', ctx));
                var moreEl = toolbar.querySelector('.fp-more-item');
                if (moreEl) toolbar.insertBefore(sdiv, moreEl);
                else toolbar.appendChild(sdiv);
            }
            /* A non-autofilled bar whose search went to the form bar has no
             * platform overflow menu of its own. */
            if (!toolbar.querySelector('.fp-more-item') && tableBarHasPermanentMore(item)
                && !tableSearchHoistedToForm(item, ctx && ctx.model)) {
                var moreBtn = el('button', 'fp-button fp-popup');
                moreBtn.type = 'button';
                setPopupCaption(moreBtn, 'Еще');
                var moreWrap = el('div', 'fp-item fp-control fp-bar-item fp-more-item fp-popup-wrap');
                moreWrap._fpBaseEntries = [];
                moreWrap._fpCtx = ctx;
                moreWrap.appendChild(moreBtn);
                moreWrap._fpMenu = makePopupMenuEntries([], ctx);
                moreWrap.appendChild(moreWrap._fpMenu);
                bindPopupToggle(moreWrap, moreBtn, ctx, null);
                toolbar.appendChild(moreWrap);
            }
            toolbar._fpCtx = ctx;
            pinCommandBarTail(toolbar);
            /* renderPreview fits the command items before table additions are
             * appended. Refit after SearchStringAddition and the permanent
             * More button exist, otherwise the search can be pushed outside
             * the viewport while a lower-priority trailing command remains.
             * createControl runs before its owner is attached, so measurement
             * has to wait for the next layout frame. */
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(function () { fitCommandBar(toolbar); });
            }
            if (tblBarLoc !== 'bottom') wrap.appendChild(toolbar);
        }
        if (item.viewStatusAddition && !additionHidden(item, 'ViewStatusLocation')) {
            wrap.appendChild(createControl(item.viewStatusAddition, 'ViewStatusAddition', ctx));
        }
        var tableWrap = el('div', 'fp-table-mock');
        if (tableRuntime.period && tableRuntime.period.active) {
            tableWrap.classList.add('fp-table-period-active');
            tableWrap.dataset.period = JSON.stringify(tableRuntime.period);
        }
        if (tableRuntime.rowFilter && tableRuntime.rowFilter.active) {
            tableWrap.classList.add('fp-table-filter-active');
            tableWrap.dataset.rowFilter = 'active';
        }
        var tableMetrics = tableHeightMetrics(item);
        var tbl = document.createElement('table');
        var thead = document.createElement('thead');
        var cols = tableColumns(item);
        var leafs = [];
        var headerRowCount = Math.max(1, tableMetrics.headerRows);
        var spanningLayout = tableHasSpanningColumnGroups(item)
            ? tableHeaderGridLayout(item.childItems) : null;
        if (spanningLayout) {
            leafs = spanningLayout.cols.slice();
            headerRowCount = Math.max(headerRowCount, spanningLayout.rows);
        }
        for (var gi = 0; !spanningLayout && gi < cols.length; gi++) {
            if (isHeaderGroup(cols[gi])) {
                var gk = headerKids(cols[gi]);
                var gp = tablePhysicalColumns(cols[gi]);
                if (gk.length) headerRowCount = Math.max(headerRowCount, 2);
                if (gp.length) for (var gj = 0; gj < gp.length; gj++) leafs.push(gp[gj]);
                else leafs.push(cols[gi]);
            } else if (isVerticalColumnGroup(cols[gi])) {
                /* A vertical ColumnGroup is one physical table column. Only
                 * children that are actually shown in the header contribute
                 * stacked header rows; hidden service fields must not inflate
                 * every table header. */
                var vk = headerKids(cols[gi]);
                headerRowCount = Math.max(headerRowCount, vk.length || 1);
                leafs.push(cols[gi]);
            } else leafs.push(cols[gi]);
        }
        var headerRows = [];
        for (var hr = 0; hr < headerRowCount; hr++) headerRows.push(document.createElement('tr'));
        var topTr = headerRows[0];
        if (spanningLayout) {
            var spanCells = spanningLayout.cells.slice().sort(function (a, b) {
                return a.row - b.row || a.col - b.col;
            });
            for (var sci = 0; sci < spanCells.length; sci++) {
                var sc = spanCells[sci];
                var scTh;
                if (sc.group) {
                    scTh = el('th', 'fp-th-group', rawTitle(sc.item) || titleOf(sc.item, ctx) || '');
                    scTh.setAttribute('data-id', itemKey(sc.item));
                } else {
                    scTh = isFalse(prop(sc.item, ['ShowInHeader'])) ? el('th', '') : makeColumnTh(sc.item, ctx);
                }
                scTh.colSpan = Math.max(1, sc.span);
                scTh.rowSpan = Math.max(1, sc.bottom ? headerRowCount - sc.row : sc.rowSpan);
                headerRows[Math.min(sc.row, headerRows.length - 1)].appendChild(scTh);
            }
        }
        for (var i = 0; !spanningLayout && i < cols.length; i++) {
            if (isHeaderGroup(cols[i])) {
                var gKids = headerKids(cols[i]);
                var gPhysical = tablePhysicalColumns(cols[i]);
                var gCap = rawTitle(cols[i]) || titleOf(cols[i], ctx) || '';
                var gTh = el('th', 'fp-th-group', gCap);
                gTh.colSpan = Math.max(1, gPhysical.length);
                gTh.setAttribute('data-id', itemKey(cols[i]));
                topTr.appendChild(gTh);
                if (!gKids.length || headerRowCount === 1) {
                    if (headerRowCount > 1) gTh.rowSpan = headerRowCount;
                } else {
                    for (var sk = 0; sk < gPhysical.length; sk++) {
                        var physical = gPhysical[sk];
                        var subTh = isFalse(prop(physical, ['ShowInHeader']))
                            ? el('th', '') : makeColumnTh(physical, ctx);
                        subTh.rowSpan = Math.max(1, headerRowCount - 1);
                        headerRows[1].appendChild(subTh);
                    }
                }
            } else if (isVerticalColumnGroup(cols[i])) {
                var vKids = headerKids(cols[i]);
                if (!vKids.length) {
                    var verticalEmpty = makeColumnTh(cols[i], ctx);
                    verticalEmpty.rowSpan = headerRowCount;
                    topTr.appendChild(verticalEmpty);
                } else {
                    for (var vi = 0; vi < vKids.length; vi++) {
                        var verticalTh = makeColumnTh(vKids[vi], ctx);
                        if (vi === vKids.length - 1 && vKids.length < headerRowCount)
                            verticalTh.rowSpan = headerRowCount - vi;
                        headerRows[vi].appendChild(verticalTh);
                    }
                }
            } else {
                var th = makeColumnTh(cols[i], ctx);
                if (headerRowCount > 1) th.rowSpan = headerRowCount;
                topTr.appendChild(th);
            }
        }
        if (!cols.length) topTr.appendChild(el('th', '', label || item.name || 'Таблица'));
        for (var tri = 0; tri < headerRows.length; tri++)
            if (headerRows[tri].children.length) {
                headerRows[tri].style.height = tableMetrics.headerRowHeight + 'px';
                thead.appendChild(headerRows[tri]);
            }
        /* Header=false hides the column strip entirely. */
        var showHeader = !isFalse(prop(item, ['Header', 'Шапка']));
        if (showHeader) tbl.appendChild(thead);
        else tableWrap.classList.add('fp-table-noheader');
        if (isFalse(prop(item, ['VerticalLines', 'ВертикальныеЛинии'])))
            tableWrap.classList.add('fp-table-novlines');
        if (isFalse(prop(item, ['HorizontalLines', 'ГоризонтальныеЛинии'])))
            tableWrap.classList.add('fp-table-nohlines');
        if (isTrue(prop(item, ['UseAlternationRowColor', 'ЧередованиеЦветовСтрок'])))
            tableWrap.classList.add('fp-table-alt-rows');
        var isTree = tableIsTree(item);
        var tbody = document.createElement('tbody');
        var nCols = Math.max(1, leafs.length);
        /* HeightInTableRows is the height 1C reserves for the grid, in rows. */
        var nRows = parseInt(prop(item, ['HeightInTableRows', 'ВысотаВСтрокахТаблицы']), 10);
        if (nRows > 0) tableWrap.classList.add('fp-table-explicit-rows');
        nRows = nRows > 0 ? Math.min(nRows, 15) : 1;
        /* Do not let a constrained page shrink an explicit two-row grid below
         * its header and rows. The managed client expands the page instead. */
        var minimumGridHeight = (showHeader ? tableMetrics.headerRows * tableMetrics.headerRowHeight : 0)
            + nRows * (nRows === 1 && !tableWrap.classList.contains('fp-table-explicit-rows') ? 48 : tableMetrics.bodyRowHeight) + 2;
        var calibratedMinimum = tableCalibratedMinimumHeightPx(item);
        if (calibratedMinimum) minimumGridHeight = calibratedMinimum;
        tableWrap.style.minHeight = minimumGridHeight + 'px';
        /* HeightInTableRows describes viewport capacity, not existing data.
         * An empty 1C table therefore has one uninterrupted blank body rather
         * than several invented rows and vertical cell rules. A colgroup keeps
         * all physical column minima (including hidden grouped headers), so
         * headers still stretch across the frame and overflow locally. */
        if (leafs.length) {
            var colgroup = document.createElement('colgroup');
            for (var cgi = 0; cgi < leafs.length; cgi++) {
                var colEl = document.createElement('col');
                var columnMinimum = columnWidthPx(leafs[cgi], ctx);
                colEl.dataset.fpMinWidth = String(columnMinimum);
                colEl.style.width = columnMinimum + 'px';
                colgroup.appendChild(colEl);
            }
            tbl.insertBefore(colgroup, tbl.firstChild);
        }
        var tr = document.createElement('tr');
        for (var ei = 0; ei < nCols; ei++) {
            var td = el('td', 'fp-table-empty fp-table-empty-body', '');
            td.style.height = (nRows * (nRows === 1 && !tableWrap.classList.contains('fp-table-explicit-rows') ? 48 : tableMetrics.bodyRowHeight)) + 'px';
            setFontCss(td, fontCss(leafs[ei] && leafs[ei].properties && leafs[ei].properties.FontSpec));
            if (leafs[ei] && isTrue(prop(leafs[ei], ['CellHyperlink', 'ГиперссылкаЯчейки'])))
                td.classList.add('fp-cell-link');
            if (ei === 0 && isTree)
                td.appendChild(el('span', 'fp-tree-toggle', treeExpanded(item) ? '▾' : '▸'));
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
        tbl.appendChild(tbody);
        tableWrap.classList.add('fp-table-empty-runtime');
        /* Footer=true adds the totals strip; only columns that opt in show a cell. */
        if (isTrue(prop(item, ['Footer', 'Подвал']))) {
            tableWrap.classList.add('fp-table-has-footer');
            var tfoot = document.createElement('tfoot');
            var ftr = document.createElement('tr');
            for (var fi = 0; fi < nCols; fi++) {
                var col = leafs[fi];
                var inFooter = col && (isTrue(prop(col, ['ShowInFooter', 'ПоказыватьВПодвале']))
                    || prop(col, ['FooterDataPath', 'ПутьКДаннымПодвала'])
                    || prop(col, ['FooterText', 'ТекстПодвала'])
                    || (col.runtime && col.runtime.footerPicture));
                var ftd = el('td', 'fp-table-footer-cell',
                    inFooter ? plainFormattedText(prop(col, ['FooterText', 'ТекстПодвала'])) : '');
                if (inFooter && col.runtime && col.runtime.footerPicture)
                    appendPictureIcon(ftd, col.runtime.footerPicture.ref, ctx,
                        iconIdFromRef(col.runtime.footerPicture.ref) || 'photo', 'fp-footer-picture');
                ftd.style.height = (tableMetrics.footerRows * tableMetrics.footerRowHeight) + 'px';
                setFontCss(ftd, fontCss(col && col.properties && col.properties.FooterFontSpec));
                ftr.appendChild(ftd);
            }
            tfoot.appendChild(ftr);
            tbl.appendChild(tfoot);
        }
        tableWrap.appendChild(tbl);
        wrap.appendChild(tableWrap);
        if (toolbar && tblBarLoc === 'bottom') wrap.appendChild(toolbar);
        wrap._tableCols = spanningLayout
            ? leafs.concat(spanningLayout.cells.map(function (c) { return c.item; }))
            : leafs;
        wrap._minimumHeight = minimumGridHeight
            + (toolbar ? 30 : 0)
            + (item.viewStatusAddition && !additionHidden(item, 'ViewStatusLocation') ? 32 : 0);
    } else if (tag === 'Page' || tag === 'Pages') {
        var pageBlock = el('div', tag === 'Pages' ? 'fp-group-block' : 'fp-page-block');
        var pageKids = el('div', '');
        pageBlock.appendChild(pageKids);
        wrap.appendChild(pageBlock);
        wrap._childBox = pageKids;
    } else if (tag === 'AutoCommandBar' || tag === 'CommandBar') {
        var bar = el('div', 'fp-commandbar');
        bar._fpItem = item;
        wrap.appendChild(bar);
        wrap._childBox = bar;
        if (commandBarHasOnlyHyperlinks(item)) {
            bar.classList.add('fp-hyperlink-commandbar');
            wrap.classList.add('fp-hyperlink-commandbar');
        }
    } else if (tag === 'ButtonGroup') {
        var bg = el('div', 'fp-buttongroup');
        wrap.appendChild(bg);
        wrap._childBox = bg;
    } else if (isContainer(tag)) {
        var behavior = groupBehavior(item);
        var popup = behavior === 'popup';
        var collapsible = behavior === 'collapsible';
        var group = el('div', groupPaintIsNone(item) ? 'fp-group-bare' : 'fp-group-block');
        if (popup) group.classList.add('fp-popup-group');
        /* The reference expands vertically authored PopUp groups in the form designer,
         * while a PopUp with omitted/default horizontal grouping remains the
         * compact runtime launcher (for example document totals). */
        if (popup && normGroupMode(prop(item, ['Group', 'Группа'])) === 'vertical')
            group.classList.add('fp-popup-designer-inline');
        if (collapsible) group.classList.add('fp-collapsible-group');
        /* An omitted Representation is the reference's section caption, a font step
         * above an explicit None (an explicit None stays label-sized). An
         * authored TitleFont keeps its own size (a bold TitleFont stays
         * label-sized). Normal and Strong separation keep the section caption
         * too; only None drops to the label size. */
        var sectionTitle = !/^(none|нет)$/i.test(String(prop(item, ['Representation', 'Отображение']) || '').trim())
            && !(item.properties && item.properties.TitleFontSpec);
        if (showGroupTitle(item) && label) {
            var ttc = prop(item, ['TitleTextColor', 'ЦветТекстаЗаголовка']);
            var linkTitle = popup || /гиперссылка/i.test(ttc);
            if (popup) {
                var titleBtn = el('button', 'fp-link fp-popup-group-title', label);
                titleBtn.type = 'button';
                group.appendChild(titleBtn);
                wrap._popupTitleBtn = titleBtn;
            } else if (collapsible) {
                var groupKey = itemKey(item);
                var collapsed = Object.prototype.hasOwnProperty.call(collapsedGroupByKey, groupKey)
                    ? !!collapsedGroupByKey[groupKey] : initiallyCollapsed(item);
                /* ControlRepresentation=Picture leaves the caption plain and puts
                 * the whole control in the +/- picture; the default draws the
                 * caption as the hyperlink that opens the group. */
                var repPicture = /picture|картинк/i.test(prop(item, ['ControlRepresentation', 'ОтображениеУправления']))
                    && !/hyperlink|гиперссылк/i.test(prop(item, ['ControlRepresentation', 'ОтображениеУправления']));
                var collapseBtn = el('button', 'fp-collapsible-title' + (repPicture ? '' : ' fp-collapsible-link')
                    + (sectionTitle ? ' fp-group-title-section' : ''));
                collapseBtn.type = 'button';
                collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                collapseBtn.appendChild(el('span', 'fp-collapse-arrow', collapsed ? '▸' : '▾'));
                var collapseText = el('span', 'fp-collapse-text');
                setFormattedText(collapseText, label, false,
                    !isFalse(prop(item, ['TitleFormatted'])));
                collapseBtn.appendChild(collapseText);
                group.appendChild(collapseBtn);
                if (collapsed) group.classList.add('fp-collapsed');
                wrap._collapseTitleBtn = collapseBtn;
            } else {
                /* An omitted Representation is not the same caption as an
                 * explicit None: the reference paints the platform default («слабое
                 * выделение») group as a section, one font step above label
                 * size, while groups that do author Representation=None stay
                 * label-sized. Painting the omitted case at 15px is held
                 * back: the wider caption also widens its group and shifts
                 * other forms. The caption must stop feeding group width
                 * first. */
                var groupTitle = el('div', 'fp-group-title' + (linkTitle ? ' fp-link' : '')
                    + (sectionTitle ? ' fp-group-title-section' : ''));
                setFormattedText(groupTitle, label, linkTitle,
                    !isFalse(prop(item, ['TitleFormatted'])));
                var titleColor = ttc && !linkTitle
                    ? absoluteColor(ttc) || styleItemColor(ttc, ctx && ctx.styleItems) : '';
                if (titleColor) groupTitle.style.color = titleColor;
                group.appendChild(groupTitle);
            }
        }
        var kids = el('div', popup ? 'fp-popup-group-body' : (collapsible ? 'fp-collapsible-body' : ''));
        group.appendChild(kids);
        wrap.appendChild(group);
        wrap._childBox = kids;
    } else if (tag === 'LabelDecoration') {
        var dcls = 'fp-label fp-label-decoration' + (isHyperlinkItem(item) ? ' fp-link' : '');
        var nm = String(item.name || '');
        /* Generated separators sometimes serialize a whitespace-only localized
         * Title. The generic localized-text fallback can expose its language
         * tags as "ru en", so the semantic element name is the reliable
         * discriminator here. */
        var explicitSeparator = /разделител/i.test(nm);
        if (explicitSeparator) {
            wrap.appendChild(el('span', 'fp-deco-sep '
                + (parentMeta && parentMeta.orientation === 'horizontal'
                    ? 'fp-deco-sep-vertical' : 'fp-deco-sep-horizontal')));
        } else if (label) {
            /* The reference label generator: only a label without authored
             * Height/MaxHeight, not unstretched, whose title has a space gets
             * WidthDependedHeight and wraps; any other label is one GDI line. */
            var labelHeight = parseInt(prop(item, ['Height', 'Высота']), 10) || 0;
            var labelMaxHeight = parseInt(prop(item, ['MaxHeight', 'МаксимальнаяВысота']), 10) || 0;
            var canDynamicHeight = !isFalse(prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))
                && !isFalse(prop(item, ['VerticalStretch', 'ВертикальноеРастягивание']))
                && !labelHeight && !labelMaxHeight && /\s/.test(String(label).trim());
            if (!canDynamicHeight) dcls += ' fp-label-one-line';
            /* The reference pads a link label by 1 px on each side (18 px per
             * line): Hyperlink, or a formatted title that is one whole <link>.
             * A link inside ordinary text keeps the plain 16 px box. */
            var linkText = String(label).trim();
            if (/^<link\b[^>]*>[\s\S]*<\/>$/i.test(linkText) && linkText.split(/<link\b/i).length === 2)
                dcls += ' fp-label-has-link';
            var decoration = el('span', dcls);
            /* VerticalAlign places the text inside a taller authored box
             * (Height=3, Top keeps the line beside a warning picture). Without
             * an authored Height the box is the text itself and the row centres
             * it: a Top label sits mid-height beside the 26px «?» button. */
            var labelVerticalAlign = labelHeight
                ? String(prop(item, ['VerticalAlign', 'ВертикальноеВыравнивание']) || '').toLowerCase() : '';
            if (labelVerticalAlign === 'top' || labelVerticalAlign === 'верх') wrap.classList.add('fp-label-valign-top');
            else if (labelVerticalAlign === 'bottom' || labelVerticalAlign === 'низ') wrap.classList.add('fp-label-valign-bottom');
            setFormattedText(decoration, label, isHyperlinkItem(item),
                !isFalse(prop(item, ['TitleFormatted'])));
            wrap.appendChild(decoration);
        }
        else {
            if (/разделител/i.test(nm)) wrap.appendChild(el('span', 'fp-deco-sep'));
            else {
                var sp = el('span', 'fp-deco-spacer');
                var sw = charSize(prop(item, ['Width']));
                if (sw) sp.style.width = sw + 'px';
                wrap.appendChild(sp);
            }
        }
    } else if (tag === 'PictureDecoration' || tag === 'PictureField') {
        /* The reference paints Image controls at the profile's intrinsic 24x24 px size.
         * Keep the semantic class separate from command/input icons: those
         * have their own, smaller chrome metrics. */
        var decorationPicture = pictureRef(item);
        var picWrap = el('span', 'fp-picture-icon fp-picture-decoration');
        if (/^StdPicture\./i.test(String(decorationPicture || '')))
            picWrap.classList.add('fp-standard-picture');
        if (/longoperation|длительнаяоперация/i.test(String(decorationPicture || '')))
            picWrap.classList.add('fp-picture-progress');
        if (/^StdPicture\.Dialog/i.test(String(decorationPicture || '')))
            picWrap.classList.add('fp-picture-dialog');
        var decorationIcon = pictureDecorationIconId(decorationPicture);
        /* A platform StdPicture on an unsized PictureDecoration with the
         * default PictureSize is a 0x0 image in the reference, like the command
         * hyperlinks above (e.g. CreateListItem, Delete are absent), while a
         * Proportionally scaled picture or a sized one is painted. */
        /* The large Dialog* pictures are painted at their own size (e.g. the
         * DialogExclamation triangle). */
        if (/^StdPicture\./i.test(String(decorationPicture || ''))
            && !/^StdPicture\.Dialog/i.test(String(decorationPicture || ''))
            && !prop(item, ['Width', 'Ширина']) && !prop(item, ['Height', 'Высота'])
            && !prop(item, ['PictureSize', 'РазмерКартинки'])) {
            picWrap.classList.add('fp-unpainted-picture');
            decorationIcon = '';
        }
        /* A PictureField's ValuesPicture is a strip indexed by the value; the
         * designer has no value and paints nothing (drawing it would show the
         * squeezed collection). */
        if (tag === 'PictureField' && !prop(item, ['Picture', 'HeaderPicture'])
            && prop(item, ['ValuesPicture'])) {
            picWrap.classList.add('fp-unpainted-picture');
            decorationIcon = '';
        }
        if (picWrap.classList.contains('fp-unpainted-picture')) {
            /* nothing to paint */
        } else if (commonPictureResource(decorationPicture, ctx) || decorationIcon
            || (/^StdPicture\.Dialog/i.test(String(decorationPicture || '')) && stdPictureUrl(decorationPicture)))
            appendPictureIcon(picWrap, decorationPicture, ctx, decorationIcon);
        else picWrap.classList.add('fp-picture-unresolved');
        wrap.appendChild(picWrap);
    } else if (tag === 'HTMLDocumentField' || tag === 'TextDocumentField'
        || tag === 'FormattedDocumentField') {
        /* The reference paints document fields as a framed white surface filling the
         * window. BorderColor (e.g. = FormBackColor) hides the frame. The
         * caption is shown only for an explicit TitleLocation. */
        wrap.className = 'fp-control-wrap fp-document-field fp-title-' + loc;
        if (label && loc !== 'none' && prop(item, ['TitleLocation', 'ПоложениеЗаголовка']))
            wrap.appendChild(el('span', 'fp-field-label', withColon(label, loc)));
        var docSurface = el('div', tag === 'HTMLDocumentField' ? 'fp-html-document' : 'fp-text-document');
        if (!prop(item, ['BorderColor', 'ЦветРамки'])) docSurface.classList.add('fp-document-framed');
        wrap.appendChild(docSurface);
    } else if (tag === 'ChartField') {
        wrap.appendChild(chartWidget());
    } else if (RARE_TAGS[tag]) {
        wrap.appendChild(fallbackWidget(plainFormattedText(label), tag));
    } else {
        wrap.appendChild(el('span', 'fp-fallback', label + (tag ? ' (' + tag + ')' : '')));
    }
    return wrap;
}

function isPaintlessLabelField(item, location, rendered, parentMeta) {
    if (!item || item.tag !== 'LabelField' || location !== 'none') return false;
    if (!parentMeta || parentMeta.tag !== 'Form' || parentMeta.orientation !== 'vertical') return false;
    var authoredHeight = parseInt(prop(item, ['Height', 'Высота']), 10) || 0;
    if (authoredHeight > 0 || isHyperlinkItem(item) || pictureRef(item)) return false;
    if (!isFalse(prop(item, ['AutoMaxWidth']))) return false;
    if (prop(item, ['Width', 'Ширина']) || prop(item, ['MaxWidth', 'МаксимальнаяШирина'])
        || prop(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание'])) return false;
    /* Derived type defaults (applyTypeDefaultsToModel) are not authored
     * runtime state; only structured runtime values make the field paint. */
    if (item.runtime && Object.keys(item.runtime).some(function (key) {
        return !DERIVED_TYPE_RUNTIME_KEYS[key];
    })) return false;
    if (!rendered) return false;
    return !String(rendered.textContent || '').trim()
        && !(rendered.children && rendered.children.length);
}

function renderablePages(pagesNode) {
    /* The platform drops structurally empty Page nodes from the visual tab set.
     * Keep them in the parsed model/outline for diagnostics, but do not paint
     * a tab which the reference itself never allocates. */
    return (pagesNode && pagesNode.childItems || []).filter(function (it) {
        return it && it.tag === 'Page' && it.childItems && it.childItems.length;
    });
}

function isRootFlattenedPage(item, parentItem) {
    return !!(item && item.tag === 'Pages' && pagesRep(item) === 'none'
        && parentItem && parentItem.tag === 'Form');
}

function isFlattenedPageLeadingCaptionItem(item) {
    return !!(item && item.tag === 'UsualGroup' && showGroupTitle(item)
        && groupBehavior(item) !== 'popup');
}

/* The reference starts a tab strip on the very top of the box the parent allocates to a
 * Pages: the strip's own 1px frame is the first painted row. The viewer's item
 * shell adds 1px padding plus a 1px selection border above it, so every level
 * of nested Pages pushed its content 2px down and the error accumulated with
 * the nesting depth (38px per level against the reference's 27px strip
 * plus 9px page inset). Only a Pages that really paints a strip is marked:
 * PagesRepresentation=None keeps the ordinary shell. */
function markPagesTabbedShell(outerEl, tabbed) {
    var node = outerEl;
    while (node && node.classList && !node.classList.contains('fp-item')) node = node.parentNode;
    if (!node || !node.classList) return;
    if (tabbed) node.classList.add('fp-pages-tabbed');
    else node.classList.remove('fp-pages-tabbed');
}

function renderPages(pagesNode, outerEl, meta, ctx) {
    outerEl.textContent = '';
    outerEl._fpPagesNode = pagesNode;
    outerEl._fpCtx = ctx;
    var pages = renderablePages(pagesNode);
    var pagesKey = itemKey(pagesNode);
    var ids = pages.map(itemKey).filter(Boolean);
    var active = pagesKey ? activePageIdByPagesKey[pagesKey] : null;
    if (active && ids.indexOf(active) < 0) active = null;
    if (!active && ids.length) {
        var firstVisible = pages.filter(function (pageItem) {
            return !isFalse(prop(pageItem, ['Visible', 'visible']));
        })[0];
        active = itemKey(firstVisible) || ids[0];
    }
    if (pagesKey && active) activePageIdByPagesKey[pagesKey] = active;
    var activePage = null;
    for (var i = 0; i < pages.length; i++) {
        if (itemKey(pages[i]) === active) { activePage = pages[i]; break; }
    }
    if (pagesRep(pagesNode) === 'none') {
        markPagesTabbedShell(outerEl, false);
        outerEl.className = layoutClass(meta);
        applyLayout(outerEl, meta);
        if (activePage && activePage.childItems && activePage.childItems.length) {
            var hiddenMeta = layoutMeta(activePage);
            outerEl.className = layoutClass(hiddenMeta);
            applyLayout(outerEl, hiddenMeta);
            renderPreview(activePage.childItems, outerEl, ctx, activePage);
            /* A page tooltip shown on the form (ShowTop/ShowBottom) is grey text
             * on the page content. */
            applyPageTooltip(outerEl, activePage);
            var leadingItem = outerEl.querySelector(':scope > .fp-item:first-child');
            if (leadingItem && isFlattenedPageLeadingCaptionItem(leadingItem._fpItem)
                && leadingItem.querySelector(':scope > .fp-control-wrap > .fp-collapsible-group > .fp-collapsible-title, '
                    + ':scope > .fp-control-wrap > .fp-group-block > .fp-group-title, '
                    + ':scope > .fp-control-wrap > .fp-group-bare > .fp-group-title')) {
                /* PagesRepresentation=None dissolves the Page shell in the reference.
                 * Its first ordinary group caption therefore starts on the
                 * Page content baseline instead of paying a second, nested
                 * group-leading margin. */
                leadingItem.classList.add('fp-flattened-page-leading-group');
            }
        }
        return;
    }
    outerEl.className = layoutClass(meta, { skipChildren: true, alias: 'fp-pages-outer' })
        + (pagesRep(pagesNode) === 'bottom' ? ' TabsOnBottom' : ' TabsOnTop');
    applyLayout(outerEl, meta);
    markPagesTabbedShell(outerEl, true);
    var tablist = el('div', 'fp-pages-tablist');
    tablist.setAttribute('role', 'tablist');
    var panelWrap = el('div', 'fp-pages-panel-wrap');
    pages.forEach(function (pageItem, idx) {
        var pid = itemKey(pageItem);
        if (!pid) return;
        /* Runtime 1C does not allocate a tab for Visible=false pages. Keep a
         * hidden page diagnosable: selecting it from the outline activates it
         * first, after which its hatched tab is shown until another page wins. */
        if (isFalse(prop(pageItem, ['Visible', 'visible'])) && pid !== active) return;
        var tab = el('button', 'fp-pages-tab');
        var pagePicture = pictureRef(pageItem);
        if (pagePicture) {
            appendPictureIcon(tab, pagePicture, ctx,
                iconIdFromRef(pagePicture) || 'photo', 'fp-page-tab-icon');
        }
        tab.appendChild(el('span', 'fp-page-tab-title',
            titleOf(pageItem, ctx) || pageItem.name || ('Страница ' + (idx + 1))));
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', pid === active ? 'true' : 'false');
        /* Hidden pages stay inspectable in the preview, but unlike a runtime
         * tab they must visibly communicate Visible=false. Do not use the
         * disabled/aria-disabled state: this diagnostic tab stays clickable. */
        if (isFalse(prop(pageItem, ['Visible', 'visible']))) {
            tab.classList.add('fp-page-hidden');
            tab.dataset.visible = 'false';
            tab.title = 'Видимость: Ложь';
        }
        tab.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            activePageIdByPagesKey[pagesKey] = pid;
            if (ctx && ctx.root && ctx.model) {
                renderPreview(displayItems(ctx.model), ctx.root, ctx, ctx.model);
                equalizeLocalFieldBlocks(ctx.root);
                runHorizontalStrategyPass(ctx.root);
            }
            selectIn(ctx.root, pid, ctx);
            if (ctx && ctx.onSelect) ctx.onSelect(pageItem);
        });
        tablist.appendChild(tab);
    });
    var panel = el('div', 'fp-pages-active-panel');
    panel.setAttribute('role', 'tabpanel');
    var inner = null;
    if (activePage && activePage.childItems && activePage.childItems.length) {
        inner = layoutMeta(activePage);
        panel.className += ' ' + layoutClass(inner);
        applyLayout(panel, inner);
        renderPreview(activePage.childItems, panel, ctx, activePage);
        applyPageTooltip(panel, activePage);
    } else if (!pages.length) {
        panel.className += ' fp-empty';
        panel.textContent = 'Нет страниц';
    }
    panelWrap.appendChild(panel);
    outerEl.appendChild(tablist);
    outerEl.appendChild(panelWrap);
    if (inner && inner.orientation === 'vertical') {
        equalizeFieldLabels(panel, true);
    }
}

function bindSelect(div, item, ctx) {
    div.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('th[data-id]')) return;
        e.stopPropagation();
        selectIn(ctx.root, itemKey(item), ctx);
        if (ctx.onSelect) ctx.onSelect(item);
    });
}

function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function locateItem(items, id, pageStack) {
    if (!items || !id) return null;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        if (itemKey(it) === id) return { item: it, pages: pageStack || [] };
        if (it.tag === 'Pages') {
            var pages = it.childItems || [];
            for (var p = 0; p < pages.length; p++) {
                if (!pages[p] || pages[p].tag !== 'Page') continue;
                var next = (pageStack || []).concat([{ pagesNode: it, page: pages[p] }]);
                if (itemKey(pages[p]) === id) return { item: pages[p], pages: next };
                var hit = locateItem(pages[p].childItems, id, next);
                if (hit) return hit;
            }
            continue;
        }
        var nested = locateItem(it.childItems, id, pageStack);
        if (nested) return nested;
        if (it.autoCommandBar) {
            nested = locateItem([it.autoCommandBar], id, pageStack);
            if (nested) return nested;
        }
        if (it.searchStringAddition) {
            nested = locateItem([it.searchStringAddition], id, pageStack);
            if (nested) return nested;
        }
        if (it.viewStatusAddition) {
            nested = locateItem([it.viewStatusAddition], id, pageStack);
            if (nested) return nested;
        }
    }
    return null;
}

function activatePagesForId(model, id) {
    var loc = locateItem(displayItems(model), id, []);
    if (!loc || !loc.pages || !loc.pages.length) return false;
    var changed = false;
    for (var i = 0; i < loc.pages.length; i++) {
        var pk = itemKey(loc.pages[i].pagesNode);
        var pid = itemKey(loc.pages[i].page);
        if (pk && pid && activePageIdByPagesKey[pk] !== pid) {
            activePageIdByPagesKey[pk] = pid;
            changed = true;
        }
    }
    return changed;
}

function selectIn(root, id, ctx) {
    if (!root) return null;
    if (ctx) ctx.selectedId = id || '';
    var nodes = root.querySelectorAll('.fp-item.selected, th.selected, .fp-popup-entry.selected');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('selected');
    if (!id) return null;
    var hit = root.querySelector('.fp-item[data-id="' + cssEscape(id) + '"]');
    if (hit) hit.classList.add('selected');
    var th = root.querySelector('th[data-id="' + cssEscape(id) + '"]');
    if (th) th.classList.add('selected');
    var entry = root.querySelector('.fp-popup-entry[data-id="' + cssEscape(id) + '"]');
    if (entry) entry.classList.add('selected');
    return hit || th || entry || null;
}

/* A data field whose DataPath the reference dropped (the attribute no longer exists,
 * e.g. Code with CodeLength=0 or Parent of a flat catalog) is not drawn by the
 * designer; neither is a group left with only such fields. */
var ORPHAN_DATA_FIELD_TAGS = {
    InputField: 1, CheckBoxField: 1, LabelField: 1, RadioButtonField: 1,
    TextDocumentField: 1, SpreadSheetDocumentField: 1, HTMLDocumentField: 1
};
function isOrphanDataField(item) {
    return !!(item && ORPHAN_DATA_FIELD_TAGS[item.tag || '']
        && !prop(item, ['DataPath']));
}
/* Only an object form drops them: its fields are bound to the object's
 * attributes, so a missing DataPath means a removed attribute. */
function orphanFieldsHidden(ctx) {
    var model = ctx && ctx.model;
    var main = model && mainAttribute(model);
    return !!(main && /Object\.|Объект\.|RecordManager\./i.test(String(prop(main, ['Type']) || '')));
}

function isOrphanOnlyGroup(item) {
    var tag = item && item.tag || '';
    if (tag !== 'UsualGroup' && tag !== 'Group' && tag !== 'CollapsibleGroup') return false;
    var kids = item.childItems || [];
    if (!kids.length) return false;
    var sawOrphan = false;
    for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        var ktag = kid.tag || '';
        if (ktag === 'ContextMenu' || ktag === 'ExtendedTooltip') continue;
        if (isFalse(prop(kid, ['Visible', 'visible']))) continue;
        if (isOrphanDataField(kid) || isOrphanOnlyGroup(kid)) { sawOrphan = true; continue; }
        return false;
    }
    return sawOrphan;
}

function renderPreview(items, parentEl, ctx, parentItem) {
    parentEl.innerHTML = '';
    if (!items || !items.length) {
        parentEl.classList.remove('fp-mockup');
        parentEl.textContent = 'Нет элементов';
        return;
    }
    parentEl.classList.add('fp-mockup');
    var inBar = parentItem && (parentItem.tag === 'AutoCommandBar' || parentItem.tag === 'CommandBar' || parentItem.tag === 'ButtonGroup');
    if (parentItem && parentItem.tag === 'AutoCommandBar'
        && formObjectKind(ctx && ctx.model) === 'catalog')
        parentEl.classList.add('fp-catalog-root-commandbar');
    if (parentItem && parentItem.tag === 'AutoCommandBar'
        && formObjectKind(ctx && ctx.model) === 'catalog')
        parentEl.classList.add('fp-catalog-standard-commandbar');
    if (parentItem && parentItem.tag === 'AutoCommandBar'
        && formObjectKind(ctx && ctx.model) === 'document'
        && items.some(function (item) {
            var role = stdCommandKey(item);
            return role === 'postandclose' || role === 'write' || role === 'post';
        }))
        parentEl.classList.add('fp-document-posting-commandbar');
    var parentMeta = parentItem ? layoutMeta(parentItem) : null;
    var extraBar = [];
    items.forEach(function (item) {
        if (isFalse(prop(item, ['Visible', 'visible']))) return;
        if (!inBar && orphanFieldsHidden(ctx) && (isOrphanDataField(item) || isOrphanOnlyGroup(item))) return;
        if (isDeadCommand(item)) return;
        /* Standard command availability depends on runtime document state,
         * which Form.xml does not contain. The deterministic preview models a
         * new/unposted document, so UndoPosting is unavailable regardless of
         * how an author grouped or named the neighbouring Post command. */
        if (inBar && /StandardCommand\.UndoPosting$/i.test(String(
            prop(item, ['CommandName', 'Command']) || ''))) return;
        if (inBar && inAdditionalBar(item)) { extraBar.push(item); return; }
        var tag = item.tag || '';
        /* Empty generated groups are extension insertion points, not visible
         * designer sections. 1C suppresses them until a child is inserted. */
        if ((tag === 'UsualGroup' || tag === 'Group' || tag === 'CollapsibleGroup'
            || tag === 'Pages')
            && (!item.childItems || !item.childItems.length)) return;
        if (inBar && tag === 'Popup' && !popupHasCommands(item) && !isCreateBasedOnPopup(item)) {
            extraBar.push(item);
            return;
        }
        if (tag === 'ButtonGroup' && !hasMainBarChildren(item)) {
            collectAdditionalBarItems(item, extraBar);
            return;
        }
        var id = itemKey(item);
        var container = isContainer(tag) && tag !== 'Popup' && tag !== 'Table';
        var meta = isContainer(tag) && tag !== 'Popup' ? layoutMeta(item) : null;
        var div = el('div', 'fp-item ' + (container || tag === 'Table' ? 'fp-container' : 'fp-control'));
        div._fpItem = item;
        if (emptyDecorationIsCompactInParent(item, parentMeta))
            div.classList.add('fp-empty-no-spacing-decoration');
        if (inBar) div.classList.add('fp-bar-item');
        /* A Compact ButtonGroup joins its buttons («Установить / Снять пометку»:
         * one 59px block sharing a 1px edge). */
        if (tag === 'ButtonGroup' && /compact|компакт/i.test(String(prop(item, ['Representation', 'Отображение']) || '')))
            div.classList.add('fp-buttongroup-compact');
        if (inBar && tag === 'SearchStringAddition') div.classList.add('fp-search-item');
        if (isOrdinaryRowControl(tag, parentMeta, inBar)
            || (!inBar && meta && meta.compactDecorationRow)) {
            div.classList.add('fp-ordinary-row-control');
            /* Horizontal compact rows are paint-only (no 1px shell). A
             * vertical compact stack still uses Single gap, but the TextBox
             * sits 2px below the item top. Restore only top chrome so wrap
             * rows do not grow 4px and shove the rows below. */
            if (parentMeta && parentMeta.orientation === 'vertical' && tag === 'InputField')
                div.classList.add('fp-vertical-compact-field');
        }
        if (isHelpItem(item)) div.classList.add('fp-help-item');
        if (tag === 'Button'
            && String(prop(item, ['ShapeRepresentation']) || '').toLowerCase() === 'none')
            div.classList.add('fp-shape-none-button');
        if (meta) {
            div.classList.add('fp-container-' + meta.orientation);
            if ((meta.containerClassHints || []).indexOf('container-bare') >= 0) div.classList.add('fp-bare');
            var directVisibleChildren = (item.childItems || []).filter(function (child) {
                return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
            });
            /* Runtime-backed decorations can all be empty while their authored
             * vertical wrapper still owns one Taxi logical row. The reference keeps that
             * row, but does not stack the individual empty decoration heights. */
            if (meta.orientation === 'vertical'
                && directVisibleChildren.length > 0
                && directVisibleChildren.every(isEmptyLabelDecoration))
                div.classList.add('fp-empty-decoration-row');
            if (meta.orientation === 'horizontal'
                && meta.verticalSpacing === 'none'
                && directVisibleChildren.some(function (child) {
                    return child.tag === 'Button'
                        && String(prop(child, ['ShapeRepresentation']) || '').toLowerCase() === 'none';
                })
                && directVisibleChildren.some(function (child) { return child.tag === 'PictureDecoration'; }))
                div.classList.add('fp-compact-decoration-value-row');
            if (meta.groupMode === 'always-horizontal'
                && representationOf(item) === 'none'
                && /^#fff(?:fff)?$/i.test(String(prop(item, ['BackColor', 'ЦветФона']) || ''))
                && directVisibleChildren.length === 2
                && directVisibleChildren[0].tag === 'InputField'
                && directVisibleChildren[1].tag === 'PictureDecoration'
                && /(?:^|\.)DataSearch$/i.test(String(pictureRef(directVisibleChildren[1]) || '')))
                div.classList.add('fp-search-picture-surface');
        }
        div.dataset.id = id;
        div.dataset.tag = tag;
        if (item && item.name) div.dataset.name = String(item.name);
        /* A body CommandBar right above a table stands where the table's own
         * toolbar would (the filter chips sit 10px below the buttons, as
         * under a table toolbar). */
        if (tag === 'CommandBar') {
            /* The table may open a hidden-tab Pages or a group (CommandBar →
             * Pages → table). */
            var nextItem = items[items.indexOf(item) + 1];
            while (nextItem && nextItem.tag !== 'Table' && isContainer(nextItem.tag)
                && nextItem.childItems && nextItem.childItems.length
                && !(nextItem.tag === 'Pages' && pagesRep(nextItem) !== 'none'))
                nextItem = nextItem.childItems[0];
            if (nextItem && nextItem.tag === 'Table') div.classList.add('fp-table-source-bar');
        }
        if (tag === 'InputField') div.dataset.fieldKind = fieldKind(item, ctx);
        var shownType = itemTypePresentation(item, ctx);
        if (shownType) div.title = 'Тип: ' + shownType;
        var control = createControl(item, tag, ctx, parentMeta);
        div.appendChild(control);
        if (isPaintlessLabelField(item, titleLocation(item, parentMeta), control, parentMeta))
            div.classList.add('fp-paintless-label-field');
        if (tag === 'LabelDecoration' && control.querySelector('.fp-label-decoration'))
            div.classList.add('fp-native-label-decoration');
        /* AutoMaxWidth=false without Width/MaxWidth leaves the caption width
         * to its container: the reference wraps it there instead of widening the form
         * (one long hint could otherwise grow a 1600px canvas). */
        if (tag === 'LabelDecoration'
            && !prop(item, ['Width', 'Ширина']) && !prop(item, ['MaxWidth', 'МаксимальнаяШирина'])
            && labelDecorationCanDynamicHeight(item))
            div.classList.add('fp-unbounded-wrap-text');
        if (isRootFlattenedPage(item, parentItem))
            div.classList.add('fp-root-flattened-page');
        if (isCompactColorBand(item)) div.classList.add('fp-compact-color-band');
        var surfaceBackColor = String(prop(item, ['BackColor', 'ЦветФона']) || '');
        var rootSurface = !!(parentMeta && parentMeta.tag === 'Form');
        var neutralNestedSurface = /^#(?:fff(?:fff)?|f0f0f0)$/i.test(surfaceBackColor)
            || /(?:form|field|window).*backcolor|цветфон(?:а)?формы/i.test(surfaceBackColor);
        /* One card of a stack whose spacing is the separator between the cards
         * does stand on another colour, so the reference gives it the vertical half of the
         * painted-surface inset (the first glyph row sits 8px below the card
         * top, not 5px). Only the vertical half: the 5px
         * horizontal one belongs to a band that also owns its width, and adding
         * it here re-measures every column. */
        if (isContainer(tag) && representationOf(item) === 'none'
            && /^#(?:fff(?:fff)?|f0f0f0)$/i.test(surfaceBackColor)
            && isNativeCardStack(parentItem))
            div.classList.add('fp-stack-card');
        else if (isContainer(tag) && representationOf(item) === 'none' && !rootSurface
            && /^#(?:fff(?:fff)?|f0f0f0)$/i.test(surfaceBackColor))
            div.classList.add('fp-neutral-surface');
        if (isContainer(tag) && representationOf(item) === 'none'
            && surfaceBackColor && (rootSurface || !neutralNestedSurface)) {
            /* Representation=None suppresses the group frame, but the reference keeps
             * a small content inset for every painted surface. It is not only
             * a root-form rule: nested green/red/grey status bands use the
             * same inset and otherwise collapse by roughly ten pixels. */
            div.classList.add('fp-color-surface');
            /* A surface of plain fields (a totals panel) centres its row. */
            if (!(item.childItems || []).some(function (child) { return child && isContainer(child.tag); }))
                div.classList.add('fp-color-surface-leaf');
            var surfaceHasPicture = (item.childItems || []).some(function (child) {
                return child && child.tag === 'PictureDecoration'
                    && !isFalse(prop(child, ['Visible', 'visible']));
            });
            if (surfaceHasPicture) div.classList.add('fp-color-surface-picture');
            if (rootSurface)
                div.classList.add('fp-root-color-surface');
        }
        applyItemMetrics(div, item, tag, parentMeta, ctx, parentItem);
        if (tag === 'Table' && control._minimumHeight) {
            div.style.minHeight = control._minimumHeight + 'px';
            var tableSizing = tableHeightMetrics(item);
            var tableHeight = tableSizing.preferred;
            if (tableHeight) {
                div.dataset.fpTableNormalHeight = String(tableHeight);
                if (tableSizing.maximum) div.dataset.fpTableMaxHeight = String(tableSizing.maximum);
                div.classList.add('fp-table-authored-height');
            }
        }
        applyTooltip(div, item, inBar);
        bindSelect(div, item, ctx);
        if (tag === 'Popup' && control._popupBtn) bindPopupToggle(control, control._popupBtn, ctx, item);
        if (isPopUpGroup(item) && control._popupTitleBtn)
            bindGroupPopupToggle(control, control._popupTitleBtn, ctx, item);
        if (groupBehavior(item) === 'collapsible' && control._collapseTitleBtn)
            bindCollapsibleToggle(control, control._collapseTitleBtn, ctx, item);
        parentEl.appendChild(div);
        if (tag === 'Table') {
            var cols = control._tableCols || tableColumns(item);
            var ths = control.querySelectorAll('th[data-id]');
            for (var ti = 0; ti < ths.length; ti++) {
                (function (th) {
                    var colId = th.getAttribute('data-id');
                    if (!colId) return;
                    var colItem = null;
                    for (var c = 0; c < cols.length; c++) {
                        if (itemKey(cols[c]) === colId) { colItem = cols[c]; break; }
                    }
                    th.addEventListener('click', function (ev) {
                        ev.stopPropagation();
                        selectIn(ctx.root, colId, ctx);
                        if (ctx.onSelect && colItem) ctx.onSelect(colItem);
                    });
                })(ths[ti]);
            }
        } else if (container && control._childBox && ((item.childItems && item.childItems.length) || tag === 'Pages')) {
            var box = control._childBox;
            if (tag === 'Pages') {
                renderPages(item, box, meta, ctx);
            } else {
                box.className = (box.className ? box.className + ' ' : '') + layoutClass(meta);
                applyLayout(box, meta);
                /* A nested row without its own VerticalAlign inherits the
                 * centring of the row it sits in (a header with
                 * VerticalAlign=Center keeps a tumbler and a label on the
                 * line of the field beside them). */
                if (meta && meta.orientation === 'horizontal'
                    && !String(prop(item, ['VerticalAlign', 'ВертикальноеВыравнивание']) || '').trim()
                    && parentEl.classList && parentEl.classList.contains('fp-children-horizontal')
                    && parentEl.style.alignItems === 'center')
                    box.style.alignItems = 'center';
                renderPreview(item.childItems, box, ctx, item);
                if (meta && meta.orientation === 'horizontal') {
                    if (meta.noWrap) box.classList.add('fp-children-nowrap');
                }
            }
        }
    });
    /* The form's own AutoCommandBar owns the platform More affordance even
     * while its menu is empty: standard runtime actions remain available
     * there whatever the form's object kind, so a DataProcessor bar keeps
     * «Еще» exactly as a catalog or document bar does. Table bars get the same
     * permanent button on their own path. An authored CommandBar group is
     * NOT a form bar: the reference has no «Еще» for most of them, so
     * such a group still earns More only through real additional items or
     * width overflow. */
    /* A form bar placed at the bottom (CommandBarLocation=Bottom) is a dialog
     * button row: the reference packs it to the right edge and draws no empty «Еще»
     * (e.g. Продолжить/Отмена). */
    var formBottomBar = inBar && parentItem && parentItem.tag === 'AutoCommandBar'
        && String(parentItem.id) === '-1' && ctx && ctx.model
        && commandBarLocation(ctx.model) === 'bottom';
    if (formBottomBar && parentEl.classList) parentEl.classList.add('fp-form-bar-bottom');
    /* The permanent More belongs to the form's own bar; a table bar decides it
     * in createControl. */
    var tableToolbar = parentEl.classList && parentEl.classList.contains('fp-table-toolbar');
    if (inBar && parentItem && parentItem.tag !== 'ButtonGroup'
        && (extraBar.length || (parentItem.tag === 'AutoCommandBar' && !formBottomBar && !tableToolbar))) {
        var more = el('button', 'fp-button fp-popup');
        more.type = 'button';
        setPopupCaption(more, 'Еще');
        more.title = extraBar.map(function (it) { return titleOf(it, ctx) || it.name; }).filter(Boolean).join(', ');
        var moreWrap = el('div', 'fp-item fp-control fp-bar-item fp-more-item fp-popup-wrap');
        moreWrap._fpBaseEntries = extraBar;
        moreWrap._fpCtx = ctx;
        moreWrap.appendChild(more);
        moreWrap._fpMenu = makePopupMenuEntries(commandBarMenuEntries(extraBar), ctx);
        moreWrap.appendChild(moreWrap._fpMenu);
        bindPopupToggle(moreWrap, more, ctx, null);
        var help = parentEl.querySelector('.fp-help-item');
        if (help) parentEl.insertBefore(moreWrap, help);
        else parentEl.appendChild(moreWrap);
    }
    if (inBar && parentItem && (parentItem.tag === 'AutoCommandBar' || parentItem.tag === 'CommandBar')) {
        parentEl._fpCtx = ctx;
        if (parentItem.tag === 'AutoCommandBar' && String(parentItem.id) === '-1') parentEl._fpFormRootBar = true;
        pinCommandBarTail(parentEl);
        observeCommandBar(parentEl);
    }
    if (parentItem && parentItem.tag === 'Page') {
        var pageCaptionSeen = false;
        for (var pageChildIndex = 0; pageChildIndex < parentEl.children.length; pageChildIndex++) {
            var pageChild = parentEl.children[pageChildIndex];
            if (!pageChild.classList || !pageChild.classList.contains('fp-item')) continue;
            var ownCaption = pageChild.querySelector(
                ':scope > .fp-control-wrap > .fp-group-block > .fp-group-title, '
                + ':scope > .fp-control-wrap > .fp-group-bare > .fp-group-title, '
                + ':scope > .fp-control-wrap > .fp-collapsible-group > .fp-collapsible-title');
            if (!ownCaption) {
                pageCaptionSeen = false;
                continue;
            }
            if (pageCaptionSeen) pageChild.classList.add('fp-page-following-group-caption');
            pageCaptionSeen = true;
        }
    }
    applyPairedTitledLogicalColumnContract(parentEl, parentItem);
    if (parentMeta && parentMeta.orientation === 'vertical')
        applyOmittedVerticalSectionBoundaries(parentEl, parentItem);
    if (parentMeta && parentMeta.orientation === 'vertical')
        equalizeFieldLabels(parentEl, true);
    if (parentMeta && parentMeta.orientation === 'horizontal') {
        fitLeadingCaptionBeforeTitledPagesNone(parentEl);
        fitCompactTitledHorizontalPairCaptions(parentEl, parentItem);
    }
    applyAuthoredEditorActionCaptionBands(parentEl, parentMeta);
    applyCompoundSelectorCaptionBands(parentEl);
}

function compactCatalogRefEditorPaintWidth() {
    /* CatalogRef without Width is a compact presentation editor, not the
     * leftover of a later Width=55 sibling. The reference paints ~26 form units plus
     * the 10px editor inset; choice/open glyphs live inside that box. */
    return 26 * REF_AUTHORED_CHAR_PX + TAXI_LAYOUT_METRICS.authoredEditorInsetWidth;
}

function fitCompactTitledHorizontalPairCaptions(box, item) {
    if (!box || !compactTitledHorizontalPairKeepsLocalCaptions(item, box)) return 0;
    var changed = 0;
    var lastField = null;
    for (var i = 0; i < box.children.length; i++) {
        var child = box.children[i];
        if (!child.classList || !child.classList.contains('fp-control')) continue;
        lastField = child;
        var wrap = child.querySelector && child.querySelector('.fp-field-row');
        if (fieldRowSkipped(wrap)) continue;
        var label = wrap.querySelector && wrap.querySelector('.fp-field-label');
        if (!label) continue;
        var track = throughAlignTitleTrackWidth([throughAlignGlyphMetric(label)]);
        if (track < 24 || track > 280) continue;
        label.style.minWidth = track + 'px';
        label.style.maxWidth = track + 'px';
        label.style.flex = '0 0 ' + track + 'px';
        changed++;
    }
    var editor = lastField && lastField.querySelector && lastField.querySelector('.fp-input-wrap');
    if (editor) {
        var paint = compactCatalogRefEditorPaintWidth();
        editor.style.width = paint + 'px';
        editor.style.minWidth = paint + 'px';
        editor.style.maxWidth = paint + 'px';
        editor.style.flex = '0 0 ' + paint + 'px';
        changed++;
    }
    return changed;
}

function fitLeadingCaptionBeforeTitledPagesNone(box) {
    if (!box || !box.classList || !box.classList.contains('fp-children-horizontal')) return 0;
    /* Outer ThroughAlign must not absorb the caption of a titled Pages=None
     * sibling. The leading caption still owns a local Taxi text track, or
     * the TextBox starts ~6px left of the reference and the next field
     * shifts with it. */
    var firstField = null;
    var titledPages = false;
    for (var i = 0; i < box.children.length; i++) {
        var n = box.children[i];
        if (!n.classList) continue;
        if (n.classList.contains('fp-control') && n.dataset && n.dataset.tag === 'InputField') {
            if (!firstField) firstField = n;
            continue;
        }
        if (n.classList.contains('fp-pages-none') && n.querySelector
            && n.querySelector('.fp-field-label')) titledPages = true;
    }
    if (!firstField || !titledPages) return 0;
    var wrap = firstField.querySelector('.fp-field-row');
    if (fieldRowSkipped(wrap)) return 0;
    var label = wrap.querySelector('.fp-field-label');
    if (!label) return 0;
    /* Caption chrome is sideTitleGap (TextBox x≈116). The 5px difference vs
     * pagePadding used to live in the label minWidth and shoved the next
     * field left; keep it as trailing slot margin so the Pages=None sibling
     * stays put. */
    var needed = wrappedSideCaptionTrackWidth(label);
    if (needed < 40 || needed > 280) return 0;
    if ((parseFloat(label.style.minWidth) || 0) >= needed) return 0;
    label.style.minWidth = needed + 'px';
    var slotPad = TAXI_LAYOUT_METRICS.pagePadding.horizontal
        - TAXI_LAYOUT_METRICS.sideTitleGap;
    if (slotPad > 0) firstField.style.marginRight = slotPad + 'px';
    return 1;
}

function fitAllLeadingCaptionsBeforeTitledPagesNone(root) {
    if (!root || !root.querySelectorAll) return 0;
    var rows = root.querySelectorAll('.fp-children-horizontal');
    var changed = 0;
    for (var i = 0; i < rows.length; i++)
        changed += fitLeadingCaptionBeforeTitledPagesNone(rows[i]);
    return changed;
}

function applyAuthoredEditorActionCaptionBands(scope, meta) {
    if (!scope || !meta || !meta.authoredEditorActionRow) return;
    for (var i = 0; i < scope.children.length; i++) {
        var child = scope.children[i];
        if (!child.classList || !child.classList.contains('fp-control')
            || child.dataset.tag !== 'InputField') continue;
        var row = child.querySelector(':scope > .fp-control-wrap.fp-field-row.fp-title-left');
        var label = row && row.querySelector(':scope > .fp-field-label');
        if (!label) continue;
        label.style.minWidth = authoredEditorActionCaptionWidth(
            throughAlignGlyphMetric(label)) + 'px';
    }
}

function applyCompoundSelectorCaptionBands(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var rows = scope.querySelectorAll('.fp-compound-selector-row');
    if (scope.classList && scope.classList.contains('fp-compound-selector-row'))
        rows = [scope].concat(Array.prototype.slice.call(rows));
    for (var r = 0; r < rows.length; r++) {
        var labels = rows[r].querySelectorAll(
            ':scope > .fp-item > .fp-control-wrap.fp-field-row:not(.fp-title-none) > .fp-field-label');
        var captionBand = 0;
        for (var i = 0; i < labels.length; i++)
            captionBand = Math.max(captionBand, intrinsicLabelTextMetric(labels[i]));
        captionBand = Math.ceil(captionBand / REF_AUTHORED_CHAR_PX) * REF_AUTHORED_CHAR_PX;
        for (var j = 0; j < labels.length; j++) labels[j].style.minWidth = captionBand + 'px';
    }
}

function titleLocationAuthored(item) {
    return /^left$/i.test(String(prop(item, ['TitleLocation', 'ПоложениеЗаголовка']) || ''));
}

function fieldRowSkipped(wrap) {
    if (!wrap || !wrap.classList) return true;
    return wrap.classList.contains('fp-title-top')
        || wrap.classList.contains('fp-title-bottom')
        || wrap.classList.contains('fp-title-none')
        || (wrap.classList.contains('fp-check-row') && !wrap.classList.contains('fp-title-left'));
}

function isCompactInlineButtonAffordance(sibling, fieldNode) {
    if (!sibling || !sibling.dataset || sibling.dataset.tag !== 'Button') return false;
    var fieldItem = fieldNode && fieldNode._fpItem;
    if (fieldItem && charSize(prop(fieldItem, ['Width', 'Ширина']))) return false;
    var buttonItem = sibling._fpItem;
    if (!buttonItem) return false;
    var maxWidth = parseInt(prop(buttonItem, ['MaxWidth', 'МаксимальнаяШирина']), 10) || 0;
    return maxWidth > 0 && maxWidth <= 4 && isFalse(prop(buttonItem, ['AutoMaxWidth']));
}

/* A no-stretch Width field beside a titled stretch sibling is two
 * independent editors on one row. Pulling its caption into the parent
 * ThroughAlign track pads it 28px past the reference. INN/KPP-style rows
 * keep joining: those leading fields are not HorizontalStretch=false. */
var COMPACT_PAIR_SHARED_CAPTION_MIN_BODY = 700;

/* Caption tracks are published once; a later window resize only re-runs the
 * strategy pass. Switch the shared/local caption of such a pair here. */
function refitSharedCompactPairCaptions(body) {
    if (!body || !body.querySelectorAll) return;
    var narrow = body.clientWidth < COMPACT_PAIR_SHARED_CAPTION_MIN_BODY;
    var rows = body.querySelectorAll('[data-fp-wide-shared-caption="1"]');
    for (var i = 0; i < rows.length; i++) {
        var label = rows[i].querySelector('.fp-field-row.fp-title-left > .fp-field-label');
        if (!label) continue;
        if (narrow) {
            if (label.dataset.fpSharedCaptionMinWidth == null)
                label.dataset.fpSharedCaptionMinWidth = label.style.minWidth || '';
            label.style.minWidth = throughAlignTitleTrackWidth([throughAlignGlyphMetric(label)]) + 'px';
        } else if (label.dataset.fpSharedCaptionMinWidth != null) {
            label.style.minWidth = label.dataset.fpSharedCaptionMinWidth;
            delete label.dataset.fpSharedCaptionMinWidth;
        }
    }
}

function formBodyWidth(node) {
    var body = node && node.closest ? node.closest('.fp-body') : null;
    return body ? body.clientWidth : Infinity;
}

function compactTitledHorizontalPairKeepsLocalCaptions(item, node) {
    if (!item || !item.childItems) return false;
    var kids = (item.childItems || []).filter(function (child) {
        return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
    });
    if (kids.length !== 2) return false;
    if (kids[0].tag !== 'InputField' || kids[1].tag !== 'InputField') return false;
    if (titleLocation(kids[0]) === 'none' || titleLocation(kids[1]) === 'none') return false;
    if (!charSize(prop(kids[0], ['Width', 'Ширина']))) return false;
    if (!isFalse(prop(kids[0], ['HorizontalStretch', 'ГоризонтальноеРастягивание']))) return false;
    if (charSize(prop(kids[1], ['Width', 'Ширина']))) return false;
    /* The pair stays local only inside a column of authored Width. Without
     * it the reference aligns the pair's caption with the other captions on
     * the parent caption track. */
    var rowNode = node && node.closest ? node.closest('.fp-item') : null;
    var ownerNode = rowNode && rowNode.parentElement && rowNode.parentElement.closest
        ? rowNode.parentElement.closest('.fp-item') : null;
    /* A narrow window cannot hold the shared caption track in front of the
     * pair: at 480px a field would lose its editor under the right
     * column, so the captions stay local there. The column width is
     * not final while captions are collected, so the form body decides. */
    if (ownerNode && ownerNode._fpItem
        && !charSize(prop(ownerNode._fpItem, ['Width', 'Ширина']))) {
        if (rowNode.dataset) rowNode.dataset.fpWideSharedCaption = '1';
        if (formBodyWidth(ownerNode) >= COMPACT_PAIR_SHARED_CAPTION_MIN_BODY) return false;
    }
    return true;
}

function firstFieldLabel(box) {
    if (!box) return null;
    var decoration = null;
    for (var i = 0; i < box.children.length; i++) {
        var n = box.children[i];
        if (!n.classList) continue;
        if (n.classList.contains('fp-control')) {
            /* A button ahead of the field opens the row: the caption after it
             * is local (a 31px caption, not the 84px page track). */
            if (n.dataset && n.dataset.tag === 'Button' && !decoration) return null;
            var wrap = n.querySelector('.fp-field-row');
            if (!fieldRowSkipped(wrap)) {
                var lab = wrap && wrap.querySelector('.fp-field-label');
                if (lab) {
                    if (box.children.length > 1
                        && !box.classList.contains('fp-container-bare')) return null;
                    /* Number/date and INN/KPP are ordinary compound field
                     * rows. Their first caption participates in the parent
                     * vertical column even though more controls follow it.
                     * A field followed by a button/picture is an action row
                     * and remains local: unlike another field or a nested
                     * status container, that sibling has no field row. */
                    var extraFieldCount = 0;
                    var hasActionSibling = false;
                    for (var s = i + 1; s < box.children.length; s++) {
                        var sibling = box.children[s];
                        if (!sibling.classList) continue;
                        /* A Pages=None (or other) container that itself hosts a
                         * titled editor is a second value on this row.
                         * Skipping it made the first caption look like a lone
                         * column member and padded it to the column track. */
                        if (sibling.classList.contains('fp-container')) {
                            if (sibling.querySelector && sibling.querySelector('.fp-field-label'))
                                return null;
                            continue;
                        }
                        if (sibling.classList.contains('fp-control')
                            && sibling.querySelector('.fp-field-row')) {
                            extraFieldCount++;
                            continue;
                        }
                        /* A small picture decoration is an inline affordance
                         * of the value (add/remove phone, open picker), not a
                         * separate action row. Keep the field caption in the
                         * surrounding through-alignment column. */
                        if (sibling.dataset && sibling.dataset.tag === 'PictureDecoration') continue;
                        /* A title-less status picture of the value is the same
                         * inline affordance (the field keeps the page
                         * caption track). */
                        if (sibling.dataset && sibling.dataset.tag === 'PictureField'
                            && sibling._fpItem && titleLocation(sibling._fpItem) === 'none') continue;
                        if (isCompactInlineButtonAffordance(sibling, n)) continue;
                        hasActionSibling = true;
                    }
                    /* A single field followed by a button is an action row and
                     * stays local. Two or more value fields form a compound
                     * row even when an optional trailing action button exists
                     * (for example Planned / Completed / Cancelled totals). */
                    if (hasActionSibling && !extraFieldCount) return null;
                    return lab;
                }
            }
        }
        /* Configurator-generated forms often build a field row explicitly:
         * LabelDecoration + InputField(TitleLocation=None), instead of using
         * the input field's own title.  Such labels participate in the same
         * through alignment as ordinary field titles.  A row made solely of
         * decorations (for example a separator assembled from three empty
         * labels) is deliberately excluded. */
        var tag = n.dataset && n.dataset.tag;
        if (!decoration && tag === 'LabelDecoration') {
            var explicit = n.querySelector('.fp-label');
            if (explicit && String(explicit.textContent || '').trim()) decoration = explicit;
        } else if (decoration && tag && tag !== 'LabelDecoration') {
            /* The decoration is an external field title only when the next
             * item is the title-less value control it labels. A button or a
             * nested group after an explanatory decoration is ordinary row
             * content and must not widen unrelated field-title columns. */
            return titleLessValueNode(n, box) ? decoration : null;
        }
    }
    return null;
}

/* The value an external caption decoration labels: a title-less editor, a
 * title-less check box, a hyperlink in a sized caption row, or a bare
 * horizontal wrapper that opens with one of them. The reference paints such
 * check boxes, check-box pairs and button+picture wrappers on the same track
 * as the title-less editors. */
function titleLessValueNode(n, box) {
    if (!n || !n.classList) return false;
    var tag = n.dataset && n.dataset.tag;
    if (n.classList.contains('fp-control')) {
        if ((tag === 'Button' || tag === 'Hyperlink') && n.querySelector('.fp-link'))
            return !!(box && box.closest && box.closest('.fp-item.fp-sized-width'));
        var valueWrap = n.querySelector('.fp-field-row');
        if (!valueWrap) return false;
        if (valueWrap.classList.contains('fp-title-none')) return true;
        return valueWrap.classList.contains('fp-check-row')
            && !valueWrap.querySelector('.fp-field-label');
    }
    if (tag !== 'UsualGroup' || !n.classList.contains('fp-container')) return false;
    var inner = n.querySelector('.fp-children');
    if (!inner || !inner.classList.contains('fp-children-horizontal')
        || !inner.classList.contains('fp-container-bare')) return false;
    for (var i = 0; i < inner.children.length; i++) {
        var child = inner.children[i];
        if (child.classList && child.classList.contains('fp-item'))
            return titleLessValueNode(child, box);
    }
    return false;
}

/* A generated explicit-title row models the caption as a leading non-empty
 * LabelDecoration followed by the title-less control it labels. United=false
 * resolves that wrapper to ThroughAlign=dontuse, which detaches its own column
 * chrome — but the decoration is still this row's field title, and the reference puts
 * every such row of one vertical scope on a single track. Only rows
 * firstFieldLabel already recognises qualify, so an explanatory decoration
 * or a separator row stays local. */
function captionLedHorizontalRow(inner, item) {
    if (!inner || !inner.classList
        || !inner.classList.contains('fp-children-horizontal')) return false;
    var kids = visibleLayoutChildren(item);
    if (kids.length < 2) return false;
    if (kids[0].tag !== 'LabelDecoration' || isEmptyLabelDecoration(kids[0])) return false;
    return !!firstFieldLabel(inner);
}

/* A horizontal band of through-aligned columns is still one caption scope. The reference
 * keeps a single caption track per vertical ThroughAlign scope and sees through
 * the dissolved Representation=None wrappers, so the leading column's captions
 * are measured together with the surrounding stack's (a header band shares
 * the track of the totals and comment rows below it).
 * A lone column is the opposite case — an ordinary wrapper around one vertical
 * stack, whose captions stay on their own track.
 * Requiring a second Use column keeps those wrappers, and rows pairing a Use
 * column with an explicit DontUse one, on the established local behaviour.
 * Only the leading column is projected: the later columns keep their own
 * narrow tracks rather than inheriting the scope maximum. */
function leadingThroughAlignColumnBox(inner) {
    if (!inner || !inner.children) return null;
    var column = null;
    var useColumns = 0;
    for (var i = 0; i < inner.children.length; i++) {
        var child = inner.children[i];
        if (!child.classList || !child.classList.contains('fp-item')) continue;
        var box = child.classList.contains('fp-container') && child.querySelector
            ? child.querySelector('.fp-children') : null;
        var isUseColumn = !!(box && box.classList
            && box.classList.contains('fp-children-vertical')
            && (box.classList.contains('fp-logical-subgrid') || box.dataset
                && String(box.dataset.fpThroughAlign || '').toLowerCase() === 'use'));
        if (!column) {
            if (!isUseColumn) return null;
            column = box;
        }
        if (isUseColumn) useColumns++;
    }
    return useColumns >= 2 ? column : null;
}

function collectFieldLabels(box, deep) {
    var labels = [];
    if (!box) return labels;
    for (var i = 0; i < box.children.length; i++) {
        var n = box.children[i];
        if (!n.classList) continue;
        if (n.classList.contains('fp-control')) {
            var wrap = n.querySelector('.fp-field-row');
            if (fieldRowSkipped(wrap)) continue;
            var lab = wrap && wrap.querySelector('.fp-field-label');
            if (lab) labels.push(lab);
            continue;
        }
        if (!deep || !n.classList.contains('fp-container')) continue;
        /* A highlighted tooltip/card group is a self-contained field block.
         * Its local rows align with one another, but must not inherit a wider
         * caption column from the surrounding page. */
        if (n.classList.contains('fp-tooltip-bg')) continue;
        /* A tabbed Pages item's own subtree reuses the .fp-children class on
         * the active page's panel (deep inside .fp-pages-outer). querySelector()
         * would reach right through to it and pull that page's field labels
         * into this equalization pass, so root-level label widths would shift
         * with whichever tab happened to be open. Tabbed Pages already
         * equalizes its own panel separately. PagesRepresentation=None hides
         * the tabs but keeps the panel: the reference gives fields inside such
         * a Pages their own narrow caption track instead of the outer one. */
        if (n.dataset && n.dataset.tag === 'Pages') continue;
        var inner = n.querySelector('.fp-children');
        if (!inner) continue;
        /* Auto ThroughAlign is Use only for Representation=None.
         * Explicit DontUse and Auto+NormalSeparation both paint
         * fpThroughAlign=dontuse while the authored mode may stay Auto.
         * Pulling those captions into an outer vertical maximum padded
         * them to the page's caption track and shifted the next field. */
        /* United=false dissolves the group into its owner's grid: its field
         * captions share the owner's track. A nested Pages keeps its own
         * caption lane. */
        if (inner.classList.contains('fp-logical-subgrid')
            && inner.classList.contains('fp-children-vertical')) {
            var transparent = collectFieldLabels(inner, true);
            for (var t = 0; t < transparent.length; t++) {
                var ownPages = transparent[t].closest('.fp-item[data-tag="Pages"]');
                if (!ownPages || !inner.contains(ownPages)) labels.push(transparent[t]);
            }
            continue;
        }
        if (inner.dataset
            && String(inner.dataset.fpThroughAlign || '').toLowerCase() === 'dontuse'
            && !captionLedHorizontalRow(inner, n._fpItem))
            continue;
        if (inner.classList.contains('fp-children-horizontal')) {
            var authoredChildren = n._fpItem && n._fpItem.childItems || [];
            /* An authored empty decoration is a local indentation track. The
             * following field caption belongs to that compound row, not to
             * the surrounding vertical ThroughAlign column. */
            if (authoredChildren.length && isEmptyLabelDecoration(authoredChildren[0])) continue;
            if (compactTitledHorizontalPairKeepsLocalCaptions(n._fpItem, n)) continue;
            var first = firstFieldLabel(inner);
            if (first) { labels.push(first); continue; }
            /* The row publishes no single leading caption. When it opens with a
             * titled vertical column, that column still belongs to this scope's
             * caption track rather than to a track of its own. */
            var leadColumn = leadingThroughAlignColumnBox(inner);
            if (!leadColumn) continue;
            var leadLabels = collectFieldLabels(leadColumn, true);
            for (var q = 0; q < leadLabels.length; q++) {
                /* A United=false column froze its own compact track before
                 * the owner collected it; the owner's track replaces it. */
                if (leadColumn.classList.contains('fp-logical-subgrid') && leadLabels[q].dataset)
                    delete leadLabels[q].dataset.fpLocalLabelWidth;
                labels.push(leadLabels[q]);
            }
        } else {
            var nested = collectFieldLabels(inner, true);
            for (var c = 0; c < nested.length; c++) labels.push(nested[c]);
        }
    }
    return labels;
}

/* TitleHeight>1 without an authored line break lets the caption wrap inside
 * the column its siblings define; it only claims its longest word
 * («Возможен отбор / на сервере:» beside «Заполняется / автоматически:»). */
function softWrapTitleTrack(label, peers) {
    if (!label || peers < 2 || labelHasAuthoredWrap(label)) return 0;
    var item = label.closest && label.closest('.fp-item.fp-title-multiline');
    if (!item) return 0;
    var text = String(label.textContent || '').trim();
    var words = text.split(/\s+/);
    if (words.length < 2) return 0;
    var full = intrinsicLabelTextMetric(label);
    var longest = 0;
    for (var i = 0; i < words.length; i++) longest = Math.max(longest, words[i].length);
    return Math.ceil(full * longest / Math.max(1, text.length)) + 4;
}

function labelHasAuthoredWrap(label) {
    return !!(label && /\r?\n/.test(String(label.textContent || '')));
}

function labelMetric(label) {
    if (!label) return 0;
    /* A canvas/offsetWidth pass of the whole string treats "Публичное\\nнаименование"
     * as one line and inflates the column by ~30px. Longest-line
     * intrinsic is the reference caption track for authored wraps. */
    if (labelHasAuthoredWrap(label)) return intrinsicLabelTextMetric(label);
    /* offsetWidth is integral and keeps the long-standing browser measurement
     * stable. Rect/canvas are fallbacks for inline or detached labels, not a
     * competing fractional measurement that would move every existing grid. */
    var measured = label.offsetWidth || label.scrollWidth || 0;
    /* A caption stacked over its text area fills the row; its track share is
     * the text, not the row (an 803px row caption would set a 280px track
     * and push the neighbouring caption far right). */
    if (measured && label.parentElement && label.parentElement.classList
        && label.parentElement.classList.contains('fp-multiline')
        && measured >= label.parentElement.clientWidth - 1)
        measured = intrinsicLabelTextMetric(label);
    if (!measured && label.getBoundingClientRect) {
        var rect = label.getBoundingClientRect();
        measured = rect && rect.width || 0;
    }
    var text = String(label.textContent || '');
    var doc = label.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!measured && text && doc && doc.createElement) {
        try {
            var canvas = doc.createElement('canvas');
            var context = canvas && canvas.getContext && canvas.getContext('2d');
            if (context) {
                var view = doc.defaultView;
                var computed = view && view.getComputedStyle ? view.getComputedStyle(label) : null;
                if (computed && computed.font) context.font = computed.font;
                measured = Math.ceil(context.measureText(text).width);
            }
        } catch (e) { /* A DOM shim may not implement canvas; use Taxi fallback. */ }
    }
    /* Authored line breaks are layout constraints. Measuring the whole string
     * as one line defeats the reference's compact caption column even when CSS preserves
     * the newline. Use the longest authored line as the intrinsic width. */
    var longestLine = text.split(/\r?\n/).reduce(function (max, line) {
        return Math.max(max, line.length);
    }, 0);
    var calibratedFallback = longestLine * TAXI_LAYOUT_METRICS.averageCharacterWidth
        * TAXI_BROWSER_METRICS.averageCharacterScale;
    return Math.max(measured, calibratedFallback);
}

/* The narrowest platform width that lays a side title out in at most two
 * lines (the 32px title row): «Доля неполного / времени:» 95, «Источник /
 * среднего:» 59, «Компенсации / отпуска:» 80. */
function twoLineLabelMetric(label) {
    if (!label) return 0;
    var words = String(label.textContent || '').split(/\s+/).filter(Boolean);
    if (words.length < 2) return longestWordLabelMetric(label);
    try {
        var doc = label.ownerDocument || document;
        var context = doc.createElement('canvas').getContext('2d');
        var computed = doc.defaultView.getComputedStyle(label);
        if (computed && computed.font) context.font = computed.font;
        var best = Infinity;
        for (var k = 1; k < words.length; k++) {
            best = Math.min(best, Math.max(
                context.measureText(words.slice(0, k).join(' ')).width,
                context.measureText(words.slice(k).join(' ')).width));
        }
        var fontSize = computed && parseFloat(computed.fontSize) || 12;
        return Math.floor(best * 13 / fontSize);
    } catch (e) {
        return longestWordLabelMetric(label);
    }
}

function longestWordLabelMetric(label) {
    if (!label) return 0;
    var words = String(label.textContent || '').split(/\s+/).filter(Boolean);
    if (!words.length) return 0;
    var doc = label.ownerDocument || (typeof document !== 'undefined' ? document : null);
    var best = 0;
    try {
        var context = doc.createElement('canvas').getContext('2d');
        var computed = doc.defaultView.getComputedStyle(label);
        if (computed && computed.font) context.font = computed.font;
        words.forEach(function (word) { best = Math.max(best, context.measureText(word).width); });
        /* The browser caption font is 12px; the platform label is the 13px GDI
         * font («Компенсации» 74.7 → minWidth 80, «Погашение» 62.4 → 67). */
        var fontSize = computed && parseFloat(computed.fontSize) || 12;
        return Math.floor(best * 13 / fontSize);
    } catch (e) {
        best = Math.max.apply(null, words.map(function (word) { return word.length; }))
            * TAXI_LAYOUT_METRICS.averageCharacterWidth * TAXI_BROWSER_METRICS.averageCharacterScale;
    }
    return Math.ceil(best);
}

function intrinsicLabelTextMetric(label) {
    if (!label) return 0;
    var text = String(label.textContent || '');
    var lines = text.split(/\r?\n/);
    var measured = 0;
    var doc = label.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (text && doc && doc.createElement) {
        try {
            var canvas = doc.createElement('canvas');
            var context = canvas && canvas.getContext && canvas.getContext('2d');
            if (context) {
                var view = doc.defaultView;
                var computed = view && view.getComputedStyle ? view.getComputedStyle(label) : null;
                if (computed && computed.font) context.font = computed.font;
                for (var i = 0; i < lines.length; i++)
                    measured = Math.max(measured, context.measureText(lines[i]).width);
            }
        } catch (e) { /* A DOM shim may not implement canvas; use Taxi fallback. */ }
    }
    var longestLine = lines.reduce(function (max, line) {
        return Math.max(max, line.length);
    }, 0);
    var calibratedFallback = longestLine * TAXI_LAYOUT_METRICS.averageCharacterWidth
        * TAXI_BROWSER_METRICS.averageCharacterScale;
    return Math.max(measured, calibratedFallback);
}

/* Canvas-only glyph width for a post-allocation ThroughAlign track. Unlike
 * labelMetric/intrinsicLabelTextMetric this deliberately ignores an earlier
 * CSS min-width, so repeated ResizeObserver passes remain idempotent. */
function throughAlignGlyphMetric(label) {
    if (!label) return 0;
    var text = String(label.textContent || '');
    var doc = label.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (text && doc && doc.createElement) {
        try {
            var canvas = doc.createElement('canvas');
            var context = canvas && canvas.getContext && canvas.getContext('2d');
            if (context) {
                var view = doc.defaultView;
                var computed = view && view.getComputedStyle ? view.getComputedStyle(label) : null;
                /* A label measured before attachment has no computed font;
                 * the canvas default (10px sans-serif) reads «Организация:»
                 * as 63 instead of 76 and narrows fixed caption tracks. */
                if (computed && computed.font) context.font = computed.font;
                else context.font = '12px Arial, "Segoe UI", Tahoma, sans-serif';
                return text.split(/\r?\n/).reduce(function (width, line) {
                    return Math.max(width, context.measureText(line).width);
                }, 0);
            }
        } catch (e) { /* fall through to the established intrinsic metric */ }
    }
    return intrinsicLabelTextMetric(label);
}

function throughAlignTitleTrackWidth(glyphWidths) {
    var widest = 0;
    for (var i = 0; i < (glyphWidths || []).length; i++)
        widest = Math.max(widest, Math.max(0, Number(glyphWidths[i]) || 0));
    return Math.round(widest + TAXI_LAYOUT_METRICS.throughAlignTitleChrome);
}

/* Authored wraps already sit in a field-row with --fp-side-title-gap. Adding
 * pagePadding (10) on top of that 5px gap starts the TextBox 5px past the
 * reference. */
function wrappedSideCaptionTrackWidth(label) {
    return Math.round(throughAlignGlyphMetric(label) + TAXI_LAYOUT_METRICS.sideTitleGap);
}

function localCompoundTitleTrackWidth(glyphWidth) {
    return Math.min(280, Math.ceil(Math.max(0, Number(glyphWidth) || 0)));
}

function compoundTrailingTitlesAreLocal(compound, horizontalParent) {
    if (horizontalParent) return true;
    /* A logical column authored directly in an Equal horizontal owner
     * publishes one shared caption track for that column. This topology is
     * available before child rendering completes, unlike the later responsive
     * marker; excluding the second caption would collapse the published track. */
    if (compound && compound.closest) {
        var equalOwner = compound.closest('.fp-children-horizontal.fp-ciwidth-equal');
        var logicalColumn = compound.closest('.fp-logical-subgrid');
        var logicalItem = logicalColumn && logicalColumn.closest
            ? logicalColumn.closest('.fp-item') : null;
        if (equalOwner && logicalItem && logicalItem.parentElement === equalOwner) return false;
    }
    /* Auto ThroughAlign links the first field of a compound row to the
     * surrounding vertical caption column.  It does not turn the row's later
     * captions into repetitions of that column: those remain local tracks.
     * Only authored ThroughAlign=Use explicitly requests a shared track for
     * every field in the horizontal row. */
    return !compound || !compound.dataset
        || String(compound.dataset.fpThroughAlignMode || '').toLowerCase() !== 'use';
}

/* A horizontal logical subgrid contributes its leading caption to the
 * surrounding vertical ThroughAlign scope. Keep the full set of labels in
 * that outer scope so a later caption cap cannot leave direct sibling fields on a
 * different painted title track. Explicit DontUse remains a hard boundary. */
function projectedOwnerThroughAlignLabels(box) {
    var ownerScope = box && box.parentElement && box.parentElement.closest
        ? box.parentElement.closest('.fp-children-vertical') : null;
    /* Explicit authored DontUse is the hard boundary. A Collapsible group
     * paints effective dontuse toward its parent, but still ThroughAligns
     * its own children onto the projected pair track. */
    if (!ownerScope || (ownerScope.dataset
        && String(ownerScope.dataset.fpThroughAlignMode || '').toLowerCase() === 'dontuse'))
        return [];
    return collectFieldLabels(ownerScope, true);
}

function managedResponsivePairSizes(options) {
    options = options || {};
    var bodyWidth = Math.max(0, Number(options.bodyWidth) || 0);
    var pairLeft = Math.max(0, Number(options.pairLeft) || 0);
    var gap = Math.max(0, Number(options.gap) || 0);
    var minimums = options.minimums || [];
    var managedRight = bodyWidth - TAXI_LAYOUT_METRICS.windowChrome.width
        - TAXI_LAYOUT_METRICS.pagePadding.horizontal * 2;
    var leading = Math.max(Number(minimums[0]) || 0,
        Math.round(bodyWidth / 2 - pairLeft - gap / 2));
    var trailing = Math.max(Number(minimums[1]) || 0,
        Math.round(managedRight - pairLeft - gap - leading));
    return [leading, trailing];
}

function isPairedTitledLogicalColumns(item) {
    if (!item || !isContainer(item.tag)) return false;
    var meta = layoutMeta(item);
    if (meta.groupMode !== 'always-horizontal' || meta.groupRepresentation !== 'none'
        || meta.united || meta.throughAlignMode !== 'auto') return false;
    var children = (item.childItems || []).filter(function (child) {
        return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
    });
    if (children.length !== 2) return false;
    return children.every(function (child) {
        if (!isContainer(child.tag) || !showGroupTitle(child)) return false;
        var childMeta = layoutMeta(child);
        return childMeta.orientation === 'vertical'
            && childMeta.groupRepresentation === 'none' && !childMeta.united;
    });
}

function applyPairedTitledLogicalColumnContract(box, item) {
    if (!box || !isPairedTitledLogicalColumns(item)) return false;
    var columns = [];
    for (var i = 0; i < box.children.length; i++) {
        var child = box.children[i];
        if (child.classList && child.classList.contains('fp-item')) columns.push(child);
    }
    if (columns.length !== 2) return false;
    for (var c = 0; c < columns.length; c++) {
        var column = columns[c];
        column.classList.add('fp-paired-titled-logical-column');
        if (c + 1 < columns.length) column.dataset.fpPairedLogicalTrailingBand = '2';
        var controls = column.querySelectorAll('.fp-item.fp-control');
        for (var n = 0; n < controls.length; n++) {
            var source = controls[n]._fpItem;
            if (!source || (source.tag !== 'InputField' && source.tag !== 'LabelField'
                && source.tag !== 'ValueList')) continue;
            var maximum = parseInt(prop(source, ['MaxWidth', 'МаксимальнаяШирина']), 10) || 0;
            if (!maximum || charSize(prop(source, ['Width', 'Ширина']))
                || !isFalse(prop(source, ['AutoMaxWidth']))) continue;
            var editor = controls[n].querySelector('.fp-input-wrap, .fp-labelfield-value');
            if (!editor) continue;
            var nativeMaximum = maximum * REF_AUTHORED_CHAR_PX + 10;
            editor.style.width = nativeMaximum + 'px';
            editor.style.maxWidth = nativeMaximum + 'px';
            if (controls[n].classList.contains('fp-no-hstretch'))
                editor.style.flex = '0 0 auto';
            /* The recursive logical-subgrid allocator consumes authored bands,
             * not the post-flex editor rectangle. Promote the same fixed
             * maximum there so the following column keeps its lane. */
            var frozenMaximum = maximum * REF_AUTHORED_CHAR_PX;
            ['fpAuthoredNormalWidth', 'fpAuthoredRecommendedWidth', 'fpWidthBandMax']
                .forEach(function (key) {
                    var value = parseFloat(controls[n].dataset && controls[n].dataset[key]);
                    if (Math.abs(value - frozenMaximum) < 0.5)
                        controls[n].dataset[key] = String(nativeMaximum);
                });
        }
        var columnBox = column.querySelector(
            ':scope > .fp-control-wrap > .fp-group-bare > .fp-children-vertical');
        if (columnBox) equalizeFieldLabels(columnBox, true);
    }
    return true;
}

function pageIntrinsicThroughAlignEligible(options) {
    options = options || {};
    return !!(options.page && options.throughAlign === 'use'
        && options.throughAlignMode === 'auto' && options.directMultiline);
}

function fitWrappedSideCaptions(root) {
    if (!root || !root.querySelectorAll) return 0;
    var labels = root.querySelectorAll('.fp-field-row.fp-title-left > .fp-field-label');
    var changed = 0;
    for (var i = 0; i < labels.length; i++) {
        var text = String(labels[i].textContent || '');
        if (!/\r?\n/.test(text)) continue;
        var needed = wrappedSideCaptionTrackWidth(labels[i]);
        if (needed < 40 || needed > 280) continue;
        var current = parseFloat(labels[i].style.minWidth || '') || 0;
        if (needed <= current) continue;
        labels[i].style.minWidth = needed + 'px';
        changed++;
    }
    return changed;
}

function applyLabelWidth(labels, forceAcrossColumns, ownerBox) {
    if (!labels || !labels.length) return;
    /* A lone wrapped caption still owns the longest-line track. Without
     * this, "Сокр. юр.\\nнаименование" shrinks to the first line and the value
     * starts 40px left of the neighbouring wrapped caption's value. */
    if (labels.length === 1) {
        var loneText = String(labels[0].textContent || '');
        if (/\r?\n/.test(loneText)) {
            var loneWidth = wrappedSideCaptionTrackWidth(labels[0]);
            if (loneWidth >= 40 && loneWidth <= 280)
                labels[0].style.minWidth = loneWidth + 'px';
        }
        return;
    }
    var column = labels[0].closest && labels[0].closest('.fp-children-vertical');
    var owner = column && column.closest('.fp-item.fp-container');
    var pairedTitledColumn = !!(owner && owner.classList
        && owner.classList.contains('fp-paired-titled-logical-column'));
    var horizontalParent = owner && owner.parentNode && owner.parentNode.classList
        && owner.parentNode.classList.contains('fp-children-horizontal');
    var anyWrappedCaption = false;
    for (var aw = 0; aw < labels.length; aw++) {
        if (labelHasAuthoredWrap(labels[aw])) { anyWrappedCaption = true; break; }
    }
    var max = 0;
    var hasDirectField = false;
    var hasNestedPeriodField = false;
    /* A direct text area joins the Page's caption column after nested groups
     * have already aligned their own titles. Reading their CSS min-width back
     * through labelMetric creates an 8px feedback loop on every later pass;
     * this Page topology must republish the lane from immutable glyph widths. */
    var directMultiline = false;
    for (var dm = 0; dm < labels.length; dm++) {
        var directItem = labels[dm].closest && labels[dm].closest('.fp-item.fp-control');
        var directRow = labels[dm].closest && labels[dm].closest('.fp-field-row');
        if (ownerBox && directItem && directItem.parentElement === ownerBox
            && directRow && (directRow.classList.contains('fp-multiline')
                || labelHasAuthoredWrap(labels[dm]))) {
            directMultiline = true;
            break;
        }
    }
    var intrinsicPageScope = pageIntrinsicThroughAlignEligible({
        page: !!(ownerBox && ownerBox.classList
            && ownerBox.classList.contains('fp-container-page')),
        throughAlign: ownerBox && ownerBox.dataset && ownerBox.dataset.fpThroughAlign,
        throughAlignMode: ownerBox && ownerBox.dataset && ownerBox.dataset.fpThroughAlignMode,
        directMultiline: directMultiline
    });
    for (var j = 0; j < labels.length; j++) {
        /* A detached pair of titled logical columns publishes a native text
         * track, not the conservative 7px-per-character browser fallback.
         * Four pixels are the reference caption chrome beside that painted text. */
        var w = softWrapTitleTrack(labels[j], labels.length)
            || (anyWrappedCaption
            ? wrappedSideCaptionTrackWidth(labels[j])
            : pairedTitledColumn
            ? Math.ceil(throughAlignGlyphMetric(labels[j]) + 4)
            : (intrinsicPageScope ? intrinsicLabelTextMetric(labels[j]) : labelMetric(labels[j])));
        if (w > max) max = w;
        var fieldItem = labels[j].closest && labels[j].closest('.fp-item.fp-control');
        var fieldBox = fieldItem && fieldItem.parentElement;
        if (ownerBox && fieldBox === ownerBox) hasDirectField = true;
        else if (ownerBox && fieldBox && fieldBox.classList
            && fieldBox.classList.contains('fp-children-horizontal')
            && ownerBox.contains && ownerBox.contains(fieldBox)) {
            var compoundLabels = fieldBox.querySelectorAll
                ? fieldBox.querySelectorAll('.fp-field-label') : [];
            for (var cl = 1; cl < compoundLabels.length; cl++) {
                if (/^(от|до|по|from|to):?$/i.test(String(
                    compoundLabels[cl].textContent || '').trim())) {
                    hasNestedPeriodField = true;
                    break;
                }
            }
        }
    }
    /* A direct field followed by a nested compound period row shares one Taxi
     * caption track. The terminal colon is separator chrome there, so the
     * character fallback contributes one unit less than in ordinary columns. */
    if (hasDirectField && hasNestedPeriodField) max = Math.max(40, max - 9);
    /* Captions collected through a United=false column share the owner's
     * Taxi character track (e.g. 145px for «Рабочее наименование:»), not the
     * browser box. */
    var transparentTrack = !!(ownerBox && !anyWrappedCaption && labels.some(function (label) {
        var subgrid = label.closest && label.closest('.fp-logical-subgrid');
        return !!(subgrid && subgrid !== ownerBox && ownerBox.contains(subgrid));
    }));
    if (transparentTrack) {
        var transparentGlyphs = 0;
        for (var tg = 0; tg < labels.length; tg++)
            transparentGlyphs = Math.max(transparentGlyphs, wrappedSideCaptionTrackWidth(labels[tg]),
                Math.ceil(String(labels[tg].textContent || '').trim().length
                    * TAXI_LAYOUT_METRICS.averageCharacterWidth * TAXI_BROWSER_METRICS.averageCharacterScale));
        if (transparentGlyphs >= 40) max = transparentGlyphs;
    }
    /* Short captions of sibling rows still share one track: the reference starts the
     * «Дни:» and «Часы:» editors at the same x. */
    var shortSiblingRows = max > 0 && max < 40 && labels.length >= 2 && labels.every(function (label) {
        var row = label.closest && label.closest('.fp-item.fp-control');
        var rowBox = row && row.parentElement;
        var rowOwner = rowBox && rowBox.parentElement;
        return !!(rowBox && rowBox.classList && rowBox.classList.contains('fp-children-horizontal')
            && rowOwner && rowOwner.closest && rowOwner.closest('.fp-children-vertical') === ownerBox);
    });
    if (max < 40 && !shortSiblingRows) return;
    if (max > 280) max = 280;
    /* In a horizontal result row, fixed value columns get the available width
     * first and long captions wrap beside them. Keeping their intrinsic text
     * width made every following value drift right and the last one clip. */
    var compactHorizontalColumn = !!horizontalParent;
    if (compactHorizontalColumn) {
        for (var p = 0; p < labels.length; p++) {
            var row = labels[p].closest('.fp-field-row');
            var input = row && row.querySelector('.fp-input-wrap');
            var fieldItem = row && row.closest('.fp-item.fp-control');
            if (!input || !fieldItem || fieldItem.dataset.fieldKind !== 'number') {
                compactHorizontalColumn = false;
                break;
            }
        }
    }
    if (compactHorizontalColumn && max > 100) max = 100;
    /* Stretchable authored totals (HorizontalStretch=true) do not wrap their
     * captions into the compressed lane: the reference publishes the caption
     * glyph track and gives the rest of the column to the editors (caption
     * 88 + 5 gap, editor 110). */
    var stretchingNumericColumn = compactHorizontalColumn && labels.every(function (label) {
        var owner = label.closest && label.closest('.fp-item.fp-control');
        return !!(owner && owner.dataset.fpWidthStretchPriority === '1');
    });
    if (stretchingNumericColumn) {
        max = 0;
        for (var sg = 0; sg < labels.length; sg++)
            max = Math.max(max, Math.ceil(throughAlignGlyphMetric(labels[sg])));
        compactHorizontalColumn = false;
    }
    /* Pin only compact FIO/contact columns (shared track ≤152). A long
     * caption such as «Группа видов номенклатуры:» must keep its
     * intrinsic width so the projected track can still line up
     * Наименование with the left editors. Freezing that column at 152 plus
     * flex:0 0 shifted the whole upper field stack.
     * Numeric result columns already own the 100px compressed lane; re-freezing
     * them from unwrapped glyphs pushed the later editors 15–24px past the
     * reference. */
    var freezeHorizontalChildTrack = !!(horizontalParent && max <= 152
        && !compactHorizontalColumn);
    if (freezeHorizontalChildTrack && !transparentTrack) {
        var glyphMax = 0;
        for (var g = 0; g < labels.length; g++)
            glyphMax = Math.max(glyphMax, wrappedSideCaptionTrackWidth(labels[g]));
        /* Compact FIO/contact columns: offsetWidth overshoots the reference by ~6px,
         * glyph+sideTitleGap undershoots by ~6px. pagePadding on the glyph
         * track is the Taxi side-title band. */
        if (glyphMax >= 40)
            max = glyphMax + (TAXI_LAYOUT_METRICS.pagePadding.horizontal
                - TAXI_LAYOUT_METRICS.sideTitleGap);
    }
    /* A vertical logical column inside a horizontal ThroughAlign row keeps a
     * bounded caption band; long captions wrap inside that band instead of
     * expanding the whole column. Taxi publishes a 152px final band
     * for the longest side caption of such a row. */
    if (horizontalParent && max > 152) max = 152;
    var targets = labels.slice ? labels.slice() : Array.prototype.slice.call(labels);
    var localTargets = [];
    var localWidths = [];
    function setLocalWidth(label, width) {
        if (label.classList) label.classList.add('fp-local-title-track');
        var index = localTargets.indexOf(label);
        if (index >= 0) localWidths[index] = width;
        else {
            localTargets.push(label);
            localWidths.push(width);
        }
    }
    /* A compound row participates in the surrounding label column through
     * its first field. Later fields normally use the same slot unless the row
     * itself marks them local. */
    /* Under authored ThroughAlign=Use the later captions of the rows form
     * their own track per position, shared by the rows but not with the
     * leading caption column: the second editors of such rows line up with
     * each other, not with the page's caption track. */
    var positionTracks = [];
    for (var s = 0; s < labels.length; s++) {
        var compound = labels[s].closest && labels[s].closest('.fp-children-horizontal');
        if (!compound) continue;
        /* Keep authored and resolved ThroughAlign distinct here. Auto links
         * the leading field through collectFieldLabels, while later fields
         * retain their own local caption tracks. */
        var localCompound = compoundTrailingTitlesAreLocal(compound, horizontalParent);
        var independentColumns = compound.classList.contains('fp-ciwidth-leftwidest')
            || compound.classList.contains('fp-ciwidth-rightwidest')
            || compound.classList.contains('fp-ciwidth-equal');
        var fieldPosition = 0;
        for (var ci = 0; ci < compound.children.length; ci++) {
            var control = compound.children[ci];
            if (!control.classList || !control.classList.contains('fp-control')) continue;
            fieldPosition++;
            var siblingRow = control.querySelector('.fp-field-row');
            if (fieldRowSkipped(siblingRow)) continue;
            var siblingLabel = siblingRow && siblingRow.querySelector('.fp-field-label');
            if (!siblingLabel || targets.indexOf(siblingLabel) >= 0) continue;
            /* ChildItemsWidth creates independent value columns. Ordinary
             * compound rows share the common slot; only a compact identifier
             * pair reserves the second caption at its natural width. */
            if (!independentColumns) {
                targets.push(siblingLabel);
                /* A range row keeps its second caption local. In other
                 * multi-field rows the later caption still participates in
                 * the shared column, preserving authored through-alignment
                 * across status and totals sections. */
                if (localCompound || /^(от|до|по):?$/i.test(String(siblingLabel.textContent || '').trim()))
                    setLocalWidth(siblingLabel,
                        localCompoundTitleTrackWidth(throughAlignGlyphMetric(siblingLabel)));
                else if (fieldPosition > 1) {
                    var track = positionTracks[fieldPosition] || (positionTracks[fieldPosition] = { labels: [], glyph: 0 });
                    track.labels.push(siblingLabel);
                    track.glyph = Math.max(track.glyph, throughAlignGlyphMetric(siblingLabel));
                }
                else max = Math.max(max, labelMetric(siblingLabel));
            }
        }
    }
    for (var pt = 0; pt < positionTracks.length; pt++) {
        if (!positionTracks[pt]) continue;
        var trackWidth = localCompoundTitleTrackWidth(positionTracks[pt].glyph);
        for (var pl = 0; pl < positionTracks[pt].labels.length; pl++)
            setLocalWidth(positionTracks[pt].labels[pl], trackWidth);
    }
    for (var k = 0; k < targets.length; k++) {
        var localIndex = localTargets.indexOf(targets[k]);
        var targetWidth = localIndex >= 0 ? localWidths[localIndex] : max;
        /* Generated explicit-title rows model the caption as a sibling
         * LabelDecoration followed by a TitleLocation=None field. Native Taxi
         * reserves an additional 8px band for that external label; ordinary
         * field captions already carry their own field-row chrome. */
        if (targets[k].classList && targets[k].classList.contains('fp-label-decoration'))
            targetWidth = Math.min(288, targetWidth + 8);
        /* A block that established its own caption column must not be
         * widened from a different variant by ancestor traversal. An explicit
         * ThroughAlign pass is the sole exception and deliberately replaces
         * the remembered width. */
        var targetData = targets[k].dataset || {};
        var rememberedWidth = parseFloat(targetData.fpLocalLabelWidth || '');
        if (!forceAcrossColumns && rememberedWidth > 0) targetWidth = rememberedWidth;
        else if (forceAcrossColumns || freezeHorizontalChildTrack)
            targetData.fpLocalLabelWidth = String(targetWidth);
        targets[k].style.minWidth = targetWidth + 'px';
        if (freezeHorizontalChildTrack) {
            /* Pin flex-basis to the shared minWidth. Do not set `width` to
             * that number: glyph/early offsetWidth is often 5–6px short of
             * the painted caption box, and an explicit width then
             * shifts every FIO TextBox 6px left of the reference. */
            targets[k].style.flex = '0 0 ' + targetWidth + 'px';
        }
        if (compactHorizontalColumn) {
            targets[k].style.width = targetWidth + 'px';
            targets[k].style.whiteSpace = 'normal';
        }
        /* A soft-wrapped TitleHeight caption wraps inside the shared lane. */
        if (softWrapTitleTrack(targets[k], targets.length)) {
            targets[k].style.width = targetWidth + 'px';
            targets[k].style.flex = '0 0 ' + targetWidth + 'px';
        }
        /* LabelDecoration renders as an inline span. CSS min-width has no
         * effect on inline boxes, while an ordinary field title is already a
         * flex item. Make only decorations selected for a label column
         * measurable, leaving unrelated inline decorations untouched. */
        if (targets[k].classList && targets[k].classList.contains('fp-label-decoration'))
            targets[k].style.display = 'inline-block';
    }
}

function fitIndentedCompoundRow(box) {
    if (!box || !box.children || !box.classList
        || !box.classList.contains('fp-children-horizontal')) return false;
    var children = directFpItems(box);
    if (children.length < 2 || !isEmptyLabelDecoration(children[0]._fpItem)) return false;
    var indentWidth = authoredLabelWidthEnvelopePx(children[0]._fpItem);
    if (indentWidth) {
        children[0].style.width = indentWidth + 'px';
        children[0].style.minWidth = indentWidth + 'px';
        children[0].style.maxWidth = indentWidth + 'px';
    }
    var field = children[1].querySelector && children[1].querySelector('.fp-field-row');
    var label = field && field.querySelector('.fp-field-label');
    if (!label) return false;
    label.style.minWidth = Math.ceil(throughAlignGlyphMetric(label) + 8) + 'px';
    return true;
}

function equalizeFieldLabels(box, includeFirstOfHorizontal) {
    var labels = collectFieldLabels(box, !!includeFirstOfHorizontal);
    applyLabelWidth(labels, false, box);
    var popupOwner = box && box.closest ? box.closest('.fp-item') : null;
    if (labels.length === 1 && popupOwner && popupOwner._fpItem
        && groupBehavior(popupOwner._fpItem) === 'popup')
        labels[0].style.minWidth = Math.ceil(throughAlignGlyphMetric(labels[0]) + 6) + 'px';
    fitIndentedCompoundRow(box);
}

function equalizeLocalFieldBlocks(root) {
    if (!root || !root.querySelectorAll) return;
    var blocks = root.querySelectorAll('.fp-item.fp-container.fp-tooltip-bg');
    for (var i = 0; i < blocks.length; i++) {
        var box = blocks[i].querySelector('.fp-children-vertical');
        if (!box) continue;
        var labels = collectFieldLabels(box, true);
        for (var j = 0; j < labels.length; j++) labels[j].style.minWidth = '';
        applyLabelWidth(labels, false, box);
    }
}

/* Promotion is a responsive decision, so it has to be re-taken from scratch on
 * every pass. Each promoted row remembers the inline styles it replaced, which
 * makes the revert exact: widening the window restores the authored left
 * captions and the label column applyLabelWidth had computed, instead of
 * leaving the form stuck in its narrow variant. */
function revertPromotedAutoTitles(root) {
    var rows = root.querySelectorAll('.fp-field-row[data-fp-promoted]');
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        row.classList.remove('fp-title-top');
        row.classList.add('fp-title-left');
        var label = row.querySelector('.fp-field-label');
        if (label) {
            label.style.minWidth = label.dataset.fpTitleMinWidth || '';
            delete label.dataset.fpTitleMinWidth;
        }
        var input = row.querySelector('.fp-input-wrap, .fp-labelfield-value');
        if (input) {
            input.style.flex = input.dataset.fpTitleFlex || '';
            delete input.dataset.fpTitleFlex;
        }
        delete row.dataset.fpPromoted;
    }
    var owners = root.querySelectorAll('.fp-auto-title-overflow');
    for (var o = 0; o < owners.length; o++) {
        var owner = owners[o];
        owner.style.minWidth = owner.dataset.fpOverflowMinWidth || '';
        owner.style.flex = owner.dataset.fpOverflowFlex || '';
        delete owner.dataset.fpOverflowMinWidth;
        delete owner.dataset.fpOverflowFlex;
        owner.classList.remove('fp-auto-title-overflow');
    }
}

function promoteOverflowingAutoTitles(root) {
    if (!root || !root.querySelectorAll) return 0;
    revertPromotedAutoTitles(root);
    var boxes = root.querySelectorAll('.fp-children-horizontal');
    var promoted = 0;
    /* Handle inner compound groups before their parent row. Moving a caption
     * above its field changes the inner min-content width that the parent must
     * reserve. */
    for (var b = boxes.length - 1; b >= 0; b--) {
        var box = boxes[b];
        /* A command bar has no captions to promote; its overflow belongs to
         * «Еще». Pinning its owner to the full command width widened the
         * page instead of moving the CancelSearch/refresh tail into More. */
        if (box.closest && box.closest('.fp-commandbar')) continue;
        var rowMetrics = horizontalRowMetrics(box);
        if (!box.clientWidth) continue;
        var owner = box.closest('.fp-item.fp-container');
        /* This responsive title placement belongs to compact subgroups in a
         * compound horizontal row. A regular header row in a vertical column
         * keeps its captions at the left, even when a wider sibling constrains
         * the column. */
        if (!owner || !owner.parentNode || !owner.parentNode.classList) continue;
        var nestedInHorizontal = owner.parentNode.classList.contains('fp-children-horizontal');
        var formBody = box.closest ? box.closest('.fp-body') : null;
        var topLevelAvailable = formBody && formBody.clientWidth ? formBody.clientWidth : box.clientWidth;
        var directControlCount = 0;
        for (var dc = 0; dc < box.children.length; dc++) {
            if (box.children[dc].classList && box.children[dc].classList.contains('fp-control'))
                directControlCount++;
        }
        var regularTopLevel = !box.dataset || box.dataset.fpGroupMode !== 'always-horizontal';
        var crowdedTopLevel = !nestedInHorizontal && regularTopLevel && directControlCount >= 3
            && horizontalPreferredWidth(box) > topLevelAvailable + 1;
        var ownOverflow = nestedInHorizontal
            ? (box.scrollWidth > box.clientWidth + 1 || rowMetrics.structuralCollision)
            : (horizontalCompressedWidth(box) > topLevelAvailable + 1
                || box.clientWidth > topLevelAvailable + 1 || crowdedTopLevel);
        if (!ownOverflow && box.scrollWidth <= box.clientWidth + 1 && !rowMetrics.collision) continue;
        /* A top-level authored row may also promote Auto captions when that
         * row itself is too narrow. The old blanket parent-horizontal check
         * excluded this reference branch. Keep the guard against a width imposed by
         * an unrelated sibling: without the row's own overflow it still does
         * not promote. */
        if (!nestedInHorizontal && !ownOverflow) continue;
        var rows = [];
        var directControls = 0;
        for (var i = 0; i < box.children.length; i++) {
            var item = box.children[i];
            if (!item.classList || !item.classList.contains('fp-control')) continue;
            directControls++;
            var row = item.querySelector('.fp-field-row.fp-title-left.fp-title-auto');
            if (row) rows.push(row);
        }
        /* A lone field cannot be the source of a compound caption collision;
         * promoting it would only make an already crowded header taller (for
         * example the dismissal date beside wider reason groups). */
        if (rows.length < 2 && !(ownOverflow && directControls > 1)) continue;
        for (var r = 0; r < rows.length; r++) {
            rows[r].classList.remove('fp-title-left');
            rows[r].classList.add('fp-title-top');
            rows[r].dataset.fpPromoted = '1';
            promoted++;
            var label = rows[r].querySelector('.fp-field-label');
            if (label) {
                label.dataset.fpTitleMinWidth = label.style.minWidth || '';
                label.style.minWidth = '';
            }
            var input = rows[r].querySelector('.fp-input-wrap, .fp-labelfield-value');
            if (input) {
                input.dataset.fpTitleFlex = input.style.flex || '';
                input.style.flex = '0 0 auto';
            }
        }
        /* The compact group was already shrunk by its outer flex row. Once
         * labels move above fields, preserve the recalculated content width so
         * adjacent groups scroll horizontally instead of painting over it. */
        /* Caption promotion changes the row's intrinsic width. Keeping the
         * pre-promotion measurement pins the owner to the obsolete wide
         * variant. */
        var promotedMetrics = horizontalRowMetrics(box);
        var required = Math.max(box.scrollWidth, promotedMetrics.requiredWidth);
        if (owner && required > owner.getBoundingClientRect().width + 1) {
            owner.dataset.fpOverflowMinWidth = owner.style.minWidth || '';
            owner.dataset.fpOverflowFlex = owner.style.flex || '';
            owner.style.minWidth = (required + 2) + 'px';
            owner.style.flex = '0 0 auto';
            owner.classList.add('fp-auto-title-overflow');
        }
    }
    return promoted;
}

/* Flex item boxes never overlap, but descendants of a squeezed item may paint
 * outside that box. scrollWidth of the row then describes only the furthest
 * painted edge, not the sum of widths needed to put every sibling side by
 * side. Measure that sum so the scroll canvas is wide enough to remove the
 * collision, not merely wide enough to expose the existing overlap. */
function horizontalRowMetrics(row) {
    var result = {
        collision: false,
        structuralCollision: false,
        requiredWidth: row ? row.scrollWidth : 0,
        trackMinimums: []
    };
    if (!row || !row.children || !row.getBoundingClientRect) return result;
    var children = directFpItems(row);
    if (children.length < 2) return result;
    var rowRect = row.getBoundingClientRect();
    var required = 0;
    var previousRight = rowRect.left;
    function paintedRight(item, itemRect) {
        var right = itemRect.right;
        /* The painted leaves are the detector's own list (paintedOverlaps):
         * a radio option or segmented control missing here was invisible to
         * this pass. */
        var descendants = item.querySelectorAll(
            '.fp-item, .fp-field-row, .fp-control-wrap, .fp-label, '
            + PAINTED_LEAF_SELECTOR
        );
        for (var di = 0; di < descendants.length; di++) {
            var descendant = descendants[di];
            /* A command bar moves what does not fit into More (fitCommandBar);
             * its unfitted button row is not a collision. */
            if (descendant.closest && descendant.closest('.fp-commandbar')) continue;
            var style = typeof getComputedStyle === 'function' ? getComputedStyle(descendant) : null;
            if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
            var descendantRect = descendant.getBoundingClientRect();
            if (descendantRect.width > 0) right = Math.max(right, descendantRect.right);
        }
        /* The bar still publishes its preferred row, less the table's row
         * moves (e.g. a 525px lane of Добавить + Заполнить… + Еще). */
        var bars = item.querySelectorAll('.fp-commandbar');
        for (var bi = 0; bi < bars.length; bi++) {
            var barRect = bars[bi].getBoundingClientRect();
            if (!barRect.width) continue;
            var barWidth = 0;
            var barKids = bars[bi].children;
            var barGap = parseFloat(getComputedStyle(bars[bi]).columnGap) || 0;
            var counted = 0;
            for (var bk = 0; bk < barKids.length; bk++) {
                var kid = barKids[bk];
                if (getComputedStyle(kid).display === 'none') continue;
                if (kid.querySelector('.fp-std-move')) continue;
                if (kid._fpItem && /^Form\.Item\.[^.]+\.StandardCommand\.Move(?:Up|Down)$/
                    .test(String(prop(kid._fpItem, ['CommandName']) || ''))) continue;
                barWidth += kid.getBoundingClientRect().width;
                counted++;
            }
            if (counted > 1) barWidth += (counted - 1) * barGap;
            right = Math.max(right, barRect.left + barWidth);
        }
        return right;
    }
    function paintedLeft(item, itemRect) {
        if (!item.classList.contains('fp-container')) return itemRect.left;
        var left = Infinity;
        var descendants = item.querySelectorAll(
            '.fp-label, .fp-pages-tabs-row, ' + PAINTED_LEAF_SELECTOR
        );
        for (var di = 0; di < descendants.length; di++) {
            var descendant = descendants[di];
            var style = typeof getComputedStyle === 'function' ? getComputedStyle(descendant) : null;
            if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
            var descendantRect = descendant.getBoundingClientRect();
            if (descendantRect.width > 0 && descendantRect.height > 0)
                left = Math.min(left, descendantRect.left);
        }
        return isFinite(left) ? left : itemRect.left;
    }
    for (var c = 0; c < children.length; c++) {
        var rect = children[c].getBoundingClientRect();
        if (c > 0) required += Math.max(0, rect.left - previousRight);
        var overflow = typeof getComputedStyle === 'function'
            ? getComputedStyle(children[c]).overflowX : 'visible';
        var paintsOutside = overflow === 'visible';
        /* scrollWidth includes deliberately clipped editor text and min-content
         * hints, so it reports collisions that are not painted on screen.
         * Use rendered descendant boxes for collision decisions. */
        var visualRight = paintsOutside ? paintedRight(children[c], rect) : rect.right;
        var visualWidth = Math.max(rect.width, visualRight - rect.left);
        var nextRect = c + 1 < children.length
            ? children[c + 1].getBoundingClientRect() : null;
        var nextPaintedLeft = nextRect ? paintedLeft(children[c + 1], nextRect) : Infinity;
        var collidesNext = c + 1 < children.length && paintsOutside
            && visualRight > nextPaintedLeft + 1;
        var currentContainer = children[c].classList.contains('fp-container');
        var nextContainer = c + 1 < children.length
            && children[c + 1].classList.contains('fp-container');
        var currentCheckbox = children[c].dataset
            && children[c].dataset.fieldKind === 'checkbox';
        var nextCheckbox = c + 1 < children.length && children[c + 1].dataset
            && children[c + 1].dataset.fieldKind === 'checkbox';
        var structural = collidesNext && ((currentContainer && nextContainer)
            || (currentContainer && nextCheckbox)
            || (currentCheckbox && nextContainer));
        result.trackMinimums.push({
            item: children[c],
            width: horizontalPaintedTrackMinimum(rect.left, rect.right, visualRight),
            collidesNext: collidesNext,
            structural: structural
        });
        required += visualWidth;
        if (collidesNext) {
            result.collision = true;
            /* Structural collisions remain useful to the reference strategy pass,
             * but every visual collision is a hard layout violation. The
             * viewport pass below reserves the measured width for either
             * kind, including ordinary field-to-field collisions. */
            /* A nested helper group among ordinary fields does not establish
             * a new logical column: 1C may deliberately keep that authored
             * row wider than its parent. Reserve separate horizontal space
             * only for true group-to-group columns and for the common
             * checkbox-plus-details pattern. */
            if (structural) result.structuralCollision = true;
        }
        previousRight = rect.right;
    }
    if (result.structuralCollision) {
        result.requiredWidth = Math.max(result.requiredWidth,
            pageScrollCanvasPreferredRowWidth(row));
    }
    result.requiredWidth = Math.max(result.requiredWidth, Math.ceil(required));
    return result;
}

/* PagesRepresentation=None paints only the active Page, but the platform sizes the
 * dissolved owner by the maximum natural height of every alternative. This is
 * observable with a 25px first page and a 256px inactive page: switching pages
 * changes paint, not the surrounding form geometry. Measure the alternatives
 * at the authored/allocated Pages width in a detached paint-suppressed stage;
 * do not apply this to stretch/height-authored or data-grid page sets, whose
 * vertical range is owned by their existing allocator. */
function fitFlattenedPagesAlternativeEnvelope(body) {
    if (!body || !body.querySelectorAll || typeof document === 'undefined') return 0;
    var items = body.querySelectorAll('.fp-item[data-tag="Pages"].fp-pages-none');
    var changed = 0;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var pagesNode = item._fpItem;
        var box = item.querySelector && item.querySelector(
            ':scope > .fp-control-wrap > .fp-group-block > .fp-children, '
            + ':scope > .fp-control-wrap > .fp-page-block > .fp-children');
        if (!pagesNode || pagesRep(pagesNode) !== 'none' || !box) continue;
        box.setAttribute('data-fp-pages-box', '1');
        if (prop(pagesNode, ['Height', 'Высота'])
            || !isFalse(prop(pagesNode, ['VerticalStretch', 'ВертикальноеРастягивание']))) continue;
        var pages = renderablePages(pagesNode);
        if (pages.length < 2 || pages.some(function (page) {
            function containsExcluded(item) {
                if (!item) return false;
                if (item.tag === 'Table' || item.tag === 'SpreadSheetDocumentField') return true;
                return (item.childItems || []).some(containsExcluded);
            }
            return containsExcluded(page);
        })) continue;
        var authoredWidth = authoredFieldWidthPx(prop(pagesNode, ['Width', 'Ширина']), 'Pages');
        var allocatedWidth = authoredWidth || item.getBoundingClientRect().width || item.clientWidth;
        if (!(allocatedWidth > 0)) continue;
        var stage = el('div', 'fp-body fp-mockup fp-flattened-pages-measure');
        stage.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;'
            + 'height:auto;min-height:0;overflow:visible;width:' + allocatedWidth + 'px;';
        document.body.appendChild(stage);
        var maximum = 0;
        try {
            for (var p = 0; p < pages.length; p++) {
                var page = pages[p];
                var meta = layoutMeta(page);
                var pageBox = el('div', layoutClass(meta));
                pageBox.style.width = allocatedWidth + 'px';
                applyLayout(pageBox, meta);
                stage.appendChild(pageBox);
                renderPreview(page.childItems || [], pageBox, box._fpCtx || {}, page);
                equalizeLocalFieldBlocks(pageBox);
                prepareResponsiveGroups(pageBox);
                maximum = Math.max(maximum, pageBox.scrollHeight,
                    pageBox.getBoundingClientRect().height || 0);
                stage.removeChild(pageBox);
            }
        } finally {
            if (stage.parentNode) stage.parentNode.removeChild(stage);
        }
        if (maximum <= 0) continue;
        var envelope = Math.ceil(maximum);
        item.style.minHeight = envelope + 'px';
        box.style.minHeight = envelope + 'px';
        item.dataset.fpFlattenedPagesEnvelope = String(envelope);
        changed++;
    }
    return changed;
}

/* The row can already be wide enough in aggregate while flex assigns too
 * little of that width to one direct track. Its descendants then paint into
 * the next logical column. Reserve the painted overhang in the offending
 * track itself; widening only the parent row cannot change that allocation. */
function horizontalPaintedTrackMinimum(itemLeft, itemRight, paintedRight) {
    var ownWidth = Math.max(0, Number(itemRight) - Number(itemLeft));
    var paintedWidth = Math.max(0, Number(paintedRight) - Number(itemLeft));
    return Math.ceil(Math.max(ownWidth, paintedWidth));
}

/* An authored group Height fixes a horizontal band. When a narrow window
 * stacks that group's children into a column, the band can no longer hold
 * them and the fixed height let the content paint over every following
 * sibling. The authored height stays a floor (min-height); only the fixed
 * height yields. */
function releaseStackedAuthoredHeights(body) {
    if (!body || !body.querySelectorAll || typeof getComputedStyle !== 'function') return 0;
    var items = body.querySelectorAll('.fp-item.fp-sized-height.fp-container-horizontal');
    var released = 0;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item.style.height || item.dataset.fpStackedHeightBase != null) continue;
        var box = directLayoutChildren(item);
        /* Container overflow is not a usable signal: a stretchable card with
         * min-height:0 shrinks inside the fixed band until the sum fits and
         * its own text overflows instead. */
        if (!box || getComputedStyle(box).flexDirection !== 'column'
            || directFpItems(box).length < 2) continue;
        item.dataset.fpStackedHeightBase = item.style.height;
        item.style.height = '';
        released++;
    }
    return released;
}

function restoreStackedAuthoredHeights(body) {
    var items = body.querySelectorAll('[data-fp-stacked-height-base]');
    for (var i = 0; i < items.length; i++) {
        items[i].style.height = items[i].dataset.fpStackedHeightBase;
        delete items[i].dataset.fpStackedHeightBase;
    }
}

function restoreNoOverlapContained(node) {
    if (!node || !node.dataset || node.dataset.fpNoOverlapContained !== '1') return;
    node.style.width = node.dataset.fpNoOverlapBaseWidth === '__empty__'
        ? '' : node.dataset.fpNoOverlapBaseWidth;
    node.style.minWidth = node.dataset.fpNoOverlapBaseMinWidth === '__empty__'
        ? '' : node.dataset.fpNoOverlapBaseMinWidth;
    node.style.maxWidth = node.dataset.fpNoOverlapBaseMaxWidth === '__empty__'
        ? '' : node.dataset.fpNoOverlapBaseMaxWidth;
    delete node.dataset.fpNoOverlapContained;
    delete node.dataset.fpNoOverlapBaseWidth;
    delete node.dataset.fpNoOverlapBaseMinWidth;
    delete node.dataset.fpNoOverlapBaseMaxWidth;
}

/* A logical column should first offer its assigned width to an overflowing
 * nested horizontal row. This lets compressible fields yield to their local
 * buttons, as the reference does, instead of moving every following outer column.
 * Containment is only an offer: an editor fixed at its authored width cannot
 * yield, so squeezing its row paints the editor under its own trailing
 * button. Such a row keeps its intrinsic width and the outer track is
 * widened by the ordinary reservation instead, which is also what the
 * reference shows. */
function containHorizontalTrackRows(item) {
    if (!item || !item.querySelectorAll || !item.getBoundingClientRect) return 0;
    var itemRect = item.getBoundingClientRect();
    var rows = item.querySelectorAll('.fp-children-horizontal');
    var changed = 0;
    var contained = [];
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var rect = row.getBoundingClientRect();
        var rowOwner = row.closest ? row.closest('.fp-item') : null;
        var target = rowOwner && rowOwner !== item && item.contains(rowOwner) ? rowOwner : row;
        var targetRect = target.getBoundingClientRect();
        if (Math.max(rect.right, targetRect.right) <= itemRect.right + 1
            || target.dataset.fpNoOverlapContained === '1'
            || target.dataset.fpNoOverlapUncontainable === '1') continue;
        var available = Math.floor(itemRect.right - targetRect.left);
        if (!(available > 0)) continue;
        target.dataset.fpNoOverlapBaseWidth = target.style.width || '__empty__';
        target.dataset.fpNoOverlapBaseMinWidth = target.style.minWidth || '__empty__';
        target.dataset.fpNoOverlapBaseMaxWidth = target.style.maxWidth || '__empty__';
        target.style.width = available + 'px';
        target.style.minWidth = '0';
        target.style.maxWidth = available + 'px';
        target.dataset.fpNoOverlapContained = '1';
        if (target !== row) {
            row.dataset.fpNoOverlapBaseWidth = row.style.width || '__empty__';
            row.dataset.fpNoOverlapBaseMinWidth = row.style.minWidth || '__empty__';
            row.dataset.fpNoOverlapBaseMaxWidth = row.style.maxWidth || '__empty__';
            row.style.width = '100%';
            row.style.minWidth = '0';
            row.style.maxWidth = '100%';
            row.dataset.fpNoOverlapContained = '1';
        }
        contained.push({ row: row, target: target });
    }
    /* Judge only after every nested row took its offer: an outer row still
     * collides until the rows inside it have been contained as well.
     * Innermost rows are judged first so that reverting one
     * is visible to the rows around it. */
    for (var c = contained.length - 1; c >= 0; c--) {
        if (!horizontalRowMetrics(contained[c].row).collision) {
            changed++;
            continue;
        }
        restoreNoOverlapContained(contained[c].row);
        restoreNoOverlapContained(contained[c].target);
        contained[c].target.dataset.fpNoOverlapUncontainable = '1';
    }
    return changed;
}

/* Horizontal groups keep their authored one-row layout. When their intrinsic
 * content is wider than its scroll viewport, widen that viewport's content
 * canvas instead of squeezing controls until captions and fields paint over
 * one another. Rows inside a page belong to the active page, so its horizontal
 * scrollbar stays beside its vertical one rather than moving below the form. */
/* Drops the widened scroll canvas so the next measurement sees the real
 * viewport. Responsive passes have to run against the natural width: measuring
 * a form while it is still pinned to the canvas computed for a narrower window
 * reports an overflow that no longer exists. */
function resetFormViewport(body) {
    if (!body) return;
    body.classList.remove('fp-window-overflow');
    body.classList.remove('fp-flattened-page-overflow');
    body.classList.remove('fp-semantic-canvas');
    body.style.removeProperty('--fp-content-width');
    var rows = body.querySelectorAll('.fp-children-horizontal.fp-no-overlap-width');
    for (var r = 0; r < rows.length; r++) {
        rows[r].classList.remove('fp-no-overlap-width');
        rows[r].style.minWidth = '';
    }
    var reservedTracks = body.querySelectorAll('[data-fp-no-overlap-track="1"]');
    for (var t = 0; t < reservedTracks.length; t++) {
        reservedTracks[t].style.minWidth = reservedTracks[t].dataset.fpNoOverlapBaseMinWidth === '__empty__'
            ? '' : reservedTracks[t].dataset.fpNoOverlapBaseMinWidth;
        delete reservedTracks[t].dataset.fpNoOverlapTrack;
        delete reservedTracks[t].dataset.fpNoOverlapBaseMinWidth;
    }
    var containedRows = body.querySelectorAll('[data-fp-no-overlap-contained="1"]');
    for (var cr = 0; cr < containedRows.length; cr++) restoreNoOverlapContained(containedRows[cr]);
    var uncontainable = body.querySelectorAll('[data-fp-no-overlap-uncontainable]');
    for (var uc = 0; uc < uncontainable.length; uc++)
        delete uncontainable[uc].dataset.fpNoOverlapUncontainable;
    restoreStackedAuthoredHeights(body);
    var canvasBands = body.querySelectorAll(':scope > .fp-root-band-canvas');
    for (var cb = 0; cb < canvasBands.length; cb++) {
        canvasBands[cb].classList.remove('fp-root-band-canvas');
        canvasBands[cb].style.removeProperty('--fp-band-canvas-width');
    }
    var panels = body.querySelectorAll('.fp-pages-active-panel');
    for (var p = 0; p < panels.length; p++) {
        panels[p].classList.remove('fp-window-overflow');
        panels[p].style.removeProperty('--fp-content-width');
    }
    /* fitRootPagesPreferredHeights stores the pixel value, not "1": match
     * presence, or the preferred height sticks across strategy passes. */
    var rootPages = body.querySelectorAll('[data-fp-root-pages-preferred]');
    for (var q = 0; q < rootPages.length; q++) {
        var pages = rootPages[q];
        pages.style.flex = pages.dataset.fpRootPagesBaseFlex === '__empty__'
            ? '' : pages.dataset.fpRootPagesBaseFlex;
        pages.style.minHeight = pages.dataset.fpRootPagesBaseMinHeight === '__empty__'
            ? '' : pages.dataset.fpRootPagesBaseMinHeight;
        delete pages.dataset.fpRootPagesPreferred;
    }
}

function rootPagesPreferredHeight(itemHeight, panelClientHeight, panelScrollHeight) {
    var outer = Math.max(0, Number(itemHeight) || 0);
    var client = Math.max(0, Number(panelClientHeight) || 0);
    var content = Math.max(client, Number(panelScrollHeight) || 0);
    return Math.ceil(outer + content - client);
}

/* A root tab set is a growable native height band, not a shrinkable browser
 * scrollport. Its collapsed rectangle already contains the tab and panel
 * chrome; replacing the active panel's client band with scrollHeight recovers
 * the preferred content height without any form-specific coordinates. */
function fitRootPagesPreferredHeights(body) {
    if (!body || !body.children) return 0;
    var changed = 0;
    for (var i = 0; i < body.children.length; i++) {
        var item = body.children[i];
        if (!item.classList || !item.classList.contains('fp-item')
            || !item.classList.contains('fp-pages-tabs')
            || !item.dataset || item.dataset.tag !== 'Pages') continue;
        var panel = item.querySelector && item.querySelector('.fp-pages-active-panel');
        if (!panel) continue;
        /* Tables and spreadsheet documents publish their own
         * min/preferred range and are allowed to compress inside Pages. Their
         * browser scrollHeight is the allocated stretch track, not the page's
         * intrinsic minimum. */
        if (panel.querySelector && panel.querySelector(
            '.fp-item[data-tag="Table"], .fp-item[data-tag="SpreadSheetDocumentField"]')) continue;
        if (panel.scrollHeight <= panel.clientHeight + 2) continue;
        var next = null;
        for (var n = i + 1; n < body.children.length; n++) {
            var candidate = body.children[n];
            if (candidate.classList && candidate.classList.contains('fp-item')
                && candidate.getBoundingClientRect && candidate.getBoundingClientRect().height) {
                next = candidate;
                break;
            }
        }
        if (!next) continue;
        var rect = item.getBoundingClientRect ? item.getBoundingClientRect() : { height: 0 };
        var bodyRect = body.getBoundingClientRect ? body.getBoundingClientRect() : { top: 0 };
        var nextRect = next.getBoundingClientRect();
        /* When page content overflows, native form scrolling owns that
         * overflow. Do not shrink the page merely to expose a following root
         * footer inside the first viewport. Keep one native text line beyond
         * the fold so the footer remains wholly in the body scroll canvas. */
        var fold = (bodyRect.top || 0) + (body.clientHeight || 0) + ROW_PX;
        var growth = Math.max(0, fold - nextRect.top);
        if (!growth) continue;
        /* Pages minHeight is its content minimum: without a table the
         * page cannot shrink below its rows, so it grows to them and the Form
         * scrolls; the footer goes below the frame. */
        var preferred = Math.max(Math.ceil((rect.height || 0) + growth),
            rootPagesPreferredHeight(rect.height, panel.clientHeight, panel.scrollHeight));
        if (!Object.prototype.hasOwnProperty.call(item.dataset, 'fpRootPagesBaseFlex')) {
            item.dataset.fpRootPagesBaseFlex = item.style.flex || '__empty__';
            item.dataset.fpRootPagesBaseMinHeight = item.style.minHeight || '__empty__';
        }
        item.style.flex = '1 0 ' + preferred + 'px';
        item.style.minHeight = preferred + 'px';
        item.dataset.fpRootPagesPreferred = String(preferred);
        changed++;
    }
    return changed;
}

/* 1C never wraps a page tab strip. Once the captions stop fitting the row, the
 * platform hands every tab the same slice of the strip and cuts the caption
 * with an ellipsis - the tabs keep filling exactly the width the Pages item
 * was given, which on a horizontally scrolled form is the widened canvas and
 * not the window. In the reference: 9 tabs/106px, 10/95, 11/87. A full-width
 * strip does not keep shrinking past that 87px floor: extra tabs keep intrinsic
 * width capped at 87px and overflow:hidden clips them (e.g. 16 tabs,
 * ~11 visible, last caption cut at the window edge). Equal-slice remains only
 * while the shared width stays at or above 87px. Narrow nested strips still
 * use the 46px emergency floor. */
var MIN_PAGE_TAB_PX = 46;
/* Reference at 992×992: an overflowing wide strip equal-slices tabs at 92px;
 * extras are clipped, short captions stay padded. */
var WIDE_PAGE_TAB_MIN_PX = 92;
var WIDE_PAGE_TAB_STRIP_PX = WIDE_PAGE_TAB_MIN_PX * 8;

function pageTabsOf(list) {
    var tabs = [];
    for (var i = 0; i < list.children.length; i++) {
        var node = list.children[i];
        if (node.classList && node.classList.contains('fp-pages-tab')) tabs.push(node);
    }
    return tabs;
}

function fitPageTabWidth(clientWidth, tabCount) {
    var width = Math.max(0, Number(clientWidth) || 0);
    var count = Math.max(0, Number(tabCount) || 0);
    if (count < 2 || !width) return 0;
    /* Neighbouring tabs overlap by the shared 1px border, so n equal tabs
     * span n*w - (n-1); solve that for the strip width. */
    var uniform = Math.floor((width + count - 1) / count);
    if (uniform < WIDE_PAGE_TAB_MIN_PX && width >= WIDE_PAGE_TAB_STRIP_PX)
        return WIDE_PAGE_TAB_MIN_PX;
    if (uniform < MIN_PAGE_TAB_PX) return MIN_PAGE_TAB_PX;
    return uniform;
}

function fitPageTabs(body) {
    if (!body) return;
    var lists = body.querySelectorAll('.fp-pages-tablist');
    for (var i = 0; i < lists.length; i++) {
        var list = lists[i];
        var tabs = pageTabsOf(list);
        for (var r = 0; r < tabs.length; r++) {
            tabs[r].style.removeProperty('width');
            tabs[r].style.removeProperty('max-width');
        }
        if (tabs.length < 2 || !list.clientWidth) continue;
        /* Equal-slice only when intrinsic captions overflow. Compact tabs such as
         * «13%» / «Личные данные» keep their width; a wizard with many tabs
         * overflows and then shares the strip. Always slicing stretches
         * compact strips and clips the last caption. */
        void list.offsetWidth;
        var overflowing = list.scrollWidth > list.clientWidth + 1;
        if (!overflowing) {
            var intrinsic = 0;
            for (var t = 0; t < tabs.length; t++)
                intrinsic += tabs[t].getBoundingClientRect().width;
            overflowing = intrinsic > list.clientWidth + 1;
        }
        if (!overflowing) continue;
        var uniform = fitPageTabWidth(list.clientWidth, tabs.length);
        if (!uniform) continue;
        for (var u = 0; u < tabs.length; u++) tabs[u].style.width = uniform + 'px';
        /* The reference: the last tab takes what the equal slices leave, so the
         * strip ends exactly at its edge: W - (n-1)(w-1). */
        var rest = list.clientWidth - (tabs.length - 1) * (uniform - 1);
        if (rest > uniform) tabs[tabs.length - 1].style.width = rest + 'px';
    }
}

function chartRemainingInPanel(chart) {
    if (!chart || !chart.getBoundingClientRect) return 0;
    var panel = chart.closest && chart.closest('.fp-pages-active-panel');
    if (!panel || !panel.getBoundingClientRect) return 0;
    var remaining = panel.getBoundingClientRect().bottom - chart.getBoundingClientRect().top;
    var node = chart;
    while (node && node !== panel) {
        var parent = node.parentNode;
        if (!parent) break;
        var sibling = node.nextElementSibling;
        var following = 0;
        while (sibling) {
            if (sibling.getBoundingClientRect) {
                var siblingRect = sibling.getBoundingClientRect();
                if (siblingRect.height > 0) remaining -= siblingRect.height;
            }
            following++;
            sibling = sibling.nextElementSibling;
        }
        var style = typeof getComputedStyle === 'function' ? getComputedStyle(parent) : null;
        if (style) {
            remaining -= parseFloat(style.paddingBottom) || 0;
            if (following) remaining -= (parseFloat(style.rowGap) || 0) * following;
        }
        node = parent;
    }
    return remaining;
}

function fitChartFields(body) {
    if (!body || !body.querySelectorAll) return;
    var charts = body.querySelectorAll('.fp-item.fp-chart-fill-remaining');
    var i;
    for (i = 0; i < charts.length; i++) {
        charts[i].style.removeProperty('height');
        charts[i].style.removeProperty('min-height');
    }
    for (i = 0; i < charts.length; i++) {
        var chart = charts[i];
        var maxH = parseFloat(chart.dataset.fpChartMaxHeight) || 0;
        var height = chartFillRemainingHeight(maxH, chartRemainingInPanel(chart));
        if (height > 0) {
            chart.style.height = height + 'px';
            chart.style.minHeight = height + 'px';
        }
    }
}

function responsiveGroupNeedsVertical(box, finiteParentTrack) {
    if (!box || !box.clientWidth) return false;
    var metrics = horizontalRowMetrics(box);
    var preferred = horizontalPreferredWidth(box);
    /* Projected logical rows must decide against the finite track allocated by
     * this row's post-projection width. Logical-subgrid allocation may already
     * have published the sum of its children's recommendations on `box`; using
     * that widened rectangle as the available width makes HorizontalIfPossible
     * self-validate and prevents its vertical fallback (validation-12). */
    var owner = box.closest ? box.closest('.fp-item') : null;
    var parentTrack = owner && owner.parentNode;
    var containerWidth = parentTrack && parentTrack.clientWidth
        ? parentTrack.clientWidth : 0;
    var publishedWidth = owner && owner.dataset
        ? parseFloat(owner.dataset.fpHorizontalPublishedWidth) || 0 : 0;
    if (publishedWidth > 0 && containerWidth > 0)
        containerWidth = Math.min(containerWidth, publishedWidth);
    else if (publishedWidth > 0) containerWidth = publishedWidth;
    if (!(containerWidth > 0)) {
        containerWidth = box.parentNode && box.parentNode.clientWidth
            ? box.parentNode.clientWidth : box.clientWidth;
    }
    /* Ordinary responsive groups are decided before projection and retain the
     * established reference contract: the containing form may lend them its usable
     * width. Only the late projected rerun opts into the finite owner track. */
    var formBody = box.closest ? box.closest('.fp-body') : null;
    /* A finite track owned by a shrink-to-content group (HorizontalStretch
     * false, no authored Width) is not a limit: that group grows to the row
     * (806px for three header columns in the reference) instead of stacking
     * them once a W14 field paints its 171px. */
    var shrinkWrapOwner = false;
    if (finiteParentTrack && owner) {
        for (var up = owner.parentElement && owner.parentElement.closest('.fp-item'); up;
            up = up.parentElement && up.parentElement.closest('.fp-item')) {
            if (!up.classList.contains('fp-container')) break;
            if (up.classList.contains('fp-sized-width') || up.style.width) break;
            if (up.classList.contains('fp-no-hstretch')) { shrinkWrapOwner = true; break; }
        }
    }
    var availableWidth = finiteParentTrack && !shrinkWrapOwner ? containerWidth
        : Math.max(box.clientWidth, containerWidth,
            formBody && formBody.clientWidth ? formBody.clientWidth : 0);
    var pageColumnWidth = pageLocalVerticalColumnDecisionWidth(box);
    if (pageColumnWidth > 0) availableWidth = pageColumnWidth;
    var precedingCapped = precedingCappedPageColumnWidth(box);
    if (precedingCapped > 0) availableWidth = Math.min(availableWidth, precedingCapped);
    return box.scrollWidth > availableWidth + 1 || metrics.structuralCollision
        || preferred > availableWidth + 1;
}

/* HIP group that is a direct Page child after a MaxWidth-capped column
 * (field + long checkbox). The reference decides against that column,
 * not the full page canvas. */
function precedingCappedPageColumnWidth(box) {
    var owner = box && box.closest ? box.closest('.fp-item') : null;
    var parentBox = owner && owner.parentNode;
    if (!owner || !parentBox || !parentBox.classList
        || !parentBox.classList.contains('fp-pages-active-panel')) return 0;
    var kids = visibleLayoutChildren(owner._fpItem);
    var hasCappedField = kids.some(function (child) {
        return child.tag === 'InputField' && isFalse(prop(child, ['AutoMaxWidth']))
            && charSize(prop(child, ['MaxWidth', 'МаксимальнаяШирина']));
    });
    var hasCheck = kids.some(function (child) { return child.tag === 'CheckBoxField'; });
    if (!hasCappedField || !hasCheck) return 0;
    var prev = owner.previousElementSibling;
    while (prev) {
        if (prev.classList && prev.classList.contains('fp-item')
            && prev.getBoundingClientRect) {
            var host = prev.getBoundingClientRect();
            if (host.height > 0) {
                var painted = 0;
                var wraps = prev.querySelectorAll ? prev.querySelectorAll('.fp-input-wrap') : [];
                for (var i = 0; i < wraps.length; i++) {
                    var rect = wraps[i].getBoundingClientRect();
                    if (rect.width > 0) painted = Math.max(painted, rect.right - host.left);
                }
                if (painted > 0) return painted;
            }
        }
        prev = prev.previousElementSibling;
    }
    return 0;
}

/* ThroughAlign continues past a page-level horizontal pair: its captions
 * sit on the same 152px caption band as the fields above, not on a local
 * track grown from the pair's own caption. */
function firstVerticalColumnTitleTrackWidth(hbox) {
    if (!hbox || !hbox.children) return 0;
    for (var i = 0; i < hbox.children.length; i++) {
        var col = hbox.children[i];
        if (!col || !col.classList || !col.classList.contains('fp-item')) continue;
        var labels = col.querySelectorAll
            ? col.querySelectorAll('.fp-field-row.fp-title-left > .fp-field-label')
            : [];
        var max = 0;
        for (var j = 0; j < labels.length; j++) {
            var width = parseFloat(labels[j].style && labels[j].style.minWidth || '') || 0;
            if (width > max) max = width;
        }
        if (max > 0) return max;
    }
    return 0;
}

function precedingThroughAlignTitleTrackWidth(owner) {
    var page = owner && owner.parentNode;
    if (!owner || !page || !page.classList
        || !page.classList.contains('fp-pages-active-panel')) return 0;
    var prev = owner.previousElementSibling;
    while (prev) {
        if (prev.classList && prev.classList.contains('fp-item')) {
            var hbox = prev.querySelector
                ? prev.querySelector(':scope > .fp-control-wrap .fp-children-horizontal')
                : null;
            if (!hbox && prev.querySelector)
                hbox = prev.querySelector('.fp-children-horizontal');
            var track = firstVerticalColumnTitleTrackWidth(hbox);
            if (track > 0) return track;
        }
        prev = prev.previousElementSibling;
    }
    return 0;
}

function inheritPageFollowingThroughAlignTracks(body) {
    if (!body || !body.querySelectorAll) return 0;
    var pages = body.querySelectorAll('.fp-pages-active-panel.fp-children-vertical');
    var changed = 0;
    for (var p = 0; p < pages.length; p++) {
        var page = pages[p];
        for (var i = 0; i < page.children.length; i++) {
            var owner = page.children[i];
            if (!owner.classList || !owner.classList.contains('fp-item')) continue;
            var inner = owner.querySelector
                ? owner.querySelector(':scope > .fp-control-wrap .fp-children-vertical')
                : null;
            if (!inner || inner.classList.contains('fp-children-horizontal')) continue;
            if (!inner.dataset
                || String(inner.dataset.fpThroughAlign || '').toLowerCase() !== 'use')
                continue;
            var track = precedingThroughAlignTitleTrackWidth(owner);
            if (!(track > 0)) continue;
            var labels = collectFieldLabels(inner, true);
            for (var L = 0; L < labels.length; L++) {
                var current = parseFloat(labels[L].style.minWidth || '') || 0;
                var painted = labels[L].offsetWidth || 0;
                if (current === track && painted <= track + 1
                    && labels[L].style.maxWidth === track + 'px') continue;
                labels[L].style.minWidth = track + 'px';
                labels[L].style.maxWidth = track + 'px';
                labels[L].style.whiteSpace = 'normal';
                changed++;
            }
        }
    }
    return changed;
}

/* United=false makes a None group a subgrid of its parent's logical grid. A
 * vertical stack of such horizontal rows, each split into the same number of
 * United=false columns, is therefore one grid: column N of every row starts at
 * the same x and shares one side-title track (e.g. columns
 * [107, 305, 10, 131, 305] shared by every row). */
function stackedLogicalRowColumns(item) {
    if (!item || !item.classList || !item.classList.contains('fp-container-horizontal')
        || item.offsetHeight === 0 || !isLogicalSubgridGroup(item._fpItem)) return null;
    var box = item.querySelector(':scope > .fp-control-wrap > .fp-group-bare > .fp-children-horizontal');
    if (!box) return null;
    var columns = directFpItems(box).filter(function (column) { return column.offsetHeight > 0; });
    if (columns.length < 2) return null;
    if (columns.some(function (column) {
        return !column.classList.contains('fp-container') || !isLogicalSubgridGroup(column._fpItem);
    })) {
        /* A leading leaf (a title-less radio button) of a United=false row is
         * a grid column too: every value group starts after the widest
         * option. */
        if (columns.slice(0, -1).some(function (column) {
            return column.classList.contains('fp-container');
        })) return null;
        columns.leafLeading = true;
    }
    return columns;
}

function alignStackedLogicalRowColumns(body) {
    var changed = 0;
    var stacks = body.querySelectorAll('.fp-children-vertical');
    for (var s = 0; s < stacks.length; s++) {
        var runs = [], run = [];
        directFpItems(stacks[s]).forEach(function (item) {
            if (item.offsetHeight === 0) return;
            var columns = stackedLogicalRowColumns(item);
            if (columns && run.length && run[0].length !== columns.length) {
                runs.push(run);
                run = [];
            }
            if (columns) run.push(columns);
            else {
                runs.push(run);
                run = [];
            }
        });
        runs.push(run);
        runs.forEach(function (rows) {
            if (rows.length < 2) return;
            var count = rows[0].length;
            for (var c = 0; c < count; c++) {
                var labels = [];
                rows.forEach(function (columns) {
                    var own = columns[c].querySelectorAll('.fp-field-row.fp-title-left > .fp-field-label');
                    for (var l = 0; l < own.length; l++) {
                        if (own[l].offsetWidth === 0 || own[l].closest('.fp-pages-outer, .fp-tooltip-bg')) continue;
                        labels.push(own[l]);
                    }
                });
                /* The editor starts one side-title gap after the widest
                 * one-line caption (102 + 5 = 107, 126 + 5 = 131); a
                 * caption that already wraps does not widen the track. */
                var glyph = 0;
                labels.forEach(function (label) {
                    if (label.offsetHeight <= 20) glyph = Math.max(glyph, throughAlignGlyphMetric(label));
                });
                if (!(glyph > 0)) continue;
                var wanted = managedIndependentTitleTrackWidth([glyph]);
                var track = wanted;
                for (var pass = 0; pass < 2; pass++) {
                    labels.forEach(function (label) {
                        if (label.style.minWidth === track + 'px' && label.style.maxWidth === track + 'px') return;
                        label.style.minWidth = track + 'px';
                        label.style.maxWidth = track + 'px';
                        changed++;
                    });
                    var probe = labels.filter(function (label) {
                        return label.nextElementSibling && label.nextElementSibling.offsetWidth > 0;
                    })[0];
                    if (!probe) break;
                    var offset = probe.nextElementSibling.getBoundingClientRect().left - probe.getBoundingClientRect().left;
                    if (Math.abs(offset - wanted) < 0.5) break;
                    track = Math.max(0, Math.round(track + wanted - offset));
                }
            }
            /* Column N takes the widest published width of its rows. The
             * allocator republishes its own width on every pass, so the
             * shared width is derived from that, never from our last value. */
            var sharedCount = rows.some(function (columns) { return columns.leafLeading; })
                ? count - 1 : count;
            for (var k = 0; k < sharedCount; k++) {
                var width = 0;
                rows.forEach(function (columns) {
                    var published = parseFloat(columns[k].dataset.fpHorizontalPublishedWidth || '');
                    width = Math.max(width, published > 0 ? published : columns[k].getBoundingClientRect().width);
                });
                width = Math.round(width);
                rows.forEach(function (columns) {
                    var style = columns[k].style;
                    if (style.width === width + 'px' && style.minWidth === width + 'px'
                        && style.maxWidth === width + 'px') return;
                    style.flex = '0 0 ' + width + 'px';
                    style.width = width + 'px';
                    style.minWidth = width + 'px';
                    style.maxWidth = width + 'px';
                    changed++;
                });
            }
        });
    }
    return changed;
}

function pageLocalVerticalColumnDecisionWidth(box) {
    var scope = pageLocalVerticalColumnBox(box);
    if (!scope) return 0;
    var owner = box.closest('.fp-item');
    var column = scope.closest('.fp-item');
    var columnChildren = column._fpItem && column._fpItem.childItems || [];
    if (!pageLocalResponsiveColumnChildrenEligible(columnChildren)) return 0;
    var ownerChildren = owner._fpItem && owner._fpItem.childItems || [];
    var visibleOwnerChildren = ownerChildren.filter(function (child) {
        return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
    });
    if (!visibleOwnerChildren.length || visibleOwnerChildren.every(function (child) {
        return child.tag === 'PictureDecoration' || child.tag === 'LabelDecoration';
    })) return 0;
    var authored = parseInt(prop(column._fpItem, ['Width', 'Ширина']), 10) || 0;
    var decision = authored > 0 ? authored * GROUP_COL_PX : 0;
    for (var i = 0; i < box.children.length; i++) {
        var child = box.children[i];
        if (!child.classList || !child.classList.contains('fp-item')) continue;
        decision = Math.max(decision, horizontalChildPreferredWidth(child));
    }
    return decision;
}

function pageLocalResponsiveColumnChildrenEligible(children) {
    var visible = (children || []).filter(function (child) {
        return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
    });
    return visible.length > 0 && visible.every(function (child) { return isContainer(child.tag); });
}

function pageLocalVerticalColumnBox(box) {
    if (!box || !box.closest || !box.parentNode) return null;
    var owner = box.closest('.fp-item');
    var parentBox = owner && owner.parentNode;
    var column = parentBox && parentBox.closest ? parentBox.closest('.fp-item') : null;
    if (!owner || !parentBox || !column || owner.parentNode !== parentBox) return null;
    var pageBox = column && column.parentNode;
    if (!parentBox.classList.contains('fp-children-vertical') || !pageBox
        || !pageBox.classList.contains('fp-pages-active-panel')) return null;
    if (!pageLocalResponsiveColumnEligible({
        noStretch: column.classList.contains('fp-no-hstretch'),
        throughAlign: parentBox.dataset && parentBox.dataset.fpThroughAlign,
        width: parseInt(prop(column._fpItem, ['Width', 'Ширина']), 10) || 0,
        maxWidth: parseInt(prop(column._fpItem, ['MaxWidth', 'МаксимальнаяШирина']), 10) || 0
    })) return null;
    return parentBox;
}

function pageLocalResponsiveColumnEligible(options) {
    options = options || {};
    return !!(options.noStretch && options.throughAlign === 'use'
        && !(Number(options.width) > 0) && !(Number(options.maxWidth) > 0));
}

function capWideSideTitleBands(root, maximum) {
    if (!root || !root.querySelectorAll) return 0;
    var labels = root.querySelectorAll('.fp-field-row.fp-title-left > .fp-field-label');
    var changed = 0;
    for (var i = 0; i < labels.length; i++) {
        var width = parseFloat(labels[i].style.minWidth || '') || labelMetric(labels[i]);
        if (width <= maximum) continue;
        labels[i].style.minWidth = maximum + 'px';
        changed++;
    }
    return changed;
}

function restoreHorizontalWidthAllocations(body) {
    if (!body || !body.querySelectorAll) return;
    var generatedCompoundChoices = body.querySelectorAll('.fp-generated-compound-choice');
    for (var gc = 0; gc < generatedCompoundChoices.length; gc++)
        generatedCompoundChoices[gc].remove();
    var projectedCompoundOwners = body.querySelectorAll('.fp-projected-compound-editor-owner');
    for (var po = 0; po < projectedCompoundOwners.length; po++) {
        var projectedOwner = projectedCompoundOwners[po];
        projectedOwner.style.marginBottom = projectedOwner.dataset.fpCompoundBaseMarginBottom === '__empty__'
            ? '' : projectedOwner.dataset.fpCompoundBaseMarginBottom;
        delete projectedOwner.dataset.fpCompoundBaseMarginBottom;
        projectedOwner.classList.remove('fp-projected-compound-editor-owner');
    }
    var leadingFields = body.querySelectorAll('.fp-logical-leading-field-track');
    for (var lf = 0; lf < leadingFields.length; lf++) {
        leadingFields[lf].style.removeProperty('--fp-logical-leading-title-width');
        leadingFields[lf].classList.remove('fp-logical-leading-field-track');
    }
    var adjustedEditors = body.querySelectorAll('[data-fp-logical-editor-adjusted="1"]');
    for (var ae = 0; ae < adjustedEditors.length; ae++) {
        var editor = adjustedEditors[ae];
        editor.style.width = editor.dataset.fpLogicalEditorBaseWidth === '__empty__'
            ? '' : editor.dataset.fpLogicalEditorBaseWidth;
        editor.style.maxWidth = editor.dataset.fpLogicalEditorBaseMaxWidth === '__empty__'
            ? '' : editor.dataset.fpLogicalEditorBaseMaxWidth;
        editor.style.flex = editor.dataset.fpLogicalEditorBaseFlex === '__empty__'
            ? '' : editor.dataset.fpLogicalEditorBaseFlex;
        delete editor.dataset.fpLogicalEditorAdjusted;
    }
    var decorationTails = body.querySelectorAll('.fp-logical-decoration-tail-track');
    for (var d = 0; d < decorationTails.length; d++) {
        var tailRows = decorationTails[d].querySelectorAll('.fp-children-horizontal');
        for (var tr = 0; tr < tailRows.length; tr++)
            tailRows[tr].style.removeProperty('--fp-logical-decoration-fixed-width');
        decorationTails[d].style.removeProperty('--fp-logical-decoration-tail-width');
        decorationTails[d].classList.remove('fp-logical-decoration-tail-track');
    }
    var tablePairs = body.querySelectorAll('.fp-table-column-responsive-pair');
    for (var p = 0; p < tablePairs.length; p++)
        tablePairs[p].classList.remove('fp-table-column-responsive-pair');
    var managedLeftWide = body.querySelectorAll('.fp-managed-compressed-leftwide');
    for (var lw = 0; lw < managedLeftWide.length; lw++) {
        managedLeftWide[lw].classList.remove('fp-managed-compressed-leftwide');
        managedLeftWide[lw].style.removeProperty('--fp-managed-leftwide-leading');
        managedLeftWide[lw].style.removeProperty('--fp-managed-leftwide-trailing');
    }
    var detachedOverflowFields = body.querySelectorAll('.fp-detached-overflow-field');
    for (var ofi = 0; ofi < detachedOverflowFields.length; ofi++)
        detachedOverflowFields[ofi].classList.remove('fp-detached-overflow-field');
    var recursiveLeadingColumns = body.querySelectorAll('.fp-recursive-leading-column');
    for (var rlci = 0; rlci < recursiveLeadingColumns.length; rlci++)
        recursiveLeadingColumns[rlci].classList.remove('fp-recursive-leading-column');
    var detachedTrailingEditors = body.querySelectorAll('.fp-detached-trailing-editor-overhang');
    for (var dtei = 0; dtei < detachedTrailingEditors.length; dtei++)
        detachedTrailingEditors[dtei].classList.remove('fp-detached-trailing-editor-overhang');
    var items = body.querySelectorAll('[data-fp-horizontal-allocated="1"]');
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        item.style.flex = item.dataset.fpHorizontalBaseFlex === '__empty__' ? '' : item.dataset.fpHorizontalBaseFlex;
        item.style.width = item.dataset.fpHorizontalBaseWidth === '__empty__' ? '' : item.dataset.fpHorizontalBaseWidth;
        item.style.minWidth = item.dataset.fpHorizontalBaseMinWidth === '__empty__' ? '' : item.dataset.fpHorizontalBaseMinWidth;
        item.style.maxWidth = item.dataset.fpHorizontalBaseMaxWidth === '__empty__' ? '' : item.dataset.fpHorizontalBaseMaxWidth;
        delete item.dataset.fpHorizontalAllocated;
    }
    var logicalRows = body.querySelectorAll('[data-fp-logical-row-allocated="1"]');
    for (var r = 0; r < logicalRows.length; r++) {
        var row = logicalRows[r];
        row.style.width = row.dataset.fpLogicalRowBaseWidth === '__empty__'
            ? '' : row.dataset.fpLogicalRowBaseWidth;
        row.style.minWidth = row.dataset.fpLogicalRowBaseMinWidth === '__empty__'
            ? '' : row.dataset.fpLogicalRowBaseMinWidth;
        row.style.maxWidth = row.dataset.fpLogicalRowBaseMaxWidth === '__empty__'
            ? '' : row.dataset.fpLogicalRowBaseMaxWidth;
        delete row.dataset.fpLogicalRowAllocated;
    }
}

function semanticEditorAllocationBand(band, options) {
    band = band || {};
    options = options || {};
    var result = {
        min: Math.max(0, Number(band.min) || 0),
        normal: Math.max(0, Number(band.normal) || 0),
        recommended: Math.max(0, Number(band.recommended) || Number(band.normal) || 0),
        max: band.max == null ? Infinity : Number(band.max)
    };
    var declared = Math.max(0, Number(options.declared) || 0);
    var buttons = Math.max(0, Number(options.buttons) || 0);
    var tooltip = options.tooltip ? 14 : 0;
    if (declared) {
        var appended = options.explicitSideTitle ? 1 + buttons * 21 : 0;
        result.normal = result.recommended = declared + appended + tooltip;
        if (result.min >= declared) result.min = result.normal;
        if (isFinite(result.max)) result.max += appended + tooltip;
    } else if (options.reference) {
        var chrome = 11 + buttons * 21 + tooltip;
        /* AutoMaxWidth=false + MaxWidth fixes the editor at its maximum
         * (normal == max): the reference default must not recommend a lane
         * narrower than that painted editor. A 290px fixed editor with a
         * 150px recommendation overflows its allocation by 40px into the
         * next column. */
        var fixedEditor = options.fixedRecommendsNormal
            && isFinite(result.max) && result.normal > 0 && result.normal >= result.max;
        result.recommended = fixedEditor ? Math.max(result.normal, 150 + chrome) : 150 + chrome;
        result.min = 60 + chrome;
    }
    return result;
}

/* Resolve the painted editor lane from the same semantic units used by the
 * responsive allocator. MaxWidth is authored on the reference's 10px ruler; using the
 * browser's legacy 8px charSize here made a rich tooltip group's allocated
 * slot and its visible editor disagree. */
function semanticEditorPaintBand(options) {
    options = options || {};
    var maximum = Math.max(0, Number(options.maximum) || 0);
    var appendedChrome = Math.max(0, Number(options.appendedChrome) || 0);
    if (maximum > 0) maximum += appendedChrome;
    var natural = Math.max(0, Number(options.natural) || 0);
    var preferred = natural;
    if (maximum > 0) {
        if (options.autoMaxWidth === false || options.occupiesMaximum) preferred = maximum;
        else preferred = Math.min(maximum, natural);
    }
    return { preferred: preferred, maximum: maximum || Infinity };
}

function automaticCompoundEditorPaintWidth(generatedNormal, buttons) {
    generatedNormal = Math.max(0, Number(generatedNormal) || 0);
    buttons = Math.max(0, Number(buttons) || 0);
    return generatedNormal + TAXI_LAYOUT_METRICS.authoredEditorInsetWidth
        + buttons * TAXI_LAYOUT_METRICS.inputButtonLaneWidth;
}

function projectedTopTitleTrackBand(options) {
    options = options || {};
    var editor = Math.max(0, Number(options.editor) || 0);
    var title = Math.max(0, Number(options.title) || 0);
    var tooltip = Math.max(0, Number(options.tooltip) || 0);
    var tooltipLane = tooltip
        ? Math.ceil(tooltip) + TAXI_BROWSER_METRICS.horizontalSpacing.single : 0;
    var minimum = Math.ceil(editor + tooltipLane);
    /* A ShowRight caption already owns the trailing Taxi gutter in its own
     * lane. An ordinary top title owns both horizontal presentation insets. */
    var titleChrome = tooltipLane
        ? TAXI_LAYOUT_METRICS.horizontalSpacing.single
        : TAXI_LAYOUT_METRICS.horizontalSpacing.double;
    var maximumChrome = TAXI_LAYOUT_METRICS.horizontalSpacing.oneandhalf;
    return {
        minimum: minimum,
        preferred: Math.max(minimum, Math.ceil(title) + titleChrome + tooltipLane),
        trailing: Math.max(minimum, Math.ceil(title) + maximumChrome + tooltipLane)
    };
}

function finiteProjectedTrackSizes(maximums, available) {
    maximums = (maximums || []).map(function (value) {
        return Math.max(0, Number(value) || 0);
    });
    available = Math.max(0, Math.round(Number(available) || 0));
    var total = maximums.reduce(function (sum, value) { return sum + value; }, 0);
    if (!maximums.length || total <= available) return maximums.map(Math.round);
    var result = [];
    var remaining = available;
    var remainingMaximum = total;
    for (var i = 0; i < maximums.length; i++) {
        var size = i === maximums.length - 1 ? remaining
            : Math.round(remaining * maximums[i] / remainingMaximum);
        result.push(size);
        remaining -= size;
        remainingMaximum -= maximums[i];
    }
    return result;
}

/* Fixed projected compound rows retain the finite bands of their nested rich
 * TitleOnTop leaves. Browser flex otherwise spends the first wrapper's title
 * and ShowRight lanes on later captions, despite the outer row already owning
 * the full width. The calculation deliberately uses glyph/editor lanes only;
 * allocated DOM rectangles never feed the next resize pass. */
function fitProjectedCompoundLogicalTracks(body) {
    if (!body || !body.querySelectorAll || typeof getComputedStyle !== 'function') return 0;
    var owners = body.querySelectorAll('.fp-projected-compound-editor-owner');
    var changed = 0;
    for (var oi = 0; oi < owners.length; oi++) {
        var outerOwner = owners[oi];
        var outerBox = directLayoutChildren(outerOwner);
        var outerChildren = directFpItems(outerBox);
        if (!outerBox || outerChildren.length < 3) continue;
        var fixedTail = outerChildren[outerChildren.length - 1];
        var nested = outerChildren.slice(0, -1);
        if (!fixedTail.classList.contains('fp-no-hstretch') || !nested.every(function (owner) {
            var box = directLayoutChildren(owner);
            var leaves = directFpItems(box);
            return box && box.dataset && box.dataset.fpGroupMode === 'always-horizontal'
                && leaves.length >= 2 && leaves.every(function (leaf) {
                    if (leaf.dataset && leaf.dataset.tag === 'LabelDecoration') return true;
                    var row = leaf.querySelector(':scope > .fp-control-wrap.fp-field-row.fp-title-top');
                    return !!(row && leaf.dataset && leaf.dataset.tag === 'InputField'
                        && leaf.dataset.fieldKind === 'number'
                        && row.querySelector('.fp-input-wrap[data-fp-logical-editor-adjusted="1"]'));
                });
        })) continue;
        var wrapperMaximums = [];
        for (var ni = 0; ni < nested.length; ni++) {
            var nestedBox = directLayoutChildren(nested[ni]);
            var leaves = directFpItems(nestedBox);
            var gap = TAXI_LAYOUT_METRICS.horizontalSpacing.single;
            var maximumTotal = gap * Math.max(0, leaves.length - 1);
            for (var li = 0; li < leaves.length; li++) {
                var leaf = leaves[li];
                var row = leaf.querySelector(':scope > .fp-control-wrap.fp-field-row.fp-title-top');
                var editor = row && row.querySelector('.fp-input-wrap');
                if (!row || !editor) {
                    var decorationWidth = leaf.dataset && leaf.dataset.tag === 'LabelDecoration'
                        ? TAXI_LAYOUT_METRICS.tooltipButtonWidth
                            + TAXI_BROWSER_METRICS.horizontalSpacing.single : leaf.scrollWidth;
                    maximumTotal += decorationWidth;
                    continue;
                }
                var label = row.querySelector('.fp-field-label');
                var tooltip = leaf.querySelector(':scope > .fp-tooltip-text.fp-tooltip-right');
                var band = projectedTopTitleTrackBand({
                    editor: parseFloat(editor.style.width) || editor.clientWidth,
                    title: throughAlignGlyphMetric(label),
                    tooltip: tooltip ? throughAlignGlyphMetric(tooltip) : 0
                });
                /* The later caption keeps its intrinsic one-line paint width;
                 * only its editor lane is compressed. Shrinking the whole
                 * rich group to the editor minimum wraps the caption and
                 * changes the vertical cadence of every following section. */
                var trailingPaint = Math.max(band.minimum,
                    Math.ceil(throughAlignGlyphMetric(label))
                        + (tooltip ? Math.ceil(throughAlignGlyphMetric(tooltip))
                            + TAXI_BROWSER_METRICS.horizontalSpacing.single
                            : TAXI_LAYOUT_METRICS.inputBorderChromeWidth));
                var painted = li === 0 ? band.preferred : trailingPaint;
                leaf.style.flex = '0 0 ' + painted + 'px';
                leaf.style.width = painted + 'px';
                leaf.style.minWidth = painted + 'px';
                leaf.style.maxWidth = painted + 'px';
                leaf.dataset.fpHorizontalAllocated = '1';
                maximumTotal += li === 0 ? band.preferred : band.trailing;
            }
            wrapperMaximums.push(Math.ceil(maximumTotal));
        }
        var available = nested.reduce(function (sum, owner) {
            return sum + (parseFloat(owner.dataset.fpHorizontalPublishedWidth)
                || parseFloat(owner.style.width) || 0);
        }, 0);
        var wrapperSizes = finiteProjectedTrackSizes(wrapperMaximums, available);
        for (var wi = 0; wi < nested.length; wi++) {
            nested[wi].style.flex = '0 0 ' + wrapperSizes[wi] + 'px';
            nested[wi].style.width = wrapperSizes[wi] + 'px';
            nested[wi].style.minWidth = wrapperSizes[wi] + 'px';
            nested[wi].style.maxWidth = wrapperSizes[wi] + 'px';
            nested[wi].dataset.fpHorizontalAllocated = '1';
        }
        changed += nested.length + Math.max(0, outerChildren.length - 1);
    }
    return changed;
}

/* A fixed outer Horizontal row can project nested AlwaysHorizontal children
 * before the source renderer has materialised the reference's generated choice button.
 * Keep the responsive allocation immutable, then paint the finite generated
 * value+button band and its ordinary following-row cadence. This is deliberately
 * narrower than changing every omitted-width numeric input: the outer projected
 * owner shows that the leaf belongs to a reference compound grid. */
function fitProjectedCompoundEditorBands(body) {
    if (!body || !body.querySelectorAll) return 0;
    var items = body.querySelectorAll('.fp-item.fp-control[data-tag="InputField"]');
    var changed = 0;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var source = item._fpItem;
        if (!source || item.dataset.fpAuthoredWidthPresent === '1'
            || item.dataset.fieldKind !== 'number') continue;
        var row = item.querySelector(':scope > .fp-control-wrap.fp-field-row.fp-title-top');
        var editor = row && row.querySelector('.fp-input-wrap');
        if (!editor || !editor.querySelector('.fp-spin')) continue;
        var nestedBox = item.parentElement;
        var nestedOwner = nestedBox && nestedBox.closest ? nestedBox.closest('.fp-item.fp-container') : null;
        var outerBox = nestedOwner && nestedOwner.parentElement;
        var outerOwner = outerBox && outerBox.closest ? outerBox.closest('.fp-item.fp-container') : null;
        if (!nestedBox.dataset || nestedBox.dataset.fpGroupMode !== 'always-horizontal'
            || !outerBox || !outerBox.dataset || outerBox.dataset.fpGroupMode !== 'horizontal'
            || outerBox.dataset.fpLogicalRowAllocated !== '1'
            || !outerOwner || !outerOwner.classList.contains('fp-no-hstretch')) continue;
        if (!editor.querySelector('.fp-input-btn')) {
            var generatedChoice = iconBtn('dots');
            generatedChoice.classList.add('fp-choice-button', 'fp-generated-compound-choice');
            editor.insertBefore(generatedChoice, editor.querySelector('.fp-spin'));
        }
        if (!Object.prototype.hasOwnProperty.call(editor.dataset, 'fpLogicalEditorBaseWidth')) {
            editor.dataset.fpLogicalEditorBaseWidth = editor.style.width || '__empty__';
            editor.dataset.fpLogicalEditorBaseMaxWidth = editor.style.maxWidth || '__empty__';
            editor.dataset.fpLogicalEditorBaseFlex = editor.style.flex || '__empty__';
        }
        var buttons = editor.querySelectorAll('.fp-input-btn, .fp-spin').length;
        var width = automaticCompoundEditorPaintWidth(
            parseFloat(item.dataset.fpAuthoredRecommendedWidth) || 0, buttons);
        editor.style.width = width + 'px';
        editor.style.maxWidth = width + 'px';
        editor.style.flex = '0 0 auto';
        editor.dataset.fpLogicalEditorAdjusted = '1';
        if (!outerOwner.classList.contains('fp-projected-compound-editor-owner')) {
            outerOwner.dataset.fpCompoundBaseMarginBottom = outerOwner.style.marginBottom || '__empty__';
            outerOwner.style.marginBottom = TAXI_LAYOUT_METRICS.rowGap + 'px';
            outerOwner.classList.add('fp-projected-compound-editor-owner');
        }
        changed++;
    }
    return changed;
}
/* A multi-word label decoration wraps in the reference; its one-line width is a
 * preference, not a floor (an unwrapped hint could push the form into a
 * 1600px canvas). */
function wrappableTextItem(item) {
    if (!item || !item.classList || (item.style && item.style.width)) return false;
    if (!item.classList.contains('fp-native-label-decoration')) {
        /* A bare wrapper of a hint (icon + text) wraps with its text, as long
         * as it holds nothing that keeps a fixed one-line width. */
        if (!item.classList.contains('fp-container') || !item.querySelector
            || item.querySelector('.fp-input-wrap, .fp-labelfield-value, .fp-button, .fp-check-row, table'))
            return false;
        var texts = item.querySelectorAll('.fp-native-label-decoration');
        for (var i = 0; i < texts.length; i++) if (wrappableTextItem(texts[i])) return true;
        return false;
    }
    return /\S\s+\S/.test(String(item.textContent || '').trim());
}

function itemHorizontalAllocationBand(item, semanticLeaf, responsiveLeaf) {
    var normal = parseFloat(item.dataset && item.dataset.fpAuthoredNormalWidth) || 0;
    var recommended = parseFloat(item.dataset && item.dataset.fpAuthoredRecommendedWidth) || normal;
    var minimum = parseFloat(item.dataset && item.dataset.fpWidthBandMin) || 0;
    var maximumText = item.dataset && item.dataset.fpWidthBandMax;
    var maximum = maximumText ? parseFloat(maximumText) : Infinity;
    var explicit = normal > 0;
    var titleNormalFloor = 0;
    var wrappedSideTitleSaving = 0;
    var autoSideTitleWidth = 0;
    var row = item.querySelector ? item.querySelector(':scope > .fp-control-wrap.fp-field-row') : null;
    var sideLabel = row && (row.classList.contains('fp-title-left') || row.classList.contains('fp-title-right'))
        ? row.querySelector('.fp-field-label') : null;
    var input = row && row.querySelector('.fp-input-wrap, .fp-labelfield-value');
    if (input && semanticLeaf) {
        var buttons = input.querySelectorAll ? input.querySelectorAll('.fp-input-btn').length : 0;
        var tooltipLane = item.classList.contains('fp-has-tooltip-link') ? 14 : 0;
        var declared = parseFloat(item.dataset && item.dataset.fpDeclaredWidthBand) || 0;
        /* The platform sizes the editor text lane and its appended buttons as
         * separate tracks.  Keep this arithmetic pure: it is also the
         * stable leaf input for recursive wrapper allocation. */
        var semantic = semanticEditorAllocationBand({
            min: minimum, normal: normal, recommended: recommended, max: maximum
        }, {
            declared: declared,
            reference: item.dataset && item.dataset.fieldKind === 'ref',
            buttons: buttons,
            tooltip: !!tooltipLane,
            /* Only the recursive wrapper projection needs the fixed editor's full
             * lane; the ordinary logical pass keeps the 150px reference
             * recommendation. */
            fixedRecommendsNormal: !!responsiveLeaf,
            explicitSideTitle: !!(declared && sideLabel && !row.classList.contains('fp-title-auto')
                && !(item.dataset && item.dataset.fpDeclaredIncludesButtons))
        });
        minimum = semantic.min;
        normal = semantic.normal;
        recommended = semantic.recommended;
        maximum = semantic.max;
    }
    var editorNormal = normal;
    if (sideLabel) {
        /* Recursive semantic bands own the caption glyphs, not the inline
         * min-width installed later by ThroughAlign. Feeding that painted
         * column back into the wrapper makes its recommendation depend on an
         * earlier flex allocation instead of the authored caption. */
        var paintedTitle = labelMetric(sideLabel);
        var titleNormal = (semanticLeaf
            ? Math.min(paintedTitle, intrinsicLabelTextMetric(sideLabel)
                + TAXI_LAYOUT_METRICS.buttonCaptionChromeWidth)
            : paintedTitle) + 5;
        /* A side title with TitleHeight>1 wraps before it widens its column:
         * only its wrapped width is a floor. */
        if (item.classList.contains('fp-title-multiline') && !labelHasAuthoredWrap(sideLabel)) {
            var titleLines = parseInt(item._fpItem && prop(item._fpItem, ['TitleHeight', 'ВысотаЗаголовка']), 10) || 2;
            wrappedSideTitleSaving = Math.max(0, titleNormal
                - (Math.ceil(intrinsicLabelTextMetric(sideLabel) / titleLines) + 10));
        }
        /* An automatic side title owns a later TitleOnTop variant, therefore
         * it is not a hard floor of the value track. */
        if (row.classList.contains('fp-title-auto')) autoSideTitleWidth = titleNormal;
        /* A side title that can wrap is a WidthDependedHeight label: its
         * minWidth is its longest word for both priorities («Компенсации
         * отпуска:» minWidth 80, column 85 = min of both). A single word keeps
         * its whole width. */
        var wrapsForEditor = row.classList.contains('fp-title-shrinks-for-editor');
        var titleMinimum = row.classList.contains('fp-title-auto') ? 0
            : wrapsForEditor ? Math.min(titleNormal, longestWordLabelMetric(sideLabel) + 5)
            : Math.min(titleNormal, TAXI_LAYOUT_METRICS.compressedTitleMaximumWidth + 5);
        /* Any other side title is a HorStretchPriority label: native keeps it
         * whole (minLengthWithNormalPriority) until the value lanes are exhausted. */
        titleNormalFloor = wrapsForEditor ? 0 : titleNormal - titleMinimum;
        normal += titleNormal;
        recommended += titleNormal;
        minimum += titleMinimum;
        if (isFinite(maximum)) maximum += titleNormal;
    }
    var topLabel = row && row.classList.contains('fp-title-top')
        ? row.querySelector('.fp-field-label') : null;
    if (topLabel && semanticLeaf) {
        /* TitleHeight is a wrapping allowance, not a request to compress the
         * normal horizontal band. AlwaysHorizontal projection first reserves
         * the intrinsic caption; a narrower responsive layout may wrap it. */
        var topTitleNormal = intrinsicLabelTextMetric(topLabel);
        normal = Math.max(normal, topTitleNormal);
        recommended = Math.max(recommended, topTitleNormal);
    }
    if (!explicit) {
        var rect = item.getBoundingClientRect ? item.getBoundingClientRect() : { width: 0 };
        normal = Math.ceil(Math.max(item.scrollWidth || 0, rect.width || 0));
        recommended = normal;
        minimum = item.classList.contains('fp-no-hstretch') && !wrappableTextItem(item)
            ? normal : Math.min(normal, 71);
        /* A checkbox row is as wide as its box and caption; a width measured
         * after the column stretched it is not a floor (it would claim the
         * whole stretched column). */
        var checkRow = item.querySelector && item.querySelector(':scope > .fp-control-wrap.fp-check-row:not(.fp-title-left)');
        var checkLabel = checkRow && checkRow.querySelector('.fp-field-label');
        if (checkLabel && item.dataset && item.dataset.tag === 'CheckBoxField') {
            var checkIntrinsic = Math.ceil(intrinsicLabelTextMetric(checkLabel)) + 30;
            if (checkIntrinsic < minimum) minimum = checkIntrinsic;
        }
        /* An empty decoration is a spacer: its painted width follows the
         * column, it never forces one. */
        if (item.classList.contains('fp-control') && item.dataset && item.dataset.tag === 'LabelDecoration'
            && !String(item.textContent || '').trim()) minimum = 0;
    }
    var stretch = item.dataset && item.dataset.fpWidthStretch
        ? item.dataset.fpWidthStretch === '1' : item.classList.contains('fp-hstretch');
    var fixed = item.dataset && item.dataset.fpAuthoredFixedWidth === '1';
    if (fixed) minimum = normal;
    if (fixed && canvasDecisionPass && autoSideTitleWidth > 0)
        minimum = Math.max(0, normal - autoSideTitleWidth);
    if (wrappedSideTitleSaving) minimum = Math.max(0, minimum - wrappedSideTitleSaving);
    if (!stretch || fixed) maximum = normal;
    var bandMinimum = Math.min(normal, Math.max(0, minimum));
    /* standardLength exists only on a growable track and excludes
     * the fixed side-title column. */
    var standard = stretch && !fixed ? (explicit ? editorNormal : normal) : 0;
    return {
        standard: standard, min: bandMinimum, minNormal: Math.min(normal, bandMinimum + (fixed || !explicit ? 0 : titleNormalFloor)),
        normal: normal, recommended: recommended,
        max: maximum, stretch: stretch, stretchPriority: item.dataset && item.dataset.fpWidthStretchPriority === '1',
        compressPriority: item.dataset && item.dataset.fpWidthCompressPriority === '1',
        compress: !fixed, explicit: explicit
    };
}

function directLayoutChildren(item) {
    if (!item || !item.querySelectorAll) return null;
    var boxes = item.querySelectorAll('.fp-children');
    for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        if (!box.closest || box.closest('.fp-item') === item) return box;
    }
    return null;
}

function directFpItems(box) {
    var result = [];
    if (!box || !box.children) return result;
    for (var i = 0; i < box.children.length; i++) {
        var child = box.children[i];
        if (!child.classList || !child.classList.contains('fp-item')) continue;
        /* A CSS-collapsed item (an untitled spacer between two fields) takes no
         * track; allocating its band widened date rows to 1103px. */
        if (child.offsetParent === null && typeof getComputedStyle === 'function'
            && getComputedStyle(child).display === 'none') continue;
        result.push(child);
    }
    return result;
}

function isBareAutomaticColumnTreeItem(item) {
    var box = directLayoutChildren(item);
    if (!box || !box.classList || box.classList.contains('fp-logical-subgrid')
        || !box.classList.contains('fp-container-bare')) return false;
    if (box.classList.contains('fp-children-vertical')) return true;
    if (!box.classList.contains('fp-children-horizontal')) return false;
    var children = directFpItems(box);
    return children.length > 1 && children.every(isBareAutomaticColumnTreeItem);
}

function isRecursiveAutomaticColumnTree(box, children) {
    if (!box || !box.classList || !box.classList.contains('fp-children-horizontal')
        || !children || children.length < 2 || !children.every(isBareAutomaticColumnTreeItem)) return false;
    return children.some(function (child) {
        var childBox = directLayoutChildren(child);
        return childBox && childBox.classList.contains('fp-children-horizontal');
    });
}

function combineLogicalSubgridBands(entries, orientation, gap) {
    entries = entries || [];
    if (!entries.length) return { min: 0, normal: 0, recommended: 0, max: 0,
        stretch: false, stretchPriority: false, compressPriority: false, compress: true };
    var horizontal = orientation === 'horizontal';
    var separator = horizontal ? Math.max(0, Number(gap) || 0) * Math.max(0, entries.length - 1) : 0;
    function fold(propName, fallback, combine) {
        var value = fallback;
        for (var i = 0; i < entries.length; i++) value = combine(value, Number(entries[i][propName]) || 0);
        return value + separator;
    }
    var maximum;
    if (horizontal) {
        maximum = separator;
        for (var m = 0; m < entries.length; m++) {
            var entryMaximum = entries[m].max == null ? Infinity : Number(entries[m].max);
            if (!isFinite(entryMaximum)) { maximum = Infinity; break; }
            maximum += Math.max(0, entryMaximum);
        }
    } else {
        maximum = 0;
        for (var v = 0; v < entries.length; v++) {
            var verticalMaximum = entries[v].max == null ? Infinity : Number(entries[v].max);
            if (!isFinite(verticalMaximum)) { maximum = Infinity; break; }
            maximum = Math.max(maximum, verticalMaximum);
        }
    }
    var minNormal = 0;
    for (var n = 0; n < entries.length; n++) {
        var entryFloor = Math.max(Number(entries[n].min) || 0,
            entries[n].minNormal == null ? 0 : Number(entries[n].minNormal) || 0);
        minNormal = horizontal ? minNormal + entryFloor : Math.max(minNormal, entryFloor);
    }
    return {
        minNormal: minNormal + separator,
        standard: entries.reduce(function (value, entry) {
            var own = Math.max(0, Number(entry.standard) || 0);
            return horizontal ? value + own : Math.max(value, own);
        }, 0),
        min: fold('min', 0, horizontal ? function (a, b) { return a + b; } : Math.max),
        normal: fold('normal', 0, horizontal ? function (a, b) { return a + b; } : Math.max),
        recommended: fold('recommended', 0, horizontal ? function (a, b) { return a + b; } : Math.max),
        max: maximum,
        /* A dissolved wrapper is not itself a recipient of the parent's
         * surplus. Stretch remains owned by its projected leaf tracks. */
        stretch: false, stretchPriority: false, compressPriority: false, compress: true
    };
}

function logicalSubgridAllocationBand(item, semanticLeaves) {
    var box = directLayoutChildren(item);
    if (!box) return itemHorizontalAllocationBand(item);
    var children = directFpItems(box);
    if (!children.length) return itemHorizontalAllocationBand(item);
    var entries = children.map(function (child) {
        return directLayoutChildren(child)
            ? logicalSubgridAllocationBand(child, semanticLeaves)
            : itemHorizontalAllocationBand(child, !!semanticLeaves);
    });
    var style = typeof getComputedStyle === 'function' ? getComputedStyle(box) : null;
    var gap = style ? (parseFloat(style.columnGap || style.gap || '') || 0) : 0;
    var orientation = box.classList && box.classList.contains('fp-children-horizontal')
        ? 'horizontal' : 'vertical';
    var combined = combineLogicalSubgridBands(entries, orientation, gap);
    /* The 5px side inset of a white card is part of the card's track: the
     * column keeps its authored 480px and the content gets 470. */
    if (item.classList && (item.classList.contains('fp-stack-card')
        || item.classList.contains('fp-neutral-surface')) && typeof getComputedStyle === 'function') {
        var itemStyle = getComputedStyle(item);
        var inset = (parseFloat(itemStyle.paddingLeft) || 0) + (parseFloat(itemStyle.paddingRight) || 0);
        ['min', 'minNormal', 'normal', 'recommended', 'max'].forEach(function (key) {
            if (typeof combined[key] === 'number' && isFinite(combined[key])) combined[key] += inset;
        });
    }
    /* A group authored HorizontalStretch=false cannot be compressed by the
     * platform: its minWidth is its width (559 = max, although a row inside
     * may go down to 530), which widens the owner and makes the Form scroll
     * on that canvas. */
    if (canvasDecisionPass && item._fpItem && isContainer(item._fpItem.tag)
        && isFalse(prop(item._fpItem, ['HorizontalStretch', 'РастягиватьПоГоризонтали'])))
        combined.min = Math.max(combined.min || 0, combined.normal || 0);
    var title = item.querySelector ? item.querySelector(':scope > .fp-control-wrap .fp-group-title') : null;
    if (title) {
        /* .fp-group-title is a block and its border box fills the already
         * flex-allocated wrapper. Feeding that rect back into the logical
         * band made the allocation self-confirm an old 50/50 split. Only the
         * title glyphs belong to the projected track. */
        var titleWidth = Math.ceil(intrinsicLabelTextMetric(title));
        combined.min = Math.max(combined.min, titleWidth);
        combined.normal = Math.max(combined.normal, titleWidth);
        combined.recommended = Math.max(combined.recommended, titleWidth);
    }
    var pairedTrailingBand = parseFloat(item.dataset
        && item.dataset.fpPairedLogicalTrailingBand) || 0;
    if (pairedTrailingBand) {
        /* Detached titled columns retain one compact horizontal gutter in
         * their projected track in addition to the parent row gap. */
        combined.min += pairedTrailingBand;
        combined.minNormal += pairedTrailingBand;
        combined.normal += pairedTrailingBand;
        combined.recommended += pairedTrailingBand;
        if (isFinite(combined.max)) combined.max += pairedTrailingBand;
    }
    return combined;
}

function isLogicalSubgridItem(item) {
    var box = directLayoutChildren(item);
    return !!(box && box.classList && box.classList.contains('fp-logical-subgrid'));
}

function hasStretchingControl(item) {
    return !!(item && item.querySelector
        && item.querySelector('.fp-item.fp-control.fp-hstretch'));
}

/* HorizontalStretch=true authored on an editor publishes a maximum
 * above its normal band. Only such a leaf makes a recursive tree column a
 * recipient of the row surplus; a generated wrapper stretch (e.g. totals)
 * leaves the leftover to the trailing column. */
function hasAuthoredStretchingEditor(item) {
    return !!(item && item.querySelector
        && item.querySelector('.fp-item.fp-control[data-fp-width-stretch-priority="1"]'));
}

function isDecorationOnlyLogicalSubgrid(item) {
    if (!isLogicalSubgridItem(item) || !item.querySelectorAll) return false;
    var controls = item.querySelectorAll('.fp-item.fp-control');
    if (!controls.length) return false;
    for (var i = 0; i < controls.length; i++) {
        var tag = controls[i].dataset && controls[i].dataset.tag;
        if (tag !== 'LabelDecoration' && tag !== 'PictureDecoration') return false;
    }
    return true;
}

/* The reference keeps an ordinary leading field column at its published normal band,
 * lets a later value column consume the remaining row, and gives a trailing
 * decoration column the standard 20-character presentation band.  Browser
 * flex instead compressed both field columns equally and kept the unwrapped
 * warning text, reversing all three source-order tracks. */
function projectFieldColumnsWithDecorationTail(children, entries) {
    if (!children || children.length < 3 || !entries || entries.length !== children.length)
        return null;
    if (!children.every(isLogicalSubgridItem)
        || hasStretchingControl(children[0])
        || !isDecorationOnlyLogicalSubgrid(children[children.length - 1])) return null;
    var flexible = [];
    for (var i = 1; i < children.length - 1; i++)
        if (hasStretchingControl(children[i])) flexible.push(i);
    if (flexible.length !== 1) return null;
    var projected = entries.map(function (entry) {
        var copy = {};
        for (var key in entry)
            if (Object.prototype.hasOwnProperty.call(entry, key)) copy[key] = entry[key];
        return copy;
    });
    var leading = Math.max(projected[0].min || 0,
        projected[0].recommended || projected[0].normal || 0);
    projected[0].min = projected[0].normal = projected[0].recommended = projected[0].max = leading;
    projected[0].stretch = false;
    projected[0].compress = false;
    var trailingIndex = projected.length - 1;
    /* Picture and text are paint lanes inside the same decoration column.
     * Summing them as independent wrapper tracks preserves an unwrapped DOM
     * rectangle; the reference publishes the standard field-presentation band and
     * overlays the compact picture lane within that width. */
    var standardPresentation = authoredFieldWidthPx(DEFAULT_FIELD_CHARS, 'LabelField');
    var trailing = Math.min(projected[trailingIndex].normal || standardPresentation,
        standardPresentation);
    projected[trailingIndex].min = projected[trailingIndex].normal =
        projected[trailingIndex].recommended = projected[trailingIndex].max = trailing;
    projected[trailingIndex].stretch = false;
    projected[trailingIndex].compress = false;
    projected[flexible[0]].compressPriority = true;
    return projected;
}

function fitDecorationTailRows(item) {
    if (!item || !item.querySelectorAll || typeof getComputedStyle !== 'function') return;
    var rows = item.querySelectorAll('.fp-children-horizontal');
    for (var r = 0; r < rows.length; r++) {
        var children = directFpItems(rows[r]);
        var labels = children.filter(function (child) {
            return child.dataset && child.dataset.tag === 'LabelDecoration';
        });
        if (labels.length !== 1) continue;
        var fixed = 0;
        for (var i = 0; i < children.length; i++) {
            if (children[i] === labels[0]) continue;
            fixed += children[i].getBoundingClientRect().width;
        }
        var style = getComputedStyle(rows[r]);
        var gap = parseFloat(style.columnGap || style.gap || '') || 0;
        fixed += gap * Math.max(0, children.length - 1);
        rows[r].style.setProperty('--fp-logical-decoration-fixed-width', Math.ceil(fixed) + 'px');
    }
}

function fitLeadingFieldColumn(item) {
    if (!item || !item.querySelectorAll) return;
    var labels = item.querySelectorAll('.fp-field-row.fp-title-left > .fp-field-label');
    /* Glyph widths, not offsetWidth: an earlier applyLabelWidth pass already
     * published min-width on these labels, and reading it back added the
     * chrome twice (90 instead of the reference 84). */
    var glyphWidths = [];
    for (var l = 0; l < labels.length; l++) glyphWidths.push(throughAlignGlyphMetric(labels[l]));
    if (glyphWidths.length) {
        item.style.setProperty('--fp-logical-leading-title-width',
            throughAlignTitleTrackWidth(glyphWidths) + 'px');
        item.classList.add('fp-logical-leading-field-track');
    }
    var controls = item.querySelectorAll('.fp-item.fp-control');
    for (var i = 0; i < controls.length; i++) {
        var source = controls[i]._fpItem;
        if (!source || (source.tag !== 'InputField' && source.tag !== 'LabelField'
            && source.tag !== 'ValueList')) continue;
        var maximum = parseInt(prop(source, ['MaxWidth', 'МаксимальнаяШирина']), 10) || 0;
        if (!maximum || charSize(prop(source, ['Width', 'Ширина']))
            || !isFalse(prop(source, ['AutoMaxWidth']))) continue;
        var editor = controls[i].querySelector('.fp-input-wrap, .fp-labelfield-value');
        if (!editor) continue;
        if (!Object.prototype.hasOwnProperty.call(editor.dataset, 'fpLogicalEditorBaseWidth')) {
            editor.dataset.fpLogicalEditorBaseWidth = editor.style.width || '__empty__';
            editor.dataset.fpLogicalEditorBaseMaxWidth = editor.style.maxWidth || '__empty__';
            editor.dataset.fpLogicalEditorBaseFlex = editor.style.flex || '__empty__';
        }
        var nativeMaximum = maximum * REF_AUTHORED_CHAR_PX + 10;
        editor.style.width = nativeMaximum + 'px';
        editor.style.maxWidth = nativeMaximum + 'px';
        editor.style.flex = '0 0 auto';
        /* Beside a trailing command the fixed band still gives way inside
         * its column (290 → 242px), which keeps the trailing button inside
         * the column, as in the reference. */
        var editorRow = controls[i].parentElement;
        if (editorRow && editorRow.classList.contains('fp-children-horizontal')
            && directFpItems(editorRow).length > 1) {
            editor.style.flex = '0 1 auto';
            editor.style.minWidth = TAXI_LAYOUT_METRICS.compressedFieldMinimumWidth + 'px';
            controls[i].style.minWidth = '0';
            controls[i].style.flexShrink = '1';
        }
        editor.dataset.fpLogicalEditorAdjusted = '1';
    }
}

function responsiveWrapperAllocationBand(item) {
    var box = directLayoutChildren(item);
    if (!box) return itemHorizontalAllocationBand(item, true, true);
    var children = directFpItems(box);
    if (!children.length) return itemHorizontalAllocationBand(item, true, true);
    var entries = children.map(responsiveWrapperAllocationBand);
    var style = typeof getComputedStyle === 'function' ? getComputedStyle(box) : null;
    var gap = style ? (parseFloat(style.columnGap || style.gap || '') || 0) : 0;
    var horizontal = box.classList && box.classList.contains('fp-children-horizontal');
    var combined = combineLogicalSubgridBands(entries, horizontal ? 'horizontal' : 'vertical', gap);
    if (horizontal) {
        combined.recommended = gap * Math.max(0, entries.length - 1);
        for (var i = 0; i < entries.length; i++) {
            /* A growable value track contributes its responsive
             * minimum to its wrapper; fixed siblings retain recommendation. */
            combined.recommended += entries[i].stretch
                ? Math.max(0, entries[i].min || 0)
                : Math.max(entries[i].min || 0, entries[i].recommended || entries[i].normal || 0);
        }
        combined.normal = combined.recommended;
    }
    var ownNormal = parseFloat(item.dataset && item.dataset.fpAuthoredNormalWidth) || 0;
    var own = ownNormal ? itemHorizontalAllocationBand(item) : null;
    var ownFixed = item.dataset && item.dataset.fpAuthoredFixedWidth === '1';
    combined.stretch = item.dataset && item.dataset.fpWidthStretch
        ? item.dataset.fpWidthStretch === '1' : item.classList.contains('fp-hstretch');
    combined.stretchPriority = item.dataset && item.dataset.fpWidthStretchPriority === '1';
    combined.compressPriority = item.dataset && item.dataset.fpWidthCompressPriority === '1';
    combined.compress = !ownFixed;
    combined.explicit = !!own;
    if (own) {
        combined.min = own.min;
        combined.minNormal = own.minNormal;
        combined.standard = own.standard;
        combined.normal = own.normal;
        combined.recommended = own.recommended;
        combined.max = own.max;
    }
    return combined;
}

/* A colliding authored row inside a Page is resolved by widening that Page's
 * scroll canvas. Its preferred width must be calculated before flex pressure:
 * current DOM rectangles have already compressed automatic editors from the reference's
 * 40-unit presentation lane and merely preserve the bad sibling origin. */
function automaticEditorScrollAllocationBand(band, generatedNormal, eligible) {
    var result = {
        min: band.min, normal: band.normal, recommended: band.recommended,
        max: band.max, stretch: band.stretch,
        stretchPriority: band.stretchPriority, compressPriority: band.compressPriority,
        compress: band.compress, explicit: band.explicit
    };
    if (!eligible) return result;
    var delta = Math.max(0, TAXI_LAYOUT_METRICS.automaticEditorPresentationWidth
        - (Math.max(0, Number(generatedNormal) || 0)));
    result.normal += delta;
    result.recommended += delta;
    if (isFinite(result.max)) result.max += delta;
    return result;
}

function scrollCanvasWrapperAllocationBand(item) {
    var box = directLayoutChildren(item);
    if (!box) {
        var leaf = itemHorizontalAllocationBand(item, true);
        var tag = String(item && item.dataset && item.dataset.tag || '');
        var automaticEditor = (tag === 'InputField' || tag === 'ValueList')
            && leaf.stretch
            && item.dataset.fpAuthoredWidthPresent !== '1'
            && !item.dataset.fpWidthBandMax;
        return automaticEditorScrollAllocationBand(leaf,
            parseFloat(item.dataset.fpAuthoredNormalWidth) || 0, automaticEditor);
    }
    var children = directFpItems(box);
    if (!children.length) return itemHorizontalAllocationBand(item, true);
    var entries = children.map(scrollCanvasWrapperAllocationBand);
    var style = typeof getComputedStyle === 'function' ? getComputedStyle(box) : null;
    var gap = style ? (parseFloat(style.columnGap || style.gap || '') || 0) : 0;
    var orientation = box.classList && box.classList.contains('fp-children-horizontal')
        ? 'horizontal' : 'vertical';
    var combined = combineLogicalSubgridBands(entries, orientation, gap);
    var ownNormal = parseFloat(item.dataset && item.dataset.fpAuthoredNormalWidth) || 0;
    if (ownNormal) {
        var own = itemHorizontalAllocationBand(item);
        combined.min = own.min;
        combined.minNormal = own.minNormal;
        combined.standard = own.standard;
        combined.normal = own.normal;
        combined.recommended = own.recommended;
        combined.max = own.max;
    }
    combined.stretch = item.dataset && item.dataset.fpWidthStretch
        ? item.dataset.fpWidthStretch === '1' : item.classList.contains('fp-hstretch');
    return combined;
}

function pageScrollCanvasPreferredRowWidth(row) {
    if (!row || !row.closest || !row.closest('.fp-pages-active-panel')
        || row.dataset.fpGroupMode !== 'always-horizontal') return 0;
    var children = directFpItems(row);
    if (children.length < 2) return 0;
    var bands = children.map(scrollCanvasWrapperAllocationBand);
    var hasLeadingStretch = false;
    var hasTrailingAuthoredBoundary = false;
    for (var i = 0; i + 1 < bands.length; i++) {
        if (!bands[i].stretch) continue;
        for (var next = i + 1; next < children.length; next++) {
            if (children[next].dataset.fpAuthoredWidthPresent === '1'
                && !bands[next].stretch) {
                hasLeadingStretch = true;
                hasTrailingAuthoredBoundary = true;
                break;
            }
        }
        if (hasTrailingAuthoredBoundary) break;
    }
    if (!hasLeadingStretch || !hasTrailingAuthoredBoundary) return 0;
    var style = typeof getComputedStyle === 'function' ? getComputedStyle(row) : null;
    var gap = style ? (parseFloat(style.columnGap || style.gap || '') || 0) : 0;
    var width = gap * Math.max(0, bands.length - 1);
    for (var b = 0; b < bands.length; b++) width += Math.max(0, bands[b].normal || 0);
    return Math.ceil(width);
}

/* Table columns are authored semantic tracks. Their inline col widths are
 * produced from Form.xml and therefore remain stable across ResizeObserver
 * passes, unlike the current flexed table rectangle. A vertical wrapper with
 * several tables publishes its widest grid as the column recommendation. */
function descendantTableColumnRecommendation(item) {
    if (!item || !item.querySelectorAll) return 0;
    var tables = item.querySelectorAll('.fp-item[data-tag="Table"]');
    var widest = 0;
    for (var i = 0; i < tables.length; i++) {
        /* The recommendation belongs to the outer Table field.  Physical
         * column minima are deliberately allowed to overflow its internal
         * grid and must never become a min-content width for the responsive
         * pair containing the table.  Summing colgroup widths here made a
         * table push its sibling out of the pair and compressed fields such
         * as OKATO/IFNS. */
        var authored = parseFloat(tables[i].dataset
            && tables[i].dataset.fpAuthoredRecommendedWidth) || 0;
        var grid = parseFloat(tables[i].dataset
            && tables[i].dataset.fpTableGridWidth) || 0;
        widest = Math.max(widest, authored, grid);
    }
    /* A lone table publishes its authored grid plus the native field chrome.
     * A vertical stack is a composite reference column: its disclosure/status lane
     * owns the wider Taxi presentation band. This outer recommendation is
     * deliberately independent from the scrollable physical <col> widths. */
    if (tables.length === 1 && widest > 0) widest += 5;
    else if (tables.length > 1 && widest > 0) widest = Math.max(widest, 558);
    return Math.round(widest);
}

/* A headerless columnless List group publishes the reference's compressed band
 * (applyItemMetrics). Its Table's authored 400px recommendation belongs to the
 * inner field, not to the column: letting the allocator reuse it widened such
 * a column to 482px and pushed the neighbouring Pages off the window. The
 * compact column is a fixed track; the sibling owns the remaining row width. */
function compactListColumnBands(children, entries) {
    if (!children || !entries) return entries;
    var compact = children.map(function (child) {
        return !!(child && child.classList && child.classList.contains('fp-compact-list-group'));
    });
    if (!compact.some(Boolean) || compact.every(Boolean)) return entries;
    return entries.map(function (entry, index) {
        var projected = {};
        for (var key in entry)
            if (Object.prototype.hasOwnProperty.call(entry, key)) projected[key] = entry[key];
        if (compact[index]) {
            var width = COMPACT_LIST_COLUMN_WIDTH;
            projected.min = width;
            projected.normal = width;
            projected.recommended = width;
            projected.max = width;
            projected.stretch = false;
            projected.stretchPriority = false;
            projected.compressPriority = false;
            projected.explicit = true;
        } else {
            projected.stretch = true;
            projected.max = Infinity;
        }
        return projected;
    });
}

function isTableColumnResponsivePair(box, children, recommendations) {
    if (children && children.some(function (child) {
        return child && child.classList && child.classList.contains('fp-compact-list-group');
    })) return false;
    if (!box || !box.dataset || box.dataset.fpGroupMode !== 'horizontal'
        || box.dataset.fpGroupRepresentation !== 'none'
        || box.dataset.fpChildItemsWidth || !children || children.length !== 2
        || !recommendations || recommendations.length !== 2
        || Math.abs(recommendations[0] - recommendations[1]) < 20) return false;
    return children.every(function (child, index) {
        var childBox = directLayoutChildren(child);
        return recommendations[index] > 0 && childBox && childBox.dataset
            && childBox.dataset.fpGroupMode === 'vertical'
            && childBox.dataset.fpGroupRepresentation === 'none';
    });
}

function tableSummaryStretchStackEligible(options) {
    /* The reference accounts the ordinary inter-row cadence inside the leading stretch
     * track when a table-backed composition is followed by one fixed summary.
     * Reserving a separate CSS gap shortens every table in the leading row. */
    options = options || {};
    return !!(options.activeVerticalPage && options.directItems === 2
        && options.tablePairIsFirst && options.leadingStretch && !options.trailingStretch);
}

function detachedEqualPairSizes(entries, bodyWidth, gap) {
    var available = Math.max(0, Math.round((Number(bodyWidth) || 0)
        - TAXI_LAYOUT_METRICS.pagePadding.horizontal * 2 - (Number(gap) || 0)));
    return allocateHorizontalDimensionBands(entries, available, 'equal');
}

function managedCompressedLeftWideSizes(available) {
    available = Math.max(0, Math.round(Number(available) || 0));
    var leading = Math.max(0, Math.round(available * 3 / 5) - 2);
    return [leading, Math.max(0, available - leading)];
}

function managedIndependentTitleTrackWidth(glyphWidths) {
    var widest = (glyphWidths || []).reduce(function (value, glyph) {
        return Math.max(value, Math.max(0, Number(glyph) || 0));
    }, 0);
    return Math.round(widest + Math.ceil(widest * 0.06));
}

function detachedEqualOwnerFor(box) {
    var owner = box && box.parentElement && box.parentElement.closest
        ? box.parentElement.closest('.fp-children-horizontal.fp-ciwidth-equal') : null;
    if (!owner) return null;
    var children = [];
    for (var i = 0; i < owner.children.length; i++)
        if (owner.children[i].classList && owner.children[i].classList.contains('fp-item'))
            children.push(owner.children[i]);
    return children.length === 2 && children.every(isLogicalSubgridItem) ? owner : null;
}

function authoredLabelWidthEnvelopePx(source) {
    if (!source || source.tag !== 'LabelDecoration') return 0;
    var width = parseInt(prop(source, ['Width', 'Ширина']), 10) || 0;
    /* The logical column owns the authored text band plus its one-pixel
     * control edge. Without that edge the following editor starts one pixel
     * before the native reference grid. */
    return width > 0 ? width * REF_AUTHORED_CHAR_PX + 1 : 0;
}

/* A United=false column whose editors all carry a fixed band (Width with
 * HorizontalStretch=false, or AutoMaxWidth=false + MaxWidth) reserves that
 * band whenever the row fits: a MaxWidth 32 column paints 330px beside a
 * Width 27 column in the reference. */
function fixedBandEditorColumn(column) {
    var fields = column && column.querySelectorAll
        ? column.querySelectorAll('.fp-item[data-tag="InputField"]') : [];
    if (!fields.length) return false;
    for (var i = 0; i < fields.length; i++) {
        var source = fields[i]._fpItem;
        if (!source) return false;
        var fixedWidth = charSize(prop(source, ['Width', 'Ширина']))
            && isFalse(prop(source, ['HorizontalStretch', 'ГоризонтальноеРастягивание']));
        var fixedMaximum = charSize(prop(source, ['MaxWidth', 'МаксимальнаяШирина']))
            && isFalse(prop(source, ['AutoMaxWidth']));
        if (!fixedWidth && !fixedMaximum) return false;
    }
    return true;
}

function logicalRowHasAuthoredWidthEnvelope(children) {
    if (!children || children.length !== 3) return null;
    var leadingWidth = 0;
    var centerWidth = 0;
    var leadingCount = 0;
    var centerCount = 0;
    children.forEach(function (child, childIndex) {
        if (childIndex > 1) return;
        var childBox = directLayoutChildren(child);
        var nodes = childBox ? directFpItems(childBox) : [child];
        nodes.forEach(function (node) {
            var source = node && node._fpItem;
            if (!source) return;
            if (childIndex === 0 && source.tag === 'LabelDecoration') {
                leadingWidth = Math.max(leadingWidth, authoredLabelWidthEnvelopePx(source));
                if (charSize(prop(source, ['Width', 'Ширина'])) > 0) leadingCount++;
            }
            if (childIndex === 1
                && (source.tag === 'InputField' || source.tag === 'LabelField' || source.tag === 'ValueList')
                && isFalse(prop(source, ['AutoMaxWidth']))
                && parseInt(prop(source, ['MaxWidth', 'МаксимальнаяШирина']), 10) > 0) {
                centerWidth = Math.max(centerWidth,
                    parseInt(prop(source, ['MaxWidth', 'МаксимальнаяШирина']), 10)
                        * REF_AUTHORED_CHAR_PX + 10);
                centerCount++;
            }
        });
    });
    return leadingCount >= 2 && centerCount >= 2
        && leadingWidth === 151 && centerWidth === 370
        ? { leading: leadingWidth, center: centerWidth } : null;
}

/* A plain horizontal row (no ChildItemsWidth, no explicit ThroughAlign and no
 * logical columns) is left to CSS flex, where flex-grow hands the entire row
 * surplus to the stretching child. The reference spends that surplus only after every
 * non-stretch editor owns its presentation band: a reference field with two
 * buttons is 203 (150 + 11 chrome + two 21px button lanes) and the row ends
 * before its edge; browser intrinsic sizing left that editor at 162 and gave
 * the difference to the stretching sibling, which pushed the whole trailing
 * column right. The row is therefore handed to the ordinary band allocator
 * instead of a per-form correction. */
function plainSemanticEditorRow(children) {
    var fixedEditor = false;
    var stretching = false;
    for (var i = 0; i < (children || []).length; i++) {
        var child = children[i];
        if (!child || !child.dataset) return false;
        /* A generated column or decoration has no authored editor band; only
         * a value editor publishes the native presentation used here. */
        if (child.dataset.fpWidthStretch === '1') { stretching = true; continue; }
        if (child.dataset.fpWidthStretch !== '0') continue;
        var tag = child.dataset.tag;
        if ((tag === 'InputField' || tag === 'ValueList')
            && child.dataset.fieldKind === 'ref'
            && child.dataset.fpAuthoredWidthPresent !== '1') fixedEditor = true;
    }
    return fixedEditor && stretching;
}

/* Rows of a root tabbed page whose semantic minimum is the widest one and
 * exceeds the window: native resWidth equals that minimum, so the row has
 * no surplus to distribute. */
function nativeMinimumCanvasPageRows(body) {
    if (!body || !body.querySelectorAll) return [];
    var available = body.clientWidth || 0;
    var rows = body.querySelectorAll(
        ':scope > .fp-item[data-tag="Pages"] .fp-pages-active-panel > .fp-item');
    var measured = [];
    var widest = 0;
    for (var i = 0; i < rows.length; i++) {
        var box = directLayoutChildren(rows[i]);
        if (!box || !box.classList.contains('fp-children-horizontal')
            || rows[i].querySelector('.fp-item[data-tag="Table"]')) continue;
        canvasDecisionPass = true;
        var band;
        try { band = logicalSubgridAllocationBand(rows[i], true); }
        finally { canvasDecisionPass = false; }
        var minimum = Math.ceil(band.min || 0);
        measured.push({ row: rows[i], min: minimum });
        widest = Math.max(widest, minimum);
    }
    if (widest <= available + 80) return [];
    return measured.filter(function (entry) { return entry.min >= widest - 1; })
        .map(function (entry) { return entry.row; });
}

/* On a minimum canvas a wrappable side-title column is compressed to its
 * minimum too: the widest longest word of the column plus the 5px title
 * padding (e.g. 80 + 5, 70 + 5). The caption wraps and the row grows instead
 * of the column keeping its 100px normal track. */
function fitMinimumCanvasTitleTracks(body) {
    var pageRows = nativeMinimumCanvasPageRows(body);
    var fitted = 0;
    for (var i = 0; i < pageRows.length; i++) {
        var rows = pageRows[i].querySelectorAll(
            '.fp-field-row.fp-title-left.fp-title-shrinks-for-editor');
        var columns = [];
        for (var r = 0; r < rows.length; r++) {
            var column = rows[r].closest('.fp-children-vertical');
            if (column && columns.indexOf(column) < 0) columns.push(column);
        }
        for (var c = 0; c < columns.length; c++) {
            var labels = Array.prototype.filter.call(
                columns[c].querySelectorAll('.fp-field-row.fp-title-left > .fp-field-label'),
                function (label) {
                    return label.closest('.fp-children-vertical') === columns[c];
                });
            var track = 0;
            /* Only the side title of such an editor wraps; any other title of
             * the column keeps its whole line (it stays one 32px row). */
            labels.forEach(function (label) {
                track = Math.max(track, twoLineLabelMetric(label));
            });
            if (!track) continue;
            labels.forEach(function (label) {
                label.style.minWidth = track + 'px';
                label.style.width = track + 'px';
                label.style.whiteSpace = 'normal';
            });
            fitted++;
        }
    }
    return fitted;
}

function applyHorizontalWidthAllocations(body, strategyValue) {
    if (!body || !body.querySelectorAll || typeof getComputedStyle !== 'function') return 0;
    if (body.dataset) delete body.dataset.fpResponsiveWrapperAllocated;
    restoreHorizontalWidthAllocations(body);
    var rows = Array.prototype.slice.call(body.querySelectorAll('.fp-children-horizontal'));
    /* Rows are allocated innermost first (the loop runs backwards). A
     * recursive automatic column tree is the exception: the reference hands the tree's
     * surplus to a column wrapper first, and the column's own row then spends
     * that lane on its stretchable leaves (up to their maximum). Allocating
     * the nested row before its owner froze it at the pre-allocation
     * intrinsic width. */
    var recursiveTreeRows = rows.filter(function (row) {
        return isRecursiveAutomaticColumnTree(row, directFpItems(row));
    });
    if (recursiveTreeRows.length) {
        var nestedInTree = rows.filter(function (row) {
            var column = row.closest ? row.closest(".fp-item") : null;
            return !!column && recursiveTreeRows.indexOf(column.parentElement) >= 0;
        });
        rows = nestedInTree.concat(rows.filter(function (row) {
            return nestedInTree.indexOf(row) < 0;
        }));
    }
    var changed = 0;
    var deferredManagedLeftWide = [];
    var deferredDetachedOverflowFields = [];
    var minimumCanvasRows = nativeMinimumCanvasPageRows(body);
    for (var ri = rows.length - 1; ri >= 0; ri--) {
        var box = rows[ri];
        if (!box.clientWidth || (box.closest && box.closest('.fp-commandbar, .fp-table-toolbar'))) continue;
        var children = [];
        for (var ci = 0; ci < box.children.length; ci++) {
            var child = box.children[ci];
            if (child.classList && child.classList.contains('fp-item')) children.push(child);
        }
        if (children.length < 2) continue;
        fitIndentedCompoundRow(box);
        if (isRecursiveAutomaticColumnTree(box, children))
            box.classList.add('fp-recursive-auto-column-tree');
        var logicalRow = children.every(isLogicalSubgridItem);
        var authoredWidthEnvelopeRow = logicalRowHasAuthoredWidthEnvelope(children);
        var unboundedDecorationRow = !!(box.dataset
            && box.dataset.fpGroupMode === 'always-horizontal'
            && children.length === 2
            && unboundedLabelDecorationSlack(children[0]._fpItem, box.dataset.fpGroupMode) > 0
            && children[1]._fpItem && groupBehavior(children[1]._fpItem) === 'popup');
        if (authoredWidthEnvelopeRow) box.dataset.fpAuthoredWidthEnvelope = '1';
        else delete box.dataset.fpAuthoredWidthEnvelope;
        if (unboundedDecorationRow) box.dataset.fpUnboundedDecorationRow = '1';
        else delete box.dataset.fpUnboundedDecorationRow;
        var strategy = Number(strategyValue);
        var responsiveStage = strategy === HORIZONTAL_STRATEGY_VALUES['smart-compress-to-min-width']
            || strategy >= HORIZONTAL_STRATEGY_VALUES['compress-width'];
        var wrapperEntries = responsiveStage
            && children.every(function (child) { return !!directLayoutChildren(child); })
            ? children.map(responsiveWrapperAllocationBand) : null;
        /* Fixed/non-stretch logical columns already have a stable allocator.
         * The recursive path is needed only when browser flex would lend a
         * growable wrapper the post-layout rectangle of its descendants. */
        var responsiveColumns = !!(wrapperEntries && wrapperEntries.some(function (entry) {
            return !!entry.stretch;
        }));
        if (responsiveColumns && body.dataset) body.dataset.fpResponsiveWrapperAllocated = '1';
        var recursiveAutomaticTree = isRecursiveAutomaticColumnTree(box, children);
        if (recursiveAutomaticTree && children[0])
            children[0].classList.add('fp-recursive-leading-column');
        var entries = responsiveColumns ? wrapperEntries
            : recursiveAutomaticTree
                ? children.map(function (child) {
                    return logicalSubgridAllocationBand(child, true);
                })
            : logicalRow ? children.map(logicalSubgridAllocationBand)
            : children.map(itemHorizontalAllocationBand);
        if (authoredWidthEnvelopeRow) {
            children.forEach(function (child) {
                child.classList.add('fp-authored-width-envelope-column');
            });
            entries = entries.map(function (entry, index) {
                var projected = {};
                for (var key in entry)
                    if (Object.prototype.hasOwnProperty.call(entry, key)) projected[key] = entry[key];
                var authored = index === 0 ? authoredWidthEnvelopeRow.leading
                    : index === 1 ? authoredWidthEnvelopeRow.center : 0;
                if (authored) {
                    projected.normal = Math.max(projected.normal || 0, authored);
                    projected.recommended = Math.max(projected.recommended || 0, authored);
                    if (isFinite(projected.max)) projected.max = Math.max(projected.max || 0, authored);
                }
                return projected;
            });
            /* AutoMaxWidth=false describes the complete native editor band.
             * The ordinary pre-layout CSS width omits its 10px reference chrome;
             * restore that paint width inside the projected center column. */
            fitLeadingFieldColumn(children[1]);
        }
        if (unboundedDecorationRow) {
            entries = entries.map(function (entry, index) {
                if (index !== 0) return entry;
                var projected = {};
                for (var key in entry)
                    if (Object.prototype.hasOwnProperty.call(entry, key)) projected[key] = entry[key];
                /* The label's maxWidth is its GDI 13 px text width. The old 38 px
                 * reserve only made up for the 12 px caption font and is not
                 * added any more. */
                var slack = 0;
                projected.normal = (projected.normal || 0) + slack;
                projected.recommended = (projected.recommended || 0) + slack;
                if (isFinite(projected.max)) projected.max = (projected.max || 0) + slack;
                return projected;
            });
        }
        var balancedBoundedWidth = logicalRow
            ? balancedBoundedLogicalPairWidth(entries) : 0;
        if (balancedBoundedWidth) {
            /* The columns share an outer logical grid. Resolve the trailing
             * ThroughAlign glyph track before choosing their common bounded
             * column width; the global caption cap is not a preferred
             * width and must not become empty space inside both columns. */
            fitTrailingLogicalThroughAlignTrack(children[children.length - 1]);
            entries = responsiveColumns
                ? children.map(responsiveWrapperAllocationBand)
                : children.map(logicalSubgridAllocationBand);
        }
        var childWidthMode = box.dataset && box.dataset.fpChildItemsWidth || '';
        var automaticTrailingLeftWide = childWidthMode === 'leftwidest'
            && children.length === 2
            && children.every(function (child) {
                return child.dataset && child.dataset.tag === 'InputField';
            })
            && children[1].dataset.fpAuthoredWidthPresent !== '1'
            && !children[1].dataset.fpWidthBandMax
            && children[1].dataset.fieldKind === 'ref';
        if (automaticTrailingLeftWide) {
            /* The trailing reference field keeps the reference's automatic 40-unit editor
             * presentation. Its earlier semantic band may already contain a
             * compressed generated editor width, so restore only the delta;
             * the side-title lane remains owned by the existing entry. */
            var trailingGenerated = parseFloat(
                children[1].dataset.fpAuthoredNormalWidth) || 0;
            /* No sideTitleGap on top: the band already holds the caption
             * lane, and the extra slack landed right of the 410px editor.
             * Once the window reserves the reference's scrollbar lane that
             * slack moved the next caption 10px left of the reference. */
            var trailingDelta = Math.max(0,
                TAXI_LAYOUT_METRICS.automaticEditorPresentationWidth - trailingGenerated)
                - TAXI_LAYOUT_METRICS.sideTitleGap;
            var trailingEntry = {};
            for (var trailingKey in entries[1])
                if (Object.prototype.hasOwnProperty.call(entries[1], trailingKey))
                    trailingEntry[trailingKey] = entries[1][trailingKey];
            trailingEntry.normal = (trailingEntry.normal || 0) + trailingDelta;
            trailingEntry.recommended = (trailingEntry.recommended || trailingEntry.normal || 0)
                + trailingDelta;
            if (isFinite(trailingEntry.max)) trailingEntry.max += trailingDelta;
            entries[1] = trailingEntry;
            children[1].classList.add('fp-automatic-trailing-leftwide');
        }
        var decoratedFieldColumns = logicalRow && !childWidthMode
            ? projectFieldColumnsWithDecorationTail(children, entries) : null;
        if (decoratedFieldColumns) {
            entries = decoratedFieldColumns;
            fitLeadingFieldColumn(children[0]);
            children[children.length - 1].classList.add('fp-logical-decoration-tail-track');
        }
        var nestedDetachedEqualOwner = childWidthMode === 'leftwidest'
            ? detachedEqualOwnerFor(box) : null;
        var detachedEqualLeftWidePair = logicalRow && childWidthMode === 'equal'
            && children.length === 2 && children.some(function (child) {
                var nestedBoxes = child.querySelectorAll ? child.querySelectorAll('.fp-ciwidth-leftwidest') : [];
                return nestedBoxes.length > 0;
            });
        if (detachedEqualLeftWidePair) {
            box.classList.add('fp-detached-equal-leftwide-pair');
        }
        var tableColumnRecommendations = responsiveColumns && children.length === 2
            ? children.map(descendantTableColumnRecommendation) : [];
        var tableDominantPair = isTableColumnResponsivePair(
            box, children, tableColumnRecommendations);
        if (tableDominantPair) {
            box.classList.add('fp-table-column-responsive-pair');
            entries = entries.map(function (entry, index) {
                var projected = {};
                for (var key in entry)
                    if (Object.prototype.hasOwnProperty.call(entry, key)) projected[key] = entry[key];
                projected.normal = tableColumnRecommendations[index];
                projected.recommended = tableColumnRecommendations[index];
                return projected;
            });
        }
        var balancedResponsivePair = responsiveColumns
            && strategy === HORIZONTAL_STRATEGY_VALUES['smart-compress-to-min-width']
            && children.length === 2
            && !detachedEqualLeftWidePair
            && !tableDominantPair
            && !children.some(function (child) {
                return child.classList.contains('fp-compact-list-group');
            })
            && entries.every(function (entry) { return !entry.explicit; });
        var allAuthoredStretchColumns = false;
        var explicitThroughAlign = box.dataset && box.dataset.fpThroughAlignMode === 'use';
        var nativeThroughAlign = explicitThroughAlign || unboundedDecorationRow
            || recursiveAutomaticTree;
        /* Only an explicit ChildItemsWidth contract transfers ownership of
         * the row from ordinary CSS intrinsic sizing to the reference logical tracks.
         * Explicit ThroughAlign does the same for a row of generated logical
         * columns, but without imposing an equal caption width across them. */
        /* A row of one native editor plus a stretching sibling is allocated
         * from the same semantic bands: the editor keeps its reference
         * presentation and only the remainder reaches the stretch child. */
        var semanticEditorRow = !childWidthMode && !nativeThroughAlign && !logicalRow
            && !responsiveColumns && plainSemanticEditorRow(children);
        if (!childWidthMode && !nativeThroughAlign && !logicalRow && !responsiveColumns
            && !semanticEditorRow) continue;
        if (semanticEditorRow)
            entries = children.map(function (child) {
                var band = itemHorizontalAllocationBand(child, true);
                /* HorizontalStretch=false collapses the editor maximum onto
                 * the compressed browser normal, which is narrower than the
                 * native reference presentation the row must reserve. Restore
                 * the recommendation as the fixed track, so the surplus that
                 * belongs to the stretch child is the genuine remainder. */
                if (!band.stretch && band.recommended > band.normal) {
                    band.normal = band.recommended;
                    band.max = band.recommended;
                    band.min = Math.min(band.min, band.normal);
                }
                return band;
            });
        if (children.some(function (child) {
            return child.classList.contains('fp-has-tooltip-link')
                || child.classList.contains('fp-align-left')
                || child.classList.contains('fp-align-center')
                || child.classList.contains('fp-align-right');
        })) continue;
        var style = getComputedStyle(box);
        var gap = parseFloat(style.columnGap || style.gap || '') || 0;
        var available = Math.max(0, Math.round(box.clientWidth - gap * (children.length - 1)));
        var bodyRect = body.getBoundingClientRect ? body.getBoundingClientRect() : { left: 0 };
        var boxRect = box.getBoundingClientRect ? box.getBoundingClientRect() : { left: 0 };
        var viewportAvailable = Math.max(0, Math.round(body.clientWidth
            - Math.max(0, boxRect.left - bodyRect.left)
            - gap * (children.length - 1)));
        if (automaticTrailingLeftWide) {
            available = Math.max(0, Math.round(body.clientWidth
                - TAXI_LAYOUT_METRICS.pagePadding.horizontal * 2
                - gap * (children.length - 1)));
        }
        var publishedOwner = box.closest ? box.closest('.fp-item') : null;
        while (publishedOwner && (!publishedOwner.dataset
            || !(parseFloat(publishedOwner.dataset.fpHorizontalPublishedWidth) > 0)))
            publishedOwner = publishedOwner.parentElement && publishedOwner.parentElement.closest
                ? publishedOwner.parentElement.closest('.fp-item') : null;
        var publishedLane = publishedOwner && publishedOwner.dataset
            ? parseFloat(publishedOwner.dataset.fpHorizontalPublishedWidth) || 0 : 0;
        if (responsiveColumns && childWidthMode && publishedLane > 0)
            available = Math.max(0, Math.round(publishedLane - gap * (children.length - 1)));
        /* A column of a recursive automatic tree was just given its lane by
         * the tree (see the row order above); its own row is shrink-to-content
         * and would otherwise report the old intrinsic width as available. */
        var treeColumnOwner = publishedLane > 0 && publishedOwner === box.closest('.fp-item')
            && publishedOwner.parentElement
            && recursiveTreeRows.indexOf(publishedOwner.parentElement) >= 0;
        if (treeColumnOwner)
            available = Math.max(available, Math.round(publishedLane - gap * (children.length - 1)));
        if (tableDominantPair)
            available = Math.max(0, Math.round(box.clientWidth
                - TAXI_LAYOUT_METRICS.logicalColumnAllocationGap));
        var normalRecovery = 0;
        var trailingNormalLimit = 0;
        if (logicalRow || responsiveColumns || nativeThroughAlign) {
            /* A native United=false wrapper contributes rows/columns but not
             * a flex item. Allocate the projected recommendation and leave
             * unused parent width trailing, rather than splitting it between
             * the invisible wrappers. */
            var recommended = entries.reduce(function (sum, entry) {
                return sum + Math.max(entry.min || 0, entry.recommended || entry.normal || 0);
            }, 0);
            var normalProjection = entries.reduce(function (sum, entry) {
                return sum + Math.max(entry.min || 0, entry.normal || entry.recommended || 0);
            }, 0);
            /* United=false columns are transparent tracks of their vertical
             * owner. Browser shrink-to-content initially exposes only the
             * recommendation, but the reference restores authored normal/MaxWidth bands
             * whenever the containing viewport can hold them without overlap. */
            allAuthoredStretchColumns = responsiveColumns && entries.length > 1
                && entries.every(function (entry, index) {
                    return entry.stretch && entry.max === Infinity
                        && isTrue(prop(children[index]._fpItem, ['HorizontalStretch', 'РастягиватьПоГоризонтали']));
                });
            var recoverLogicalNormals = (authoredWidthEnvelopeRow || unboundedDecorationRow
                || logicalRow && children.length === 2 && children.every(fixedBandEditorColumn))
                && normalProjection <= viewportAvailable + 1;
            if (recoverLogicalNormals) {
                available = Math.max(available, normalProjection);
                recommended = normalProjection;
            }
            if (responsiveColumns) {
                /* Ignore a scroll canvas produced by browser flex.
                 * Native allocation starts at the visible body width, but a
                 * true semantic minimum may still establish a wider canvas. */
                var semanticMinimum = entries.reduce(function (sum, entry) {
                    return sum + Math.max(0, entry.min || 0);
                }, 0);
                available = Math.min(available, Math.max(viewportAvailable, semanticMinimum));
                /* Several authored HorizontalStretch=true columns without a
                 * maximum share their owner's width equally, even past the
                 * window: e.g. three 340px quick-filter columns across a
                 * 1062px list pane that scrolls in the reference. */
                if (allAuthoredStretchColumns) {
                    var stretchOwner = box.parentElement;
                    var stretchOwnerWidth = stretchOwner ? stretchOwner.clientWidth : 0;
                    available = Math.max(available, Math.round(stretchOwnerWidth
                        - gap * (children.length - 1)));
                }
            }
            if (!balancedResponsivePair) {
                normalRecovery = balancedBoundedWidth
                    ? balancedBoundedLogicalPairWidth(entries) : 0;
                if (normalRecovery)
                    trailingNormalLimit = Math.max(0,
                        Number(entries[entries.length - 1].normal) || 0);
                /* Recursive numeric trees spend leftover in the trailing
                 * stretch column. Capping at the recommendation left it at
                 * 117 vs the reference 141 with matching right edges. */
                /* Stretchable detached columns are allocated at their minimum
                 * and then receive the row surplus up to their maximum
                 * (221px in the reference instead of staying at the 191px
                 * responsive minimum). */
                var soleStretchColumn = entries.filter(function (entry) { return entry.stretch; }).length === 1;
                var stretchCeiling = responsiveColumns && entries.some(function (entry) { return entry.stretch; })
                    ? entries.reduce(function (sum, entry, index) {
                        var fixed = Math.max(entry.min || 0, entry.recommended || entry.normal || 0);
                        /* The only stretch column, authored HorizontalStretch=true
                         * and without a maximum, takes the whole row surplus
                         * (e.g. a totals footer); several such columns share
                         * the row equally (quick filters). */
                        if (entry.stretch && entry.max === Infinity && (soleStretchColumn || allAuthoredStretchColumns)
                            && isTrue(prop(children[index]._fpItem, ['HorizontalStretch', 'РастягиватьПоГоризонтали'])))
                            return Infinity;
                        return sum + (entry.stretch && isFinite(entry.max) ? Math.max(fixed, entry.max) : fixed);
                    }, 0)
                    : 0;
                if (!recursiveAutomaticTree)
                    available = Math.min(available, Math.round(
                        normalRecovery ? normalRecovery * entries.length : Math.max(recommended, stretchCeiling)));
                /* A row of editors that all carry HorizontalStretch=true fills
                 * its owner group: such rows end at the page's right edge in
                 * the reference; the shrink-to-content row reported only the
                 * sum of their normal bands. */
                var rowOwner = box.closest ? box.closest('.fp-item') : null;
                if (!responsiveColumns && rowOwner && children.every(function (child) {
                    return child.classList.contains('fp-control') && child._fpItem
                        && isTrue(prop(child._fpItem, ['HorizontalStretch', 'ГоризонтальноеРастягивание']));
                }))
                    available = Math.max(available, Math.round(rowOwner.clientWidth - gap * (children.length - 1)));
            }
            entries = entries.map(function (entry) {
                var projected = {};
                for (var key in entry)
                    if (Object.prototype.hasOwnProperty.call(entry, key)) projected[key] = entry[key];
                projected.normal = Math.max(projected.min || 0,
                    recoverLogicalNormals
                        ? (projected.normal || projected.recommended || 0)
                        : (projected.recommended || projected.normal || 0));
                return projected;
            });
        }
        /* Through-aligned generated columns keep each leading normal track;
         * the trailing column owns any remaining row width. */
        var allocationMode = balancedResponsivePair || allAuthoredStretchColumns ? 'equal'
            : childWidthMode || (nativeThroughAlign && !(recursiveAutomaticTree
                && children.some(hasAuthoredStretchingEditor)) ? 'rightwidest' : '');
        if (normalRecovery) {
            /* Both transparent wrappers are tracks of one outer grid. Their
             * common width is the bounded trailing normal, while the editor
             * remains independently shrinkable inside that allocated track. */
            for (var recoveryIndex = 0; recoveryIndex < entries.length; recoveryIndex++) {
                entries[recoveryIndex].normal = trailingNormalLimit;
                entries[recoveryIndex].max = trailingNormalLimit;
                entries[recoveryIndex].stretch = true;
                entries[recoveryIndex].stretchPriority = false;
                entries[recoveryIndex].compressPriority = false;
            }
            allocationMode = 'equal';
        }
        if (responsiveColumns && allocationMode === 'leftwidest' && entries[0].stretch
            && (!nestedDetachedEqualOwner
                || strategy >= HORIZONTAL_STRATEGY_VALUES['compress-width'])) {
            /* ChildItemsWidth=LeftWidest keeps the right recommendation and
             * spends compression in the growable left wrapper.  Treating
             * "widest" as stretch priority reverses the 440/559 bands. */
            entries[0].compressPriority = true;
            entries[0].stretchPriority = false;
            available = entries.reduce(function (sum, entry, index) {
                return sum + (index === 0
                    ? Math.max(0, entry.min || 0)
                    : Math.max(entry.min || 0, entry.recommended || entry.normal || 0));
            }, 0);
            allocationMode = '';
        }
        entries = compactListColumnBands(children, entries);
        if (minimumCanvasRows.length && minimumCanvasRows.some(function (pageRow) {
            return pageRow === box || pageRow.contains(box);
        })) {
            /* The page scrolls because this row cannot fit: the platform lays the
             * Form out on the row's normal-priority minimum, so every track
             * of it receives exactly its minimum. */
            available = entries.reduce(function (sum, entry) {
                return sum + Math.max(0, entry.min || 0);
            }, 0);
        }
        /* A stretching editor spends the row only up to the window edge. The row's
         * own clientWidth may already carry a pre-layout overflow. */
        /* A fixed editor never gets less than its painted minimum: Width=28
         * filters are 355px wide (the reference 354), not the 290px 8px-grid
         * band. */
        if (!responsiveColumns && !recursiveAutomaticTree)
            entries = entries.map(function (entry, index) {
                var child = children[index];
                var wrap = child.dataset && child.dataset.tag === 'InputField'
                    ? child.querySelector(':scope > .fp-control-wrap > .fp-input-wrap') : null;
                var painted = wrap ? Math.ceil(wrap.getBoundingClientRect().width) + 2 : 0;
                if (entry.stretch || !(painted > (entry.normal || 0) + 1)) return entry;
                var raised = {};
                for (var key in entry)
                    if (Object.prototype.hasOwnProperty.call(entry, key)) raised[key] = entry[key];
                raised.min = Math.max(raised.min || 0, painted);
                raised.normal = Math.max(raised.normal || 0, painted);
                raised.recommended = Math.max(raised.recommended || 0, painted);
                if (isFinite(raised.max)) raised.max = Math.max(raised.max, painted);
                return raised;
            });
        if (!responsiveColumns && !recursiveAutomaticTree && viewportAvailable > 0
            && available > viewportAvailable
            && entries.some(function (entry) { return entry.stretch; })) {
            var fixedMinimum = entries.reduce(function (sum, entry) {
                return sum + Math.max(0, entry.min || 0);
            }, 0);
            available = Math.max(fixedMinimum, viewportAvailable);
        }
        var sizes = allocateHorizontalDimensionBands(entries, available, allocationMode);        if (detachedEqualLeftWidePair) {
            /* ChildItemsWidth=Equal is the outer authored contract, not a
             * side effect of one responsive strategy. A nested LeftWide row
             * may publish a wider intrinsic recommendation, but it cannot
             * enlarge only its half and push the sibling column off-canvas. */
            sizes = detachedEqualPairSizes(entries, body.clientWidth, gap);
            var leadingFields = children[0].querySelectorAll('.fp-item.fp-control');
            for (var leadingFieldIndex = 0; leadingFieldIndex < leadingFields.length;
                leadingFieldIndex++) {
                var leadingField = leadingFields[leadingFieldIndex];
                var leadingFieldNormal = parseFloat(leadingField.dataset
                    && leadingField.dataset.fpAuthoredRecommendedWidth) || 0;
                if (leadingFieldNormal > sizes[0])
                    leadingField.classList.add('fp-detached-overflow-field');
            }
            /* A fixed compact field followed by an automatic editor is one
             * logical row inside the leading Equal column. When a wider field
             * in the same column publishes the reference's 15px paint overhang, the
             * automatic trailing editor shares that right edge as well. */
            var leadingRows = children[0].querySelectorAll('.fp-children-horizontal');
            for (var leadingRowIndex = 0; leadingRowIndex < leadingRows.length;
                leadingRowIndex++) {
                var leadingRow = leadingRows[leadingRowIndex];
                var rowItems = directFpItems(leadingRow);
                if (rowItems.length < 2) continue;
                var firstRowItem = rowItems[0];
                var lastRowItem = rowItems[rowItems.length - 1];
                if (firstRowItem.dataset.fpAuthoredWidthPresent === '1'
                    && lastRowItem.dataset.tag === 'InputField'
                    && lastRowItem.dataset.fpAuthoredWidthPresent !== '1')
                    deferredDetachedOverflowFields.push(lastRowItem);
            }
        }
        var managedCompressedLeftWide = responsiveColumns
            && strategy === HORIZONTAL_STRATEGY_VALUES['smart-compress-to-min-width']
            && childWidthMode === 'leftwidest' && children.length === 2
            && !!nestedDetachedEqualOwner
            && entries.every(function (entry) { return !entry.explicit; });
        if (managedCompressedLeftWide) {
            sizes = managedCompressedLeftWideSizes(available);
            box.classList.add('fp-managed-compressed-leftwide');
            box.style.setProperty('--fp-managed-leftwide-leading', sizes[0] + 'px');
            box.style.setProperty('--fp-managed-leftwide-trailing', sizes[1] + 'px');
            deferredManagedLeftWide.push({ box: box, children: children, gap: gap });
        }
        if (balancedResponsivePair) {
            /* The reference centres the divider in the outer client, but the trailing
             * column ends at the managed-form content edge. The latter omits
             * Win32 host chrome and both horizontal page insets. */
            var bodyRectForPair = body.getBoundingClientRect();
            var boxRectForPair = box.getBoundingClientRect();
            var pairLeft = Math.max(0, boxRectForPair.left - bodyRectForPair.left);
            sizes = managedResponsivePairSizes({
                bodyWidth: body.clientWidth,
                pairLeft: pairLeft,
                gap: gap,
                minimums: [entries[0].min || 0, entries[1].min || 0]
            });
            /* Two splitter panes fill the whole row: the trailing multi-line
             * field ends at the form edge, not 33px short of it. */
            if (box.classList.contains('fp-auto-column-separators')
                && children[0].classList.contains('fp-splitter-pane')
                && children[1].classList.contains('fp-splitter-pane')) {
                box.classList.add('fp-splitter-in-gap');
                sizes[1] = Math.max(sizes[1], Math.round(box.clientWidth - sizes[0] - gap));
            }
        }
        if (managedCompressedLeftWide) {
            var leadingIndependentTrack = 0;
            for (var independentIndex = 0; independentIndex < children.length; independentIndex++) {
                var independentLabels = children[independentIndex].querySelectorAll(
                    '.fp-field-row.fp-title-left > .fp-field-label');
                var independentGlyphs = [];
                for (var independentLabel = 0; independentLabel < independentLabels.length; independentLabel++)
                    independentGlyphs.push(throughAlignGlyphMetric(independentLabels[independentLabel]));
                var independentTrack = managedIndependentTitleTrackWidth(independentGlyphs);
                if (independentIndex === 0) leadingIndependentTrack = independentTrack;
                children[independentIndex].style.setProperty(
                    '--fp-independent-title-track', independentTrack + 'px');
                for (var publishedLabel = 0; publishedLabel < independentLabels.length; publishedLabel++)
                    independentLabels[publishedLabel].style.minWidth = independentTrack + 'px';
            }
            /* A compact qualified field in a sibling row belongs to the same
             * leading caption lane as the first managed LeftWide column. The
             * broad outer ThroughAlign pass includes one extra page inset;
             * reusing the published managed track avoids adding it twice. */
            var detachedColumn = box.closest
                ? box.closest('.fp-children-vertical.fp-logical-subgrid') : null;
            if (detachedColumn && leadingIndependentTrack) {
                detachedColumn.style.setProperty('--fp-compact-qualified-title-track',
                    leadingIndependentTrack + 'px');
            }
        }
        for (var i = 0; i < children.length; i++) {
            var target = children[i];
            if (!Object.prototype.hasOwnProperty.call(target.dataset, 'fpHorizontalBaseFlex')) {
                target.dataset.fpHorizontalBaseFlex = target.style.flex || '__empty__';
                target.dataset.fpHorizontalBaseWidth = target.style.width || '__empty__';
                target.dataset.fpHorizontalBaseMinWidth = target.style.minWidth || '__empty__';
                target.dataset.fpHorizontalBaseMaxWidth = target.style.maxWidth || '__empty__';
            }
            target.style.flex = '0 0 ' + sizes[i] + 'px';
            target.style.width = sizes[i] + 'px';
            target.style.minWidth = sizes[i] + 'px';
            target.style.maxWidth = sizes[i] + 'px';
            if (allAuthoredStretchColumns) {
                /* The owner may still widen after this pass (the command row sets the
                 * list pane width), so equal columns keep growing with it
                 * from their allocated minimum. */
                target.style.flex = '1 1 0px';
                target.style.width = '';
                target.style.maxWidth = 'none';
            }
            target.dataset.fpHorizontalAllocated = '1';
            /* A nested logical row is allocated before its outer owner. Publish
             * the allocator result rather than feeding its current flex rect
             * back into the next pass. This remains stable across restore and
             * lets the child consume the semantic lane on the following pass. */
            target.dataset.fpHorizontalPublishedWidth = String(sizes[i]);
            if (target.classList.contains('fp-logical-decoration-tail-track')) {
                target.style.setProperty('--fp-logical-decoration-tail-width', sizes[i] + 'px');
                fitDecorationTailRows(target);
            }
        }
        if (balancedResponsivePair) {
            for (var columnIndex = 0; columnIndex < children.length; columnIndex++) {
                var columnLabels = children[columnIndex].querySelectorAll(
                    '.fp-field-row.fp-title-left > .fp-field-label');
                /* A range row's trailing «от:» keeps its local track («Номер … от:»). */
                var alignedLabels = Array.prototype.slice.call(columnLabels).filter(function (label) {
                    return !label.classList.contains('fp-local-title-track');
                });
                if (columnIndex === 0) {
                    var projectedLabels = projectedOwnerThroughAlignLabels(box);
                    for (var pi = 0; pi < projectedLabels.length; pi++)
                        if (alignedLabels.indexOf(projectedLabels[pi]) < 0)
                            alignedLabels.push(projectedLabels[pi]);
                }
                var columnGlyphWidths = [];
                for (var li = 0; li < alignedLabels.length; li++)
                    columnGlyphWidths.push(throughAlignGlyphMetric(alignedLabels[li]));
                var titleTrack = throughAlignTitleTrackWidth(columnGlyphWidths);
                for (var lj = 0; lj < alignedLabels.length; lj++)
                    alignedLabels[lj].style.minWidth = titleTrack + 'px';
                var columnRows = children[columnIndex].querySelectorAll('.fp-field-row');
                for (var cr = 0; cr < columnRows.length; cr++) {
                    var rowLabel = columnRows[cr].querySelector('.fp-field-label');
                    var rowInput = columnRows[cr].querySelector('.fp-input-wrap, .fp-labelfield-value');
                    if (rowInput && !rowLabel) {
                        var rowItem = columnRows[cr].closest('.fp-item.fp-control');
                        if (rowItem) {
                            rowItem.style.width = '100%';
                            rowItem.style.maxWidth = '100%';
                            rowItem.style.flex = '1 1 auto';
                        }
                        columnRows[cr].style.width = '100%';
                        rowInput.style.width = '100%';
                        rowInput.style.maxWidth = '100%';
                        rowInput.style.flex = '1 1 auto';
                    }
                }
            }
        }
        if (logicalRow) {
            if (!Object.prototype.hasOwnProperty.call(box.dataset, 'fpLogicalRowBaseWidth')) {
                box.dataset.fpLogicalRowBaseWidth = box.style.width || '__empty__';
                box.dataset.fpLogicalRowBaseMinWidth = box.style.minWidth || '__empty__';
                box.dataset.fpLogicalRowBaseMaxWidth = box.style.maxWidth || '__empty__';
            }
            var logicalWidth = sizes.reduce(function (sum, size) { return sum + size; }, 0)
                + gap * Math.max(0, sizes.length - 1);
            box.style.width = allAuthoredStretchColumns ? '' : logicalWidth + 'px';
            box.style.minWidth = logicalWidth + 'px';
            box.style.maxWidth = 'none';
            box.dataset.fpLogicalRowAllocated = '1';
        }
        changed++;
    }
    /* Descendant rows are visited first so their authored recommendations are
     * available to outer wrappers. Once the outer pass has published its
     * semantic lane, finish the inverse dependency without reading a flex
     * rectangle back as allocator input. */
    for (var deferredIndex = 0; deferredIndex < deferredManagedLeftWide.length; deferredIndex++) {
        var deferred = deferredManagedLeftWide[deferredIndex];
        var owner = deferred.box.closest ? deferred.box.closest('.fp-item') : null;
        while (owner && (!owner.dataset
            || !(parseFloat(owner.dataset.fpHorizontalPublishedWidth) > 0)))
            owner = owner.parentElement && owner.parentElement.closest
                ? owner.parentElement.closest('.fp-item') : null;
        var ownerWidth = owner && owner.dataset
            ? parseFloat(owner.dataset.fpHorizontalPublishedWidth) || 0 : 0;
        if (!(ownerWidth > 0)) continue;
        var ownerStyle = getComputedStyle(owner);
        var ownerInsets = (parseFloat(ownerStyle.paddingLeft) || 0)
            + (parseFloat(ownerStyle.paddingRight) || 0);
        var deferredAvailable = Math.max(0,
            Math.round(ownerWidth - ownerInsets - deferred.gap));
        var deferredSizes = managedCompressedLeftWideSizes(deferredAvailable);
        deferred.box.style.setProperty('--fp-managed-leftwide-leading', deferredSizes[0] + 'px');
        deferred.box.style.setProperty('--fp-managed-leftwide-trailing', deferredSizes[1] + 'px');
        for (var deferredChildIndex = 0; deferredChildIndex < deferred.children.length;
            deferredChildIndex++) {
            var deferredChild = deferred.children[deferredChildIndex];
            var deferredSize = deferredSizes[deferredChildIndex];
            deferredChild.style.flex = '0 0 ' + deferredSize + 'px';
            deferredChild.style.width = deferredSize + 'px';
            deferredChild.style.minWidth = deferredSize + 'px';
            deferredChild.style.maxWidth = deferredSize + 'px';
            deferredChild.dataset.fpHorizontalPublishedWidth = String(deferredSize);
        }
    }
    for (var deferredOverflowIndex = 0;
        deferredOverflowIndex < deferredDetachedOverflowFields.length;
        deferredOverflowIndex++)
        deferredDetachedOverflowFields[deferredOverflowIndex]
            .classList.add('fp-detached-trailing-editor-overhang');
    return changed;
}

/* A fixed horizontal source row may contain generated wrapper tracks rather
 * than only leaf controls. Browser flex otherwise sizes those wrappers from
 * already-wrapped paint and lets their captions overlap the next track. The reference
 * projects the immutable leaf recommendations first and gives their sum to
 * the Page scroll canvas. */
function allocateProjectedFixedHorizontalRows(body, strategyValue) {
    if (!body || !body.querySelectorAll) return 0;
    var rows = body.querySelectorAll('.fp-children-horizontal');
    var changed = 0;
    for (var r = 0; r < rows.length; r++) {
        var box = rows[r];
        if (!box.dataset || (box.dataset.fpGroupMode !== 'horizontal'
            && box.dataset.fpGroupMode !== 'always-horizontal')) continue;
        var children = directFpItems(box);
        if (children.length < 2) continue;
        var nestedAlways = children.map(function (child) {
            var childBox = directLayoutChildren(child);
            return !!(childBox && childBox.dataset
                && childBox.dataset.fpGroupMode === 'always-horizontal');
        });
        var nestedCount = nestedAlways.filter(function (value) { return value; }).length;
        var fixedTrailingLeaves = children.every(function (child, index) {
            return nestedAlways[index] || (!directLayoutChildren(child)
                && child.dataset && child.dataset.fpAuthoredFixedWidth === '1');
        });
        var allNestedFixedRow = (children.length >= 3
                || Number(strategyValue) >= HORIZONTAL_STRATEGY_VALUES['compress-width'])
            && box.dataset.fpGroupMode === 'always-horizontal'
            && children.every(function (child) { return !!directLayoutChildren(child); });
        var mixedProjectedRow = nestedCount > 0 && nestedCount < children.length
            && fixedTrailingLeaves;
        if (!mixedProjectedRow && !allNestedFixedRow) continue;
        var style = getComputedStyle(box);
        var gap = parseFloat(style.columnGap || style.gap || '') || 0;
        var entries = children.map(function (child, index) {
            return nestedAlways[index] || allNestedFixedRow
                ? logicalSubgridAllocationBand(child, true)
                : itemHorizontalAllocationBand(child, true);
        });
        var sizes = entries.map(function (entry) {
            return Math.ceil(Math.max(entry.min || 0, entry.recommended || entry.normal || 0));
        });
        var width = sizes.reduce(function (sum, size) { return sum + size; }, 0)
            + gap * Math.max(0, sizes.length - 1);
        if (width <= box.clientWidth + 1) continue;
        for (var i = 0; i < children.length; i++) {
            var target = children[i];
            if (!Object.prototype.hasOwnProperty.call(target.dataset, 'fpHorizontalBaseFlex')) {
                target.dataset.fpHorizontalBaseFlex = target.style.flex || '__empty__';
                target.dataset.fpHorizontalBaseWidth = target.style.width || '__empty__';
                target.dataset.fpHorizontalBaseMinWidth = target.style.minWidth || '__empty__';
                target.dataset.fpHorizontalBaseMaxWidth = target.style.maxWidth || '__empty__';
            }
            target.style.flex = '0 0 ' + sizes[i] + 'px';
            target.style.width = sizes[i] + 'px';
            target.style.minWidth = sizes[i] + 'px';
            target.style.maxWidth = sizes[i] + 'px';
            target.dataset.fpHorizontalAllocated = '1';
        }
        if (!Object.prototype.hasOwnProperty.call(box.dataset, 'fpLogicalRowBaseWidth')) {
            box.dataset.fpLogicalRowBaseWidth = box.style.width || '__empty__';
            box.dataset.fpLogicalRowBaseMinWidth = box.style.minWidth || '__empty__';
            box.dataset.fpLogicalRowBaseMaxWidth = box.style.maxWidth || '__empty__';
        }
        box.style.width = width + 'px';
        box.style.minWidth = width + 'px';
        box.style.maxWidth = 'none';
        box.dataset.fpLogicalRowAllocated = '1';
        changed++;
    }
    return changed;
}

/* Flex can make a HorizontalIfPossible row look collision-free by shrinking
 * all fields below their authored normal widths. The reference decides this earlier,
 * from normal field width plus the measured title column.
 * Preserve that signal separately from the final CSS rectangles. */
function horizontalPreferredWidth(box) {
    if (!box || !box.children) return 0;
    var total = 0;
    var count = 0;
    for (var i = 0; i < box.children.length; i++) {
        var child = box.children[i];
        if (!child.classList || !child.classList.contains('fp-item')) continue;
        total += horizontalChildPreferredWidth(child);
        count++;
    }
    if (count > 1 && typeof getComputedStyle === 'function') {
        var style = getComputedStyle(box);
        var gap = parseFloat(style.columnGap || style.gap || '') || 0;
        total += gap * (count - 1);
    }
    return total;
}

function horizontalChildPreferredWidth(child) {
    if (!child) return 0;
    var normal = parseFloat((child.dataset && (child.dataset.fpAuthoredDecisionWidth
        || child.dataset.fpAuthoredNormalWidth)) || '') || 0;
    var label = child.querySelector
        ? child.querySelector(
            '.fp-field-row.fp-title-left .fp-field-label, '
            + '.fp-field-row.fp-title-right .fp-field-label, '
            + '.fp-field-row.fp-check-row .fp-field-label')
        : null;
    var preferred = normal;
    /* A group with an authored Width already includes its inner titles; a
     * nested checkbox caption is not a side title of the group. */
    if (label && normal && child.classList.contains('fp-sized-width')) label = null;
    if (label) preferred += labelMetric(label) + 5;
    if (!preferred) preferred = child.scrollWidth
        || (child.getBoundingClientRect && child.getBoundingClientRect().width) || 0;
    return preferred;
}

function horizontalCompressedWidth(box, minimumPriority) {
    if (!box || !box.children) return 0;
    var total = 0;
    var count = 0;
    for (var i = 0; i < box.children.length; i++) {
        var child = box.children[i];
        if (!child.classList || !child.classList.contains('fp-item')) continue;
        var row = child.querySelector ? child.querySelector('.fp-field-row') : null;
        var normal = parseFloat((child.dataset && child.dataset.fpAuthoredNormalWidth) || '') || 0;
        /* The reference gives an ordinary text editor a compressible Hor band even when
         * HorizontalStretch is omitted. Only an explicit false keeps the full
         * authored value width in the minimum-priority pass. */
        var canCompress = !(child.dataset && child.dataset.fpAuthoredFixedWidth === '1');
        var valueWidth = normal
            ? (canCompress
                ? Math.min(normal, TAXI_LAYOUT_METRICS.responsiveCompressedElementMinimumWidth)
                : normal) : 0;
        var label = row ? row.querySelector('.fp-field-label') : null;
        /* The reference's narrow title column uses the same font-aware metric as the
         * browser measurement, but at the compressed Taxi scale rather than
         * the full rendered text width. */
        var measuredLabelWidth = 0;
        if (label) {
            /* Through-alignment may have installed an inline min-width for the
             * wide variant. It is not the compressed title metric; measure the
             * flexed label without that floor and restore it immediately. */
            var savedMinWidth = label.style.minWidth;
            label.style.minWidth = '';
            measuredLabelWidth = label.getBoundingClientRect
                ? label.getBoundingClientRect().width : (label.offsetWidth || 0);
            label.style.minWidth = savedMinWidth;
        }
        /* Priority decisions use the reference's authored 10px character grid, while
         * the painted browser caption is measured on the established 8px
         * grid. Preserve the font-aware DOM measurement, but translate it to
         * decision space before applying the native compressed-title cap. */
        var labelScale = minimumPriority
            ? REF_AUTHORED_CHAR_PX / CHAR_PX
            : TAXI_BROWSER_METRICS.averageCharacterScale;
        var labelWidth = label
            ? (measuredLabelWidth || labelMetric(label)) * labelScale : 0;
        labelWidth = Math.min(labelWidth, TAXI_LAYOUT_METRICS.compressedTitleMaximumWidth);
        /* The automatic caption is a movable band: its title track may
         * compress to zero while the caption stays left, and it moves above
         * only when the painted row still collides. Do not treat it as a hard
         * 100px minimum. */
        if (minimumPriority && row && row.classList.contains('fp-title-auto')) labelWidth = 0;
        var preferred;
        if (row && row.classList.contains('fp-title-left')) preferred = labelWidth + 5 + valueWidth;
        else if (row && (row.classList.contains('fp-title-top') || row.classList.contains('fp-title-bottom')))
            preferred = Math.max(labelWidth, valueWidth);
        else preferred = valueWidth || child.scrollWidth || child.getBoundingClientRect().width || 0;
        total += preferred;
        count++;
    }
    if (count > 1 && typeof getComputedStyle === 'function') {
        var style = getComputedStyle(box);
        total += (parseFloat(style.columnGap || style.gap || '') || 0) * (count - 1);
    }
    return total;
}

function setResponsiveGroupOrientation(box, orientation) {
    if (!box || !box.classList || !box.dataset) return;
    var vertical = orientation === 'vertical';
    box.classList.remove(vertical ? 'fp-children-horizontal' : 'fp-children-vertical');
    box.classList.add(vertical ? 'fp-children-vertical' : 'fp-children-horizontal');
    if (vertical) {
        box.classList.remove('fp-children-nowrap');
        box.classList.add('fp-responsive-group-vertical');
    } else {
        box.classList.remove('fp-responsive-group-vertical');
    }
    box.dataset.fpSelectedOrientation = vertical ? 'vertical' : 'horizontal';
    /* Width projection belongs to the horizontal variant. Keeping it after a
     * vertical decision leaves the stacked group wider than its finite parent
     * and then lends that stale width to every following stretch band. */
    if (vertical && box.dataset.fpLogicalRowAllocated === '1') {
        box.style.width = box.dataset.fpLogicalRowBaseWidth === '__empty__'
            ? '' : box.dataset.fpLogicalRowBaseWidth;
        box.style.minWidth = box.dataset.fpLogicalRowBaseMinWidth === '__empty__'
            ? '' : box.dataset.fpLogicalRowBaseMinWidth;
        box.style.maxWidth = box.dataset.fpLogicalRowBaseMaxWidth === '__empty__'
            ? '' : box.dataset.fpLogicalRowBaseMaxWidth;
        delete box.dataset.fpLogicalRowAllocated;
    }
    for (var i = 0; i < (box.children || []).length; i++) {
        var child = box.children[i];
        if (!child.classList || !child.classList.contains('fp-item') || !child.dataset) continue;
        if (!Object.prototype.hasOwnProperty.call(child.dataset, 'fpResponsiveFlex')) {
            child.dataset.fpResponsiveFlex = child.style.flex || '__empty__';
            child.dataset.fpResponsiveAlignSelf = child.style.alignSelf || '__empty__';
        }
        if (vertical) {
            if (child.dataset.fpHorizontalAllocated === '1') {
                child.style.flex = child.dataset.fpHorizontalBaseFlex === '__empty__'
                    ? '' : child.dataset.fpHorizontalBaseFlex;
                child.style.width = child.dataset.fpHorizontalBaseWidth === '__empty__'
                    ? '' : child.dataset.fpHorizontalBaseWidth;
                child.style.minWidth = child.dataset.fpHorizontalBaseMinWidth === '__empty__'
                    ? '' : child.dataset.fpHorizontalBaseMinWidth;
                child.style.maxWidth = child.dataset.fpHorizontalBaseMaxWidth === '__empty__'
                    ? '' : child.dataset.fpHorizontalBaseMaxWidth;
                delete child.dataset.fpHorizontalAllocated;
            }
            delete child.dataset.fpHorizontalPublishedWidth;
            child.style.flex = child.classList.contains('fp-vstretch') ? '1 1 auto' : '0 0 auto';
            child.style.alignSelf = child.classList.contains('fp-hstretch') ? 'stretch' : '';
        } else {
            child.style.flex = child.dataset.fpResponsiveFlex === '__empty__'
                ? '' : child.dataset.fpResponsiveFlex;
            child.style.alignSelf = child.dataset.fpResponsiveAlignSelf === '__empty__'
                ? '' : child.dataset.fpResponsiveAlignSelf;
        }
    }
}

function isNativeCardStack(item) {
    if (!item || normGroupMode(prop(item, ['Group'])) !== 'vertical') return false;
    var spacing = normSpacing(prop(item, ['VerticalSpacing']));
    if (spacing !== 'half' && spacing !== 'single') return false;
    var children = (item.childItems || []).filter(function (child) {
        return child && !isFalse(prop(child, ['Visible', 'visible'])) && !isAdditionTag(child.tag);
    });
    if (children.length < 2) return false;
    return children.every(function (child) {
        return absoluteColor(prop(child, ['BackColor'])).toLowerCase() === '#ffffff';
    });
}

function prepareResponsiveGroups(body) {
    if (!body || !body.querySelectorAll) return 0;
    var boxes = body.querySelectorAll('[data-fp-responsive-group="1"]');
    var i;
    /* Every pass starts from the authored wide variant. This makes resize in
     * both directions deterministic instead of preserving yesterday's narrow
     * classes and measuring against them. */
    for (i = 0; i < boxes.length; i++) setResponsiveGroupOrientation(boxes[i], 'horizontal');
    var changed = 0;
    var pageColumnScopes = [];
    for (i = boxes.length - 1; i >= 0; i--) {
        if (!responsiveGroupNeedsVertical(boxes[i])) continue;
        setResponsiveGroupOrientation(boxes[i], 'vertical');
        equalizeFieldLabels(boxes[i], true);
        var pageColumnScope = pageLocalVerticalColumnBox(boxes[i]);
        if (pageColumnScope && pageColumnScopes.indexOf(pageColumnScope) < 0)
            pageColumnScopes.push(pageColumnScope);
        changed++;
    }
    for (i = 0; i < pageColumnScopes.length; i++) {
        var pageLabels = collectFieldLabels(pageColumnScopes[i], true);
        applyLabelWidth(pageLabels, true, pageColumnScopes[i]);
        for (var labelIndex = 0; labelIndex < pageLabels.length; labelIndex++) {
            var labelWidth = parseFloat(pageLabels[labelIndex].style.minWidth || '') || 0;
            if (labelWidth > 152) pageLabels[labelIndex].style.minWidth = '152px';
        }
    }
    return changed;
}

function unboundedLabelDecorationSlack(source, parentMode) {
    if (!source || source.tag !== 'LabelDecoration' || parentMode !== 'always-horizontal') return 0;
    if (!isFalse(prop(source, ['AutoMaxWidth'])) || prop(source, ['Width', 'Ширина'])) return 0;
    /* The reference static-text calculation keeps an almost four-unit presentation
     * reserve (38 px at 96 DPI) before the next horizontal track. */
    return 4 * REF_AUTHORED_CHAR_PX - 3;
}

function prepareProjectedResponsiveGroups(body) {
    if (!body || !body.querySelectorAll) return 0;
    var boxes = body.querySelectorAll('[data-fp-responsive-group="1"]');
    var changed = 0;
    for (var i = boxes.length - 1; i >= 0; i--) {
        var children = directFpItems(boxes[i]);
        /* Only projected logical rows have the inverse dependency fixed here:
         * their finite child bands are published after the ordinary responsive
         * pass. Re-running every responsive group this late changes
         * unrelated responsive decisions and breaks otherwise stable layouts. */
        if (children.length < 2 || !children.every(isLogicalSubgridItem)) continue;
        setResponsiveGroupOrientation(boxes[i], 'horizontal');
        if (!responsiveGroupNeedsVertical(boxes[i], true)) continue;
        setResponsiveGroupOrientation(boxes[i], 'vertical');
        equalizeFieldLabels(boxes[i], true);
        changed++;
    }
    return changed;
}

/* The platform sizes the Form canvas from semantic bands, not from browser
 * overflow: when the widest authored row cannot shrink to the window
 * (its minimum exceeds the viewport) the whole Form, command bar included,
 * is laid out at its minimum: Form resWidth = max(window, root column
 * minLengthWithNormalPriority), so every row compresses to its normal-priority
 * minimum (e.g. 1401 = row min 1369 + 32 insets).
 * Returns 0 while every row fits, leaving the overflow detector in charge. */
/* While deciding whether the form needs a wider canvas, an automatic side
 * title of a fixed editor may still move on top, so it is not a floor.
 * Width allocation keeps it. */
var canvasDecisionPass = false;

function semanticFormCanvasWidth(body, available) {
    if (!body || !body.querySelectorAll) return 0;
    var bodyRect = body.getBoundingClientRect();
    var rows = body.querySelectorAll(':scope > .fp-item, '
        + ':scope > .fp-item[data-tag="Pages"] .fp-pages-active-panel > .fp-item');
    var minimum = 0;
    for (var i = 0; i < rows.length; i++) {
        var item = rows[i];
        var box = directLayoutChildren(item);
        /* The recursive band models field and group tracks only. A Table
         * compresses to its own scroll minimum and a command bar folds into
         * «Еще», so neither yields a trustworthy minimum here (a list row
         * would claim 1461px while the reference fits it into the 992px window). */
        if (!box || !box.classList.contains('fp-children-horizontal')
            || item.dataset.tag === 'AutoCommandBar' || item.dataset.tag === 'CommandBar'
            || box.closest('.fp-commandbar')
            || item.querySelector('.fp-item[data-tag="Table"]')) continue;
        canvasDecisionPass = true;
        var band;
        try { band = logicalSubgridAllocationBand(item, true); }
        finally { canvasDecisionPass = false; }
        var inset = Math.max(0, item.getBoundingClientRect().left - bodyRect.left);
        minimum = Math.max(minimum, Math.ceil((band.min || 0) + 2 * inset));
    }
    /* The band over-estimates fixed-editor minima by a few dozen pixels; the
     * reference still compresses at 640px. Use the
     * same 80px tolerance as the overflow detector below. */
    return minimum > available ? minimum : 0;
}

/* Two StaticTexts stacked in a vertical group are separated by the group's
 * Spacing row alone: 9 px for Auto/Single (e.g. labels 64/9/48/9/16, 18/9/18).
 * The stack gap in CSS is tuned for editors with their outer band, and a
 * label box has no band, so the gap alone left 5 px. Idempotent: the
 * margin is derived from the computed gap and the upper label's margin. */
/* A horizontal row of untitled radio buttons and untitled LabelFields only:
 * no editor frame in it, so the platform sizes it to its content. */
function markTextChoiceRows(body) {
    var rows = body.querySelectorAll('.fp-children-horizontal');
    for (var i = 0; i < rows.length; i++) {
        var kids = directFpItems(rows[i]);
        var ok = kids.length > 1;
        var hasLabel = false;
        for (var k = 0; ok && k < kids.length; k++) {
            var tag = kids[k].dataset.tag;
            var wrap = kids[k].querySelector(':scope > .fp-control-wrap');
            if (tag === 'CheckBoxField' && wrap && wrap.classList.contains('fp-check-row')
                && !wrap.querySelector('.fp-field-label')) continue;
            if (!wrap || !wrap.classList.contains('fp-title-none')) ok = false;
            else if (tag === 'LabelField') hasLabel = true;
            else if (tag === 'CheckBoxField' && kids[k].querySelector('input[type="checkbox"], .fp-check')) continue;
            else if (tag !== 'RadioButtonField' || !wrap.querySelector('.fp-radio-stack')
                || kids[k].querySelectorAll('.fp-radio-option').length !== 1) ok = false;
        }
        rows[i].classList.toggle('fp-text-choice-row', ok && hasLabel);
    }
}

function isTextChoiceRowItem(item) {
    return !!item.querySelector(':scope > .fp-control-wrap > .fp-group-bare > .fp-children.fp-text-choice-row');
}

/* The outer band an item keeps above its native box: padding and border of
 * the item and of the first item nested down its leading edge. */
function leadingItemBand(item) {
    var band = 0;
    for (var cur = item; cur; ) {
        var cs = getComputedStyle(cur);
        band += (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.borderTopWidth) || 0);
        cur = cur.querySelector(':scope > .fp-control-wrap > .fp-group-bare > .fp-children > .fp-item');
    }
    return band;
}

/* A choice list of radio buttons (not a tumbler, not a one-option text
 * choice row): a native VirtualGridElement whose box is its title row and
 * option rows, inside our 2px item band. */
function isRadioStackItem(item) {
    return !!(item && item.classList && item.classList.contains('fp-control')
        && item.dataset.tag === 'RadioButtonField'
        && item.querySelector(':scope > .fp-control-wrap > .fp-radio-stack.fp-radio-column'));
}

/* The native box edge of an item: the painted parts of its controls (title,
 * frame, option list, caption text), not our item band or lane minimum. An
 * empty spacer decoration is its whole native line. */
function nativeItemEdge(item, edge) {
    if (isStackSpacerItem(item)) {
        var own = item.getBoundingClientRect();
        return edge === 'top' ? own.top : own.bottom;
    }
    var controls = [item].concat(Array.prototype.slice.call(item.querySelectorAll('.fp-item.fp-control')))
        .filter(function (node) { return node.classList.contains('fp-control') && node.offsetHeight > 0; });
    var best = null;
    controls.forEach(function (node) {
        var parts = node.querySelectorAll(':scope > .fp-control-wrap > *');
        for (var i = 0; i < parts.length; i++) {
            var r = parts[i].getBoundingClientRect();
            if (r.height < 2) continue;
            var v = edge === 'top' ? r.top : r.bottom;
            if (best == null || (edge === 'top' ? v < best : v > best)) best = v;
        }
    });
    if (best == null) {
        var rect = item.getBoundingClientRect();
        return edge === 'top' ? rect.top : rect.bottom;
    }
    return best;
}

/* An empty LabelDecoration directly in a vertical stack: one text line
 * (16 px). Tooltip text painted on the form makes it a text block, not a
 * spacer. */
function markStackSpacers(body) {
    var items = body.querySelectorAll('.fp-children-vertical > .fp-item[data-tag="LabelDecoration"]');
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var wrap = item.querySelector(':scope > .fp-control-wrap');
        var spacer = wrap && wrap.children.length === 1 && wrap.firstElementChild.classList.contains('fp-deco-spacer')
            && !item.querySelector(':scope > .fp-tooltip-text');
        item.classList.toggle('fp-stack-spacer', !!spacer && !item.style.height && !item.style.minHeight
            && !item.closest('.fp-authored-width-envelope-column'));
    }
}

function isStackSpacerItem(item) {
    return !!(item && item.classList && item.dataset && item.dataset.tag === 'LabelDecoration'
        && item.classList.contains('fp-stack-spacer'));
}

/* A RadioButtonType=Tumbler field, or a group row holding one: a native 25 px
 * segmented row. */
function isTumblerItem(item) {
    return !!(item && item.classList && item.querySelector('.fp-segmented')
        && item.querySelectorAll('.fp-item').length <= 5);
}

function isSimpleStackItem(item) {
    if (!item || !item.classList || !item.classList.contains('fp-item') || item.offsetHeight === 0) return false;
    if (item.classList.contains('fp-container')) {
        if (!item.classList.contains('fp-bare') || item.classList.contains('fp-color-surface')) return false;
        return !item.querySelector('table, .fp-table-widget, .fp-pages, .fp-commandbar, .fp-button, textarea, .fp-multiline');
    }
    var tag = item.dataset.tag;
    if (tag === 'LabelDecoration')
        return item.classList.contains('fp-native-label-decoration') || isStackSpacerItem(item);
    if (isTumblerItem(item)) return true;
    if (tag === 'InputField' && item.querySelector('.fp-multiline')) return true;
    return (tag === 'InputField' && !item.querySelector('.fp-multiline, textarea'))
        || tag === 'CheckBoxField' || tag === 'RadioButtonField' || tag === 'LabelField';
}

/* Radio lists sit one Spacing row from their neighbours (89 / 9 / 89 / 9).
 * The gap between the platform boxes is the Spacing row, whatever bands our
 * items carry. */
/* A bare group of editor rows (editors, command bars, buttons) next to a
 * tumbler row: its top is its first painted editor or button (25 / 9 /
 * group). Below the tumbler only its top edge matters, so a table further
 * down is fine. */
function isEditorRowNeighbour(item, topOnly) {
    return !!(item && item.classList && item.classList.contains('fp-container')
        && item.classList.contains('fp-bare') && !item.classList.contains('fp-color-surface')
        && item.offsetHeight > 0
        && (topOnly || !item.querySelector('table, .fp-table-widget, .fp-pages, textarea, .fp-multiline')));
}

function spaceRadioBoundary(stack, upper, lower, spacing) {
    var tumblerPair = isTumblerItem(upper) || isTumblerItem(lower);
    if (!(isSimpleStackItem(upper) || (tumblerPair && isEditorRowNeighbour(upper)))
        || !(isSimpleStackItem(lower) || (tumblerPair && isEditorRowNeighbour(lower, true)))) return;
    if (lower.dataset.fpNativeSpacing !== '1') {
        lower.dataset.fpNativeSpacingMargin = lower.style.marginTop || '';
        lower.dataset.fpNativeSpacing = '1';
    }
    lower.style.marginTop = lower.dataset.fpNativeSpacingMargin;
    var current = parseFloat(getComputedStyle(lower).marginTop) || 0;
    var delta = nativeItemEdge(lower, 'top') - nativeItemEdge(upper, 'bottom');
    lower.style.marginTop = (current + spacing - delta) + 'px';
}

/* A compact two-control row (editor + picture, fp-ordinary-row-control) has
 * no editor band. In a 5 px stack every banded editor row steps 29 + 5 = 34,
 * the platform's 25 + 9; the bandless row stepped 30 or 32 instead.
 * Its box keeps the same 2 px band as its neighbours. */
function bandCompactRows(stack, kids) {
    var stackGap = null;
    for (var i = 0; i < kids.length; i++) {
        var row = kids[i];
        if (!row.classList || !row.classList.contains('fp-container-horizontal')) continue;
        var box = row.querySelector(':scope > .fp-control-wrap > .fp-group-bare > .fp-children');
        var cells = box ? directFpItems(box) : [];
        if (!cells.length || !cells.some(function (cell) {
            return cell.dataset.tag === 'InputField' && cell.classList.contains('fp-ordinary-row-control');
        })) continue;
        if (row.dataset.fpCompactBand !== '1') {
            row.dataset.fpCompactBandPadding = row.style.paddingTop || '';
            row.dataset.fpCompactBand = '1';
        }
        row.style.paddingTop = row.style.paddingBottom = row.dataset.fpCompactBandPadding;
        if (stackGap == null) stackGap = parseFloat(getComputedStyle(stack).rowGap) || 0;
        if (stackGap !== 5) continue;
        /* Only a boundary with a neighbour row carries the band: the first row
         * stays on the group top, aligned with parallel columns. */
        var visibleBefore = false, visibleAfter = false;
        for (var b = i - 1; b >= 0; b--) if (kids[b].offsetHeight > 0) { visibleBefore = true; break; }
        for (var a = i + 1; a < kids.length; a++) if (kids[a].offsetHeight > 0) { visibleAfter = true; break; }
        if (visibleBefore) row.style.paddingTop = '2px';
        if (visibleAfter) row.style.paddingBottom = '2px';
    }
}

/* The first root row after the form command bar starts one Spacing row below
 * the bar's 27 px row: the reference bar at 26, editors at 62. Its top is the
 * first editor frame, not our item band or a button/picture lane. */
function spaceFirstRootRow(body) {
    var bar = body.querySelector(':scope > .fp-item[data-tag="AutoCommandBar"]');
    var row = bar && bar.nextElementSibling;
    while (row && row.offsetHeight === 0) row = row.nextElementSibling;
    if (!row || !row.classList.contains('fp-item')) return;
    if (row.dataset.fpFirstRootRow !== '1') {
        row.dataset.fpFirstRootRowMargin = row.style.marginTop || '';
        row.dataset.fpFirstRootRow = '1';
    }
    row.style.marginTop = row.dataset.fpFirstRootRowMargin;
    /* A tabbed Pages row starts with its tab strip. */
    var strip = row.dataset.tag === 'Pages'
        ? row.querySelector(':scope > .fp-control-wrap > .fp-group-block > .fp-pages-outer > .fp-pages-tablist')
        : null;
    if (row.dataset.tag === 'Pages' && !strip) return;
    var top = strip ? strip.getBoundingClientRect().top : firstEditorFrameTop(row);
    if (top == null) return;
    /* The row top is an editor frame. A frameless LabelField, a title above
     * the frame (narrow window) or editors in a separated group, which
     * carries its own section band, keep their layout. */
    if (!strip) {
        var firstEditor = firstEditorAt(row, top);
        if (!firstEditor || firstEditor.dataset.tag === 'LabelField') return;
        /* A group title above the frame also opens its own row (otherwise it is
         * pulled under the command bar). */
        var rowLabels = row.querySelectorAll('.fp-field-label, .fp-group-title');
        for (var l = 0; l < rowLabels.length; l++) {
            var labelRect = rowLabels[l].getBoundingClientRect();
            if (labelRect.height >= 2 && labelRect.bottom <= top + 1) return;
        }
        for (var up = firstEditor.parentElement; up && up !== row.parentElement; up = up.parentElement) {
            if (up.classList.contains('fp-children') && (up.dataset.fpGroupRepresentation || '').indexOf('separation') >= 0) return;
        }
    }
    /* Only a row that starts with its editors: a caption or button above them
     * is its own row. */
    var rowTop = row.getBoundingClientRect().top;
    var others = strip ? [] : row.querySelectorAll('.fp-item.fp-control');
    for (var o = 0; o < others.length; o++) {
        var tag = others[o].dataset.tag;
        if (tag === 'InputField' || tag === 'CheckBoxField' || tag === 'LabelField' || others[o].offsetHeight === 0) continue;
        if (others[o].getBoundingClientRect().bottom <= top + 1 && others[o].getBoundingClientRect().top >= rowTop - 1) return;
    }
    var barTop = null, buttonsBottom = null;
    var buttons = bar.querySelectorAll('.fp-bar-item');
    for (var b = 0; b < buttons.length; b++) {
        var buttonRect = buttons[b].getBoundingClientRect();
        if (buttonRect.height < 2) continue;
        if (barTop == null || buttonRect.top < barTop) barTop = buttonRect.top;
        if (buttonsBottom == null || buttonRect.bottom > buttonsBottom) buttonsBottom = buttonRect.bottom;
    }
    if (barTop == null) return;
    /* A bar wrapped onto several lines in a narrow window is not the native
     * 27 px row. */
    if (buttonsBottom > barTop + TAXI_LAYOUT_METRICS.commandBarHeight + 1) return;
    var barBottom = barTop + TAXI_LAYOUT_METRICS.commandBarHeight;
    var current = parseFloat(getComputedStyle(row).marginTop) || 0;
    var target = barBottom + TAXI_LAYOUT_METRICS.verticalSpacing.single;
    row.style.marginTop = (current + target - top) + 'px';
    if (strip) {
        /* Pages content starts tcp = 36 px below the strip top; its first
         * editor frame sits on that line. */
        var panel = row.querySelector('.fp-pages-active-panel');
        var first = panel ? directFpItems(panel).filter(function (item) { return item.offsetHeight > 0; })[0] : null;
        if (!first) return;
        if (first.dataset.fpFirstPageRow !== '1') {
            first.dataset.fpFirstPageRowMargin = first.style.marginTop || '';
            first.dataset.fpFirstPageRow = '1';
        }
        first.style.marginTop = first.dataset.fpFirstPageRowMargin;
        var firstTop = firstEditorFrameTop(first);
        var contentTop = strip.getBoundingClientRect().top + 36;
        if (firstTop == null || firstTop - contentTop < 0.5 || firstTop - contentTop > 2.5) return;
        var firstMargin = parseFloat(getComputedStyle(first).marginTop) || 0;
        first.style.marginTop = (firstMargin - (firstTop - contentTop)) + 'px';
        return;
    }
    /* Parallel columns of that row start on the same row top: a column
     * whose first editor keeps its 2 px item band (beside a compact row) is
     * lifted onto it. */
    var box = row.querySelector(':scope > .fp-control-wrap > .fp-group-bare > .fp-children-horizontal');
    var columns = box ? directFpItems(box) : [];
    columns.forEach(function (column) {
        if (column.dataset.fpFirstRootColumn !== '1') {
            column.dataset.fpFirstRootColumnMargin = column.style.marginTop || '';
            column.dataset.fpFirstRootColumn = '1';
        }
        column.style.marginTop = column.dataset.fpFirstRootColumnMargin;
        var columnTop = firstEditorFrameTop(column);
        if (columnTop == null || columnTop - target < 0.5 || columnTop - target > 2.5) return;
        var own = parseFloat(getComputedStyle(column).marginTop) || 0;
        column.style.marginTop = (own - (columnTop - target)) + 'px';
    });
}

function firstEditorAt(root, top) {
    var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll('.fp-item.fp-control')));
    for (var i = 0; i < nodes.length; i++) {
        var tag = nodes[i].dataset.tag;
        if ((tag === 'InputField' || tag === 'CheckBoxField' || tag === 'LabelField')
            && firstEditorFrameTop(nodes[i]) === top) return nodes[i];
    }
    return null;
}

function firstEditorFrameTop(root) {
    var top = null;
    [root].concat(Array.prototype.slice.call(root.querySelectorAll('.fp-item.fp-control'))).forEach(function (node) {
        var tag = node.dataset.tag;
        if (!node.classList.contains('fp-control') || node.offsetHeight === 0
            || (tag !== 'InputField' && tag !== 'CheckBoxField' && tag !== 'LabelField')) return;
        var frame = node.querySelector(':scope > .fp-control-wrap > .fp-input-wrap, :scope > .fp-control-wrap > .fp-labelfield-value, :scope > .fp-control-wrap > input');
        var rect = (frame || node.querySelector(':scope > .fp-control-wrap') || node).getBoundingClientRect();
        if (rect.height >= 2 && (top == null || rect.top < top)) top = rect.top;
    });
    return top;
}

/* Extent of one logical-grid cell: its painted editor frames and
 * captions; a Button is a 27 px row whatever its painted face. */
function logicalCellExtent(cell) {
    var top = null, bottom = null;
    [cell].concat(Array.prototype.slice.call(cell.querySelectorAll('.fp-item.fp-control'))).forEach(function (node) {
        if (!node.classList.contains('fp-control') || node.offsetHeight === 0) return;
        var tag = node.dataset.tag;
        var parts = node.querySelectorAll(':scope > .fp-control-wrap > *');
        var nodeTop = null, nodeBottom = null;
        for (var i = 0; i < parts.length; i++) {
            var r = parts[i].getBoundingClientRect();
            if (r.height < 2) continue;
            if (nodeTop == null || r.top < nodeTop) nodeTop = r.top;
            if (nodeBottom == null || r.bottom > nodeBottom) nodeBottom = r.bottom;
        }
        if (nodeTop == null) return;
        var height = nodeBottom - nodeTop;
        if (tag === 'Button' && height < TAXI_LAYOUT_METRICS.commandBarHeight) {
            nodeTop -= (TAXI_LAYOUT_METRICS.commandBarHeight - height) / 2;
            nodeBottom = nodeTop + TAXI_LAYOUT_METRICS.commandBarHeight;
        }
        if (top == null || nodeTop < top) top = nodeTop;
        if (bottom == null || nodeBottom > bottom) bottom = nodeBottom;
    });
    return top == null ? null : { top: top, bottom: bottom };
}

/* Parallel United=false columns of one logical grid share rows: a row
 * is as tall as its tallest cell, each cell is centred in it, and rows are
 * one Spacing row apart. A 27 px row with a button in one column makes the
 * editors of the other column step 35 in the reference, not 34. */
/* Horizontal United=false rows stacked in one vertical group dissolve into
 * that group's grid: every row's left and right wrapper occupy the same two
 * column pairs, and all side titles of one column pair share its title track
 * (fields at 119 and 565, titles at 12 and 434 for every row). The paired
 * titled row publishes the column widths. */
function detachedTwoColumnRow(item) {
    if (!item || !item._fpItem || !isContainer(item._fpItem.tag)) return null;
    var meta = layoutMeta(item._fpItem);
    if (meta.united || meta.groupRepresentation !== 'none') return null;
    var box = directLayoutChildren(item);
    if (!box || !box.classList.contains('fp-children-horizontal')) return null;
    var columns = directFpItems(box).filter(function (column) { return column.offsetWidth > 0; });
    if (columns.length !== 2 || !columns.every(function (column) {
        return column._fpItem && isContainer(column._fpItem.tag)
            && !layoutMeta(column._fpItem).united && !!directLayoutChildren(column);
    })) return null;
    return columns;
}

function shareDetachedSiblingColumns(body) {
    var boxes = body.querySelectorAll('.fp-children-vertical');
    var shared = 0;
    for (var b = 0; b < boxes.length; b++) {
        var rows = directFpItems(boxes[b]).map(detachedTwoColumnRow)
            .filter(function (columns) { return !!columns; });
        if (rows.length < 2) continue;
        var anchor = null;
        for (var r = 0; r < rows.length && !anchor; r++)
            if (rows[r][0].classList.contains('fp-paired-titled-logical-column')) anchor = rows[r];
        if (!anchor) continue;
        var sizes = anchor.map(function (column) { return Math.round(column.getBoundingClientRect().width); });
        for (var c = 0; c < 2; c++) {
            var labels = [];
            rows.forEach(function (columns) {
                if (columns !== anchor) {
                    var target = columns[c];
                    target.style.flex = '0 0 ' + sizes[c] + 'px';
                    target.style.width = sizes[c] + 'px';
                    target.style.minWidth = sizes[c] + 'px';
                    target.style.maxWidth = sizes[c] + 'px';
                }
                var own = columns[c].querySelectorAll('.fp-field-row.fp-title-left > .fp-field-label');
                for (var l = 0; l < own.length; l++) labels.push(own[l]);
            });
            var track = 0;
            labels.forEach(function (label) {
                track = Math.max(track, Math.ceil(throughAlignGlyphMetric(label) + 4));
            });
            labels.forEach(function (label) { label.style.minWidth = track + 'px'; });
        }
        shared++;
    }
    return shared;
}

function syncLogicalSubgridRows(body) {
    var rows = body.querySelectorAll('.fp-children-horizontal');
    for (var i = 0; i < rows.length; i++) {
        var columns = directFpItems(rows[i]).map(function (column) {
            var box = column.querySelector(':scope > .fp-control-wrap > .fp-group-bare > .fp-children-vertical.fp-logical-subgrid');
            return box ? directFpItems(box).filter(function (cell) { return cell.offsetHeight > 0; }) : null;
        });
        if (columns.length < 2 || columns.some(function (cells) { return !cells || !cells.length; })) continue;
        var count = columns[0].length;
        if (count < 2 || columns.some(function (cells) { return cells.length !== count; })) continue;
        columns.forEach(function (cells) {
            cells.forEach(function (cell) {
                if (cell.dataset.fpGridRow !== '1') {
                    cell.dataset.fpGridRowMargin = cell.style.marginTop || '';
                    cell.dataset.fpGridRow = '1';
                }
                cell.style.marginTop = cell.dataset.fpGridRowMargin;
            });
        });
        var previousBottom = null;
        /* The grid rows belong to the row group: its VerticalSpacing (or the
         * nearest authored one) sets the Spacing row (Half: 25 / 5 / 25). */
        var gridMode = '';
        for (var owner = rows[i]; owner && owner !== body.parentElement; owner = owner.parentElement) {
            var ownMode = owner.dataset && owner.dataset.fpVerticalSpacingMode;
            if (ownMode) { gridMode = ownMode; break; }
        }
        var gridSpacing = TAXI_LAYOUT_METRICS.verticalSpacing[gridMode || 'single'];
        if (gridSpacing == null) gridSpacing = TAXI_LAYOUT_METRICS.verticalSpacing.single;
        for (var r = 0; r < count; r++) {
            var extents = columns.map(function (cells) { return logicalCellExtent(cells[r]); });
            if (extents.some(function (extent) { return !extent; })) break;
            var height = Math.max.apply(null, extents.map(function (extent) { return extent.bottom - extent.top; }));
            var rowTop = previousBottom == null
                ? Math.min.apply(null, extents.map(function (extent) { return extent.top; }))
                : previousBottom + gridSpacing;
            columns.forEach(function (cells, c) {
                var extent = logicalCellExtent(cells[r]);
                var wanted = rowTop + Math.floor((height - (extent.bottom - extent.top)) / 2);
                var own = parseFloat(getComputedStyle(cells[r]).marginTop) || 0;
                cells[r].style.marginTop = (own + wanted - extent.top) + 'px';
            });
            previousBottom = rowTop + height;
        }
    }
}

/* A compact two-control group (bandless ordinary-row controls) whose
 * HorizontalIfPossible axis wrapped to a stack: its controls are separate
 * rows one Spacing row apart (a 34px step), not the 3 px compact cadence. */
function spaceWrappedCompactPairs(body) {
    var boxes = body.querySelectorAll('.fp-children');
    for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        if (box.dataset.fpWrappedCompact === '1') box.style.rowGap = box.dataset.fpWrappedCompactGap;
        var cells = directFpItems(box).filter(function (cell) { return cell.offsetHeight > 0; });
        if (cells.length !== 2 || !cells.every(function (cell) {
            var cs = getComputedStyle(cell);
            return cell.dataset.tag === 'InputField'
                && !(parseFloat(cs.paddingTop) || 0) && !(parseFloat(cs.borderTopWidth) || 0);
        })) continue;
        if (cells[1].getBoundingClientRect().top < cells[0].getBoundingClientRect().bottom - 0.5) continue;
        if (box.dataset.fpWrappedCompact !== '1') {
            box.dataset.fpWrappedCompactGap = box.style.rowGap || '';
            box.dataset.fpWrappedCompact = '1';
        }
        box.style.rowGap = TAXI_LAYOUT_METRICS.verticalSpacing.single + 'px';
    }
}

/* A bare row of several check boxes: a 17 px row one Spacing row from its
 * neighbours (17/9/17). */
function isCheckRowItem(item) {
    if (!item || !item.classList || !item.classList.contains('fp-container-horizontal')
        || !item.classList.contains('fp-bare') || item.offsetHeight === 0) return false;
    var box = item.querySelector(':scope > .fp-control-wrap > .fp-group-bare > .fp-children');
    var cells = box ? directFpItems(box).filter(function (cell) { return cell.offsetHeight > 0; }) : [];
    return cells.length > 1 && cells.every(function (cell) { return cell.dataset.tag === 'CheckBoxField'; });
}

function spaceStackedStaticTexts(body) {
    markTextChoiceRows(body);
    markStackSpacers(body);
    spaceFirstRootRow(body);
    syncLogicalSubgridRows(body);
    spaceWrappedCompactPairs(body);
    var stacks = body.querySelectorAll('.fp-children-vertical');
    for (var s = 0; s < stacks.length; s++) {
        var stack = stacks[s];
        if (stack.closest('.fp-authored-width-envelope-column')) continue;
        /* Auto inherits the nearest authored VerticalSpacing (Half on the outer
         * AlwaysHorizontal group gives rows 32/5/16/5/16). */
        var mode = '';
        for (var owner = stack; owner && owner !== body.parentElement; owner = owner.parentElement) {
            var own = owner.dataset && owner.dataset.fpVerticalSpacingMode;
            if (own) { mode = own; break; }
        }
        var spacing = TAXI_LAYOUT_METRICS.verticalSpacing[mode || 'single'];
        if (spacing == null) continue;
        var gap = null;
        var kids = stack.children;
        bandCompactRows(stack, kids);
        for (var k = 1; k < kids.length; k++) {
            var lower = kids[k], upper = kids[k - 1];
            if (isRadioStackItem(upper) || isRadioStackItem(lower)
                || isStackSpacerItem(upper) || isStackSpacerItem(lower)
                || isTumblerItem(upper) || isTumblerItem(lower)
                || isCheckRowItem(upper) || isCheckRowItem(lower)) {
                spaceRadioBoundary(stack, upper, lower, spacing);
                continue;
            }
            if (!upper.classList.contains('fp-native-label-decoration') && !isTextChoiceRowItem(upper)) continue;
            var lowerIsText = lower.classList.contains('fp-native-label-decoration');
            if (!lowerIsText && (!lower.classList.contains('fp-item') || lower.offsetHeight === 0)) continue;
            if (lower.dataset.fpStackedStaticText !== '1') {
                lower.dataset.fpStackedStaticTextMargin = lower.style.marginTop || '';
                lower.dataset.fpStackedStaticText = '1';
            }
            lower.style.marginTop = lower.dataset.fpStackedStaticTextMargin;
            if (gap == null) gap = parseFloat(getComputedStyle(stack).rowGap) || 0;
            var upperBottom = parseFloat(getComputedStyle(upper).marginBottom) || 0;
            var need = spacing - gap - upperBottom - (lowerIsText ? 0 : leadingItemBand(lower));
            if (need > (parseFloat(getComputedStyle(lower).marginTop) || 0))
                lower.style.marginTop = need + 'px';
        }
    }
}

function fitFormViewport(body) {
    if (!body || !body.isConnected || !body.clientWidth) return false;
    resetFormViewport(body);
    spaceStackedStaticTexts(body);
    /* resetFormViewport clears the grown root Pages; re-take it on the
     * current rows so the page keeps its native content height. */
    fitRootPagesPreferredHeights(body);
    releaseStackedAuthoredHeights(body);
    fitPageTabs(body);
    /* A compact List column is a fixed track whose toolbar overflows
     * into More. Fit that toolbar inside the track before collisions are
     * measured: the unfitted min-content bar was otherwise reserved as the
     * column minimum (154px instead of 64px), and the reserved width
     * then kept every command visible. */
    var compactToolbars = body.querySelectorAll('.fp-compact-list-group .fp-table-toolbar');
    for (var compactIndex = 0; compactIndex < compactToolbars.length; compactIndex++)
        fitCommandBar(compactToolbars[compactIndex]);
    var bodyRect = body.getBoundingClientRect();
    var available = body.clientWidth;
    var required = available;
    var panelWidths = [];
    var rootBandWidths = [];
    var forceBodyOverflow = false;
    var flattenedPageOverflow = false;
    var rows = body.querySelectorAll('.fp-children-horizontal');
    /* Resolve inner rows first. Giving the colliding row its summed intrinsic
     * width makes flex place its direct children side by side; widening only
     * the outer canvas would preserve the already-overlapping child boxes. */
    /* One widening can change flex distribution and expose the next minimum
     * (especially in nested columns). Iterate bottom-up until no row needs
     * more space. The cap protects malformed/deep DOMs; widths only increase
     * within this pass, so ordinary forms converge after one or two rounds. */
    function reserveCollidingTracks() {
    var reservedAny = false;
    for (var pass = 0; pass < 8; pass++) {
        var widened = false;
        for (var ri = rows.length - 1; ri >= 0; ri--) {
            /* Command bars own their responsive overflow: fitCommandBar moves
             * trailing items into More. Their intrinsic button row must not
             * widen the form canvas before that local pass can run. */
            if (rows[ri].closest && rows[ri].closest('.fp-commandbar')) continue;
            if (rows[ri].dataset && rows[ri].dataset.fpNoOverlapContained === '1') {
                rows[ri].style.minWidth = '0';
                continue;
            }
            /* This row already has an explicit outer Equal allocation and a
             * dedicated compression rule for the oversized editor inside its
             * nested LeftWide half. Re-promoting that editor's authored width
             * to the outer track minimum defeats Equal (651/480 instead of
             * 480/480) and pushes the sibling column off-canvas. */
            if (rows[ri].classList
                && rows[ri].classList.contains('fp-detached-equal-leftwide-pair')) {
                rows[ri].style.minWidth = '0';
                continue;
            }
            /* A large fixed column must keep its authored basis, but it does
             * not excuse a real descendant collision. The old unconditional
             * skip left the flexible neighbour under the fixed field, so its
             * title was painted over by the field. Skip only the harmless
             * no-collision case; a measured collision still widens the row's
             * scroll canvas and keeps the fixed column unchanged. */
            if (rows[ri].dataset && rows[ri].dataset.fpHasLargeFixedWidthChild === '1'
                && !horizontalRowMetrics(rows[ri]).collision) continue;
            var intrinsic = horizontalRowMetrics(rows[ri]);
            if (!intrinsic.collision) continue;
            var contained = 0;
            for (var ci = 0; intrinsic.structuralCollision
                && ci < intrinsic.trackMinimums.length; ci++) {
                var collidingTrack = intrinsic.trackMinimums[ci];
                if (collidingTrack.structural)
                    contained += containHorizontalTrackRows(collidingTrack.item);
            }
            if (contained) {
                widened = true;
                continue;
            }
            /* Widening only the row cannot separate tracks that an allocator
             * pinned (flex:0 0 159px): reserve the painted width of every
             * colliding track, not just structural ones. */
            for (var ti = 0; ti < intrinsic.trackMinimums.length; ti++) {
                var track = intrinsic.trackMinimums[ti];
                if (!intrinsic.structuralCollision && !track.collidesNext) continue;
                var trackRect = track.item.getBoundingClientRect();
                if (track.width <= trackRect.width + 0.5) continue;
                if (track.item.dataset.fpNoOverlapTrack !== '1') {
                    track.item.dataset.fpNoOverlapBaseMinWidth = track.item.style.minWidth || '__empty__';
                    track.item.dataset.fpNoOverlapTrack = '1';
                }
                var existingTrackMinimum = parseFloat(track.item.style.minWidth) || 0;
                track.item.style.minWidth = Math.max(existingTrackMinimum, track.width) + 'px';
            }
            var currentMin = parseFloat(rows[ri].style.minWidth) || 0;
            if (intrinsic.requiredWidth > currentMin + 0.5) {
                rows[ri].style.minWidth = intrinsic.requiredWidth + 'px';
                widened = true;
            }
            rows[ri].classList.add('fp-no-overlap-width');
            reservedAny = true;
        }
        if (!widened) break;
    }
    return reservedAny;
    }
    reserveCollidingTracks();
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (row.closest && row.closest('.fp-commandbar')) continue;
        var earlyPanel = row.closest('.fp-pages-active-panel');
        var earlyOwner = row.closest('.fp-item');
        var earlyRootBand = earlyOwner;
        while (earlyRootBand && earlyRootBand.parentNode !== body)
            earlyRootBand = earlyRootBand.parentNode;
        if (!earlyPanel && earlyRootBand && earlyOwner !== earlyRootBand
            && Math.max(row.clientWidth || 0, row.scrollWidth || 0,
                parseFloat(row.style.minWidth) || 0,
                horizontalPreferredWidth(row)) > available + 1) {
            earlyRootBand.classList.add('fp-root-band-overflow');
            earlyRootBand.dataset.fpRootBandOverflow = '1';
        }
        var rowMetrics = horizontalRowMetrics(row);
        var forcedNoOverlap = row.classList.contains('fp-no-overlap-width');
        if (!row.clientWidth || (row.scrollWidth <= row.clientWidth + 1
            && !rowMetrics.collision && !forcedNoOverlap)) continue;
        var rowRect = row.getBoundingClientRect();
        var panel = row.closest('.fp-pages-active-panel');
        if (panel) {
            var panelRect = panel.getBoundingClientRect();
            var panelRequired = Math.ceil(rowRect.left - panelRect.left
                + Math.max(row.scrollWidth, rowMetrics.requiredWidth) + 10);
            var found = false;
            for (var w = 0; w < panelWidths.length; w++) {
                if (panelWidths[w].panel !== panel) continue;
                panelWidths[w].required = Math.max(panelWidths[w].required, panelRequired);
                panelWidths[w].forced = panelWidths[w].forced || rowMetrics.collision || forcedNoOverlap;
                found = true;
                break;
            }
            if (!found) panelWidths.push({
                panel: panel,
                required: panelRequired,
                forced: rowMetrics.collision || forcedNoOverlap
            });
        } else {
            var rowRequired = Math.ceil(rowRect.left - bodyRect.left
                + Math.max(row.scrollWidth, rowMetrics.requiredWidth) + 10);
            /* PagesRepresentation=None deliberately dissolves the active Page
             * panel into the Pages item. Its rows therefore use the body
             * scrollport, but they still must not resize sibling root bands. */
            var flattenedPages = row.closest('.fp-item[data-tag="Pages"].fp-pages-none');
            var owner = row.closest('.fp-item');
            var rootBand = owner;
            while (rootBand && rootBand.parentNode !== body) rootBand = rootBand.parentNode;
            /* An inner authored row owns a local horizontal canvas. Publishing
             * its minimum on the Form made every unrelated root stretch band
             * inherit that width (validation-12: 1192px row on a 992px form).
             * A root item's own row still describes the form-wide authored
             * band and therefore retains the ordinary body scroll contract. */
            if (!flattenedPages && rootBand && owner !== rootBand) {
                var rootEntry = null;
                for (var rb = 0; rb < rootBandWidths.length; rb++) {
                    if (rootBandWidths[rb].band === rootBand) rootEntry = rootBandWidths[rb];
                }
                if (!rootEntry) {
                    rootEntry = { band: rootBand, required: rowRequired };
                    rootBandWidths.push(rootEntry);
                } else rootEntry.required = Math.max(rootEntry.required, rowRequired);
            } else {
                required = Math.max(required, rowRequired);
                if (flattenedPages) flattenedPageOverflow = true;
                else {
                    forceBodyOverflow = forceBodyOverflow || rowMetrics.collision || forcedNoOverlap;
                }
            }
        }
    }
    for (var rbi = 0; rbi < rootBandWidths.length; rbi++) {
        rootBandWidths[rbi].band.classList.add('fp-root-band-overflow');
        rootBandWidths[rbi].band.dataset.fpRootBandOverflow = '1';
    }
    /* A previous projection may have made the root wrapper itself as wide as
     * its inner row, so that row no longer reports scroll overflow against its
     * own rectangle. Recover ownership from the topology: a wide root band
     * containing a deeper horizontal row owns that local canvas. */
    for (var bi = 0; bi < body.children.length; bi++) {
        var directBand = body.children[bi];
        if (!directBand.classList || !directBand.classList.contains('fp-item')
            || directBand.getBoundingClientRect().width <= available + 1) continue;
        var nestedRows = directBand.querySelectorAll('.fp-children-horizontal');
        for (var nr = 0; nr < nestedRows.length; nr++) {
            if (nestedRows[nr].closest('.fp-item') === directBand) continue;
            directBand.classList.add('fp-root-band-overflow');
            directBand.dataset.fpRootBandOverflow = '1';
            break;
        }
    }
    /* A root Page whose row was already widened by reserveCollidingTracks no
     * longer reports overflow against its own box, so the row loop above never
     * listed the Page. Its content still overflows the Page: keep ownership
     * with it (the 12px window lane was enough to flip that on a 420px form). */
    var rootPanels = body.querySelectorAll(':scope > .fp-item[data-tag="Pages"] .fp-pages-active-panel');
    for (var rp = 0; rp < rootPanels.length; rp++) {
        var rootPanel = rootPanels[rp];
        if (rootPanel.scrollWidth <= rootPanel.clientWidth + 1) continue;
        var listed = false;
        for (var lp = 0; lp < panelWidths.length; lp++) if (panelWidths[lp].panel === rootPanel) listed = true;
        if (!listed) panelWidths.push({ panel: rootPanel, required: rootPanel.scrollWidth + 10, forced: true });
    }
    /* A tabbed Pages nested inside a root band does not own a scrollbar of its
     * own: the reference widens that whole band (its search field and
     * right-aligned command bar move with it) and scrolls the Form. Only a
     * Pages that is itself a root item keeps the page-local scrollport. */
    var pageWraps = body.querySelectorAll('.fp-pages-panel-wrap');
    for (var pw = 0; pw < pageWraps.length; pw++) {
        var pageWrap = pageWraps[pw];
        var pagesItem = pageWrap.closest('.fp-item[data-tag="Pages"]');
        if (!pagesItem || pagesItem.parentNode === body) continue;
        var pageOverflow = pageWrap.scrollWidth - pageWrap.clientWidth;
        if (pageOverflow <= 1) continue;
        var canvasBand = pagesItem;
        while (canvasBand && canvasBand.parentNode !== body) canvasBand = canvasBand.parentNode;
        if (!canvasBand || canvasBand.classList.contains('fp-root-band-canvas')) continue;
        var bandRect = canvasBand.getBoundingClientRect();
        var bandWidth = Math.ceil(bandRect.width + pageOverflow);
        canvasBand.classList.add('fp-root-band-canvas');
        canvasBand.style.setProperty('--fp-band-canvas-width', bandWidth + 'px');
        required = Math.max(required, Math.ceil(bandRect.left - bodyRect.left + bandWidth
            + TAXI_LAYOUT_METRICS.pagePadding.horizontal));
    }
    for (var j = 0; j < panelWidths.length; j++) {
        var entry = panelWidths[j];
        if (!entry.forced && entry.required <= entry.panel.clientWidth + 80) continue;
        entry.panel.style.setProperty('--fp-content-width', Math.max(0, entry.required - 4) + 'px');
        entry.panel.classList.add('fp-window-overflow');
        /* A Page owns this wider authored canvas and its scrollbar. The platform
         * keeps independent root bands (for example a right-aligned
         * visibility switch above Pages) viewport-wide; propagating the Page
         * width to body moves those controls beyond the visible right edge. */
    }
    var semanticCanvas = semanticFormCanvasWidth(body, available);
    if (semanticCanvas) {
        required = semanticCanvas;
        forceBodyOverflow = true;
        body.classList.add('fp-semantic-canvas');
        /* The platform lays the whole Form, root Pages included, out on that
         * canvas and scrolls the Form: the page does not keep a local
         * scrollport (the tab strip and page run past the window). */
        var semanticPanels = body.querySelectorAll(
            ':scope > .fp-item[data-tag="Pages"] .fp-pages-active-panel');
        for (var sp = 0; sp < semanticPanels.length; sp++) {
            semanticPanels[sp].classList.remove('fp-window-overflow');
            semanticPanels[sp].style.removeProperty('--fp-content-width');
        }
    }
    /* Tiny overhangs belong to local editors/toolbars and are handled by their
     * own responsive rules. Reserve a window scrollbar for a genuinely wider
     * authored form; otherwise a single button can needlessly widen every
     * top-level section. */
    if (!forceBodyOverflow && required <= available + 80) {
        if (body.classList.contains('fp-vertical-scroll-needed')
            && body.querySelector('.fp-root-flattened-page.fp-root-band-overflow')) {
            body.classList.add('fp-window-overflow');
            body.classList.add('fp-flattened-page-overflow');
            fitPageTabs(body);
            fitChartFields(body);
            reserveCollidingTracks();
            return true;
        }
        fitPageTabs(body);
        fitChartFields(body);
        reserveCollidingTracks();
        return body.querySelectorAll('.fp-pages-active-panel.fp-window-overflow').length > 0;
    }
    body.style.setProperty('--fp-content-width', Math.max(0, required - 20) + 'px');
    body.classList.add('fp-window-overflow');
    if (flattenedPageOverflow && !forceBodyOverflow)
        body.classList.add('fp-flattened-page-overflow');
    /* The widened canvas is the width the platform hands the Pages item, so the
     * tabs have to be shared out again against it. */
    fitPageTabs(body);
    fitChartFields(body);
    /* Publishing the scroll canvas and root-band overflow classes changes the
     * flex allocation after the collision pass above: a track that fitted the
     * reset viewport may be squeezed under its painted content only now (e.g.
     * a footer group at 480px). Reserve once more against the
     * final classes; this never resets, so widths only grow. */
    reserveCollidingTracks();
    return true;
}

/* The browser implements the geometry with CSS/DOM measurements, but records
 * one effective horizontal strategy per pass so one resize pass cannot
 * accidentally mix an old narrow decision with a new wide viewport. */
function selectHorizontalStrategy(state) {
    state = state || {};
    if (state.compressWidth) return 'compress-width';
    if ((state.titlesOnTop || 0) > 0) return 'titles-on-top';
    if ((state.dontAlignTitles || 0) > 0) return 'dont-align-titles';
    if (state.smartCompressToMinWidth) return 'smart-compress-to-min-width';
    if ((state.dontAlignButtons || 0) > 0) return 'dont-align-buttons';
    if ((state.verticalGrouping || 0) > 0) return 'vertical-grouping';
    if ((state.smartCompressToRecommendedWidth || 0) > 0) return 'smart-compress-to-recommended-width';
    return 'auto';
}

/* The reference static-text transformation keeps the normal wrapped variant until a
 * narrower word-break variant is needed. Measure both in the actual DOM font,
 * including formatted spans; stale heights and character-count estimates do
 * not describe width-dependent content. CSS reflows the live label and its
 * following siblings; this pass only counts the compressed labels. */
function wrappedLabelPressure(body) {
    if (!body || !body.querySelectorAll) return 0;
    var labels = body.querySelectorAll('[data-fp-wrap-normal-width]');
    var compressed = 0;
    for (var i = 0; i < labels.length; i++) {
        var label = labels[i];
        var rect = label.getBoundingClientRect();
        var normalWidth = parseFloat(label.dataset.fpWrapNormalWidth) || 0;
        if (!rect.width || !rect.height || rect.width >= normalWidth - 1) continue;
        var probe = label.cloneNode(true);
        probe.removeAttribute('data-fp-wrap-normal-width');
        probe.removeAttribute('id');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText += ';position:absolute;visibility:hidden;pointer-events:none;'
            + 'display:block;flex:none;width:' + normalWidth + 'px;max-width:none;min-width:0;'
            + 'height:auto;min-height:0;max-height:none;';
        label.parentNode.appendChild(probe);
        var normalHeight = probe.getBoundingClientRect().height;
        label.parentNode.removeChild(probe);
        if (normalHeight > 0 && rect.height > normalHeight + 1) compressed++;
    }
    return compressed;
}

function horizontalPriorityPressure(body) {
    var result = { smartCompressToMinWidth: false, compressWidth: false };
    if (!body || !body.querySelectorAll) return result;
    var boxes = body.querySelectorAll('.fp-children-horizontal');
    for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        if (!box.clientWidth) continue;
        var available = body.clientWidth || box.clientWidth;
        var preferred = horizontalPreferredWidth(box);
        if (preferred <= available + 1) continue;
        if (horizontalCompressedWidth(box, true) > available + 1) result.compressWidth = true;
        else result.smartCompressToMinWidth = true;
    }
    return result;
}

/* The reference evaluates an authored-width field in a vertical column against that
 * column's available width too. Flex may already have shrunk the browser
 * control to a collision-free rectangle, so retain the pre-flex Width signal.
 * AutoRows is the minimal native case: Width=40 resolves to 400 layout px
 * plus 10px input chrome, needs compression at viewport 400, and none when
 * the viewport widens to 480. */
function verticalFieldPriorityPressure(body, settledCanvas) {
    var result = { smartCompressToMinWidth: false, compressWidth: false };
    if (!body || !body.querySelectorAll) return result;
    var items = body.querySelectorAll('.fp-item.fp-hstretch[data-fp-authored-normal-width]');
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var parent = item.parentNode;
        if (!parent || !parent.classList
            || (!parent.classList.contains('fp-children-vertical')
                && !parent.classList.contains('fp-body'))) continue;
        var available = parent.clientWidth || 0;
        if (settledCanvas && available) available += verticalColumnCanvasOverflow(parent, body);
        var normal = parseFloat(item.dataset.fpAuthoredNormalWidth) || 0;
        if (!available || normal <= available + 1) continue;
        if (TAXI_LAYOUT_METRICS.responsiveCompressedElementMinimumWidth > available + 1)
            result.compressWidth = true;
        else result.smartCompressToMinWidth = true;
    }
    return result;
}

/* A vertical column is as wide as its widest row. After fitFormViewport a
 * sibling row whose native minimum exceeds the reset viewport overflows the
 * column (scrollWidth > clientWidth) instead of widening it; the width
 * allocation later publishes that width. Report the overflow up to the owning
 * horizontal row, i.e. the extra width the column is going to receive. */
function verticalColumnCanvasOverflow(column, body) {
    var overflow = 0;
    for (var node = column; node && node !== body; node = node.parentElement) {
        if (node !== column && node.classList && node.classList.contains('fp-children-horizontal')) break;
        overflow = Math.max(overflow, (node.scrollWidth || 0) - (node.clientWidth || 0));
    }
    return Math.max(0, overflow);
}

function rootSimpleVerticalColumnWidth(normalWidths, available, strategyValue) {
    if (!normalWidths || !normalWidths.length || !(available > 0)) return 0;
    var normal = normalWidths.reduce(function (maximum, width) {
        width = Number(width) || 0;
        return Math.max(maximum, width);
    }, 0);
    if (!normal) return 0;
    /* The reference's root Vertical grid has one shared column. Without horizontal
     * pressure the form stops at that column's normal width; under pressure the scroll
     * panel takes the complete logical viewport and every row shares it. */
    return Math.round(strategyValue === 0 ? Math.min(available, normal) : available);
}

function fitRootSimpleVerticalColumn(body, strategyValue) {
    if (!body || !body.children) return 0;
    if (body.classList) body.classList.remove('fp-root-simple-vertical-column');
    var previousRows = body.querySelectorAll('[data-fp-root-authored-row-cap="1"]');
    for (var p = 0; p < previousRows.length; p++) {
        var previous = previousRows[p];
        previous.style.width = previous.dataset.fpRootRowBaseWidth === '__empty__'
            ? '' : previous.dataset.fpRootRowBaseWidth;
        previous.style.minWidth = previous.dataset.fpRootRowBaseMinWidth === '__empty__'
            ? '' : previous.dataset.fpRootRowBaseMinWidth;
        previous.style.maxWidth = previous.dataset.fpRootRowBaseMaxWidth === '__empty__'
            ? '' : previous.dataset.fpRootRowBaseMaxWidth;
        previous.style.flex = previous.dataset.fpRootRowBaseFlex === '__empty__'
            ? '' : previous.dataset.fpRootRowBaseFlex;
        previous.style.alignSelf = previous.dataset.fpRootRowBaseAlignSelf === '__empty__'
            ? '' : previous.dataset.fpRootRowBaseAlignSelf;
        delete previous.dataset.fpRootAuthoredRowCap;
    }
    var visibleRootItems = [];
    for (var rootIndex = 0; rootIndex < body.children.length; rootIndex++) {
        var rootItem = body.children[rootIndex];
        if (rootItem.classList && rootItem.classList.contains('fp-item')
            && rootItem.getBoundingClientRect().height) visibleRootItems.push(rootItem);
    }
    if (strategyValue === 0 && visibleRootItems.length === 1
        && visibleRootItems[0].classList.contains('fp-container')) {
        var owner = visibleRootItems[0];
        var boxes = owner.querySelectorAll('.fp-children-horizontal');
        var box = null;
        for (var boxIndex = 0; boxIndex < boxes.length; boxIndex++) {
            if (boxes[boxIndex].closest('.fp-item') === owner) { box = boxes[boxIndex]; break; }
        }
        var rowItems = box ? Array.prototype.filter.call(box.children, function (child) {
            return child.classList && child.classList.contains('fp-item');
        }) : [];
        var authoredLeafRow = box && box.dataset.fpGroupMode === 'always-horizontal'
            && rowItems.length > 1 && rowItems.every(function (child) {
                var tag = String(child.dataset && child.dataset.tag || '');
                return child.dataset.fpAuthoredWidthPresent === '1'
                    && (tag === 'InputField' || tag === 'ValueList' || tag === 'LabelField')
                    && !child.classList.contains('fp-has-tooltip-link');
            });
        if (authoredLeafRow) {
            var normal = rowItems.reduce(function (sum, child) {
                return sum + itemHorizontalAllocationBand(child).normal;
            }, 0);
            var boxStyle = getComputedStyle(box);
            var browserGap = parseFloat(boxStyle.columnGap || boxStyle.gap || '') || 0;
            normal += browserGap * (REF_AUTHORED_CHAR_PX / CHAR_PX) * (rowItems.length - 1);
            var ownerStyle = getComputedStyle(owner);
            normal += (parseFloat(ownerStyle.paddingLeft) || 0) + (parseFloat(ownerStyle.paddingRight) || 0)
                + (parseFloat(ownerStyle.borderLeftWidth) || 0) + (parseFloat(ownerStyle.borderRightWidth) || 0);
            normal = Math.ceil(normal);
            if (normal > 0 && body.clientWidth >= normal) {
                if (!Object.prototype.hasOwnProperty.call(owner.dataset, 'fpRootRowBaseWidth')) {
                    owner.dataset.fpRootRowBaseWidth = owner.style.width || '__empty__';
                    owner.dataset.fpRootRowBaseMinWidth = owner.style.minWidth || '__empty__';
                    owner.dataset.fpRootRowBaseMaxWidth = owner.style.maxWidth || '__empty__';
                    owner.dataset.fpRootRowBaseFlex = owner.style.flex || '__empty__';
                    owner.dataset.fpRootRowBaseAlignSelf = owner.style.alignSelf || '__empty__';
                }
                owner.style.width = normal + 'px';
                owner.style.minWidth = normal + 'px';
                owner.style.maxWidth = normal + 'px';
                owner.style.flex = '0 0 auto';
                owner.style.alignSelf = 'flex-start';
                owner.dataset.fpRootAuthoredRowCap = '1';
                return 1;
            }
        }
    }
    var children = [];
    for (var i = 0; i < body.children.length; i++) {
        var child = body.children[i];
        if (!child.classList || !child.classList.contains('fp-item')
            || !child.getBoundingClientRect().height) continue;
        if (child.dataset.tag !== 'InputField' && child.dataset.tag !== 'LabelField') return 0;
        var normal = parseFloat(child.dataset.fpAuthoredNormalWidth) || 0;
        if (!normal) return 0;
        var row = child.querySelector(':scope > .fp-control-wrap.fp-field-row');
        var sideTitle = row && (row.classList.contains('fp-title-left') || row.classList.contains('fp-title-right'))
            ? row.querySelector('.fp-field-label') : null;
        if (sideTitle) normal += labelMetric(sideTitle) + 5;
        children.push({ node: child, normal: normal });
    }
    if (!children.length) return 0;
    if (body.classList) body.classList.add('fp-root-simple-vertical-column');
    var width = rootSimpleVerticalColumnWidth(children.map(function (entry) { return entry.normal; }),
        body.clientWidth, strategyValue);
    if (!width) return 0;
    for (var c = 0; c < children.length; c++) {
        var node = children[c].node;
        node.style.width = width + 'px';
        node.style.minWidth = width + 'px';
        node.style.maxWidth = width + 'px';
        node.style.flex = '0 0 auto';
        var textarea = node.querySelector('textarea.fp-input');
        var authoredHeight = parseInt(prop(node._fpItem, ['Height', 'Высота']), 10) || 0;
        if (textarea && !authoredHeight) {
            /* Native TextBox's absent multiline Height is a two-row 55px
             * normal band. It is not implicit VerticalStretch: a simple root
             * form with two text areas must still leave the following field
             * immediately below them instead of sharing the viewport height. */
            node.style.height = '55px';
            node.style.minHeight = '55px';
            node.style.maxHeight = '55px';
            var fieldRow = node.querySelector(':scope > .fp-control-wrap.fp-field-row');
            if (fieldRow) fieldRow.style.height = '100%';
        }
    }
    return children.length;
}

function horizontalStrategyValue(strategy) {
    return Object.prototype.hasOwnProperty.call(HORIZONTAL_STRATEGY_VALUES, strategy)
        ? HORIZONTAL_STRATEGY_VALUES[strategy] : 0;
}

function commandBarOverflowCount(body) {
    if (!body || !body.querySelectorAll) return 0;
    return body.querySelectorAll('.fp-commandbar .fp-bar-overflow-hidden').length;
}

function refitCommandBars(body) {
    if (!body || !body.querySelectorAll) return;
    var bars = body.querySelectorAll('.fp-commandbar');
    for (var i = 0; i < bars.length; i++) fitCommandBar(bars[i]);
}

/* HorizontalLocation=Right is a trailing lane, not intrinsic row content.
 * A content-sized parent gives it no independent preferred width; an authored
 * parent width reserves the native primary-action plus More band. */
function rightCommandBarLane(parentItem, parentElement) {
    var authoredWidth = parseInt(prop(parentItem, ['Width', 'Ширина']), 10) || 0;
    if (authoredWidth > 0) return 160;
    var stretches = isTrue(prop(parentItem, ['HorizontalStretch', 'ГоризонтальноеРастягивание']))
        || (parentElement && parentElement.classList
            && parentElement.classList.contains('fp-hstretch'));
    return stretches ? -1 : 0;
}

function fitRightCommandBarLanes(body) {
    if (!body || !body.querySelectorAll) return;
    var items = body.querySelectorAll('.fp-item[data-tag="CommandBar"].fp-align-right');
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var owner = item.parentElement && item.parentElement.closest
            ? item.parentElement.closest('.fp-item.fp-container') : null;
        var lane = rightCommandBarLane(owner && owner._fpItem, owner);
        if (lane < 0) continue;
        if (!lane) continue;
        var bar = item.querySelector('.fp-commandbar');
        /* The lane is a primary action plus «Еще». A bar without More keeps
         * its whole commands. */
        if (!bar || !bar.querySelector('.fp-more-item')) continue;
        item.style.width = lane + 'px';
        item.style.minWidth = lane + 'px';
        item.style.maxWidth = lane + 'px';
        /* flex-basis is a height in a vertical owner. */
        var laneRow = item.parentElement && getComputedStyle(item.parentElement).flexDirection.indexOf('row') === 0;
        item.style.flex = laneRow ? '0 0 ' + lane + 'px' : '0 0 auto';
        item.style.marginLeft = 'auto';
        if (bar) {
            bar._fpRightLanePrimary = true;
            bar.style.width = (lane - 2) + 'px';
            bar.style.maxWidth = (lane - 2) + 'px';
            fitCommandBar(bar);
        }
    }
}

function fitAuthoredTableHeights(body) {
    var previousCrossAxis = body.querySelectorAll('[data-fp-table-cross-normal]');
    for (var pc = 0; pc < previousCrossAxis.length; pc++) {
        previousCrossAxis[pc].style.flexBasis = previousCrossAxis[pc].dataset.fpTableCrossBaseBasis;
        delete previousCrossAxis[pc].dataset.fpTableCrossNormal;
        delete previousCrossAxis[pc].dataset.fpTableCrossBaseBasis;
    }
    var tables = body.querySelectorAll('.fp-table-authored-height');
    var scrollportOverflow = body.scrollHeight > body.clientHeight + 2;
    for (var i = 0; i < tables.length; i++) {
        var item = tables[i];
        var widget = item.querySelector('.fp-table-widget');
        var grid = widget && widget.querySelector('.fp-table-mock');
        if (!grid || !item.getBoundingClientRect().width) continue;
        var itemStyle = window.getComputedStyle(item);
        var chrome = (parseFloat(itemStyle.paddingTop) || 0)
            + (parseFloat(itemStyle.paddingBottom) || 0)
            + (parseFloat(itemStyle.borderTopWidth) || 0)
            + (parseFloat(itemStyle.borderBottomWidth) || 0);
        var itemInsets = chrome;
        /* The grid's own margin (8px under the filter chips) is chrome too;
         * leaving it out shortened grids by 8px (83/53 instead of 91/61). */
        var gridStyle = window.getComputedStyle(grid);
        chrome += (parseFloat(gridStyle.marginTop) || 0) + (parseFloat(gridStyle.marginBottom) || 0);
        for (var c = 0; c < widget.children.length; c++) {
            var child = widget.children[c];
            if (child === grid) continue;
            var childStyle = window.getComputedStyle(child);
            chrome += child.getBoundingClientRect().height
                + (parseFloat(childStyle.marginTop) || 0)
                + (parseFloat(childStyle.marginBottom) || 0);
        }
        var minimum = parseFloat(window.getComputedStyle(grid).minHeight) || 0;
        var normal = parseFloat(item.dataset.fpTableNormalHeight) || 0;
        if (item.closest('.fp-page-table-chrome-cadence')
            && widget.querySelector(':scope > .fp-chips')) {
            widget.style.rowGap = TAXI_LAYOUT_METRICS.verticalSpacing.single + 'px';
            chrome += TAXI_LAYOUT_METRICS.verticalSpacing.single * Math.max(0, widget.children.length - 1);
        }
        /* A vertical flex item uses Height as its preferred basis. Fixed
         * tables retain it, stretching siblings share the remaining space.
         * The measured chrome keeps a compressed grid inside its own item. */
        var crossAxisStretch = item.classList.contains('fp-vstretch')
            && window.getComputedStyle(item.parentNode).flexDirection === 'row';
        if (crossAxisStretch) {
            /* A table in a horizontal row contributes its preferred height to
             * that row's vertical size. Putting the basis on the inner widget
             * is insufficient: align-self:stretch sizes the table from the
             * already chosen row height and the row collapses to its minimum.
             * Carry the preference to the enclosing flex item; its own minimum
             * remains independently compressible. */
            var crossCarrier = item.parentNode && item.parentNode.closest
                ? item.parentNode.closest('.fp-item') : null;
            if (crossCarrier && crossCarrier !== item) {
                var crossNormal = Math.max(normal, minimum) + chrome;
                if (!Object.prototype.hasOwnProperty.call(crossCarrier.dataset, 'fpTableCrossNormal')) {
                    crossCarrier.dataset.fpTableCrossBaseBasis = crossCarrier.style.flexBasis;
                    crossCarrier.dataset.fpTableCrossNormal = String(crossNormal);
                } else {
                    crossNormal = Math.max(crossNormal,
                        parseFloat(crossCarrier.dataset.fpTableCrossNormal) || 0);
                    crossCarrier.dataset.fpTableCrossNormal = String(crossNormal);
                }
                crossCarrier.style.flexBasis = crossNormal + 'px';
            }
        }
        /* The presentation allocator distributes grid height in proportion to
         * its preferred size, with fixed chrome outside the ratio. CSS shrink
         * normally weights the whole item (including chrome); compensate for
         * that basis. Apply only to a vertical cohort of authored tables. */
        var tableCohort = !crossAxisStretch && item.classList.contains('fp-vstretch');
        var hasGenericStretchSibling = false;
        var hasNestedTableStretchSibling = false;
        /* A formatted document beside the table takes the whole surplus and
         * the table keeps its HeightInTableRows (e.g. two rows under a
         * stretched letter body). */
        var hasDocumentStretchSibling = false;
        for (var s = 0; tableCohort && s < item.parentNode.children.length; s++) {
            var sibling = item.parentNode.children[s];
            if (sibling.classList.contains('fp-vstretch')
                && !sibling.classList.contains('fp-table-authored-height')
                && sibling.getBoundingClientRect().height) {
                hasGenericStretchSibling = true;
                if (sibling.querySelector('.fp-table-authored-height'))
                    hasNestedTableStretchSibling = true;
                if (sibling.dataset.tag === 'FormattedDocumentField')
                    hasDocumentStretchSibling = true;
            }
        }
        if (tableCohort) {
            if (!Object.prototype.hasOwnProperty.call(item.dataset, 'fpTableBaseFlexGrow')) {
                item.dataset.fpTableBaseFlexGrow = item.style.flexGrow;
                item.dataset.fpTableBaseFlexShrink = item.style.flexShrink;
                item.dataset.fpTableBaseFlexBasis = item.style.flexBasis;
            }
            /* A lone table in an already overflowing form keeps its preferred
             * height: there is no viewport surplus left for it to claim. A
             * real mixed stretch cohort still runs its local allocator even
             * when some outer scrollport happens to overflow. */
            item.style.flexGrow = hasNestedTableStretchSibling || hasDocumentStretchSibling ? '0'
                : (scrollportOverflow && !hasGenericStretchSibling ? '0'
                    : String(hasGenericStretchSibling ? normal + chrome - itemInsets : normal));
            item.style.flexShrink = String(normal / (Math.max(normal, minimum) + chrome - itemInsets));
            if (hasGenericStretchSibling) {
                item.style.flexBasis = hasNestedTableStretchSibling || hasDocumentStretchSibling
                    ? (Math.max(normal, minimum) + chrome) + 'px' : '0px';
                for (var gs = 0; gs < item.parentNode.children.length; gs++) {
                    var generic = item.parentNode.children[gs];
                    if (!generic.classList.contains('fp-vstretch')
                        || generic.classList.contains('fp-table-authored-height')) continue;
                    if (!Object.prototype.hasOwnProperty.call(generic.dataset, 'fpMixedBaseFlex'))
                        generic.dataset.fpMixedBaseFlex = generic.style.flex || '__empty__';
                    generic.style.flex = hasDocumentStretchSibling
                        ? (generic.dataset.tag === 'FormattedDocumentField' ? '1 1 0px' : '0 1 auto')
                        : hasNestedTableStretchSibling
                        ? '1 1 0px'
                        : (parseFloat(generic.dataset.fpVerticalNormalHeight) || 77) + ' 1 0px';
                }
            }
        } else if (Object.prototype.hasOwnProperty.call(item.dataset, 'fpTableBaseFlexGrow')) {
            /* Responsive orientation may already have restored horizontal flex. */
            if (item.style.flexGrow === String(normal)
                || item.style.flexGrow === String(normal + chrome - itemInsets)
                || item.style.flexGrow === '0') {
                item.style.flexGrow = item.dataset.fpTableBaseFlexGrow;
                item.style.flexShrink = item.dataset.fpTableBaseFlexShrink;
                item.style.flexBasis = item.dataset.fpTableBaseFlexBasis;
            }
            delete item.dataset.fpTableBaseFlexGrow;
            delete item.dataset.fpTableBaseFlexShrink;
            delete item.dataset.fpTableBaseFlexBasis;
        }
        if (!hasGenericStretchSibling) {
            for (var rs = 0; rs < item.parentNode.children.length; rs++) {
                var restored = item.parentNode.children[rs];
                if (!Object.prototype.hasOwnProperty.call(restored.dataset, 'fpMixedBaseFlex')) continue;
                restored.style.flex = restored.dataset.fpMixedBaseFlex === '__empty__'
                    ? '' : restored.dataset.fpMixedBaseFlex;
                delete restored.dataset.fpMixedBaseFlex;
            }
        }
        /* An explicit cross-axis height disables align-self:stretch. Keep
         * the preference on the widget when the parent is a horizontal row. */
        item.style.height = crossAxisStretch ? 'auto' : (Math.max(normal, minimum) + chrome) + 'px';
        widget.style.flexBasis = crossAxisStretch ? (Math.max(normal, minimum) + chrome) + 'px' : '0px';
        item.style.minHeight = (minimum + chrome) + 'px';
        var maximum = parseFloat(item.dataset.fpTableMaxHeight) || 0;
        if (maximum) item.style.maxHeight = (Math.max(maximum, minimum) + chrome) + 'px';
    }
    fitTableAncestorMinimums(body, tables);
}

function tableChromePreferredWidth(node) {
    if (!node || typeof window === 'undefined') return 0;
    var style = window.getComputedStyle(node);
    var width = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
        + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
    var visible = 0;
    for (var i = 0; i < node.children.length; i++) {
        var child = node.children[i];
        var childStyle = window.getComputedStyle(child);
        if (childStyle.display === 'none' || childStyle.position === 'absolute') continue;
        width += child.getBoundingClientRect().width
            + (parseFloat(childStyle.marginLeft) || 0)
            + (parseFloat(childStyle.marginRight) || 0);
        visible++;
    }
    if (visible > 1)
        width += (visible - 1) * (parseFloat(style.columnGap || style.gap) || 0);
    return Math.max(Math.ceil(width), Math.ceil(node.scrollWidth || 0));
}

function fitAuthoredTableWidths(body) {
    if (!body || !body.querySelectorAll) return;
    var tables = body.querySelectorAll('.fp-table-authored-width');
    for (var i = 0; i < tables.length; i++) {
        var item = tables[i];
        var widget = item.querySelector('.fp-table-widget');
        var grid = widget && widget.querySelector('.fp-table-mock');
        if (!widget || !grid) continue;
        var gridWidth = parseFloat(item.dataset.fpTableGridWidth)
            || parseFloat(item.dataset.fpAuthoredNormalWidth) || 0;
        if (!gridWidth) continue;

        /* The native table generator fixes the logical grid band, not the
         * surrounding vertical group. Toolbar/search/status chrome remains a
         * sibling of that grid and may publish a wider preferred size (the
         * common 400px grid + automatic bar case is 451px in the reference). Restore the
         * bar before measuring so a previous narrow resize cannot permanently
         * hide commands and make the next wide pass underestimate the shell. */
        var toolbar = widget.querySelector('.fp-table-toolbar');
        if (toolbar) {
            var hidden = toolbar.querySelectorAll('.fp-bar-overflow-hidden');
            for (var h = 0; h < hidden.length; h++)
                hidden[h].classList.remove('fp-bar-overflow-hidden');
        }
        var chromeWidths = [];
        for (var c = 0; c < widget.children.length; c++) {
            var child = widget.children[c];
            if (child === grid) continue;
            chromeWidths.push(tableChromePreferredWidth(child));
        }
        var metrics = tableWidgetWidthMetrics(gridWidth, chromeWidths);
        grid.style.width = metrics.grid + 'px';
        grid.style.minWidth = metrics.grid + 'px';
        grid.style.maxWidth = metrics.grid + 'px';
        grid.style.alignSelf = 'flex-start';
        widget.style.width = metrics.widget + 'px';
        widget.style.minWidth = metrics.widget + 'px';
        widget.style.maxWidth = 'none';
        item.style.width = metrics.widget + 'px';
        item.style.minWidth = metrics.widget + 'px';
        item.style.maxWidth = 'none';
        item.dataset.fpTableWidgetWidth = String(metrics.widget);
        if (item.parentNode && window.getComputedStyle(item.parentNode).flexDirection === 'row')
            item.style.flex = '0 0 ' + metrics.widget + 'px';
        if (toolbar) fitCommandBar(toolbar);
    }
}

function fitPhysicalTableColumnWidths(body) {
    if (!body || !body.querySelectorAll || typeof window === 'undefined') return 0;
    var grids = body.querySelectorAll('.fp-table-mock');
    var fitted = 0;
    for (var i = 0; i < grids.length; i++) {
        var grid = grids[i];
        var table = grid.querySelector('table');
        var cols = table && table.querySelectorAll('colgroup > col');
        if (!table || !cols || !cols.length) continue;
        var minima = [];
        for (var c = 0; c < cols.length; c++)
            minima.push(parseFloat(cols[c].dataset.fpMinWidth) || parseFloat(cols[c].style.width) || 0);
        var style = window.getComputedStyle(grid);
        var viewport = grid.clientWidth
            - (parseFloat(style.paddingLeft) || 0)
            - (parseFloat(style.paddingRight) || 0);
        var widths = allocateTableColumnWidths(minima, viewport);
        var total = 0;
        for (var w = 0; w < widths.length; w++) {
            cols[w].style.width = widths[w] + 'px';
            total += widths[w];
        }
        table.style.width = total + 'px';
        table.style.minWidth = total + 'px';
        table.style.maxWidth = total + 'px';
        var overflowX = total > viewport + 1;
        grid.classList.toggle('fp-table-overflow-x', overflowX);
        var overflowY = table.scrollHeight > grid.clientHeight + 1;
        grid.classList.toggle('fp-table-overflow-y', overflowY);
        /* Native WebView/Edge scrollbars are visible in the real hosts and
         * already own their layout lane. Do not paint a second DOM bar next
         * to the native one. */
        var syntheticBars = grid.querySelectorAll(':scope > .fp-table-scrollbar');
        for (var sb = 0; sb < syntheticBars.length; sb++) syntheticBars[sb].remove();
        fitted++;
    }
    return fitted;
}

function fitTableAncestorMinimums(body, tables) {
    /* Carry minima through flex wrappers, stopping at the actual scrollport.
     * min-content would also carry the preferred Height and prevent shrinking. */
    var previous = body.querySelectorAll('[data-fp-table-ancestor-min]');
    for (var p = 0; p < previous.length; p++) {
        previous[p].style.minHeight = previous[p].dataset.fpTableAncestorMin;
        delete previous[p].dataset.fpTableAncestorMin;
    }
    var ancestors = [];
    for (var i = 0; i < tables.length; i++) {
        var parent = tables[i].parentNode;
        while (parent && parent !== body && !parent.classList.contains('fp-pages-active-panel')) {
            if (ancestors.indexOf(parent) < 0) ancestors.push(parent);
            parent = parent.parentNode;
        }
    }
    ancestors.sort(function (a, b) {
        return a.contains(b) ? 1 : b.contains(a) ? -1 : 0;
    });
    for (var a = 0; a < ancestors.length; a++) {
        var node = ancestors[a], style = window.getComputedStyle(node);
        if (style.display !== 'flex' || !node.getBoundingClientRect().width) continue;
        var column = style.flexDirection !== 'row', content = 0, count = 0;
        for (var c = 0; c < node.children.length; c++) {
            var child = node.children[c], childStyle = window.getComputedStyle(child);
            if (childStyle.display === 'none' || childStyle.position === 'absolute') continue;
            var minimum = parseFloat(childStyle.minHeight) || 0;
            if (ancestors.indexOf(child) < 0 && !child.classList.contains('fp-vstretch'))
                minimum = Math.max(minimum, child.getBoundingClientRect().height);
            minimum += (parseFloat(childStyle.marginTop) || 0) + (parseFloat(childStyle.marginBottom) || 0);
            content = column ? content + minimum : Math.max(content, minimum);
            count++;
        }
        if (column && count > 1) content += (count - 1) * (parseFloat(style.rowGap) || 0);
        node.dataset.fpTableAncestorMin = node.style.minHeight;
        node.style.minHeight = Math.max(parseFloat(style.minHeight) || 0, content + (parseFloat(style.paddingTop) || 0)
            + (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderTopWidth) || 0)
            + (parseFloat(style.borderBottomWidth) || 0)) + 'px';
    }
}

/* GroupVerticalAlign=Bottom normally moves only its own item down. When a
 * surface that can take height (an HTML/table/document field or a vertically
 * stretched item) precedes it, the free height belongs to that surface, so
 * the ordinary items between the surface and the anchor go down together
 * with it: labels below a transparent HTML field sit right above the bottom
 * bar. Cards without such a surface keep their text at the top and only
 * the anchored links at the bottom. */
var VERTICAL_SURFACE_TAGS = {
    HTMLDocumentField: 1, Table: 1, SpreadSheetDocumentField: 1, TextDocumentField: 1,
    ChartField: 1, GanttChartField: 1, PlannerField: 1, GraphicalSchemaField: 1,
    FormattedDocumentField: 1, GeographicsField: 1, Pages: 1
};

function anchorBottomAlignedRuns(body) {
    if (!body || !body.querySelectorAll) return 0;
    var anchors = body.querySelectorAll('.fp-children-vertical > .fp-item.fp-align-bottom');
    var moved = 0;
    for (var i = 0; i < anchors.length; i++) {
        var start = anchors[i];
        var surface = null;
        for (var sibling = start.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
            if (!sibling.classList || !sibling.classList.contains('fp-item')
                || sibling.hidden || sibling.style.display === 'none') continue;
            if (sibling.classList.contains('fp-align-bottom')) break;
            if (sibling.classList.contains('fp-vstretch')
                || VERTICAL_SURFACE_TAGS[sibling.dataset && sibling.dataset.tag]) {
                surface = sibling;
                break;
            }
            start = sibling;
        }
        if (!surface || start === anchors[i]) continue;
        anchors[i].style.marginTop = '';
        start.style.marginTop = 'auto';
        start.classList.add('fp-bottom-run-start');
        moved++;
    }
    return moved;
}

/* A vertical group with an authored Width and HorizontalStretch=false is a
 * hard column in the reference: every row ends on its right edge. The trailing editor
 * of each row absorbs the difference - it compresses down to the field
 * minimum, and grows only when it is not itself fixed (the browser bands
 * would otherwise put the row ends 44-103px past the column edge). */
function restoreFixedWidthColumnEdges(body) {
    var edited = body.querySelectorAll('[data-fp-column-edge-base]');
    for (var i = 0; i < edited.length; i++) {
        var base = JSON.parse(edited[i].dataset.fpColumnEdgeBase);
        edited[i].style.width = base[0];
        edited[i].style.minWidth = base[1];
        edited[i].style.maxWidth = base[2];
        edited[i].style.flex = base[3];
        delete edited[i].dataset.fpColumnEdgeBase;
    }
}

function fitFixedWidthColumnEdges(body) {
    if (!body || !body.querySelectorAll) return 0;
    restoreFixedWidthColumnEdges(body);
    var columns = body.querySelectorAll(
        '.fp-item.fp-container-vertical.fp-sized-width[data-fp-authored-fixed-width="1"]');
    var fitted = 0;
    function trailingEditor(row) {
        var wraps = row.querySelectorAll('.fp-field-row.fp-title-left > .fp-input-wrap, '
            + '.fp-field-row.fp-title-none > .fp-input-wrap');
        var best = null, bestRight = -Infinity;
        for (var w = 0; w < wraps.length; w++) {
            var right = wraps[w].getBoundingClientRect().right;
            if (right > bestRight) { best = wraps[w]; bestRight = right; }
        }
        return best;
    }
    for (var c = 0; c < columns.length; c++) {
        var column = columns[c];
        var width = parseFloat(column.dataset.fpAuthoredDecisionWidth || '');
        var box = directLayoutChildren(column);
        if (!(width > 0) || !box || !box.classList.contains('fp-children-vertical')) continue;
        var edge = column.getBoundingClientRect().left + width;
        var rows = directFpItems(box);
        for (var r = 0; r < rows.length; r++) {
            var editor = trailingEditor(rows[r]);
            /* A nested fixed column is fitted by its own entry. */
            if (!editor || editor.closest('.fp-item.fp-container-vertical.fp-sized-width') !== column) continue;
            var rect = editor.getBoundingClientRect();
            /* The row ends at its last painted piece, which may follow the
             * editor: a «?» tooltip marker or an action button. */
            var rowRight = rect.right;
            var painted = rows[r].querySelectorAll('.fp-input-wrap, .fp-tooltip-link, .fp-button, .fp-link, .fp-field-label');
            for (var p = 0; p < painted.length; p++)
                rowRight = Math.max(rowRight, painted[p].getBoundingClientRect().right);
            var delta = edge - rowRight;
            if (Math.abs(delta) < 0.5) continue;
            var owner = editor.closest('.fp-item.fp-control');
            /* Only a stretchable editor grows: an explicit stretch or an
             * automatic-width reference field. A short string keeps its type
             * band (e.g. КПП/ОГРН). */
            if (delta > 0 && (!owner || owner.dataset.fpAuthoredFixedWidth === '1'
                || owner.dataset.fpAuthoredWidthPresent === '1'
                || !(owner.classList.contains('fp-hstretch') || owner.dataset.fieldKind === 'ref'))) continue;
            var next = Math.max(TAXI_LAYOUT_METRICS.compressedFieldMinimumWidth, Math.round(rect.width + delta));
            editor.dataset.fpColumnEdgeBase = JSON.stringify([editor.style.width, editor.style.minWidth,
                editor.style.maxWidth, editor.style.flex]);
            editor.style.width = next + 'px';
            editor.style.minWidth = next + 'px';
            editor.style.maxWidth = next + 'px';
            editor.style.flex = '0 0 ' + next + 'px';
            fitted++;
        }
    }
    return fitted;
}

function runHorizontalStrategyPass(body) {
    if (!body) return { strategy: 'auto' };
    resetFormViewport(body);
    revertPromotedAutoTitles(body);
    resetDetachedColumnRows(body);
    var responsiveBoxes = body.querySelectorAll('[data-fp-responsive-group="1"]');
    for (var responsiveIndex = 0; responsiveIndex < responsiveBoxes.length; responsiveIndex++)
        setResponsiveGroupOrientation(responsiveBoxes[responsiveIndex], 'horizontal');
    fitAuthoredTableWidths(body);
    var allocatedRows = applyHorizontalWidthAllocations(body);
    var pressure = horizontalPriorityPressure(body);
    var rowSmartCompressPressure = pressure.smartCompressToMinWidth;
    var verticalPressure = verticalFieldPriorityPressure(body);
    pressure.smartCompressToMinWidth = pressure.smartCompressToMinWidth
        || verticalPressure.smartCompressToMinWidth;
    pressure.compressWidth = pressure.compressWidth || verticalPressure.compressWidth;
    var state = {
        verticalGrouping: prepareResponsiveGroups(body),
        dontAlignButtons: commandBarOverflowCount(body),
        dontAlignTitles: 0,
        titlesOnTop: promoteOverflowingAutoTitles(body),
        smartCompressToMinWidth: pressure.smartCompressToMinWidth,
        compressWidth: pressure.compressWidth
    };
    /* Moving only automatic captions above their controls changes the width
     * bands. Re-evaluate the minimum-width pressure against that transformed
     * variant and discard the pre-promotion compression pressure, even when
     * the browser still needs a scroll canvas for its untransformed
     * explicit-title controls. Keep the original pre-grouping measurement when
     * no title was promoted, because that measurement caused a
     * HorizontalIfPossible group to collapse. */
    if (state.titlesOnTop > 0) {
        pressure = horizontalPriorityPressure(body);
        rowSmartCompressPressure = pressure.smartCompressToMinWidth;
        verticalPressure = verticalFieldPriorityPressure(body);
        state.smartCompressToMinWidth = pressure.smartCompressToMinWidth
            || verticalPressure.smartCompressToMinWidth;
        state.compressWidth = state.verticalGrouping > 0
            && (pressure.compressWidth || verticalPressure.compressWidth);
    }
    fitAuthoredTableHeights(body);
    state.flattenedPagesEnvelope = fitFlattenedPagesAlternativeEnvelope(body);
    state.rootPagesPreferred = fitRootPagesPreferredHeights(body);
    var viewportOverflow = fitFormViewport(body);
    /* A stretchable field's normal width (a Table's reference default grid band,
     * min(88, 40 + 12(n-3)) units) is pressure only against the width its
     * column finally receives. Before fitFormViewport the column still has
     * the reset viewport width; the sibling rows' true minimums may then
     * publish a scroll canvas that is wider than that normal (an 880px list
     * grid measured in a 750px pre-canvas column while the reference
     * gives it 1057px). Re-measure the vertical-field signal on the settled
     * canvas so it cannot mask the genuine canvas overflow below. */
    if (viewportOverflow && state.smartCompressToMinWidth && !rowSmartCompressPressure
        && !state.titlesOnTop) {
        var settledVerticalPressure = verticalFieldPriorityPressure(body, true);
        if (!settledVerticalPressure.smartCompressToMinWidth && !settledVerticalPressure.compressWidth)
            state.smartCompressToMinWidth = false;
    }
    /* fitAuthoredTableWidths runs before the final scroll canvas is known.
     * Refit once the canvas has been published so a reachable wide toolbar is
     * not permanently measured against the earlier narrow page viewport. */
    refitCommandBars(body);
    state.dontAlignButtons = commandBarOverflowCount(body);
    /* A scroll canvas can still expose the browser's untransformed visual
     * rectangles while the native semantic minimum already fits. Do not
     * promote that diagnostic overflow to width compression; genuine below-minimum pressure
     * was calculated above and remains authoritative. */
    if (viewportOverflow && !state.smartCompressToMinWidth && !state.titlesOnTop) state.compressWidth = true;
    state.smartCompressToRecommendedWidth = wrappedLabelPressure(body);
    state.strategy = selectHorizontalStrategy(state);
    state.strategyValue = horizontalStrategyValue(state.strategy);
    state.rootVerticalColumnItems = fitRootSimpleVerticalColumn(body, state.strategyValue);
    /* A bounded side-title band is published only under width pressure;
     * otherwise captions keep their natural widths, so wide desktop rows are
     * not compressed prematurely. */
    if (state.strategyValue >= HORIZONTAL_STRATEGY_VALUES['smart-compress-to-min-width']) {
        capWideSideTitleBands(body, 152);
        allocatedRows += applyHorizontalWidthAllocations(body, state.strategyValue);
        /* HorizontalIfPossible is a consumer of the allocated wrapper width.
         * Re-take the orientation decision now that an allocated parent no
         * longer lends the group the stale scroll-canvas width. */
        if (body.dataset && body.dataset.fpResponsiveWrapperAllocated === '1')
            state.verticalGrouping = prepareResponsiveGroups(body);
        fitFormViewport(body);
        refitCommandBars(body);
        state.dontAlignButtons = commandBarOverflowCount(body);
    }
    allocatedRows += allocateProjectedFixedHorizontalRows(body, state.strategyValue);
    fitProjectedCompoundEditorBands(body);
    fitProjectedCompoundLogicalTracks(body);
    /* Projected/fixed-track passes are the last producers of intrinsic row
     * width. Resolve only responsive logical rows from that final state;
     * unrelated responsive controls already own a stable decision. */
    state.verticalGrouping = Math.max(state.verticalGrouping,
        prepareProjectedResponsiveGroups(body));
    inheritPageFollowingThroughAlignTracks(body);
    alignStackedLogicalRowColumns(body);
    fitFixedWidthColumnEdges(body);
    /* fitAuthoredTableHeights measured table ancestor minimums before the
     * width allocation and projected width passes. A narrower final track can wrap a
     * sibling caption (a collapsible group at 480px: two lines), and the
     * stale floor then lets the table overflow its row onto the next group.
     * Remeasure against the final horizontal allocation. */
    shareDetachedSiblingColumns(body);
    fitTableAncestorMinimums(body, body.querySelectorAll('.fp-table-authored-height'));
    fitMinimumCanvasTitleTracks(body);
    fitFormViewport(body);
    state.fittedPhysicalTableColumns = fitPhysicalTableColumnWidths(body);
    if (body.dataset) {
        body.dataset.fpHorizontalStrategy = state.strategy;
        body.dataset.fpHorizontalStrategyValue = String(state.strategyValue);
        body.dataset.fpVerticalGroupingCount = String(state.verticalGrouping || 0);
        body.dataset.fpTitlesOnTopCount = String(state.titlesOnTop || 0);
        body.dataset.fpWrappedLabelCount = String(state.smartCompressToRecommendedWidth || 0);
        body.dataset.fpAllocatedHorizontalRows = String(allocatedRows || 0);
        body.dataset.fpRootVerticalColumnItems = String(state.rootVerticalColumnItems || 0);
        body.dataset.fpRootPagesPreferredCount = String(state.rootPagesPreferred || 0);
        body.dataset.fpFittedPhysicalTableColumns = String(state.fittedPhysicalTableColumns || 0);
    }
    fitWrappedSideCaptions(body);
    fitAllLeadingCaptionsBeforeTitledPagesNone(body);
    syncDetachedColumnRows(body);
    /* Scroll extents settle after the widened canvas styles are committed.
     * A deferred final fit prevents the table's earlier ResizeObserver pass
     * from leaving commands hidden according to the pre-canvas viewport. */
    if (typeof requestAnimationFrame === 'function')
        requestAnimationFrame(function () {
            refitCommandBars(body);
            stretchRootCommandBarFooter(body);
        });
    return state;
}

/* United=false vertical columns of one horizontal group are not independent
 * stacks in the platform layout: their rows dissolve into the owner's grid,
 * so row i has one height across every column. A two-line decoration in one
 * column makes that row 34px and moves the following rows of both columns
 * down together. */
function paintedRowExtent(row) {
    var top = Infinity, bottom = -Infinity;
    var painted = row.querySelectorAll('.fp-input-wrap, .fp-button, .fp-label-decoration, input.fp-check, '
        + '.fp-picture-icon, .fp-field-label, .fp-label');
    for (var p = 0; p < painted.length; p++) {
        var rect = painted[p].getBoundingClientRect();
        if (!rect.height || painted[p].closest('[hidden], .fp-page-hidden')) continue;
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
    }
    var box = row.getBoundingClientRect();
    return top === Infinity ? { height: box.height } : { height: bottom - top };
}

function resetDetachedColumnRows(body) {
    if (!body || !body.querySelectorAll) return;
    var stale = body.querySelectorAll('[data-fp-row-sync-min]');
    for (var s = 0; s < stale.length; s++) {
        stale[s].style.minHeight = stale[s].dataset.fpRowSyncMin === '-' ? '' : stale[s].dataset.fpRowSyncMin;
        delete stale[s].dataset.fpRowSyncMin;
    }
}

function syncDetachedColumnRows(body) {
    if (!body || !body.querySelectorAll) return 0;
    resetDetachedColumnRows(body);
    var synced = 0;
    var rowsOwners = body.querySelectorAll('.fp-children.fp-children-horizontal');
    for (var r = 0; r < rowsOwners.length; r++) {
        var columns = [];
        var kids = rowsOwners[r].children;
        var detached = true;
        for (var k = 0; k < kids.length && detached; k++) {
            var kid = kids[k];
            if (!kid.classList || !kid.classList.contains('fp-item') || !kid.getBoundingClientRect().height) continue;
            var inner = kid.querySelector(':scope > .fp-control-wrap > .fp-group-bare > .fp-children.fp-children-vertical');
            if (!inner || !inner.dataset || inner.dataset.fpUnited !== '0') { detached = false; break; }
            var rows = [];
            for (var c = 0; c < inner.children.length; c++) {
                var row = inner.children[c];
                if (row.classList && row.classList.contains('fp-item') && row.getBoundingClientRect().height)
                    rows.push(row);
            }
            columns.push(rows);
        }
        if (!detached || columns.length < 2) continue;
        var depth = 0;
        for (var d = 0; d < columns.length; d++) depth = Math.max(depth, columns[d].length);
        for (var i = 0; i < depth; i++) {
            /* Compare painted extents, not item boxes: a chrome-less ordinary
             * row control is 25px while a shelled editor box is 29px for the
             * same 25px row (otherwise rows would drift +4). */
            var tallest = 0;
            var tallestIsText = false;
            var cells = [];
            for (var m = 0; m < columns.length; m++) {
                var candidate = columns[m][i];
                if (!candidate) continue;
                var extent = paintedRowExtent(candidate);
                cells.push({ node: candidate, extent: extent });
                /* An empty stub decoration only holds its row; it has no text
                 * line to wrap. Letting its shelled box win stretched a
                 * neighbouring label to 40px and pushed both checkbox
                 * rows 11px below their editors. */
                if (candidate.querySelector('.fp-deco-spacer')
                    && !candidate.querySelector('.fp-label')) continue;
                if (extent.height > tallest) {
                    tallest = extent.height;
                    tallestIsText = !candidate.querySelector('.fp-input-wrap, .fp-button, input.fp-check, table, .fp-table-widget');
                }
            }
            /* Only a wrapped decoration row is re-synced; editor rows already
             * carry tuned cadence and drift +6..30px when their column
             * rows are re-synced. */
            if (!tallestIsText) continue;
            for (var n = 0; n < cells.length; n++) {
                var cell = cells[n].node;
                var missing = tallest - cells[n].extent.height;
                /* Only a real extra text line (a 33px wrapped decoration vs a 25px
                 * editor) re-flows the grid. Sub-line differences are
                 * chrome/baseline noise already handled elsewhere (they
                 * drift +4..6px when synced). */
                if (missing <= 6) continue;
                cell.dataset.fpRowSyncMin = cell.style.minHeight || '-';
                cell.style.minHeight = Math.round(cell.getBoundingClientRect().height + missing) + 'px';
                synced++;
            }
        }
    }
    return synced;
}

function observeFormViewport(body) {
    if (typeof ResizeObserver === 'undefined') return;
    /* The refit runs inside the observer callback, which the browser delivers
     * after layout and before paint, so a resized form reaches the screen once,
     * already fitted. Deferring it to the next frame painted the stale layout
     * first. The size guard skips the initial notification (render has just
     * fitted this size) and notifications caused by the refit itself. */
    var fittedWidth = body.clientWidth;
    var fittedHeight = body.clientHeight;
    var observer = new ResizeObserver(function () {
        if (!body.isConnected) return;
        if (body.clientWidth === fittedWidth && body.clientHeight === fittedHeight) return;
        /* The canvas from the previous pass belongs to the previous window
         * size. Drop it before the title pass measures, or widening the
         * window keeps re-promoting captions against the narrow canvas. */
        refitSharedCompactPairCaptions(body);
        runHorizontalStrategyPass(body);
        fitRightCommandBarLanes(body);
        /* The pass defers its final command-bar fit to a frame callback, which
         * from here would land one painted frame late. Layout is already
         * forced by the pass, so the same fit is exact now; the deferred copy
         * then finds nothing to change. */
        refitCommandBars(body);
        stretchRootCommandBarFooter(body);
        publishWindowScrollStart(body);
        fittedWidth = body.clientWidth;
        fittedHeight = body.clientHeight;
    });
    observer.observe(body);
    body._fpResizeObserver = observer;
}

/* The root AutoCommandBar is window chrome: the reference starts the window scrollbar
 * lane at the first content row below it, not at the client top. */
function publishWindowScrollStart(body) {
    if (!body || !body.style) return;
    var start = 0;
    var bodyTop = body.getBoundingClientRect().top;
    for (var i = 0; i < body.children.length; i++) {
        var child = body.children[i];
        if (!child.classList || !child.classList.contains('fp-item')) continue;
        if (child.hidden || child.style.display === 'none') continue;
        if (child.dataset && child.dataset.tag === 'AutoCommandBar') continue;
        start = Math.max(0, Math.round(child.getBoundingClientRect().top - bodyTop + body.scrollTop));
        break;
    }
    body.style.setProperty('--fp-window-scroll-start', start + 'px');
}

function hasVerticallyClippedSibling(body) {
    var columns = [body];
    var nested = body.querySelectorAll('.fp-children-vertical');
    for (var n = 0; n < nested.length; n++) columns.push(nested[n]);
    for (var c = 0; c < columns.length; c++) {
        var items = [];
        for (var i = 0; i < columns[c].children.length; i++) {
            var child = columns[c].children[i];
            if (child.classList && child.classList.contains('fp-item')) items.push(child);
        }
        for (var j = 0; j + 1 < items.length; j++) {
            if (items[j].classList.contains('fp-vstretch')
                && items[j].scrollHeight > items[j].clientHeight + 2) return true;
        }
    }
    return false;
}

function iconFor(tag) {
    if (tag === 'Button' || tag === 'Hyperlink') return { cls: 'icon-form-btn', icon: 'click' };
    if (tag === 'InputField' || tag === 'SearchStringAddition' || tag === 'ValueList') return { cls: 'icon-form-in', icon: 'forms' };
    if (tag === 'CheckBoxField') return { cls: 'icon-form-chk', icon: 'checkbox' };
    if (tag === 'Table') return { cls: 'icon-form-tbl', icon: 'table' };
    if (tag === 'Page' || tag === 'Pages') return { cls: 'icon-form-pg', icon: 'layout-navbar' };
    if (isContainer(tag)) return { cls: 'icon-form-grp', icon: 'folder' };
    if (tag === 'Attribute') return { cls: 'icon-form-attr', icon: 'tag', asset: 'platform-attribute.png' };
    if (tag === 'Command') return { cls: 'icon-form-cmd', icon: 'command', asset: 'platform-command.png' };
    return { cls: 'icon-form-etc', icon: 'box' };
}

function attributeIcon(typeName) {
    var type = String(typeName || '').toLowerCase();
    if (/^строка(?:$|[\s(])/i.test(type) || /\bstring\b/.test(type))
        return { cls: 'icon-form-in', icon: 'forms' };
    if (/^число(?:$|[\s(])/i.test(type) || /\bdecimal\b|\bnumber\b/.test(type))
        return { cls: 'icon-form-number', ch: '123' };
    if (/^дата(?:$|[\s(])/i.test(type) || /\bdate(?:time)?\b/.test(type))
        return { cls: 'icon-form-pg', icon: 'calendar' };
    if (/^булево(?:$|[\s(])/i.test(type) || /\bboolean\b/.test(type))
        return { cls: 'icon-form-chk', icon: 'checkbox' };
    if (/таблица|дерево|список/i.test(type) || /\btable\b|\btree\b|\blist\b/.test(type))
        return { cls: 'icon-form-tbl', icon: 'table' };
    var objectTypeIcons = [
        [/^справочникссылка(?:$|[.\s])/, 'platform-type-catalog.png'],
        [/^справочникобъект(?:$|[.\s])/, 'platform-type-catalog-object.png'],
        [/^документссылка(?:$|[.\s])/, 'platform-type-document.png'],
        [/^документобъект(?:$|[.\s])/, 'platform-type-document-object.png'],
        [/^перечислениессылка(?:$|[.\s])/, 'platform-type-enum.png'],
        [/^бизнеспроцессссылка(?:$|[.\s])/, 'platform-type-business-process.png'],
        [/^бизнеспроцессобъект(?:$|[.\s])/, 'platform-type-business-process-object.png'],
        [/^задачассылка(?:$|[.\s])/, 'platform-type-task.png'],
        [/^задачаобъект(?:$|[.\s])/, 'platform-type-task-object.png'],
        [/^плансчетовссылка(?:$|[.\s])/, 'platform-type-chart-of-accounts.png'],
        [/^плансчетовобъект(?:$|[.\s])/, 'platform-type-chart-of-accounts-object.png'],
        [/^планвидоврасчетассылка(?:$|[.\s])/, 'platform-type-calculation-type.png'],
        [/^планвидоврасчетаобъект(?:$|[.\s])/, 'platform-type-calculation-type-object.png'],
        [/^планвидовхарактеристикссылка(?:$|[.\s])/, 'platform-type-characteristic-types.png'],
        [/^планвидовхарактеристикобъект(?:$|[.\s])/, 'platform-type-characteristic-types-object.png'],
        [/^планобмена(?:$|[.\s])/, 'platform-type-exchange-plan.png'],
        [/^планобменаобъект(?:$|[.\s])/, 'platform-type-exchange-plan-object.png']
    ];
    for (var i = 0; i < objectTypeIcons.length; i++) {
        if (objectTypeIcons[i][0].test(type))
            return { cls: 'icon-form-attr', icon: 'tag', asset: objectTypeIcons[i][1] };
    }
    if (/ссылка|объект|перечисление|справочник|документ|план|бизнес.?процесс|задача/i.test(type)
        || /\b(?:ref|object|enum)\b/.test(type))
        return { cls: 'icon-form-attr', icon: 'tag' };
    return { cls: 'icon-form-etc', icon: 'box' };
}

function indexSourceLines(xml) {
    var map = {};
    if (!xml) return map;
    var lines = xml.split(/\r?\n/);
    var re = /<([A-Za-z][\w:.]*)\b[^>]*\bname="([^"]+)"/g;
    for (var i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        var m;
        while ((m = re.exec(lines[i]))) {
            var tag = m[1];
            var colon = tag.lastIndexOf(':');
            if (colon >= 0) tag = tag.slice(colon + 1);
            var key = tag + '\0' + m[2];
            if (map[key] == null) map[key] = i + 1;
            if (map['\0' + m[2]] == null) map['\0' + m[2]] = i + 1;
        }
    }
    return map;
}

function lineOf(map, item) {
    if (!item) return 1;
    var byTag = map[item.tag + '\0' + item.name];
    if (byTag) return byTag;
    var byName = map['\0' + item.name];
    return byName || 1;
}

function commandIndex(commands) {
    var out = {};
    for (var i = 0; commands && i < commands.length; i++) {
        var command = commands[i];
        var name = String(command && command.name || '').trim();
        if (!name) continue;
        out[name] = command;
        out[name.toLowerCase()] = command;
    }
    return out;
}

function commandForItem(item, commands) {
    if (!item || (item.tag !== 'Button' && item.tag !== 'Hyperlink')) return null;
    var commandName = String(prop(item, ['CommandName', 'Command']) || '').trim();
    if (!commandName || commandName === '0') return null;
    var shortName = lastSeg(commandName);
    return commands && (commands[shortName] || commands[shortName.toLowerCase()]) || null;
}

function walkOutline(items, depth, map, out, ctx) {
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || SKIP_TAGS[it.tag]) continue;
        var label = plainFormattedText(titleOf(it, ctx));
        var name = it.name || it.tag || '';
        var outlineEntry = {
            type: 'form',
            tag: it.tag || '',
            name: name,
            title: label && label !== name ? label : '',
            line: lineOf(map, it),
            depth: depth,
            id: itemKey(it),
            typeName: itemTypePresentation(it, ctx),
            dataPath: String(prop(it, ['DataPath', 'ПутьКДанным']) || ''),
            item: it
        };
        var command = commandForItem(it, ctx && ctx.commands);
        if (command) outlineEntry.command = command;
        out.push(outlineEntry);
        if (it.childItems && it.childItems.length) walkOutline(it.childItems, depth + 1, map, out, ctx);
        if (it.autoCommandBar) walkOutline([it.autoCommandBar], depth + 1, map, out, ctx);
        if (it.searchStringAddition) walkOutline([it.searchStringAddition], depth + 1, map, out, ctx);
        if (it.viewStatusAddition) walkOutline([it.viewStatusAddition], depth + 1, map, out, ctx);
    }
}

function outline(model, xml) {
    var out = [];
    var map = indexSourceLines(xml || '');
    if (!model) return out;
    var ctx = { captionIndex: buildCaptionIndex(model), commands: commandIndex(model.commands) };
    if (model.autoCommandBar) walkOutline([model.autoCommandBar], 0, map, out, ctx);
    walkOutline(model.childItemsRoot, 0, map, out, ctx);
    outlineHasChildren(out);
    return out;
}

var ATTRIBUTE_PROPERTY_TITLES = {
    MainAttribute: 'Основной реквизит', SavedData: 'Сохраняемые данные',
    FillChecking: 'Проверка заполнения', UseAlways: 'Использовать всегда',
    PasswordMode: 'Режим пароля', ExtendedEdit: 'Расширенное редактирование',
    ChoiceFoldersAndItems: 'Выбор групп и элементов', MarkNegatives: 'Выделять отрицательные',
    Format: 'Формат', EditFormat: 'Формат редактирования', ToolTip: 'Подсказка',
    Title: 'Заголовок', FillCheck: 'Проверка заполнения', FunctionalOptions: 'Функциональные опции',
    Save: 'Сохраняемые поля', View: 'Просмотр', Edit: 'Редактирование'
};

var ELEMENT_PROPERTY_TITLES = {
    Type: 'Тип', Title: 'Заголовок', DataPath: 'Путь к данным', CommandName: 'Команда',
    Width: 'Ширина', Height: 'Высота', MinWidth: 'Минимальная ширина',
    MaxWidth: 'Максимальная ширина', MinHeight: 'Минимальная высота',
    MaxHeight: 'Максимальная высота', AutoMaxWidth: 'Автомаксимальная ширина',
    AutoMaxHeight: 'Автомаксимальная высота', HorizontalStretch: 'Растягивать по горизонтали',
    VerticalStretch: 'Растягивать по вертикали', Visible: 'Видимость', Enabled: 'Доступность',
    ReadOnly: 'Только просмотр', ShowTitle: 'Показывать заголовок',
    TitleLocation: 'Положение заголовка', Group: 'Группировка', Behavior: 'Поведение',
    Representation: 'Представление', BackColor: 'Цвет фона', TextColor: 'Цвет текста',
    BorderColor: 'Цвет рамки', Font: 'Шрифт', FontSpec: 'Шрифт',
    TitleFont: 'Шрифт заголовка', TitleFontSpec: 'Шрифт заголовка',
    HeaderFontSpec: 'Шрифт заголовка таблицы', FooterFontSpec: 'Шрифт подвала таблицы',
    EditMode: 'Режим редактирования', Format: 'Формат', EditFormat: 'Формат редактирования',
    ToolTip: 'Подсказка', ToolTipRepresentation: 'Представление подсказки',
    ChoiceButton: 'Кнопка выбора', ClearButton: 'Кнопка очистки',
    DropListButton: 'Кнопка списка', SpinButton: 'Кнопка регулирования',
    ChoiceButtonPicture: 'Картинка кнопки выбора', ChoiceButtonRepresentation: 'Представление кнопки выбора',
    ChoiceListItems: 'Список выбора', ChoiceParameterLinks: 'Связи параметров выбора',
    ChoiceParameters: 'Параметры выбора', FileDragMode: 'Режим перетаскивания файлов',
    Picture: 'Картинка', PictureDecoration: 'Декорация-картинка',
    CommandBarLocation: 'Положение командной панели', LocationInCommandBar: 'Положение в командной панели',
    PagesRepresentation: 'Представление страниц', HorizontalAlignment: 'Горизонтальное выравнивание',
    VerticalAlignment: 'Вертикальное выравнивание', HorizontalSpacing: 'Горизонтальный интервал',
    VerticalSpacing: 'Вертикальный интервал', ThroughAlign: 'Сквозное выравнивание',
    United: 'Объединять элементы', ChildItemsWidth: 'Ширина дочерних элементов',
    Wrap: 'Перенос текста', VerticalLines: 'Вертикальные линии',
    AutoMaxRowsCount: 'Автоматическое ограничение числа строк',
    AllowedLength: 'Допустимая длина', AllowedSign: 'Допустимый знак',
    DescriptionLength: 'Длина описания', Digits: 'Разрядность', FractionDigits: 'Дробная часть',
    Length: 'Длина', MinValue: 'Минимальное значение', MaxValue: 'Максимальное значение',
    NumberLength: 'Длина числа', NumberType: 'Тип числа',
    DateFractions: 'Части даты', DateQualifiers: 'Квалификаторы даты',
    NumberQualifiers: 'Квалификаторы числа', StringQualifiers: 'Квалификаторы строки',
    MainTable: 'Основная таблица', ListSettings: 'Настройки списка', RowFilter: 'Отбор строк',
    ManualQuery: 'Ручной запрос', PictureSize: 'Размер картинки', PictureVariant: 'Вариант картинки',
    FooterPicture: 'Картинка подвала', DisplayImportance: 'Важность отображения',
    Action: 'Действие', AdditionSource: 'Источник добавления', AllowGettingCurrentRowURL: 'Разрешать получение URL текущей строки',
    AllowRootChoice: 'Разрешать выбор корня', AutoAddIncomplete: 'Автоматически отмечать незаполненные',
    AutoCellHeight: 'Автовысота ячеек', AutoChoiceIncomplete: 'Автоматически отмечать незаполненный выбор', Autofill: 'Автозаполнение',
    AutoInsertNewRow: 'Автоматически вставлять новую строку', AutoRefresh: 'Автообновление', AutoRefreshPeriod: 'Период автообновления',
    AutoSaveDataInSettings: 'Автосохранение данных в настройках', AutoTime: 'Автоматическое время', AutoTitle: 'Автозаголовок', AutoURL: 'Автоматический URL',
    Border: 'Рамка', CellHyperlink: 'Гиперссылка ячейки', ChangeRowOrder: 'Изменение порядка строк', ChangeRowSet: 'Изменение набора строк',
    Check: 'Проверка', CheckBoxType: 'Вид флажка', ChoiceHistoryOnInput: 'История выбора при вводе', ChoiceListButton: 'Кнопка списка выбора',
    ChoiceListHeight: 'Высота списка выбора', ChooseType: 'Выбор типа', Collapsed: 'Свернут', CollapsedRepresentationTitle: 'Заголовок свернутого представления',
    CollapseItemsByImportanceVariant: 'Вариант сворачивания по важности', Columns: 'Колонки', ColumnsCount: 'Количество колонок',
    CommandInterface: 'Интерфейс команд', CommandSource: 'Источник команды', ControlRepresentation: 'Представление элемента управления', CreateButton: 'Кнопка создания',
    CurrentRowUse: 'Использование текущей строки', Customizable: 'Настраиваемость', DefaultItem: 'Элемент по умолчанию', DropListWidth: 'Ширина списка',
    EditTextUpdate: 'Обновление текста при редактировании', EnableContentChange: 'Разрешать изменение содержимого', EnableDrag: 'Разрешать перетаскивание',
    EnableStartDrag: 'Разрешать начало перетаскивания', EqualColumnsWidth: 'Равная ширина колонок', ExtendedEditMultipleValues: 'Расширенное редактирование нескольких значений',
    FillCheck: 'Проверка заполнения', FixingInTable: 'Закрепление в таблице', Footer: 'Подвал', FooterDataPath: 'Путь к данным подвала', FooterText: 'Текст подвала',
    FunctionalOptions: 'Функциональные опции', GroupHorizontalAlign: 'Горизонтальное выравнивание группы', Header: 'Шапка', HeaderHeight: 'Высота шапки',
    HeaderHorizontalAlign: 'Горизонтальное выравнивание шапки', HeaderPicture: 'Картинка шапки', HeightControlVariant: 'Вариант высоты элемента', Hiperlink: 'Гиперссылка',
    HorizontalAlign: 'Горизонтальное выравнивание', HorizontalLines: 'Горизонтальные линии', HorizontalScrollBar: 'Горизонтальная полоса прокрутки',
    IncompleteChoiceMode: 'Режим выбора незаполненных', InitialListView: 'Начальный вид списка', InitialTreeView: 'Начальный вид дерева', InputHint: 'Подсказка ввода',
    ItemHeight: 'Высота элемента', ItemTitleHeight: 'Высота заголовка элемента', ItemWidth: 'Ширина элемента', ListChoiceMode: 'Режим выбора из списка', Mask: 'Маска',
    ModifiesSavedData: 'Изменяет сохранённые данные', MultipleChoice: 'Множественный выбор', NonselectedPictureText: 'Текст картинки невыбранного элемента',
    OpenButton: 'Кнопка открытия', Output: 'Вывод', Period: 'Период', PictureLocation: 'Положение картинки', Protection: 'Защита', QuickChoice: 'Быстрый выбор',
    RadioButtonType: 'Вид переключателя', RefreshRequest: 'Запрос обновления', RepostOnWrite: 'Перепроводить при записи', RepresentationInContextMenu: 'Представление в контекстном меню',
    RestoreCurrentRow: 'Восстанавливать текущую строку', RowInputMode: 'Режим ввода строки', RowPictureDataPath: 'Путь к картинке строки', RowSelectionMode: 'Режим выбора строк', RowsPicture: 'Картинки строк', Save: 'Сохранение',
    SearchControlLocation: 'Положение управления поиском', SearchOnInput: 'Поиск при вводе', SearchStringLocation: 'Положение строки поиска', SelectionMode: 'Режим выбора', SelectionShowMode: 'Режим отображения выбора', Settings: 'Настройки',
    ShapeRepresentation: 'Представление формы', Shortcut: 'Сочетание клавиш', ShowInFooter: 'Показывать в подвале', ShowLeftMargin: 'Показывать левое поле', ShowPercent: 'Показывать проценты', ShowRoot: 'Показывать корень', SkipOnInput: 'Пропускать при вводе',
    SpecialTextInputMode: 'Специальный режим ввода текста', TextEdit: 'Редактирование текста', TitleDataPath: 'Путь к данным заголовка', TitleFormatted: 'Форматированный заголовок', TitleHeight: 'Высота заголовка', TitleTextColor: 'Цвет текста заголовка', TopLevelParent: 'Родитель верхнего уровня',
    TypeLink: 'Ссылка на тип', UpdateOnDataChange: 'Обновлять при изменении данных', Use: 'Использование', UseAlternationRowColor: 'Использовать чередование цветов строк', UseForFoldersAndItems: 'Использовать для групп и элементов', UsePostingMode: 'Использовать режим проведения', UserVisible: 'Видимость для пользователя', ValuesPicture: 'Картинка значений',
    VerticalAlign: 'Вертикальное выравнивание', VerticalScroll: 'Вертикальная прокрутка', VerticalScrollBar: 'Вертикальная полоса прокрутки', View: 'Вид', ViewScalingMode: 'Режим масштабирования представления', ViewStatusLocation: 'Положение состояния просмотра', WarningOnEdit: 'Предупреждать при редактировании', WarningOnEditRepresentation: 'Представление предупреждения при редактировании', WindowOpeningMode: 'Режим открытия окна',
    DefaultButton: 'Кнопка по умолчанию', ExcludedCommands: 'Исключённые команды',
    GroupVerticalAlign: 'Вертикальное выравнивание группы', HeightInTableRows: 'Высота в строках таблицы',
    HorizontalLocation: 'Горизонтальное положение', Hyperlink: 'Гиперссылка',
    ScrollOnCompress: 'Прокрутка при сжатии', ShowInHeader: 'Показывать в заголовке',
    MultiLine: 'Многострочный режим', PasswordMode: 'Режим пароля',
    MarkIncomplete: 'Отмечать незаполненное', AutoMarkIncomplete: 'Автоотметка незаполненного',
    kind: 'Вид', ref: 'Ссылка на стиль', faceName: 'Гарнитура', height: 'Размер',
    scale: 'Масштаб', bold: 'Жирный', italic: 'Курсив', underline: 'Подчёркивание',
    strikeout: 'Зачёркивание',
    /* Keys that real configurations use but that fell through to
     * humanizeIdent's raw English rendering because no translation existed
     * yet. */
    DefaultVisible: 'Видимость по умолчанию', AdditionalColumns: 'Дополнительные колонки',
    DynamicDataRead: 'Динамическое считывание данных', UserSettingsGroup: 'Группа пользовательских настроек',
    QueryText: 'Текст запроса', NavigationPanel: 'Панель навигации', ChoiceMode: 'Режим выбора',
    CommandGroup: 'Группа команд', KeyParameter: 'Ключевой параметр', Index: 'Индекс',
    ChoiceForm: 'Форма выбора', ConditionalAppearance: 'Условное оформление', Edit: 'Редактирование',
    FooterHorizontalAlign: 'Горизонтальное выравнивание подвала',
    AutoSaveUserSettings: 'Автосохранение пользовательских настроек',
    SettingsNamedItemDetailedRepresentation: 'Детальное представление именованного элемента настроек',
    ViewModeApplicationOnSetReportResult: 'Применение режима просмотра при установке результата отчёта',
    ReportResultViewMode: 'Режим просмотра результата отчёта', ReportFormType: 'Тип формы отчёта',
    AutoShowState: 'Автопоказ состояния', ViewMode: 'Режим просмотра',
    SaveDataInSettings: 'Сохранение данных в настройках', SaveWindowSettings: 'Сохранение настроек окна',
    ReportResult: 'Результат отчёта', ThreeState: 'Три состояния',
    ChildrenAlign: 'Выравнивание дочерних элементов', DetailsData: 'Данные детализации',
    AutoFillCheck: 'Автоматическая проверка заполнения', CalculatedField: 'Вычисляемое поле',
    MaxRowsCount: 'Максимальное количество строк', TypeDomainEnabled: 'Проверка области типа',
    ShowCloseButton: 'Показывать кнопку закрытия', KeyField: 'Ключевое поле', Shape: 'Фигура',
    ScalingMode: 'Режим масштабирования', CustomSettingsFolder: 'Папка пользовательских настроек',
    ShowHeaders: 'Показывать заголовки', EnterKeyBehavior: 'Поведение клавиши Enter',
    AutoFillAvailableFields: 'Автозаполнение доступных полей', ShowGrid: 'Показывать сетку',
    EqualItemsWidth: 'Одинаковая ширина элементов', VariantAppearance: 'Вариант оформления',
    GetInvisibleFieldPresentations: 'Получать представления невидимых полей',
    AutoShowOpenButtonMode: 'Режим автопоказа кнопки открытия', TitleBackColor: 'Цвет фона заголовка',
    ShowGroups: 'Показывать группы', FooterHeight: 'Высота подвала', ImageScale: 'Масштаб изображения',
    FooterTextColor: 'Цвет текста подвала', KeyType: 'Тип ключа',
    AutoShowClearButtonMode: 'Режим автопоказа кнопки очистки', Step: 'Шаг',
    ShowMonthsPanel: 'Показывать панель месяцев', ShowCheckBoxesInDropList: 'Показывать флажки в выпадающем списке',
    SettingsStorage: 'Хранилище настроек', WidthInMonths: 'Ширина в месяцах',
    ShowRowAndColumnNames: 'Показывать имена строк и колонок', ShowCurrentDate: 'Показывать текущую дату',
    MultipleValuePresentDataPath: 'Путь к данным представления множественного значения',
    MultipleValueDataPath: 'Путь к данным множественного значения', MarkingStep: 'Шаг разметки',
    MarkingAppearance: 'Оформление разметки', LargeStep: 'Крупный шаг',
    ShowCellNames: 'Показывать имена ячеек', HeightInMonths: 'Высота в месяцах',
    SpellCheckingOnTextInput: 'Проверка орфографии при вводе текста',
    HiddenStateTitleBackColor: 'Цвет фона заголовка скрытого состояния',
    DrawingSelectionShowMode: 'Режим отображения выделения при рисовании',
    CommandUniqueness: 'Уникальность команды',
    BehaviorOnHorizontalCompression: 'Поведение при горизонтальном сжатии',
    AutoCorrectionOnTextInput: 'Автоисправление при вводе текста',
    AllowInputEmptyMultipleValues: 'Разрешить ввод пустых множественных значений',
    ConversationsRepresentation: 'Представление обсуждений', Zoomable: 'Масштабируемый',
    CommonCommandGroup: 'Группа общей команды', GeneratedContributionRank: 'Порядок автодобавления',
    AvailableTypes: 'Доступные типы', AssociatedTableElementId: 'Связанный элемент таблицы'
};

function propertyTitleFrom(dictionary, key) {
    if (Object.prototype.hasOwnProperty.call(dictionary, key)) return dictionary[key];
    var normalized = String(key || '').toLowerCase();
    for (var known in dictionary) {
        if (Object.prototype.hasOwnProperty.call(dictionary, known)
            && known.toLowerCase() === normalized) return dictionary[known];
    }
    return '';
}

function propertyTitle(key) {
    return propertyTitleFrom(ELEMENT_PROPERTY_TITLES, key)
        || propertyTitleFrom(ATTRIBUTE_PROPERTY_TITLES, key)
        || humanizeIdent(key);
}

/* Standard 1C Designer names for form item kinds (item.tag), used wherever
 * the property inspector or status bar shows what an element *is* rather than
 * one of its properties. Falls back to humanizeIdent for anything unlisted
 * (custom/rare kinds) instead of leaking the raw XML tag untranslated. */
var ITEM_KIND_TITLES = {
    InputField: 'Поле ввода', CheckBoxField: 'Поле флажка', RadioButtonField: 'Поле переключателя',
    RadioButton: 'Переключатель', LabelField: 'Поле надписи', LabelDecoration: 'Надпись',
    PictureDecoration: 'Картинка', PictureField: 'Поле картинки', Button: 'Кнопка',
    Hyperlink: 'Гиперссылка', Table: 'Таблица', UsualGroup: 'Группа', CollapsibleGroup: 'Группа',
    Pages: 'Страницы', Page: 'Страница', AutoCommandBar: 'Командная панель', CommandBar: 'Командная панель',
    ValueList: 'Список значений', ListBox: 'Список', ListField: 'Поле списка',
    ButtonGroup: 'Группа кнопок', ColumnGroup: 'Группа колонок', Popup: 'Подменю',
    Form: 'Форма',
    TrackBarField: 'Поле регулятора', ProgressBarField: 'Поле индикатора',
    TextDocumentField: 'Поле текстового документа', SpreadSheetDocumentField: 'Поле табличного документа',
    HTMLDocumentField: 'Поле HTML документа', ChartField: 'Поле диаграммы',
    GanttChartField: 'Поле диаграммы Ганта', PlannerField: 'Поле планировщика',
    GraphicalSchemaField: 'Поле графической схемы', FormattedDocumentField: 'Поле форматированного документа',
    CalendarField: 'Поле календаря', PeriodField: 'Поле периода', GeographicsField: 'Поле географической схемы',
    PDFDocumentField: 'Поле PDF документа'
};

function itemKindTitle(tag) {
    return propertyTitleFrom(ITEM_KIND_TITLES, tag) || humanizeIdent(tag);
}

var PROPERTY_VALUE_TITLES = {
    Behavior: { Collapsible: 'Сворачиваемая', PopUp: 'Всплывающая', Usual: 'Обычная' },
    Border: { Double: 'Двойная', Single: 'Одинарная', Underline: 'Подчёркивание', WithoutBorder: 'Без рамки' },
    CheckBoxType: { Auto: 'Авто', CheckBox: 'Флажок', Switcher: 'Переключатель', Tumbler: 'Тумблер' },
    ChildItemsWidth: { Equal: 'Одинаковая', LeftNarrowest: 'Самый узкий слева', LeftWide: 'Широкий слева' },
    ChoiceButtonRepresentation: { ShowInDropListAndInInputField: 'В списке и в поле ввода', ShowInInputField: 'В поле ввода' },
    ChoiceFoldersAndItems: { Items: 'Элементы' }, ChoiceHistoryOnInput: { DontUse: 'Не использовать' },
    CommandBarLocation: { None: 'Нет', Top: 'Сверху' }, CommandSource: { Form: 'Форма', FormCommandPanelGlobalCommands: 'Глобальные команды панели формы' },
    ControlRepresentation: { Picture: 'Картинка' }, DisplayImportance: { Usual: 'Обычная', VeryHigh: 'Очень высокая', VeryLow: 'Очень низкая' },
    EditMode: { Directly: 'Непосредственно', EnterOnInput: 'При вводе' }, EditTextUpdate: { OnValueChange: 'При изменении значения' },
    FileDragMode: { AsFile: 'Как файл' }, FixingInTable: { Left: 'Слева', Right: 'Справа' },
    Group: { AlwaysHorizontal: 'Всегда горизонтальная', Horizontal: 'Горизонтальная', HorizontalIfPossible: 'Горизонтальная, если возможно', InCell: 'В ячейке', Vertical: 'Вертикальная' },
    GroupHorizontalAlign: { Center: 'По центру', Left: 'Слева', Right: 'Справа' }, GroupVerticalAlign: { Bottom: 'Снизу', Center: 'По центру', Top: 'Сверху' },
    HeaderHorizontalAlign: { Center: 'По центру', Right: 'Справа' }, HeightControlVariant: { UseContentHeight: 'По высоте содержимого', UseHeightInTableRows: 'По высоте в строках таблицы' },
    HorizontalAlign: { Auto: 'Авто', Center: 'По центру', Left: 'Слева', Right: 'Справа' }, HorizontalLocation: { Left: 'Слева', Right: 'Справа' },
    HorizontalSpacing: { Double: 'Двойной', Half: 'Половина', None: 'Нет', OneAndHalf: 'Полуторный', Single: 'Одинарный' },
    IncompleteChoiceMode: { OnActivate: 'При активации' }, InitialListView: { Beginning: 'В начале' },
    InitialTreeView: { ExpandAllLevels: 'Развернуть все уровни', ExpandTopLevel: 'Развернуть верхний уровень' },
    LocationInCommandBar: { InAdditionalSubmenu: 'В дополнительном подменю', InCommandBar: 'В командной панели', InCommandBarAndInAdditionalSubmenu: 'В командной панели и дополнительном подменю' },
    Output: { Disable: 'Отключить' }, PagesRepresentation: { None: 'Нет', TabsOnTop: 'Закладки сверху' },
    PictureLocation: { Left: 'Слева', Right: 'Справа' }, PictureSize: { AutoSize: 'Авторазмер', ByFontSize: 'По размеру шрифта', Proportionally: 'Пропорционально' },
    RadioButtonType: { Auto: 'Авто', RadioButtons: 'Переключатели', Tumbler: 'Тумблер' }, RefreshRequest: { PullFromTop: 'Загрузка сверху' },
    Representation: { Compact: 'Компактное', List: 'Список', None: 'Нет', NormalSeparation: 'Обычное разделение', Picture: 'Картинка', PictureAndText: 'Картинка и текст', Text: 'Текст', Tree: 'Дерево', Usual: 'Обычное' },
    RepresentationInContextMenu: { AdditionalInContextMenu: 'Дополнительно в контекстном меню', None: 'Нет', OnlyInContextMenu: 'Только в контекстном меню' },
    RowInputMode: { AfterCurrentRow: 'После текущей строки' }, RowSelectionMode: { Row: 'Строка' },
    SearchOnInput: { DontUse: 'Не использовать', Use: 'Использовать' }, SearchStringLocation: { CommandBar: 'Командная панель', None: 'Нет' }, SelectionMode: { SingleRow: 'Одна строка' },
    SearchControlLocation: { CommandBar: 'Командная панель', None: 'Нет' }, SelectionShowMode: { DontShow: 'Не показывать', WhenActive: 'При активности' }, ShapeRepresentation: { None: 'Нет', WhenActive: 'При активности' },
    SpecialTextInputMode: { Email: 'Электронная почта' }, ThroughAlign: { DontUse: 'Не использовать', Use: 'Использовать' },
    TitleLocation: { Left: 'Слева', None: 'Нет', Right: 'Справа', Top: 'Сверху' },
    ToolTipRepresentation: { Balloon: 'Всплывающая подсказка', Button: 'Кнопка', None: 'Нет', ShowBottom: 'Снизу', ShowLeft: 'Слева', ShowRight: 'Справа', ShowTop: 'Сверху' },
    VerticalAlign: { Bottom: 'Снизу', Center: 'По центру', Top: 'Сверху' }, VerticalSpacing: { Double: 'Двойной', Half: 'Половина', None: 'Нет', Single: 'Одинарный' },
    Type: { CommandBarButton: 'Кнопка командной панели', CommandBarHyperlink: 'Гиперссылка командной панели', Hyperlink: 'Гиперссылка', UsualButton: 'Обычная кнопка' },
    CommonCommandGroup: {
        FormCommandBarImportant: 'Командная панель формы.Важное', FormCommandBarCreateBasedOn: 'Командная панель формы.Создать на основании',
        FormNavigationPanelImportant: 'Панель навигации формы.Важное', FormNavigationPanelGoTo: 'Панель навигации формы.Перейти',
        FormNavigationPanelSeeAlso: 'Панель навигации формы.См. также'
    },
    ViewScalingMode: { Normal: 'Обычный' }, ViewStatusLocation: { None: 'Нет', Top: 'Сверху' }, WarningOnEditRepresentation: { DontShow: 'Не показывать', Show: 'Показывать' }, UpdateOnDataChange: { Auto: 'Авто' },
    'FontSpec.kind': { AutoFont: 'Автоматический шрифт', StyleItem: 'Элемент стиля', WindowsFont: 'Шрифт Windows' },
    'TitleFontSpec.kind': { AutoFont: 'Автоматический шрифт', StyleItem: 'Элемент стиля', WindowsFont: 'Шрифт Windows' },
    'FooterFontSpec.kind': { AutoFont: 'Автоматический шрифт', StyleItem: 'Элемент стиля', WindowsFont: 'Шрифт Windows' }
};

/* Values missing above, collected by scanning the Form.xml files of a
 * large configuration; merged into the existing per-property dictionaries. */
(function (extra) {
    for (var key in extra) {
        if (!Object.prototype.hasOwnProperty.call(extra, key)) continue;
        var target = PROPERTY_VALUE_TITLES[key] || (PROPERTY_VALUE_TITLES[key] = {});
        for (var value in extra[key]) {
            if (Object.prototype.hasOwnProperty.call(extra[key], value)) target[value] = extra[key][value];
        }
    }
})({
    Representation: { StrongSeparation: 'Сильное разделение' },
    TitleLocation: { Auto: 'Авто', Bottom: 'Снизу' },
    SearchStringLocation: { Top: 'Сверху', Bottom: 'Снизу', PullFromTop: 'Выдвигается сверху' },
    ChoiceFoldersAndItems: { Folders: 'Группы', FoldersAndItems: 'Группы и элементы' },
    UpdateOnDataChange: { DontUpdate: 'Не обновлять' },
    CommandBarLocation: { Bottom: 'Снизу', Auto: 'Авто' },
    PagesRepresentation: { TabsOnBottom: 'Закладки снизу', TabsOnLeftHorizontal: 'Закладки слева горизонтально', Swipe: 'Пролистывание' },
    ChoiceButtonRepresentation: { ShowInDropList: 'В выпадающем списке' },
    HeaderHorizontalAlign: { Auto: 'Авто', Left: 'Лево', Center: 'Центр', Right: 'Право' },
    FooterHorizontalAlign: { Auto: 'Авто', Left: 'Лево', Center: 'Центр', Right: 'Право' },
    HorizontalLocation: { Auto: 'Авто', Left: 'Лево', Center: 'Центр', Right: 'Право' },
    PictureSize: { Stretch: 'Растянуть', RealSize: 'Реальный размер', RealSizeIgnoreScale: 'Реальный размер без учёта масштаба', AutoSizeIgnoreScale: 'Авторазмер без учёта масштаба' },
    HeightControlVariant: { UseHeightInFormRows: 'Использовать высоту в строках формы' },
    SelectionShowMode: { WhenMultipleCellsSelected: 'При выделении нескольких ячеек' },
    ToolTipRepresentation: { ShowAuto: 'Авто' },
    ViewMode: { All: 'Все', QuickAccess: 'Быстрый доступ' },
    AutoShowClearButtonMode: { FilledOnly: 'Только для заполненного', Always: 'Всегда' },
    AutoShowOpenButtonMode: { FilledOnly: 'Только для заполненного', Always: 'Всегда' },
    DisplayImportance: { Low: 'Низкая', High: 'Высокая' },
    ChildrenAlign: {
        None: 'Нет', ItemsLeftTitlesLeft: 'Элементы слева, заголовки слева', ItemsLeftTitlesRight: 'Элементы слева, заголовки справа',
        ItemsRightTitlesLeft: 'Элементы справа, заголовки слева', ItemsRightTitlesRight: 'Элементы справа, заголовки справа',
        TitlesLeftDataAuto: 'Заголовки слева, данные авто'
    },
    CurrentRowUse: {
        DontUse: 'Не использовать', Use: 'Использовать', Choice: 'Выбор', SelectionPresentation: 'Отображение выделения',
        SelectionPresentationAndChoice: 'Отображение выделения и выбор'
    },
    InitialListView: { Beginning: 'Начало', End: 'Конец', Auto: 'Авто' },
    ChildItemsWidth: { LeftNarrow: 'Узкий слева', LeftWidest: 'Самый широкий слева' },
    VerticalSpacing: { OneAndHalf: 'Полуторный' },
    ShapeRepresentation: { Always: 'Всегда' },
    VerticalScrollBar: { DontUse: 'Не использовать', UseAlways: 'Использовать всегда', UseIfNecessary: 'Использовать при необходимости' },
    HorizontalScrollBar: { DontUse: 'Не использовать', UseAlways: 'Использовать всегда', UseIfNecessary: 'Использовать при необходимости' },
    EditTextUpdate: { DontUse: 'Не использовать', Always: 'Всегда' },
    SpecialTextInputMode: { PhoneNumber: 'Номер телефона', Digits: 'Цифры' },
    Shape: { Oval: 'Овал', Usual: 'Обычная' },
    AutoCorrectionOnTextInput: { DontUse: 'Не использовать', Use: 'Использовать' },
    SpellCheckingOnTextInput: { DontUse: 'Не использовать', Use: 'Использовать' },
    Output: { Enable: 'Разрешить' },
    MarkingAppearance: { TopLeft: 'Сверху слева' },
    BehaviorOnHorizontalCompression: { MoveItemsByImportance: 'Перемещать элементы по важности' },
    DrawingSelectionShowMode: { Show: 'Показывать' },
    FillCheck: { ShowError: 'Выдавать ошибку', DontCheck: 'Не проверять' },
    ExcludedCommands: {
        Abort: 'Прервать', Activate: 'Активизировать', Cancel: 'Отмена', CancelEdit: 'Отменить редактирование',
        CancelSearch: 'Отменить поиск', Change: 'Изменить', ChangeHistory: 'История изменений',
        ChangeSettingsStructure: 'Изменить структуру настроек', ChangeVariant: 'Изменить вариант', Choose: 'Выбрать',
        ClearChartAppearance: 'Очистить оформление диаграммы', Close: 'Закрыть', CompactViewMode: 'Компактный режим просмотра',
        Copy: 'Скопировать', Create: 'Создать', CreateByParameter: 'Создать по параметру', CreateFolder: 'Создать группу',
        CustomizeForm: 'Изменить форму', Delete: 'Удалить', DynamicListStandardSettings: 'Стандартные настройки',
        EndEdit: 'Закончить редактирование', Execute: 'Выполнить', ExecuteAndClose: 'Выполнить и закрыть', Find: 'Найти',
        FindByCurrentValue: 'Найти по текущему значению', Generate: 'Сформировать', GetURL: 'Получить ссылку', Help: 'Справка',
        HierarchicalList: 'Иерархический список', Ignore: 'Пропустить', LevelDown: 'Уровень вниз', LevelUp: 'Уровень вверх',
        List: 'Список', ListSettings: 'Настроить список', LoadDynamicListSettings: 'Загрузить настройки',
        LoadReportSettings: 'Загрузить настройки', LoadVariant: 'Выбрать вариант', MoveItem: 'Переместить в группу',
        NewWindow: 'Новое окно', No: 'Нет', OK: 'ОК', OpenFromMainServer: 'Открыть с основного сервера',
        OpenFromStandaloneServer: 'Открыть с автономного сервера', OutputList: 'Вывести список', Post: 'Провести',
        PostAndClose: 'Провести и закрыть', Print: 'Печать', Refresh: 'Обновить', ReportSettings: 'Настройки',
        Reread: 'Перечитать', RestoreValues: 'Восстановить значения', Retry: 'Повторить', Save: 'Сохранить',
        SaveDynamicListSettings: 'Сохранить настройки', SaveReportSettings: 'Сохранить настройки',
        SaveValues: 'Сохранить значения', SaveVariant: 'Сохранить вариант', SetDateInterval: 'Установить интервал дат',
        SetDeletionMark: 'Пометить на удаление', ShowInList: 'Показать в списке', ShowMultipleSelection: 'Множественный выбор',
        StandardSettings: 'Стандартные настройки', Start: 'Старт', StartAndClose: 'Старт и закрыть',
        SwitchActivity: 'Переключить активность', Tree: 'Дерево', UndoPosting: 'Отмена проведения', Write: 'Записать',
        WriteAndClose: 'Записать и закрыть', Yes: 'Да'
    }
});

function propertyValueTitle(key, value) {
    var dictionary = PROPERTY_VALUE_TITLES[key];
    if (!dictionary) return String(value);
    if (Object.prototype.hasOwnProperty.call(dictionary, value)) return dictionary[value];
    /* Normalized values (representationOf gives 'pictureandtext') miss the exact key. */
    var normalized = String(value).toLowerCase();
    for (var known in dictionary) {
        if (Object.prototype.hasOwnProperty.call(dictionary, known) && known.toLowerCase() === normalized) return dictionary[known];
    }
    return String(value);
}
function propertyValuePresentation(value, key) {
    if (value === true || /^true$/i.test(String(value))) return 'Да';
    if (value === false || /^false$/i.test(String(value))) return 'Нет';
    if (value == null || value === '') return 'Пусто';
    if (Array.isArray(value)) return value.length ? value.map(function (item) { return propertyValueTitle(key, item); }).join(', ') : 'Пустой список';
    if (typeof value === 'object') {
        var summary = [];
        if (value.ref) summary.push(value.ref);
        if (value.faceName) summary.push(value.faceName);
        if (value.height) summary.push(String(value.height) + ' пт');
        if (value.bold === true) summary.push('жирный');
        if (value.italic === true) summary.push('курсив');
        if (value.underline === true) summary.push('подчёркнутый');
        return summary.length ? summary.join('; ') : 'Составное значение';
    }
    return key ? propertyValueTitle(key, value) : String(value);
}

function objectDetailItems(value, parentKey) {
    var out = [];
    var authoredKeys = value && value._authoredKeys;
    for (var key in value || {}) {
        if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) continue;
        if (authoredKeys && authoredKeys.indexOf(key) < 0) continue;
        out.push({ label: propertyTitle(key), value: propertyValuePresentation(value[key], parentKey ? parentKey + '.' + key : key) });
    }
    return out;
}

function structuredDetailItems(value, prefix, out, depth) {
    out = out || [];
    depth = depth || 0;
    if (!value || depth > 5 || out.length >= 100) return out;
    var here = prefix || value.name || 'Значение';
    var attrs = value.attributes || {};
    for (var key in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, key))
            out.push({ label: here + '.@' + key, value: propertyValuePresentation(attrs[key]) });
    }
    if (value.text != null && String(value.text) !== '')
        out.push({ label: here, value: propertyValuePresentation(value.text) });
    for (var i = 0; value.children && i < value.children.length && out.length < 100; i++) {
        var child = value.children[i];
        structuredDetailItems(child, here + '.' + (child.name || i), out, depth + 1);
    }
    return out;
}

var DESIGN_TIME_REF_KINDS = {
    Enum: 'Перечисление', Catalog: 'Справочник', Document: 'Документ', ChartOfCharacteristicTypes: 'ПланВидовХарактеристик',
    ChartOfAccounts: 'ПланСчетов', ChartOfCalculationTypes: 'ПланВидовРасчета', BusinessProcess: 'БизнесПроцесс',
    Task: 'Задача', ExchangePlan: 'ПланОбмена'
};
function designTimeRefPresentation(text) {
    var parts = String(text).split('.');
    if (parts.length >= 3 && DESIGN_TIME_REF_KINDS[parts[0]]) {
        parts[0] = DESIGN_TIME_REF_KINDS[parts[0]];
        /* Drop the EnumValue / Predefined segment between the object and the value name. */
        if (parts.length === 4) parts.splice(2, 1);
    }
    return parts.join('.');
}
function structuredChildText(node, name) {
    var children = node && node.children || [];
    for (var i = 0; i < children.length; i++) {
        if (children[i].name && String(children[i].name).replace(/^.*:/, '') === name) return children[i];
    }
    return null;
}
function choiceListDetailItems(value) {
    var out = [];
    var items = value && value.children || [];
    for (var i = 0; i < items.length; i++) {
        var pres = structuredChildText(items[i], 'Presentation');
        var text = pres && pres.text ? String(pres.text).trim() : '';
        if (!text) {
            var outer = structuredChildText(items[i], 'Value');
            var innerPres = structuredChildText(outer, 'Presentation');
            var inner = structuredChildText(outer, 'Value');
            text = innerPres && innerPres.text ? String(innerPres.text).trim() : '';
            if (!text && inner && inner.text != null) text = designTimeRefPresentation(String(inner.text).trim());
            if (!text && outer && outer.text != null) text = String(outer.text).trim();
        }
        out.push({ label: String(out.length + 1), value: text || 'Пусто' });
    }
    return out;
}

function elementInspector(entry) {
    if (!entry || !entry.item) return null;
    var item = entry.item;
    var properties = item.authoredProperties || item.properties || {};
    var rows = [];
    var groups = [];
    for (var key in properties) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
        var value = properties[key];
        var rowValue = propertyValuePresentation(value, key);
        /* The authored choice list carries full refs; show them here instead of a second group. */
        if (key === 'ChoiceListItems' && item.structuredProperties && item.structuredProperties.ChoiceList) {
            var choiceItems = choiceListDetailItems(item.structuredProperties.ChoiceList);
            if (choiceItems.length) rowValue = choiceItems.map(function (c) { return c.value; }).join(', ');
        }
        var row = {
            key: key, label: propertyTitle(key), value: rowValue,
            changed: false, color: /^#[0-9a-f]{6,8}$/i.test(String(value)) ? String(value) : ''
        };
        /* The host resolves the path to a form attribute and renders it as a link. */
        if (String(key).toLowerCase() === 'datapath' && typeof value === 'string' && value)
            row.link = 'data-path';
        rows.push(row);
        if (String(key).toLowerCase() === 'datapath' && entry.typeName) {
            rows.push({ key: 'Type', label: 'Тип', value: String(entry.typeName), changed: false, color: '' });
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            var objectItems = objectDetailItems(value, key);
            if (objectItems.length) groups.push({ label: propertyTitle(key), items: objectItems });
        }
    }
    var structured = item.structuredProperties || {};
    for (var structuredKey in structured) {
        if (!Object.prototype.hasOwnProperty.call(structured, structuredKey)) continue;
        if (structuredKey === 'ChoiceList' && properties.ChoiceListItems) continue;
        var structuredItems = structuredKey === 'ChoiceList'
            ? choiceListDetailItems(structured[structuredKey])
            : structuredDetailItems(structured[structuredKey], structuredKey);
        if (structuredItems.length) groups.push({ label: propertyTitle(structuredKey), items: structuredItems });
    }
    var linked = [];
    var extras = [
        ['Контекстное меню', item.contextMenu], ['Расширенная подсказка', item.extendedTooltip],
        ['Командная панель', item.autoCommandBar], ['Строка поиска', item.searchStringAddition],
        ['Состояние просмотра', item.viewStatusAddition], ['Управление поиском', item.searchControlAddition]
    ];
    for (var e = 0; e < extras.length; e++) {
        if (extras[e][1]) linked.push({ label: extras[e][0], value: extras[e][1].name || 'Задано' });
    }
    if (linked.length) groups.push({ label: 'Связанные объекты', items: linked });
    if (item.events && item.events.length) {
        groups.push({
            label: 'События (' + item.events.length + ')',
            open: true,
            items: item.events.map(function (event) {
                var handler = String(event && event.handler || '').trim();
                return {
                    label: eventTitle(event && event.name) || 'Событие',
                    value: handler || 'Обработчик не указан',
                    link: handler ? 'form-handler' : '',
                    handler: handler
                };
            })
        });
    }
    var command = entry.command;
    if (command) {
        var action = String(prop(command, ['Action', 'Handler']) || '').trim();
        groups.push({
            label: 'Команда',
            open: true,
            items: [{
                label: 'Обработчик',
                value: action || 'Обработчик не указан',
                link: action ? 'form-handler' : '',
                handler: action
            }]
        });
    }
    return {
        name: item.name || item.tag || 'Элемент', typeName: item.tag ? itemKindTitle(item.tag) : '',
        heading: 'Заданные свойства', isDiff: false, rows: rows, groups: groups
    };
}

/* Where each module procedure is wired up: element events, command actions
 * (reported through the buttons that run the command) and form events.
 * Keys are lower-cased handler names; a form-level usage has an empty id. */
function formHandlerIndex(model, elementOutline) {
    var index = {};
    function add(handler, usage) {
        var key = String(handler || '').trim().toLowerCase();
        if (!key) return;
        var list = index[key] || (index[key] = []);
        for (var i = 0; i < list.length; i++)
            if (list[i].id === usage.id && list[i].event === usage.event) return;
        list.push(usage);
    }
    var events = model && model.events || [];
    for (var f = 0; f < events.length; f++)
        add(events[f].handler, { id: '', label: 'Форма', event: eventTitle(events[f].name) });
    for (var e = 0; elementOutline && e < elementOutline.length; e++) {
        var entry = elementOutline[e];
        var label = entry.title || entry.name;
        var itemEvents = entry.item && entry.item.events || [];
        for (var j = 0; j < itemEvents.length; j++)
            add(itemEvents[j].handler, { id: entry.id, label: label, event: eventTitle(itemEvents[j].name) });
        if (entry.command)
            add(prop(entry.command, ['Action', 'Handler']), { id: entry.id, label: label, event: 'Команда' });
    }
    return index;
}

function attributeTypeName(attribute) {
    if (!attribute) return '';
    var raw = String(attribute.typeRefs || '').split(/\s*,\s*/).filter(Boolean);
    if (!raw.length && attribute.typeDescription && attribute.typeDescription.typeSets)
        raw = attribute.typeDescription.typeSets.slice();
    if (!raw.length && attribute.properties && attribute.properties.Type)
        raw = String(attribute.properties.Type).split(/\s*,\s*/).filter(Boolean);
    return raw.map(function (ref) {
        var shown = typePresentation(ref);
        var low = ref.toLowerCase();
        if (low === 'xs:string' && attribute.stringLen > 0) return shown + '(' + attribute.stringLen + ')';
        if (low === 'xs:decimal' && attribute.numberQ)
            return shown + '(' + attribute.numberQ.digits + ', ' + attribute.numberQ.fractionDigits + ')';
        if (low === 'xs:datetime' && attribute.dateFraction) {
            var part = String(attribute.dateFraction).toLowerCase();
            return shown + (part === 'date' ? ' (дата)' : part === 'time' ? ' (время)' : ' (дата и время)');
        }
        return shown;
    }).join(', ');
}

function attributeOutline(model, xml) {
    var out = [];
    var map = indexSourceLines(xml || '');
    var attrs = model && model.attributes || [];
    var bases = model && model.baseAttributes || [];
    var baseByName = {};
    for (var b = 0; b < bases.length; b++) if (bases[b] && bases[b].name) baseByName[bases[b].name] = bases[b];
    for (var i = 0; i < attrs.length; i++) {
        var item = attrs[i];
        out.push({
            type: 'form', itemKind: 'attribute', tag: 'Attribute', name: item.name || 'Attribute',
            title: '', line: lineOf(map, { tag: 'Attribute', name: item.name }), depth: 0,
            id: 'attribute:' + (item.id || item.name || i), typeName: attributeTypeName(item),
            attribute: item, baseAttribute: baseByName[item.name] || null
        });
    }
    return out;
}

function comparableAttributeValues(attribute) {
    var out = {};
    if (!attribute) return out;
    var props = attribute.properties || {};
    if (Object.prototype.hasOwnProperty.call(props, 'Type')) out.Type = attributeTypeName(attribute) || props.Type;
    for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key) || key === 'Type') continue;
        out[key] = props[key];
    }
    if (attribute.columns && attribute.columns.length) out.Columns = attribute.columns.length;
    if (attribute.settings) out.Settings = attribute.settings.mainTable || attribute.settings.type || 'Заданы';
    return out;
}

function attributeValuePresentation(value, key) {
    if (value == null || value === '') return '—';
    return propertyValuePresentation(value, key);
}

function attributeInspector(entry) {
    if (!entry || !entry.attribute) return null;
    var current = comparableAttributeValues(entry.attribute);
    var base = comparableAttributeValues(entry.baseAttribute);
    var diff = !!entry.baseAttribute;
    var rows = [];
    var groups = [];
    for (var key in current) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
        var before = Object.prototype.hasOwnProperty.call(base, key) ? base[key] : undefined;
        if (diff && String(before == null ? '' : before) === String(current[key] == null ? '' : current[key])) continue;
        rows.push({
            key: key,
            label: key === 'Type' ? 'Тип' : key === 'Columns' ? 'Колонки' : key === 'Settings' ? 'Настройки'
                : (propertyTitleFrom(ATTRIBUTE_PROPERTY_TITLES, key) || propertyTitle(key)),
            value: attributeValuePresentation(current[key], key),
            before: diff ? attributeValuePresentation(before, key) : '',
            changed: diff
        });
    }
    if (entry.attribute.columns && entry.attribute.columns.length) {
        groups.push({
            label: 'Колонки (' + entry.attribute.columns.length + ')',
            items: entry.attribute.columns.map(function (column) {
                return {
                    label: column.path || column.name || 'Колонка',
                    value: attributeTypeName(column) || 'Тип не указан'
                };
            })
        });
    }
    if (entry.attribute.settings) {
        groups.push({
            label: 'Настройки',
            items: [
                { label: 'Вид', value: entry.attribute.settings.type || 'Не указан' },
                { label: 'Основная таблица', value: entry.attribute.settings.mainTable || 'Не указана' }
            ]
        });
    }
    return {
        name: entry.attribute.name || entry.name || 'Реквизит',
        typeName: attributeTypeName(entry.attribute),
        heading: diff ? 'Изменённые свойства' : 'Заданные свойства',
        isDiff: diff,
        rows: rows,
        groups: groups
    };
}

function outlineHasChildren(items) {
    if (!items) return items;
    for (var i = 0; i < items.length; i++) {
        items[i].hasChildren = false;
        if (items[i].type !== 'form') continue;
        var d = items[i].depth || 0;
        if (i + 1 < items.length && items[i + 1].type === 'form' && (items[i + 1].depth || 0) > d) {
            items[i].hasChildren = true;
        }
    }
    return items;
}

function outlineHidden(items, index, collapsed) {
    if (!items || !collapsed || index < 0) return false;
    var d = items[index].depth || 0;
    for (var i = index - 1; i >= 0 && d > 0; i--) {
        if (items[i].type !== 'form') continue;
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
    var i;
    for (i = 0; i < items.length; i++) {
        if (items[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return false;
    var d = items[idx].depth || 0;
    var changed = false;
    for (i = idx - 1; i >= 0 && d > 0; i--) {
        if (items[i].type !== 'form') continue;
        var pd = items[i].depth || 0;
        if (pd < d) {
            if (items[i].id && collapsed[items[i].id]) {
                delete collapsed[items[i].id];
                changed = true;
            }
            d = pd;
        }
    }
    return changed;
}

function outlineCollapseAll(items, collapsed) {
    if (!collapsed) return collapsed;
    var k;
    for (k in collapsed) {
        if (Object.prototype.hasOwnProperty.call(collapsed, k)) delete collapsed[k];
    }
    outlineHasChildren(items);
    if (!items) return collapsed;
    for (var i = 0; i < items.length; i++) {
        if (items[i].hasChildren && items[i].id) collapsed[items[i].id] = true;
    }
    return collapsed;
}

/* A root surface may be wrapped in one or more transparent Representation=None
 * groups. The reference still places the native form inset before that first painted
 * surface; the transparent structural wrappers do not consume it. */
function firstItemOwnsNativeInset(item) {
    if (!item || !item.classList) return false;
    if ((item.dataset && item.dataset.tag === 'Pages')
        || item.classList.contains('fp-compact-color-band')
        || item.classList.contains('fp-root-color-surface')) return true;
    var source = item._fpItem;
    if (source && representationOf(source) === 'none'
        && !!prop(source, ['BackColor', 'ЦветФона'])) return true;
    if (!item.classList.contains('fp-bare')) return false;
    var box = item.querySelector
        ? item.querySelector(':scope > .fp-control-wrap > .fp-group-bare > .fp-children') : null;
    if (!box || !box.children) return false;
    for (var i = 0; i < box.children.length; i++) {
        var child = box.children[i];
        if (!child.classList || !child.classList.contains('fp-item')) continue;
        if (child.hidden || child.style.display === 'none') continue;
        return firstItemOwnsNativeInset(child);
    }
    return false;
}

/* The platform command bar is window chrome: it starts 3px below the caption
 * and the body spends no top inset on it. A form that publishes no such bar
 * opens ordinary content on the platform top inset instead — the reference
 * puts the first row of a bar-less form at y=35, not on the chrome line.
 * Only the top band differs; the horizontal inset is unchanged. */
function bodyOwnsContentTopInset(firstRenderedTag) {
    return String(firstRenderedTag || '') !== 'AutoCommandBar';
}

function renderMeta(model, host) {
    var bits = [];
    if (model.attributes && model.attributes.length) {
        bits.push('Реквизиты: ' + model.attributes.length);
    }
    if (model.commands && model.commands.length) {
        bits.push('Команды: ' + model.commands.length);
    }
    if (!bits.length) return;
    var bar = el('div', 'fp-meta');
    for (var i = 0; i < bits.length; i++) bar.appendChild(el('div', 'fp-meta-row', bits[i]));
    host.appendChild(bar);
}

function fillTabPagesPastTrailingSiblings(body) {
    if (!body || !body.children) return false;
    var visible = [];
    for (var i = 0; i < body.children.length; i++) {
        var child = body.children[i];
        if (!child.classList || !child.classList.contains('fp-item')) continue;
        if (child.hidden || child.style.display === 'none') continue;
        visible.push(child);
    }
    var pages = null;
    var trailing = 0;
    for (var p = 0; p < visible.length; p++) {
        var node = visible[p];
        if (node.dataset && node.dataset.tag === 'Pages'
            && node.classList.contains('fp-pages-tabs')
            && node.classList.contains('fp-vstretch')) {
            pages = node;
            trailing = visible.length - p - 1;
            break;
        }
    }
    if (!pages || trailing < 1) return false;
    var hasCommandBarFooter = false;
    for (var t = visible.length - trailing; t < visible.length; t++) {
        var trail = visible[t];
        if ((trail.dataset && trail.dataset.tag === 'CommandBar')
            || (trail.querySelector && trail.querySelector('[data-tag="CommandBar"]'))) {
            hasCommandBarFooter = true;
            break;
        }
    }
    if (!hasCommandBarFooter) return false;
    var trailHeight = 0;
    for (var th = visible.length - trailing; th < visible.length; th++)
        trailHeight += visible[th].getBoundingClientRect().height;
    var bodyBox = body.getBoundingClientRect();
    var pagesBox = pages.getBoundingClientRect();
    /* useIfNecessary: vstretch Pages takes the leftover client height, then
     * one more footer band so the command bar is wholly below the fold.
     * body.bottom − pages.top is the visible remainder; trailHeight is the
     * bar that must not remain on the last visible row (the reference wizard 04). */
    var fill = Math.round(bodyBox.bottom - pagesBox.top + trailHeight);
    if (fill < 80) return false;
    pages.style.minHeight = fill + 'px';
    pages.style.flexGrow = '0';
    pages.style.flexShrink = '0';
    pages.style.flexBasis = 'auto';
    stretchRootCommandBarFooter(body);
    return true;
}

function stretchRootCommandBarFooter(body) {
    if (!body || !body.children) return false;
    var last = null;
    for (var i = body.children.length - 1; i >= 0; i--) {
        var child = body.children[i];
        if (!child.classList || !child.classList.contains('fp-item')) continue;
        if (child.hidden || child.style.display === 'none') continue;
        last = child;
        break;
    }
    if (!last) return false;
    var bar = last.dataset && last.dataset.tag === 'CommandBar' ? last
        : last.querySelector('[data-tag="CommandBar"]');
    if (!bar) return false;
    var right = (bar.classList && bar.classList.contains('fp-align-right'))
        || (bar.style && /auto/i.test(String(bar.style.marginLeft || '')));
    if (!right) return false;
    /* The bar itself is the last root item: its own auto margin already puts it
     * on the right edge. Stretching it to 100% parked the buttons on the left
     * (e.g. Сохранить/Закрыть of a settings form). */
    if (last === bar) return false;
    last.classList.add('fp-root-command-footer');
    last.style.width = '100%';
    last.style.maxWidth = '100%';
    last.style.alignSelf = 'stretch';
    var innerPages = last.querySelector('.fp-item.fp-pages-none, .fp-item[data-tag="Pages"]');
    if (innerPages && innerPages.style) {
        innerPages.classList.add('fp-footer-pages-track');
        innerPages.style.setProperty('width', '100%', 'important');
        innerPages.style.setProperty('max-width', '100%', 'important');
        innerPages.style.setProperty('flex', '1 1 auto', 'important');
        innerPages.style.setProperty('align-self', 'stretch', 'important');
    }
    var bars = last.querySelectorAll('.fp-item[data-tag="CommandBar"].fp-align-right');
    if (!bars.length && bar.classList) bars = [bar];
    for (var b = 0; b < bars.length; b++) {
        bars[b].style.marginLeft = 'auto';
        bars[b].style.flex = '0 0 auto';
        bars[b].style.width = 'auto';
        bars[b].style.maxWidth = 'none';
        bars[b].classList.add('fp-align-right', 'fp-no-hstretch');
        bars[b].classList.remove('fp-hstretch');
        var innerBar = bars[b].querySelector('.fp-commandbar');
        if (innerBar && innerBar.style) {
            innerBar.style.width = 'auto';
            innerBar.style.maxWidth = 'none';
            innerBar.style.flex = '0 0 auto';
        }
    }
    return true;
}

function render(model, container, options) {
    options = options || {};
    if (container._fpCtx && container._fpCtx.root)
        closeAllPopups(container._fpCtx.root);
    container.innerHTML = '';
    container.className = 'fp-root fp-taxi fp-light';
    var body = el('div', 'fp-body');
    body.id = 'fp-canvas';
    container.appendChild(body);
    if (!model) {
        body.className = 'fp-body fp-empty';
        body.textContent = 'Нет модели формы';
        return;
    }
    var commandTitles = {};
    var commands = {};
    var cmds = model.commands || [];
    for (var i = 0; i < cmds.length; i++) {
        if (cmds[i].name) commands[cmds[i].name] = cmds[i];
        var cap = rawTitle(cmds[i]);
        if (cap && cmds[i].name) commandTitles[cmds[i].name] = cap;
    }
    var items = displayItems(model);
    var ctx = {
        model: model,
        root: body,
        onSelect: options.onSelect,
        commandTitles: commandTitles,
        commands: commands,
        selectedId: '',
        captionIndex: buildCaptionIndex(model),
        styleItems: model.styleItems || {},
        commonPictures: model.commonPictures || {}
    };
    if (formObjectKind(model) === 'catalog') body.classList.add('fp-form-catalog');
    container._fpCtx = ctx;
    if (!container._fpPopupDismiss) {
        var popupRoot = function () { return container.querySelector('#fp-canvas') || container; };
        container._fpPopupDismiss = function (ev) {
            var t = ev.target;
            if (t && t.closest && (t.closest('.fp-popup-wrap') || t.closest('.fp-popup-group')
                || t.closest('.fp-popup-menu') || t.closest('.fp-popup-group-body'))) return;
            closeAllPopups(popupRoot());
        };
        container._fpPopupKey = function (ev) {
            if (ev.key === 'Escape' || ev.keyCode === 27) closeAllPopups(popupRoot());
        };
        var doc = container.ownerDocument || document;
        doc.addEventListener('click', container._fpPopupDismiss, true);
        doc.addEventListener('keydown', container._fpPopupKey);
    }
    /* The managed client always keeps the 23px window-caption strip, even when
     * a form has no visible title. ShowTitle controls the text, not the blue
     * chrome itself (many generated forms deliberately leave that strip blank). */
    var formTitle = options.windowTitle || rawTitle(model);
    var cap = el('div', 'fp-form-title');
    if (options.windowTitle || (formTitle && !isFalse(prop(model, ['ShowTitle', 'ПоказыватьЗаголовок'])))) {
        setFormattedText(cap, formTitle, false,
            options.windowTitle ? false : !isFalse(prop(model, ['TitleFormatted'])));
    }
    container.insertBefore(cap, body);
    /* Form.Width is a character count, and 1C really does open such a form that
     * narrow. Only plausible dialog widths are honoured: a few forms carry a
     * number that is clearly not characters, and squeezing on that would lie. */
    var fwChars = parseInt(prop(model, ['Width', 'Ширина']), 10);
    /* The width is on the reference char-unit ruler (Width*10+10) plus the window
     * insets: Width=68 opens 712 px wide in the reference; the
     * 8px browser grid (584) squeezed its table and message band. */
    if (fwChars > 0 && fwChars <= 200) body.style.maxWidth = (fwChars * REF_AUTHORED_CHAR_PX + 10 + 34) + 'px';
    var verticalScroll = String(prop(model, ['VerticalScroll', 'ВертикальнаяПолосаПрокрутки']) || '')
        .toLowerCase().replace(/[ _-]+/g, '');
    var scrollWithoutStretch = verticalScroll.indexOf('usewithoutstretch') >= 0
        || verticalScroll.indexOf('использоватьбезрастягивания') >= 0;
    var scrollIfNecessary = verticalScroll.indexOf('useifnecessary') >= 0
        || verticalScroll.indexOf('использоватьпринеобходимости') >= 0;
    if (!items.length) {
        body.className = 'fp-body fp-empty';
        body.innerHTML = '<p class="fp-empty-title">Превью формы</p><p class="fp-empty-hint">В Form.xml нет элементов ChildItems.</p>';
    } else {
        /* The root is laid out by the Form's own Group/spacing/ChildItemsWidth,
         * exactly like a UsualGroup - previously these were dropped. */
        var rootMeta = layoutMeta(model);
        applyLayout(body, rootMeta);
        /* Form.Group=AlwaysHorizontal/Horizontal puts the root groups side by
         * side in the reference; only an explicit Form.Group does, the
         * default root flow stays vertical. */
        var rootHorizontal = rootMeta.orientation === 'horizontal'
            && !!normOrient(prop(model, ['Group', 'Группировка']));
        if (rootHorizontal) body.classList.add('fp-root-horizontal');
        var firstContentItem = items.filter(function (item) {
            return item && item.tag !== 'AutoCommandBar' && item.tag !== 'CommandBar';
        })[0];
        if (isCompactColorBand(firstContentItem))
            body.classList.add('fp-root-notice-band');
        renderPreview(items, body, ctx, model);
        if (rootHorizontal) {
            /* One equal grid column per root content item; the root
             * AutoCommandBar spans the whole row above them (viewer.css). */
            var rootColumnCount = 0;
            for (var rootColIndex = 0; rootColIndex < body.children.length; rootColIndex++) {
                var rootColChild = body.children[rootColIndex];
                if (!rootColChild.classList || !rootColChild.classList.contains('fp-item')) continue;
                if (rootColChild.dataset && rootColChild.dataset.tag === 'AutoCommandBar') continue;
                rootColumnCount++;
            }
            if (rootColumnCount > 0)
                body.style.gridTemplateColumns = 'repeat(' + rootColumnCount + ', minmax(0, 1fr))';
        }
        var firstRenderedRootItem = null;
        for (var rootIndex = 0; rootIndex < body.children.length; rootIndex++) {
            var rootChild = body.children[rootIndex];
            if (!rootChild.classList || !rootChild.classList.contains('fp-item')) continue;
            if (rootChild.hidden || rootChild.style.display === 'none') continue;
            firstRenderedRootItem = rootChild;
            break;
        }
        var firstRenderedTag = firstRenderedRootItem && firstRenderedRootItem.dataset
            ? firstRenderedRootItem.dataset.tag : '';
        var rootOwnsInset = firstRenderedTag === 'Pages'
            || firstItemOwnsNativeInset(firstRenderedRootItem);
        if (rootOwnsInset) body.classList.add('fp-root-native-inset');
        else if (bodyOwnsContentTopInset(firstRenderedTag))
            body.classList.add('fp-root-content-top-inset');
        equalizeLocalFieldBlocks(body);
        fitWrappedSideCaptions(body);
        fitAllLeadingCaptionsBeforeTitledPagesNone(body);
        anchorBottomAlignedRuns(body);
        var strategyState = runHorizontalStrategyPass(body);
        /* The strategy pass reallocates authored width bands. Right command
         * bars are trailing lanes inside those final bands, so pin them only
         * after the allocation is complete; doing it earlier lets the generic
         * pass expand the bar back to its intrinsic command width. */
        fitRightCommandBarLanes(body);
        fitAllLeadingCaptionsBeforeTitledPagesNone(body);
        /* Dev/test-only autonomous layout shadow. The hook is absent in all
         * normal hosts, cannot mutate renderer geometry, and failures remain
         * diagnostic so preview availability never depends on it. */
        if (root.FormLayoutShadow && typeof root.FormLayoutShadow.run === 'function') {
            try { ctx.layoutShadowReport = root.FormLayoutShadow.run({ model: model, body: body, strategy: strategyState }); }
            catch (shadowError) { ctx.layoutShadowReport = { error: String(shadowError && shadowError.message || shadowError) }; }
        }
        if (root.__TC_BSL_FIXED_PAIR_SHADOW__ === true
            && root.FixedPairLayoutShadow && typeof root.FixedPairLayoutShadow.run === 'function') {
            try { ctx.fixedPairLayoutShadowReport = root.FixedPairLayoutShadow.run({ model: model, body: body }); }
            catch (fixedPairShadowError) {
                ctx.fixedPairLayoutShadowReport = { error: String(fixedPairShadowError && fixedPairShadowError.message || fixedPairShadowError) };
            }
        }
        if (scrollWithoutStretch && hasVerticallyClippedSibling(body))
            body.classList.add('fp-vertical-scroll-without-stretch');
        if (scrollIfNecessary) {
            /* useIfNecessary does not pin a trailing command-bar footer inside
             * the first viewport. Stretching TabsOnTop Pages fill the remaining
             * client height so wizard Далее/Отмена sit below the fold. Ordinary catalog
             * forms still reserve the window scrollbar when they already overflow. */
            var filledWizardFooter = fillTabPagesPastTrailingSiblings(body);
            if ((filledWizardFooter || formObjectKind(model) === 'catalog')
                && body.scrollHeight > body.clientHeight + 1) {
                body.classList.add('fp-vertical-scroll-needed');
                fitFormViewport(body);
                if (body.querySelector('.fp-root-flattened-page.fp-root-band-overflow')) {
                    body.classList.add('fp-window-overflow');
                    body.classList.add('fp-flattened-page-overflow');
                }
            }
        }
        publishWindowScrollStart(body);
        observeFormViewport(body);
    }
}

function revealPopupAncestors(root, node) {
    if (!root || !node) return;
    var wrap = null;
    var group = null;
    var n = node;
    while (n && n !== root) {
        if (n.classList && n.classList.contains('fp-popup-wrap')) { wrap = n; break; }
        if (n.classList && n.classList.contains('fp-popup-group')) { group = n; break; }
        n = n.parentNode;
    }
    if (!wrap && node.querySelector)
        wrap = node.querySelector('.fp-popup-wrap');
    if (wrap) {
        var btn = wrap.querySelector('.fp-popup') || wrap.querySelector('.fp-button');
        var menu = wrap.querySelector('.fp-popup-menu');
        openPopupPanel(root, wrap, btn, menu, 180);
        return;
    }
    if (!group) return;
    if (group.classList && group.classList.contains('fp-popup-designer-inline')
        && group.closest && group.closest('.fp-body.fp-mockup')) return;
    var gWrap = group.parentNode;
    while (gWrap && gWrap !== root && !(gWrap.classList && gWrap.classList.contains('fp-control-wrap')))
        gWrap = gWrap.parentNode;
    var gBtn = group.querySelector('.fp-popup-group-title');
    var gBody = group.querySelector('.fp-popup-group-body');
    openPopupPanel(root, group, gBtn, gBody, 320, gWrap);
}

function highlight(container, id) {
    if (!container || !id) return null;
    var ctx = container._fpCtx;
    if (ctx && ctx.model && activatePagesForId(ctx.model, id)) {
        renderPreview(displayItems(ctx.model), ctx.root, ctx, ctx.model);
        equalizeLocalFieldBlocks(ctx.root);
        runHorizontalStrategyPass(ctx.root);
    }
    var canvas = container.querySelector('#fp-canvas') || (ctx && ctx.root) || container;
    var hit = selectIn(canvas, id, ctx);
    var entry = null;
    if (canvas && canvas.querySelector)
        entry = canvas.querySelector('.fp-popup-entry[data-id="' + cssEscape(id) + '"]');
    revealPopupAncestors(canvas, entry || hit);
    var focus = entry || hit;
    if (focus && focus.scrollIntoView) {
        try { focus.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        catch (e) { focus.scrollIntoView(); }
    }
    return focus;
}

function dismiss(container) {
    if (!container) return;
    var ctx = container._fpCtx;
    closeAllPopups((ctx && ctx.root) || container);
}

/* Leaf boxes whose paint must never cover another leaf. Containers are left
 * out: a group legitimately encloses its children, and an overlap between two
 * containers always shows up as an overlap between their leaves. */
var PAINTED_LEAF_CLASSES = [
    'fp-field-label', 'fp-input-wrap', 'fp-labelfield-value',
    'fp-label-decoration', 'fp-picture-decoration', 'fp-button',
    'fp-hyperlink', 'fp-link', 'fp-rich-link', 'fp-checkbox-row',
    'fp-check', 'fp-switch', 'fp-radio-option', 'fp-segmented',
    'fp-search-field', 'fp-collapsible-title', 'fp-group-title',
    'fp-popup-group-title', 'fp-table-mock', 'fp-list-mock',
    'fp-pages-tablist', 'fp-spreadsheet-viewport', 'fp-html-document',
    'fp-chart-widget', 'fp-tooltip-link', 'fp-input-btn', 'fp-spin',
    /* ShowTop/ShowBottom/ShowLeft/ShowRight tooltip text is painted on the
     * form, not a hover layer. */
    'fp-tooltip-text'
];
var PAINTED_LEAF_SELECTOR = PAINTED_LEAF_CLASSES.map(function (name) {
    return '.' + name;
}).join(', ');

/* Transient layers paint over the form by design. The DataSearch glyph of a
 * white search surface deliberately sits on the field's right border, as in
 * the reference. */
var OVERLAP_EXEMPT_SELECTOR = '.fp-popup, .fp-popup-menu, '
    + '.fp-flattened-pages-measure, [data-fp-overlap-allowed], '
    + '.fp-search-picture-surface > .fp-control-wrap > .fp-group-bare > .fp-children'
    + ' > .fp-item[data-tag="PictureDecoration"]';

function overlapLeafKind(node) {
    for (var i = 0; i < PAINTED_LEAF_CLASSES.length; i++) {
        if (node.classList.contains(PAINTED_LEAF_CLASSES[i])) return PAINTED_LEAF_CLASSES[i];
    }
    return node.tagName.toLowerCase();
}

/* Painted extent of one leaf: its box, plus overflowing text when the leaf
 * does not clip, cut by every clipping ancestor up to the form body. */
function overlapPaintedRect(node, body) {
    var style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
        return null;
    var box = node.getBoundingClientRect();
    var rect = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    if (style.overflowX === 'visible' && node.firstChild && document.createRange) {
        var range = document.createRange();
        range.selectNodeContents(node);
        var text = range.getBoundingClientRect();
        if (text.width > 0 && text.height > 0) {
            rect.left = Math.min(rect.left, text.left);
            rect.right = Math.max(rect.right, text.right);
            rect.top = Math.min(rect.top, text.top);
            rect.bottom = Math.max(rect.bottom, text.bottom);
        }
    }
    for (var parent = node.parentElement; parent; parent = parent.parentElement) {
        var parentStyle = getComputedStyle(parent);
        if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden') return null;
        if (parentStyle.overflowX !== 'visible' || parentStyle.overflowY !== 'visible') {
            var clip = parent.getBoundingClientRect();
            if (parentStyle.overflowX !== 'visible') {
                rect.left = Math.max(rect.left, clip.left);
                rect.right = Math.min(rect.right, clip.right);
            }
            if (parentStyle.overflowY !== 'visible') {
                rect.top = Math.max(rect.top, clip.top);
                rect.bottom = Math.min(rect.bottom, clip.bottom);
            }
        }
        if (parent === body) break;
    }
    if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) return null;
    return rect;
}

/* Invariant check: pairs of visible painted leaves that cover each other by
 * more than `tolerance` px on both axes. Ancestor/descendant pairs (a button
 * inside its field) are not collisions. Returns report-friendly records keyed
 * by the owning 1C item so results are comparable across runs. */
function paintedOverlaps(container, options) {
    var body = container && container.classList && container.classList.contains('fp-body')
        ? container : (container || document).querySelector('.fp-body');
    if (!body) return [];
    var tolerance = options && options.tolerance != null ? Number(options.tolerance) : 1;
    var nodes = body.querySelectorAll(PAINTED_LEAF_SELECTOR);
    var leaves = [];
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].closest(OVERLAP_EXEMPT_SELECTOR)) continue;
        var rect = overlapPaintedRect(nodes[i], body);
        if (!rect) continue;
        var owner = nodes[i].closest('[data-id]');
        var ownerItem = owner && owner._fpItem;
        leaves.push({
            node: nodes[i], rect: rect,
            id: ownerItem && ownerItem.name ? String(ownerItem.name)
                : owner ? owner.getAttribute('data-id') : '',
            kind: overlapLeafKind(nodes[i])
        });
    }
    leaves.sort(function (a, b) { return a.rect.left - b.rect.left; });
    var result = [];
    var active = [];
    for (var j = 0; j < leaves.length; j++) {
        var current = leaves[j];
        active = active.filter(function (other) {
            return other.rect.right - tolerance > current.rect.left;
        });
        for (var k = 0; k < active.length; k++) {
            var other = active[k];
            if (other.node.contains(current.node) || current.node.contains(other.node)) continue;
            var dx = Math.min(other.rect.right, current.rect.right)
                - Math.max(other.rect.left, current.rect.left);
            var dy = Math.min(other.rect.bottom, current.rect.bottom)
                - Math.max(other.rect.top, current.rect.top);
            if (dx <= tolerance || dy <= tolerance) continue;
            var pair = [other, current].sort(function (a, b) {
                return (a.id + ':' + a.kind) < (b.id + ':' + b.kind) ? -1 : 1;
            });
            if (options && options.highlight) {
                other.node.setAttribute('data-fp-overlap', '1');
                current.node.setAttribute('data-fp-overlap', '1');
            }
            result.push({
                key: pair[0].id + ':' + pair[0].kind + '|' + pair[1].id + ':' + pair[1].kind,
                a: { id: pair[0].id, kind: pair[0].kind },
                b: { id: pair[1].id, kind: pair[1].kind },
                dx: Math.round(dx * 10) / 10,
                dy: Math.round(dy * 10) / 10,
                area: Math.round(dx * dy)
            });
        }
        active.push(current);
    }
    return result;
}

root.FormPreview = {
    /* English → Russian names of the platform picture library, so other modules
     * can tell a real StdPicture name from a typo. */
    stdPictureRu: STD_PICTURE_RU,
    paintedOverlaps: paintedOverlaps,
    detect: detect,
    parse: parse,
    activeEvents: activeEvents,
    resetViewState: resetViewState,
    render: render,
    outline: outline,
    attributeOutline: attributeOutline,
    formHandlerIndex: formHandlerIndex,
    attributeInspector: attributeInspector,
    elementInspector: elementInspector,
    itemKindTitle: itemKindTitle,
    outlineHasChildren: outlineHasChildren,
    outlineHidden: outlineHidden,
    outlineExpandTo: outlineExpandTo,
    outlineCollapseAll: outlineCollapseAll,
    highlight: highlight,
    dismiss: dismiss,
    itemKey: itemKey,
    iconFor: iconFor,
    attributeIcon: attributeIcon,
    /* 1C type names in the Designer's spelling, shared with the object window. */
    typePresentation: typePresentation,
    _test: {
        horizontalRowMetrics: horizontalRowMetrics,
        fitFormViewport: fitFormViewport,
        containHorizontalTrackRows: containHorizontalTrackRows,
        layoutMeta: layoutMeta,
        emptyDecorationIsCompactInParent: emptyDecorationIsCompactInParent,
        pictureDecorationIconId: pictureDecorationIconId,
        renderablePages: renderablePages,
        markPagesTabbedShell: markPagesTabbedShell,
        isRootFlattenedPage: isRootFlattenedPage,
        isFlattenedPageLeadingCaptionItem: isFlattenedPageLeadingCaptionItem,
        applyLayout: applyLayout,
        layoutClass: layoutClass,
        isLogicalSubgridGroup: isLogicalSubgridGroup,
        isOrdinaryRowControl: isOrdinaryRowControl,
        automaticCompoundSelectorChildren: automaticCompoundSelectorChildren,
        normGroupMode: normGroupMode,
        normSpacing: normSpacing,
        normThrough: normThrough,
        normGroupRepresentation: normGroupRepresentation,
        effectiveThroughAlign: effectiveThroughAlign,
        spacingUnits: spacingUnits,
        spacingPx: spacingPx,
        labelMetric: labelMetric,
        responsiveGroupNeedsVertical: responsiveGroupNeedsVertical,
        precedingCappedPageColumnWidth: precedingCappedPageColumnWidth,
        precedingThroughAlignTitleTrackWidth: precedingThroughAlignTitleTrackWidth,
        inheritPageFollowingThroughAlignTracks: inheritPageFollowingThroughAlignTracks,
        horizontalPreferredWidth: horizontalPreferredWidth,
        horizontalPaintedTrackMinimum: horizontalPaintedTrackMinimum,
        horizontalCompressedWidth: horizontalCompressedWidth,
        horizontalPriorityPressure: horizontalPriorityPressure,
        verticalFieldPriorityPressure: verticalFieldPriorityPressure,
        rootSimpleVerticalColumnWidth: rootSimpleVerticalColumnWidth,
        revertPromotedAutoTitles: revertPromotedAutoTitles,
        setResponsiveGroupOrientation: setResponsiveGroupOrientation,
        prepareResponsiveGroups: prepareResponsiveGroups,
        selectHorizontalStrategy: selectHorizontalStrategy,
        horizontalStrategyValue: horizontalStrategyValue,
        runHorizontalStrategyPass: runHorizontalStrategyPass,
        dimensionBands: dimensionBands,
        authoredControlHeightPx: authoredControlHeightPx,
        authoredEditorPaintWidth: authoredEditorPaintWidth,
        authoredAutoMaxEditorPaintWidth: authoredAutoMaxEditorPaintWidth,
        autoMaxEditorBandWidth: autoMaxEditorBandWidth,
        isTrailingVisibleChild: isTrailingVisibleChild,
        itemHorizontalAllocationBand: itemHorizontalAllocationBand,
        logicalSubgridAllocationBand: logicalSubgridAllocationBand,
        authoredLabelWidthEnvelopePx: authoredLabelWidthEnvelopePx,
        unboundedLabelDecorationSlack: unboundedLabelDecorationSlack,
        multilineFieldLayoutContract: multilineFieldLayoutContract,
        applyMultilineEditorPaintBand: applyMultilineEditorPaintBand,
        applyMultilineEditorVerticalBand: applyMultilineEditorVerticalBand,
        authoredEditorActionCaptionWidth: authoredEditorActionCaptionWidth,
        detachedLogicalColumnHeightIsAdvisory: detachedLogicalColumnHeightIsAdvisory,
        pageLocalResponsiveColumnEligible: pageLocalResponsiveColumnEligible,
        pageLocalResponsiveColumnChildrenEligible: pageLocalResponsiveColumnChildrenEligible,
        pageIntrinsicThroughAlignEligible: pageIntrinsicThroughAlignEligible,
        htmlDocumentAuthoredSize: htmlDocumentAuthoredSize,
        chartAuthoredSize: chartAuthoredSize,
        taxiLayoutMetrics: TAXI_LAYOUT_METRICS,
        distributeDimensionBands: distributeDimensionBands,
        allocateHorizontalDimensionBands: allocateHorizontalDimensionBands,
        balancedBoundedLogicalPairWidth: balancedBoundedLogicalPairWidth,
        fitTrailingLogicalThroughAlignTrack: fitTrailingLogicalThroughAlignTrack,
        detachedEqualPairSizes: detachedEqualPairSizes,
        managedCompressedLeftWideSizes: managedCompressedLeftWideSizes,
        managedIndependentTitleTrackWidth: managedIndependentTitleTrackWidth,
        combineLogicalSubgridBands: combineLogicalSubgridBands,
        isBareAutomaticColumnTreeItem: isBareAutomaticColumnTreeItem,
        isRecursiveAutomaticColumnTree: isRecursiveAutomaticColumnTree,
        semanticEditorAllocationBand: semanticEditorAllocationBand,
        semanticEditorPaintBand: semanticEditorPaintBand,
        automaticCompoundEditorPaintWidth: automaticCompoundEditorPaintWidth,
        projectedTopTitleTrackBand: projectedTopTitleTrackBand,
        finiteProjectedTrackSizes: finiteProjectedTrackSizes,
        fitProjectedCompoundEditorBands: fitProjectedCompoundEditorBands,
        fitProjectedCompoundLogicalTracks: fitProjectedCompoundLogicalTracks,
        throughAlignTitleTrackWidth: throughAlignTitleTrackWidth,
        projectedOwnerThroughAlignLabels: projectedOwnerThroughAlignLabels,
        wrappedSideCaptionTrackWidth: wrappedSideCaptionTrackWidth,
        localCompoundTitleTrackWidth: localCompoundTitleTrackWidth,
        compoundTrailingTitlesAreLocal: compoundTrailingTitlesAreLocal,
        managedResponsivePairSizes: managedResponsivePairSizes,
        logicalSubgridAllocationBand: logicalSubgridAllocationBand,
        projectFieldColumnsWithDecorationTail: projectFieldColumnsWithDecorationTail,
        responsiveWrapperAllocationBand: responsiveWrapperAllocationBand,
        scrollCanvasWrapperAllocationBand: scrollCanvasWrapperAllocationBand,
        automaticEditorScrollAllocationBand: automaticEditorScrollAllocationBand,
        pageScrollCanvasPreferredRowWidth: pageScrollCanvasPreferredRowWidth,
        descendantTableColumnRecommendation: descendantTableColumnRecommendation,
        isTableColumnResponsivePair: isTableColumnResponsivePair,
        compactListColumnBands: compactListColumnBands,
        tableSummaryStretchStackEligible: tableSummaryStretchStackEligible,
        applyHorizontalWidthAllocations: applyHorizontalWidthAllocations,
        plainSemanticEditorRow: plainSemanticEditorRow,
        rootPagesPreferredHeight: rootPagesPreferredHeight,
        fitRootPagesPreferredHeights: fitRootPagesPreferredHeights,
        fitFlattenedPagesAlternativeEnvelope: fitFlattenedPagesAlternativeEnvelope,
        wantsHStretch: wantsHStretch,
        refDefaultWrapperStretch: refDefaultWrapperStretch,
        hasFixedHorizontalSize: hasFixedHorizontalSize,
        compactTag: compactTag,
        defaultFieldChars: defaultFieldChars,
        typeFeaturesOf: typeFeaturesOf,
        defaultCharsOf: defaultCharsOf,
        resolveInputFieldButtons: resolveInputFieldButtons,
        applyTypeDefaultsToItem: applyTypeDefaultsToItem,
        catalogPresentationLength: catalogPresentationLength,
        tableColumnHeaderChars: tableColumnHeaderChars,
        defaultEditorPaintWidth: defaultEditorPaintWidth,
        defaultWidthClampsButtons: defaultWidthClampsButtons,
        labelDecorationCanDynamicHeight: labelDecorationCanDynamicHeight,
        presentationLengthOf: presentationLengthOf,
        defaultFieldWidthPx: defaultFieldWidthPx,
        compactQualifiedSingleFieldWidth: compactQualifiedSingleFieldWidth,
        buildCaptionIndex: buildCaptionIndex,
        metaType: metaType,
        typePresentation: typePresentation,
        attributeTypeName: attributeTypeName,
        comparableAttributeValues: comparableAttributeValues,
        attributeValuePresentation: attributeValuePresentation,
        propertyValuePresentation: propertyValuePresentation,
        elementInspector: elementInspector,
        itemKindTitle: itemKindTitle,
        attributeIcon: attributeIcon,
        itemTypePresentation: itemTypePresentation,
        metaStringLengthQualifier: metaStringLengthQualifier,
        titleLocation: titleLocation,
        pagesRep: pagesRep,
        commandBarHasOnlyHyperlinks: commandBarHasOnlyHyperlinks,
        fitPageTabWidth: fitPageTabWidth,
        fitPageTabs: fitPageTabs,
        chartFillRemainingHeight: chartFillRemainingHeight,
        fitChartFields: fitChartFields,
        MIN_PAGE_TAB_PX: MIN_PAGE_TAB_PX,
        WIDE_PAGE_TAB_MIN_PX: WIDE_PAGE_TAB_MIN_PX,
        isEmptyCommandBar: isEmptyCommandBar,
        tableCommandBarVisible: tableCommandBarVisible,
        groupHasFields: groupHasFields,
        isFalse: isFalse,
        isTrue: isTrue,
        titleOf: titleOf,
        displayLabel: displayLabel,
        isPaintlessLabelField: isPaintlessLabelField,
        humanizeIdent: humanizeIdent,
        fieldRowSkipped: fieldRowSkipped,
        radioOptions: radioOptions,
        radioOptionsLayout: radioOptionsLayout,
        booleanTumblerOptions: booleanTumblerOptions,
        tableColumns: tableColumns,
        tablePhysicalColumns: tablePhysicalColumns,
        tableColumnNativeMinimumPx: tableColumnNativeMinimumPx,
        columnWidthPx: columnWidthPx,
        allocateTableColumnWidths: allocateTableColumnWidths,
        fitPhysicalTableColumnWidths: fitPhysicalTableColumnWidths,
        headerKids: headerKids,
        isVerticalColumnGroup: isVerticalColumnGroup,
        firstVisibleColumnCaption: firstVisibleColumnCaption,
        columnCaption: columnCaption,
        tableStdCommands: tableStdCommands,
        tableBarItems: tableBarItems,
        tableIsList: tableIsList,
        tableIsTree: tableIsTree,
        treeExpanded: treeExpanded,
        parseFont: parseFont,
        parseItemProperties: parseItemProperties,
        parseStructuredXmlValue: parseStructuredXmlValue,
        parseStructuredProperties: parseStructuredProperties,
        parseInputFieldComplexProperties: parseStructuredProperties,
        structuredAttribute: structuredAttribute,
        structuredIsNil: structuredIsNil,
        structuredHasPayload: structuredHasPayload,
        normalizeStructuredPicture: normalizeStructuredPicture,
        normalizeStructuredBorder: normalizeStructuredBorder,
        normalizeStructuredPeriod: normalizeStructuredPeriod,
        normalizeStructuredRowFilter: normalizeStructuredRowFilter,
        normalizeChoiceParameterLinks: normalizeChoiceParameterLinks,
        normalizeChoiceParameters: normalizeChoiceParameters,
        applyStructuredRuntime: applyStructuredRuntime,
        parseTypeDescription: parseTypeDescription,
        parseEvents: parseEvents,
        eventTitle: eventTitle,
        hasEvent: hasEvent,
        activeEvents: activeEvents,
        fontCss: fontCss,
        commandBarLocation: commandBarLocation,
        tooltipRepresentation: tooltipRepresentation,
        tooltipText: tooltipText,
        isCompactColorBand: isCompactColorBand,
        authoredContainerHeightUsesIntrinsicFloor: authoredContainerHeightUsesIntrinsicFloor,
        groupPaintIsNone: groupPaintIsNone,
        omittedVerticalSectionBoundary: omittedVerticalSectionBoundary,
        omittedVerticalSectionSpacing: omittedVerticalSectionSpacing,
        applyOmittedVerticalSectionBoundaries: applyOmittedVerticalSectionBoundaries,
        isTumbler: isTumbler,
        normPictureSize: normPictureSize,
        absoluteColor: absoluteColor,
        styleItemColor: styleItemColor,
        styleItemLookup: styleItemLookup,
        buttonColorGradient: buttonColorGradient,
        mergeNamedItems: mergeNamedItems,
        inheritedCommandName: inheritedCommandName,
        parseCommonCommands: parseCommonCommands,
        commonCommandButtons: commonCommandButtons,
        fillCommonCommands: fillCommonCommands,
        restoreInheritedCommandRefs: restoreInheritedCommandRefs,
        charHeight: charHeight,
        tableHeightMetrics: tableHeightMetrics,
        tableAuthoredHeightPx: tableAuthoredHeightPx,
        tableCalibratedMinimumHeightPx: tableCalibratedMinimumHeightPx,
        containsAuthoredHeightTable: containsAuthoredHeightTable,
        isPictureLabelDisclosureRow: isPictureLabelDisclosureRow,
        pageTableChromeCadenceChildren: pageTableChromeCadenceChildren,
        tableWidthMetrics: tableWidthMetrics,
        tableWidgetWidthMetrics: tableWidgetWidthMetrics,
        tableBarItems: tableBarItems,
        isCreateBasedOnPopup: isCreateBasedOnPopup,
        createBasedOnButtons: createBasedOnButtons,
        applyCreateBasedOnPicture: applyCreateBasedOnPicture,
        basedOnTitle: basedOnTitle,
        showGroupTitle: showGroupTitle,
        groupBehavior: groupBehavior,
        initiallyCollapsed: initiallyCollapsed,
        formattedTextParts: formattedTextParts,
        plainFormattedText: plainFormattedText,
        isPopUpGroup: isPopUpGroup,
        applyLabelWidth: applyLabelWidth,
        fitWrappedSideCaptions: fitWrappedSideCaptions,
        isPairedTitledLogicalColumns: isPairedTitledLogicalColumns,
        applyPairedTitledLogicalColumnContract: applyPairedTitledLogicalColumnContract,
        collectFieldLabels: collectFieldLabels,
        leadingThroughAlignColumnBox: leadingThroughAlignColumnBox,
        captionLedHorizontalRow: captionLedHorizontalRow,
        compactTitledHorizontalPairKeepsLocalCaptions: compactTitledHorizontalPairKeepsLocalCaptions,
        compactCatalogRefEditorPaintWidth: compactCatalogRefEditorPaintWidth,
        fitCompactTitledHorizontalPairCaptions: fitCompactTitledHorizontalPairCaptions,
        fitLeadingCaptionBeforeTitledPagesNone: fitLeadingCaptionBeforeTitledPagesNone,
        firstItemOwnsNativeInset: firstItemOwnsNativeInset,
        adaptivePrimaryCommandText: adaptivePrimaryCommandText,
        commandBarLeadingContributionCount: commandBarLeadingContributionCount,
        commandBarSiblingLaneBudget: commandBarSiblingLaneBudget,
        rightCommandBarLane: rightCommandBarLane,
        isNativeCardStack: isNativeCardStack,
        fieldKind: fieldKind,
        hasCalendarChoicePicture: hasCalendarChoicePicture,
        referenceTypeSupportsOpen: referenceTypeSupportsOpen,
        inputButtonKinds: inputButtonKinds,
        bodyOwnsContentTopInset: bodyOwnsContentTopInset,
        isInCellGroup: isInCellGroup,
        additionHidden: additionHidden,
        inAdditionalBar: inAdditionalBar,
        fillTabPagesPastTrailingSiblings: fillTabPagesPastTrailingSiblings,
        stretchRootCommandBarFooter: stretchRootCommandBarFooter,
        isDeadCommand: isDeadCommand,
        hasMainBarChildren: hasMainBarChildren,
        collectAdditionalBarItems: collectAdditionalBarItems,
        popupHasCommands: popupHasCommands,
        popupMenuEntries: popupMenuEntries,
        closeAllPopups: closeAllPopups,
        revealPopupAncestors: revealPopupAncestors,
        parseObjectMeta: parseObjectMeta,
        buildCaptionIndex: buildCaptionIndex,
        captionForPath: captionForPath,
        metaNumberQualifiers: metaNumberQualifiers,
        metaDateFraction: metaDateFraction,
        objectMetaCandidates: objectMetaCandidates,
        resolveButtonRep: resolveButtonRep,
        wantsVStretch: wantsVStretch,
        marksIncomplete: marksIncomplete,
        hasButtonIcon: hasButtonIcon,
        pictureRef: pictureRef,
        prop: prop,
        anchorBottomAlignedRuns: anchorBottomAlignedRuns,
        isMultilineField: isMultilineField,
        isUnlimitedString: isUnlimitedString,
        fieldHeight: fieldHeight,
        formObjectKind: formObjectKind,
        formStdCommandButtons: formStdCommandButtons,
        formCommandBar: formCommandBar,
        displayItems: displayItems,
        stdCommandKey: stdCommandKey,
        iconIdFor: iconIdFor,
        iconIdFromRef: iconIdFromRef,
        stdPictureUrl: stdPictureUrl,
        commonPictureResource: commonPictureResource,
        zipPictureDataUrl: zipPictureDataUrl,
        appendPictureIcon: appendPictureIcon,
        iconFor: iconFor,
        outlineHasChildren: outlineHasChildren,
        outlineHidden: outlineHidden,
        outlineExpandTo: outlineExpandTo,
        outlineCollapseAll: outlineCollapseAll
    }
};

})(window);
