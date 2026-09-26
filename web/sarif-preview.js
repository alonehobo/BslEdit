/* SARIF 2.1.0 diagnostics provider for the native Monaco host. */
(function (root) {
'use strict';

var RENDER_INCREMENT = 600;
var grouping = 'object';
var expandDepth = 1;
var selectedId = '';
var renderLimit = RENDER_INCREMENT;
var lastRender = null;
var expandedGroups = new Set();
var collapsedGroups = new Set();

var BSL_METADATA_TYPE_DIRS = new Set([
    'CommonModules','ОбщиеМодули','Catalogs','Справочники','Documents','Документы',
    'DataProcessors','Обработки','Reports','Отчеты','Enums','Перечисления',
    'InformationRegisters','РегистрыСведений','AccumulationRegisters','РегистрыНакопления',
    'AccountingRegisters','РегистрыБухгалтерии','CalculationRegisters','РегистрыРасчета',
    'ChartsOfAccounts','ПланыСчетов','ChartsOfCharacteristicTypes','ПланыВидовХарактеристик',
    'ChartsOfCalculationTypes','ПланыВидовРасчета','BusinessProcesses','БизнесПроцессы',
    'Tasks','Задачи','ExchangePlans','ПланыОбмена','Constants','Константы',
    'CommonForms','ОбщиеФормы','CommonCommands','ОбщиеКоманды','Subsystems','Подсистемы',
    'Roles','Роли','HTTPServices','HTTPСервисы','WebServices','WebСервисы'
]);
var BSL_MODULE_FILE_LABELS = {
    'module.bsl':'Модуль','objectmodule.bsl':'Модуль объекта',
    'managermodule.bsl':'Модуль менеджера','valuemanagermodule.bsl':'Модуль менеджера значения',
    'recordsetmodule.bsl':'Модуль набора записей','commandmodule.bsl':'Модуль команды',
    'sessionmodule.bsl':'Модуль сеанса','applicationmodule.bsl':'Модуль приложения',
    'managedapplicationmodule.bsl':'Модуль управляемого приложения',
    'ordinaryapplicationmodule.bsl':'Модуль обычного приложения',
    'externalconnectionmodule.bsl':'Модуль внешнего соединения'
};

function detect(content) {
    var head = String(content || '').slice(0, 4096);
    return /"\$schema"\s*:\s*"[^"]*sarif/i.test(head) ||
        (/"runs"\s*:/.test(head) && /"version"\s*:\s*"2\.1(?:\.|\")/.test(head));
}

function localizedRuleName(ruleId, rule) {
    var title = root.SarifRuleTitlesRu && root.SarifRuleTitlesRu[ruleId];
    if (title) return title;
    var fromReport = rule && (rule.shortDescription || rule.name) || '';
    if (/[А-Яа-яЁё]/.test(fromReport)) return fromReport;
    return 'Неизвестная диагностика';
}
function ruleLabel(ruleId, rule) {
    return localizedRuleName(ruleId, rule) + ' (' + ruleId + ')';
}
function levelLabel(level) {
    return ({error:'Ошибка', warning:'Предупреждение', note:'Замечание', none:'Без уровня'})[level] || 'Предупреждение';
}

function isAbsolute(path) { return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path); }

function collapsePath(path) {
    var unc = /^\\\\/.test(path), drive = path.match(/^[A-Za-z]:/);
    var prefix = unc ? '\\\\' : (drive ? drive[0] + '\\' : '');
    var rest = path.slice(unc ? 2 : (drive ? 3 : 0));
    var parts = rest.split(/[\\/]+/), out = [];
    for (var i = 0; i < parts.length; i++) {
        if (!parts[i] || parts[i] === '.') continue;
        if (parts[i] === '..') {
            if (out.length && out[out.length - 1] !== '..') out.pop();
            else if (!prefix) out.push('..');
        } else out.push(parts[i]);
    }
    return prefix + out.join('\\');
}

function normalizeUri(uri) {
    var original = String(uri || '');
    var value = original;
    if (/^file:\/\//i.test(value)) {
        value = value.replace(/^file:\/\//i, '');
        if (/^\/[A-Za-z]:/.test(value)) value = value.slice(1);
        else if (value && value[0] !== '/') value = '//' + value;
    }
    try { value = decodeURIComponent(value); } catch (e) { return original; }
    value = value.replace(/\//g, '\\');
    if (/^\\\\\?\\UNC\\/i.test(value)) value = '\\\\' + value.slice(8);
    else if (/^\\\\\?\\/.test(value)) value = value.slice(4);
    return collapsePath(value);
}

function dirname(path) {
    var at = String(path || '').lastIndexOf('\\');
    return at > 2 ? path.slice(0, at) : (at >= 0 ? path.slice(0, at + 1) : '');
}
function joinPath(base, relative) {
    if (!base || isAbsolute(relative)) return collapsePath(relative);
    return collapsePath(String(base).replace(/[\\/]+$/, '') + '\\' + relative);
}

function longestCommonDir(paths) {
    var dirs = (paths || []).filter(isAbsolute).map(dirname);
    if (!dirs.length) return '';
    var first = dirs[0].split('\\');
    var count = first.length;
    for (var i = 1; i < dirs.length; i++) {
        var p = dirs[i].split('\\'), n = Math.min(count, p.length), k = 0;
        while (k < n && first[k].toLowerCase() === p[k].toLowerCase()) k++;
        count = k;
    }
    return first.slice(0, count).join('\\');
}

function parseBslModulePath(filePath) {
    var parts = String(filePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length === 0) return { object: 'Без файла', module: 'Без файла' };
    var fileName = parts[parts.length - 1];
    var objectLabel = function (idx) {
        if (idx < 0 || idx >= parts.length) return null;
        var name = parts[idx], typeDir = parts[idx - 1];
        return typeDir && BSL_METADATA_TYPE_DIRS.has(typeDir) ? typeDir + '.' + name : name;
    };
    var extIdx = parts.lastIndexOf('Ext');
    if (extIdx > 0) {
        var nested = parts[extIdx - 1], nestedKind = parts[extIdx - 2];
        if (nestedKind === 'Forms' || nestedKind === 'Формы')
            return { object: objectLabel(extIdx - 3) || nested, module: 'Форма: ' + nested };
        if (nestedKind === 'Commands' || nestedKind === 'Команды')
            return { object: objectLabel(extIdx - 3) || nested, module: 'Команда: ' + nested };
        if (nestedKind === 'Templates' || nestedKind === 'Макеты')
            return { object: objectLabel(extIdx - 3) || nested, module: 'Макет: ' + nested };
        var objIdx = extIdx - 1;
        return { object: objectLabel(objIdx) || parts[objIdx] || fileName,
            module: BSL_MODULE_FILE_LABELS[fileName.toLowerCase()] || fileName.replace(/\.bsl$/i, '') };
    }
    var parentIdx = parts.length - 2;
    return { object: (parentIdx >= 0 && objectLabel(parentIdx)) || fileName, module: fileName };
}

function levelCounts(diags) {
    var c = { total: 0, error: 0, warning: 0, note: 0, none: 0, suppressed: 0 };
    (diags || []).forEach(function (d) {
        c.total++;
        if (d.suppressed) c.suppressed++;
        else c[d.level] = (c[d.level] || 0) + 1;
    });
    return c;
}

function parse(content) {
    var doc;
    try { doc = JSON.parse(String(content || '')); }
    catch (e) { return { error: 'Некорректный JSON: ' + e.message }; }
    if (!doc || !Array.isArray(doc.runs) || String(doc.version || '').indexOf('2.1') !== 0)
        return { error: 'Это не отчёт SARIF 2.1.0.' };
    var rules = {}, diagnostics = [], uriBases = {}, absolutePaths = [], serial = 0;
    var tool = { name: '', semanticVersion: '' };
    doc.runs.forEach(function (run) {
        var driver = run.tool && run.tool.driver || {};
        if (!tool.name) tool = { name: driver.name || '', semanticVersion: driver.semanticVersion || driver.version || '' };
        (driver.rules || []).forEach(function (r) {
            var id = String(r.id || '');
            if (id) rules[id] = { id: id, name: r.name || id,
                shortDescription: r.shortDescription && (r.shortDescription.text || r.shortDescription.markdown) || '' };
        });
        Object.keys(run.originalUriBaseIds || {}).forEach(function (id) {
            var loc = run.originalUriBaseIds[id] && run.originalUriBaseIds[id].uri;
            if (loc) uriBases[id] = normalizeUri(loc);
        });
        (run.results || []).forEach(function (result) {
            var ruleId = String(result.ruleId || '');
            if (ruleId === 'ParseError') return;
            var physical = result.locations && result.locations[0] && result.locations[0].physicalLocation || {};
            var artifact = physical.artifactLocation || result.analysisTarget || {};
            var uri = String(artifact.uri || ''), baseId = String(artifact.uriBaseId || '');
            var path = normalizeUri(uri), base = uriBases[baseId];
            if (base && path && !isAbsolute(path)) path = joinPath(base, path);
            if (isAbsolute(path)) absolutePaths.push(path);
            var region = physical.region || {}, parsed = parseBslModulePath(path);
            var message = result.message && (result.message.text || result.message.markdown) || '';
            var level = /^(error|warning|note|none)$/.test(result.level || '') ? result.level : 'warning';
            var fp = result.partialFingerprints && Object.keys(result.partialFingerprints).map(function (k) { return result.partialFingerprints[k]; })[0];
            var baseKey = [ruleId, path.toLowerCase(), region.startLine || 1, region.startColumn || 0, fp || message].join('|');
            ruleId = ruleId || 'UnknownRule';
            var displayRule = ruleLabel(ruleId, rules[ruleId]);
            diagnostics.push({ id: baseKey + '|' + serial++, ruleId: ruleId, ruleTitle: displayRule, level: level,
                message: String(message), uri: uri, uriBaseId: baseId, path: path,
                /* Numbers only: the line goes into the card's markup unescaped. */
                line: +region.startLine || 1, col: +region.startColumn || 0,
                endLine: +region.endLine || 0, endCol: +region.endColumn || 0,
                suppressed: !!(result.suppressions && result.suppressions.length),
                object: parsed.object, module: parsed.module,
                search: [displayRule, ruleId, message, path, parsed.object, parsed.module].join(' ').toLowerCase() });
        });
    });
    return { model: { tool: tool, rules: rules, diagnostics: diagnostics,
        counts: levelCounts(diagnostics), uriBases: uriBases,
        suggestedRoot: longestCommonDir(absolutePaths) } };
}

function groupNode(label, depth) { return { label: label, depth: depth, children: new Map(), diagnostics: [] }; }
function diagnosticLabels(d, mode) {
    var title = d.ruleTitle || ruleLabel(d.ruleId, null);
    return mode === 'rule' ? [title, d.path || 'Без файла'] : [d.object, d.module, title];
}
function diagnosticGroupKeys(d, mode) {
    var key = 'root';
    return diagnosticLabels(d, mode).map(function (label) { key += '|' + label; return key; });
}
function buildTree(diags, mode) {
    var rootNode = groupNode('', -1);
    (diags || []).forEach(function (d) {
        var labels = diagnosticLabels(d, mode);
        var node = rootNode;
        labels.forEach(function (label, depth) {
            if (!node.children.has(label)) node.children.set(label, groupNode(label, depth));
            node = node.children.get(label);
        });
        node.diagnostics.push(d);
    });
    function sort(node) {
        node.diagnostics.sort(function (a,b) { return a.line - b.line || a.col - b.col; });
        node.children.forEach(sort);
        if (node.depth === 1 && mode !== 'rule') node.children = new Map(Array.from(node.children).sort(function(a,b){return a[0].localeCompare(b[0],'ru');}));
    }
    sort(rootNode);
    return rootNode;
}

function isShortDiagnosticRange(d) { return ((d.endLine || d.line) - d.line + 1) <= 5; }
function shouldRenderDiagnostic(shown, limit, diagnostic, wantedId) {
    return shown < limit || diagnostic.id === wantedId;
}
function detectEol(content) {
    var crlf = /\r\n/.test(content), lf = /(^|[^\r])\n/.test(content);
    return crlf && lf ? 'Mixed' : (crlf ? 'Crlf' : (lf ? 'Lf' : 'None'));
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function icon(level) { return level === 'error' ? 'alert-triangle' : (level === 'warning' ? 'flag' : 'info-circle'); }
function flattenCount(node) {
    var out = node.diagnostics.slice(); node.children.forEach(function(n){ out = out.concat(flattenCount(n)); }); return out;
}
function groupLevel(counts) {
    return counts.error ? 'error' : (counts.warning ? 'warning' : (counts.note ? 'note' : 'none'));
}
function isRuleGroup(depth, mode) {
    return mode === 'rule' ? depth === 0 : depth === 2;
}
function defaultGroupOpen(depth, requestedDepth, mode) {
    /* "До X" leaves X visible but folded.  Diagnostics are cards inside a
     * rule group, so only the fourth option may open depth 2 rules. */
    if (mode === 'rule') return requestedDepth >= 4;
    return depth < Math.max(0, requestedDepth - 1);
}

function render(model, container, options) {
    options = options || {};
    lastRender = { model: model, container: container, options: options };
    var tree = buildTree(model.diagnostics, grouping), shown = 0, omitted = 0, html = [];
    html.push('<div class="sf-toolbar"><button data-group="object" class="', grouping === 'object' ? 'active' : '', '">По объектам</button>',
        '<button data-group="rule" class="', grouping === 'rule' ? 'active' : '', '">По правилам</button>',
        '<select data-expand><option value="1">До объектов</option><option value="2">До модулей</option><option value="3">До правил</option><option value="4">До диагностик</option></select></div>');
    function walk(node, key) {
        node.children.forEach(function (child, label) {
            var childKey = key + '|' + label;
            var open = !collapsedGroups.has(childKey) &&
                (defaultGroupOpen(child.depth, expandDepth, grouping) || expandedGroups.has(childKey));
            var counts = levelCounts(flattenCount(child));
            var levelClass = isRuleGroup(child.depth, grouping) ? ' sf-' + groupLevel(counts) : '';
            html.push('<section class="sf-group" data-depth="', child.depth, '"><div class="sf-group-head', levelClass, '" role="button" tabindex="0" data-fold="', esc(childKey), '">',
                '<span class="sf-twisty">', open ? '▾' : '▸', '</span><span class="sf-group-label">', esc(label), '</span>',
                '<span class="sf-counts">', counts.total, '</span></div><div class="sf-group-body"', open ? '' : ' hidden', '>');
            if (open) {
                walk(child, childKey);
                child.diagnostics.forEach(function (d) {
                    if (!shouldRenderDiagnostic(shown, renderLimit, d, selectedId)) { omitted++; return; }
                    shown++;
                    html.push('<button class="sf-card sf-', esc(d.level), d.id === selectedId ? ' selected' : '', '" data-id="', esc(d.id), '">',
                        '<span class="sf-message">', esc(d.message), '</span>',
                        '<span class="sf-card-meta"><span class="sf-severity"><svg class="sf-icon"><use href="#i-', icon(d.level), '"></use></svg>',
                        '<span class="sf-level">', esc(levelLabel(d.level)), '</span></span><span class="sf-line">строка ', d.line, '</span></span></button>');
                });
            }
            html.push('</div></section>');
        });
    }
    walk(tree, 'root');
    if (omitted) html.push('<button class="sf-more" data-more>Показать ещё ', Math.min(RENDER_INCREMENT, omitted), ' из ', omitted, '</button>');
    container.className = 'sf-root';
    container.innerHTML = html.join('');
    var sel = container.querySelector('[data-expand]'); if (sel) sel.value = String(expandDepth);
    container.onclick = function (e) {
        var target = e.target.closest ? e.target.closest('[data-group],[data-fold],[data-id],[data-more]') : e.target;
        if (!target) return;
        if (target.hasAttribute('data-group')) { grouping = target.getAttribute('data-group'); renderLimit = RENDER_INCREMENT; render(model, container, options); }
        else if (target.hasAttribute('data-fold')) {
            var foldKey=target.getAttribute('data-fold'), body=target.nextElementSibling;
            if (body && body.hidden) { expandedGroups.add(foldKey); collapsedGroups.delete(foldKey); }
            else { collapsedGroups.add(foldKey); expandedGroups.delete(foldKey); }
            render(model, container, options);
        }
        else if (target.hasAttribute('data-more')) { renderLimit += RENDER_INCREMENT; render(model, container, options); }
        else if (target.hasAttribute('data-id')) { var id=target.getAttribute('data-id'); selectedId=id; highlight(container,id); var d=model.diagnostics.find(function(x){return x.id===id;}); if(d&&options.onSelect)options.onSelect(d); }
    };
    container.onkeydown = function(e){ if ((e.key==='Enter'||e.key===' ') && e.target && e.target.hasAttribute('data-fold')) { e.preventDefault(); e.target.click(); } };
    if (sel) sel.onchange = function(){ expandDepth=parseInt(sel.value,10)||1; expandedGroups.clear(); collapsedGroups.clear(); renderLimit=RENDER_INCREMENT; render(model,container,options); };
}

function outline() { return []; }
function itemKey(it) { return it && it.id || ''; }
function highlight(container, id) {
    selectedId = String(id || '');
    if (!container || !container.querySelectorAll) return null;
    var cards=container.querySelectorAll('.sf-card'), hit=null;
    for(var i=0;i<cards.length;i++){var on=cards[i].getAttribute('data-id')===selectedId;cards[i].classList.toggle('selected',on);if(on)hit=cards[i];}
    if(hit&&hit.scrollIntoView)hit.scrollIntoView({block:'nearest'});
    return hit;
}
function reveal(container, id) {
    selectedId = String(id || '');
    var visible = highlight(container, selectedId);
    if (visible) return visible;
    if (!lastRender || !lastRender.model || lastRender.container !== container) return highlight(container, selectedId);
    var diagnostic = lastRender.model.diagnostics.find(function (d) { return d.id === selectedId; });
    if (!diagnostic) return highlight(container, selectedId);
    diagnosticGroupKeys(diagnostic, grouping).forEach(function (key) {
        expandedGroups.add(key);
        collapsedGroups.delete(key);
    });
    render(lastRender.model, container, lastRender.options);
    return highlight(container, selectedId);
}
function outlineHasChildren(items){return items;}
function outlineHidden(){return false;}
function outlineExpandTo(){return false;}
function outlineCollapseAll(items, collapsed){return collapsed;}
function resetViewState(){grouping='object';expandDepth=1;selectedId='';renderLimit=RENDER_INCREMENT;expandedGroups.clear();collapsedGroups.clear();lastRender=null;}
function dismiss(container){if(container){container.onclick=null;container.onkeydown=null;}}

root.SarifPreview = { detect:detect, parse:parse, render:render, outline:outline, itemKey:itemKey,
    highlight:highlight, reveal:reveal, outlineHasChildren:outlineHasChildren, outlineHidden:outlineHidden,
    outlineExpandTo:outlineExpandTo, outlineCollapseAll:outlineCollapseAll,
    resetViewState:resetViewState, dismiss:dismiss,
    _test:{normalizeUri:normalizeUri,parseBslModulePath:parseBslModulePath,buildTree:buildTree,
        isShortDiagnosticRange:isShortDiagnosticRange,levelCounts:levelCounts,
        longestCommonDir:longestCommonDir,detectEol:detectEol,joinPath:joinPath,
        diagnosticGroupKeys:diagnosticGroupKeys,shouldRenderDiagnostic:shouldRenderDiagnostic,
        defaultGroupOpen:defaultGroupOpen,
        localizedRuleName:localizedRuleName,ruleLabel:ruleLabel,levelLabel:levelLabel} };
})(typeof globalThis !== 'undefined' ? globalThis : window);
