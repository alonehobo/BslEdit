/* Form context resolution shared by every host: the MCP server (Node),
 * BSLEdit and the Total Commander viewer (WebView2), and later the
 * native MCP server.
 *
 * A Form.xml alone does not render faithfully: the owning object descriptor,
 * the base cf form of an extension, referenced style items, common commands
 * (including the platform's automatic form-command-bar contributions) and
 * common pictures live elsewhere in the configuration export. This module
 * finds and reads them through a host-supplied io adapter, so each host keeps
 * only its own access policy and every host resolves the same context.
 *
 *   io.exists(path)            -> Promise<boolean>  file exists and is allowed
 *   io.readBytes(path, limit)  -> Promise<Uint8Array|null>  null when missing,
 *                                 denied or larger than limit
 *
 * A host whose every call is a round trip (WebView2, the native MCP server)
 * should also offer the batch forms; the resolver then coalesces the lookups
 * of one pass into a few requests:
 *
 *   io.existsMany(paths)               -> Promise<boolean[]>
 *   io.readMany(paths, limit, filter)  -> Promise<(Uint8Array|null)[]>
 *        filter is '' or one of TEXT_FILTERS; a host may apply it to cut the
 *        transfer or ignore it - the resolver applies it again either way
 *   io.statMany(paths)                 -> Promise<(string|null)[]>  an opaque
 *        "size:mtime" stamp, null when missing or denied
 *   io.cacheGet(directory, key)        -> Promise<string|null>
 *   io.cachePut(directory, key, text)  -> Promise<void>
 *        a persistent store for the configuration's command catalog, allowed
 *        only for directories the host would let the resolver read
 *   io.baseConfigurations(extensionRoot) -> Promise<string[]>
 *        the configurations an extension may extend, nearest first: the
 *        directories near extensionRoot whose Configuration.xml is not an
 *        extension. Only a host can list directories; without this method an
 *        extension finds its configuration only in the <root>/cfe/<ext> ->
 *        <root>/cf layout
 *   io.extensionConfigurations(configurationRoot) -> Promise<string[]>
 *        the mirror image: the directories near configurationRoot whose
 *        Configuration.xml is an extension. The configuration window shows
 *        what they add; without this method it shows the configuration alone
 *   io.moduleFiles(configurationRoot) -> Promise<string[]>
 *        the `*Module.bsl` files below the configuration root. The host lists
 *        them on demand for global module search; no persistent index is kept
 *
 * Plain script: in a browser it defines window.FormContext; in Node it is
 * imported for its side effect and read from globalThis.FormContext. It uses
 * no Node modules and no directory listing - configuration catalogs come from
 * ConfigDumpInfo.xml (or Configuration.xml when the dump has no index). */
(function (root) {
    'use strict';

    var OBJECT_META_MARKER = 'MetaDataObject';
    var OBJECT_HELP_MARKER = '<!--fp-object-help-->';
    var SUPPORTED_EXTENSIONS = ['.xml', '.form', '.mxl', '.mxlx'];
    var PICTURE_BYTES_LIMIT = 16 * 1024 * 1024;
    var PICTURE_COUNT_LIMIT = 256;
    /* Every lookup is one host round trip (a WebView2 virtual-host fetch in
     * BSLEdit), and a large configuration needs thousands of them. Running a
     * window of them at once turns the wall time from the sum of the latencies
     * into their maximum; results are still collected in the original order,
     * so the rendered command order never depends on timing. */
    var DEFAULT_CONCURRENCY = 16;
    /* With a batching host, queue many lookups together, then cap native
     * requests separately so each batch cannot multiply host worker threads. */
    var BATCH_CONCURRENCY = 4096;
    var BATCH_PATHS = 512;
    var BATCH_REQUEST_CONCURRENCY = 4;
    var CATALOG_CACHE_KEY = 'command-catalog:v3';
    var MD_LINK_TAGS = ['RegisterRecords', 'BasedOn', 'Owners', 'Content', 'Source',
        'RegisteredDocuments', 'Documents', 'Type'];

    var TEXT_FILTERS = {
        /* ConfigDumpInfo.xml: `<Metadata name="X"` for every X that is a
         * command or command group (`CommonCommand.`, `CommandGroup.` or with a
         * `.Command.` segment), one per line. Whitespace between the tag name
         * and the attribute is kept as written. */
        'command-metadata': function (text) {
            var out = [];
            var at = 0;
            while ((at = text.indexOf('<Metadata', at)) >= 0) {
                var cursor = at + 9;
                while (cursor < text.length && ' \t\r\n\f\v'.indexOf(text.charAt(cursor)) >= 0) cursor++;
                if (cursor === at + 9 || text.substr(cursor, 6) !== 'name="') { at = cursor; continue; }
                var valueStart = cursor + 6;
                var quote = text.indexOf('"', valueStart);
                if (quote < 0) break;
                var name = text.slice(valueStart, quote);
                if (name && (name.indexOf('CommonCommand.') === 0 || name.indexOf('CommandGroup.') === 0
                        || name.indexOf('.Command.') >= 0))
                    out.push(text.slice(at, quote + 1));
                at = quote + 1;
            }
            return out.join('\n');
        },
        /* Configuration.xml: everything before <ChildObjects>, which holds the
         * properties (ConfigurationExtensionPurpose among them) and not the
         * object list that makes a real configuration's file large. */
        'configuration-properties': function (text) {
            var at = text.indexOf('<ChildObjects>');
            return at < 0 ? text : text.slice(0, at);
        },
        /* An object descriptor cut to the references the object window
         * inverts (metadata-relations.js): before <ChildObjects>, every
         * `<Tag>...</Tag>` of MD_LINK_TAGS written without attributes; after
         * it, every `<Subsystem>...</Subsystem>` (a subsystem's children). One
         * element per line, in file order. */
        'md-links': function (text) {
            if (text.indexOf('http://g5.1c.ru/v8/dt/metadata/mdclass') >= 0) {
                var projTags = { registerRecords: 'RegisterRecords', basedOn: 'BasedOn', owners: 'Owners',
                    content: 'Content', source: 'Source', registeredDocuments: 'RegisteredDocuments',
                    documents: 'Documents', subsystems: 'Subsystems' };
                var projOut = [];
                Object.keys(projTags).forEach(function (sourceTag) {
                    var re = new RegExp('<' + sourceTag + '>([^<]*)</' + sourceTag + '>', 'g'), match;
                    while ((match = re.exec(text))) {
                        var value = match[1].trim();
                        if (!value) continue;
                        var targetTag = projTags[sourceTag];
                        if (sourceTag === 'subsystems') projOut.push('<Subsystem>' + value + '</Subsystem>');
                        else projOut.push('<' + targetTag + '><xr:Item>' + value + '</xr:Item></' + targetTag + '>');
                    }
                });
                var types = /<types>([^<]*)<\/types>/g, typeMatch, typeItems = [];
                while ((typeMatch = types.exec(text))) if (typeMatch[1].trim()) typeItems.push('<v8:Type>' + typeMatch[1].trim() + '</v8:Type>');
                if (typeItems.length) projOut.push('<Type>' + typeItems.join('') + '</Type>');
                return projOut.join('\n');
            }
            var out = [];
            var split = text.indexOf('<ChildObjects>');
            var head = split < 0 ? text : text.slice(0, split);
            var hits = [];
            MD_LINK_TAGS.forEach(function (tag) {
                var open = '<' + tag + '>';
                var close = '</' + tag + '>';
                var at = 0;
                while ((at = head.indexOf(open, at)) >= 0) {
                    var end = head.indexOf(close, at + open.length);
                    if (end < 0) break;
                    hits.push([at, end + close.length]);
                    at = end + close.length;
                }
            });
            hits.sort(function (a, b) { return a[0] - b[0]; });
            hits.forEach(function (hit) { out.push(head.slice(hit[0], hit[1])); });
            if (split >= 0) {
                var at = split;
                while ((at = text.indexOf('<Subsystem>', at)) >= 0) {
                    var end = text.indexOf('</Subsystem>', at + 11);
                    if (end < 0) break;
                    out.push(text.slice(at, end + 12));
                    at = end + 12;
                }
            }
            return out.join('\n');
        },
        /* A role's Ext/Rights.xml: one line per `<object>` that has a right
         * set to true, `<object name>\t<right>[*],<right>...`, where `*` marks
         * a right restricted by a condition (RLS). Objects with no granted
         * right are left out. A text with no markup is already a summary:
         * the page filters the host's answer again, so the rule is idempotent. */
        'rights-summary': function (text) {
            if (text.indexOf('<') < 0) return text;
            var out = [];
            var at = 0;
            while ((at = text.indexOf('<object>', at)) >= 0) {
                var end = text.indexOf('</object>', at + 8);
                if (end < 0) break;
                var block = text.slice(at + 8, end);
                at = end + 9;
                var nameStart = block.indexOf('<name>');
                var nameEnd = nameStart < 0 ? -1 : block.indexOf('</name>', nameStart + 6);
                if (nameEnd < 0) continue;
                var rights = [];
                var r = nameEnd;
                while ((r = block.indexOf('<right>', r)) >= 0) {
                    var rEnd = block.indexOf('</right>', r + 7);
                    if (rEnd < 0) break;
                    var right = block.slice(r + 7, rEnd);
                    r = rEnd + 8;
                    if (right.indexOf('<value>true</value>') < 0) continue;
                    var rn = right.indexOf('<name>');
                    var rne = rn < 0 ? -1 : right.indexOf('</name>', rn + 6);
                    if (rne < 0) continue;
                    rights.push(right.slice(rn + 6, rne) + (right.indexOf('<restrictionByCondition>') >= 0 ? '*' : ''));
                }
                if (rights.length) out.push(block.slice(nameStart + 6, nameEnd) + '\t' + rights.join(','));
            }
            return out.join('\n');
        },
        /* An object descriptor: every `<Command ...>...</Command>` element. */
        'command-blocks': function (text) {
            var out = [];
            var start = /<command(?![A-Za-z0-9_])/gi;
            var end = /<\/command>/gi;
            var match;
            while ((match = start.exec(text))) {
                var open = text.indexOf('>', match.index + 8);
                if (open < 0) break;
                end.lastIndex = open + 1;
                var close = end.exec(text);
                if (!close) break;
                out.push(text.slice(match.index, close.index + 10));
                start.lastIndex = close.index + 10;
            }
            return out.join('\n');
        }
    };

    function filterText(text, filter) {
        return filter && TEXT_FILTERS[filter] ? TEXT_FILTERS[filter](String(text)) : text;
    }

    function nextTask(callback) {
        if (typeof setImmediate === 'function') return setImmediate(callback);
        if (typeof MessageChannel === 'function') {
            var channel = new MessageChannel();
            channel.port1.onmessage = function () { channel.port1.close(); callback(); };
            return channel.port2.postMessage(0);
        }
        return setTimeout(callback, 0);
    }

    /* Collects the single lookups issued during one turn of the event loop and
     * sends them as batches. Resolver passes start their lookups from many
     * nested awaits, so the flush waits for a macrotask, after every microtask
     * of the turn has queued its request. */
    function createBatcher(io) {
        var batching = typeof io.existsMany === 'function' && typeof io.readMany === 'function';
        var queues = {};
        var scheduled = false;
        var pendingBatches = [];
        var runningBatches = 0;

        function drain() {
            while (runningBatches < BATCH_REQUEST_CONCURRENCY && pendingBatches.length) {
                (function (batch) {
                    runningBatches++;
                    Promise.resolve().then(function () { return batch.send(batch.paths); })
                        .then(function (values) {
                            batch.items.forEach(function (item, index) {
                                item.resolve(values && index < values.length ? values[index] : null);
                            });
                        }, function (error) {
                            batch.items.forEach(function (item) { item.reject(error); });
                        }).then(function () { runningBatches--; drain(); });
                })(pendingBatches.shift());
            }
        }

        function flush() {
            scheduled = false;
            var pending = queues;
            queues = {};
            Object.keys(pending).forEach(function (key) {
                var queue = pending[key];
                for (var start = 0; start < queue.items.length; start += BATCH_PATHS) {
                    var chunk = queue.items.slice(start, start + BATCH_PATHS);
                    pendingBatches.push({ send: queue.send, items: chunk,
                        paths: chunk.map(function (item) { return item.path; }) });
                }
            });
            drain();
        }

        function enqueue(key, send, filePath) {
            return new Promise(function (resolve, reject) {
                var queue = queues[key] || (queues[key] = { send: send, items: [] });
                queue.items.push({ path: filePath, resolve: resolve, reject: reject });
                if (!scheduled) { scheduled = true; nextTask(flush); }
            });
        }

        return {
            batching: batching,
            exists: function (filePath) {
                if (!batching) return io.exists(filePath);
                return enqueue('exists', function (paths) { return io.existsMany(paths); }, filePath)
                    .then(function (value) { return !!value; });
            },
            read: function (filePath, limit, filter) {
                if (!batching) return io.readBytes(filePath, limit);
                return enqueue('read:' + limit + ':' + (filter || ''), function (paths) {
                    return io.readMany(paths, limit, filter || '');
                }, filePath);
            },
            stat: typeof io.statMany === 'function' ? function (filePath) {
                return enqueue('stat', function (paths) { return io.statMany(paths); }, filePath);
            } : null
        };
    }

    function mapLimit(items, limit, worker) {
        return new Promise(function (resolve, reject) {
            var results = new Array(items.length);
            var next = 0;
            var active = 0;
            var failed = false;
            if (!items.length) return resolve(results);
            function pump() {
                while (!failed && active < limit && next < items.length) {
                    active++;
                    (function (index) {
                        Promise.resolve().then(function () { return worker(items[index], index); })
                            .then(function (value) {
                                results[index] = value;
                                active--;
                                if (!failed && next >= items.length && active === 0) resolve(results);
                                else pump();
                            }, function (error) { failed = true; reject(error); });
                    })(next++);
                }
            }
            pump();
        });
    }

    /* ------------------------------------------------------------ paths */

    function sepOf(p) {
        return String(p).indexOf('\\') >= 0 ? '\\' : '/';
    }

    function trimTrailing(p) {
        var s = String(p);
        while (s.length > 1 && /[\\/]$/.test(s) && !/^[A-Za-z]:[\\/]$/.test(s)) s = s.slice(0, -1);
        return s;
    }

    function dirname(p) {
        var s = trimTrailing(p);
        var i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
        if (i < 0) return '';
        if (i === 0) return s.charAt(0);
        if (/^[A-Za-z]:$/.test(s.slice(0, i))) return s.slice(0, i + 1);
        return s.slice(0, i);
    }

    function basename(p) {
        var s = trimTrailing(p);
        var i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
        return i < 0 ? s : s.slice(i + 1);
    }

    function extname(p) {
        var name = basename(p);
        var i = name.lastIndexOf('.');
        return i <= 0 ? '' : name.slice(i);
    }

    function stem(p) {
        var name = basename(p);
        var ext = extname(name);
        return ext ? name.slice(0, -ext.length) : name;
    }

    function join(base) {
        var sep = sepOf(base);
        var out = trimTrailing(base);
        for (var i = 1; i < arguments.length; i++) {
            var part = String(arguments[i]);
            if (!part) continue;
            out += (/[\\/]$/.test(out) ? '' : sep) + part;
        }
        return out;
    }

    function samePath(a, b) {
        var left = trimTrailing(a).replace(/\//g, '\\');
        var right = trimTrailing(b).replace(/\//g, '\\');
        return sepOf(a) === '\\' || sepOf(b) === '\\'
            ? left.toLowerCase() === right.toLowerCase() : left === right;
    }

    function ancestors(filePath) {
        var out = [];
        var directory = dirname(filePath);
        while (directory && directory !== dirname(directory)) {
            out.push(directory);
            directory = dirname(directory);
        }
        return out;
    }

    function badName(name) {
        return !name || /[\\/:*?"<>|]/.test(name);
    }

    /* ---------------------------------------------------------- decoding */

    /* 1C writes exports in whichever encoding the configuration was saved with.
     * BOMs are authoritative; without one, valid UTF-8 is UTF-8 and everything
     * else is Windows-1251, which is what the 1C designer produces on Russian
     * locales. */
    function decodeText(bytes) {
        if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
            return { content: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf8-bom' };
        }
        if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
            return { content: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf16le' };
        }
        if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
            var body = bytes.subarray(2);
            var swapped = new Uint8Array(body.length - (body.length % 2));
            for (var i = 0; i < swapped.length; i += 2) {
                swapped[i] = body[i + 1];
                swapped[i + 1] = body[i];
            }
            return { content: new TextDecoder('utf-16le').decode(swapped), encoding: 'utf16be' };
        }
        try {
            return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8' };
        } catch (error) {
            return { content: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251' };
        }
    }

    function bytesToBase64(bytes) {
        var chunks = [];
        for (var i = 0; i < bytes.length; i += 0x8000)
            chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
        return btoa(chunks.join(''));
    }

    /* ------------------------------------------------ export layout rules */

    /* `Forms/ФормаСписка.xml` is the form's descriptor; the layout renderers
     * want is `Forms/ФормаСписка/Ext/Form.xml`. */
    function formLayoutFor(filePath) {
        if (extname(filePath).toLowerCase() !== '.xml') return '';
        var directory = dirname(filePath);
        if (basename(directory).toLowerCase() !== 'forms') return '';
        var name = stem(filePath);
        if (!name) return '';
        return join(directory, name, 'Ext', 'Form.xml');
    }

    /* In the dump the renderer layout and the form metadata are siblings:
     *   Forms/Card/Ext/Form.xml  ->  Forms/Card.xml
     * Interface compatibility belongs to the descriptor, not to Form.xml. */
    function formDescriptorFor(formPath) {
        if (!/^form\.(?:xml|form)$/i.test(basename(formPath))) return '';
        var extDir = dirname(formPath);
        if (basename(extDir).toLowerCase() !== 'ext') return '';
        var formDir = dirname(extDir);
        var formsDir = dirname(formDir);
        var owner = basename(formsDir).toLowerCase();
        if (owner !== 'forms' && owner !== 'commonforms') return '';
        var name = basename(formDir);
        return name ? join(formsDir, name + '.xml') : '';
    }

    /* Only `<Object>/Forms/<Form>/Ext/Form.xml` has an owning object
     * descriptor; 1C puts it beside or inside the object directory. */
    function objectMetaCandidates(formPath) {
        if (!/^form\.(?:xml|form)$/i.test(basename(formPath))) return [];
        var extDir = dirname(formPath);
        if (basename(extDir).toLowerCase() !== 'ext') return [];
        var formsDir = dirname(dirname(extDir));
        if (basename(formsDir).toLowerCase() !== 'forms') return [];
        var objectDir = dirname(formsDir);
        var objectName = basename(objectDir);
        if (!objectName) return [];
        return [join(dirname(objectDir), objectName + '.xml'), join(objectDir, objectName + '.xml')];
    }

    var MAIN_OBJECT_DIRS = {
        CatalogObject: 'Catalogs', DocumentObject: 'Documents', TaskObject: 'Tasks',
        BusinessProcessObject: 'BusinessProcesses', ChartOfAccountsObject: 'ChartsOfAccounts',
        ChartOfCharacteristicTypesObject: 'ChartsOfCharacteristicTypes',
        ChartOfCalculationTypesObject: 'ChartsOfCalculationTypes', ExchangePlanObject: 'ExchangePlans',
        DataProcessorObject: 'DataProcessors', ReportObject: 'Reports',
        InformationRegisterRecordManager: 'InformationRegisters'
    };
    function mainAttributeObjectCandidates(formPath, formXml) {
        var match = String(formXml || '').match(
            /<v8:Type>cfg:(\w+)\.([^<\s]+)<\/v8:Type>\s*<\/Type>\s*<MainAttribute>true<\/MainAttribute>/)
            /* Without a main attribute an «Объект» of an object type still
             * binds Объект.* paths (a CatalogObject attribute in a
             * SettingsStorage form). */
            || String(formXml || '').match(
                /<Attribute name="(?:Объект|Object)"[^>]*>(?:\s*<Title>[\s\S]*?<\/Title>)?\s*<Type>\s*<v8:Type>cfg:(\w+Object)\.([^<\s]+)<\/v8:Type>\s*<\/Type>/);
        if (!match || !MAIN_OBJECT_DIRS[match[1]]) return [];
        var own = objectMetaCandidates(formPath);
        if (!own.length) return [];
        var objectDir = dirname(own[1]);
        var kindDir = dirname(objectDir);
        if (basename(kindDir) === MAIN_OBJECT_DIRS[match[1]] && basename(objectDir) === match[2]) return [];
        var cfRoot = dirname(kindDir);
        return [join(cfRoot, MAIN_OBJECT_DIRS[match[1]], match[2] + '.xml'),
            join(cfRoot, MAIN_OBJECT_DIRS[match[1]], match[2], match[2] + '.xml')];
    }

    /* An extension serializes an adopted object as a stub: synonyms, types,
     * FillChecking and every inherited attribute stay in the configuration
     * descriptor. Only the object-level ObjectBelonging (before ChildObjects)
     * says so. */
    function isAdoptedDescriptor(xml) {
        var head = String(xml || '').split('<ChildObjects>')[0];
        return /<ObjectBelonging>\s*Adopted\s*<\/ObjectBelonging>/.test(head);
    }

    /* The configuration descriptor plus the attributes and tabular sections
     * the extension itself added (children without ObjectBelonging=Adopted). */
    function withOwnExtensionChildren(configuredXml, extensionXml) {
        var body = String(extensionXml).split('<ChildObjects>')[1];
        if (!body) return configuredXml;
        body = body.split('</ChildObjects>').slice(0, -1).join('</ChildObjects>');
        var own = [];
        var re = /<(Attribute|TabularSection)\b[^>]*>[\s\S]*?<\/\1>/g;
        var match;
        while ((match = re.exec(body))) {
            if (!/<ObjectBelonging>\s*Adopted\s*<\/ObjectBelonging>/.test(match[0])) own.push(match[0]);
        }
        var close = configuredXml.lastIndexOf('</ChildObjects>');
        if (!own.length || close < 0) return configuredXml;
        return configuredXml.slice(0, close) + own.join('\n') + configuredXml.slice(close);
    }

    /* An extension's Configuration.xml names its purpose; a configuration's
     * never does. */
    function isExtensionConfiguration(xml) {
        return /<ConfigurationExtensionPurpose>/.test(String(xml || ''));
    }

    /* <from>/<relative> -> <to>/<relative>; '' when filePath is not below from. */
    function rebase(filePath, from, to) {
        var path = String(filePath);
        var prefix = trimTrailing(from);
        if (!to || path.length <= prefix.length || !/[\\/]/.test(path.charAt(prefix.length))) return '';
        if (!samePath(path.slice(0, prefix.length), prefix)) return '';
        var rest = path.slice(prefix.length + 1).split(/[\\/]/);
        return join.apply(null, [to].concat(rest));
    }

    /* The historical layout, used when the host cannot list directories:
     * <root>/cfe/<extension>/<object path>/... -> <root>/cf/<object path>/... */
    function baseFormCandidate(formPath) {
        var sep = sepOf(formPath);
        var parts = String(formPath).split(/[\\/]/);
        var cfe = -1;
        for (var i = 0; i < parts.length; i++) {
            if (parts[i].toLowerCase() === 'cfe') { cfe = i; break; }
        }
        if (cfe < 0 || cfe + 2 >= parts.length) return '';
        var next = parts.slice();
        next.splice(cfe, 2, 'cf');
        return next.join(sep);
    }

    function referencedNames(xml, prefix) {
        var out = [];
        var seen = {};
        var re = new RegExp(prefix + '\\.([^\\s<>,"\']+)', 'gi');
        var match;
        var text = String(xml || '');
        while ((match = re.exec(text))) {
            var name = match[1];
            if (badName(name)) continue;
            var key = name.toLowerCase();
            if (!seen[key]) { seen[key] = true; out.push(name); }
        }
        return out;
    }

    function standardCommandOwners(xml) {
        var out = [];
        var seen = {};
        var re = /<CommandName>(\w+)\.([^.<\s]+)\.StandardCommand\.\w+<\/CommandName>/g;
        var match;
        var text = String(xml || '');
        while ((match = re.exec(text))) {
            if (!OBJECT_DIRECTORIES[match[1]] || badName(match[2])) continue;
            var key = (match[1] + '.' + match[2]).toLowerCase();
            if (!seen[key]) { seen[key] = true; out.push({ kind: match[1], name: match[2] }); }
        }
        return out;
    }

    /* The tables a dynamic list reads: its MainTable and every
     * `<Kind>.<Name>` of its QueryText (written in Russian or English). A
     * list column without a Title is captioned by the source field's
     * presentation, so those descriptors are loaded as refMeta
     * `<Kind>.<Name>`. */
    var QUERY_SOURCE_KINDS = {
        Catalog: 'Catalog', 'Справочник': 'Catalog', Document: 'Document', 'Документ': 'Document',
        DocumentJournal: 'DocumentJournal', 'ЖурналДокументов': 'DocumentJournal',
        ChartOfCharacteristicTypes: 'ChartOfCharacteristicTypes', 'ПланВидовХарактеристик': 'ChartOfCharacteristicTypes',
        ChartOfAccounts: 'ChartOfAccounts', 'ПланСчетов': 'ChartOfAccounts',
        ChartOfCalculationTypes: 'ChartOfCalculationTypes', 'ПланВидовРасчета': 'ChartOfCalculationTypes',
        InformationRegister: 'InformationRegister', 'РегистрСведений': 'InformationRegister',
        AccumulationRegister: 'AccumulationRegister', 'РегистрНакопления': 'AccumulationRegister',
        AccountingRegister: 'AccountingRegister', 'РегистрБухгалтерии': 'AccountingRegister',
        CalculationRegister: 'CalculationRegister', 'РегистрРасчета': 'CalculationRegister',
        BusinessProcess: 'BusinessProcess', 'БизнесПроцесс': 'BusinessProcess',
        Task: 'Task', 'Задача': 'Task', ExchangePlan: 'ExchangePlan', 'ПланОбмена': 'ExchangePlan',
        FilterCriterion: 'FilterCriterion', 'КритерийОтбора': 'FilterCriterion'
    };
    var QUERY_SOURCE_DIRECTORIES = {
        Catalog: 'Catalogs', Document: 'Documents', DocumentJournal: 'DocumentJournals',
        ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes', ChartOfAccounts: 'ChartsOfAccounts',
        ChartOfCalculationTypes: 'ChartsOfCalculationTypes', InformationRegister: 'InformationRegisters',
        AccumulationRegister: 'AccumulationRegisters', AccountingRegister: 'AccountingRegisters',
        CalculationRegister: 'CalculationRegisters', BusinessProcess: 'BusinessProcesses', Task: 'Tasks',
        ExchangePlan: 'ExchangePlans', FilterCriterion: 'FilterCriteria'
    };
    var QUERY_SOURCE_LIMIT = 24;

    function dynamicListSources(xml) {
        var out = [];
        var seen = {};
        function add(kindWord, name) {
            var kind = QUERY_SOURCE_KINDS[kindWord];
            if (!kind || badName(name) || out.length >= QUERY_SOURCE_LIMIT) return;
            var key = (kind + '.' + name).toLowerCase();
            if (!seen[key]) { seen[key] = true; out.push({ kind: kind, name: name }); }
        }
        var text = String(xml || '');
        var ident = '[A-Za-z\\u0410-\\u044F\\u0401\\u0451_][A-Za-z0-9\\u0410-\\u044F\\u0401\\u0451_]*';
        var match;
        var mainRe = new RegExp('<MainTable>\\s*(' + ident + ')\\.(' + ident + ')', 'g');
        while ((match = mainRe.exec(text))) add(match[1], match[2]);
        var queryRe = /<QueryText>([\s\S]*?)<\/QueryText>/g;
        var sourceRe = new RegExp('(?:^|[^.A-Za-z0-9\\u0410-\\u044F\\u0401\\u0451_])(' + ident + ')\\.(' + ident + ')', 'g');
        while ((match = queryRe.exec(text))) {
            var query = match[1];
            var source;
            sourceRe.lastIndex = 0;
            while ((source = sourceRe.exec(query))) {
                if (Object.prototype.hasOwnProperty.call(QUERY_SOURCE_KINDS, source[1])) add(source[1], source[2]);
            }
        }
        return out;
    }

    function referencedCommonCommands(xml) { return referencedNames(xml, 'CommonCommand'); }
    function referencedCommonPictures(xml) { return referencedNames(xml, 'CommonPicture'); }
    function referencedCatalogs(xml) { return referencedNames(xml, 'CatalogRef'); }

    /* Real configurations write the style prefix in either case. */
    function referencedStyleItems(xml) {
        var out = [];
        var seen = {};
        var re = /\bstyle:([^\s<>,"']+)/gi;
        var match;
        var text = String(xml || '');
        while ((match = re.exec(text))) {
            var name = match[1];
            var key = name.toLowerCase();
            if (!seen[key]) { seen[key] = true; out.push(name); }
        }
        return out;
    }

    function candidatesUpwards(sources, relative) {
        var out = [];
        var seen = {};
        sources.forEach(function (source) {
            if (!source) return;
            ancestors(source).forEach(function (directory) {
                var candidate = join.apply(null, [directory].concat(relative));
                var key = candidate.toLowerCase();
                if (!seen[key]) { seen[key] = true; out.push(candidate); }
            });
        });
        return out;
    }

    /* basePath is formPath in the configuration its extension extends; it
     * defaults to the cf/cfe layout. */
    function basePathOf(formPath, basePath) {
        return basePath === undefined ? baseFormCandidate(formPath) : basePath;
    }

    function commonCommandCandidates(formPath, name, basePath) {
        if (badName(name)) return [];
        return candidatesUpwards([formPath, basePathOf(formPath, basePath)], ['CommonCommands', name + '.xml']);
    }

    function catalogMetaCandidates(formPath, name, basePath) {
        if (badName(name)) return [];
        return candidatesUpwards([formPath, basePathOf(formPath, basePath)], ['Catalogs', name + '.xml'])
            .concat(candidatesUpwards([formPath], ['Catalogs', name, name + '.mdo']));
    }

    function commonPictureDescriptorCandidates(formPath, name, basePath) {
        if (badName(name)) return [];
        return candidatesUpwards([formPath, basePathOf(formPath, basePath)],
            ['CommonPictures', name, 'Ext', 'Picture.xml']);
    }

    function styleItemCandidates(formPath, name) {
        if (badName(name)) return [];
        return candidatesUpwards([formPath], ['StyleItems', name + '.xml'])
            .concat(candidatesUpwards([formPath], ['StyleItems', name, name + '.mdo']));
    }

    var PICTURE_MIME = {
        '.png': 'image/png', '.zip': 'application/zip', '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'
    };

    function pictureMime(name) {
        return PICTURE_MIME[extname(name).toLowerCase()] || '';
    }

    function pictureResourceName(xml) {
        var match = String(xml || '').match(/<(?:xr:)?Abs>([^<]+)<\/(?:xr:)?Abs>/i);
        var name = match ? match[1].trim() : '';
        return name && !badName(name) && pictureMime(name) ? name : '';
    }

    /* A picture authored on a form item itself (not a CommonPicture) is
     * exported beside the layout as Ext/Form/Items/<item>/<Picture.png>, and
     * the item's <Picture> (HeaderPicture, ValuesPicture, RowsPicture) names
     * that file through xr:Abs. Owner names come from a tag stack, so a
     * picture is never attributed to an enclosing group or to the
     * ContextMenu/ExtendedTooltip siblings that also carry a name. */
    var ITEM_PICTURE_KEY_PREFIX = '@item:';

    function referencedItemPictures(xml) {
        var out = [];
        var seen = {};
        var stack = [];
        var re = /<(?:xr:)?Abs>([^<]+)<\/(?:xr:)?Abs>|<(\/?)([A-Za-z][\w.:-]*)([^>]*?)(\/?)>/g;
        var match;
        var text = String(xml || '');
        var pictureTag = '';
        while ((match = re.exec(text))) {
            if (match[1] != null) {
                var file = match[1].trim();
                var owner = stack.length >= 2 ? stack[stack.length - 2] : null;
                if (!pictureTag || !owner || !owner.name || badName(owner.name)
                    || badName(file) || !pictureMime(file)) continue;
                var key = ITEM_PICTURE_KEY_PREFIX + owner.name + '/' + file;
                if (!seen[key.toLowerCase()]) { seen[key.toLowerCase()] = true; out.push({ key: key, item: owner.name, file: file }); }
                continue;
            }
            var local = match[3].replace(/^.*:/, '');
            if (match[2]) {
                stack.pop();
                if (/^(?:Picture|HeaderPicture|ValuesPicture|RowsPicture)$/.test(local)) pictureTag = '';
                continue;
            }
            if (match[5]) continue;
            var nameMatch = match[4].match(/(?:^|\s)name\s*=\s*"([^"]*)"/);
            stack.push({ tag: local, name: nameMatch ? nameMatch[1] : '' });
            if (/^(?:Picture|HeaderPicture|ValuesPicture|RowsPicture)$/.test(local)) pictureTag = local;
        }
        return out;
    }

    function styleItemValue(xml) {
        var text = String(xml || '');
        var match = text.match(/<Value\b[^>]*>([^<]*)<\/Value>/);
        if (match) return match[1].trim();
        var valueStart = text.indexOf('<Value');
        var valueEnd = text.indexOf('</Value>', valueStart);
        if (valueStart >= 0 && valueEnd > valueStart) {
            var value = text.slice(valueStart, valueEnd);
            if (/<(?:v8:)?ColorDef\b|<(?:red|green|blue)>/i.test(value)) {
                function channel(name) {
                    var found = value.match(new RegExp('<' + name + '>\\s*(\\d+)\\s*</' + name + '>', 'i'));
                    return found ? Math.max(0, Math.min(255, Number(found[1]))) : 0;
                }
                return 'rgb(' + channel('red') + ', ' + channel('green') + ', ' + channel('blue') + ')';
            }
        }
        return '';
    }

    function isSupportedExtension(filePath) {
        return SUPPORTED_EXTENSIONS.indexOf(extname(filePath).toLowerCase()) >= 0;
    }

    /* The root form command bar receives applicable global commands unless its
     * Autofill is off; an authored Form-sourced CommandBar/ButtonGroup is an
     * explicit insertion point even inside an autofill-false bar. A
     * self-closing root bar must not run on to a later table bar's
     * Autofill=false. */
    function supportsAutomaticFormCommands(formXml) {
        var xml = String(formXml || '');
        var rootBar = (xml.match(
            /<AutoCommandBar\b(?=[^>]*(?:\bid\s*=\s*["']-1["']|\bname\s*=\s*["']ФормаКоманднаяПанель["']))(?:[^>]*?\/>|[^>]*>[\s\S]*?<\/AutoCommandBar>)/i
        ) || xml.match(
            /<AutoCommandBar\b[^>]*>[\s\S]*?<(?:Id>\s*-1|Name>\s*ФормаКоманднаяПанель)(?:\s*<)/i
        ) || xml.match(
            /<AutoCommandBar\s*\/>/i
        ) || [''])[0];
        if (rootBar && !/<Autofill>\s*false\s*<\/Autofill>/i.test(rootBar)) return true;
        var insertionPoints = xml.match(/<(?:CommandBar|ButtonGroup)\b[^>]*>[\s\S]*?<\/(?:CommandBar|ButtonGroup)>/gi) || [];
        return insertionPoints.some(function (item) {
            return /<CommandSource>\s*Form\s*<\/CommandSource>/i.test(item)
                && !/<Autofill>\s*false\s*<\/Autofill>/i.test(item);
        });
    }

    function objectCommandTypes(objectMeta) {
        var match = String(objectMeta || '').match(
            /<(Document|Catalog|BusinessProcess|Task|ChartOfAccounts|ChartOfCalculationTypes|ChartOfCharacteristicTypes|ExchangePlan)\b[\s\S]*?<Properties>[\s\S]*?<Name>([^<]+)<\/Name>/i);
        if (!match) return [];
        var prefix = { document: 'Document', catalog: 'Catalog', businessprocess: 'BusinessProcess', task: 'Task',
            chartofaccounts: 'ChartOfAccounts', chartofcalculationtypes: 'ChartOfCalculationTypes',
            chartofcharacteristictypes: 'ChartOfCharacteristicTypes', exchangeplan: 'ExchangePlan' };
        var head = prefix[match[1].toLowerCase()];
        return [head + 'Ref.' + match[2], head + 'Object.' + match[2]];
    }

    function parameterTypes(xml) {
        var out = [];
        var re = /<(?:v8:)?(?:Type|TypeSet)>(?:cfg:)?([^<]+)<\/(?:v8:)?(?:Type|TypeSet)>/gi;
        var match;
        while ((match = re.exec(String(xml || '')))) out.push(match[1].trim());
        return out;
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /* NTFS enumerates a directory in upper-cased ordinal order. Catalogs come
     * from an index now, but the command order they produce must stay the one
     * every host has rendered so far. */
    function directoryOrder(a, b) {
        var left = a.toUpperCase();
        var right = b.toUpperCase();
        return left < right ? -1 : left > right ? 1 : 0;
    }

    var OBJECT_DIRECTORIES = {
        Catalog: 'Catalogs', Document: 'Documents', DataProcessor: 'DataProcessors', Report: 'Reports',
        BusinessProcess: 'BusinessProcesses', Task: 'Tasks', InformationRegister: 'InformationRegisters',
        AccumulationRegister: 'AccumulationRegisters', AccountingRegister: 'AccountingRegisters',
        CalculationRegister: 'CalculationRegisters', ChartOfAccounts: 'ChartsOfAccounts',
        ChartOfCalculationTypes: 'ChartsOfCalculationTypes', ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes',
        ExchangePlan: 'ExchangePlans'
    };

    /* --------------------------------------------------------- resolver */

    function createResolver(io, options) {
        options = options || {};
        var maxBytes = options.maxBytes > 0 ? options.maxBytes : 64 * 1024 * 1024;
        var batcher = createBatcher(io);
        var concurrency = options.concurrency > 0 ? options.concurrency
            : batcher.batching ? BATCH_CONCURRENCY : DEFAULT_CONCURRENCY;
        function parallel(items, worker) { return mapLimit(items, concurrency, worker); }
        var cache = options.cache || {};
        cache.index = cache.index || {};
        cache.text = cache.text || {};
        cache.catalog = cache.catalog || {};
        cache.properties = cache.properties || {};
        cache.bases = cache.bases || {};

        async function readText(filePath, limit, filter) {
            var bytes = await batcher.read(filePath, limit || maxBytes, filter);
            return bytes ? filterText(decodeText(bytes).content, filter) : null;
        }

        async function cachedText(filePath) {
            var key = filePath.toLowerCase();
            if (!Object.prototype.hasOwnProperty.call(cache.text, key))
                cache.text[key] = readText(filePath).catch(function () { return null; });
            return cache.text[key];
        }

        async function projectedMdo(filePath) {
            var source = await cachedText(filePath);
            if (source == null || !root.ProjMetadataConverter) return null;
            var converted = root.ProjMetadataConverter.convert(source);
            return converted && converted.ok ? converted.xml : null;
        }

        async function projConfigurationRoot(formPath) {
            var directories = ancestors(formPath);
            var candidates = directories.map(function (directory) {
                return join(directory, 'Configuration', 'Configuration.mdo');
            });
            var found = await parallel(candidates, function (candidate) { return batcher.exists(candidate); });
            for (var i = 0; i < found.length; i++) if (found[i]) return directories[i];
            return '';
        }

        async function loadProjGlobalCommands(configurationRoot, formXml, objectMeta, result) {
            if (!/FormCommandPanelGlobalCommands/i.test(formXml) && !supportsAutomaticFormCommands(formXml)) return;
            if (!/<MainAttribute>\s*true\s*<\/MainAttribute>/i.test(formXml) && !/<BaseForm[\s>]/i.test(formXml)) return;
            var ownerTypes = objectCommandTypes(objectMeta);
            if (!ownerTypes.length) return;
            var configuration = await projectedMdo(join(configurationRoot, 'Configuration', 'Configuration.mdo'));
            if (!configuration) return;
            var names = [], match, nameRe = /<CommonCommand>([^<]+)<\/CommonCommand>/gi;
            while ((match = nameRe.exec(configuration))) names.push(match[1].trim());
            names = names.filter(Boolean).sort(directoryOrder);
            var paths = names.map(function (name) {
                return join(configurationRoot, 'CommonCommands', name, name + '.mdo');
            });
            var commandSources = await parallel(paths, function (file) { return cachedText(file); });
            var commands = [], groupNames = {};
            commandSources.forEach(function (source, i) {
                if (!source) return;
                var group = (source.match(/<group>\s*([^<]+)\s*<\/group>/i) || [])[1] || '';
                var groupRef = group.match(/^CommandGroup\.(.+)$/i);
                if (groupRef) groupNames[groupRef[1]] = true;
                commands.push({ name: names[i], source: source, group: group,
                    groupName: groupRef ? groupRef[1] : '',
                    types: ((source.match(/<commandParameterType\b[^>]*>([\s\S]*?)<\/commandParameterType>/i) || ['', ''])[1]
                        .match(/<types>\s*([^<]+)\s*<\/types>/gi) || [])
                        .map(function (item) { return item.replace(/<\/?types>/gi, '').trim(); }) });
            });
            var groupList = Object.keys(groupNames);
            var groupSources = await parallel(groupList, function (name) {
                return cachedText(join(configurationRoot, 'CommandGroups', name, name + '.mdo'));
            });
            var groups = {};
            groupSources.forEach(function (source, i) {
                if (source && /<category>\s*FormCommandBar\s*<\/category>/i.test(source))
                    groups[groupList[i]] = source;
            });
            var definedNames = {};
            commands.forEach(function (command) {
                command.types.forEach(function (type) {
                    var defined = type.match(/^DefinedType\.(.+)$/i);
                    if (defined) definedNames[defined[1]] = true;
                });
            });
            var definedList = Object.keys(definedNames);
            var definedSources = await parallel(definedList, function (name) {
                return cachedText(join(configurationRoot, 'DefinedTypes', name, name + '.mdo'));
            });
            var definedTypes = {};
            definedSources.forEach(function (source, i) {
                var types = source && source.match(/<types>\s*([^<]+)\s*<\/types>/gi) || [];
                definedTypes[definedList[i]] = types.map(function (item) {
                    return item.replace(/<\/?types>/gi, '').trim();
                });
            });
            function applies(types) {
                return types.some(function (type) {
                    if (ownerTypes.indexOf(type) >= 0 || /^(AnyRef|AnyObject)$/i.test(type)) return true;
                    var defined = type.match(/^DefinedType\.(.+)$/i);
                    return !!defined && (definedTypes[defined[1]] || []).some(function (member) {
                        return ownerTypes.indexOf(member) >= 0 || /^(AnyRef|AnyObject)$/i.test(member);
                    });
                });
            }
            commands.forEach(function (command) {
                var groupMatch = /^CommandGroup\./i.test(command.group);
                var formGroup = /^FormCommandBar/i.test(command.group)
                    || (groupMatch && Object.prototype.hasOwnProperty.call(groups, command.groupName));
                if (!formGroup || !applies(command.types)) return;
                var projected = root.ProjMetadataConverter.convert(command.source);
                if (!projected || !projected.ok) return;
                result['@global:' + command.name] = projected.xml;
                if (command.groupName && groups[command.groupName]) {
                    var projectedGroup = root.ProjMetadataConverter.convert(groups[command.groupName]);
                    if (projectedGroup && projectedGroup.ok) result['@group:' + command.groupName] = projectedGroup.xml;
                }
            });
        }

        /* Candidate lists are the few ancestor directories of the form, so
         * probing them together costs one round trip instead of a chain. */
        async function firstExisting(candidates) {
            var found = await parallel(candidates, function (candidate) { return batcher.exists(candidate); });
            for (var i = 0; i < found.length; i++) if (found[i]) return candidates[i];
            return '';
        }

        /* A missing or denied file reads back as null, so the exists check
         * that used to precede every read was only a second round trip. */
        async function loadObjectMeta(formPath, formXml, toBase) {
            var candidates = objectMetaCandidates(formPath).filter(function (candidate) {
                return !samePath(candidate, formPath);
            });
            /* A form may edit another object than its owner (a task form kept
             * in a business process): the main attribute type decides. */
            var foreign = mainAttributeObjectCandidates(formPath, formXml);
            if (foreign.length) {
                var foreignPath = await firstExisting(foreign);
                if (foreignPath) candidates = [foreignPath].concat(candidates);
            }
            var texts = await parallel(candidates, function (candidate) { return cachedText(candidate); });
            for (var i = 0; i < texts.length; i++) {
                if (texts[i] == null || texts[i].indexOf(OBJECT_META_MARKER) < 0) continue;
                if (isAdoptedDescriptor(texts[i])) {
                    var configured = toBase(candidates[i]);
                    var configuredText = configured ? await cachedText(configured) : null;
                    if (configuredText != null && configuredText.indexOf(OBJECT_META_MARKER) >= 0)
                        texts[i] = withOwnExtensionChildren(configuredText, texts[i]);
                }
                /* Both descriptor layouts share <object>/Ext/Help.xml; the
                 * inner candidate always sits in the object directory. */
                var objectDir = dirname(candidates[candidates.length - 1]);
                /* The form's own help counts too: Forms/<form>/Ext/Help.xml
                 * paints «?». */
                var helps = await Promise.all([batcher.exists(join(objectDir, 'Ext', 'Help.xml')),
                    batcher.exists(join(dirname(formPath), 'Help.xml'))]);
                var hasHelp = helps[0] || helps[1];
                return hasHelp ? texts[i] + '\n' + OBJECT_HELP_MARKER : texts[i];
            }
            return '';
        }

        async function loadInterfaceMode(formPath, toBase) {
            var descriptor = formDescriptorFor(formPath);
            if (!descriptor) return 'Any';
            var text = await cachedText(descriptor);
            if (text == null) {
                var configured = toBase(descriptor);
                text = configured ? await cachedText(configured) : null;
            }
            var match = String(text || '').match(
                /<UseInInterfaceCompatibilityMode>\s*([^<\s]+)\s*<\/UseInInterfaceCompatibilityMode>/i);
            return match ? match[1] : 'Any';
        }

        /* The configuration's own InterfaceCompatibilityMode: the same 8.5 form
         * is painted differently under TaxiEnableVersion8_5 and Version8_5. */
        async function loadConfigInterfaceMode(formPath) {
            var root = await configurationRoot(formPath).catch(function () { return null; });
            if (!root) return '';
            var text = await configurationProperties(root.directory);
            var match = String(text || '').match(
                /<InterfaceCompatibilityMode>\s*([^<\s]+)\s*<\/InterfaceCompatibilityMode>/i);
            return match ? match[1] : '';
        }

        async function loadRefMeta(formPath, formXml, objectMeta, toBase) {
            var result = {};
            var definedNames = referencedNames(formXml + '\n' + (objectMeta || ''), 'DefinedType')
                .filter(function (name) { return !badName(name); });
            var definedTexts = await parallel(definedNames, async function (name) {
                var found = await firstExisting(candidatesUpwards([formPath, basePathOf(formPath, toBase(formPath))],
                    ['DefinedTypes', name + '.xml']));
                return found ? await cachedText(found) : null;
            });
            var definedSource = '';
            for (var d = 0; d < definedNames.length; d++) {
                if (definedTexts[d] == null || definedTexts[d].indexOf(OBJECT_META_MARKER) < 0) continue;
                result['DefinedType.' + definedNames[d]] = definedTexts[d];
                definedSource += '\n' + definedTexts[d];
            }
            var names = referencedCatalogs(formXml + '\n' + (objectMeta || '') + definedSource);
            var contents = await parallel(names, async function (name) {
                var candidates = catalogMetaCandidates(formPath, name, toBase(formPath));
                var found = await firstExisting(candidates);
                var text = found ? await cachedText(found) : null;
                /* An extension's adopted catalog is a stub: DescriptionLength
                 * and synonyms stay in the configuration (a 10-char catalog
                 * is 10 chars wide, not the 15-char default). */
                if (text != null && isAdoptedDescriptor(text)) {
                    var rest = candidates.slice(candidates.indexOf(found) + 1);
                    var configured = await firstExisting(rest);
                    var configuredText = configured ? await cachedText(configured) : null;
                    if (configuredText != null && configuredText.indexOf(OBJECT_META_MARKER) >= 0
                        && !isAdoptedDescriptor(configuredText))
                        text = withOwnExtensionChildren(configuredText, text);
                }
                return text;
            });
            for (var n = 0; n < names.length; n++) {
                if (contents[n] != null && contents[n].indexOf(OBJECT_META_MARKER) >= 0)
                    result[names[n]] = contents[n];
            }
            /* `<Kind>.<Name>.StandardCommand.X` buttons are captioned by that
             * object's list presentation / synonym. */
            var owners = standardCommandOwners(formXml);
            var ownerTexts = await parallel(owners, async function (owner) {
                var found = await firstExisting(candidatesUpwards([formPath, toBase(formPath)],
                    [OBJECT_DIRECTORIES[owner.kind], owner.name + '.xml']));
                return found ? await cachedText(found) : null;
            });
            for (var o = 0; o < owners.length; o++) {
                if (ownerTexts[o] != null && ownerTexts[o].indexOf(OBJECT_META_MARKER) >= 0)
                    result[owners[o].kind + '.' + owners[o].name] = ownerTexts[o];
            }
            var sources = dynamicListSources(formXml).filter(function (source) {
                return !Object.prototype.hasOwnProperty.call(result, source.kind + '.' + source.name);
            });
            var sourceTexts = await parallel(sources, async function (source) {
                var candidates = candidatesUpwards([formPath, toBase(formPath)],
                    [QUERY_SOURCE_DIRECTORIES[source.kind], source.name + '.xml']);
                var found = await firstExisting(candidates);
                var text = found ? await cachedText(found) : null;
                if (text != null && isAdoptedDescriptor(text)) {
                    var configured = await firstExisting(candidates.slice(candidates.indexOf(found) + 1));
                    var configuredText = configured ? await cachedText(configured) : null;
                    if (configuredText != null && configuredText.indexOf(OBJECT_META_MARKER) >= 0
                        && !isAdoptedDescriptor(configuredText))
                        text = withOwnExtensionChildren(configuredText, text);
                }
                return text;
            });
            for (var q = 0; q < sources.length; q++) {
                if (sourceTexts[q] != null && sourceTexts[q].indexOf(OBJECT_META_MARKER) >= 0)
                    result[sources[q].kind + '.' + sources[q].name] = sourceTexts[q];
            }
            return result;
        }

        async function loadBaseForm(formPath, toBase) {
            var candidate = toBase(formPath);
            if (!candidate || samePath(candidate, formPath)) return '';
            return (await readText(candidate)) || '';
        }

        async function resolveProj(formPath, formXml) {
            var objectDirectory = dirname(dirname(dirname(formPath)));
            var objectName = basename(objectDirectory);
            var metadataPath = objectName ? join(objectDirectory, objectName + '.mdo') : '';
            var basePath = join(dirname(formPath), 'BaseForm', 'Form.form');
            var sources = await Promise.all([
                metadataPath ? cachedText(metadataPath) : Promise.resolve(null),
                cachedText(basePath), projConfigurationRoot(formPath)
            ]);
            var objectMeta = '';
            var baseForm = '';
            if (sources[0] != null && root.ProjMetadataConverter) {
                var metadata = root.ProjMetadataConverter.convert(sources[0]);
                if (metadata && metadata.ok) objectMeta = metadata.xml;
            }
            if (sources[1] != null && root.ProjFormConverter) {
                var base = root.ProjFormConverter.convert(sources[1]);
                if (base && base.ok) baseForm = base.xml;
            }
            var configurationRoot = sources[2] || '';
            var projectedForm = formXml || '';
            if (root.ProjFormConverter) {
                var convertedForm = projectedForm ? root.ProjFormConverter.convert(projectedForm) : null;
                if (!projectedForm) {
                    var ownForm = await cachedText(formPath);
                    convertedForm = ownForm == null ? null : root.ProjFormConverter.convert(ownForm);
                }
                if (convertedForm && convertedForm.ok) projectedForm = convertedForm.xml;
            }
            var refMeta = {}, commonCommands = {}, commonPictures = {}, styleItems = {};
            if (configurationRoot) {
                var catalogNames = referencedCatalogs(projectedForm + '\n' + objectMeta);
                var catalogTexts = await parallel(catalogNames, function (name) {
                    return projectedMdo(join(configurationRoot, 'Catalogs', name, name + '.mdo'));
                });
                catalogNames.forEach(function (name, i) { if (catalogTexts[i]) refMeta[name] = catalogTexts[i]; });
                var commandNames = referencedCommonCommands(projectedForm);
                var commandTexts = await parallel(commandNames, function (name) {
                    return projectedMdo(join(configurationRoot, 'CommonCommands', name, name + '.mdo'));
                });
                commandNames.forEach(function (name, i) { if (commandTexts[i]) commonCommands[name] = commandTexts[i]; });
                await loadProjGlobalCommands(configurationRoot, projectedForm, objectMeta, commonCommands);
                var styleNames = referencedStyleItems(projectedForm);
                var styleTexts = await parallel(styleNames, function (name) {
                    return projectedMdo(join(configurationRoot, 'StyleItems', name, name + '.mdo'));
                });
                styleNames.forEach(function (name, i) {
                    var value = styleTexts[i] ? styleItemValue(styleTexts[i]) : '';
                    if (value) styleItems[name] = value;
                });
                var pictureNames = referencedCommonPictures(projectedForm);
                var pictureExtensions = ['png', 'svg', 'gif', 'jpg', 'jpeg', 'bmp'];
                var pictureData = await parallel(pictureNames.slice(0, PICTURE_COUNT_LIMIT), async function (name) {
                    for (var e = 0; e < pictureExtensions.length; e++) {
                        var extension = pictureExtensions[e];
                        var resourcePath = join(configurationRoot, 'CommonPictures', name, 'Picture.' + extension);
                        var bytes = await batcher.read(resourcePath, Math.min(maxBytes, PICTURE_BYTES_LIMIT));
                        if (bytes) return { mime: PICTURE_MIME['.' + extension], data: bytesToBase64(bytes) };
                    }
                    return null;
                });
                pictureNames.slice(0, PICTURE_COUNT_LIMIT).forEach(function (name, i) {
                    if (pictureData[i]) commonPictures[name] = pictureData[i];
                });
            }
            var mode = (String(projectedForm).match(/<UseInInterfaceCompatibilityMode>\s*([^<\s]+)\s*</i) || [])[1] || 'Any';
            return {
                baseForm: baseForm,
                objectMeta: objectMeta,
                interfaceMode: mode,
                refMeta: refMeta,
                commonCommands: commonCommands,
                commonPictures: commonPictures,
                styleItems: styleItems
            };
        }

        async function loadStyleItems(formPath, formXml) {
            var names = referencedStyleItems(formXml);
            var values = await parallel(names, async function (name) {
                var found = await firstExisting(styleItemCandidates(formPath, name));
                if (!found) return '';
                var content = await cachedText(found);
                return content == null ? '' : styleItemValue(content);
            });
            var result = {};
            for (var n = 0; n < names.length; n++) if (values[n]) result[names[n]] = values[n];
            return result;
        }

        /* The configuration root owns the metadata index. Designer dumps keep
         * ConfigDumpInfo.xml there; Configuration.xml is the index of an export
         * written without it. Every ancestor is checked in one batch; the
         * nearest one wins, and the dump wins inside one directory. */
        async function configurationRoot(formPath) {
            var directories = ancestors(formPath);
            for (var i = 0; i < directories.length; i++) {
                var known = cache.index[directories[i].toLowerCase()];
                if (known) return known;
            }
            var probes = [];
            directories.forEach(function (directory) {
                probes.push(join(directory, 'ConfigDumpInfo.xml'), join(directory, 'Configuration.xml'));
            });
            var found = await parallel(probes, function (probe) { return batcher.exists(probe); });
            for (var p = 0; p < probes.length; p++) {
                if (!found[p]) continue;
                var root = { directory: directories[p >> 1], indexFile: probes[p], dump: p % 2 === 0 };
                cache.index[root.directory.toLowerCase()] = root;
                return root;
            }
            return null;
        }

        async function readIndex(root) {
            var directory = root.directory;
            var index = { directory: directory, commonCommands: [], commandGroups: [], objectCommands: {} };
            var match;
            if (root.dump) {
                var dump = (await readText(root.indexFile, Infinity, 'command-metadata')) || '';
                var re = /<Metadata\s+name="([^"]+)"/g;
                while ((match = re.exec(dump))) {
                    var parts = match[1].split('.');
                    if (parts.length === 2 && parts[0] === 'CommonCommand') index.commonCommands.push(parts[1]);
                    else if (parts.length === 2 && parts[0] === 'CommandGroup') index.commandGroups.push(parts[1]);
                    else if (parts.length === 4 && parts[2] === 'Command' && OBJECT_DIRECTORIES[parts[0]]) {
                        var file = join(directory, OBJECT_DIRECTORIES[parts[0]], parts[1] + '.xml');
                        var list = index.objectCommands[file] || (index.objectCommands[file] = []);
                        list.push({ name: parts[3], fqn: match[1] });
                    }
                }
            } else {
                var configuration = (await readText(root.indexFile)) || '';
                var tags = /<(CommonCommand|CommandGroup)>([^<]+)<\/\1>/g;
                while ((match = tags.exec(configuration))) {
                    (match[1] === 'CommonCommand' ? index.commonCommands : index.commandGroups).push(match[2].trim());
                }
            }
            index.commonCommands.sort(directoryOrder);
            index.commandGroups.sort(directoryOrder);
            return index;
        }

        async function definedTypeContains(directory, name, ownerTypes) {
            var content = await cachedText(join(directory, 'DefinedTypes', name + '.xml'));
            if (!content) return false;
            var members = parameterTypes(content);
            return ownerTypes.some(function (type) { return members.indexOf(type) >= 0; });
        }

        async function applicable(types, directory, ownerTypes) {
            if (types.some(function (type) {
                return ownerTypes.indexOf(type) >= 0 || /^(AnyRef|AnyObject)$/i.test(type);
            })) return true;
            for (var i = 0; i < types.length; i++) {
                var defined = types[i].match(/^DefinedType\.(.+)$/i);
                if (defined && await definedTypeContains(directory, defined[1], ownerTypes)) return true;
            }
            return false;
        }

        /* Everything about the configuration's form-command-bar commands that
         * does not depend on the form: which common commands and object
         * commands land in a form bar, their descriptors, parameter types and
         * groups. On a large configuration this is thousands of files, so it is
         * built once per configuration root and, when the host offers a store,
         * kept on disk together with the stamp of every file it was built from.
         * A stamp that moved - including the index itself, which changes when
         * a command is added or removed - rebuilds it. */
        async function buildCatalog(root) {
            var index = await readIndex(root);
            var directory = index.directory;
            var deps = [root.indexFile];
            var groupFiles = index.commandGroups.map(function (name) {
                return join(directory, 'CommandGroups', name + '.xml');
            });
            var commandFiles = index.commonCommands.map(function (name) {
                return join(directory, 'CommonCommands', name + '.xml');
            });
            var objectFiles = Object.keys(index.objectCommands);
            deps = deps.concat(groupFiles, commandFiles, objectFiles);
            /* Stamps are taken before the reads: a file edited in between
             * leaves a stale stamp and simply rebuilds next time. */
            var stamps = batcher.stat
                ? await parallel(deps, function (dep) { return batcher.stat(dep); }) : null;
            var texts = await Promise.all([
                parallel(groupFiles, function (file) { return readText(file); }),
                parallel(commandFiles, function (file) { return readText(file); }),
                parallel(objectFiles, function (file) { return readText(file, 0, 'command-blocks'); })
            ]);

            var catalog = { groups: {}, common: [], objects: [] };
            for (var g = 0; g < index.commandGroups.length; g++) {
                if (texts[0][g] && /<Category>FormCommandBar<\/Category>/i.test(texts[0][g]))
                    catalog.groups[index.commandGroups[g]] = texts[0][g];
            }
            for (var c = 0; c < index.commonCommands.length; c++) {
                var commandText = texts[1][c];
                if (commandText == null) continue;
                var group = (commandText.match(/<Group>([^<]+)<\/Group>/i) || [])[1] || '';
                var groupMatch = group.match(/^CommandGroup\.(.+)$/i);
                var formGroup = /^FormCommandBar/i.test(group)
                    || (groupMatch && Object.prototype.hasOwnProperty.call(catalog.groups, groupMatch[1]));
                if (!formGroup) continue;
                catalog.common.push({
                    name: index.commonCommands[c], group: groupMatch ? groupMatch[1] : '',
                    types: parameterTypes(commandText), text: commandText
                });
            }
            for (var f = 0; f < objectFiles.length; f++) {
                var content = texts[2][f];
                if (!content) continue;
                var blocks = content.match(/<Command\b[^>]*>[\s\S]*?<\/Command>/gi) || [];
                index.objectCommands[objectFiles[f]].forEach(function (command) {
                    var nameRe = new RegExp('<Name>\\s*' + escapeRegExp(command.name) + '\\s*</Name>', 'i');
                    var block = blocks.filter(function (value) { return nameRe.test(value); })[0];
                    if (!block) return;
                    var blockGroup = (block.match(/<Group>([^<]+)<\/Group>/i) || [])[1] || '';
                    /* [CMD-GROUP-OBJECTS] An object command may join a FormCommandBar
                     * CommandGroup (such as «Настройки»). */
                    var blockGroupMatch = blockGroup.match(/^CommandGroup\.(.+)$/i);
                    if (!/^FormCommandBar/i.test(blockGroup) && !(blockGroupMatch
                        && Object.prototype.hasOwnProperty.call(catalog.groups, blockGroupMatch[1]))) return;
                    catalog.objects.push({
                        fqn: command.fqn, group: blockGroupMatch ? blockGroupMatch[1] : '',
                        sourceFileIndex: f, sourceOrder: blocks.indexOf(block),
                        types: parameterTypes(block),
                        content: '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" '
                            + 'xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" '
                            + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' + block + '</MetaDataObject>'
                    });
                });
            }
            /* Dump index order is alphabetical, but command groups in the
             * designer follow their declaration order inside the metadata
             * object (synchronization before exchange contents before tools). */
            catalog.objects.sort(function (a, b) {
                return a.sourceFileIndex - b.sourceFileIndex || a.sourceOrder - b.sourceOrder;
            });
            if (stamps) catalog.deps = deps.map(function (dep, i) { return [dep, stamps[i]]; });
            return catalog;
        }

        async function storedCatalog(root) {
            if (!batcher.stat || typeof io.cacheGet !== 'function') return null;
            var text = await Promise.resolve(io.cacheGet(root.directory, CATALOG_CACHE_KEY)).catch(function () { return null; });
            if (!text) return null;
            var catalog;
            try { catalog = JSON.parse(text); } catch (error) { return null; }
            if (!catalog || !Array.isArray(catalog.deps) || !catalog.deps.length
                || !samePath(catalog.deps[0][0], root.indexFile)) return null;
            var stamps = await parallel(catalog.deps, function (dep) { return batcher.stat(dep[0]); });
            for (var i = 0; i < stamps.length; i++) {
                if (stamps[i] !== catalog.deps[i][1]) return null;
            }
            return catalog;
        }

        function commandCatalog(root) {
            var key = root.directory.toLowerCase();
            if (!cache.catalog[key]) {
                cache.catalog[key] = (async function () {
                    var stored = await storedCatalog(root);
                    if (stored) return stored;
                    var catalog = await buildCatalog(root);
                    if (catalog.deps && typeof io.cachePut === 'function') {
                        await Promise.resolve(io.cachePut(root.directory, CATALOG_CACHE_KEY, JSON.stringify(catalog)))
                            .catch(function () {});
                    }
                    return catalog;
                })();
                cache.catalog[key].catch(function () { delete cache.catalog[key]; });
            }
            return cache.catalog[key];
        }

        async function loadCommonCommands(formPath, formXml, objectMeta, toBase) {
            var result = {};
            var names = referencedCommonCommands(formXml);
            var referenced = await parallel(names, async function (name) {
                var found = await firstExisting(commonCommandCandidates(formPath, name, toBase(formPath)));
                return found ? await cachedText(found) : null;
            });
            for (var n = 0; n < names.length; n++) {
                if (referenced[n] != null && referenced[n].indexOf('CommonCommand') >= 0)
                    result[names[n]] = referenced[n];
            }
            /* A button bound to another object's command (Report.X.Command.Y)
             * takes its title from that command's synonym.
             * Loaded before the automatic-command gates so every form gets it;
             * '@fqn:' entries precede '@global-fqn:' ones. */
            var objectRefs = [];
            var refRe = /<CommandName>\s*(\w+)\.([^.<\s]+)\.Command\.([^.<\s]+)\s*<\/CommandName>/g, rm;
            while ((rm = refRe.exec(String(formXml || '')))) {
                if (OBJECT_DIRECTORIES[rm[1]]) objectRefs.push({ kind: rm[1], owner: rm[2], name: rm[3], fqn: rm[0].replace(/<\/?CommandName>|\s/g, '') });
            }
            var refRoot = objectRefs.length ? await configurationRoot(formPath) : null;
            if (refRoot) {
                var refTexts = await parallel(objectRefs, function (ref) {
                    return readText(join(refRoot.directory, OBJECT_DIRECTORIES[ref.kind], ref.owner + '.xml'), 0, 'command-blocks');
                });
                for (var rr = 0; rr < objectRefs.length; rr++) {
                    var nameRe = new RegExp('<Name>\\s*' + escapeRegExp(objectRefs[rr].name) + '\\s*</Name>', 'i');
                    var refBlock = ((refTexts[rr] || '').match(/<Command\b[^>]*>[\s\S]*?<\/Command>/gi) || []).filter(function (b) { return nameRe.test(b); })[0];
                    if (refBlock) result['@fqn:' + objectRefs[rr].fqn] = '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' + refBlock + '</MetaDataObject>';
                }
            }
            if (!/FormCommandPanelGlobalCommands/i.test(formXml) && !supportsAutomaticFormCommands(formXml)) return result;
            if (!/<MainAttribute>\s*true\s*<\/MainAttribute>/i.test(formXml) && !/<BaseForm[\s>]/i.test(formXml)) return result;
            var ownerTypes = objectCommandTypes(objectMeta);
            if (!ownerTypes.length) return result;
            var root = await configurationRoot(formPath);
            if (!root) return result;
            var directory = root.directory;
            var catalog = await commandCatalog(root);
            /* A form-authored CommandInterface can place its own Form.Command
             * entries in a reusable group even when no automatically applicable
             * object command belongs to that group. Load its presentation too. */
            var authoredGroupRe = /<CommandGroup>\s*CommandGroup\.([^<\s]+)\s*<\/CommandGroup>/gi;
            var authoredGroupMatch;
            while ((authoredGroupMatch = authoredGroupRe.exec(formXml))) {
                var authoredGroupName = authoredGroupMatch[1];
                if (catalog.groups[authoredGroupName])
                    result['@group:' + authoredGroupName] = catalog.groups[authoredGroupName];
            }

            /* Decided in index order so the resulting command order stays the
             * published one. */
            var common = await parallel(catalog.common, function (command) {
                return applicable(command.types, directory, ownerTypes);
            });
            for (var c = 0; c < catalog.common.length; c++) {
                if (!common[c]) continue;
                var command = catalog.common[c];
                result['@global:' + command.name] = command.text;
                if (command.group && catalog.groups[command.group])
                    result['@group:' + command.group] = catalog.groups[command.group];
            }
            var ciBar = (String(formXml || '').match(/<CommandInterface>[\s\S]*?<CommandBar>([\s\S]*?)<\/CommandBar>/i) || [])[1] || '';
            var ciItems = ciBar.match(/<Item>[\s\S]*?<\/Item>/gi) || [];
            var moved = [];
            ciItems.forEach(function (item) {
                var cm = item.match(/<Command>\s*CommonCommand\.([^<\s]+)\s*<\/Command>/i);
                var gm = item.match(/<CommandGroup>\s*(FormCommandBar[^<\s]*)\s*<\/CommandGroup>/i);
                if (!cm || !gm || /CreateBasedOn/i.test(gm[1]) || result['@global:' + cm[1]]) return;
                if (result[cm[1]] != null) moved.push(cm[1]);
            });
            var movedApplicable = await parallel(moved, function (name) {
                return applicable(parameterTypes(result[name]), directory, ownerTypes);
            });
            for (var mv = 0; mv < moved.length; mv++)
                if (movedApplicable[mv]) result['@global:' + moved[mv]] = result[moved[mv]];
            var objects = await parallel(catalog.objects, function (object) {
                return applicable(object.types, directory, ownerTypes);
            });
            for (var o = 0; o < catalog.objects.length; o++) {
                /* [CMD-GROUP-OBJECTS] Grouped object commands bring their group popup. */
                if (!objects[o]) continue;
                var object = catalog.objects[o];
                /* Exchange-plan forms suppress their own grouped commands.
                 * Catalog object forms can show their own applicable command
                 * groups in the root bar. */
                var normalizedFormPath = String(formPath || '').split('\\').join('/');
                var ownerFolder = normalizedFormPath.match(/\/([^\/]+)\/Forms\//);
                if (object.group && /\/ExchangePlans\//i.test(normalizedFormPath) && ownerFolder
                    && String(object.fqn).split('.')[1] === ownerFolder[1]) continue;
                result['@global-fqn:' + object.fqn] = object.content;
                if (object.group && catalog.groups[object.group])
                    result['@group:' + object.group] = catalog.groups[object.group];
            }
            return result;
        }

        /* Pictures are fetched together, but the byte budget is still spent
         * in reference order, so which pictures a capped context carries does
         * not depend on which read finished first. */
        async function loadCommonPictures(formPath, sourceXml, formXml, toBase) {
            var names = referencedCommonPictures(sourceXml).slice(0, PICTURE_COUNT_LIMIT);
            var loaded = await parallel(names, async function (name) {
                var descriptors = commonPictureDescriptorCandidates(formPath, name, toBase(formPath));
                var texts = await parallel(descriptors, function (descriptor) { return cachedText(descriptor); });
                for (var d = 0; d < descriptors.length; d++) {
                    if (texts[d] == null) continue;
                    var resourceName = pictureResourceName(texts[d]);
                    if (!resourceName) return null;
                    var resource = join(dirname(descriptors[d]), 'Picture', resourceName);
                    var bytes = await batcher.read(resource, Math.min(maxBytes, PICTURE_BYTES_LIMIT));
                    if (!bytes) continue;
                    return { resourceName: resourceName, bytes: bytes };
                }
                return null;
            });
            var result = {};
            var totalBytes = 0;
            for (var n = 0; n < names.length; n++) {
                var picture = loaded[n];
                if (!picture) continue;
                if (totalBytes + picture.bytes.length > maxBytes) break;
                totalBytes += picture.bytes.length;
                result[names[n]] = {
                    mime: pictureMime(picture.resourceName),
                    data: bytesToBase64(picture.bytes)
                };
            }
            /* Item pictures share the map under a key no CommonPicture name
             * can take, so every host passes them through unchanged. */
            var itemPictures = referencedItemPictures(formXml)
                .slice(0, Math.max(0, PICTURE_COUNT_LIMIT - names.length));
            var itemBytes = await parallel(itemPictures, function (picture) {
                return batcher.read(join(dirname(formPath), 'Form', 'Items', picture.item, picture.file),
                    Math.min(maxBytes, PICTURE_BYTES_LIMIT));
            });
            for (var i = 0; i < itemPictures.length; i++) {
                var bytes = itemBytes[i];
                if (!bytes) continue;
                if (totalBytes + bytes.length > maxBytes) break;
                totalBytes += bytes.length;
                result[itemPictures[i].key] = { mime: pictureMime(itemPictures[i].file), data: bytesToBase64(bytes) };
            }
            return result;
        }

        async function configurationProperties(directory) {
            var file = join(directory, 'Configuration.xml');
            var key = file.toLowerCase();
            if (!Object.prototype.hasOwnProperty.call(cache.properties, key)) {
                cache.properties[key] = readText(file, maxBytes, 'configuration-properties')
                    .catch(function () { return null; });
            }
            return cache.properties[key];
        }

        /* The configurations an extension root may extend, nearest first. The
         * cf/cfe layout needs no listing; everything else comes from a host
         * that can list directories. */
        function baseRoots(extensionRoot) {
            var key = extensionRoot.toLowerCase();
            if (!Object.prototype.hasOwnProperty.call(cache.bases, key)) {
                cache.bases[key] = (async function () {
                    var out = [];
                    var parent = dirname(extensionRoot);
                    if (basename(parent).toLowerCase() === 'cfe') out.push(join(dirname(parent), 'cf'));
                    if (typeof io.baseConfigurations === 'function') {
                        var listed = await Promise.resolve(io.baseConfigurations(extensionRoot))
                            .catch(function () { return []; });
                        (Array.isArray(listed) ? listed : []).forEach(function (directory) {
                            if (typeof directory !== 'string' || !directory || samePath(directory, extensionRoot)) return;
                            if (!out.some(function (known) { return samePath(known, directory); })) out.push(directory);
                        });
                    }
                    var checked = await parallel(out, async function (directory) {
                        var properties = await configurationProperties(directory);
                        return properties != null && !isExtensionConfiguration(properties);
                    });
                    return out.filter(function (directory, i) { return checked[i]; });
                })();
            }
            return cache.bases[key];
        }

        /* Maps a path of the form's extension to the same path in the
         * configuration it extends ('' when there is none). Of several
         * configurations the first that has this form or its owner wins. */
        async function baseMapping(formPath) {
            var root = await configurationRoot(formPath);
            var properties = root ? await configurationProperties(root.directory) : null;
            if (properties == null || !isExtensionConfiguration(properties)) return baseFormCandidate;
            var extensionRoot = root.directory;
            var roots = await baseRoots(extensionRoot);
            if (!roots.length) return baseFormCandidate;
            var chosen = roots[0];
            if (roots.length > 1) {
                var files = [formPath].concat(objectMetaCandidates(formPath));
                var found = await parallel(roots, function (directory) {
                    return firstExisting(files.map(function (file) { return rebase(file, extensionRoot, directory); }));
                });
                for (var i = 0; i < found.length; i++) if (found[i]) { chosen = roots[i]; break; }
            }
            return function (filePath) { return rebase(filePath, extensionRoot, chosen); };
        }

        /* formPath must already be the resolved layout path the host allowed. */
        async function resolve(formPath, formXml) {
            var empty = { baseForm: '', objectMeta: '', interfaceMode: 'Any', refMeta: {}, commonCommands: {}, commonPictures: {}, styleItems: {} };
            var extension = extname(formPath).toLowerCase();
            if (extension === '.form') return resolveProj(formPath, formXml);
            if (extension !== '.xml') return empty;
            /* Only the picture pass truly depends on the commands (their
             * descriptors reference pictures too); everything else can run
             * alongside instead of after. */
            var toBase = await baseMapping(formPath);
            var head = await Promise.all([loadBaseForm(formPath, toBase), loadObjectMeta(formPath, formXml, toBase),
                loadInterfaceMode(formPath, toBase), loadConfigInterfaceMode(formPath)]);
            var baseForm = head[0];
            var objectMeta = head[1];
            var formSource = formXml + '\n' + baseForm;
            var body = await Promise.all([
                loadCommonCommands(formPath, formSource, objectMeta, toBase),
                loadRefMeta(formPath, formSource, objectMeta, toBase),
                loadStyleItems(formPath, formXml)
            ]);
            var commonCommands = body[0];
            var pictureSources = [formXml, baseForm].concat(Object.keys(commonCommands).map(function (key) {
                return commonCommands[key];
            })).join('\n');
            return {
                baseForm: baseForm,
                objectMeta: objectMeta,
                interfaceMode: head[2],
                configInterfaceMode: head[3],
                refMeta: body[1],
                commonCommands: commonCommands,
                commonPictures: await loadCommonPictures(formPath, pictureSources, formXml, toBase),
                styleItems: body[2]
            };
        }

        return { resolve: resolve };
    }

    /* ------------------------------------------------- http host adapter */

    /* The io of a page whose host serves the configuration over HTTP: BSLEdit
     * and the Total Commander viewer (WebView2 WebResourceRequested) and the
     * native MCP server (loopback). `fileUrl?p=<path>[&exists=1]` answers
     * single lookups; `batchUrl` takes a POST whose UTF-8 text body is
     *
     *   exists\n<path>\n<path>...           -> "0"/"1" per path
     *   stat\n<path>...                     -> one "size:mtime" or empty line per path
     *   read\n<limit>\n<filter>\n<path>...  -> per path an int32 LE length (-1 when
     *                                          absent) followed by that many bytes;
     *                                          limit 0 means unlimited
     *   cache-get\n<directory>\n<key>       -> 200 with the text, or 404
     *   cache-put\n<directory>\n<key>\n<text>
     *   base-configurations\n<extension root> -> one directory per line; a host
     *                                          without the verb only loses this lookup
     *   module-files\n<configuration root> -> one absolute *Module.bsl path per line
     *   search-files\n<categories>\n<scopes>\n<configuration root>
     *                                      -> selected searchable source files;
     *                                         categories/scopes are comma-separated
     *   search-object-files\n<categories>\n<object directory>
     *                                      -> searchable files below one object
     *
     * A host without the batch endpoint answers it with 404 or 405; the adapter
     * then falls back to single lookups for the rest of the page's life. */
    function createHttpIo(fileUrl, batchUrl) {
        var batchBroken = !batchUrl;

        function single(filePath, existsOnly) {
            return fetch(fileUrl + '?p=' + encodeURIComponent(filePath) + (existsOnly ? '&exists=1' : ''),
                { cache: 'no-store' });
        }

        var singles = {
            exists: function (filePath) {
                return single(filePath, true)
                    .then(function (response) { return response.ok ? response.text() : '0'; })
                    .then(function (text) { return text === '1'; }, function () { return false; });
            },
            readBytes: function (filePath, limit) {
                return single(filePath, false).then(function (response) {
                    if (!response.ok) return null;
                    return response.arrayBuffer().then(function (buffer) {
                        return buffer.byteLength > limit ? null : new Uint8Array(buffer);
                    });
                }).catch(function () { return null; });
            }
        };

        /* Directory/list verbs: one root in, a line per path out, an empty
         * list when the host does not implement the verb. */
        function directoryList(verb, directory) {
            return post([verb, directory]).then(function (response) {
                return response ? response.text() : '';
            }).then(function (text) {
                return String(text || '').split('\n').filter(function (line) { return !!line; });
            }, function () { return []; });
        }

        /* Unlike optional base/extension discovery, module search cannot
         * honestly turn an unsupported native verb into an empty result: that
         * looks exactly like a completed search over zero files. */
        function requiredDirectoryList(verb, directory) {
            return post([verb, directory]).then(function (response) {
                if (!response) throw new Error('Запущенный BSLEdit не поддерживает поиск по модулям. Пересоберите или обновите приложение.');
                return response.text();
            }).then(function (text) {
                return String(text || '').split('\n').filter(function (line) { return !!line; });
            });
        }

        function post(lines) {
            if (batchBroken) return Promise.resolve(null);
            return fetch(batchUrl, {
                method: 'POST', cache: 'no-store',
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: lines.join('\n')
            }).then(function (response) {
                if (response.status === 404 && lines[0] === 'cache-get') return null;
                if (!response.ok && (/-configurations$/.test(lines[0]) || lines[0] === 'module-files'
                        || lines[0] === 'search-files' || lines[0] === 'search-object-files')) return null;
                if (!response.ok) { batchBroken = true; return null; }
                return response;
            });
        }

        var io = {
            exists: singles.exists,
            readBytes: singles.readBytes,
            existsMany: function (paths) {
                return post(['exists'].concat(paths)).then(function (response) {
                    if (!response) return Promise.all(paths.map(singles.exists));
                    return response.text().then(function (text) {
                        return paths.map(function (p, i) { return text.charAt(i) === '1'; });
                    });
                });
            },
            readMany: function (paths, limit, filter) {
                var wire = isFinite(limit) && limit > 0 ? String(Math.floor(limit)) : '0';
                return post(['read', wire, filter || ''].concat(paths)).then(function (response) {
                    if (!response) {
                        return Promise.all(paths.map(function (p) { return singles.readBytes(p, limit); }));
                    }
                    return response.arrayBuffer().then(function (buffer) {
                        var view = new DataView(buffer);
                        var out = [];
                        var at = 0;
                        for (var i = 0; i < paths.length; i++) {
                            if (at + 4 > buffer.byteLength) { out.push(null); continue; }
                            var length = view.getInt32(at, true);
                            at += 4;
                            if (length < 0) { out.push(null); continue; }
                            out.push(new Uint8Array(buffer, at, length));
                            at += length;
                        }
                        return out;
                    });
                });
            },
            statMany: function (paths) {
                return post(['stat'].concat(paths)).then(function (response) {
                    if (!response) return paths.map(function () { return null; });
                    return response.text().then(function (text) {
                        var lines = text.split('\n');
                        return paths.map(function (p, i) { return lines[i] ? lines[i] : null; });
                    });
                });
            },
            baseConfigurations: function (extensionRoot) {
                return directoryList('base-configurations', extensionRoot);
            },
            extensionConfigurations: function (configurationRoot) {
                return directoryList('extension-configurations', configurationRoot);
            },
            moduleFiles: function (configurationRoot) {
                return requiredDirectoryList('module-files', configurationRoot);
            },
            searchFiles: function (configurationRoot, categories, scopes) {
                return post(['search-files', (categories || []).join(','), (scopes || []).join(','), configurationRoot])
                    .then(function (response) {
                        if (!response) throw new Error('Запущенный BSLEdit не поддерживает глобальный поиск. Пересоберите или обновите приложение.');
                        return response.text();
                    }).then(function (text) {
                        return String(text || '').split('\n').filter(function (line) { return !!line; });
                    });
            },
            searchObjectFiles: function (objectDirectory, categories) {
                return post(['search-object-files', (categories || []).join(','), objectDirectory])
                    .then(function (response) {
                        if (!response) throw new Error('Запущенный BSLEdit не поддерживает поиск по объекту. Пересоберите или обновите приложение.');
                        return response.text();
                    }).then(function (text) {
                        return String(text || '').split('\n').filter(function (line) { return !!line; });
                    });
            },
            cacheGet: function (directory, key) {
                return post(['cache-get', directory, key]).then(function (response) {
                    return response ? response.text() : null;
                }).catch(function () { return null; });
            },
            cachePut: function (directory, key, text) {
                return post(['cache-put', directory, key, text]).then(function () {}, function () {});
            }
        };
        return io;
    }

    var api = {
        OBJECT_META_MARKER: OBJECT_META_MARKER,
        SUPPORTED_EXTENSIONS: SUPPORTED_EXTENSIONS,
        TEXT_FILTERS: Object.keys(TEXT_FILTERS),
        filterText: filterText,
        createHttpIo: createHttpIo,
        createResolver: createResolver,
        resolve: function (formPath, formXml, io, options) {
            return createResolver(io, options).resolve(formPath, formXml);
        },
        decodeText: decodeText,
        filterText: filterText,
        formLayoutFor: formLayoutFor,
        formDescriptorFor: formDescriptorFor,
        objectMetaCandidates: objectMetaCandidates,
        baseFormCandidate: baseFormCandidate,
        referencedCommonCommands: referencedCommonCommands,
        referencedCommonPictures: referencedCommonPictures,
        referencedCatalogs: referencedCatalogs,
        referencedStyleItems: referencedStyleItems,
        isExtensionConfiguration: isExtensionConfiguration,
        rebase: rebase,
        commonCommandCandidates: commonCommandCandidates,
        catalogMetaCandidates: catalogMetaCandidates,
        commonPictureDescriptorCandidates: commonPictureDescriptorCandidates,
        styleItemCandidates: styleItemCandidates,
        pictureResourceName: pictureResourceName,
        pictureMime: pictureMime,
        referencedItemPictures: referencedItemPictures,
        ITEM_PICTURE_KEY_PREFIX: ITEM_PICTURE_KEY_PREFIX,
        styleItemValue: styleItemValue,
        isSupportedExtension: isSupportedExtension,
        supportsAutomaticFormCommands: supportsAutomaticFormCommands,
        _test: { dirname: dirname, basename: basename, join: join, samePath: samePath,
            createBatcher: createBatcher, mainAttributeObjectCandidates: mainAttributeObjectCandidates }
    };

    root.FormContext = api;
    if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
