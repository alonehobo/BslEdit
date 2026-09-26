/* Shared font editor for managed forms and spreadsheet templates. 1C stores
 * the same visual choices in two slightly different shapes: forms call the
 * fields face/height and may refer to a style item, while templates call them
 * faceName/height and always keep an absolute font. The control speaks the
 * neutral shape { face, height, ... } and lets each caller adapt it. */
(function (root) {
'use strict';

var FACES = [
    'Arial', 'Arial Narrow', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS',
    'Consolas', 'Courier New', 'Georgia', 'Lucida Console', 'Microsoft Sans Serif',
    'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'
];
var SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
var STYLE_FONTS = [
    'NormalTextFont', 'SmallTextFont', 'LargeTextFont', 'ExtraLargeTextFont',
    'FormTitleFont', 'GroupTitleFont', 'ButtonTextFont', 'TooltipTextFont'
];
var FLAGS = [
    ['bold', 'Полужирный'], ['italic', 'Наклонный'],
    ['underline', 'Подчеркнутый'], ['strikeout', 'Зачеркнутый']
];

function copyFont(value) {
    value = value || {};
    var out = {};
    if (value.ref) out.ref = String(value.ref);
    var face = value.face != null ? value.face : value.faceName;
    if (face) out.face = String(face);
    var height = value.height != null ? value.height : value.size;
    if (height != null && height !== '') out.height = Number(height);
    if (value.scale != null && value.scale !== '') out.scale = Number(value.scale);
    for (var i = 0; i < FLAGS.length; i++) {
        var key = FLAGS[i][0];
        if (value[key] != null) out[key] = !!value[key];
    }
    return out;
}

function label(value) {
    var font = copyFont(value);
    if (!font.ref && !font.face && !font.height) return 'Авто';
    var parts = [];
    if (font.ref) parts.push(font.ref.replace(/^style:/, ''));
    if (font.face) parts.push(font.face);
    if (font.height) parts.push(String(font.height));
    for (var i = 0; i < FLAGS.length; i++) if (font[FLAGS[i][0]]) parts.push(FLAGS[i][1].toLowerCase());
    if (font.scale && font.scale !== 100) parts.push(font.scale + '%');
    return parts.join(', ');
}

function control(doc, options) {
    options = options || {};
    if (!doc || !doc.createElement) return null;
    var current = copyFont(options.value);
    var draft = copyFont(current);
    var opened = false;

    function make(tag, cls, parent) {
        var node = doc.createElement(tag);
        if (cls) node.className = cls;
        if (parent) parent.appendChild(node);
        return node;
    }

    var wrap = make('div', 'font-edit');
    var preview = make('span', 'font-edit-preview', wrap);
    preview.textContent = 'Аа';
    var summary = make('input', 'fp-prop-input font-edit-summary', wrap);
    summary.type = 'text';
    summary.readOnly = true;
    var more = make('button', 'font-edit-more', wrap);
    more.type = 'button';
    more.textContent = '…';
    more.title = 'Выбрать шрифт';

    var pop = make('div', 'font-dialog', wrap);
    pop.style.display = 'none';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');

    var head = make('div', 'font-dialog-head', pop);
    make('span', 'font-dialog-title', head).textContent = options.title || 'Выбор шрифта';
    var closeButton = make('button', 'font-dialog-close', head);
    closeButton.type = 'button';
    closeButton.textContent = '×';

    var body = make('div', 'font-dialog-body', pop);
    var modeRow = make('label', 'font-dialog-row font-dialog-mode', body);
    make('span', '', modeRow).textContent = 'Источник';
    var mode = make('select', 'fp-prop-input', modeRow);
    [['absolute', 'Произвольный'], ['style', 'Из стиля']].forEach(function (pair) {
        var option = make('option', '', mode);
        option.value = pair[0]; option.textContent = pair[1];
    });
    if (!options.allowStyle) modeRow.style.display = 'none';

    function datalistInput(caption, values, cls) {
        var row = make('label', 'font-dialog-row', body);
        make('span', '', row).textContent = caption;
        var input = make('input', 'fp-prop-input ' + (cls || ''), row);
        input.type = 'text';
        var list = make('datalist', '', row);
        var id = 'font-list-' + Math.random().toString(36).slice(2);
        list.id = id;
        input.setAttribute('list', id);
        for (var i = 0; i < values.length; i++) {
            var option = make('option', '', list);
            option.value = values[i];
        }
        return { row: row, input: input };
    }

    var style = datalistInput('Стиль', STYLE_FONTS, 'font-dialog-style');
    var face = datalistInput('Гарнитура', FACES, 'font-dialog-face');
    var measures = make('div', 'font-dialog-measures', body);
    var sizeLabel = make('label', '', measures);
    make('span', '', sizeLabel).textContent = 'Размер';
    var size = make('input', 'fp-prop-input', sizeLabel);
    size.type = 'number'; size.min = '1'; size.max = '200'; size.step = '1';
    var sizeList = make('datalist', '', sizeLabel);
    sizeList.id = 'font-size-' + Math.random().toString(36).slice(2);
    size.setAttribute('list', sizeList.id);
    for (var si = 0; si < SIZES.length; si++) {
        var sizeOption = make('option', '', sizeList); sizeOption.value = String(SIZES[si]);
    }
    var scaleLabel = make('label', '', measures);
    make('span', '', scaleLabel).textContent = 'Масштаб, %';
    var scale = make('input', 'fp-prop-input', scaleLabel);
    scale.type = 'number'; scale.min = '1'; scale.max = '1000'; scale.step = '1';

    var traits = make('fieldset', 'font-dialog-traits', body);
    make('legend', '', traits).textContent = 'Начертание';
    var checks = {};
    for (var fi = 0; fi < FLAGS.length; fi++) {
        var flagLabel = make('label', '', traits);
        var check = make('input', '', flagLabel);
        check.type = 'checkbox';
        checks[FLAGS[fi][0]] = check;
        make('span', '', flagLabel).textContent = FLAGS[fi][1];
    }

    var sample = make('div', 'font-dialog-sample', body);
    sample.textContent = options.sample || 'Пример шрифта — Аа Бб 123';
    var actions = make('div', 'font-dialog-actions', pop);
    var inherit = make('button', 'tp-tool font-dialog-auto', actions);
    inherit.type = 'button'; inherit.textContent = 'Авто';
    var ok = make('button', 'tp-tool', actions);
    ok.type = 'button'; ok.textContent = 'ОК';
    var cancel = make('button', 'tp-tool', actions);
    cancel.type = 'button'; cancel.textContent = 'Отмена';

    function gather(report) {
        var height = Number(size.value);
        var zoom = Number(scale.value);
        var next = {};
        if (options.allowStyle && mode.value === 'style') {
            var ref = String(style.input.value || '').trim();
            if (ref && ref.indexOf('style:') !== 0) ref = 'style:' + ref;
            if (!ref) { if (report) report('Укажите шрифт стиля.'); return null; }
            next.ref = ref;
        } else {
            var family = String(face.input.value || '').trim();
            if (!family) { if (report) report('Укажите гарнитуру шрифта.'); return null; }
            next.face = family;
        }
        if (!(height > 0) || height > 200) { if (report) report('Размер шрифта должен быть от 1 до 200.'); return null; }
        if (!(zoom > 0) || zoom > 1000) { if (report) report('Масштаб шрифта должен быть от 1 до 1000%.'); return null; }
        next.height = height;
        next.scale = zoom;
        for (var i = 0; i < FLAGS.length; i++) next[FLAGS[i][0]] = !!checks[FLAGS[i][0]].checked;
        return next;
    }

    function paintSample() {
        var family = String(face.input.value || current.face || 'Arial');
        var height = Number(size.value) || current.height || 10;
        sample.style.fontFamily = family + ', Arial, sans-serif';
        sample.style.fontSize = Math.max(8, Math.min(32, height * 4 / 3)) + 'px';
        sample.style.fontWeight = checks.bold.checked ? '700' : '400';
        sample.style.fontStyle = checks.italic.checked ? 'italic' : 'normal';
        sample.style.textDecoration = (checks.underline.checked ? 'underline ' : '')
            + (checks.strikeout.checked ? 'line-through' : '');
    }

    function syncMode() {
        var fromStyle = options.allowStyle && mode.value === 'style';
        style.row.style.display = fromStyle ? '' : 'none';
        face.row.style.display = fromStyle ? 'none' : '';
        paintSample();
    }

    function fill() {
        draft = copyFont(current);
        mode.value = options.allowStyle && draft.ref ? 'style' : 'absolute';
        style.input.value = String(draft.ref || '').replace(/^style:/, '');
        face.input.value = draft.face || options.defaultFace || 'Arial';
        size.value = String(draft.height || options.defaultHeight || 8);
        scale.value = String(draft.scale || 100);
        for (var i = 0; i < FLAGS.length; i++) checks[FLAGS[i][0]].checked = !!draft[FLAGS[i][0]];
        syncMode();
    }

    function place() {
        if (!more.getBoundingClientRect || !pop.getBoundingClientRect) return;
        var anchor = more.getBoundingClientRect();
        var box = pop.getBoundingClientRect();
        var view = doc.documentElement || {};
        var vw = view.clientWidth || box.width || 430;
        var vh = view.clientHeight || box.height || 410;
        var left = Math.max(4, Math.min(anchor.left, vw - (box.width || 430) - 4));
        var top = anchor.bottom + 2;
        if (top + (box.height || 410) > vh - 4) top = Math.max(4, anchor.top - (box.height || 410) - 2);
        pop.style.left = left + 'px'; pop.style.top = top + 'px';
    }

    function open() { if (options.readOnly) return; fill(); opened = true; pop.style.display = ''; place(); }
    function close() { opened = false; pop.style.display = 'none'; }
    function apply() {
        var next = gather(options.onError);
        if (!next) return;
        close(); current = copyFont(next); update();
        if (options.onApply) options.onApply(next);
    }
    function clear() {
        close(); current = {}; update();
        if (options.onClear) options.onClear(); else if (options.onApply) options.onApply(null);
    }
    function update() {
        summary.value = label(current);
        preview.style.fontFamily = (current.face || options.defaultFace || 'Arial') + ', Arial, sans-serif';
        preview.style.fontWeight = current.bold ? '700' : '400';
        preview.style.fontStyle = current.italic ? 'italic' : 'normal';
        more.disabled = !!options.readOnly;
    }

    mode.addEventListener('change', syncMode);
    face.input.addEventListener('input', paintSample);
    size.addEventListener('input', paintSample);
    for (var key in checks) if (Object.prototype.hasOwnProperty.call(checks, key)) checks[key].addEventListener('change', paintSample);
    more.addEventListener('click', open);
    closeButton.addEventListener('click', close);
    cancel.addEventListener('click', close);
    ok.addEventListener('click', apply);
    inherit.addEventListener('click', clear);
    pop.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        else if (event.key === 'Enter') { event.preventDefault(); apply(); }
    });
    update();

    return {
        element: wrap, pop: pop, open: open, close: close, apply: apply, clear: clear,
        controls: { mode: mode, style: style.input, face: face.input, size: size, scale: scale, checks: checks },
        value: function () { return copyFont(current); },
        setValue: function (value) { current = copyFont(value); if (!opened) update(); }
    };
}

root.FontEditor = { control: control, label: label, normalise: copyFont,
    faces: FACES.slice(), sizes: SIZES.slice(), styleFonts: STYLE_FONTS.slice() };

})(typeof window !== 'undefined' ? window : globalThis);
