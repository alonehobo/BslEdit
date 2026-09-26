#ifndef BSLCOMMON_H
#define BSLCOMMON_H

#include <windows.h>
#include <map>
#include <string>
#include <vector>

enum TextEncoding {
    ENC_UTF8_BOM,
    ENC_UTF8,
    ENC_UTF16LE,
    ENC_UTF16BE,
    ENC_ANSI      // system OEM/ANSI fallback, in practice Windows-1251 for 1C sources
};

// Identity of the exact byte sequence returned by ReadTextFile.  Besides the
// ordinary filesystem metadata it contains a content hash, so an external
// edit that preserves the length is still detected before an editor save.
struct FileRevision {
    bool      valid;
    DWORD     volumeSerial;
    DWORD     fileIndexHigh;
    DWORD     fileIndexLow;
    DWORD     sizeHigh;
    DWORD     sizeLow;
    FILETIME  lastWriteTime;
    ULONGLONG contentHash;

    FileRevision()
        : valid(false), volumeSerial(0), fileIndexHigh(0), fileIndexLow(0),
          sizeHigh(0), sizeLow(0), lastWriteTime{}, contentHash(0) {}
};

struct TextFile {
    std::wstring text;
    TextEncoding encoding;
    FileRevision revision;
    bool         ok;
    TextFile() : encoding(ENC_UTF8_BOM), ok(false) {}
};

// Reads a file and decodes it, remembering the encoding so that a later save
// can write the file back the way it was found.
TextFile ReadTextFile(const wchar_t* path, DWORD maxBytes);

// Decodes a block of bytes the way ReadTextFile decodes a file: BOM first,
// then valid UTF-8, then Windows-1251. `encoding` may be NULL. Used for
// content that never was a file of its own - a blob read out of a git
// object, for instance.
std::wstring DecodeTextBytes(const void* bytes, size_t size, TextEncoding* encoding);

// Writes text back using the encoding reported by ReadTextFile.
bool WriteTextFile(const wchar_t* path, const std::wstring& text, TextEncoding encoding);

enum TextFileWriteResult {
    TEXT_FILE_WRITE_OK,
    TEXT_FILE_WRITE_IO_ERROR,
    TEXT_FILE_WRITE_CONFLICT
};

// Writes through a temporary file in the destination directory, flushes it,
// and atomically replaces the destination.  When expectedRevision is supplied,
// replacement is refused if the destination changed since it was read.
TextFileWriteResult WriteTextFileIfUnchanged(
    const wchar_t* path,
    const std::wstring& text,
    TextEncoding encoding,
    const FileRevision* expectedRevision,
    FileRevision* savedRevision);

// Cheap "may have changed" check for a file that was read into `known`: size,
// write time and nothing else, without opening the file or hashing it. Meant
// for a watcher that runs a few times a second on every open document; a true
// answer is a reason to read the file and compare revisions properly, not
// proof that the bytes differ. A write that keeps both the length and the
// timestamp is missed, which the writers in play do not do: both this editor
// and the MCP server replace the file through a temporary one.
bool FileChangedSince(const wchar_t* path, const FileRevision& known);

// Escapes text for embedding in a JSON string literal. Operates on UTF-16
// throughout, so surrogate pairs survive untouched; control characters are
// escaped rather than dropped.
std::wstring JsonEscape(const std::wstring& src);

// Monaco language id for a file name, or "plaintext".
const char* MonacoLanguageForPath(const wchar_t* path);
bool PathIsUnderRoot(const std::wstring& root, const std::wstring& path);
// Chooses the project/configuration root an interactive agent should start in.
// A regular <project>/src file belongs to <project>; a 1C Designer dump
// below <workspace>/src/cf or src/cfe belongs to <workspace>/src.
std::wstring AgentWorkingDirectoryForPath(const wchar_t* filePath);
// Absolute source paths emitted by BSL Analyzer may live anywhere.  Only
// source-code extensions are eligible for direct read-through from SARIF.
bool IsSarifSourcePath(const std::wstring& path);

// Directory containing the given module, with a trailing backslash.
std::wstring ModuleDirectory(HMODULE module);

// Directory holding the web interface for the given module, without a trailing
// backslash. The interface is linked into the binary, so the usual answer is a
// per-user cache directory that the first run of a build unpacks; a web// directory beside the binary, or one named by %BSLVIEW_WEB_ROOT%, wins over
// it, which is what keeps the development loop free of a rebuild. Empty when
// the interface is neither on disk nor embedded; `error` then says why.
std::wstring ResolveWebRoot(HMODULE module, std::wstring* error = NULL);

std::wstring Utf8ToWide(const char* s, int len);
std::wstring AnsiToWide(const char* s);

// Project-format / Configurator dump of anything an object owns:
//   <ObjectName>/Ext/<file>                     (modules, help, …)
//   <ObjectName>/<Forms|Templates|Commands|Recalculations>/<Name>/Ext/<file>
// Companion metadata XML (catalog, document, external report/processor, …):
//   sibling  <ObjectName>.xml next to the object folder
//   nested   <ObjectName>/<ObjectName>.xml
struct ObjectMetaPaths {
    std::wstring sibling;
    std::wstring nested;
};

ObjectMetaPaths ObjectMetaCandidates(const wchar_t* formPath);
std::wstring FindObjectMetaFile(const wchar_t* formPath);
// ConfigDumpInfo.xml is the export index, not the configuration document the
// user expects to see. Return its sibling Configuration.xml when available.
std::wstring FindConfigurationForDumpInfo(const wchar_t* path);
// Directories a page may read to resolve a form's context with the shared
// form-context.js: the configuration root above the form (the directory with
// ConfigDumpInfo.xml or Configuration.xml, else the owner of its object
// descriptor) and, for an extension, the configurations it may extend
// (context_batch::FindBaseConfigurations, plus <root>/cf for <root>/cfe/<ext>).
std::vector<std::wstring> FormContextRoots(const wchar_t* formPath);

// A managed form module is stored below the layout:
//   Ext/Form.xml -> Ext/Form/Module.bsl.
std::wstring FindFormModuleFile(const wchar_t* formPath);
TextFile LoadFormModuleForForm(const wchar_t* formPath, DWORD maxBytes);

// The module's own form: Ext/Form/Module.bsl -> Ext/Form.xml, or an empty
// string when the path is not a form module or the layout is missing.
std::wstring FindFormLayoutForModule(const wchar_t* modulePath);

// The reverse direction: a form's or template's own descriptor sits right in
// Forms/ (Templates/, CommonForms/, CommonTemplates/), next to the folder
// holding its rendered layout:
//   Forms/<FormName>.xml                (descriptor - what gets opened)
//   Forms/<FormName>/Ext/Form.xml       (the actual managed-form layout)
//   Templates/<Name>/Ext/Template.xml   (the spreadsheet template)
// Given the descriptor path, returns the layout path if it exists on disk,
// or an empty string when there is nothing to redirect to.
std::wstring FindFormLayoutForMeta(const wchar_t* metaPath);

// Returns the filename stem used for a managed-form snapshot and window
// caption. For a full configuration path this is
// <object-type>_<object-name>_<form-name>; otherwise it is the ordinary
// filename without its extension.
std::wstring FormSnapshotBaseName(const wchar_t* formPath);

#endif // BSLCOMMON_H
