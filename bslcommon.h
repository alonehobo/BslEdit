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

// Escapes text for embedding in a JSON string literal. Operates on UTF-16
// throughout, so surrogate pairs survive untouched; control characters are
// escaped rather than dropped.
std::wstring JsonEscape(const std::wstring& src);

// Monaco language id for a file name, or "plaintext".
const char* MonacoLanguageForPath(const wchar_t* path);
bool PathIsUnderRoot(const std::wstring& root, const std::wstring& path);
// Absolute source paths emitted by BSL Analyzer may live anywhere.  Only
// source-code extensions are eligible for direct read-through from SARIF.
bool IsSarifSourcePath(const std::wstring& path);

// Directory containing the given module, with a trailing backslash.
std::wstring ModuleDirectory(HMODULE module);

std::wstring Utf8ToWide(const char* s, int len);
std::wstring AnsiToWide(const char* s);

// Project-format / Configurator dump of a managed form:
//   <ObjectName>/Forms/<FormName>/Ext/Form.xml
// Companion metadata XML (catalog, document, external report/processor, …):
//   sibling  <ObjectName>.xml next to the object folder
//   nested   <ObjectName>/<ObjectName>.xml
struct ObjectMetaPaths {
    std::wstring sibling;
    std::wstring nested;
};

ObjectMetaPaths ObjectMetaCandidates(const wchar_t* formPath);
std::wstring FindObjectMetaFile(const wchar_t* formPath);
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
