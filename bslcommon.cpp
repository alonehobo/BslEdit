#include "bslcommon.h"
#include "packages/1c-form-viewer/native/context-batch.h"

#include <map>
#include <vector>
#include <wchar.h>
#include <cwctype>

namespace {

const UINT CP_WINDOWS_1251 = 1251;
const ULONGLONG FNV_OFFSET_BASIS = 14695981039346656037ull;
const ULONGLONG FNV_PRIME = 1099511628211ull;

ULONGLONG HashBytes(const BYTE* data, size_t size)
{
    ULONGLONG hash = FNV_OFFSET_BASIS;
    for (size_t i = 0; i < size; i++) {
        hash ^= data[i];
        hash *= FNV_PRIME;
    }
    return hash;
}

ULONGLONG UpdateHash(ULONGLONG hash, const BYTE* data, size_t size)
{
    for (size_t i = 0; i < size; i++) {
        hash ^= data[i];
        hash *= FNV_PRIME;
    }
    return hash;
}

FileRevision RevisionFromInfo(const BY_HANDLE_FILE_INFORMATION& info, ULONGLONG contentHash)
{
    FileRevision revision;
    revision.valid = true;
    revision.volumeSerial = info.dwVolumeSerialNumber;
    revision.fileIndexHigh = info.nFileIndexHigh;
    revision.fileIndexLow = info.nFileIndexLow;
    revision.sizeHigh = info.nFileSizeHigh;
    revision.sizeLow = info.nFileSizeLow;
    revision.lastWriteTime = info.ftLastWriteTime;
    revision.contentHash = contentHash;
    return revision;
}

bool SameRevision(const FileRevision& left, const FileRevision& right)
{
    return left.valid && right.valid
        && left.volumeSerial == right.volumeSerial
        && left.fileIndexHigh == right.fileIndexHigh
        && left.fileIndexLow == right.fileIndexLow
        && left.sizeHigh == right.sizeHigh
        && left.sizeLow == right.sizeLow
        && CompareFileTime(&left.lastWriteTime, &right.lastWriteTime) == 0
        && left.contentHash == right.contentHash;
}

bool ReadFileRevision(const wchar_t* path, FileRevision& revision)
{
    HANDLE file = CreateFileW(path, GENERIC_READ,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              NULL, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, NULL);
    if (file == INVALID_HANDLE_VALUE) return false;

    BY_HANDLE_FILE_INFORMATION before = {}, after = {};
    bool ok = GetFileInformationByHandle(file, &before) != FALSE;
    ULARGE_INTEGER fileSize = {};
    fileSize.HighPart = before.nFileSizeHigh;
    fileSize.LowPart = before.nFileSizeLow;
    std::vector<BYTE> bytes(64 * 1024);
    ULONGLONG total = 0;
    ULONGLONG hash = FNV_OFFSET_BASIS;
    while (ok && total < fileSize.QuadPart) {
        DWORD got = 0;
        DWORD want = (DWORD)((fileSize.QuadPart - total > bytes.size())
            ? bytes.size() : (fileSize.QuadPart - total));
        if (!ReadFile(file, bytes.data(), want, &got, NULL) || got == 0) {
            ok = false;
            break;
        }
        hash = UpdateHash(hash, bytes.data(), got);
        total += got;
    }
    if (ok) ok = GetFileInformationByHandle(file, &after) != FALSE;
    CloseHandle(file);
    if (!ok || before.nFileSizeHigh != after.nFileSizeHigh
            || before.nFileSizeLow != after.nFileSizeLow
            || CompareFileTime(&before.ftLastWriteTime, &after.ftLastWriteTime) != 0)
        return false;

    revision = RevisionFromInfo(after, hash);
    return true;
}

bool EncodeText(const std::wstring& text, TextEncoding encoding, std::vector<BYTE>& out)
{
    out.clear();
    switch (encoding) {
    case ENC_UTF16LE:
    case ENC_UTF16BE: {
        bool bigEndian = (encoding == ENC_UTF16BE);
        out.reserve((text.size() + 1) * 2);
        out.push_back(bigEndian ? 0xFE : 0xFF);
        out.push_back(bigEndian ? 0xFF : 0xFE);
        for (wchar_t ch : text) {
            BYTE lo = (BYTE)(ch & 0xFF), hi = (BYTE)(ch >> 8);
            if (bigEndian) { out.push_back(hi); out.push_back(lo); }
            else           { out.push_back(lo); out.push_back(hi); }
        }
        return true;
    }
    default: {
        UINT cp = (encoding == ENC_ANSI) ? CP_WINDOWS_1251 : CP_UTF8;
        DWORD flags = (encoding == ENC_ANSI) ? WC_NO_BEST_FIT_CHARS : 0;
        BOOL usedDefault = FALSE;
        BOOL* usedDefaultPtr = (encoding == ENC_ANSI) ? &usedDefault : NULL;
        int len = 0;
        if (!text.empty()) {
            len = WideCharToMultiByte(cp, flags, text.c_str(), (int)text.size(),
                                      NULL, 0, NULL, usedDefaultPtr);
            if (len <= 0 || usedDefault) return false;
        }
        size_t offset = 0;
        if (encoding == ENC_UTF8_BOM) {
            out.resize(3 + len);
            out[0] = 0xEF; out[1] = 0xBB; out[2] = 0xBF;
            offset = 3;
        } else {
            out.resize(len);
        }
        if (len) {
            usedDefault = FALSE;
            int written = WideCharToMultiByte(cp, flags, text.c_str(), (int)text.size(),
                                              (char*)out.data() + offset, len, NULL, usedDefaultPtr);
            if (written != len || usedDefault) return false;
        }
        return true;
    }
    }
}

std::wstring SaveTempPath(const wchar_t* path, unsigned attempt)
{
    return std::wstring(path) + L".bslview-save-" + std::to_wstring(GetCurrentProcessId())
         + L"-" + std::to_wstring(GetTickCount64()) + L"-" + std::to_wstring(attempt) + L".tmp";
}

std::wstring DecodeCodePage(UINT cp, const char* p, int len)
{
    if (len <= 0) return std::wstring();
    int wlen = MultiByteToWideChar(cp, 0, p, len, NULL, 0);
    if (wlen <= 0) return std::wstring();
    std::wstring out(wlen, L'\0');
    MultiByteToWideChar(cp, 0, p, len, &out[0], wlen);
    return out;
}

} // namespace

std::wstring Utf8ToWide(const char* s, int len)
{
    return DecodeCodePage(CP_UTF8, s, len);
}

std::wstring AnsiToWide(const char* s)
{
    if (!s) return std::wstring();
    return DecodeCodePage(CP_ACP, s, (int)strlen(s));
}

TextFile ReadTextFile(const wchar_t* path, DWORD maxBytes)
{
    TextFile result;

    HANDLE hFile = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                               NULL, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return result;

    LARGE_INTEGER size = {};
    if (!GetFileSizeEx(hFile, &size)) { CloseHandle(hFile); return result; }
    if (maxBytes && (size.QuadPart > (LONGLONG)maxBytes)) { CloseHandle(hFile); return result; }
    if (size.QuadPart > 0x7FFFFFFF) { CloseHandle(hFile); return result; }

    DWORD fileSize = (DWORD)size.QuadPart;
    std::vector<BYTE> data;
    if (fileSize) {
        try {
            data.resize(fileSize);
        } catch (const std::bad_alloc&) {
            CloseHandle(hFile);
            return result;
        }
        DWORD total = 0;
        while (total < fileSize) {
            DWORD got = 0;
            if (!ReadFile(hFile, data.data() + total, fileSize - total, &got, NULL) || got == 0) break;
            total += got;
        }
        BY_HANDLE_FILE_INFORMATION info = {};
        bool stable = GetFileInformationByHandle(hFile, &info) != FALSE
                   && info.nFileSizeHigh == size.HighPart
                   && info.nFileSizeLow == size.LowPart;
        CloseHandle(hFile);
        // A short read (locked region, I/O error, file changed under us) must
        // not look like success: the caller may write this truncated content
        // straight back over the original file on the next save.
        if (total != fileSize || !stable) return result;
        result.revision = RevisionFromInfo(info, HashBytes(data.data(), data.size()));
    } else {
        BY_HANDLE_FILE_INFORMATION info = {};
        if (!GetFileInformationByHandle(hFile, &info)) { CloseHandle(hFile); return result; }
        result.revision = RevisionFromInfo(info, FNV_OFFSET_BASIS);
        CloseHandle(hFile);
    }

    // An empty file is a valid, successfully read file.
    result.ok = true;

    const BYTE* p = data.data();
    size_t sz = data.size();

    if (sz >= 3 && p[0] == 0xEF && p[1] == 0xBB && p[2] == 0xBF) {
        result.encoding = ENC_UTF8_BOM;
        result.text = Utf8ToWide((const char*)p + 3, (int)(sz - 3));
        return result;
    }
    if (sz >= 2 && p[0] == 0xFF && p[1] == 0xFE) {
        result.encoding = ENC_UTF16LE;
        result.text.assign((const wchar_t*)(p + 2), (sz - 2) / sizeof(wchar_t));
        return result;
    }
    if (sz >= 2 && p[0] == 0xFE && p[1] == 0xFF) {
        result.encoding = ENC_UTF16BE;
        result.text.resize((sz - 2) / sizeof(wchar_t));
        for (size_t i = 0; i < result.text.size(); i++)
            result.text[i] = (wchar_t)((p[2 + i * 2] << 8) | p[2 + i * 2 + 1]);
        return result;
    }
    if (sz == 0) {
        result.encoding = ENC_UTF8;
        return result;
    }

    int wlen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (const char*)p, (int)sz, NULL, 0);
    if (wlen > 0) {
        result.encoding = ENC_UTF8;
        result.text = Utf8ToWide((const char*)p, (int)sz);
        return result;
    }

    result.encoding = ENC_ANSI;
    result.text = DecodeCodePage(CP_WINDOWS_1251, (const char*)p, (int)sz);
    return result;
}

bool WriteTextFile(const wchar_t* path, const std::wstring& text, TextEncoding encoding)
{
    return WriteTextFileIfUnchanged(path, text, encoding, NULL, NULL) == TEXT_FILE_WRITE_OK;
}

TextFileWriteResult WriteTextFileIfUnchanged(
    const wchar_t* path, const std::wstring& text, TextEncoding encoding,
    const FileRevision* expectedRevision, FileRevision* savedRevision)
{
    std::vector<BYTE> out;
    if (!EncodeText(text, encoding, out)) return TEXT_FILE_WRITE_IO_ERROR;

    if (expectedRevision) {
        FileRevision current;
        if (!ReadFileRevision(path, current) || !SameRevision(*expectedRevision, current))
            return TEXT_FILE_WRITE_CONFLICT;
    }

    HANDLE hFile = INVALID_HANDLE_VALUE;
    std::wstring tempPath;
    for (unsigned attempt = 0; attempt < 100 && hFile == INVALID_HANDLE_VALUE; attempt++) {
        tempPath = SaveTempPath(path, attempt);
        hFile = CreateFileW(tempPath.c_str(), GENERIC_WRITE, 0, NULL, CREATE_NEW,
                            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, NULL);
        if (hFile == INVALID_HANDLE_VALUE && GetLastError() != ERROR_FILE_EXISTS)
            return TEXT_FILE_WRITE_IO_ERROR;
    }
    if (hFile == INVALID_HANDLE_VALUE) return TEXT_FILE_WRITE_IO_ERROR;

    bool ok = true;
    size_t written = 0;
    while (written < out.size()) {
        DWORD chunk = 0;
        DWORD want = (DWORD)((out.size() - written > 0x10000000u) ? 0x10000000u : (out.size() - written));
        if (!WriteFile(hFile, out.data() + written, want, &chunk, NULL) || chunk == 0) { ok = false; break; }
        written += chunk;
    }
    if (ok && !FlushFileBuffers(hFile)) ok = false;
    if (!CloseHandle(hFile)) ok = false;
    if (!ok) {
        DeleteFileW(tempPath.c_str());
        return TEXT_FILE_WRITE_IO_ERROR;
    }

    FileRevision publishedRevision;
    if (!ReadFileRevision(tempPath.c_str(), publishedRevision)) {
        DeleteFileW(tempPath.c_str());
        return TEXT_FILE_WRITE_IO_ERROR;
    }

    // Recheck after the potentially slow encode/write.  The final rename is a
    // single same-directory filesystem operation; cooperative editors get a
    // compare-before-swap contract without ever observing a partial file.
    if (expectedRevision) {
        FileRevision current;
        if (!ReadFileRevision(path, current) || !SameRevision(*expectedRevision, current)) {
            DeleteFileW(tempPath.c_str());
            return TEXT_FILE_WRITE_CONFLICT;
        }
    }

    if (!MoveFileExW(tempPath.c_str(), path,
                     MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DeleteFileW(tempPath.c_str());
        return TEXT_FILE_WRITE_IO_ERROR;
    }
    if (savedRevision) *savedRevision = publishedRevision;
    return TEXT_FILE_WRITE_OK;
}

std::wstring JsonEscape(const std::wstring& src)
{
    static const wchar_t* kHex = L"0123456789abcdef";
    std::wstring out;
    out.reserve(src.size() + src.size() / 8 + 16);
    for (wchar_t ch : src) {
        switch (ch) {
        case L'"':  out += L"\\\""; break;
        case L'\\': out += L"\\\\"; break;
        case L'\b': out += L"\\b";  break;
        case L'\f': out += L"\\f";  break;
        case L'\n': out += L"\\n";  break;
        case L'\r': out += L"\\r";  break;
        case L'\t': out += L"\\t";  break;
        default:
            if (ch < 0x20) {
                out += L"\\u00";
                out += kHex[(ch >> 4) & 0xF];
                out += kHex[ch & 0xF];
            } else {
                out += ch;
            }
        }
    }
    return out;
}

const char* MonacoLanguageForPath(const wchar_t* path)
{
    const wchar_t* dot = wcsrchr(path, L'.');
    if (!dot) return "plaintext";

    wchar_t ext[16];
    size_t n = 0;
    for (const wchar_t* p = dot + 1; *p && n < 15; p++) {
        if (*p >= 0x80) return "plaintext";
        ext[n++] = (wchar_t)towlower(*p);
    }
    ext[n] = 0;

    if (!wcscmp(ext, L"bsl") || !wcscmp(ext, L"os"))       return "bsl";
    if (!wcscmp(ext, L"sdbl") || !wcscmp(ext, L"query"))   return "bsl_query";
    if (!wcscmp(ext, L"md") || !wcscmp(ext, L"markdown"))  return "markdown";
    if (!wcscmp(ext, L"json") || !wcscmp(ext, L"sarif")) return "json";
    if (!wcscmp(ext, L"xml"))                              return "xml";
    if (!wcscmp(ext, L"ps1") || !wcscmp(ext, L"psm1") || !wcscmp(ext, L"psd1")) return "powershell";
    if (!wcscmp(ext, L"html") || !wcscmp(ext, L"htm"))     return "html";
    if (!wcscmp(ext, L"mxl"))                             return "plaintext";
    return "plaintext";
}

std::wstring ModuleDirectory(HMODULE module)
{
    std::vector<wchar_t> buf(MAX_PATH);
    for (;;) {
        DWORD n = GetModuleFileNameW(module, buf.data(), (DWORD)buf.size());
        if (n == 0) return std::wstring();
        if (n < buf.size() - 1) break;
        if (buf.size() >= 32768) return std::wstring();
        buf.resize(buf.size() * 2);
    }
    std::wstring path(buf.data());
    size_t slash = path.find_last_of(L"\\/");
    if (slash == std::wstring::npos) return std::wstring();
    return path.substr(0, slash + 1);
}

static std::wstring PathDirName(const std::wstring& path)
{
    size_t slash = path.find_last_of(L"\\/");
    if (slash == std::wstring::npos) return std::wstring();
    return path.substr(0, slash);
}

static std::wstring PathBaseName(const std::wstring& path)
{
    size_t slash = path.find_last_of(L"\\/");
    return slash == std::wstring::npos ? path : path.substr(slash + 1);
}

static wchar_t PathSep(const std::wstring& path)
{
    if (path.find(L'\\') != std::wstring::npos) return L'\\';
    if (path.find(L'/') != std::wstring::npos) return L'/';
    return L'\\';
}

static bool NameEqualsI(const std::wstring& name, const wchar_t* expect)
{
    return _wcsicmp(name.c_str(), expect) == 0;
}

static bool FileExistsW(const wchar_t* path)
{
    if (!path || !*path) return false;
    DWORD attr = GetFileAttributesW(path);
    return attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY);
}

ObjectMetaPaths ObjectMetaCandidates(const wchar_t* formPath)
{
    ObjectMetaPaths out;
    if (!formPath || !*formPath) return out;

    std::wstring path = formPath;
    while (!path.empty() && (path.back() == L'\\' || path.back() == L'/'))
        path.pop_back();
    if (path.empty()) return out;

    if (!NameEqualsI(PathBaseName(path), L"Form.xml")) return out;

    std::wstring extDir = PathDirName(path);
    if (!NameEqualsI(PathBaseName(extDir), L"Ext")) return out;

    std::wstring formDir = PathDirName(extDir);
    if (formDir.empty()) return out;

    std::wstring formsDir = PathDirName(formDir);
    if (!NameEqualsI(PathBaseName(formsDir), L"Forms")) return out;

    std::wstring objectDir = PathDirName(formsDir);
    std::wstring objectName = PathBaseName(objectDir);
    if (objectDir.empty() || objectName.empty()) return out;

    wchar_t sep = PathSep(path);
    std::wstring parent = PathDirName(objectDir);
    out.sibling = parent.empty() ? objectName + L".xml"
                                 : parent + sep + objectName + L".xml";
    out.nested = objectDir + sep + objectName + L".xml";
    return out;
}

std::wstring FindObjectMetaFile(const wchar_t* formPath)
{
    ObjectMetaPaths c = ObjectMetaCandidates(formPath);
    if (!c.sibling.empty() && FileExistsW(c.sibling.c_str())) return c.sibling;
    if (!c.nested.empty() && FileExistsW(c.nested.c_str())) return c.nested;
    return std::wstring();
}

std::vector<std::wstring> FormContextRoots(const wchar_t* formPath)
{
    std::vector<std::wstring> roots;
    if (!formPath || !*formPath) return roots;
    std::wstring path = formPath;

    /* The configuration root carries the metadata index the shared resolver
     * reads (ConfigDumpInfo.xml or Configuration.xml); every context file of
     * the form lives below it. */
    std::wstring configuration;
    for (std::wstring directory = PathDirName(path); !directory.empty();) {
        wchar_t sep = PathSep(directory);
        if (FileExistsW((directory + sep + L"ConfigDumpInfo.xml").c_str())
            || FileExistsW((directory + sep + L"Configuration.xml").c_str())) {
            configuration = directory;
            break;
        }
        std::wstring parent = PathDirName(directory);
        if (parent.empty() || parent == directory) break;
        directory.swap(parent);
    }
    /* An external object or a loose form has no configuration: expose the
     * directory that holds its object descriptor, never more. */
    if (configuration.empty()) {
        ObjectMetaPaths meta = ObjectMetaCandidates(formPath);
        configuration = !meta.sibling.empty() ? PathDirName(meta.sibling) : PathDirName(path);
    }
    if (!configuration.empty()) roots.push_back(configuration);

    /* An extension also reads the base form and metadata of the configuration
     * it extends, wherever the export put it. */
    bool extension = false;
    if (!configuration.empty() && context_batch::IsExtensionConfiguration(configuration, extension) && extension) {
        for (const std::wstring& base : context_batch::FindBaseConfigurations(configuration))
            roots.push_back(base);
    }

    /* <root>/cfe/<extension>/... also reads below <root>/cf, with or without
     * a Configuration.xml there. */
    std::wstring lower = path;
    for (size_t i = 0; i < lower.size(); ++i) lower[i] = (wchar_t)towlower(lower[i]);
    size_t marker = lower.find(L"\\cfe\\");
    wchar_t sep = L'\\';
    if (marker == std::wstring::npos) {
        marker = lower.find(L"/cfe/");
        sep = L'/';
    }
    if (marker != std::wstring::npos) {
        std::wstring base = path.substr(0, marker) + sep + L"cf";
        DWORD attributes = GetFileAttributesW(base.c_str());
        bool known = false;
        for (size_t i = 0; i < roots.size(); ++i) known = known || _wcsicmp(roots[i].c_str(), base.c_str()) == 0;
        if (!known && attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY))
            roots.push_back(base);
    }
    return roots;
}

bool PathIsUnderRoot(const std::wstring& root, const std::wstring& path)
{
    if (root.empty() || path.empty()) return false;
    wchar_t rootBuf[32768] = {}, pathBuf[32768] = {};
    DWORD rootLen = GetFullPathNameW(root.c_str(), 32768, rootBuf, NULL);
    DWORD pathLen = GetFullPathNameW(path.c_str(), 32768, pathBuf, NULL);
    if (!rootLen || rootLen >= 32768 || !pathLen || pathLen >= 32768) return false;
    std::wstring normalizedRoot(rootBuf), normalizedPath(pathBuf);
    while (normalizedRoot.size() > 3 &&
           (normalizedRoot.back() == L'\\' || normalizedRoot.back() == L'/'))
        normalizedRoot.pop_back();
    if (normalizedPath.size() < normalizedRoot.size() ||
        _wcsnicmp(normalizedPath.c_str(), normalizedRoot.c_str(), normalizedRoot.size()) != 0)
        return false;
    return normalizedPath.size() == normalizedRoot.size() ||
           normalizedPath[normalizedRoot.size()] == L'\\' ||
           normalizedPath[normalizedRoot.size()] == L'/';
}

bool IsSarifSourcePath(const std::wstring& path)
{
    size_t slash = path.find_last_of(L"\\/");
    size_t dot = path.find_last_of(L'.');
    if (dot == std::wstring::npos || (slash != std::wstring::npos && dot < slash)) return false;
    const wchar_t* ext = path.c_str() + dot;
    return _wcsicmp(ext, L".bsl") == 0 || _wcsicmp(ext, L".os") == 0 ||
           _wcsicmp(ext, L".sdbl") == 0 || _wcsicmp(ext, L".query") == 0;
}

std::wstring FindFormModuleFile(const wchar_t* formPath)
{
    if (!formPath || !*formPath) return std::wstring();
    std::wstring path = formPath;
    std::wstring name = PathBaseName(path);
    if (!NameEqualsI(name, L"Form.xml")) return std::wstring();
    std::wstring extDir = PathDirName(path);
    if (extDir.empty() || !NameEqualsI(PathBaseName(extDir), L"Ext")) return std::wstring();
    wchar_t sep = PathSep(path);
    std::wstring candidate = extDir + sep + L"Form" + sep + L"Module.bsl";
    return FileExistsW(candidate.c_str()) ? candidate : std::wstring();
}

TextFile LoadFormModuleForForm(const wchar_t* formPath, DWORD maxBytes)
{
    std::wstring candidate = FindFormModuleFile(formPath);
    return candidate.empty() ? TextFile() : ReadTextFile(candidate.c_str(), maxBytes);
}

std::wstring FindFormLayoutForModule(const wchar_t* modulePath)
{
    if (!modulePath || !*modulePath) return std::wstring();
    std::wstring path = modulePath;
    if (!NameEqualsI(PathBaseName(path), L"Module.bsl")) return std::wstring();
    std::wstring formDir = PathDirName(path);
    if (formDir.empty() || !NameEqualsI(PathBaseName(formDir), L"Form")) return std::wstring();
    std::wstring extDir = PathDirName(formDir);
    if (extDir.empty() || !NameEqualsI(PathBaseName(extDir), L"Ext")) return std::wstring();
    std::wstring layout = extDir + PathSep(path) + L"Form.xml";
    return FileExistsW(layout.c_str()) ? layout : std::wstring();
}

std::wstring FindFormLayoutForMeta(const wchar_t* metaPath)
{
    if (!metaPath || !*metaPath) return std::wstring();

    std::wstring path = metaPath;
    while (!path.empty() && (path.back() == L'\\' || path.back() == L'/'))
        path.pop_back();
    if (path.empty()) return std::wstring();

    std::wstring base = PathBaseName(path);
    size_t dot = base.find_last_of(L'.');
    if (dot == std::wstring::npos || dot == 0) return std::wstring();
    if (!NameEqualsI(base.substr(dot), L".xml")) return std::wstring();
    std::wstring name = base.substr(0, dot);
    if (name.empty()) return std::wstring();

    std::wstring dir = PathDirName(path);
    if (dir.empty()) return std::wstring();
    std::wstring kind = PathBaseName(dir);
    const wchar_t* leaf = NULL;
    if (NameEqualsI(kind, L"Forms") || NameEqualsI(kind, L"CommonForms"))
        leaf = L"Form.xml";
    else if (NameEqualsI(kind, L"Templates") || NameEqualsI(kind, L"CommonTemplates"))
        leaf = L"Template.xml";
    if (!leaf) return std::wstring();

    wchar_t sep = PathSep(path);
    std::wstring layout = dir + sep + name + sep + L"Ext" + sep + leaf;
    return FileExistsW(layout.c_str()) ? layout : std::wstring();
}

std::wstring FormSnapshotBaseName(const wchar_t* formPath)
{
    if (!formPath || !*formPath) return std::wstring();

    std::wstring path = formPath;
    std::wstring base = PathBaseName(path);
    if (base.empty()) return std::wstring();

    // A layout nested in a configuration has a more useful stable name than
    // the technical leaf name Form.xml. Keep this in lockstep with the
    // default name offered by the form screenshot save dialog.
    if (NameEqualsI(base, L"Form.xml")) {
        size_t fileSlash = path.find_last_of(L"\\/");
        size_t extDirStart = fileSlash == std::wstring::npos
            ? std::wstring::npos : path.find_last_of(L"\\/", fileSlash - 1);
        size_t formDirEnd = extDirStart;
        size_t formDirStart = formDirEnd == std::wstring::npos
            ? std::wstring::npos : path.find_last_of(L"\\/", formDirEnd - 1);
        size_t formsEnd = formDirStart;
        size_t formsStart = formsEnd == std::wstring::npos
            ? std::wstring::npos : path.find_last_of(L"\\/", formsEnd - 1);
        size_t objectEnd = formsStart;
        size_t objectStart = objectEnd == std::wstring::npos
            ? std::wstring::npos : path.find_last_of(L"\\/", objectEnd - 1);
        size_t typeEnd = objectStart;
        size_t typeStart = typeEnd == std::wstring::npos
            ? std::wstring::npos : path.find_last_of(L"\\/", typeEnd - 1);
        if (formsStart != std::wstring::npos && objectStart != std::wstring::npos
            && typeStart != std::wstring::npos) {
            std::wstring formName = path.substr(formDirStart + 1,
                formDirEnd - formDirStart - 1);
            std::wstring objectName = path.substr(objectStart + 1,
                objectEnd - objectStart - 1);
            std::wstring type = path.substr(typeStart + 1,
                typeEnd - typeStart - 1);
            if (NameEqualsI(type, L"Documents")) type = L"Документ";
            else if (NameEqualsI(type, L"Catalogs")) type = L"Справочник";
            else if (NameEqualsI(type, L"InformationRegisters")) type = L"РегистрСведений";
            else if (NameEqualsI(type, L"AccumulationRegisters")) type = L"РегистрНакопления";
            else if (NameEqualsI(type, L"Reports")) type = L"Отчет";
            else if (NameEqualsI(type, L"DataProcessors")) type = L"Обработка";
            if (!type.empty() && !objectName.empty() && !formName.empty())
                return type + L"." + objectName + L"." + formName;
        }
    }

    size_t dot = base.rfind(L'.');
    if (dot != std::wstring::npos) base.erase(dot);
    return base;
}
