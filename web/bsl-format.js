/* BSL formatter in the style of the 1C Configurator.
 *
 * Ported from bsl-analyzer (crates/ide/src/formatting/configurator.rs,
 * alonehobo/bsl-analyzer@feat/configurator-style-formatter). The defining
 * property: after this formatter the Configurator's own formatting changes
 * nothing, and a second run changes nothing either. Therefore a line's indent
 * is only its block nesting level, counted over the token stream the way the
 * Configurator counts it — no extra shift for statement continuations, call
 * arguments or the lines of a multi-line literal. Counting over tokens (not
 * over a tree) also keeps the deleted code of #Удаление in the block structure.
 *
 * Methods annotated &ИзменениеИКонтроль are copied byte for byte: the platform
 * compares their text with the method of the base configuration, so any change
 * breaks the extension.
 */
(function (global) {
'use strict';

const MAX_BLANK_LINES = 1;

/* Canonical spellings; check() keeps the language the word is written in. */
const KEYWORDS = {
    procedure: ['Процедура', 'Procedure'],
    endprocedure: ['КонецПроцедуры', 'EndProcedure'],
    function: ['Функция', 'Function'],
    endfunction: ['КонецФункции', 'EndFunction'],
    export: ['Экспорт', 'Export'],
    val: ['Знач', 'Val'],
    if: ['Если', 'If'],
    then: ['Тогда', 'Then'],
    elsif: ['ИначеЕсли', 'ElsIf'],
    else: ['Иначе', 'Else'],
    endif: ['КонецЕсли', 'EndIf'],
    for: ['Для', 'For'],
    each: ['Каждого', 'каждого', 'Each', 'each'],
    in: ['Из', 'In'],
    to: ['По', 'To'],
    while: ['Пока', 'While'],
    do: ['Цикл', 'Do'],
    enddo: ['КонецЦикла', 'EndDo'],
    return: ['Возврат', 'Return'],
    continue: ['Продолжить', 'Continue'],
    break: ['Прервать', 'Break'],
    goto: ['Перейти', 'Goto'],
    try: ['Попытка', 'Try'],
    except: ['Исключение', 'Except'],
    endtry: ['КонецПопытки', 'EndTry'],
    raise: ['ВызватьИсключение', 'Raise'],
    var: ['Перем', 'Var'],
    new: ['Новый', 'New'],
    execute: ['Выполнить', 'Execute'],
    addhandler: ['ДобавитьОбработчик', 'AddHandler'],
    removehandler: ['УдалитьОбработчик', 'RemoveHandler'],
    async: ['Асинх', 'Async'],
    await: ['Ждать', 'Await'],
    and: ['И', 'And', 'AND'],
    or: ['Или', 'ИЛИ', 'Or', 'OR'],
    not: ['Не', 'НЕ', 'Not', 'NOT'],
    true: ['Истина', 'True'],
    false: ['Ложь', 'False'],
    undefined: ['Неопределено', 'Undefined'],
    null: ['NULL', 'Null']
};

const KEYWORD_BY_WORD = {};
Object.keys(KEYWORDS).forEach(id => {
    KEYWORDS[id].forEach(form => { KEYWORD_BY_WORD[form.toLowerCase()] = id; });
});

/* Directives keep the rest of their line verbatim; only the leading word has a
 * canonical spelling. */
const DIRECTIVES = [
    ['#Если', '#If'], ['#ИначеЕсли', '#ElsIf'], ['#Иначе', '#Else'], ['#КонецЕсли', '#EndIf'],
    ['#Область', '#Region'], ['#КонецОбласти', '#EndRegion'],
    ['#Вставка', '#Insert'], ['#КонецВставки', '#EndInsert'],
    ['#Удаление', '#Delete'], ['#КонецУдаления', '#EndDelete'],
    ['#Использовать', '#Use']
];

const DIRECTIVE_BY_WORD = {};
DIRECTIVES.forEach(forms => {
    forms.forEach(form => { DIRECTIVE_BY_WORD[form.toLowerCase()] = forms; });
});

const ANNOTATIONS = [
    ['&НаКлиенте', '&AtClient'],
    ['&НаСервере', '&AtServer'],
    ['&НаСервереБезКонтекста', '&AtServerNoContext'],
    ['&НаКлиентеНаСервере', '&AtClientAtServer'],
    ['&НаКлиентеНаСервереБезКонтекста', '&AtClientAtServerNoContext'],
    ['&Перед', '&Before'], ['&После', '&After'], ['&Вместо', '&Around'],
    ['&ИзменениеИКонтроль', '&ChangeAndValidate']
];

const ANNOTATION_BY_WORD = {};
ANNOTATIONS.forEach(forms => {
    forms.forEach(form => { ANNOTATION_BY_WORD[form.toLowerCase()] = forms; });
});

const PROTECTED_ANNOTATIONS = ['&изменениеиконтроль', '&changeandvalidate'];
const DELETE_OPEN = ['#удаление', '#delete'];
const DELETE_CLOSE = ['#конецудаления', '#enddelete'];

const OPENS_BLOCK = ['procedure', 'function', 'if', 'elsif', 'else', 'for', 'while', 'try', 'except'];
const CLOSES_BLOCK = ['endprocedure', 'endfunction', 'endif', 'enddo', 'endtry', 'elsif', 'else', 'except'];

/* A method header may start with a comment, an annotation, Асинх or
 * Процедура/Функция — these get the blank line that separates methods. */
const METHOD_HEADER_KEYWORDS = ['procedure', 'function', 'async'];

const BINARY_OPS = ['+', '-', '*', '/', '%', '<', '<=', '>', '>=', '<>'];
const UNARY_AFTER_OPS = ['(', '[', ',', '=', '+', '-', '*', '/', '<', '<=', '>', '>=', '<>'];
const UNARY_AFTER_KEYWORDS = ['return', 'and', 'or', 'not'];
const SPACE_AFTER_KEYWORDS = ['if', 'elsif', 'while', 'for', 'return', 'var', 'new', 'not', 'in', 'to', 'each', 'and', 'or'];
const NO_SPACE_BEFORE_OPS = [',', ';', ')', ']', '.', '['];
const NO_SPACE_AFTER_OPS = ['(', '[', '.', '~'];
const NO_SPACE_BEFORE_PAREN_OPS = [')', ']'];

const WORD_START = /[A-Za-zА-Яа-яЁё_]/;
const WORD_PART = /[A-Za-zА-Яа-яЁё_0-9]/;

// --- tokens ----------------------------------------------------------------

/* Atoms are everything but whitespace; gaps are the whitespace between them,
 * one more gap than atoms (before the first and after the last atom). */
function tokenize(text) {
    const atoms = [];
    const gaps = [];
    let index = 0;
    let gapStart = 0;

    if (text.charCodeAt(0) === 0xFEFF) {
        gaps.push({ text: '' });
        atoms.push({ kind: 'bom', text: text[0] });
        index = 1;
        gapStart = 1;
    }

    while (index < text.length) {
        if (/[ \t\r\n]/.test(text[index])) {
            index++;
            continue;
        }

        gaps.push({ text: text.substring(gapStart, index) });
        const atom = readAtom(text, index);
        atoms.push(atom);
        index = atom.end;
        gapStart = index;
    }

    gaps.push({ text: text.substring(gapStart) });
    return { atoms: atoms, gaps: gaps };
}

function readAtom(text, start) {
    const character = text[start];

    if (character == '/' && text[start + 1] == '/')
        return finish('comment', text, start, lineEnd(text, start));

    if (character == '"')
        return finish('string', text, start, stringEnd(text, start));

    if (character == '\'')
        return finish('date', text, start, quotedEnd(text, start));

    if (character == '#') {
        const end = trimmedEnd(text, start, Math.min(lineEnd(text, start), commentStart(text, start)));
        return finish('preproc', text, start, end);
    }

    if (character == '&') {
        let end = start + 1;
        while (end < text.length && WORD_PART.test(text[end]))
            end++;
        return finish('annotation', text, start, end);
    }

    if (/[0-9]/.test(character)) {
        let end = start;
        while (end < text.length && /[0-9.]/.test(text[end]))
            end++;
        return finish('number', text, start, end);
    }

    if (WORD_START.test(character)) {
        let end = start;
        while (end < text.length && WORD_PART.test(text[end]))
            end++;
        const atom = finish('ident', text, start, end);
        const id = KEYWORD_BY_WORD[atom.text.toLowerCase()];
        if (id) {
            atom.kind = 'kw';
            atom.id = id;
        }
        return atom;
    }

    const pair = text.substr(start, 2);
    const end = (pair == '<=' || pair == '>=' || pair == '<>') ? start + 2 : start + 1;
    const atom = finish('op', text, start, end);
    atom.op = atom.text;
    return atom;
}

function finish(kind, text, start, end) {
    return { kind: kind, text: text.substring(start, end), start: start, end: end };
}

function lineEnd(text, start) {
    const index = text.indexOf('\n', start);
    if (index < 0)
        return text.length;
    return text[index - 1] == '\r' ? index - 1 : index;
}

function commentStart(text, start) {
    const index = text.indexOf('//', start);
    return index < 0 ? text.length : index;
}

function trimmedEnd(text, start, end) {
    while (start < end && /[ \t]/.test(text[end - 1]))
        end--;
    return end;
}

/* A string literal may span lines: every continuation line starts with `|`, and
 * a comment line is allowed between them. */
function stringEnd(text, start) {
    let index = start + 1;
    while (index < text.length) {
        const character = text[index];
        if (character == '"') {
            if (text[index + 1] == '"') {
                index += 2;
                continue;
            }
            return index + 1;
        }
        if (character == '\n') {
            index++;
            while (index < text.length && /[ \t\r]/.test(text[index]))
                index++;
            if (text[index] == '/' && text[index + 1] == '/')
                index = lineEnd(text, index);
            continue;
        }
        index++;
    }
    return text.length;
}

function quotedEnd(text, start) {
    const index = text.indexOf('\'', start + 1);
    if (index < 0)
        return lineEnd(text, start);
    return Math.min(index + 1, lineEnd(text, start));
}

// --- canonical spelling ----------------------------------------------------

function isCyrillic(text) {
    return /[Ѐ-ӿ]/.test(text);
}

function canonicalForm(written, forms) {
    if (forms.indexOf(written) >= 0)
        return written;
    const cyrillic = isCyrillic(written);
    for (let index = 0; index < forms.length; index++) {
        if (isCyrillic(forms[index]) == cyrillic)
            return forms[index];
    }
    return forms[0];
}

function buildNameMap(names) {
    const map = {};
    (names || []).forEach(name => {
        const key = String(name).toLowerCase();
        if (!(key in map))
            map[key] = String(name);
    });
    return map;
}

function buildPlatformNames(source) {
    source = source || {};
    return {
        types: buildNameMap(source.types),
        methods: buildNameMap(source.methods),
        globalFunctions: buildNameMap(source.globalFunctions)
    };
}

let defaultPlatformNames = null;

function resolvePlatformNames(options) {
    if (options.platformNames)
        return options.platformNames;
    if (!defaultPlatformNames)
        defaultPlatformNames = buildPlatformNames(global.BslPlatformNames);
    return defaultPlatformNames;
}

// --- layout ----------------------------------------------------------------

function Layout(text, options) {
    const tokens = tokenize(text);
    this.atoms = tokens.atoms;
    this.gaps = tokens.gaps;
    this.options = options;
    this.platformNames = options.canonicalNames ? resolvePlatformNames(options) : null;

    const count = this.atoms.length;
    this.afterDot = new Array(count);
    this.lineLevel = new Array(count);
    this.levelAfter = new Array(count);
    this.inDelete = new Array(count);
    this.protectedAtom = new Array(count);
    this.protectedRanges = [];

    for (let index = 0; index < count; index++) {
        this.afterDot[index] = index > 0 && this.atoms[index - 1].op == '.';
        this.protectedAtom[index] = false;
    }

    this.markDeleted();
    this.markAnnotationParts();
    this.findProtectedMethods();
    this.computeLevels(options.initialLevel || 0);
}

Layout.prototype.keywordId = function (index) {
    const atom = this.atoms[index];
    return atom.kind == 'kw' && !this.afterDot[index] ? atom.id : null;
};

Layout.prototype.isMethodEnd = function (index) {
    const id = this.keywordId(index);
    return id == 'endprocedure' || id == 'endfunction';
};

Layout.prototype.markDeleted = function () {
    let depth = 0;
    for (let index = 0; index < this.atoms.length; index++) {
        const atom = this.atoms[index];
        const word = atom.kind == 'preproc' ? directiveWord(atom.text).toLowerCase() : '';
        if (DELETE_OPEN.indexOf(word) >= 0)
            depth++;
        this.inDelete[index] = depth > 0;
        if (DELETE_CLOSE.indexOf(word) >= 0)
            depth = Math.max(0, depth - 1);
    }
};

/* An annotation owns its parenthesised argument list, so a method protected by
 * &ИзменениеИКонтроль starts at the first atom of its first annotation. */
Layout.prototype.markAnnotationParts = function () {
    const count = this.atoms.length;
    this.annotationPart = new Array(count).fill(false);

    for (let index = 0; index < count; index++) {
        if (this.atoms[index].kind != 'annotation')
            continue;
        this.annotationPart[index] = true;
        if (index + 1 >= count || this.atoms[index + 1].op != '(')
            continue;

        let depth = 0;
        for (let scan = index + 1; scan < count; scan++) {
            this.annotationPart[scan] = true;
            if (this.atoms[scan].op == '(')
                depth++;
            else if (this.atoms[scan].op == ')') {
                depth--;
                if (depth == 0)
                    break;
            }
        }
    }
};

Layout.prototype.findProtectedMethods = function () {
    const count = this.atoms.length;
    let index = 0;

    while (index < count) {
        const atom = this.atoms[index];
        if (atom.kind != 'annotation' || PROTECTED_ANNOTATIONS.indexOf(atom.text.toLowerCase()) < 0) {
            index++;
            continue;
        }

        let first = index;
        while (first > 0 && this.annotationPart[first - 1])
            first--;

        let last = count - 1;
        for (let scan = index; scan < count; scan++) {
            if (this.isMethodEnd(scan)) {
                last = scan;
                break;
            }
        }
        // The tail of the method's last line (a comment) is untouchable too.
        while (last + 1 < count && this.gaps[last + 1].text.indexOf('\n') < 0)
            last++;

        this.protectedRanges.push({ first: first, last: last });
        for (let mark = first; mark <= last; mark++)
            this.protectedAtom[mark] = true;
        index = last + 1;
    }
};

Layout.prototype.gapIsProtected = function (gap) {
    return this.protectedRanges.some(range => range.first < gap && gap <= range.last);
};

Layout.prototype.computeLevels = function (initialLevel) {
    let level = Math.max(0, initialLevel);
    let saved = null;

    for (let index = 0; index < this.atoms.length; index++) {
        if (this.protectedRanges.some(range => range.first == index))
            saved = level;

        const id = this.keywordId(index);
        if (id && CLOSES_BLOCK.indexOf(id) >= 0)
            level = Math.max(0, level - 1);
        this.lineLevel[index] = level;
        if (id && OPENS_BLOCK.indexOf(id) >= 0)
            level++;

        if (this.protectedRanges.some(range => range.last == index)) {
            // Unbalanced code inside a protected method must not shift the rest.
            if (saved !== null) {
                level = saved;
                saved = null;
            }
        }
        this.levelAfter[index] = level;
    }
};

Layout.prototype.levelBefore = function (index) {
    return index == 0 ? (this.options.initialLevel || 0) : this.levelAfter[index - 1];
};

Layout.prototype.indent = function (level) {
    const options = this.options;
    return options.useTabs === false
        ? ' '.repeat(Math.max(0, level) * (options.indentSize || 4))
        : '\t'.repeat(Math.max(0, level));
};

// --- rendering -------------------------------------------------------------

Layout.prototype.newlineGap = function (index, forceBlank) {
    const text = this.gaps[index].text;
    const count = this.atoms.length;
    const eol = this.options.eol;
    const newlines = (text.match(/\n/g) || []).length;
    let out = '';

    // The tail of a protected or deleted line stays as it was written.
    if (index > 0 && (this.protectedAtom[index - 1] || this.inDelete[index - 1])) {
        const stop = text.indexOf('\n');
        out += (stop < 0 ? text : text.substring(0, stop)).replace(/\r$/, '');
    }

    if (index == count) {
        // Last gap: no trailing blank lines at the end of a module.
        return out + eol;
    }

    const blankIndent = this.options.trimTrailingWhitespace ? '' : this.indent(this.levelBefore(index));
    let blanks = Math.min(index == 0 ? newlines : newlines - 1, MAX_BLANK_LINES);
    if (forceBlank)
        blanks = MAX_BLANK_LINES;

    if (index == 0) {
        // An empty first line of the module is kept, and has no indent.
        return out + eol.repeat(blanks);
    }
    if (index == 1 && this.atoms[0].kind == 'bom') {
        // The BOM line is itself the empty first line; another one would be a second.
        blanks = 0;
    }
    for (let blank = 0; blank < blanks; blank++)
        out += eol + blankIndent;

    return out + eol + this.indent(this.lineLevel[index]);
};

Layout.prototype.inlineGap = function (index, prevWasUnary) {
    const text = this.gaps[index].text;
    const count = this.atoms.length;

    if (index == 0) {
        /* A fragment formatted on its own starts at a known block level, and its
         * first line carries the indent the whole range is missing. */
        return this.options.indentFirstLine && this.atoms[0].kind != 'bom'
            ? this.indent(this.lineLevel[0])
            : '';
    }
    if (index == count)
        return this.protectedAtom[count - 1] ? text : '';
    if (this.inDelete[index - 1] && this.inDelete[index])
        return text;

    const prev = this.atoms[index - 1];
    const next = this.atoms[index];
    if (next.op == '(' && prev.kind == 'annotation')
        return '';
    if (next.op == ':')
        return '';

    return decideInlineGap(prev, next, prevWasUnary, text);
};

function decideInlineGap(prev, next, prevWasUnary, text) {
    if (prevWasUnary)
        return '';
    if (prev.kind == 'bom')
        return '';
    if (next.kind == 'comment')
        return ' ';

    /* The Configurator only requires whitespace before assignment. Keep the
     * user's existing horizontal gap instead of collapsing deliberate extra
     * spacing to one character. */
    if (next.op == '=')
        return /[ \t]/.test(text) ? text : ' ';

    const commaAfterComma = prev.op == ',' && next.op == ',';
    if (!commaAfterComma && next.op && NO_SPACE_BEFORE_OPS.indexOf(next.op) >= 0)
        return '';
    if (next.op == '(' && forbidsSpaceBeforeParen(prev))
        return '';
    if (prev.op && NO_SPACE_AFTER_OPS.indexOf(prev.op) >= 0)
        return '';

    if (isLikelyUnary(next, prev))
        return needsSpaceAfter(prev) ? ' ' : '';

    if (needsSpaceBefore(next) || needsSpaceAfter(prev))
        return ' ';

    return text;
}

function forbidsSpaceBeforeParen(prev) {
    if (prev.kind == 'ident')
        return true;
    if (prev.kind == 'kw')
        return prev.id == 'new' || prev.id == 'execute';
    return prev.op && NO_SPACE_BEFORE_PAREN_OPS.indexOf(prev.op) >= 0;
}

function needsSpaceBefore(atom) {
    if (atom.kind == 'kw')
        return atom.id == 'and' || atom.id == 'or';
    return Boolean(atom.op) && (atom.op == '=' || BINARY_OPS.indexOf(atom.op) >= 0);
}

function needsSpaceAfter(atom) {
    if (atom.kind == 'kw')
        return SPACE_AFTER_KEYWORDS.indexOf(atom.id) >= 0;
    if (!atom.op)
        return false;
    return atom.op == ',' || atom.op == '=' || BINARY_OPS.indexOf(atom.op) >= 0;
}

function isLikelyUnary(atom, prev) {
    if (!atom.op || (atom.op != '-' && atom.op != '+'))
        return false;
    if (!prev)
        return true;
    if (prev.kind == 'kw')
        return UNARY_AFTER_KEYWORDS.indexOf(prev.id) >= 0;
    return Boolean(prev.op) && UNARY_AFTER_OPS.indexOf(prev.op) >= 0;
}

function normalizeCommentSpacing(raw) {
    if (raw.substring(0, 2) != '//')
        return raw;
    const rest = raw.substring(2);
    if (!rest || /^\s/.test(rest))
        return raw;
    return '// ' + rest;
}

function directiveWord(text) {
    let end = 1;
    while (end < text.length && WORD_PART.test(text[end]))
        end++;
    return text.substring(0, end);
}

Layout.prototype.renderAtom = function (index) {
    const atom = this.atoms[index];
    if (this.protectedAtom[index] || this.inDelete[index])
        return atom.text;

    if (atom.kind == 'comment')
        return normalizeCommentSpacing(atom.text.replace(/[ \t]+$/, ''));

    if (atom.kind == 'string' && atom.text.indexOf('\n') >= 0)
        return this.reindentLiteral(atom.text, this.lineLevel[index]);

    if (!this.options.canonicalNames)
        return atom.text;

    return this.canonicalName(index) || atom.text;
};

/* The lines of a multi-line literal (`|…`, and comments between them) get the
 * block's indent; their text, trailing spaces included, is part of the value. */
Layout.prototype.reindentLiteral = function (text, level) {
    const indent = this.indent(level);
    const lines = text.split('\n');
    let out = lines[0];

    for (let index = 1; index < lines.length; index++) {
        const content = lines[index].replace(/^[ \t]+/, '');
        out += '\n';
        if (content.replace(/\r$/, '') === '') {
            if (!this.options.trimTrailingWhitespace)
                out += indent;
        }
        else {
            out += indent;
        }
        out += content;
    }

    return out;
};

Layout.prototype.nextMeaningful = function (index) {
    for (let scan = index + 1; scan < this.atoms.length; scan++) {
        if (this.atoms[scan].kind != 'comment')
            return this.atoms[scan];
    }
    return null;
};

Layout.prototype.canonicalName = function (index) {
    const atom = this.atoms[index];
    const text = atom.text;
    const prev = index > 0 ? this.atoms[index - 1] : null;
    const next = this.nextMeaningful(index);
    const names = this.platformNames;
    let canonical = null;

    if (prev && prev.op == '.') {
        // A keyword after a dot is a property or method name (Обработчик.Процедура).
        if (names && next && next.op == '(')
            canonical = names.methods[text.toLowerCase()];
    }
    else if (atom.kind == 'ident') {
        if (!names)
            canonical = null;
        else if (prev && prev.kind == 'kw' && prev.id == 'new')
            canonical = names.types[text.toLowerCase()];
        else if (prev && prev.kind == 'kw' && (prev.id == 'procedure' || prev.id == 'function'))
            canonical = null;
        else if (next && next.op == '(')
            canonical = names.globalFunctions[text.toLowerCase()];
    }
    else if (atom.kind == 'kw') {
        canonical = canonicalForm(text, KEYWORDS[atom.id]);
    }
    else if (atom.kind == 'annotation') {
        const forms = ANNOTATION_BY_WORD[text.toLowerCase()];
        canonical = forms ? canonicalForm(text, forms) : null;
    }
    else if (atom.kind == 'preproc') {
        const word = directiveWord(text);
        const forms = DIRECTIVE_BY_WORD[word.toLowerCase()];
        canonical = forms ? canonicalForm(word, forms) + text.substring(word.length) : null;
    }

    return canonical && canonical != text ? canonical : null;
};

function isMethodHeaderStart(atom) {
    if (atom.kind == 'annotation' || atom.kind == 'comment')
        return true;
    return atom.kind == 'kw' && METHOD_HEADER_KEYWORDS.indexOf(atom.id) >= 0;
}

Layout.prototype.render = function () {
    const count = this.atoms.length;
    if (!count)
        return null;

    let out = '';
    let prevWasUnary = false;
    let methodJustEnded = false;

    for (let index = 0; index <= count; index++) {
        const gap = this.gaps[index];
        let rendered;

        if (this.gapIsProtected(index)) {
            rendered = gap.text;
        }
        else if (gap.text.indexOf('\n') >= 0) {
            const forceBlank = methodJustEnded && index < count && isMethodHeaderStart(this.atoms[index]);
            methodJustEnded = false;
            rendered = this.newlineGap(index, forceBlank);
        }
        else {
            rendered = this.inlineGap(index, prevWasUnary);
        }

        if (index == count) {
            if (this.options.insertFinalNewline !== false && !/\n$/.test(rendered))
                rendered += this.options.eol;
            out += rendered;
            break;
        }

        out += rendered + this.renderAtom(index);

        if (this.isMethodEnd(index))
            methodJustEnded = true;
        const crossedLine = gap.text.indexOf('\n') >= 0;
        const prev = (index == 0 || crossedLine) ? null : this.atoms[index - 1];
        prevWasUnary = isLikelyUnary(this.atoms[index], prev);
    }

    return out;
};

// --- line state (incremental helpers used by the editor) -------------------

function createState(source) {
    source = source || {};
    return {
        inString: Boolean(source.inString),
        parenthesisDepth: source.parenthesisDepth || 0,
        bracketDepth: source.bracketDepth || 0
    };
}

function scanLine(line, initialState) {
    const state = createState(initialState);

    for (let index = 0; index < line.length; index++) {
        const character = line[index];

        if (state.inString) {
            if (character == '"') {
                if (line[index + 1] == '"')
                    index++;
                else
                    state.inString = false;
            }
            continue;
        }

        if (character == '/' && line[index + 1] == '/')
            break;

        if (character == '"')
            state.inString = true;
        else if (character == '(')
            state.parenthesisDepth++;
        else if (character == ')')
            state.parenthesisDepth = Math.max(0, state.parenthesisDepth - 1);
        else if (character == '[')
            state.bracketDepth++;
        else if (character == ']')
            state.bracketDepth = Math.max(0, state.bracketDepth - 1);
    }

    return state;
}

function resolveOptions(text, options) {
    options = options || {};
    const eolMatch = text.match(/\r\n|\n/);
    return {
        eol: options.eol || (eolMatch ? eolMatch[0] : '\n'),
        useTabs: options.useTabs !== false,
        indentSize: options.indentSize || 4,
        trimTrailingWhitespace: Boolean(options.trimTrailingWhitespace),
        canonicalNames: options.canonicalNames !== false,
        insertFinalNewline: options.insertFinalNewline !== false,
        initialLevel: Math.max(0, options.initialLevel || 0),
        indentFirstLine: Boolean(options.indentFirstLine),
        platformNames: options.platformNames || null
    };
}

class BslFormatter {

    /** Lower-cased lookup maps from {types, methods, globalFunctions} name lists. */
    static buildPlatformNames(source) {
        return buildPlatformNames(source);
    }

    static getState(text, initialState) {
        const lines = String(text || '').split(/\r?\n/);
        let state = createState(initialState);
        lines.forEach(line => { state = scanLine(line, state); });
        return state;
    }

    /** Block nesting level after `text` — the indent of the line that follows it. */
    static getIndentLevel(text, initialLevel) {
        const layout = new Layout(String(text || ''), resolveOptions('', { initialLevel: initialLevel }));
        const count = layout.atoms.length;
        return count ? layout.levelAfter[count - 1] : Math.max(0, initialLevel || 0);
    }

    static format(text, range, options) {
        text = String(text || '');
        const resolved = resolveOptions(text, options);
        const layout = new Layout(text, resolved);
        const formatted = layout.render();
        return [{ text: formatted === null ? text : formatted, range: range }];
    }
}

global.BslFormatter = BslFormatter;
})(window);
