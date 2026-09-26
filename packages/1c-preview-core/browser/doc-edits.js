/* Turning a rewritten document into the few text edits an editor has to
 * apply. Both editing engines in this project — TemplateMarkup for spreadsheet
 * templates and FormEdit for managed forms — return a whole new document
 * rather than offsets, because a change is rarely local: a template's look
 * lives in shared tables at the end of the file while the cell that uses it
 * sits near the top. Handing the host the new text wholesale would lose the
 * cursor and the undo stack, and a common prefix and suffix is no help when
 * two distant places changed — that span covers almost the whole file. A line
 * diff sees the two places for what they are: a range edit of 8x4 cells on a
 * 251 KB template comes out as 16 small hunks, and a property change on a form
 * as a single one.
 *
 * Works in the browser and in Node alike; nothing here touches the DOM. */
(function (root) {
'use strict';

/* ---------- line diff ---------- */

/* Myers' greedy algorithm (An O(ND) Difference Algorithm, 1986). D is the
 * number of inserted and deleted lines, a few hundred at most for one edit, so
 * the O(N*D) walk is cheap even on the largest template in the corpus. A
 * document rewritten beyond recognition would make D large; the walk is capped
 * and the caller falls back to replacing everything. */
var MAX_D = 4000;

/* Lines shared at the start and at the end, which no edit has to touch. */
function trailing(a, b) {
    var n = Math.min(a.length, b.length);
    var head = 0;
    while (head < n && a[head] === b[head]) head++;
    var tail = 0;
    while (tail < n - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    return { head: head, tail: tail };
}

/* Edit script over two line arrays as [{ at, remove, insert: [lines] }], where
 * `at` indexes `a`. Null when the cap is hit. */
function lineScript(a, b) {
    var cut = trailing(a, b);
    var A = a.slice(cut.head, a.length - cut.tail);
    var B = b.slice(cut.head, b.length - cut.tail);
    if (!A.length && !B.length) return [];
    if (!A.length) return [{ at: cut.head, remove: 0, insert: B }];
    if (!B.length) return [{ at: cut.head, remove: A.length, insert: [] }];

    var n = A.length, m = B.length, max = n + m;
    var v = new Int32Array(2 * max + 1);
    var trace = [];
    var d, k, x, y;
    var found = -1;
    for (d = 0; d <= max && d <= MAX_D && found < 0; d++) {
        /* Only k in [-d, d] has been touched, so a snapshot is 2d+1 wide and
         * the whole trace costs O(D^2) integers, not O(D * (N + M)). */
        trace.push(v.slice(max - d, max + d + 1));
        for (k = -d; k <= d; k += 2) {
            if (k === -d || (k !== d && v[max + k - 1] < v[max + k + 1])) x = v[max + k + 1];
            else x = v[max + k - 1] + 1;
            y = x - k;
            while (x < n && y < m && A[x] === B[y]) { x++; y++; }
            v[max + k] = x;
            if (x >= n && y >= m) { found = d; break; }
        }
    }
    if (found < 0) return null;

    /* Walk the trace back. trace[d] holds the reach vector as it stood before
     * round d, so the move that closed round d is read from it: down
     * inserts B[prevY] before A[prevX], right deletes A[prevX]. */
    var steps = [];
    x = n; y = m;
    for (d = found; d > 0; d--) {
        var prev = trace[d];
        var reach = function (kk) {
            var i = kk + d;
            return i >= 0 && i < prev.length ? prev[i] : -1;
        };
        k = x - y;
        var down = (k === -d || (k !== d && reach(k - 1) < reach(k + 1)));
        var prevK = down ? k + 1 : k - 1;
        var prevX = reach(prevK);
        var prevY = prevX - prevK;
        steps.push(down ? { insert: B[prevY], at: prevX } : { at: prevX });
        x = prevX;
        y = prevY;
    }
    steps.reverse();

    /* Fuse touching removals and insertions into hunks. */
    var out = [];
    for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        var at = cut.head + step.at;
        var last = out[out.length - 1];
        var joins = last && last.at + last.remove === at;
        if (step.insert == null) {
            if (joins) last.remove++;
            else out.push({ at: at, remove: 1, insert: [] });
        } else {
            if (joins) last.insert.push(step.insert);
            else out.push({ at: at, remove: 0, insert: [step.insert] });
        }
    }
    return out;
}

/* ---------- text edits ---------- */

/* The line diff as character ranges of `before`, ready for an editor that
 * applies several edits in one undo step. Ranges never overlap and come in
 * ascending order. A single whole-document replacement is returned when the
 * documents are too far apart for the capped walk. */
function textEdits(before, after) {
    before = String(before);
    after = String(after);
    if (before === after) return [];
    var a = before.split('\n');
    var b = after.split('\n');
    var script = lineScript(a, b);
    if (!script) return [{ start: 0, end: before.length, text: after }];

    /* Character offset where every line begins. The document's last line has
     * no newline after it, so the entry one past the end lands one character
     * beyond the text and marks the append case below. */
    var starts = new Array(a.length + 1);
    var pos = 0;
    for (var i = 0; i < a.length; i++) {
        starts[i] = pos;
        pos += a[i].length + 1;          // the split ate one newline
    }
    starts[a.length] = pos;

    var length = before.length;
    return script.map(function (hunk) {
        var start = starts[hunk.at];
        var end = starts[hunk.at + hunk.remove];
        var body = hunk.insert.join('\n');
        if (start > length) {
            /* Appending past the last line: the newline goes in front of the
             * new text rather than after it. */
            return { start: length, end: length, text: hunk.insert.length ? '\n' + body : '' };
        }
        if (end > length) {
            /* The hunk runs to the end of a document that carries no trailing
             * newline of its own. Deleting the tail outright has to take the
             * newline in front of it as well, or the document keeps a blank
             * last line it did not have before. */
            if (!hunk.insert.length && hunk.at > 0) return { start: start - 1, end: length, text: '' };
            return { start: start, end: length, text: body };
        }
        return { start: start, end: end, text: hunk.insert.length ? body + '\n' : '' };
    });
}

/* Applying the edits to `before` must reproduce `after`; used by the tests and
 * as a cheap self-check before an edit reaches the editor. */
function applyEdits(before, edits) {
    var out = '';
    var at = 0;
    for (var i = 0; i < edits.length; i++) {
        out += before.slice(at, edits[i].start) + edits[i].text;
        at = edits[i].end;
    }
    return out + before.slice(at);
}

root.DocEdits = {
    textEdits: textEdits,
    applyEdits: applyEdits,
    _test: { lineScript: lineScript, trailing: trailing }
};

})(typeof window !== 'undefined' ? window : globalThis);
