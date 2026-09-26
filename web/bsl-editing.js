/* Configurator-style editing aids for the BSL language in Monaco:
 *  - Enter inside a string literal continues it on the next line with "|";
 *  - Enter after a block opener (Если … Тогда, Цикл, Процедура, Попытка …)
 *    inserts the matching closer below the cursor;
 *  - the cursor on a block word highlights the whole group
 *    (Если / ИначеЕсли / Иначе / КонецЕсли);
 *  - hover and parameter hints for platform globals and module methods;
 *  - references and rename for module identifiers.
 * Pure text helpers are exported on window.BslEditing for tests; install()
 * wires them into Monaco and attach() into a concrete editor. */
(function () {
'use strict';

var ID = 'a-zA-Z\\u0410-\\u044F_\\u0401\\u0451';
var ID_CHAR = '[' + ID + '0-9]';
var ID_RE = new RegExp('[' + ID + ']' + ID_CHAR + '*', 'g');

/* Removes comments and string contents (quotes are kept) from source lines.
 * Multi-line strings continue on lines starting with "|". Returns the
 * stripped lines and, per line, whether it ends inside a string. */
function stripCode(lines) {
    var out = [], openAtEnd = [], inString = false;
    for (var i = 0; i < lines.length; i++) {
        var s = lines[i], r = '';
        for (var j = 0; j < s.length; j++) {
            var c = s.charAt(j);
            if (inString) {
                if (c === '"') {
                    if (s.charAt(j + 1) === '"') { r += '  '; j++; continue; }
                    inString = false; r += '"';
                } else r += ' ';
            } else if (c === '"') {
                inString = true; r += '"';
            } else if (c === '/' && s.charAt(j + 1) === '/') {
                break;
            } else r += c;
        }
        out.push(r);
        openAtEnd.push(inString);
    }
    return { lines: out, openAtEnd: openAtEnd };
}

// ------------------------------------------------------------ block words

var BLOCKS = [
    { open: /^(Если|If)$/i, mid: /^(ИначеЕсли|ElsIf|Иначе|Else)$/i, close: /^(КонецЕсли|EndIf)$/i },
    { open: /^(Пока|While|Для|For)$/i, mid: null, close: /^(КонецЦикла|EndDo)$/i },
    { open: /^(Процедура|Procedure)$/i, mid: null, close: /^(КонецПроцедуры|EndProcedure)$/i },
    { open: /^(Функция|Function)$/i, mid: null, close: /^(КонецФункции|EndFunction)$/i },
    { open: /^(Попытка|Try)$/i, mid: /^(Исключение|Except)$/i, close: /^(КонецПопытки|EndTry)$/i }
];

function blockOf(word) {
    for (var i = 0; i < BLOCKS.length; i++) {
        var b = BLOCKS[i];
        if (b.open.test(word)) return { block: i, role: 'open' };
        if (b.mid && b.mid.test(word)) return { block: i, role: 'mid' };
        if (b.close.test(word)) return { block: i, role: 'close' };
    }
    return null;
}

/* Every block word of the stripped code, in order: {line, col, len, block, role}.
 * "Для" is only a loop opener; "Цикл" is not a block word by itself. */
function blockWords(stripped) {
    var res = [];
    for (var i = 0; i < stripped.length; i++) {
        var s = stripped[i], m;
        if (/^\s*[#&]/.test(s)) continue;
        ID_RE.lastIndex = 0;
        while ((m = ID_RE.exec(s))) {
            if (m.index > 0 && s.charAt(m.index - 1) === '.') continue;
            var b = blockOf(m[0]);
            if (b) res.push({ line: i + 1, col: m.index + 1, len: m[0].length, block: b.block, role: b.role });
        }
    }
    return res;
}

/* The group (opener, middles, closer) containing the block word at
 * line/col (1-based), or null. */
function blockGroupAt(lines, line, col) {
    var words = blockWords(stripCode(lines).lines);
    var stack = [], groups = [];
    for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (w.role === 'open') { var g = [w]; stack.push(g); groups.push(g); continue; }
        var top = stack[stack.length - 1];
        if (!top || top[0].block !== w.block) continue;
        top.push(w);
        if (w.role === 'close') stack.pop();
    }
    for (var k = 0; k < groups.length; k++) {
        for (var n = 0; n < groups[k].length; n++) {
            var x = groups[k][n];
            if (x.line === line && col >= x.col && col <= x.col + x.len) return groups[k];
        }
    }
    return null;
}

// ------------------------------------------------------------ auto close

var CLOSERS = [
    { re: /^\s*(Если|If)(?![^\s(]).*[\s)](Тогда|Then)\s*$/i, ru: 'КонецЕсли;', en: 'EndIf;' },
    { re: /^\s*(Пока|While|Для|For)\s.*\s(Цикл|Do)\s*$/i, ru: 'КонецЦикла;', en: 'EndDo;' },
    { re: /^\s*(?:(?:Асинх|Async)\s+)?(Процедура|Procedure)\s+[^(]+\(.*\)\s*(Экспорт|Export)?\s*$/i, ru: 'КонецПроцедуры', en: 'EndProcedure' },
    { re: /^\s*(?:(?:Асинх|Async)\s+)?(Функция|Function)\s+[^(]+\(.*\)\s*(Экспорт|Export)?\s*$/i, ru: 'КонецФункции', en: 'EndFunction' },
    { re: /^\s*(Попытка|Try)\s*$/i, ru: 'Исключение\n\tКонецПопытки;', en: 'Except\n\tEndTry;' }
];

function indentOf(s) { return /^\s*/.exec(s)[0]; }

/* Closer text for the opener line lines[index] (0-based) or '' when the
 * block is already closed: the next non-blank line at the opener's indent
 * (or shallower) must not be its closer. */
function closerFor(lines, index) {
    var stripped = stripCode(lines);
    if (index > 0 && stripped.openAtEnd[index - 1]) return '';
    var code = stripped.lines[index];
    if (stripped.openAtEnd[index]) return '';
    for (var i = 0; i < CLOSERS.length; i++) {
        var c = CLOSERS[i], m = c.re.exec(code);
        if (!m) continue;
        var english = /^[a-z]/i.test(m[1]);
        var text = english ? c.en : c.ru;
        var indent = indentOf(lines[index]);
        for (var j = index + 1; j < lines.length; j++) {
            var t = stripped.lines[j];
            if (!t.trim()) continue;
            if (indentOf(lines[j]).length > indent.length) continue;
            var first = (t.trim().match(ID_RE) || [''])[0];
            var b = blockOf(first);
            if (indentOf(lines[j]).length === indent.length && b && b.role !== 'open') return '';
            break;
        }
        return text.replace(/\n\t/g, '\n' + indent);
    }
    return '';
}

// ------------------------------------------------------------ methods and scopes

var METHOD_RE = new RegExp('^\\s*(?:(?:Асинх|Async)\\s+)?(Процедура|Procedure|Функция|Function)\\s+([' + ID + ']' + ID_CHAR + '*)\\s*\\(([^)]*)\\)?', 'i');
var END_RE = /^\s*(КонецПроцедуры|EndProcedure|КонецФункции|EndFunction)(?![a-zA-Z\u0410-\u044F_\u0401\u04510-9])/i;

/* Module methods: {name, line (1-based), end, params, doc}. doc is the
 * comment block right above the definition. */
function moduleMethods(lines) {
    var res = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
        var m = METHOD_RE.exec(lines[i]);
        if (m) {
            var doc = [];
            for (var j = i - 1; j >= 0 && /^\s*(\/\/|&)/.test(lines[j]); j--)
                if (/^\s*\/\//.test(lines[j])) doc.unshift(lines[j].replace(/^\s*\/\/\s?/, ''));
            cur = { name: m[2], line: i + 1, end: lines.length, params: (m[3] || '').trim(), doc: doc.join('\n'), func: /Функция|Function/i.test(m[1]) };
            res.push(cur);
        } else if (cur && END_RE.test(lines[i])) {
            cur.end = i + 1;
            cur = null;
        }
    }
    return res;
}

function sameName(a, b) { return a.toLowerCase() === b.toLowerCase(); }

/* Occurrences of an identifier outside strings and comments, not after a
 * dot (object members), limited to [fromLine, toLine]. */
function identifierRanges(lines, name, fromLine, toLine) {
    var stripped = stripCode(lines).lines, res = [];
    for (var i = (fromLine || 1) - 1; i < (toLine || lines.length); i++) {
        var s = stripped[i], m;
        ID_RE.lastIndex = 0;
        while ((m = ID_RE.exec(s))) {
            if (!sameName(m[0], name)) continue;
            if (m.index > 0 && s.charAt(m.index - 1) === '.') continue;
            res.push({ line: i + 1, col: m.index + 1, len: m[0].length });
        }
    }
    return res;
}

/* Scope for references/rename of `name` at `line`: the whole module for
 * module methods and variables used outside methods, else the enclosing method. */
function renameScope(lines, name, line) {
    var methods = moduleMethods(lines);
    for (var i = 0; i < methods.length; i++)
        if (sameName(methods[i].name, name)) return { from: 1, to: lines.length };
    var owner = null;
    for (var k = 0; k < methods.length; k++)
        if (line >= methods[k].line && line <= methods[k].end) owner = methods[k];
    if (!owner) return { from: 1, to: lines.length };
    var outside = identifierRanges(lines, name).some(function (r) {
        return !methods.some(function (mm) { return r.line >= mm.line && r.line <= mm.end; });
    });
    return outside ? { from: 1, to: lines.length } : { from: owner.line, to: owner.end };
}

// ------------------------------------------------------------ call context

/* For signature help: the called name and the active argument index at the
 * end of `before` (code before the cursor, possibly spanning lines). */
function callContext(before) {
    var s = stripCode(before.split('\n')).lines.join('\n');
    var depth = 0, arg = 0;
    for (var i = s.length - 1; i >= 0; i--) {
        var c = s.charAt(i);
        if (c === ')' || c === ']') depth++;
        else if (c === '[') { if (depth === 0) return null; depth--; }
        else if (c === '(') {
            if (depth === 0) {
                var m = new RegExp('(\\.)?([' + ID + ']' + ID_CHAR + '*)\\s*$').exec(s.slice(0, i));
                if (!m) return null;
                return { name: m[2], member: !!m[1], arg: arg };
            }
            depth--;
        } else if (c === ',' && depth === 0) arg++;
        else if (c === ';') return null;
    }
    return null;
}

/* Splits "(A: Число, Б: Строка): Тип" into parameter labels. */
function splitParams(sig) {
    var m = /^\(([^)]*)\)/.exec(sig || '');
    if (!m || !m[1].trim()) return [];
    return m[1].split(',').map(function (p) { return p.trim(); });
}

// ------------------------------------------------------------ Monaco

var globalsByName = null;
function platformEntry(name) {
    if (!globalsByName) {
        globalsByName = {};
        (window.BslCompletionData || []).forEach(function (e) {
            if (e.kind !== 'Function' && e.kind !== 'Method') return;
            (e.filterText || e.label).split(/\s+/).forEach(function (n) {
                if (n) globalsByName[n.toLowerCase()] = e;
            });
        });
    }
    return globalsByName[name.toLowerCase()] || null;
}

function methodInfo(lines, name) {
    var ms = moduleMethods(lines);
    for (var i = 0; i < ms.length; i++) if (sameName(ms[i].name, name)) return ms[i];
    return null;
}

/* onEnterRules for the language configuration: Enter inside a string literal
 * continues it with "|". Closed strings and "" escapes are skipped; a "//"
 * outside strings ends the code part. */
function enterRules(monaco) {
    var none = monaco.languages.IndentAction.None;
    return [
        { beforeText: /^(?!\s*\|)(?:[^"\/]|\/(?!\/)|"(?:[^"]|"")*")*"(?:[^"]|"")*$/, action: { indentAction: none, appendText: '|' } },
        { beforeText: /^\s*\|(?:[^"]|"")*$/, action: { indentAction: none, appendText: '|' } }
    ];
}

function install(monaco, lang) {
    lang = lang || 'bsl';

    monaco.languages.registerDocumentHighlightProvider(lang, {
        provideDocumentHighlights: function (m, pos) {
            var g = blockGroupAt(m.getLinesContent(), pos.lineNumber, pos.column);
            if (!g || g.length < 2) return [];
            return g.map(function (w) {
                return { range: new monaco.Range(w.line, w.col, w.line, w.col + w.len), kind: monaco.languages.DocumentHighlightKind.Text };
            });
        }
    });

    monaco.languages.registerHoverProvider(lang, {
        provideHover: function (m, pos) {
            var w = m.getWordAtPosition(pos);
            if (!w) return null;
            var line = m.getLineContent(pos.lineNumber);
            var code = stripCode(m.getLinesContent().slice(0, pos.lineNumber)).lines[pos.lineNumber - 1];
            if (code.length < w.startColumn || (code.charAt(w.startColumn - 1) === ' ' && line.charAt(w.startColumn - 1) !== ' ')) return null;
            var range = new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn);
            var local = methodInfo(m.getLinesContent(), w.word);
            if (local) {
                var head = (local.func ? 'Функция ' : 'Процедура ') + local.name + '(' + local.params + ')';
                return { range: range, contents: [{ value: '```bsl\n' + head + '\n```' }].concat(local.doc ? [{ value: local.doc }] : []) };
            }
            if (line.charAt(w.startColumn - 2) === '.') return null;
            var e = platformEntry(w.word);
            if (!e) return null;
            return { range: range, contents: [{ value: '**' + e.label + '** — ' + (e.detail || '') }, { value: e.documentation || '' }] };
        }
    });

    monaco.languages.registerSignatureHelpProvider(lang, {
        signatureHelpTriggerCharacters: ['(', ','],
        signatureHelpRetriggerCharacters: [')'],
        provideSignatureHelp: function (m, pos) {
            var from = Math.max(1, pos.lineNumber - 30);
            var before = m.getValueInRange(new monaco.Range(from, 1, pos.lineNumber, pos.column));
            var ctx = callContext(before);
            if (!ctx) return null;
            var label, params, doc = '';
            var local = !ctx.member && methodInfo(m.getLinesContent(), ctx.name);
            if (local) {
                params = local.params ? local.params.split(',').map(function (p) { return p.trim(); }) : [];
                label = local.name + '(' + params.join(', ') + ')';
                doc = local.doc;
            } else {
                var e = !ctx.member && platformEntry(ctx.name);
                if (!e) return null;
                var sig = (e.documentation || '').split('\n')[0];
                params = splitParams(sig);
                label = e.label + sig;
                doc = (e.documentation || '').split('\n').slice(2).join('\n');
            }
            return {
                value: {
                    signatures: [{ label: label, documentation: doc, parameters: params.map(function (p) { return { label: p }; }) }],
                    activeSignature: 0,
                    activeParameter: Math.min(ctx.arg, Math.max(0, params.length - 1))
                },
                dispose: function () {}
            };
        }
    });

    function rangesFor(m, pos) {
        var w = m.getWordAtPosition(pos);
        if (!w) return null;
        var lines = m.getLinesContent();
        var hits = identifierRanges(lines, w.word, pos.lineNumber, pos.lineNumber)
            .filter(function (r) { return pos.column >= r.col && pos.column <= r.col + r.len; });
        if (!hits.length || blockOf(w.word)) return null;
        var scope = renameScope(lines, w.word, pos.lineNumber);
        return { word: w.word, ranges: identifierRanges(lines, w.word, scope.from, scope.to) };
    }

    monaco.languages.registerReferenceProvider(lang, {
        provideReferences: function (m, pos) {
            var r = rangesFor(m, pos);
            if (!r) return [];
            return r.ranges.map(function (x) {
                return { uri: m.uri, range: new monaco.Range(x.line, x.col, x.line, x.col + x.len) };
            });
        }
    });

    monaco.languages.registerRenameProvider(lang, {
        resolveRenameLocation: function (m, pos) {
            var r = rangesFor(m, pos);
            if (!r) return { range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: '', rejectReason: 'Здесь нечего переименовать' };
            var w = m.getWordAtPosition(pos);
            return { range: new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn), text: w.word };
        },
        provideRenameEdits: function (m, pos, newName) {
            if (!new RegExp('^[' + ID + ']' + ID_CHAR + '*$').test(newName))
                return { edits: [], rejectReason: 'Недопустимое имя' };
            var r = rangesFor(m, pos);
            if (!r) return { edits: [] };
            var version = m.getVersionId();
            return {
                edits: r.ranges.map(function (x) {
                    return { resource: m.uri, versionId: version, textEdit: { range: new monaco.Range(x.line, x.col, x.line, x.col + x.len), text: newName } };
                })
            };
        }
    });
}

/* Auto-close: after a single Enter typed at the end of an opener line,
 * insert the closer below the new cursor line. Undo removes both steps. */
function attach(monaco, editor, isBsl) {
    var busy = false;
    editor.onDidChangeModelContent(function (e) {
        if (busy || e.isUndoing || e.isRedoing || e.changes.length !== 1) return;
        var m = editor.getModel();
        if (!m || (isBsl && !isBsl())) return;
        var ch = e.changes[0];
        if (ch.rangeLength !== 0 || !/^\r?\n[ \t]*$/.test(ch.text)) return;
        var lineNo = ch.range.startLineNumber;
        var lines = m.getLinesContent();
        if (ch.range.startColumn !== lines[lineNo - 1].length + 1) return;
        var closer = closerFor(lines, lineNo - 1);
        if (!closer) return;
        var next = lineNo + 1;
        var eol = m.getEOL();
        busy = true;
        try {
            editor.executeEdits('bsl-autoclose', [{
                range: new monaco.Range(next, m.getLineMaxColumn(next), next, m.getLineMaxColumn(next)),
                text: eol + indentOf(lines[lineNo - 1]) + closer.replace(/\n/g, eol)
            }], [new monaco.Selection(next, m.getLineMaxColumn(next), next, m.getLineMaxColumn(next))]);
        } finally {
            busy = false;
        }
    });

    editor.addAction({
        id: 'bsl.addComment',
        label: 'Закомментировать строки',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
        precondition: '!editorReadonly',
        run: function (ed) { ed.trigger('bsl', 'editor.action.addCommentLine'); }
    });
    editor.addAction({
        id: 'bsl.removeComment',
        label: 'Раскомментировать строки',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Slash],
        precondition: '!editorReadonly',
        run: function (ed) { ed.trigger('bsl', 'editor.action.removeCommentLine'); }
    });
}

window.BslEditing = {
    stripCode: stripCode,
    blockGroupAt: blockGroupAt,
    closerFor: closerFor,
    moduleMethods: moduleMethods,
    identifierRanges: identifierRanges,
    renameScope: renameScope,
    callContext: callContext,
    splitParams: splitParams,
    enterRules: enterRules,
    install: install,
    attach: attach
};
})();
