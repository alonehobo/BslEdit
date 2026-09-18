/* Batched configuration io for form-context.js, shared by the two native
 * hosts: BSLEdit / the Total Commander viewer (webview2host.cpp, served as
 * https://bslcfg.invalid/batch) and the native MCP server (mcp-server.cpp,
 * served as context-batch). The wire format and the text filters are defined
 * by FormContext.createHttpIo and TEXT_FILTERS in
 * packages/1c-preview-core/browser/form-context.js; this is their native twin.
 *
 * Header-only, Win32 + C++17 standard library. Each host supplies its own
 * access policy through ContextBatchAccess; nothing here decides what a page
 * may see. */
#ifndef ONE_C_CONTEXT_BATCH_H
#define ONE_C_CONTEXT_BATCH_H

#include <windows.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <functional>
#include <string>
#include <thread>
#include <vector>

struct ContextBatchAccess {
    /* A regular file the page may read; the path is as the page sent it. */
    std::function<bool(const std::wstring&)> file;
    /* A directory whose command catalog the page may store and read back. */
    std::function<bool(const std::wstring&)> directory;
};

struct ContextBatchResult {
    int status = 200;
    std::string contentType = "application/octet-stream";
    std::string body;
};

namespace context_batch {

inline std::wstring Wide(const std::string& utf8)
{
    if (utf8.empty()) return std::wstring();
    int size = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), (int)utf8.size(), NULL, 0);
    std::wstring out(size > 0 ? size : 0, L'\0');
    if (size > 0) MultiByteToWideChar(CP_UTF8, 0, utf8.data(), (int)utf8.size(), &out[0], size);
    return out;
}

inline std::string Utf8(const std::wstring& wide)
{
    if (wide.empty()) return std::string();
    int size = WideCharToMultiByte(CP_UTF8, 0, wide.data(), (int)wide.size(), NULL, 0, NULL, NULL);
    std::string out(size > 0 ? size : 0, '\0');
    if (size > 0) WideCharToMultiByte(CP_UTF8, 0, wide.data(), (int)wide.size(), &out[0], size, NULL, NULL);
    return out;
}

inline std::vector<std::string> SplitLines(const std::string& text, size_t maxParts)
{
    std::vector<std::string> parts;
    size_t start = 0;
    while (parts.size() + 1 < maxParts) {
        size_t end = text.find('\n', start);
        if (end == std::string::npos) break;
        parts.push_back(text.substr(start, end - start));
        start = end + 1;
    }
    parts.push_back(text.substr(start));
    return parts;
}

/* Runs work(i) for i in [0, count) on a few threads. Configuration files are
 * small and many; the parallelism is for cold-disk latency, not for CPU. */
inline void ParallelFor(size_t count, const std::function<void(size_t)>& work)
{
    size_t threads = std::min<size_t>(count, std::max<unsigned>(4u, std::min<unsigned>(16u, std::thread::hardware_concurrency() * 2)));
    if (threads <= 1) {
        for (size_t i = 0; i < count; ++i) work(i);
        return;
    }
    std::atomic<size_t> next(0);
    std::vector<std::thread> pool;
    for (size_t t = 0; t < threads; ++t) {
        pool.emplace_back([&]() {
            for (size_t i = next++; i < count; i = next++) work(i);
        });
    }
    for (auto& thread : pool) thread.join();
}

/* "size:mtime" with mtime in whole milliseconds since the Unix epoch - the
 * stamp Node's stat produces, so every host agrees on a stored catalog. */
inline bool Stamp(const std::wstring& path, std::string& stamp)
{
    WIN32_FILE_ATTRIBUTE_DATA data;
    if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data)) return false;
    if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) return false;
    uint64_t size = ((uint64_t)data.nFileSizeHigh << 32) | data.nFileSizeLow;
    uint64_t ticks = ((uint64_t)data.ftLastWriteTime.dwHighDateTime << 32) | data.ftLastWriteTime.dwLowDateTime;
    int64_t ms = (int64_t)(ticks / 10000ULL) - 11644473600000LL;
    stamp = std::to_string(size) + ":" + std::to_string(ms);
    return true;
}

inline bool ReadAll(const std::wstring& path, uint64_t limit, std::string& bytes)
{
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN, NULL);
    if (file == INVALID_HANDLE_VALUE) return false;
    LARGE_INTEGER size;
    bool ok = GetFileSizeEx(file, &size) && size.QuadPart >= 0 && (limit == 0 || (uint64_t)size.QuadPart <= limit)
        && (uint64_t)size.QuadPart < (uint64_t)0x7fffffff;
    if (ok) {
        bytes.resize((size_t)size.QuadPart);
        size_t total = 0;
        while (total < bytes.size()) {
            DWORD got = 0;
            DWORD want = (DWORD)std::min<size_t>(bytes.size() - total, 1u << 24);
            if (!ReadFile(file, &bytes[total], want, &got, NULL) || got == 0) break;
            total += got;
        }
        bytes.resize(total);
    }
    CloseHandle(file);
    return ok;
}

inline bool IsWordByte(unsigned char c)
{
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
}

inline bool MatchNoCase(const std::string& text, size_t at, const char* pattern)
{
    size_t length = strlen(pattern);
    if (at + length > text.size()) return false;
    for (size_t i = 0; i < length; ++i) {
        unsigned char c = (unsigned char)text[at + i];
        if (c >= 'A' && c <= 'Z') c = (unsigned char)(c - 'A' + 'a');
        if (c != (unsigned char)pattern[i]) return false;
    }
    return true;
}

inline size_t FindNoCase(const std::string& text, size_t from, const char* pattern)
{
    for (size_t at = from; at < text.size(); ++at)
        if (MatchNoCase(text, at, pattern)) return at;
    return std::string::npos;
}

inline bool StartsWith(const std::string& text, const char* prefix)
{
    return text.compare(0, strlen(prefix), prefix) == 0;
}

/* TEXT_FILTERS['command-metadata'] */
inline std::string CommandMetadata(const std::string& text)
{
    std::string out;
    size_t at = 0;
    while ((at = text.find("<Metadata", at)) != std::string::npos) {
        size_t cursor = at + 9;
        while (cursor < text.size() && strchr(" \t\r\n\f\v", text[cursor]) && text[cursor]) ++cursor;
        if (cursor == at + 9 || text.compare(cursor, 6, "name=\"") != 0) { at = cursor; continue; }
        size_t valueStart = cursor + 6;
        size_t quote = text.find('"', valueStart);
        if (quote == std::string::npos) break;
        std::string name = text.substr(valueStart, quote - valueStart);
        if (!name.empty() && (StartsWith(name, "CommonCommand.") || StartsWith(name, "CommandGroup.")
                || name.find(".Command.") != std::string::npos)) {
            if (!out.empty()) out += '\n';
            out.append(text, at, quote + 1 - at);
        }
        at = quote + 1;
    }
    return out;
}

/* TEXT_FILTERS['command-blocks'] */
inline std::string CommandBlocks(const std::string& text)
{
    std::string out;
    size_t at = 0;
    while ((at = FindNoCase(text, at, "<command")) != std::string::npos) {
        if (at + 8 < text.size() && IsWordByte((unsigned char)text[at + 8])) { at += 8; continue; }
        size_t open = text.find('>', at + 8);
        if (open == std::string::npos) break;
        size_t close = FindNoCase(text, open + 1, "</command>");
        if (close == std::string::npos) break;
        if (!out.empty()) out += '\n';
        out.append(text, at, close + 10 - at);
        at = close + 10;
    }
    return out;
}

/* TEXT_FILTERS['md-links'] */
inline std::string MdLinks(const std::string& text)
{
    static const char* const kTags[] = { "RegisterRecords", "BasedOn", "Owners", "Content", "Source",
        "RegisteredDocuments", "Documents", "Type" };
    const size_t split = text.find("<ChildObjects>");
    const size_t headEnd = split == std::string::npos ? text.size() : split;
    std::vector<std::pair<size_t, size_t>> hits;
    for (const char* tag : kTags) {
        const std::string open = std::string("<") + tag + ">";
        const std::string close = std::string("</") + tag + ">";
        size_t at = 0;
        while ((at = text.find(open, at)) != std::string::npos && at < headEnd) {
            size_t end = text.find(close, at + open.size());
            if (end == std::string::npos || end + close.size() > headEnd) break;
            hits.push_back(std::make_pair(at, end + close.size()));
            at = end + close.size();
        }
    }
    std::sort(hits.begin(), hits.end());
    std::string out;
    for (const auto& hit : hits) {
        if (!out.empty()) out += '\n';
        out.append(text, hit.first, hit.second - hit.first);
    }
    if (split != std::string::npos) {
        size_t at = split;
        while ((at = text.find("<Subsystem>", at)) != std::string::npos) {
            size_t end = text.find("</Subsystem>", at + 11);
            if (end == std::string::npos) break;
            if (!out.empty()) out += '\n';
            out.append(text, at, end + 12 - at);
            at = end + 12;
        }
    }
    return out;
}

/* TEXT_FILTERS['rights-summary'] */
inline std::string RightsSummary(const std::string& text)
{
    if (text.find('<') == std::string::npos) return text;
    std::string out;
    size_t at = 0;
    while ((at = text.find("<object>", at)) != std::string::npos) {
        size_t end = text.find("</object>", at + 8);
        if (end == std::string::npos) break;
        const size_t blockStart = at + 8;
        at = end + 9;
        size_t nameStart = text.find("<name>", blockStart);
        if (nameStart == std::string::npos || nameStart >= end) continue;
        size_t nameEnd = text.find("</name>", nameStart + 6);
        if (nameEnd == std::string::npos || nameEnd >= end) continue;
        std::string rights;
        size_t r = nameEnd;
        while ((r = text.find("<right>", r)) != std::string::npos && r < end) {
            size_t rEnd = text.find("</right>", r + 7);
            if (rEnd == std::string::npos || rEnd > end) break;
            const std::string right = text.substr(r + 7, rEnd - r - 7);
            r = rEnd + 8;
            if (right.find("<value>true</value>") == std::string::npos) continue;
            size_t rn = right.find("<name>");
            size_t rne = rn == std::string::npos ? std::string::npos : right.find("</name>", rn + 6);
            if (rne == std::string::npos) continue;
            if (!rights.empty()) rights += ',';
            rights.append(right, rn + 6, rne - rn - 6);
            if (right.find("<restrictionByCondition>") != std::string::npos) rights += '*';
        }
        if (rights.empty()) continue;
        if (!out.empty()) out += '\n';
        out.append(text, nameStart + 6, nameEnd - nameStart - 6);
        out += '\t';
        out += rights;
    }
    return out;
}

/* The tags are ASCII, so the scan works on UTF-8 and Windows-1251 bytes alike.
 * A UTF-8 BOM is kept so the page decodes the rest as it would the file; a
 * UTF-16 file goes out whole and the page filters it after decoding. */
inline std::string Filter(const std::string& bytes, const std::string& filter)
{
    if (filter.empty()) return bytes;
    if (bytes.size() >= 2 && ((unsigned char)bytes[0] == 0xff || (unsigned char)bytes[0] == 0xfe)) return bytes;
    bool bom = bytes.size() >= 3 && (unsigned char)bytes[0] == 0xef && (unsigned char)bytes[1] == 0xbb
        && (unsigned char)bytes[2] == 0xbf;
    std::string filtered;
    if (filter == "command-metadata") filtered = CommandMetadata(bytes);
    else if (filter == "command-blocks") filtered = CommandBlocks(bytes);
    else if (filter == "configuration-properties") filtered = bytes.substr(0, bytes.find("<ChildObjects>"));
    else if (filter == "md-links") filtered = MdLinks(bytes);
    else if (filter == "rights-summary") filtered = RightsSummary(bytes);
    else return bytes;
    return bom ? std::string("\xef\xbb\xbf") + filtered : filtered;
}

inline std::wstring CacheDirectory()
{
    wchar_t buffer[32768];
    DWORD length = GetEnvironmentVariableW(L"ONE_C_FORM_VIEWER_CONTEXT_CACHE", buffer, 32768);
    if (length > 0 && length < 32768) {
        std::wstring value(buffer, length);
        if (value == L"off") return std::wstring();
        return value;
    }
    length = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer, 32768);
    if (length == 0 || length >= 32768) return std::wstring();
    return std::wstring(buffer, length) + L"\\1c-form-viewer\\context-cache";
}

/* contextCacheEntry() in packages/1c-form-viewer/src/files.ts */
inline std::string CacheHeader(const std::wstring& directory, const std::string& key)
{
    std::wstring normalized = directory;
    std::replace(normalized.begin(), normalized.end(), L'/', L'\\');
    while (!normalized.empty() && normalized.back() == L'\\') normalized.pop_back();
    if (!normalized.empty()) {
        std::wstring lower(normalized.size() * 2 + 8, L'\0');
        int size = LCMapStringEx(LOCALE_NAME_INVARIANT, LCMAP_LOWERCASE, normalized.c_str(), (int)normalized.size(),
                                 &lower[0], (int)lower.size(), NULL, NULL, 0);
        if (size > 0) normalized.assign(lower.c_str(), size);
    }
    return Utf8(normalized) + "\n" + key + "\n";
}

inline std::wstring CacheFile(const std::string& header)
{
    std::wstring root = CacheDirectory();
    if (root.empty()) return std::wstring();
    uint64_t hash = 0xcbf29ce484222325ULL;
    for (unsigned char c : header) { hash ^= c; hash *= 0x100000001b3ULL; }
    wchar_t name[32];
    swprintf(name, 32, L"%016llx.cache", (unsigned long long)hash);
    return root + L"\\" + name;
}

inline void AppendInt32(std::string& out, int32_t value)
{
    uint32_t v = (uint32_t)value;
    char bytes[4] = { (char)(v & 0xff), (char)((v >> 8) & 0xff), (char)((v >> 16) & 0xff), (char)((v >> 24) & 0xff) };
    out.append(bytes, 4);
}

inline void CreateDirectories(const std::wstring& directory)
{
    for (size_t at = directory.find(L'\\', 3); ; at = directory.find(L'\\', at + 1)) {
        CreateDirectoryW(directory.substr(0, at).c_str(), NULL);
        if (at == std::wstring::npos) break;
    }
}

/* Configuration.xml of an extension names its purpose among the properties,
 * which precede the object list. The head is enough; a configuration file of
 * several megabytes is never read whole. */
inline bool IsExtensionConfiguration(const std::wstring& directory, bool& extension)
{
    HANDLE file = CreateFileW((directory + L"\\Configuration.xml").c_str(), GENERIC_READ,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING,
                              FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return false;
    std::string head(256 * 1024, '\0');
    DWORD got = 0;
    bool ok = ReadFile(file, &head[0], (DWORD)head.size(), &got, NULL) != FALSE;
    CloseHandle(file);
    if (!ok) return false;
    head.resize(got);
    head = head.substr(0, head.find("<ChildObjects>"));
    extension = head.find("<ConfigurationExtensionPurpose>") != std::string::npos;
    return true;
}

/* io.baseConfigurations of form-context.js: the configurations an extension
 * may extend, for an export laid out in any way. From the extension root's
 * parent upwards (three levels, never a volume root) each level's
 * subdirectories are searched two deep for a Configuration.xml that is not an
 * extension; a configuration directory is not entered. The nearest level with
 * a find answers. baseConfigurations() in packages/1c-form-viewer/src/files.ts
 * is the Node twin. */
inline std::vector<std::wstring> FindBaseConfigurations(const std::wstring& extensionRoot)
{
    std::vector<std::wstring> found;
    std::wstring root = extensionRoot;
    std::replace(root.begin(), root.end(), L'/', L'\\');
    while (root.size() > 3 && root.back() == L'\\') root.pop_back();
    size_t budget = 4096;
    std::function<void(const std::wstring&, int)> scan = [&](const std::wstring& directory, int depth) {
        WIN32_FIND_DATAW data;
        HANDLE find = FindFirstFileExW((directory + L"\\*").c_str(), FindExInfoBasic, &data,
                                       FindExSearchLimitToDirectories, NULL, FIND_FIRST_EX_LARGE_FETCH);
        if (find == INVALID_HANDLE_VALUE) return;
        std::vector<std::wstring> children;
        do {
            if (!(data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
            if (data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) continue;
            if (data.cFileName[0] == L'.' || _wcsicmp(data.cFileName, L"node_modules") == 0) continue;
            children.push_back(directory + L"\\" + data.cFileName);
        } while (FindNextFileW(find, &data));
        FindClose(find);
        std::sort(children.begin(), children.end(), [](const std::wstring& a, const std::wstring& b) {
            return _wcsicmp(a.c_str(), b.c_str()) < 0;
        });
        for (const std::wstring& child : children) {
            if (budget == 0) return;
            --budget;
            if (_wcsicmp(child.c_str(), root.c_str()) == 0) continue;
            bool extension = false;
            if (IsExtensionConfiguration(child, extension)) {
                if (!extension) found.push_back(child);
                continue;
            }
            if (depth < 2) scan(child, depth + 1);
        }
    };
    std::wstring level = root;
    for (int up = 0; up < 3 && found.empty() && budget > 0; ++up) {
        size_t slash = level.find_last_of(L'\\');
        if (slash == std::wstring::npos || slash < 3) break;
        level.resize(slash);
        scan(level, 1);
    }
    return found;
}

} // namespace context_batch

inline ContextBatchResult HandleContextBatch(const std::string& body, const ContextBatchAccess& access)
{
    using namespace context_batch;
    ContextBatchResult result;
    const size_t op = body.find('\n');
    const std::string verb = body.substr(0, op);
    const std::string rest = op == std::string::npos ? std::string() : body.substr(op + 1);

    if (verb == "exists" || verb == "stat") {
        std::vector<std::string> lines = SplitLines(rest, (size_t)-1);
        std::vector<std::string> answers(lines.size());
        ParallelFor(lines.size(), [&](size_t i) {
            std::wstring path = Wide(lines[i]);
            std::string stamp;
            bool visible = !path.empty() && access.file && access.file(path) && Stamp(path, stamp);
            answers[i] = verb == "exists" ? (visible ? "1" : "0") : (visible ? stamp : std::string());
        });
        result.contentType = "text/plain; charset=utf-8";
        for (size_t i = 0; i < answers.size(); ++i) {
            if (verb == "stat" && i) result.body += '\n';
            result.body += answers[i];
        }
        return result;
    }

    if (verb == "read") {
        std::vector<std::string> parts = SplitLines(rest, 3);
        if (parts.size() < 3) { result.status = 400; result.body = "Bad request"; return result; }
        uint64_t limit = _strtoui64(parts[0].c_str(), NULL, 10);
        const std::string filter = parts[1];
        std::vector<std::string> lines = SplitLines(parts[2], (size_t)-1);
        std::vector<std::string> files(lines.size());
        std::vector<char> found(lines.size(), 0);
        ParallelFor(lines.size(), [&](size_t i) {
            std::wstring path = Wide(lines[i]);
            DWORD attributes = path.empty() ? INVALID_FILE_ATTRIBUTES : GetFileAttributesW(path.c_str());
            if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_DIRECTORY)) return;
            if (!access.file || !access.file(path)) return;
            std::string bytes;
            if (!ReadAll(path, limit, bytes)) return;
            files[i] = Filter(bytes, filter);
            found[i] = 1;
        });
        size_t total = 0;
        for (auto& file : files) total += 4 + file.size();
        result.body.reserve(total);
        for (size_t i = 0; i < files.size(); ++i) {
            AppendInt32(result.body, found[i] ? (int32_t)files[i].size() : -1);
            if (found[i]) result.body += files[i];
        }
        return result;
    }

    if (verb == "cache-get" || verb == "cache-put") {
        std::vector<std::string> parts = SplitLines(rest, 3);
        if (parts.size() < 2) { result.status = 400; result.body = "Bad request"; return result; }
        std::wstring directory = Wide(parts[0]);
        const std::string header = CacheHeader(directory, parts[1]);
        std::wstring file = CacheFile(header);
        result.contentType = "text/plain; charset=utf-8";
        if (directory.empty() || file.empty() || !access.directory || !access.directory(directory)) {
            result.status = verb == "cache-get" ? 404 : 204;
            return result;
        }
        if (verb == "cache-get") {
            std::string bytes;
            if (!ReadAll(file, 0, bytes) || bytes.compare(0, header.size(), header) != 0) {
                result.status = 404;
                return result;
            }
            result.body = bytes.substr(header.size());
            return result;
        }
        std::string text = parts.size() > 2 ? parts[2] : std::string();
        size_t slash = file.find_last_of(L'\\');
        CreateDirectories(file.substr(0, slash));
        wchar_t suffix[64];
        swprintf(suffix, 64, L".%lu.%llu.tmp", GetCurrentProcessId(), (unsigned long long)GetTickCount64());
        std::wstring temporary = file + suffix;
        HANDLE handle = CreateFileW(temporary.c_str(), GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
        bool ok = handle != INVALID_HANDLE_VALUE;
        if (ok) {
            std::string payload = header + text;
            size_t written = 0;
            while (ok && written < payload.size()) {
                DWORD chunk = 0;
                ok = WriteFile(handle, payload.data() + written, (DWORD)std::min<size_t>(payload.size() - written, 1u << 24),
                               &chunk, NULL) && chunk > 0;
                written += chunk;
            }
            CloseHandle(handle);
        }
        if (!ok || !MoveFileExW(temporary.c_str(), file.c_str(), MOVEFILE_REPLACE_EXISTING)) DeleteFileW(temporary.c_str());
        result.status = 204;
        return result;
    }

    if (verb == "base-configurations") {
        std::wstring root = Wide(rest);
        result.contentType = "text/plain; charset=utf-8";
        if (root.empty() || !access.directory || !access.directory(root)) return result;
        for (const std::wstring& directory : FindBaseConfigurations(root)) {
            if (!access.directory(directory)) continue;
            if (!result.body.empty()) result.body += '\n';
            result.body += Utf8(directory);
        }
        return result;
    }

    result.status = 400;
    result.contentType = "text/plain; charset=utf-8";
    result.body = "Bad request";
    return result;
}

#endif // ONE_C_CONTEXT_BATCH_H
