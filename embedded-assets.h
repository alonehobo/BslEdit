#pragma once

/* The web interface that BSLView.wlx, BSLEdit.exe and the native MCP server
 * render is linked into each binary as an RCDATA resource, packed by
 * tools/pack-assets.mjs. A release is therefore the executable on its own: no
 * web\ directory has to travel with it.
 *
 * WebView2 serves the page through SetVirtualHostNameToFolderMapping and the
 * MCP server through its own HTTP server, and both want a real directory, so
 * the blob is unpacked once into a per-user cache and the hosts keep reading
 * files exactly as before. The directory is named after the pack's content
 * hash, so a new build lands beside the old one instead of overwriting files a
 * running process still has open, and an unpacked cache is reused for free.
 *
 * Header-only on purpose: the three binaries are built by three different
 * scripts, each compiling a single translation unit of its own.
 *
 * The format is described at the top of tools/pack-assets.mjs. */

#include <windows.h>
#include <shlobj.h>
#include <cstdint>
#include <string>
#include <vector>

namespace embedded_assets {

struct Blob {
    const unsigned char* data = NULL;
    std::size_t size = 0;
    bool empty() const { return data == NULL || size == 0; }
};

namespace detail {

const std::size_t kHeaderBytes = 48;
const std::size_t kEntryBytes = 16;

inline std::size_t Pad4(std::size_t value) { return (value + 3) & ~static_cast<std::size_t>(3); }

inline std::uint32_t ReadU32(const unsigned char* at) {
    return static_cast<std::uint32_t>(at[0]) | (static_cast<std::uint32_t>(at[1]) << 8) |
           (static_cast<std::uint32_t>(at[2]) << 16) | (static_cast<std::uint32_t>(at[3]) << 24);
}

inline std::uint64_t ReadU64(const unsigned char* at) {
    return static_cast<std::uint64_t>(ReadU32(at)) | (static_cast<std::uint64_t>(ReadU32(at + 4)) << 32);
}

inline std::wstring WideFromUtf8(const char* bytes, int length) {
    if (length <= 0) return std::wstring();
    int size = MultiByteToWideChar(CP_UTF8, 0, bytes, length, NULL, 0);
    if (size <= 0) return std::wstring();
    std::wstring result(static_cast<std::size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, bytes, length, &result[0], size);
    return result;
}

inline std::wstring HexOf(const unsigned char* bytes, std::size_t count) {
    static const wchar_t* digits = L"0123456789abcdef";
    std::wstring result;
    result.reserve(count * 2);
    for (std::size_t i = 0; i < count; ++i) {
        result.push_back(digits[bytes[i] >> 4]);
        result.push_back(digits[bytes[i] & 0x0F]);
    }
    return result;
}

/* An asset name is data from the build, but it ends up as a path, so it is
 * checked like anything else that does: relative, forward slashes only, no
 * segment that could climb out of the cache directory. */
inline bool NameIsSafe(const std::wstring& name) {
    if (name.empty() || name.size() > 512) return false;
    if (name.front() == L'/' || name.back() == L'/') return false;
    if (name.find(L'\\') != std::wstring::npos) return false;
    if (name.find(L':') != std::wstring::npos) return false;
    std::size_t start = 0;
    while (start <= name.size()) {
        std::size_t slash = name.find(L'/', start);
        std::wstring part = name.substr(start, slash == std::wstring::npos ? std::wstring::npos : slash - start);
        if (part.empty() || part == L"." || part == L"..") return false;
        if (part.back() == L' ' || part.back() == L'.') return false;
        if (slash == std::wstring::npos) break;
        start = slash + 1;
    }
    return true;
}

inline bool CreateDirectoryChain(const std::wstring& path) {
    if (CreateDirectoryW(path.c_str(), NULL)) return true;
    DWORD error = GetLastError();
    if (error == ERROR_ALREADY_EXISTS) return true;
    if (error != ERROR_PATH_NOT_FOUND) return false;
    std::size_t slash = path.find_last_of(L"\\/");
    if (slash == std::wstring::npos) return false;
    if (!CreateDirectoryChain(path.substr(0, slash))) return false;
    return CreateDirectoryW(path.c_str(), NULL) || GetLastError() == ERROR_ALREADY_EXISTS;
}

inline void RemoveTree(const std::wstring& path) {
    WIN32_FIND_DATAW found;
    HANDLE search = FindFirstFileW((path + L"\\*").c_str(), &found);
    if (search != INVALID_HANDLE_VALUE) {
        do {
            std::wstring name = found.cFileName;
            if (name == L"." || name == L"..") continue;
            std::wstring child = path + L"\\" + name;
            if (found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) RemoveTree(child);
            else {
                SetFileAttributesW(child.c_str(), FILE_ATTRIBUTE_NORMAL);
                DeleteFileW(child.c_str());
            }
        } while (FindNextFileW(search, &found));
        FindClose(search);
    }
    RemoveDirectoryW(path.c_str());
}

inline bool WriteWholeFile(const std::wstring& path, const unsigned char* data, std::size_t size) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                              FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return false;
    bool ok = true;
    std::size_t written = 0;
    while (written < size) {
        DWORD chunk = static_cast<DWORD>(size - written > 0x10000000 ? 0x10000000 : size - written);
        DWORD done = 0;
        if (!WriteFile(file, data + written, chunk, &done, NULL) || done == 0) { ok = false; break; }
        written += done;
    }
    CloseHandle(file);
    if (!ok) DeleteFileW(path.c_str());
    return ok;
}

inline bool PathExists(const std::wstring& path) {
    return GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES;
}

inline std::wstring DecimalOf(unsigned long value) {
    wchar_t digits[24];
    int at = 23;
    digits[at] = L'\0';
    do { digits[--at] = static_cast<wchar_t>(L'0' + value % 10); value /= 10; } while (value && at);
    return std::wstring(digits + at);
}

/* SHGetFolderPathW rather than SHGetKnownFolderPath: the latter hands back
 * memory that only CoTaskMemFree can release, and this header is included by
 * binaries that do not otherwise link ole32. */
inline std::wstring LocalAppDataDirectory() {
    std::wstring result;
    wchar_t known[MAX_PATH] = {};
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, SHGFP_TYPE_CURRENT, known)))
        result = known;
    if (result.empty()) {
        wchar_t buffer[MAX_PATH] = {};
        DWORD size = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer, MAX_PATH);
        if (size > 0 && size < MAX_PATH) result = buffer;
    }
    if (result.empty()) {
        wchar_t buffer[MAX_PATH] = {};
        if (GetTempPathW(MAX_PATH, buffer)) {
            result = buffer;
            while (!result.empty() && (result.back() == L'\\' || result.back() == L'/')) result.pop_back();
        }
    }
    return result;
}

/* Caches from earlier builds are dead weight once nothing runs out of them.
 * Sweeping is best effort and never touches a directory younger than a month:
 * a long-lived process started before the update still has its files open. */
inline void PruneOldCaches(const std::wstring& root, const std::wstring& keep) {
    FILETIME now;
    GetSystemTimeAsFileTime(&now);
    ULARGE_INTEGER cutoff;
    cutoff.LowPart = now.dwLowDateTime;
    cutoff.HighPart = now.dwHighDateTime;
    const ULONGLONG thirtyDays = 30ULL * 24 * 60 * 60 * 10000000ULL;
    if (cutoff.QuadPart <= thirtyDays) return;
    cutoff.QuadPart -= thirtyDays;

    WIN32_FIND_DATAW found;
    HANDLE search = FindFirstFileW((root + L"\\assets-*").c_str(), &found);
    if (search == INVALID_HANDLE_VALUE) return;
    do {
        if (!(found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
        std::wstring name = found.cFileName;
        if (name == keep || name == L"." || name == L"..") continue;
        ULARGE_INTEGER written;
        written.LowPart = found.ftLastWriteTime.dwLowDateTime;
        written.HighPart = found.ftLastWriteTime.dwHighDateTime;
        if (written.QuadPart >= cutoff.QuadPart) continue;
        RemoveTree(root + L"\\" + name);
    } while (FindNextFileW(search, &found));
    FindClose(search);
}

} // namespace detail

/* The packed blob linked into `module`, or an empty Blob when the binary was
 * built without one. */
inline Blob Find(HMODULE module, int resourceId) {
    Blob blob;
    /* RT_RCDATA is MAKEINTRESOURCE, which follows UNICODE; the plugin builds
     * without it, so the wide type is spelled out. */
    HRSRC found = FindResourceW(module, MAKEINTRESOURCEW(resourceId), MAKEINTRESOURCEW(10));
    if (!found) return blob;
    DWORD size = SizeofResource(module, found);
    HGLOBAL loaded = LoadResource(module, found);
    if (!size || !loaded) return blob;
    const void* data = LockResource(loaded);
    if (!data) return blob;
    blob.data = static_cast<const unsigned char*>(data);
    blob.size = size;
    return blob;
}

/* Hands out the directory holding the unpacked tree, unpacking it on the first
 * run of this build. `cacheName` is the folder under %LOCALAPPDATA% (for
 * example L"BSLView"). Returns an empty string when the binary carries no pack
 * or the cache cannot be written; `error` then explains why, for a host that
 * wants to say so.
 *
 * Safe to call from several processes at once: each unpacks into a private
 * temporary directory and the first one to finish publishes it. */
inline std::wstring Extract(HMODULE module, int resourceId, const wchar_t* cacheName,
                            std::wstring* error = NULL)
{
    const auto fail = [&](const wchar_t* message) -> std::wstring {
        if (error) *error = message;
        return std::wstring();
    };

    Blob blob = Find(module, resourceId);
    if (blob.empty()) return fail(L"this build carries no embedded interface");
    if (blob.size < detail::kHeaderBytes || memcmp(blob.data, "BSLASSET", 8) != 0)
        return fail(L"the embedded interface is not an asset pack");
    if (detail::ReadU32(blob.data + 8) != 1)
        return fail(L"the embedded interface uses an unsupported pack format");
    const std::uint32_t count = detail::ReadU32(blob.data + 12);
    if (!count) return fail(L"the embedded interface is empty");

    std::wstring root = detail::LocalAppDataDirectory();
    if (root.empty()) return fail(L"no writable cache directory");
    root += L"\\";
    root += cacheName;
    const std::wstring leaf = L"assets-" + detail::HexOf(blob.data + 16, 8);
    const std::wstring target = root + L"\\" + leaf;
    const std::wstring marker = target + L"\\.complete";
    if (detail::PathExists(marker)) {
        detail::PruneOldCaches(root, leaf);
        return target;
    }
    if (!detail::CreateDirectoryChain(root)) return fail(L"cannot create the cache directory");

    const std::wstring staging = root + L"\\.unpack-" +
        detail::DecimalOf(GetCurrentProcessId()) + L"-" + detail::DecimalOf(GetTickCount());
    detail::RemoveTree(staging);
    if (!detail::CreateDirectoryChain(staging)) return fail(L"cannot create the cache directory");

    std::size_t index = detail::kHeaderBytes;
    bool ok = true;
    for (std::uint32_t i = 0; i < count && ok; ++i) {
        if (index + detail::kEntryBytes > blob.size) { ok = false; break; }
        const std::uint32_t nameBytes = detail::ReadU32(blob.data + index);
        const std::uint32_t dataBytes = detail::ReadU32(blob.data + index + 4);
        const std::uint64_t offset = detail::ReadU64(blob.data + index + 8);
        if (index + detail::kEntryBytes + nameBytes > blob.size) { ok = false; break; }
        if (offset > blob.size || offset + dataBytes > blob.size) { ok = false; break; }
        const std::wstring name = detail::WideFromUtf8(
            reinterpret_cast<const char*>(blob.data + index + detail::kEntryBytes),
            static_cast<int>(nameBytes));
        index += detail::kEntryBytes + detail::Pad4(nameBytes);
        if (!detail::NameIsSafe(name)) { ok = false; break; }

        std::wstring path = staging;
        path += L"\\";
        for (std::size_t c = 0; c < name.size(); ++c) path += (name[c] == L'/' ? L'\\' : name[c]);
        std::size_t slash = path.find_last_of(L'\\');
        if (slash != std::wstring::npos && !detail::CreateDirectoryChain(path.substr(0, slash))) { ok = false; break; }
        ok = detail::WriteWholeFile(path, blob.data + offset, dataBytes);
    }
    if (ok) ok = detail::WriteWholeFile(staging + L"\\.complete", blob.data + 16, 32);
    if (!ok) {
        detail::RemoveTree(staging);
        return fail(L"cannot write the cache directory");
    }

    if (!MoveFileW(staging.c_str(), target.c_str())) {
        /* Another process published the same build first, which is the whole
         * point of naming the directory after the content hash. */
        detail::RemoveTree(staging);
        if (!detail::PathExists(marker)) return fail(L"cannot publish the cache directory");
    }
    detail::PruneOldCaches(root, leaf);
    return target;
}

} // namespace embedded_assets
