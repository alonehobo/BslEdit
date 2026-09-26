#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <tlhelp32.h>
#include <winsock2.h>
#include <ws2tcpip.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstring>
#include <cstdint>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <map>
#include <mutex>
#include <optional>
#include <random>
#include <sstream>
#include <stdexcept>
#include <regex>
#include <string>
#include <string_view>
#include <thread>

/* The preview interface is linked into this executable as an RCDATA
 * resource and unpacked into a per-user cache on the first run of a build,
 * so the server ships as a single file with no app\web beside it. */
#include "../../../embedded-assets.h"
/* open_preview base_revision reads the earlier version with BSLEdit's git code. */
#include "../../../gitquery.h"

/* This build's identity. Like the Node server, the version comes from
 * package.json: build-native.ps1 generates native-version.h from it and
 * force-includes it, so a release bumps one file. The fallback below only
 * applies to an ad-hoc compile that skips the script, so it deliberately
 * reads as unreleased rather than impersonating some real version. */
#ifndef ONE_C_FORM_VIEWER_VERSION
#define ONE_C_FORM_VIEWER_VERSION "0.0.0-dev"
#endif
#define ONE_C_FORM_VIEWER_VERSION_W L"" ONE_C_FORM_VIEWER_VERSION
#define ONE_C_FORM_VIEWER_NAME "1c-form-viewer-native"

#include <vector>

#include "context-batch.h"

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "advapi32.lib")

namespace fs = std::filesystem;

namespace {

std::string utf8_from_wide(const std::wstring& value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
    return result;
}

std::wstring wide_from_utf8(std::string_view value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (!size) return {};
    std::wstring result(size, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size);
    return result;
}

std::string json_escape(std::string_view value) {
    std::string result;
    result.reserve(value.size() + 16);
    for (unsigned char character : value) {
        switch (character) {
        case '"': result += "\\\""; break;
        case '\\': result += "\\\\"; break;
        case '\b': result += "\\b"; break;
        case '\f': result += "\\f"; break;
        case '\n': result += "\\n"; break;
        case '\r': result += "\\r"; break;
        case '\t': result += "\\t"; break;
        default:
            if (character < 0x20) {
                std::ostringstream escaped;
                escaped << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(character);
                result += escaped.str();
            } else {
                result += static_cast<char>(character);
            }
        }
    }
    return result;
}

std::string json_string(std::string_view value) {
    return "\"" + json_escape(value) + "\"";
}

struct Json {
    enum class Kind { Null, Bool, Number, String, Object, Array };
    Kind kind = Kind::Null;
    bool boolean = false;
    double number = 0;
    std::string string;
    std::map<std::string, Json> object;
    std::vector<Json> array;

    static Json null() { return {}; }
    static Json booleanValue(bool value) { Json json; json.kind = Kind::Bool; json.boolean = value; return json; }
    static Json numberValue(double value) { Json json; json.kind = Kind::Number; json.number = value; return json; }
    static Json stringValue(std::string value) { Json json; json.kind = Kind::String; json.string = std::move(value); return json; }
    static Json objectValue(std::map<std::string, Json> value) { Json json; json.kind = Kind::Object; json.object = std::move(value); return json; }

    const Json* get(const std::string& key) const {
        if (kind != Kind::Object) return nullptr;
        const auto found = object.find(key);
        return found == object.end() ? nullptr : &found->second;
    }

    std::string asString(const std::string& fallback = {}) const {
        return kind == Kind::String ? string : fallback;
    }

    bool asBool(bool fallback = false) const {
        return kind == Kind::Bool ? boolean : fallback;
    }

    std::string dump() const {
        switch (kind) {
        case Kind::Null: return "null";
        case Kind::Bool: return boolean ? "true" : "false";
        case Kind::Number: {
            std::ostringstream output;
            output << std::setprecision(15) << number;
            return output.str();
        }
        case Kind::String: return json_string(string);
        case Kind::Array: {
            std::string output = "[";
            for (std::size_t i = 0; i < array.size(); ++i) {
                if (i) output += ',';
                output += array[i].dump();
            }
            return output + ']';
        }
        case Kind::Object: {
            std::string output = "{";
            bool first = true;
            for (const auto& [key, value] : object) {
                if (!first) output += ',';
                first = false;
                output += json_string(key) + ':' + value.dump();
            }
            return output + '}';
        }
        }
        return "null";
    }
};

class JsonParser {
public:
    explicit JsonParser(std::string_view input) : input_(input) {}

    Json parse() {
        skipSpace();
        Json result = value();
        skipSpace();
        if (position_ != input_.size()) throw std::runtime_error("Trailing JSON data");
        return result;
    }

private:
    std::string_view input_;
    std::size_t position_ = 0;

    void skipSpace() {
        while (position_ < input_.size() && (input_[position_] == ' ' || input_[position_] == '\t' || input_[position_] == '\r' || input_[position_] == '\n')) ++position_;
    }

    char take() {
        if (position_ >= input_.size()) throw std::runtime_error("Unexpected end of JSON");
        return input_[position_++];
    }

    void expect(char expected) {
        if (take() != expected) throw std::runtime_error("Invalid JSON");
    }

    std::string stringValue() {
        expect('"');
        std::string result;
        while (position_ < input_.size()) {
            const char character = take();
            if (character == '"') return result;
            if (character != '\\') {
                result += character;
                continue;
            }
            const char escape = take();
            switch (escape) {
            case '"': result += '"'; break;
            case '\\': result += '\\'; break;
            case '/': result += '/'; break;
            case 'b': result += '\b'; break;
            case 'f': result += '\f'; break;
            case 'n': result += '\n'; break;
            case 'r': result += '\r'; break;
            case 't': result += '\t'; break;
            case 'u': {
                if (position_ + 4 > input_.size()) throw std::runtime_error("Invalid unicode escape");
                unsigned value = 0;
                for (int i = 0; i < 4; ++i) {
                    const char digit = input_[position_++];
                    value <<= 4;
                    if (digit >= '0' && digit <= '9') value += digit - '0';
                    else if (digit >= 'a' && digit <= 'f') value += digit - 'a' + 10;
                    else if (digit >= 'A' && digit <= 'F') value += digit - 'A' + 10;
                    else throw std::runtime_error("Invalid unicode escape");
                }
                if (value < 0x80) result += static_cast<char>(value);
                else if (value < 0x800) {
                    result += static_cast<char>(0xc0 | (value >> 6));
                    result += static_cast<char>(0x80 | (value & 0x3f));
                } else {
                    result += static_cast<char>(0xe0 | (value >> 12));
                    result += static_cast<char>(0x80 | ((value >> 6) & 0x3f));
                    result += static_cast<char>(0x80 | (value & 0x3f));
                }
                break;
            }
            default: throw std::runtime_error("Invalid JSON escape");
            }
        }
        throw std::runtime_error("Unterminated JSON string");
    }

    Json value() {
        skipSpace();
        if (position_ >= input_.size()) throw std::runtime_error("Missing JSON value");
        switch (input_[position_]) {
        case 'n': if (input_.substr(position_, 4) != "null") throw std::runtime_error("Invalid JSON"); position_ += 4; return Json::null();
        case 't': if (input_.substr(position_, 4) != "true") throw std::runtime_error("Invalid JSON"); position_ += 4; return Json::booleanValue(true);
        case 'f': if (input_.substr(position_, 5) != "false") throw std::runtime_error("Invalid JSON"); position_ += 5; return Json::booleanValue(false);
        case '"': return Json::stringValue(stringValue());
        case '{': return objectValue();
        case '[': return arrayValue();
        default: return numberValue();
        }
    }

    Json objectValue() {
        expect('{');
        std::map<std::string, Json> result;
        skipSpace();
        if (position_ < input_.size() && input_[position_] == '}') { ++position_; return Json::objectValue(std::move(result)); }
        while (true) {
            skipSpace();
            const std::string key = stringValue();
            skipSpace();
            expect(':');
            result.emplace(key, value());
            skipSpace();
            const char separator = take();
            if (separator == '}') break;
            if (separator != ',') throw std::runtime_error("Invalid JSON object");
        }
        return Json::objectValue(std::move(result));
    }

    Json arrayValue() {
        expect('[');
        Json result;
        result.kind = Json::Kind::Array;
        skipSpace();
        if (position_ < input_.size() && input_[position_] == ']') { ++position_; return result; }
        while (true) {
            result.array.push_back(value());
            skipSpace();
            const char separator = take();
            if (separator == ']') break;
            if (separator != ',') throw std::runtime_error("Invalid JSON array");
        }
        return result;
    }

    Json numberValue() {
        const std::size_t start = position_;
        while (position_ < input_.size() && std::string_view("-+0123456789.eE").find(input_[position_]) != std::string_view::npos) ++position_;
        try { return Json::numberValue(std::stod(std::string(input_.substr(start, position_ - start)))); }
        catch (...) { throw std::runtime_error("Invalid JSON number"); }
    }
};

/* Windows still refuses paths over 260 characters unless they carry the
 * extended-length prefix; Cyrillic object names reach that in a deep export. */
fs::path long_path(const fs::path& path) {
    const std::wstring wide = path.wstring();
    if (wide.size() < 240 || wide.rfind(L"\\\\?\\", 0) == 0 || !path.is_absolute()) return path;
    return fs::path(L"\\\\?\\" + wide);
}

std::wstring decode_text_bytes(const unsigned char* data, std::size_t size, std::string& encoding);

std::string read_text_file(const fs::path& rawPath, std::size_t maxBytes, std::string& encoding) {
    const fs::path path = long_path(rawPath);
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("File does not exist: " + utf8_from_wide(path.wstring()));
    input.seekg(0, std::ios::end);
    const auto length = input.tellg();
    if (length < 0 || static_cast<std::uintmax_t>(length) > maxBytes) throw std::runtime_error("File is too large: " + utf8_from_wide(path.wstring()));
    input.seekg(0, std::ios::beg);
    std::vector<unsigned char> bytes(static_cast<std::size_t>(length));
    if (!bytes.empty()) input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    return utf8_from_wide(decode_text_bytes(bytes.data(), bytes.size(), encoding));
}

/* Also decodes a blob git hands back for base_revision. */
std::wstring decode_text_bytes(const unsigned char* data, std::size_t size, std::string& encoding) {
    const std::vector<unsigned char> bytes(data, data + size);
    std::wstring wide;
    if (bytes.size() >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf) {
        encoding = "utf8-bom";
        wide = wide_from_utf8(std::string_view(reinterpret_cast<const char*>(bytes.data() + 3), bytes.size() - 3));
    } else if (bytes.size() >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe) {
        encoding = "utf16le";
        wide.resize((bytes.size() - 2) / 2);
        std::memcpy(wide.data(), bytes.data() + 2, wide.size() * sizeof(wchar_t));
    } else if (bytes.size() >= 2 && bytes[0] == 0xfe && bytes[1] == 0xff) {
        encoding = "utf16be";
        wide.resize((bytes.size() - 2) / 2);
        for (std::size_t i = 0; i < wide.size(); ++i) wide[i] = static_cast<wchar_t>((bytes[2 + i * 2] << 8) | bytes[3 + i * 2]);
    } else {
        wide = wide_from_utf8(std::string_view(reinterpret_cast<const char*>(bytes.data()), bytes.size()));
        if (!wide.empty() || bytes.empty()) encoding = "utf8";
        else {
            encoding = "windows-1251";
            const int size = MultiByteToWideChar(1251, 0, reinterpret_cast<const char*>(bytes.data()), static_cast<int>(bytes.size()), nullptr, 0);
            wide.resize(size);
            MultiByteToWideChar(1251, 0, reinterpret_cast<const char*>(bytes.data()), static_cast<int>(bytes.size()), wide.data(), size);
        }
    }
    return wide;
}

std::wstring lower_wide(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t c) { return static_cast<wchar_t>(towlower(c)); });
    return value;
}

/* The file's canonical DOS path: short names, relative spellings and junctions
 * all collapse to one text, so both sides of the BSLEdit marker below agree on
 * what "the same file" means. */
std::wstring final_path_name(const fs::path& path) {
    std::wstring result = path.wstring();
    const HANDLE file = CreateFileW(result.c_str(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                    nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (file != INVALID_HANDLE_VALUE) {
        std::wstring buffer(MAX_PATH, L'\0');
        DWORD length = GetFinalPathNameByHandleW(file, buffer.data(), static_cast<DWORD>(buffer.size()), VOLUME_NAME_DOS);
        if (length >= buffer.size()) {
            buffer.resize(length + 1);
            length = GetFinalPathNameByHandleW(file, buffer.data(), static_cast<DWORD>(buffer.size()), VOLUME_NAME_DOS);
        }
        CloseHandle(file);
        if (length && length < buffer.size()) result.assign(buffer.data(), length);
    }
    if (result.rfind(L"\\\\?\\UNC\\", 0) == 0) result = L"\\\\" + result.substr(8);
    else if (result.rfind(L"\\\\?\\", 0) == 0) result.erase(0, 4);
    return result;
}

/* The name BSLEdit publishes while it holds a file open. The editing tools step
 * aside while it exists: the window in front of the user owns the file, and an
 * agent's write would be lost by the next save there anyway.
 *
 * Its twin lives in bsledit.cpp (BSLEditOpenMutexName) and the two spellings
 * must stay identical - a difference disables the protection silently instead
 * of failing, so native-contract.test.ts recomputes the name independently. */
std::wstring bsledit_open_mutex_name(const fs::path& path) {
    std::wstring text = final_path_name(path);
    if (!text.empty()) {
        /* The invariant locale, not the process one: the same path must hash
         * the same way in the editor and here, whatever either has set. */
        std::wstring lowered(text.size(), L'\0');
        const int mapped = LCMapStringEx(LOCALE_NAME_INVARIANT, LCMAP_LOWERCASE, text.c_str(), static_cast<int>(text.size()),
                                         lowered.data(), static_cast<int>(lowered.size()), nullptr, nullptr, 0);
        if (mapped > 0) text.assign(lowered.data(), static_cast<std::size_t>(mapped));
    }
    std::uint64_t hash = 14695981039346656037ull;
    for (const wchar_t character : text) {
        hash = (hash ^ static_cast<std::uint8_t>(character & 0xff)) * 1099511628211ull;
        hash = (hash ^ static_cast<std::uint8_t>((character >> 8) & 0xff)) * 1099511628211ull;
    }
    wchar_t hex[17] = {};
    swprintf(hex, 17, L"%016llx", static_cast<unsigned long long>(hash));
    return std::wstring(L"Local\\BSLEdit.Open.") + hex;
}

bool open_in_bsledit(const fs::path& path) {
    const HANDLE marker = OpenMutexW(SYNCHRONIZE, FALSE, bsledit_open_mutex_name(path).c_str());
    if (!marker) return false;
    CloseHandle(marker);
    return true;
}

std::string mime_type(const fs::path& path) {
    const auto extension = lower_wide(path.extension().wstring());
    if (extension == L".html") return "text/html; charset=utf-8";
    if (extension == L".js") return "text/javascript; charset=utf-8";
    if (extension == L".css") return "text/css; charset=utf-8";
    if (extension == L".json") return "application/json; charset=utf-8";
    if (extension == L".svg") return "image/svg+xml";
    return "application/octet-stream";
}

std::string random_token() {
    std::random_device device;
    std::mt19937_64 generator(device());
    std::ostringstream output;
    output << std::hex;
    for (int i = 0; i < 4; ++i) output << generator();
    return output.str();
}

std::string url_decode(std::string value) {
    std::string result;
    for (std::size_t i = 0; i < value.size(); ++i) {
        if (value[i] == '%' && i + 2 < value.size()) {
            const auto hex = [](char c) -> int { if (c >= '0' && c <= '9') return c - '0'; if (c >= 'a' && c <= 'f') return c - 'a' + 10; if (c >= 'A' && c <= 'F') return c - 'A' + 10; return -1; };
            const int high = hex(value[i + 1]);
            const int low = hex(value[i + 2]);
            if (high >= 0 && low >= 0) { result += static_cast<char>((high << 4) | low); i += 2; continue; }
        }
        result += value[i] == '+' ? ' ' : value[i];
    }
    return result;
}

std::string base64_encode(const std::vector<unsigned char>& bytes) {
    static constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((bytes.size() + 2) / 3) * 4);
    for (std::size_t i = 0; i < bytes.size(); i += 3) {
        unsigned value = static_cast<unsigned>(bytes[i]) << 16;
        if (i + 1 < bytes.size()) value |= static_cast<unsigned>(bytes[i + 1]) << 8;
        if (i + 2 < bytes.size()) value |= bytes[i + 2];
        out.push_back(alphabet[(value >> 18) & 63]);
        out.push_back(alphabet[(value >> 12) & 63]);
        out.push_back(i + 1 < bytes.size() ? alphabet[(value >> 6) & 63] : '=');
        out.push_back(i + 2 < bytes.size() ? alphabet[value & 63] : '=');
    }
    return out;
}

std::string url_encode_component(std::string_view value) {
    static constexpr char hex[] = "0123456789ABCDEF";
    std::string result;
    result.reserve(value.size() * 3);
    for (const unsigned char character : value) {
        if ((character >= 'a' && character <= 'z')
            || (character >= 'A' && character <= 'Z')
            || (character >= '0' && character <= '9')
            || character == '-' || character == '_' || character == '.' || character == '~') {
            result += static_cast<char>(character);
        } else {
            result += '%';
            result += hex[character >> 4];
            result += hex[character & 0x0f];
        }
    }
    return result;
}

std::string make_http_response(int status, std::string_view contentType, std::string_view body) {
    const char* reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 400 ? "Bad Request" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : status == 409 ? "Conflict" : "Internal Server Error";
    std::ostringstream output;
    output << "HTTP/1.1 " << status << ' ' << reason << "\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: " << contentType << "\r\nContent-Length: " << body.size() << "\r\n\r\n";
    output << body;
    return output.str();
}

/* Opens `target` in BSLEdit. The editor takes the file from the command line
 * and watches it from there; nothing is handed back, because what both the
 * page and the agent go by is the file on disk. `session`, the preview's own
 * base URL, lets the editor keep the user's annotations where the agent reads
 * them. */
bool launch_editor(const fs::path& editor, const fs::path& target, const std::string& session = {}) {
    std::wstring parameters = L"\"" + target.wstring() + L"\"";
    if (!session.empty()) parameters += L" --preview-session \"" + wide_from_utf8(session) + L"\"";
    const auto started = reinterpret_cast<INT_PTR>(
        ShellExecuteW(nullptr, L"open", editor.wstring().c_str(), parameters.c_str(), nullptr, SW_SHOWNORMAL));
    return started > 32;
}

struct Document {
    fs::path requestedPath;
    fs::path resolvedPath;
    std::string content;
    std::string encoding;
    std::uintmax_t size = 0;
    /* open_preview base_path: the earlier version the page compares against. */
    bool hasBase = false;
    fs::path basePath;
    std::string baseRevision;  /* base_revision as given; basePath is then the file itself */
    std::string baseDescription;  /* the commit behind baseRevision: short sha, date, subject */
    std::string baseContent;
};

/* How a comparison is named to the page and in replies: a file, or a revision
 * of the same file ("index" for what is staged). */
std::string baseLabelOf(const Document& document) {
    if (!document.baseRevision.empty()) return "git:" + document.baseRevision;
    return utf8_from_wide(document.basePath.wstring());
}

class PreviewServer {
    struct Pending { std::string id; std::string op; std::string args; bool delivered; std::uint64_t revision; };
    /* Size and write time: enough to notice a save, cheap enough to ask for
     * twice a second. ReadDirectoryChangesW would be the obvious tool, but the
     * forms people edit sit on Yandex.Disk and network shares, where it both
     * invents changes and misses them. */
    struct Stamp {
        bool valid = false;
        std::uintmax_t size = 0;
        fs::file_time_type written{};
        bool operator==(const Stamp& other) const {
            return valid == other.valid && size == other.size && written == other.written;
        }
    };
    struct Result { std::string id; std::string value; };
    /* resolved: the agent marked it done; the user accepts (deletes) it or
     * reopens it, so the agent never removes the user's notes itself. */
    struct Annotation { std::string id; std::string elementId; std::string elementName; std::string text; bool resolved = false; std::string resolution; bool agent = false; std::string endElementId; };
    struct Session {
        std::optional<Document> document;
        std::function<Document()> reloader;
        std::string interfaceMode = "Any";
        std::uint64_t revision = 0;
        std::uint64_t touched = 0;
        std::optional<Pending> pending;
        std::optional<Result> lastResult;
        std::optional<std::chrono::steady_clock::time_point> lastPoll;
        Stamp stamp;
        bool externalChange = false;
        std::uint64_t annotationCounter = 0;
        /* Bumped on every change of the list, so pages polling it notice a
         * change made elsewhere (the agent resolving a note) without a reload. */
        std::uint64_t annotationVersion = 0;
        std::vector<Annotation> annotations;
    };
public:
    explicit PreviewServer(fs::path assets) : assets_(std::move(assets)), token_(random_token()) {}
    ~PreviewServer() { close(); }

    void start() {
        std::lock_guard lock(mutex_);
        if (socket_ != INVALID_SOCKET) return;
        WSADATA data{};
        if (WSAStartup(MAKEWORD(2, 2), &data) != 0) throw std::runtime_error("Could not initialize Winsock");
        socket_ = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (socket_ == INVALID_SOCKET) throw std::runtime_error("Could not create preview server socket");
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        address.sin_port = 0;
        if (::bind(socket_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR || ::listen(socket_, 8) == SOCKET_ERROR) {
            closesocket(socket_); socket_ = INVALID_SOCKET; WSACleanup(); throw std::runtime_error("Could not bind preview server");
        }
        int length = sizeof(address);
        getsockname(socket_, reinterpret_cast<sockaddr*>(&address), &length);
        port_ = ntohs(address.sin_port);
        accepting_ = true;
        thread_ = std::thread([this] { acceptLoop(); });
        watcher_ = std::thread([this] { watchLoop(); });
    }

    /* Every opened file is its own preview with its own page URL
     * (/<token>/<previewId>/index.html), so several previews stay open side by
     * side. Reopening a file reuses its preview and link. */
    /* The preview's directory, where its annotations endpoint lives. */
    std::string sessionUrl(const std::string& id) const {
        if (!port_) return {};
        return "http://127.0.0.1:" + std::to_string(port_) + "/" + token_ + "/" + id + "/";
    }

    std::string url(const std::string& id) const {
        if (!port_) throw std::runtime_error("Preview server is not running");
        return "http://127.0.0.1:" + std::to_string(port_) + "/" + token_ + "/" + id + "/index.html?internal=1";
    }

    /* The reloader lets the page's refresh button re-read the file from disk,
     * so an agent's edit shows without reopening the preview. */
    std::string openSession(Document document, std::function<Document()> reloader, std::string interfaceMode = "Any") {
        std::lock_guard lock(mutex_);
        const std::wstring key = lower_wide(document.resolvedPath.wstring());
        std::string id;
        /* A comparison is its own preview: the same file may be open plainly
         * and against one or several earlier versions at once. */
        const auto baseKeyOf = [](const Document& d) { return lower_wide(d.basePath.wstring()) + L"|" + wide_from_utf8(d.baseRevision); };
        const std::wstring baseKey = document.hasBase ? baseKeyOf(document) : std::wstring();
        for (const auto& [candidate, session] : sessions_) {
            if (session.document && lower_wide(session.document->resolvedPath.wstring()) == key
                && session.document->hasBase == document.hasBase
                && (!document.hasBase || baseKeyOf(*session.document) == baseKey)) { id = candidate; break; }
        }
        /* An authoring transform may have started a page before any file was open. */
        if (id.empty()) {
            for (const auto& [candidate, session] : sessions_) {
                if (!session.document) { id = candidate; break; }
            }
        }
        if (id.empty()) id = "p" + std::to_string(++sessionCounter_);
        Session& session = sessions_[id];
        /* Reopening the same file keeps the user's notes; a slot reused for
         * another file starts empty. */
        const bool sameFile = session.document
            && lower_wide(session.document->resolvedPath.wstring()) == lower_wide(document.resolvedPath.wstring());
        session.document = std::move(document);
        session.reloader = std::move(reloader);
        session.interfaceMode = std::move(interfaceMode);
        session.stamp = stampOf(session.document->resolvedPath);
        if (!sameFile) {
            session.annotations.clear();
            session.annotationCounter = 0;
            ++session.annotationVersion;
        }
        ++session.revision;
        session.touched = ++touchCounter_;
        active_ = id;
        return id;
    }

    /* A page for the shared-module transforms: the active preview, or an empty one. */
    std::string workSession() {
        std::lock_guard lock(mutex_);
        if (!active_.empty() && sessions_.count(active_)) return active_;
        active_ = "p" + std::to_string(++sessionCounter_);
        sessions_[active_].touched = ++touchCounter_;
        return active_;
    }

    /* The preview a tool call targets: the given id, or the last one used. */
    std::string resolve(const std::string& requested) {
        std::lock_guard lock(mutex_);
        if (requested.empty()) {
            if (active_.empty() || !sessions_.count(active_) || !sessions_.at(active_).document)
                throw std::runtime_error("No preview is open. Call open_preview first.");
            return active_;
        }
        const auto found = sessions_.find(requested);
        if (found == sessions_.end() || !found->second.document)
            throw std::runtime_error("Unknown preview_id: " + requested + ". Call get_preview_url to list open previews.");
        found->second.touched = ++touchCounter_;
        active_ = requested;
        return requested;
    }

    std::string baseLabel(const std::string& id) const {
        std::lock_guard lock(mutex_);
        const auto found = sessions_.find(id);
        return found != sessions_.end() && found->second.document && found->second.document->hasBase
            ? baseLabelOf(*found->second.document) : std::string();
    }

    void setDocument(const std::string& id, Document document) {
        std::lock_guard lock(mutex_);
        const auto found = sessions_.find(id);
        if (found == sessions_.end()) return;
        found->second.document = std::move(document);
        found->second.stamp = stampOf(found->second.document->resolvedPath);
        /* Annotations outlive a re-read of the file (reload, edit_form, a save
         * in BSLEdit): the agent resolves them after its edit. One whose
         * element is gone stays listed, and the page marks it. */
        ++found->second.revision;
    }

    /* The watcher reloaded this preview because someone else - BSLEdit, as a
     * rule - wrote the file. Reported once, to the next tool call that touches
     * the preview, so the agent does not reason about a layout it never saw. */
    bool takeExternalChange(const std::string& id) {
        std::lock_guard lock(mutex_);
        Session* session = findSession(id);
        if (!session || !session->externalChange) return false;
        session->externalChange = false;
        return true;
    }

    /* Closing every preview at once names no single target, so the note of any
     * preview still carrying one is reported by that call. */
    bool takeExternalChangeAny() {
        std::lock_guard lock(mutex_);
        bool any = false;
        for (auto& [id, session] : sessions_) {
            if (!session.externalChange) continue;
            session.externalChange = false;
            any = true;
        }
        return any;
    }

    /* openOnly: the agent's default view, the notes still waiting for it. */
    std::string annotationsJson(const std::string& id, bool openOnly = false) const {
        std::lock_guard lock(mutex_);
        const auto found = sessions_.find(id);
        if (found == sessions_.end()) return "{\"annotations\":[]}";
        /* revision lets a page that polls (BSLEdit) notice a reload that
         * cleared the list, and send it back with each change; version
         * changes with the list itself. */
        return "{\"revision\":" + std::to_string(found->second.revision)
            + ",\"version\":" + std::to_string(found->second.annotationVersion)
            + ",\"annotations\":" + annotationItemsJson(found->second.annotations, openOnly) + "}";
    }

    static std::string annotationJson(const Annotation& annotation) {
        return "{\"id\":" + json_string(annotation.id)
            + ",\"elementId\":" + json_string(annotation.elementId)
            + (annotation.endElementId.empty() ? std::string() : ",\"endElementId\":" + json_string(annotation.endElementId))
            + ",\"elementName\":" + json_string(annotation.elementName)
            + ",\"text\":" + json_string(annotation.text)
            + ",\"status\":" + (annotation.resolved ? "\"resolved\"" : "\"open\"")
            + (annotation.resolved && !annotation.resolution.empty() ? ",\"resolution\":" + json_string(annotation.resolution) : std::string())
            + (annotation.agent ? ",\"author\":\"agent\"" : "")
            + "}";
    }

    static std::string annotationItemsJson(const std::vector<Annotation>& annotations, bool openOnly = false) {
        std::string output = "[";
        for (const auto& annotation : annotations) {
            if (openOnly && annotation.resolved) continue;
            if (output.back() != '[') output += ',';
            output += annotationJson(annotation);
        }
        return output + "]";
    }

    static std::uint64_t annotationRevision(const Json& value) {
        const Json* revision = value.get("revision");
        if (!revision || revision->kind != Json::Kind::Number || !std::isfinite(revision->number)
            || revision->number < 0 || revision->number > 9007199254740991.0
            || std::floor(revision->number) != revision->number)
            throw std::runtime_error("A non-negative integer revision is required.");
        return static_cast<std::uint64_t>(revision->number);
    }

    std::string addAnnotation(const std::string& id, const Json& value) {
        const auto revision = annotationRevision(value);
        const std::string elementId = value.get("elementId") ? value.get("elementId")->asString() : std::string();
        const std::string elementName = value.get("elementName") ? value.get("elementName")->asString() : std::string();
        const std::string text = value.get("text") ? value.get("text")->asString() : std::string();
        if (elementId.empty() || elementName.empty() || text.empty())
            throw std::runtime_error("elementId, elementName and non-empty text are required");
        std::lock_guard lock(mutex_);
        Session* session = findSession(id);
        if (!session) throw std::runtime_error("The preview is closed.");
        if (session->revision != revision) throw std::logic_error("The preview revision has changed.");
        Annotation annotation{"a" + std::to_string(++session->annotationCounter), elementId, elementName, text};
        /* The far corner of a spreadsheet range the user dragged over. */
        if (const Json* end = value.get("endElementId")) annotation.endElementId = end->asString();
        session->annotations.push_back(annotation);
        ++session->annotationVersion;
        return annotationJson(annotation);
    }

    bool removeAnnotation(const std::string& id, const std::string& annotationId, std::uint64_t revision) {
        std::lock_guard lock(mutex_);
        Session* session = findSession(id);
        if (!session) return false;
        if (session->revision != revision) throw std::logic_error("The preview revision has changed.");
        const auto found = std::find_if(session->annotations.begin(), session->annotations.end(), [&annotationId](const Annotation& item) {
            return item.id == annotationId;
        });
        if (found == session->annotations.end()) return false;
        session->annotations.erase(found);
        ++session->annotationVersion;
        return true;
    }

    /* The user's "clear all". */
    bool clearAnnotations(const std::string& id, std::uint64_t revision) {
        std::lock_guard lock(mutex_);
        Session* session = findSession(id);
        if (!session) return false;
        if (session->revision != revision) throw std::logic_error("The preview revision has changed.");
        session->annotations.clear();
        ++session->annotationVersion;
        return true;
    }

    std::optional<std::string> updateAnnotation(const std::string& id, const std::string& annotationId, const Json& value) {
        const auto revision = annotationRevision(value);
        /* The user edits the text, reopens a note the agent resolved
         * (status "open"), or both. */
        const bool hasText = value.get("text") != nullptr;
        const std::string text = hasText ? value.get("text")->asString() : std::string();
        const std::string status = value.get("status") ? value.get("status")->asString() : std::string();
        if (!status.empty() && status != "open")
            throw std::runtime_error("status can only be set to \"open\"");
        if ((hasText || status.empty()) && text.find_first_not_of(" \t\r\n") == std::string::npos)
            throw std::runtime_error("Non-empty text is required");
        std::lock_guard lock(mutex_);
        Session* session = findSession(id);
        if (!session) return std::nullopt;
        if (session->revision != revision) throw std::logic_error("The preview revision has changed.");
        const auto found = std::find_if(session->annotations.begin(), session->annotations.end(), [&annotationId](const Annotation& item) {
            return item.id == annotationId;
        });
        if (found == session->annotations.end()) return std::nullopt;
        if (hasText) found->text = text;
        if (!status.empty()) { found->resolved = false; found->resolution.clear(); }
        ++session->annotationVersion;
        return annotationJson(*found);
    }

    /* The agent's side: no revision, it acts on the note by id alone. */
    std::string resolveAnnotation(const std::string& id, const std::string& annotationId, const std::string& resolution) {
        std::lock_guard lock(mutex_);
        Session* session = findSession(id);
        if (!session) throw std::runtime_error("The preview is closed.");
        const auto found = std::find_if(session->annotations.begin(), session->annotations.end(), [&annotationId](const Annotation& item) {
            return item.id == annotationId;
        });
        if (found == session->annotations.end())
            throw std::runtime_error("No annotation " + annotationId + " on this preview; list them with operation=annotations.");
        found->resolved = true;
        found->resolution = resolution;
        ++session->annotationVersion;
        return annotationJson(*found);
    }

    /* A note the agent leaves for the user. A spreadsheet cell rNcM, or a
     * range up to toElementId, is named R1C1 or R1C1:R2C2 the way the page
     * names the user's own. */
    std::string agentAddAnnotation(const std::string& id, const std::string& elementId, const std::string& toElementId,
                                   const std::string& elementName, const std::string& text) {
        if (elementId.empty() || text.find_first_not_of(" \t\r\n") == std::string::npos)
            throw std::runtime_error("element_id and non-empty text are required");
        std::string name = elementName;
        const std::regex cell("^r(\\d+)c(\\d+)$");
        std::smatch from, to;
        if (name.empty() && std::regex_match(elementId, from, cell)) {
            auto label = [](unsigned long row, unsigned long column) {
                return "R" + std::to_string(row + 1) + "C" + std::to_string(column + 1);
            };
            unsigned long r0 = std::stoul(from[1]), c0 = std::stoul(from[2]), r1 = r0, c1 = c0;
            if (!toElementId.empty()) {
                if (!std::regex_match(toElementId, to, cell)) throw std::runtime_error("to_element_id must be a cell rNcM");
                r1 = std::stoul(to[1]); c1 = std::stoul(to[2]);
            }
            name = label((std::min)(r0, r1), (std::min)(c0, c1));
            if (r0 != r1 || c0 != c1) name += ":" + label((std::max)(r0, r1), (std::max)(c0, c1));
        }
        if (name.empty()) name = elementId;
        std::lock_guard lock(mutex_);
        Session* session = findSession(id);
        if (!session) throw std::runtime_error("The preview is closed.");
        Annotation annotation{"a" + std::to_string(++session->annotationCounter), elementId, name, text};
        annotation.agent = true;
        /* The page selects the cells by id, whatever name the agent gave them. */
        annotation.endElementId = toElementId;
        session->annotations.push_back(annotation);
        ++session->annotationVersion;
        return annotationJson(annotation);
    }

    /* The agent removes only the notes it left; the user's stay. */
    std::string agentRemoveAnnotation(const std::string& id, const std::string& annotationId) {
        std::lock_guard lock(mutex_);
        Session* session = findSession(id);
        if (!session) throw std::runtime_error("The preview is closed.");
        const auto found = std::find_if(session->annotations.begin(), session->annotations.end(), [&annotationId](const Annotation& item) {
            return item.id == annotationId;
        });
        if (found == session->annotations.end())
            throw std::runtime_error("No annotation " + annotationId + " on this preview; list them with operation=annotations.");
        if (!found->agent)
            throw std::runtime_error("Annotation " + annotationId + " is the user's; resolve it with operation=resolve_annotation instead.");
        session->annotations.erase(found);
        ++session->annotationVersion;
        return "{\"removed\":" + json_string(annotationId) + "}";
    }

    bool hasDocument(const std::string& id) const {
        std::lock_guard lock(mutex_);
        const auto found = sessions_.find(id);
        return found != sessions_.end() && found->second.document.has_value();
    }

    /* [{previewId, path, previewUrl, active}] of the open previews. */
    std::string listJson() const {
        std::lock_guard lock(mutex_);
        std::string output = "[";
        for (const auto& [id, session] : sessions_) {
            if (!session.document) continue;
            if (output.size() > 1) output += ',';
            output += "{\"previewId\":" + json_string(id)
                + ",\"path\":" + json_string(utf8_from_wide(session.document->resolvedPath.wstring()))
                + (session.document->hasBase ? ",\"base\":" + json_string(baseLabelOf(*session.document)) : std::string())
                + ",\"previewUrl\":" + json_string("http://127.0.0.1:" + std::to_string(port_) + "/" + token_ + "/" + id + "/index.html?internal=1")
                + ",\"active\":" + (id == active_ ? "true" : "false") + "}";
        }
        return output + "]";
    }

    void closeSession(const std::string& id) {
        std::lock_guard lock(mutex_);
        sessions_.erase(id);
        if (active_ == id) {
            active_.clear();
            std::uint64_t latest = 0;
            for (const auto& [candidate, session] : sessions_) {
                if (session.document && session.touched >= latest) { latest = session.touched; active_ = candidate; }
            }
        }
        condition_.notify_all();
    }

    /* The hidden renderer moved to another preview: this page no longer polls,
     * so a command must not wait for it. */
    void forgetPoll(const std::string& id) {
        std::lock_guard lock(mutex_);
        const auto found = sessions_.find(id);
        if (found != sessions_.end()) found->second.lastPoll.reset();
    }

    /* Object metadata, the base cf form, style items, common commands and
     * pictures are resolved in the page by the shared form-context.js - the
     * same code the Node server and BSLEdit run - through context-file. */
    std::string stateJson(const std::string& id) const {
        std::lock_guard lock(mutex_);
        const auto found = sessions_.find(id);
        if (found == sessions_.end() || !found->second.document) return "{}";
        const Session& session = found->second;
        return "{\"revision\":" + std::to_string(session.revision) + ",\"path\":" + json_string(utf8_from_wide(session.document->resolvedPath.wstring())) + ",\"content\":" + json_string(session.document->content) + ",\"resolveContext\":true,\"interfaceMode\":" + json_string(session.interfaceMode)
            + ",\"annotations\":" + annotationItemsJson(session.annotations)
            + (session.document->hasBase
                ? ",\"basePath\":" + json_string(utf8_from_wide(session.document->basePath.wstring()))
                    + ",\"baseRevision\":" + json_string(session.document->baseRevision)
                    + ",\"baseDescription\":" + json_string(session.document->baseDescription)
                    + ",\"baseContent\":" + json_string(session.document->baseContent)
                : std::string()) + "}";
    }

    /* The shared resolver reads configuration files through this server with
     * exactly the access the MCP session has (--root / --allow-any-path). */
    void setContextAccess(std::function<bool(const fs::path&)> access) {
        std::lock_guard lock(mutex_);
        contextAccess_ = std::move(access);
    }

    std::string metaJson(const std::string& id) const {
        std::function<fs::path()> locator;
        std::string meta;
        {
            std::lock_guard lock(mutex_);
            const auto found = sessions_.find(id);
            const bool available = found != sessions_.end() && found->second.document;
            meta = "{\"revision\":" + std::to_string(available ? found->second.revision : 0)
                + ",\"annotationVersion\":" + std::to_string(found != sessions_.end() ? found->second.annotationVersion : 0)
                + ",\"available\":" + (available ? "true" : "false");
            locator = editorLocator_;
        }
        /* Reads the registry, so it happens off the lock. */
        const bool editor = locator && !locator().empty();
        return meta + ",\"editor\":" + (editor ? "true" : "false") + "}";
    }

    /* Where BSLEdit is, looked up by the app (registry or --editor) and cached
     * there; an empty path means the button stays hidden. */
    void setEditorLocator(std::function<fs::path()> locator) {
        std::lock_guard lock(mutex_);
        editorLocator_ = std::move(locator);
    }

    /* needsDocument is false for the authoring transforms: the page runs the
     * shared converter on data sent with the command, not on the open file. */
    /* A document capture of a large template stitches many tiles, so it may
     * take much longer than an ordinary command. */
    std::string command(const std::string& sessionId, const std::string& op, const std::string& args, bool needsDocument = true, int timeoutSeconds = 30) {
        std::unique_lock lock(mutex_);
        Session* session = findSession(sessionId);
        if (!session || (needsDocument && !session->document)) throw std::runtime_error("No preview is open. Call open_preview first.");
        if (session->pending) throw std::runtime_error("Another browser command is still running.");
        const std::string id = std::to_string(++commandId_);
        session->pending = Pending{id, op, args, false, session->revision};
        condition_.notify_all();
        const bool completed = condition_.wait_for(lock, std::chrono::seconds(timeoutSeconds), [this, &sessionId, &id] {
            const Session* current = findSession(sessionId);
            return !current || !current->pending || current->pending->id != id;
        });
        session = findSession(sessionId);
        if (!session) throw std::runtime_error("The preview was closed while a command was running.");
        if (!completed) { session->pending.reset(); throw std::runtime_error("The external browser did not answer the command in time."); }
        if (!session->lastResult || session->lastResult->id != id) throw std::runtime_error("The external browser returned no result.");
        auto result = std::move(session->lastResult->value);
        session->lastResult.reset();
        return result;
    }

    /* Some page of this preview polled the command channel within the window:
     * a hidden renderer, the user's visible window or a client-hosted browser. */
    bool pageActive(const std::string& id, std::chrono::steady_clock::duration window) const {
        std::lock_guard lock(mutex_);
        const auto found = sessions_.find(id);
        return found != sessions_.end() && found->second.lastPoll
            && std::chrono::steady_clock::now() - *found->second.lastPoll < window;
    }

    void close() {
        {
            std::lock_guard lock(mutex_);
            accepting_ = false;
            sessions_.clear();
            active_.clear();
            if (socket_ != INVALID_SOCKET) { shutdown(socket_, SD_BOTH); closesocket(socket_); socket_ = INVALID_SOCKET; }
            condition_.notify_all();
        }
        if (thread_.joinable()) thread_.join();
        if (watcher_.joinable()) watcher_.join();
        if (port_) { WSACleanup(); port_ = 0; }
    }

private:
    fs::path assets_;
    std::string token_;
    SOCKET socket_ = INVALID_SOCKET;
    unsigned short port_ = 0;
    std::thread thread_;
    mutable std::mutex mutex_;
    std::condition_variable condition_;
    bool accepting_ = false;
    std::uint64_t commandId_ = 0;
    std::uint64_t sessionCounter_ = 0;
    std::uint64_t touchCounter_ = 0;
    std::map<std::string, Session> sessions_;
    std::string active_;
    std::thread watcher_;
    std::function<bool(const fs::path&)> contextAccess_;
    std::function<fs::path()> editorLocator_;

    static Stamp stampOf(const fs::path& path) {
        std::error_code error;
        Stamp stamp;
        stamp.size = fs::file_size(path, error);
        if (error) return {};
        stamp.written = fs::last_write_time(path, error);
        if (error) return {};
        stamp.valid = true;
        return stamp;
    }

    /* The file on disk is the one source of truth this design has: the user
     * edits a form in BSLEdit, saves, and both the open page and the agent see
     * the result. Nothing travels the other way - what is not saved is nobody
     * else's business. */
    void watchLoop() {
        struct Job { std::string id; fs::path path; Stamp stamp; std::function<Document()> reloader; };
        for (;;) {
            {
                std::unique_lock lock(mutex_);
                if (condition_.wait_for(lock, std::chrono::milliseconds(500), [this] { return !accepting_; })) return;
            }
            std::vector<Job> jobs;
            {
                std::lock_guard lock(mutex_);
                for (const auto& [id, session] : sessions_) {
                    if (!session.document || !session.reloader) continue;
                    jobs.push_back({id, session.document->resolvedPath, session.stamp, session.reloader});
                }
            }
            for (const Job& job : jobs) {
                const Stamp current = stampOf(job.path);
                /* Unreadable right now (a save in flight, a lock): next tick. */
                if (!current.valid || current == job.stamp) continue;
                Document document;
                try {
                    document = job.reloader();
                } catch (const std::exception&) {
                    continue;
                }
                std::lock_guard lock(mutex_);
                Session* session = findSession(job.id);
                if (!session || !session->document) continue;
                /* setDocument may have run while the file was being read - an
                 * edit_form, edit_template or reload of its own. That revision
                 * is newer than this one, so the read is dropped and the next
                 * tick compares against the stamp it left behind; applying it
                 * would show a stale layout and report the agent's own write
                 * as an external change. */
                if (session->document->resolvedPath != job.path || !(session->stamp == job.stamp)) continue;
                session->document = std::move(document);
                /* The stamp was taken before the read: a write that lands in
                 * between differs from it and is picked up on the next tick. */
                session->stamp = current;
                ++session->revision;
                session->externalChange = true;
            }
        }
    }

    /* Callers hold mutex_. std::map keeps element addresses stable. */
    Session* findSession(const std::string& id) {
        const auto found = sessions_.find(id);
        return found == sessions_.end() ? nullptr : &found->second;
    }
    const Session* findSession(const std::string& id) const {
        const auto found = sessions_.find(id);
        return found == sessions_.end() ? nullptr : &found->second;
    }

    void acceptLoop() {
        while (true) {
            SOCKET client = accept(socket_, nullptr, nullptr);
            if (client == INVALID_SOCKET) {
                std::lock_guard lock(mutex_);
                if (!accepting_) break;
                continue;
            }
            std::thread([this, client] { handleClient(client); }).detach();
        }
    }

    static bool receiveRequest(SOCKET client, std::string& request) {
        char buffer[8192];
        request.clear();
        std::size_t expected = 0;
        bool lengthParsed = false;
        while (request.size() < 64 * 1024 * 1024) {
            const int count = recv(client, buffer, sizeof(buffer), 0);
            if (count <= 0) return false;
            request.append(buffer, count);
            const auto headers = request.find("\r\n\r\n");
            if (headers == std::string::npos) continue;
            if (!lengthParsed) {
                const auto marker = request.find("Content-Length:");
                if (marker != std::string::npos && marker < headers) {
                    const auto lineEnd = request.find('\r', marker);
                    if (lineEnd == std::string::npos) return false;
                    auto begin = marker + 15;
                    while (begin < lineEnd && (request[begin] == ' ' || request[begin] == '\t')) ++begin;
                    if (begin == lineEnd) return false;
                    expected = 0;
                    for (auto pos = begin; pos < lineEnd; ++pos) {
                        const unsigned char ch = static_cast<unsigned char>(request[pos]);
                        if (ch < '0' || ch > '9') return false;
                        const std::size_t digit = ch - '0';
                        if (expected > (64 * 1024 * 1024 - digit) / 10) return false;
                        expected = expected * 10 + digit;
                    }
                }
                lengthParsed = true;
            }
            if (request.size() >= headers + 4 + expected) return true;
        }
        return false;
    }

    void reply(SOCKET client, const std::string& response) {
        std::size_t offset = 0;
        while (offset < response.size()) {
            const int sent = send(client, response.data() + offset, static_cast<int>(std::min<std::size_t>(response.size() - offset, 1 << 20)), 0);
            if (sent <= 0) break;
            offset += sent;
        }
    }

    static constexpr const char* kEditorOrigin = "https://bslview.invalid";

    /* A request header's value, `name` in lower case; empty when absent. */
    static std::string headerValue(const std::string& head, const std::string& name) {
        std::size_t line = head.find("\r\n");
        while (line != std::string::npos && line + 2 < head.size()) {
            const std::size_t start = line + 2;
            const std::size_t end = head.find("\r\n", start);
            const std::string text = head.substr(start, end == std::string::npos ? std::string::npos : end - start);
            const auto colon = text.find(':');
            if (colon != std::string::npos) {
                std::string key = text.substr(0, colon);
                std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
                if (key == name) {
                    const auto first = text.find_first_not_of(" \t", colon + 1);
                    return first == std::string::npos ? std::string() : text.substr(first, text.find_last_not_of(" \t") - first + 1);
                }
            }
            line = end;
        }
        return {};
    }

    void handleClient(SOCKET client) {
        try {
            std::string request;
            if (!receiveRequest(client, request)) throw std::runtime_error("Bad request");
            const auto firstLineEnd = request.find("\r\n");
            const auto firstLine = request.substr(0, firstLineEnd);
            const auto firstSpace = firstLine.find(' ');
            const auto secondSpace = firstLine.find(' ', firstSpace + 1);
            const std::string method = firstLine.substr(0, firstSpace);
            const std::string target = firstLine.substr(firstSpace + 1, secondSpace - firstSpace - 1);
            const auto bodyStart = request.find("\r\n\r\n") + 4;
            const std::string body = bodyStart <= request.size() ? request.substr(bodyStart) : std::string();
            /* BSLEdit's viewer page (https://bslview.invalid) edits the
             * annotations of the preview it was launched with. Only that
             * origin and only those endpoints are opened to it; the token in
             * the path stays the secret. */
            const bool editorAnnotations = headerValue(request.substr(0, bodyStart), "origin") == kEditorOrigin
                && target.find("/annotations") != std::string::npos;
            if (editorAnnotations && method == "OPTIONS") {
                reply(client, "HTTP/1.1 204 No Content\r\nConnection: close\r\nAccess-Control-Allow-Origin: " + std::string(kEditorOrigin)
                    + "\r\nAccess-Control-Allow-Methods: GET, POST, PATCH, DELETE\r\nAccess-Control-Allow-Headers: Content-Type"
                    + "\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\nContent-Length: 0\r\n\r\n");
            } else {
                std::string response = route(method, target, body);
                if (editorAnnotations) {
                    const auto lineEnd = response.find("\r\n");
                    if (lineEnd != std::string::npos)
                        response.insert(lineEnd + 2, "Access-Control-Allow-Origin: " + std::string(kEditorOrigin) + "\r\n");
                }
                reply(client, response);
            }
        } catch (...) {
            reply(client, make_http_response(400, "text/plain; charset=utf-8", "Bad request"));
        }
        shutdown(client, SD_BOTH);
        closesocket(client);
    }

    std::string route(const std::string& method, const std::string& rawTarget, const std::string& body) {
        const auto query = rawTarget.find('?');
        const std::string pathPart = rawTarget.substr(0, query);
        const std::string prefix = "/" + token_ + "/";
        if (pathPart.rfind(prefix, 0) != 0) return make_http_response(404, "text/plain", "Not found");
        /* /<token>/<previewId>/<file>: a closed preview's link stops working,
         * including its access to configuration files. */
        const std::string rest = pathPart.substr(prefix.size());
        const auto slash = rest.find('/');
        if (slash == std::string::npos) return make_http_response(404, "text/plain", "Not found");
        const std::string sessionId = url_decode(rest.substr(0, slash));
        {
            std::lock_guard lock(mutex_);
            if (!findSession(sessionId)) return make_http_response(404, "text/plain; charset=utf-8", "The preview is closed.");
        }
        const std::string relative = url_decode(rest.substr(slash + 1));
        if (method == "GET" && relative == "state-meta.json") return make_http_response(200, "application/json; charset=utf-8", metaJson(sessionId));
        if (method == "GET" && relative == "annotations")
            return make_http_response(200, "application/json; charset=utf-8", annotationsJson(sessionId));
        if (method == "POST" && relative == "annotations") {
            try {
                return make_http_response(200, "application/json; charset=utf-8", addAnnotation(sessionId, JsonParser(body).parse()));
            } catch (const std::logic_error& error) {
                return make_http_response(409, "text/plain; charset=utf-8", error.what());
            } catch (const std::exception& error) {
                return make_http_response(400, "text/plain; charset=utf-8", error.what());
            }
        }
        if (method == "PATCH" && relative.rfind("annotations/", 0) == 0) {
            try {
                const auto updated = updateAnnotation(sessionId, relative.substr(12), JsonParser(body).parse());
                return updated
                    ? make_http_response(200, "application/json; charset=utf-8", *updated)
                    : make_http_response(404, "text/plain", "Not found");
            } catch (const std::logic_error& error) {
                return make_http_response(409, "text/plain; charset=utf-8", error.what());
            } catch (const std::exception& error) {
                return make_http_response(400, "text/plain; charset=utf-8", error.what());
            }
        }
        if (method == "DELETE" && relative == "annotations") {
            try {
                return clearAnnotations(sessionId, annotationRevision(JsonParser(body).parse()))
                    ? make_http_response(204, "text/plain", "")
                    : make_http_response(404, "text/plain", "Not found");
            } catch (const std::logic_error& error) {
                return make_http_response(409, "text/plain; charset=utf-8", error.what());
            } catch (const std::exception& error) {
                return make_http_response(400, "text/plain; charset=utf-8", error.what());
            }
        }
        if (method == "DELETE" && relative.rfind("annotations/", 0) == 0) {
            try {
                return removeAnnotation(sessionId, relative.substr(12), annotationRevision(JsonParser(body).parse()))
                    ? make_http_response(204, "text/plain", "")
                    : make_http_response(404, "text/plain", "Not found");
            } catch (const std::logic_error& error) {
                return make_http_response(409, "text/plain; charset=utf-8", error.what());
            } catch (const std::exception& error) {
                return make_http_response(400, "text/plain; charset=utf-8", error.what());
            }
        }
        if (method == "POST" && relative == "reload") {
            std::function<Document()> reloader;
            {
                std::lock_guard lock(mutex_);
                if (const Session* session = findSession(sessionId)) reloader = session->reloader;
            }
            if (!reloader) return make_http_response(404, "text/plain", "No preview");
            try {
                setDocument(sessionId, reloader());
            } catch (const std::exception& error) {
                return make_http_response(500, "text/plain; charset=utf-8", error.what());
            }
            return make_http_response(200, "application/json; charset=utf-8", metaJson(sessionId));
        }
        /* The page's "Открыть в BSLEdit" button. The editor opens the file
         * itself; nothing is handed back through this server, because a save
         * on disk is what both the page and the agent watch for. */
        if (method == "POST" && relative == "open-editor") {
            fs::path target;
            std::function<fs::path()> locator;
            {
                std::lock_guard lock(mutex_);
                const Session* session = findSession(sessionId);
                if (!session || !session->document)
                    return make_http_response(404, "text/plain; charset=utf-8", "No preview");
                target = session->document->resolvedPath;
                locator = editorLocator_;
            }
            const fs::path editor = locator ? locator() : fs::path();
            if (editor.empty())
                return make_http_response(404, "text/plain; charset=utf-8",
                                          u8"BSLEdit не найден. Выполните BSLEdit.exe --register-protocol для копии, которую считаете основной, "
                                          u8"или укажите путь ключом --editor.");
            if (!launch_editor(editor, target))
                return make_http_response(500, "text/plain; charset=utf-8",
                                          u8"Не удалось запустить BSLEdit: " + utf8_from_wide(editor.wstring()));
            return make_http_response(200, "application/json; charset=utf-8",
                                      "{\"opened\":true,\"path\":" + json_string(utf8_from_wide(target.wstring()))
                                          + ",\"editor\":" + json_string(utf8_from_wide(editor.wstring())) + "}");
        }
        if (method == "GET" && relative == "state.json") {
            if (!hasDocument(sessionId)) return make_http_response(404, "text/plain", "No preview");
            return make_http_response(200, "application/json; charset=utf-8", stateJson(sessionId));
        }
        /* The resolver's batched lookups (FormContext.createHttpIo). This
         * connection already has its own thread, and the batch fans its reads
         * out further, so one request replaces hundreds of round trips. */
        if (method == "POST" && relative == "context-batch") {
            std::function<bool(const fs::path&)> access;
            {
                std::lock_guard lock(mutex_);
                access = contextAccess_;
            }
            ContextBatchAccess batchAccess;
            batchAccess.file = [&access](const std::wstring& wide) {
                std::error_code error;
                const fs::path candidate = fs::weakly_canonical(fs::path(wide), error);
                return access && !error && candidate.is_absolute() && access(candidate)
                    && fs::is_regular_file(candidate, error);
            };
            batchAccess.directory = [&access](const std::wstring& wide) {
                std::error_code error;
                const fs::path candidate = fs::weakly_canonical(fs::path(wide), error);
                return access && !error && candidate.is_absolute() && access(candidate);
            };
            const ContextBatchResult result = HandleContextBatch(body, batchAccess);
            return make_http_response(result.status, result.contentType, result.body);
        }
        if (method == "GET" && relative == "context-file") {
            std::string encodedPath;
            bool existsOnly = false;
            const std::string queryText = query == std::string::npos ? std::string() : rawTarget.substr(query + 1);
            for (std::size_t start = 0; start <= queryText.size();) {
                const auto amp = queryText.find('&', start);
                const std::string pair = queryText.substr(start, amp == std::string::npos ? std::string::npos : amp - start);
                if (pair.rfind("p=", 0) == 0) encodedPath = pair.substr(2);
                else if (pair == "exists=1") existsOnly = true;
                if (amp == std::string::npos) break;
                start = amp + 1;
            }
            std::function<bool(const fs::path&)> access;
            {
                std::lock_guard lock(mutex_);
                access = contextAccess_;
            }
            const std::wstring wide = wide_from_utf8(url_decode(encodedPath));
            std::error_code error;
            const fs::path candidate = wide.empty() ? fs::path() : fs::weakly_canonical(fs::path(wide), error);
            const bool visible = !wide.empty() && access && !error && candidate.is_absolute()
                && access(candidate) && fs::is_regular_file(candidate, error);
            /* An existence check answers 200 with "1"/"0": resolvers check many
             * candidate locations, and a 404 per miss floods the page console. */
            if (existsOnly) return make_http_response(200, "text/plain", visible ? "1" : "0");
            if (!visible) return make_http_response(404, "text/plain", "Not found");
            std::ifstream file(candidate, std::ios::binary);
            if (!file) return make_http_response(404, "text/plain", "Not found");
            std::ostringstream bytes;
            bytes << file.rdbuf();
            return make_http_response(200, "application/octet-stream", bytes.str());
        }
        if (method == "GET" && relative == "command") {
            std::lock_guard lock(mutex_);
            Session* session = findSession(sessionId);
            if (!session) return make_http_response(204, "text/plain", "");
            session->lastPoll = std::chrono::steady_clock::now();
            auto& pending = session->pending;
            if (!pending || pending->delivered) return make_http_response(204, "text/plain", "");
            pending->delivered = true;
            return make_http_response(200, "application/json; charset=utf-8", "{\"id\":" + json_string(pending->id) + ",\"op\":" + json_string(pending->op) + ",\"args\":" + pending->args + ",\"revision\":" + std::to_string(pending->revision) + "}");
        }
        if (method == "POST" && relative == "result") {
            const Json payload = JsonParser(body).parse();
            const std::string id = payload.get("id") ? payload.get("id")->asString() : std::string();
            std::lock_guard lock(mutex_);
            Session* session = findSession(sessionId);
            if (session && session->pending && session->pending->id == id) {
                if (!payload.get("ok") || !payload.get("ok")->asBool()) {
                    const std::string error = payload.get("error") ? payload.get("error")->asString("Browser command failed") : "Browser command failed";
                    session->lastResult = Result{id, "{\"error\":" + json_string(error) + "}"};
                } else {
                    session->lastResult = Result{id, payload.get("value") ? payload.get("value")->dump() : "{}"};
                }
                session->pending.reset();
                condition_.notify_all();
            }
            return make_http_response(204, "text/plain", "");
        }
        if (method != "GET") return make_http_response(404, "text/plain", "Not found");
        const fs::path root = fs::weakly_canonical(assets_);
        /* The decoded target is UTF-8; a narrow fs::path reads it in the ANSI
         * code page and loses Cyrillic names such as std-pictures/Печать.png. */
        const fs::path candidate = fs::weakly_canonical(root / fs::path(wide_from_utf8(relative.empty() ? "index.html" : relative)));
        if (candidate != root && candidate.native().rfind(root.native() + fs::path::preferred_separator, 0) != 0) return make_http_response(403, "text/plain", "Forbidden");
        std::ifstream input(candidate, std::ios::binary);
        if (!input) return make_http_response(404, "text/plain", "Not found");
        std::ostringstream content;
        content << input.rdbuf();
        return make_http_response(200, mime_type(candidate), content.str());
    }
};

struct Options {
    fs::path base;
    std::vector<fs::path> roots;
    bool allowAnyPath = false;
    bool openBrowser = true;
    bool openInVsCode = false;
    std::wstring vscodeUriScheme = L"vscode";
    std::size_t maxBytes = 64 * 1024 * 1024;
    /* The template editing tools; --no-template-edit-tools hides them for agents
     * that edit templates through their own skills. Viewing, xlsx conversion and
     * reading a template's markup stay available. */
    bool templateEditTools = true;
    /* edit_form; --no-form-edit-tools hides it. list_form_elements and
     * validate_form stay available. */
    bool formEditTools = true;
    /* BSLEdit for the preview page's "open in the editor" button; empty means
     * the registration BSLEdit writes for its bsledit: protocol is used. */
    fs::path editor;
    /* An explicit --editor that exists also decides what a preview meant for
     * the user opens in: the editor instead of a browser window. Only the flag
     * does this, never the registry lookup - an installed BSLEdit must not
     * quietly take every preview away from the browser. A preview for the
     * agent stays headless either way: inspect, select, scroll and
     * capture_preview all run in the page. */
    bool editorPresents = false;
    /* --assets: a working copy of the preview interface, for developing it
     * without relinking the server. Empty means the embedded one. */
    fs::path assets;
};

const int kEmbeddedAssetsResourceId = 201;

/* Where the preview page is read from. --assets and an app\web directory
 * beside the executable come first and exist for development; a copy of the
 * executable on its own finds neither and unpacks what is linked into it. */
fs::path resolve_assets(const Options& options) {
    std::error_code error;
    if (!options.assets.empty()) {
        if (!fs::is_regular_file(options.assets / L"index.html", error))
            throw std::runtime_error("--assets has no index.html: " + options.assets.string());
        return options.assets;
    }
    const fs::path beside = options.base / L"app" / L"web";
    if (fs::is_regular_file(beside / L"index.html", error)) return beside;
    std::wstring failure;
    const std::wstring unpacked = embedded_assets::Extract(
        GetModuleHandleW(nullptr), kEmbeddedAssetsResourceId, L"1c-form-viewer", &failure);
    if (unpacked.empty())
        throw std::runtime_error("Cannot prepare the preview interface: " + utf8_from_wide(failure)
            + ". It is unpacked into %LOCALAPPDATA%\\1c-form-viewer; pass --assets DIR to use a directory instead.");
    return fs::path(unpacked);
}

/* The bsledit: protocol handler names the editor. BSLEdit claims it only when
 * the registration is free, dead or already its own, so a temporary build cannot
 * take it over; --register-protocol moves it deliberately. */
fs::path locate_bsledit(const Options& options) {
    std::error_code error;
    if (!options.editor.empty())
        return fs::is_regular_file(options.editor, error) ? options.editor : fs::path();
    static const wchar_t* key = L"Software\\Classes\\bsledit\\shell\\open\\command";
    DWORD size = 0;
    if (RegGetValueW(HKEY_CURRENT_USER, key, nullptr, RRF_RT_REG_SZ, nullptr, nullptr, &size) != ERROR_SUCCESS || !size)
        return {};
    std::wstring value(size / sizeof(wchar_t), L'\0');
    if (RegGetValueW(HKEY_CURRENT_USER, key, nullptr, RRF_RT_REG_SZ, nullptr, value.data(), &size) != ERROR_SUCCESS)
        return {};
    value.resize(wcsnlen(value.c_str(), value.size()));
    /* "C:\\Tools\\BSLEdit.exe" "%1" */
    std::wstring executable;
    if (!value.empty() && value.front() == L'"') {
        const auto end = value.find(L'"', 1);
        if (end == std::wstring::npos) return {};
        executable = value.substr(1, end - 1);
    } else {
        executable = value.substr(0, value.find(L' '));
    }
    return fs::is_regular_file(executable, error) ? fs::path(executable) : fs::path();
}

bool validUriScheme(const std::wstring& value) {
    if (value.empty() || !iswalpha(value.front())) return false;
    return std::all_of(value.begin() + 1, value.end(), [](wchar_t character) {
        return iswalnum(character) || character == L'+' || character == L'-' || character == L'.';
    });
}

bool openPreviewUrl(const Options& options, const std::string& url) {
    if (options.openInVsCode) {
        const std::string handler = utf8_from_wide(options.vscodeUriScheme)
            + "://alonehobo.1c-form-viewer-vscode/open-preview?url="
            + url_encode_component(url);
        return reinterpret_cast<INT_PTR>(ShellExecuteW(nullptr, L"open", wide_from_utf8(handler).c_str(),
            nullptr, nullptr, SW_SHOWNORMAL)) > 32;
    } else if (options.openBrowser) {
        return reinterpret_cast<INT_PTR>(ShellExecuteW(nullptr, L"open", wide_from_utf8(url).c_str(),
            nullptr, nullptr, SW_SHOWNORMAL)) > 32;
    }
    return false;
}

/* The default presentation. The preview page runs in a headless Edge or Chrome,
 * so inspect/capture work without putting a window in front of the user; a
 * visible window opens only for open_preview show=true. The browser lives in a
 * kill-on-close job and cannot outlive this server even when the MCP client
 * kills the process. Its own profile keeps it from handing the URL over to the
 * user's already running browser. */
class HeadlessBrowser {
public:
    HeadlessBrowser() = default;
    HeadlessBrowser(const HeadlessBrowser&) = delete;
    HeadlessBrowser& operator=(const HeadlessBrowser&) = delete;
    ~HeadlessBrowser() { stop(); }

    static fs::path locate() {
        std::error_code error;
        for (const wchar_t* name : {L"msedge.exe", L"chrome.exe"}) {
            const std::wstring key = std::wstring(L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\") + name;
            for (HKEY hive : {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE}) {
                DWORD size = 0;
                if (RegGetValueW(hive, key.c_str(), nullptr, RRF_RT_REG_SZ, nullptr, nullptr, &size) != ERROR_SUCCESS || !size) continue;
                std::wstring value(size / sizeof(wchar_t), L'\0');
                if (RegGetValueW(hive, key.c_str(), nullptr, RRF_RT_REG_SZ, nullptr, value.data(), &size) != ERROR_SUCCESS) continue;
                value.resize(wcsnlen(value.c_str(), value.size()));
                value.erase(std::remove(value.begin(), value.end(), L'"'), value.end());
                if (!value.empty() && fs::is_regular_file(value, error)) return value;
            }
        }
        static const std::pair<const wchar_t*, const wchar_t*> fallbacks[] = {
            {L"ProgramFiles(x86)", L"Microsoft\\Edge\\Application\\msedge.exe"},
            {L"ProgramFiles", L"Microsoft\\Edge\\Application\\msedge.exe"},
            {L"LOCALAPPDATA", L"Google\\Chrome\\Application\\chrome.exe"},
            {L"ProgramFiles", L"Google\\Chrome\\Application\\chrome.exe"},
        };
        for (const auto& [variable, relative] : fallbacks) {
            const wchar_t* base = _wgetenv(variable);
            if (base && fs::is_regular_file(fs::path(base) / relative, error)) return fs::path(base) / relative;
        }
        return {};
    }

    bool running() const {
        if (!job_) return false;
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info{};
        return QueryInformationJobObject(job_, JobObjectBasicAccountingInformation, &info, sizeof(info), nullptr)
            && info.ActiveProcesses > 0;
    }

    bool start(const std::string& url) {
        stop();
        const fs::path browser = locate();
        if (browser.empty()) return false;
        std::error_code error;
        profile_ = fs::temp_directory_path(error) / (L"1c-form-viewer-headless-" + std::to_wstring(GetCurrentProcessId()));
        fs::create_directories(profile_, error);
        std::wstring commandLine = L"\"" + browser.wstring() + L"\" --headless=new --no-first-run"
            L" --no-default-browser-check --disable-extensions --disable-sync --disable-background-networking"
            L" --window-size=1280,900 --user-data-dir=\"" + profile_.wstring() + L"\" \"" + wide_from_utf8(url) + L"\"";
        job_ = CreateJobObjectW(nullptr, nullptr);
        if (!job_) return false;
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(job_, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        PROCESS_INFORMATION process{};
        /* No inherited handles: stdout is the MCP channel. Suspended until it is
         * in the job, so no browser child can escape it. */
        if (!CreateProcessW(nullptr, commandLine.data(), nullptr, nullptr, FALSE,
                CREATE_SUSPENDED | CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) {
            stop();
            return false;
        }
        if (!AssignProcessToJobObject(job_, process.hProcess)) {
            TerminateProcess(process.hProcess, 1);
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            stop();
            return false;
        }
        ResumeThread(process.hThread);
        CloseHandle(process.hThread);
        process_ = process.hProcess;
        return true;
    }

    void stop() {
        if (job_) { TerminateJobObject(job_, 0); CloseHandle(job_); job_ = nullptr; }
        if (process_) { WaitForSingleObject(process_, 3000); CloseHandle(process_); process_ = nullptr; }
        if (!profile_.empty()) { std::error_code error; fs::remove_all(profile_, error); profile_.clear(); }
    }

private:
    HANDLE job_ = nullptr;
    HANDLE process_ = nullptr;
    fs::path profile_;
};

bool inside(const fs::path& root, const fs::path& candidate) {
    const auto rootText = lower_wide(fs::weakly_canonical(root).wstring());
    const auto candidateText = lower_wide(fs::weakly_canonical(candidate).wstring());
    return candidateText == rootText || candidateText.rfind(rootText + L'\\', 0) == 0;
}

bool allowed(const Options& options, const fs::path& candidate) {
    return options.allowAnyPath
        || std::any_of(options.roots.begin(), options.roots.end(), [&](const fs::path& root) { return inside(root, candidate); });
}

void assertAllowed(const Options& options, const fs::path& candidate) {
    if (allowed(options, candidate)) return;
    throw std::runtime_error(
        "Path is outside the allowed roots: " + utf8_from_wide(candidate.wstring())
        + ". Add its parent directory with --root PATH, or launch the server with --allow-any-path.");
}

struct DocumentPaths {
    fs::path requested;
    fs::path resolved;
};

DocumentPaths resolveDocument(const Options& options, const std::string& input) {
    const std::wstring wide = wide_from_utf8(input);
    if (wide.empty()) throw std::runtime_error("The path must be valid UTF-8.");
    fs::path requested(wide);
    if (requested.is_relative()) requested = fs::current_path() / requested;
    requested = fs::weakly_canonical(requested);
    assertAllowed(options, requested);
    if (!fs::is_regular_file(requested)) throw std::runtime_error("File does not exist: " + input);
    if (lower_wide(requested.extension().wstring()) != L".xml"
            && lower_wide(requested.extension().wstring()) != L".form"
            && lower_wide(requested.extension().wstring()) != L".mxl"
            && lower_wide(requested.extension().wstring()) != L".mxlx") throw std::runtime_error("Unsupported file extension.");
    fs::path resolved = requested;
    if (lower_wide(requested.extension().wstring()) == L".xml"
        && lower_wide(requested.parent_path().filename().wstring()) == L"forms") {
        const auto form = fs::weakly_canonical(requested.parent_path() / requested.stem() / L"Ext" / L"Form.xml");
        if (fs::is_regular_file(form)) {
            /* The descriptor itself is allowed, but a junction below it may
             * point outside the root. Canonicalise and validate the actual
             * layout independently before reading it. */
            assertAllowed(options, form);
            resolved = form;
        }
    }
    return {requested, resolved};
}

Document loadDocument(const Options& options, const std::string& input) {
    Document document;
    const auto paths = resolveDocument(options, input);
    document.requestedPath = paths.requested;
    document.resolvedPath = paths.resolved;
    document.content = read_text_file(document.resolvedPath, options.maxBytes, document.encoding);
    document.size = fs::file_size(document.resolvedPath);
    return document;
}

std::string documentKind(const fs::path& resolvedPath, const std::string& content);

/* open_preview with base_path: the file at path compared with base_path, the
 * earlier version (a copy from git, another branch or configuration). */
/* base_revision: the same file as git holds it at a revision, read with
 * BSLEdit's git code (gitquery.cpp) - "index" or an empty name for what is
 * staged, otherwise anything git accepts: HEAD, HEAD~2, a branch, a tag, a sha. */
Document loadRevision(const Options& options, const Document& document, const std::string& revision) {
    const std::wstring rev = revision == "index" ? std::wstring() : wide_from_utf8(revision);
    if (!git::ValidRevision(rev)) throw std::runtime_error("base_revision is not a valid git revision name: " + revision);
    if (git::Executable().empty()) throw std::runtime_error("base_revision needs git: git.exe was not found in PATH.");
    git::FileInfo info = git::Describe(document.resolvedPath.wstring(), 1);
    if (!info.ok) throw std::runtime_error("base_revision: " + utf8_from_wide(info.error) + ": " + utf8_from_wide(document.resolvedPath.wstring()));
    const git::RunResult shown = git::Run(info.root, {L"show", rev + L":" + info.relative}, options.maxBytes + 1, 15000);
    if (!shown.started) throw std::runtime_error("base_revision: git could not be started.");
    if (shown.timedOut) throw std::runtime_error("base_revision: git did not answer in time.");
    if (shown.code != 0)
        throw std::runtime_error(rev.empty() ? "base_revision: the file is not in the git index."
                                             : "base_revision: git has no such revision of this file: " + revision
                                                   + " (" + utf8_from_wide(info.relative) + ").");
    if (shown.out.size() > options.maxBytes) throw std::runtime_error("base_revision: that version of the file is too large.");
    Document base;
    base.requestedPath = document.resolvedPath;
    base.resolvedPath = document.resolvedPath;
    base.content = utf8_from_wide(decode_text_bytes(reinterpret_cast<const unsigned char*>(shown.out.data()),
                                                        shown.out.size(), base.encoding));
    base.baseRevision = revision.empty() ? "index" : revision;
    if (!rev.empty()) {
        /* The page names the commit, not only the ref: "HEAD" says nothing
         * about which version it is. */
        const git::RunResult described = git::Run(info.root,
            {L"log", L"-1", L"--date=format:%d.%m.%Y %H:%M", L"--format=%h %ad %s", rev, L"--"}, 4096, 15000);
        if (described.started && !described.timedOut && described.code == 0) {
            std::string line = described.out;
            while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
            base.baseDescription = line;
        }
    }
    return base;
}

Document loadComparison(const Options& options, const std::string& input, const std::string& baseInput,
                        const std::string& baseRevision = {}) {
    Document document = loadDocument(options, input);
    if (!baseInput.empty() && !baseRevision.empty()) throw std::runtime_error("Pass either base_path or base_revision, not both.");
    if (!baseRevision.empty()) {
        Document base = loadRevision(options, document, baseRevision);
        if (lower_wide(document.resolvedPath.extension().wstring()) == L".mxl")
            throw std::runtime_error("base_revision: a binary MXL file cannot be compared; use Template.xml.");
        document.hasBase = true;
        document.basePath = base.resolvedPath;
        document.baseRevision = base.baseRevision;
        document.baseDescription = base.baseDescription;
        document.baseContent = std::move(base.content);
        return document;
    }
    if (baseInput.empty()) return document;
    Document base = loadDocument(options, baseInput);
    if (lower_wide(document.resolvedPath.extension().wstring()) == L".mxl"
        || lower_wide(base.resolvedPath.extension().wstring()) == L".mxl")
        throw std::runtime_error("base_path: a binary MXL file cannot be compared; use Template.xml.");
    const std::string kind = documentKind(document.resolvedPath, document.content);
    const std::string baseKind = documentKind(base.resolvedPath, base.content);
    if (kind != baseKind)
        throw std::runtime_error("base_path must be the same kind of document as path: " + baseKind + " vs " + kind + ".");
    document.hasBase = true;
    document.basePath = base.resolvedPath;
    document.baseContent = std::move(base.content);
    return document;
}

/* A path an authoring tool reads or writes: absolute, canonical, inside the
 * allowed roots and with the expected extension. */
fs::path resolveAuthoringPath(const Options& options, const std::string& input, const wchar_t* extension, bool mustExist) {
    const std::wstring wide = wide_from_utf8(input);
    if (wide.empty()) throw std::runtime_error("The path must be a non-empty UTF-8 string.");
    fs::path path(wide);
    if (path.is_relative()) path = fs::current_path() / path;
    path = fs::weakly_canonical(path);
    assertAllowed(options, path);
    if (lower_wide(path.extension().wstring()) != extension)
        throw std::runtime_error("Expected a " + utf8_from_wide(extension) + " file: " + input);
    if (mustExist && !fs::is_regular_file(long_path(path))) throw std::runtime_error("File does not exist: " + input);
    return path;
}

/* A form is edited in Ext/Form.xml; accept the Forms/Name.xml descriptor too. */
fs::path resolveFormXml(const Options& options, const std::string& input) {
    fs::path path = resolveAuthoringPath(options, input, L".xml", true);
    if (lower_wide(path.filename().wstring()) != L"form.xml") {
        fs::path nested = path.parent_path() / path.stem() / L"Ext" / L"Form.xml";
        if (fs::is_regular_file(nested)) {
            assertAllowed(options, nested);
            path = nested;
        }
    }
    return path;
}

std::vector<unsigned char> read_binary_file(const fs::path& rawPath, std::size_t maxBytes) {
    const fs::path path = long_path(rawPath);
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("Could not open " + utf8_from_wide(path.wstring()));
    input.seekg(0, std::ios::end);
    const auto length = input.tellg();
    if (length < 0 || static_cast<std::uintmax_t>(length) > maxBytes) throw std::runtime_error("File is too large: " + utf8_from_wide(path.wstring()));
    input.seekg(0, std::ios::beg);
    std::vector<unsigned char> bytes(static_cast<std::size_t>(length));
    if (!bytes.empty()) input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    return bytes;
}

/* Write through a sibling temp file and a rename, so a failed write never
 * leaves a half-written template behind. */
void write_file_replacing(const fs::path& rawPath, const std::string& bytes) {
    const fs::path path = long_path(rawPath);
    std::error_code error;
    fs::create_directories(path.parent_path(), error);
    fs::path temp = path;
    temp += L".tmp-" + wide_from_utf8(random_token().substr(0, 8));
    {
        std::ofstream output(temp, std::ios::binary | std::ios::trunc);
        if (!output) throw std::runtime_error("Could not write " + utf8_from_wide(path.wstring()));
        output.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
        if (!output) { output.close(); fs::remove(temp, error); throw std::runtime_error("Could not write " + utf8_from_wide(path.wstring())); }
    }
    if (!MoveFileExW(temp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        fs::remove(temp, error);
        throw std::runtime_error("Could not replace " + utf8_from_wide(path.wstring()));
    }
}

std::string argString(const Json* args, const std::string& name) { const auto* value = args && args->kind == Json::Kind::Object ? args->get(name) : nullptr; return value ? value->asString() : std::string(); }
bool argBool(const Json* args, const std::string& name) { const auto* value = args && args->kind == Json::Kind::Object ? args->get(name) : nullptr; return value && value->asBool(); }

/* A data composition schema is also stored as Template.xml; its root element
 * tells it apart from a spreadsheet template. */
std::string documentKind(const fs::path& resolvedPath, const std::string& content) {
    const auto filename = lower_wide(resolvedPath.filename().wstring());
    if (filename == L"form.xml" || lower_wide(resolvedPath.extension().wstring()) == L".form") return "managed-form";
    if (content.substr(0, 1024).find("<DataCompositionSchema") != std::string::npos) return "dcs";
    if (filename == L"template.xml" || lower_wide(resolvedPath.extension().wstring()) == L".mxlx") return "spreadsheet-template";
    if (lower_wide(resolvedPath.extension().wstring()) == L".mxl") return "mxl";
    return "xml";
}

std::string viewingToolSchemas() {
    return u8R"JSON({"name":"open_preview","description":"Render a visual preview of a 1C managed form (Form.xml, Form.form), spreadsheet template (Template.xml, .mxlx), data composition schema (СКД, Template.xml with a DataCompositionSchema root) or MXL file. Use it whenever the user wants to show a 1C form visually or see how a form or template looks (\"покажи форму\", \"открой форму\", \"как выглядит макет\"); do not show XML source and do not launch 1C:Enterprise or the configurator. A descriptor Forms/Name.xml resolves to Forms/Name/Ext/Form.xml. audience is required: \"user\" when the user asked to show or open it (a window on their screen); \"agent\" when only you need it, e.g. to check your own edit (a hidden browser the user never sees; your capture_preview images do not reach the user either). Each file gets its own preview_id and URL; earlier previews stay open and reopening a file reuses its preview. base_path or base_revision shows changes instead of the plain preview.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Form.xml, Form.form, a Forms/Name.xml descriptor, Template.xml (spreadsheet template or data composition schema), .mxlx or .mxl; absolute or workspace-relative."},"audience":{"type":"string","enum":["user","agent"],"description":"user: the user asked to see it, a window opens on their screen. agent: your own inspection, rendered hidden."},"interface_mode":{"type":"string","enum":["Auto","Taxi","Version85"],"description":"Managed forms: Auto (default) infers the interface from the form; Taxi forces the legacy interface, Version85 the clean 8.5 one."},"base_path":{"type":"string","description":"Earlier version of the same form, Template.xml or data composition schema (e.g. a copy from git or another configuration). The preview then shows what changed from base_path to path: changed properties, moved, added and removed items, cells and areas, side by side where possible."},"base_revision":{"type":"string","description":"Compare with the same file in git instead of base_path: HEAD, HEAD~1, a branch, tag or commit, or index for the staged version. Needs a git working tree and git.exe on PATH."}},"required":["path","audience"]},"outputSchema":{"type":"object","properties":{"requestedPath":{"type":"string"},"resolvedPath":{"type":"string"},"path":{"type":"string"},"previewId":{"type":"string"},"audience":{"type":"string","enum":["user","agent"]},"previewUrl":{"type":"string"},"presentation":{"type":"string","enum":["hidden","window","editor","client","unavailable"]},"kind":{"type":"string","enum":["managed-form","spreadsheet-template","dcs","mxl","xml"]},"size":{"type":"integer"},"encoding":{"type":"string"}},"required":["requestedPath","resolvedPath","previewUrl","kind","size","encoding"]},"annotations":{"readOnlyHint":true}},{"name":"preview","description":"Act on an open 1C preview; open it with open_preview first. preview_id picks the preview, the last used one by default. Operations:\ninspect — page and element ids, captions, visibility, nesting, tabs and scroll areas (narrow with query, visible_only); run it first to learn ids.\nswitch_tab — activate page_id (pages_id for a nested page set).\nselect — reveal the pages holding element_id, highlight it and scroll it into view.\nscroll — move target by delta_x/delta_y or to x/y, in pixels; element_id picks the table or spreadsheet field.\nreload — re-read the file after it changed, keeping the view.\nannotations — the user's open annotations on this preview; include_resolved adds the resolved ones.\nresolve_annotation — after handling annotation_id, mark it resolved with a short resolution; the user accepts or reopens it. Never delete the user's annotations.\nadd_annotation — pin an annotation for the user on element_id (a spreadsheet cell rNcM, to_element_id for a range) with text, to point something out; element_name labels it in the list.\nremove_annotation — delete annotation_id, only one you added.\nurl — URL of this preview and of every open one.\nclose — close preview_id, or every preview when omitted; source files are not touched.\nAnnotations (\"аннотации\", \"пометки\" in a form or template) always mean these operations: they live in the preview, not in Form.xml or Template.xml, so never add cell notes or comments to the file for them. To add some for the user: open_preview with audience=\"user\", inspect for ids (cells are rNcM), then add_annotation.","inputSchema":{"type":"object","properties":{"operation":{"type":"string","enum":["inspect","switch_tab","select","scroll","reload","annotations","resolve_annotation","add_annotation","remove_annotation","url","close"]},"preview_id":{"type":"string","description":"Preview to act on, from open_preview; the last used preview by default."},"query":{"type":"string","description":"inspect: narrow the listing to matching names and captions."},"visible_only":{"type":"boolean","description":"inspect: skip hidden elements."},"page_id":{"type":"string","description":"switch_tab: the page to activate."},"pages_id":{"type":"string","description":"switch_tab: the nested page set that owns page_id."},"element_id":{"type":"string","description":"select: the element to highlight; scroll: the table or spreadsheet field to move."},"target":{"type":"string","enum":["document","active-page","table","spreadsheet"],"description":"scroll: what to move."},"delta_x":{"type":"number"},"delta_y":{"type":"number"},"x":{"type":"number"},"y":{"type":"number"},"include_resolved":{"type":"boolean","description":"annotations: also list the resolved ones."},"annotation_id":{"type":"string","description":"resolve_annotation, remove_annotation: the id from operation=annotations."},"text":{"type":"string","description":"add_annotation: the note for the user."},"to_element_id":{"type":"string","description":"add_annotation: last cell of a spreadsheet range, rNcM."},"element_name":{"type":"string","description":"add_annotation: how the list names the element; cells are named R1C1 by default."},"resolution":{"type":"string","description":"resolve_annotation: what you changed, shown to the user next to the note."}},"required":["operation"]},"annotations":{"readOnlyHint":true}},{"name":"capture_preview","description":"Take a PNG of an open 1C preview after navigating with preview (switch_tab, select, scroll). The image comes back to you only; to show the user, open the preview with audience=\"user\".","inputSchema":{"type":"object","properties":{"preview_id":{"type":"string","description":"Preview to act on, from open_preview; the last used preview by default."},"scope":{"type":"string","description":"viewport (default), document — the whole page, or element — element_id only.","enum":["viewport","document","element"]},"element_id":{"type":"string","description":"scope=element: an element id from preview operation=inspect."}}},"annotations":{"readOnlyHint":true}})JSON";
}

/* Tools that convert and read a spreadsheet template (Template.xml): always on. */
std::string templateToolSchemas() {
    return u8R"JSON({"name":"convert_xlsx_to_template","description":"Convert an Excel print form layout (.xlsx) into a 1C spreadsheet template Ext/Template.xml and open its preview. Keeps text, fonts, colors, fills, borders, alignment, sizes, merges and headers/footers; Excel defined names become named areas, a cell of exactly [Name] becomes a parameter, text containing [Name] a template. The result lists areas, parameters and what was not converted; check it with capture_preview and list_markup, then refine areas and parameters with edit_template.","inputSchema":{"type":"object","properties":{"xlsx_path":{"type":"string","description":"Path to the .xlsx workbook."},"output_path":{"type":"string","description":"Path of the Template.xml to write, for example Templates/ПФ_MXL_Акт/Ext/Template.xml."},"sheet":{"type":"string","description":"Sheet name; the first visible sheet by default."},"overwrite":{"type":"boolean","description":"Replace an existing output file. Default false."}},"required":["xlsx_path","output_path"]},"annotations":{"readOnlyHint":false,"destructiveHint":false}},{"name":"list_markup","description":"List the markup of a 1C spreadsheet template (Template.xml): named areas with their rows/columns, parameter and template cells, all 1-based as the preview shows them.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Path to Template.xml."}},"required":["path"]},"annotations":{"readOnlyHint":true}},{"name":"validate_template","description":"Check a 1C spreadsheet template (Template.xml) for broken structure: dangling format, font or line references, cells and merges outside the grid or column set, malformed or duplicate named areas, parameter cells without names. Run it after a series of edits.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Path to Template.xml."}},"required":["path"]},"annotations":{"readOnlyHint":true}})JSON";
}

/* The one tool that changes a template; --no-template-edit-tools leaves it out. */
std::string templateEditToolSchemas() {
    return u8R"JSON({"name":"edit_template","description":"Edit a 1C spreadsheet template (Template.xml) in place: path, operation and that operation's arguments. Rows and columns are 1-based as in the preview. An open preview of the file refreshes; check it with capture_preview and run validate_template after a series of edits. Operations:\nset_area — name and begin_row/end_row and/or begin_column/end_column (rows only → Rows area, columns only → Columns, both → Rectangle); remove=true deletes the area.\nset_parameter — row, column and one of name, template or text; detail alone or with them.\nset_format — row, column (to_row/to_column for a range) and any of font, alignments, text_placement, indent, colors, borders, format, protection; null resets a property.\ninsert_rows, delete_rows, insert_columns, delete_columns — at, count, columns_id; merges, areas and drawings move with the grid.\nmerge_cells — row, column, rows, columns; unmerge=true splits.\nset_size — column (+to_column) with width, or row (+to_row) with height.\nset_print_settings — orientation, scale, fit_to_page, paper, copies, black_and_white, first_page_number, margins, header_size, footer_size, print_area.\nset_header_footer — kind, left/center/right texts, font; remove=true deletes it.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Path to Template.xml."},"operation":{"type":"string","enum":["set_area","set_parameter","set_format","insert_rows","delete_rows","insert_columns","delete_columns","merge_cells","set_size","set_print_settings","set_header_footer"]},"name":{"type":"string","description":"set_area: area name; set_parameter: parameter name. A 1C identifier."},"begin_row":{"type":"integer","minimum":1},"end_row":{"type":"integer","minimum":1},"begin_column":{"type":"integer","minimum":1},"end_column":{"type":"integer","minimum":1},"remove":{"type":"boolean","description":"set_area: remove the named area; set_header_footer: remove the header or footer."},"row":{"type":"integer","description":"The cell row (set_parameter, set_format, merge_cells) or the first row to size (set_size).","minimum":1},"column":{"type":"integer","description":"The cell column (set_parameter, set_format, merge_cells) or the first column to size (set_size).","minimum":1},"template":{"type":"string","description":"Text with [Name] parameters, for example «Счёт № [Номер] от [Дата]»."},"text":{"type":"string","description":"Plain text for the cell."},"detail":{"type":"string","description":"Drill-down parameter name; empty string removes it."},"to_row":{"type":"integer","description":"set_format, set_size: last row of the range.","minimum":1},"to_column":{"type":"integer","description":"set_format, set_size: last column of the range.","minimum":1},"font":{"anyOf":[{"type":"object","properties":{"face":{"type":"string"},"size":{"type":"number"},"bold":{"type":"boolean"},"italic":{"type":"boolean"},"underline":{"type":"boolean"},"strikeout":{"type":"boolean"}}},{"type":"null"}],"description":"set_format, set_header_footer: font changes; null (set_format) returns to the inherited font."},"horizontal_alignment":{"anyOf":[{"type":"string","enum":["Left","Center","Right","Justify","Auto"]},{"type":"null"}]},"vertical_alignment":{"anyOf":[{"type":"string","enum":["Top","Center","Bottom"]},{"type":"null"}]},"text_placement":{"anyOf":[{"type":"string","enum":["Auto","Wrap","Cut","Block"]},{"type":"null"}]},"indent":{"anyOf":[{"type":"integer","minimum":0},{"type":"null"}]},"text_color":{"anyOf":[{"type":"string"},{"type":"null"}],"description":"#RRGGBB or style:/web:/win:Name."},"back_color":{"anyOf":[{"type":"string"},{"type":"null"}],"description":"As text_color."},"border_color":{"anyOf":[{"type":"string"},{"type":"null"}],"description":"As text_color."},"border":{"description":"Line: a style name (None, Solid, Dotted, Dashed, DashDotted, DashDottedDotted, ThinDashed, LargeDashed, ThickDashed, Double) or { style, width }.","anyOf":[{"type":"string"},{"type":"object","properties":{"style":{"type":"string"},"width":{"type":"integer","minimum":1}}},{"type":"null"}]},"left_border":{"description":"As border, for one side."},"top_border":{"description":"As border, for one side."},"right_border":{"description":"As border, for one side."},"bottom_border":{"description":"As border, for one side."},"format":{"anyOf":[{"type":"string"},{"type":"null"}],"description":"1C format string, e.g. ЧДЦ=2 or ДФ=dd.MM.yyyy."},"protection":{"type":"boolean","description":"set_format: protect the cell from editing."},"at":{"type":"integer","minimum":1,"description":"Insert before this row/column, or delete starting from it."},"count":{"type":"integer","minimum":1,"description":"Rows or columns to insert or delete; 1 by default."},"columns_id":{"type":"string","description":"Column set id for column edits; the default set when omitted."},"rows":{"type":"integer","description":"merge_cells: height of the merged block in rows.","minimum":1},"columns":{"type":"integer","description":"merge_cells: width of the merged block in columns.","minimum":1},"unmerge":{"type":"boolean","description":"merge_cells: split the merge starting at row, column."},"width":{"type":"number","description":"set_size: column width in template units.","minimum":0},"height":{"type":"number","description":"set_size: row height in points; 0 = automatic.","minimum":0},"orientation":{"type":"string","enum":["Portrait","Landscape"]},"scale":{"type":"integer","description":"set_print_settings: percent.","minimum":10,"maximum":400},"fit_to_page":{"type":"boolean"},"paper":{"type":"integer","description":"set_print_settings: paper size code as in Windows/Excel, 9 = A4.","minimum":0},"copies":{"type":"integer","minimum":0},"black_and_white":{"type":"boolean"},"first_page_number":{"type":"integer","minimum":0},"top_margin":{"type":"number","description":"set_print_settings: mm, like the other margins and header_size/footer_size.","minimum":0},"left_margin":{"type":"number","minimum":0},"bottom_margin":{"type":"number","minimum":0},"right_margin":{"type":"number","minimum":0},"header_size":{"type":"number","minimum":0},"footer_size":{"type":"number","minimum":0},"print_area":{"anyOf":[{"type":"object","properties":{"begin_row":{"type":"integer","minimum":1},"end_row":{"type":"integer","minimum":1},"begin_column":{"type":"integer","minimum":1},"end_column":{"type":"integer","minimum":1}}},{"type":"null"}],"description":"set_print_settings: the printed range; null clears it."},"kind":{"type":"string","description":"set_header_footer: which one to change.","enum":["header","footer"]},"left":{"type":"string","description":"set_header_footer: text; fields [&НомерСтраницы], [&СтраницВсего], [&Дата], [&Время]."},"center":{"type":"string"},"right":{"type":"string"}},"required":["path","operation"]},"annotations":{"readOnlyHint":false,"destructiveHint":true}})JSON";
}

/* Tools that read a managed form (Ext/Form.xml): always on. */
std::string formToolSchemas() {
    return u8R"JSON({"name":"list_form_elements","description":"List the items of a 1C managed form (Ext/Form.xml or its Forms/Name.xml descriptor) as a tree: name, kind (InputField, UsualGroup, Page, Table, Button…), parent and data path. edit_form addresses items by these names.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Path to Ext/Form.xml or the Forms/Name.xml descriptor."}},"required":["path"]},"annotations":{"readOnlyHint":true}},{"name":"validate_form","description":"Check a 1C managed form (Ext/Form.xml) for broken structure: duplicate ids, missing companion nodes (ContextMenu, ExtendedTooltip…), data paths without a form attribute, buttons without a command, events without a handler, main attribute count, format version. Run it after a series of edits.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Path to Ext/Form.xml or the Forms/Name.xml descriptor."}},"required":["path"]},"annotations":{"readOnlyHint":true}})JSON";
}

/* The tool that changes a form; --no-form-edit-tools leaves it out. */
std::string formEditToolSchemas() {
    return u8R"JSON({"name":"edit_form","description":"Edit a 1C managed form (Ext/Form.xml) in place: path, operation and that operation's arguments. Items are addressed by name (list_form_elements or preview operation=inspect); only the touched nodes change. An open preview of the file refreshes; check it with capture_preview and run validate_form after a series of edits. Handlers in the form module are never created or removed. Operations:\nset_properties — element (omit or Form for the form itself) and properties.\nadd_element — element (the new name), kind, into and/or after/before, optional properties; companion nodes and ids are generated.\nmove_element — element, into and/or after/before.\nremove_element — element with its companions and nested items.\nset_attribute — name, type, optional columns, title, main, saved_data, fill_check; remove=true deletes it.\nset_command — name, action, title, tooltip, shortcut, representation, modifies_saved_data, current_row_use; remove=true deletes it.\nRemoving something still referenced (by standard commands, conditional appearance, a data path or a button) is refused unless force=true.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Path to Ext/Form.xml or the Forms/Name.xml descriptor."},"operation":{"type":"string","enum":["set_properties","add_element","move_element","remove_element","set_attribute","set_command"]},"element":{"type":"string","description":"Item name; add_element: the new item's name; set_properties: omit or pass Form for the form itself."},"kind":{"type":"string","enum":["InputField","CheckBoxField","RadioButtonField","LabelField","LabelDecoration","PictureField","PictureDecoration","CalendarField","TextDocumentField","SpreadSheetDocumentField","FormattedDocumentField","ChartField","Table","UsualGroup","ColumnGroup","Pages","Page","Button","ButtonGroup","Popup","CommandBar"],"description":"add_element: the kind of item to create."},"name":{"type":"string","description":"set_attribute, set_command: the attribute or command name."},"type":{"type":"string","description":"set_attribute: string, string(100), string(1,fixed), boolean, number(15,2), number(15,2,nonnegative), date, dateTime, time, CatalogRef.Имя, DocumentObject.Имя, EnumRef.Имя, DefinedType.Имя, ValueTable, several joined with |, or a ready cfg:/v8:/xs: name."},"title":{"description":"set_attribute, set_command: a string (ru) or { ru, en }; null removes it.","anyOf":[{"type":"string"},{"type":"object"},{"type":"null"}]},"tooltip":{"anyOf":[{"type":"string"},{"type":"object"},{"type":"null"}],"description":"set_command: a string (ru) or { ru, en }; null removes it."},"action":{"type":"string","description":"set_command: the handler procedure name in the form module; the procedure itself is not created."},"shortcut":{"type":"string","description":"set_command: for example Ctrl+Enter or F5."},"representation":{"type":"string","enum":["Auto","Text","Picture","TextPicture"]},"modifies_saved_data":{"type":"boolean"},"current_row_use":{"type":"string","enum":["Auto","Use","DontUse"]},"main":{"type":"boolean","description":"set_attribute: the main attribute of the form."},"saved_data":{"type":"boolean"},"fill_check":{"type":"string","enum":["ShowError","DontCheck"]},"columns":{"type":"array","description":"set_attribute: columns of a ValueTable or ValueTree attribute, [{ name, type, title, remove }]; ids are numbered inside the attribute.","items":{"type":"object"}},"remove":{"type":"boolean","description":"set_attribute, set_command: delete the attribute or command."},"properties":{"type":"object","description":"set_properties, add_element: {PropertyNode: value}, the XML node names as Designer writes them (Title, ToolTip, Visible, Enabled, ReadOnly, Width, Height, AutoMaxWidth, HorizontalStretch, VerticalStretch, TitleLocation, Group, Representation, ShowTitle…); enum values are checked and null resets to the default. Multilingual text: a string (ru) or {ru, en}. Color: style:Name, web:Name, win:Name or #RRGGBB. Font: {ref: \"style:Name\"} or {face, height, bold, italic, underline, strikeout, scale}. Picture: CommonPicture.Name or StdPicture.Name. Choice lists and role tables cannot be set.","additionalProperties":true},"into":{"type":"string","description":"add_element, move_element: target container (group, page, pages, table, command bar) or Form."},"after":{"type":"string","description":"add_element, move_element: place after this sibling."},"before":{"type":"string","description":"add_element, move_element: place before this sibling."},"force":{"type":"boolean","description":"remove_element, and set_attribute/set_command with remove=true: delete even while other nodes refer to it."}},"required":["path","operation"]},"annotations":{"readOnlyHint":false,"destructiveHint":true}})JSON";
}

std::string toolSchemas(bool templateEditTools, bool formEditTools) {
    return "[" + viewingToolSchemas() + "," + templateToolSchemas()
        + (templateEditTools ? "," + templateEditToolSchemas() : std::string())
        + "," + formToolSchemas()
        + (formEditTools ? "," + formEditToolSchemas() : std::string()) + "]";
}

std::string success(std::string_view id, std::string value, std::string image = {}, std::string text = {}) {
    std::string output = "{\"jsonrpc\":\"2.0\",\"id\":" + std::string(id) + ",\"result\":{\"content\":[{\"type\":\"text\",\"text\":" + json_string(text.empty() ? value : text) + "}";
    if (!image.empty()) output += ", {\"type\":\"image\",\"data\":" + json_string(image) + ",\"mimeType\":\"image/png\"}";
    /* Two closing braces: one for "result", one for the envelope. The content
     * array's own text object is already closed above. A third one used to slip
     * in here and every successful tools/call reply failed to parse. */
    output += "],\"structuredContent\":" + (value.empty() ? "{}" : value) + "}}";
    return output;
}

/* A note for the agent that the file was rewritten under it. It goes into the
 * text content AND into structuredContent: a client that reads only the
 * structured output - Claude Code does - would never see the prose line. */
std::string withExternalChange(const std::string& value) {
    /* The page answers with a JSON object, so the flag goes in as its first
     * member; an empty answer becomes an object carrying only the flag. */
    const std::string flag = "\"externalChange\":true";
    if (value.empty() || value == "{}") return "{" + flag + "}";
    if (value.front() != '{') return value;
    return "{" + flag + "," + value.substr(1);
}

std::string failure(std::string_view id, const std::string& message) {
    return "{\"jsonrpc\":\"2.0\",\"id\":" + std::string(id) + ",\"result\":{\"isError\":true,\"content\":[{\"type\":\"text\",\"text\":" + json_string(message) + "}]}}";
}

class McpApp {
public:
    explicit McpApp(Options options) : options_(std::move(options)), preview_(resolve_assets(options_)) {
        preview_.setContextAccess([this](const fs::path& candidate) { return allowed(options_, candidate); });
        preview_.setEditorLocator([this] { return editor(); });
    }

    std::string request(const Json& request) {
        const auto* id = request.get("id");
        const std::string idRaw = id ? id->dump() : "null";
        const std::string method = request.get("method") ? request.get("method")->asString() : std::string();
        if (!id && method.rfind("notifications/", 0) == 0) return {};
        try {
            if (method == "initialize") {
                const std::string instructions = u8"This server provides visual inspection of 1C form layouts and print templates. When the user asks to show, open or see a 1C form or template (\"покажи форму\", \"открой макет\"), call open_preview with audience=\"user\" instead of opening XML source or launching 1C; audience=\"agent\" is only for your own checks in a hidden browser the user never sees. Forms/Name.xml descriptors resolve to Ext/Form.xml. After opening, preview operation=inspect lists page and element ids for switch_tab, select and scroll; capture_preview takes a PNG. Annotations (\"аннотации\", \"пометки\", \"замечания\" on a form or template) are notes pinned to elements or cells in the open preview, kept by this server and never written to the file: add them with preview operation=add_annotation, read the user's with operation=annotations, answer with resolve_annotation. Do not put them into the XML as cell notes or comments.";
                const std::string templateNote = std::string(" Print templates: convert_xlsx_to_template turns an xlsx layout into Template.xml; list_markup shows areas and parameters, validate_template checks it")
                    + (options_.templateEditTools ? std::string(", edit_template changes it") : std::string())
                    + ". Managed forms: list_form_elements shows the item tree, validate_form checks it"
                    + (options_.formEditTools ? std::string(", edit_form changes properties, items, attributes and commands") : std::string())
                    + "."
                    + (options_.templateEditTools || options_.formEditTools
                        ? std::string(" After an edit the open preview refreshes: check it with capture_preview and run the matching validate tool.")
                        : std::string());
                return "{\"jsonrpc\":\"2.0\",\"id\":" + idRaw + ",\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"" ONE_C_FORM_VIEWER_NAME "\",\"version\":\"" ONE_C_FORM_VIEWER_VERSION "\"},\"instructions\":" + json_string(instructions + templateNote) + "}}";
            }
            if (method == "ping") return "{\"jsonrpc\":\"2.0\",\"id\":" + idRaw + ",\"result\":{}}";
            if (method == "tools/list") return "{\"jsonrpc\":\"2.0\",\"id\":" + idRaw + ",\"result\":{\"tools\":" + toolSchemas(options_.templateEditTools, options_.formEditTools) + "}}";
            if (method != "tools/call") return failure(idRaw, "Unknown MCP method: " + method);
            const auto* params = request.get("params");
            const std::string nameRaw = params && params->get("name") ? params->get("name")->asString() : std::string();
            const Json* arguments = params ? params->get("arguments") : nullptr;
            /* `preview` is one tool for the agent; every operation keeps its own
             * handler below, and its arguments are already named alike. */
            std::string name = nameRaw;
            if (name == "preview") {
                static const std::map<std::string, std::string> previewOperations{
                    {"inspect", "inspect_preview"}, {"switch_tab", "switch_tab"}, {"select", "select_element"},
                    {"scroll", "scroll_preview"}, {"reload", "reload_preview"}, {"annotations", "get_annotations"},
                    {"resolve_annotation", "resolve_annotation"}, {"add_annotation", "add_annotation"},
                    {"remove_annotation", "remove_annotation"}, {"url", "get_preview_url"},
                    {"close", "close_preview"},
                };
                const auto found = previewOperations.find(argString(arguments, "operation"));
                if (found == previewOperations.end())
                    throw std::runtime_error("operation must be one of inspect, switch_tab, select, scroll, reload, annotations, resolve_annotation, add_annotation, remove_annotation, url, close.");
                name = found->second;
            }
            if (name == "open_preview") {
                const std::string input = argString(arguments, "path");
                if (input.empty()) throw std::runtime_error("path is required");
                /* audience says who the preview is for; show is its older spelling. */
                const std::string audienceArg = argString(arguments, "audience");
                if (!audienceArg.empty() && audienceArg != "user" && audienceArg != "agent")
                    throw std::runtime_error("audience must be \"user\" or \"agent\".");
                const bool forUser = audienceArg.empty() ? argBool(arguments, "show") : audienceArg == "user";
                const std::string baseInput = argString(arguments, "base_path");
                const std::string baseRevision = argString(arguments, "base_revision");
                Document document = loadComparison(options_, input, baseInput, baseRevision);
                const fs::path resolvedFile = document.resolvedPath;
                const std::string requestedPath = utf8_from_wide(document.requestedPath.wstring());
                const std::string resolvedPath = utf8_from_wide(document.resolvedPath.wstring());
                const std::string kind = documentKind(document.resolvedPath, document.content);
                const std::uintmax_t size = document.size;
                const std::string encoding = document.encoding;
                preview_.start();
                std::string interfaceMode = argString(arguments, "interface_mode");
                if (interfaceMode.empty() || interfaceMode == "Auto") interfaceMode = "Any";
                else if (interfaceMode != "Taxi" && interfaceMode != "Version85")
                    throw std::runtime_error("interface_mode must be Auto, Taxi, or Version85.");
                const std::string previewId = openSession(std::move(document), input, interfaceMode, baseInput, baseRevision);
                const std::string url = preview_.url(previewId);
                std::string presentation = "client";
                if (forUser && options_.editorPresents && launch_editor(options_.editor, resolvedFile, preview_.sessionUrl(previewId))) {
                    /* --editor names the window the user watches the document in,
                     * ahead of every other presentation, because only the flag
                     * asks for it. The session is opened all the same and keeps
                     * watching the file, so the agent's own tools work on the
                     * same document and its next call is told when the file
                     * changed underneath. An editor that will not start falls
                     * through to whatever would have shown the preview. */
                    if (headlessSession_ == previewId) headless_.stop();
                    presentation = "editor";
                } else if (clientPresents()) {
                    /* The client shows previewUrl itself (VS Code openNow, tests). */
                } else if (forUser) {
                    if (headlessSession_ == previewId) headless_.stop();
                    presentation = openPreviewUrl(options_, url) ? "window" : "unavailable";
                } else {
                    presentation = "hidden";
                    try { ensurePage(previewId); } catch (const std::exception&) { presentation = "unavailable"; }
                }
                const std::string comparedPath = preview_.baseLabel(previewId);
                const std::string value = "{\"requestedPath\":" + json_string(requestedPath)
                    + ",\"resolvedPath\":" + json_string(resolvedPath)
                    + ",\"path\":" + json_string(resolvedPath)
                    + ",\"size\":" + std::to_string(size)
                    + ",\"encoding\":" + json_string(encoding)
                    + ",\"previewId\":" + json_string(previewId)
                    + ",\"previewUrl\":" + json_string(url)
                    + ",\"presentation\":" + json_string(presentation)
                    + ",\"audience\":" + json_string(forUser ? "user" : "agent")
                    + ",\"kind\":" + json_string(kind)
                    + (comparedPath.empty() ? std::string() : ",\"base\":" + json_string(comparedPath)) + "}";
                const std::string lead = presentation == "hidden"
                    ? u8"Открыто ДЛЯ АГЕНТА в скрытом браузере: пользователь этого не видит, и снимки capture_preview ему тоже не видны. "
                      u8"Если пользователь просил показать или открыть — вызовите open_preview с audience=\"user\"."
                    : presentation == "unavailable"
                    ? u8"Визуальное представление подготовлено, но окно не открылось. "
                      u8"Проверьте установленный браузер или --editor."
                    : presentation == "editor"
                    ? u8"Открыто ДЛЯ ПОЛЬЗОВАТЕЛЯ в BSLEdit (ключ --editor): окно редактора на его экране. "
                      u8"Редактор сам перечитывает файл после ваших правок, пока пользователь не начал править его сам."
                    : presentation == "window"
                    ? u8"Открыто ДЛЯ ПОЛЬЗОВАТЕЛЯ: отдельное окно браузера на его экране. Другие открытые превью остаются доступны по своим ссылкам."
                    : u8"Визуальное представление открыто в 1C Form Viewer.";
                const std::string message = lead
                    + (comparedPath.empty() ? std::string() : u8"\nСравнение: было " + comparedPath + u8" → стало " + resolvedPath)
                    + u8"\nФактический макет: " + resolvedPath + "\npreview_id: " + previewId + "\nPreview URL: " + url;
                return success(idRaw, value, {}, message);
            }
            static const std::map<std::string, std::string> readActions{
                {"list_markup", "list"}, {"validate_template", "validate"},
            };
            /* edit_template operations → shared module functions. */
            static const std::map<std::string, std::string> editActions{
                {"set_area", "setArea"}, {"set_parameter", "setParameter"}, {"set_format", "setFormat"},
                {"insert_rows", "insertRows"}, {"delete_rows", "deleteRows"},
                {"insert_columns", "insertColumns"}, {"delete_columns", "deleteColumns"},
                {"merge_cells", "mergeCells"}, {"set_size", "setSize"},
                {"set_print_settings", "setPrintSettings"}, {"set_header_footer", "setHeaderFooter"},
            };
            const bool isEditTool = name == "edit_template";
            if (isEditTool && !options_.templateEditTools)
                throw std::runtime_error("Template editing tools are disabled for this server (--no-template-edit-tools; in VS Code the setting 1cFormViewer.mcp.templateEditTools).");
            if (name == "convert_xlsx_to_template") {
                const fs::path xlsx = resolveAuthoringPath(options_, argString(arguments, "xlsx_path"), L".xlsx", true);
                const std::string outputInput = argString(arguments, "output_path");
                const fs::path output = resolveAuthoringPath(options_, outputInput, L".xml", false);
                if (fs::exists(output) && !argBool(arguments, "overwrite"))
                    throw std::runtime_error("The output file already exists: " + utf8_from_wide(output.wstring()) + ". Pass overwrite=true to replace it.");
                if (fs::exists(output)) requireNotOpenInBslEdit(output);
                const std::string args = "{\"data\":" + json_string(base64_encode(read_binary_file(xlsx, options_.maxBytes)))
                    + ",\"sheet\":" + json_string(argString(arguments, "sheet")) + "}";
                const Json payload = transform("xlsxToTemplate", args);
                const auto* xml = payload.get("xml");
                const auto* summary = payload.get("summary");
                if (!xml || xml->kind != Json::Kind::String || !summary) throw std::runtime_error("The converter returned no template.");
                write_file_replacing(output, xml->string);
                const std::string outputPath = utf8_from_wide(output.wstring());
                const std::string previewId = openQuietly(outputPath);
                const std::string value = "{\"outputPath\":" + json_string(outputPath) + ",\"previewId\":" + json_string(previewId)
                    + ",\"previewUrl\":" + json_string(preview_.url(previewId))
                    + ",\"summary\":" + summary->dump() + "}";
                std::string message = u8"Макет записан: " + outputPath + u8" и открыт в скрытом превью (capture_preview — снимок).\n" + summary->dump();
                return success(idRaw, value, {}, message);
            }
            if (name == "edit_form" || name == "list_form_elements" || name == "validate_form") {
                if (name == "edit_form" && !options_.formEditTools)
                    throw std::runtime_error("Form editing tools are disabled for this server (--no-form-edit-tools).");
                const fs::path target = resolveFormXml(options_, argString(arguments, "path"));
                if (name == "edit_form") requireNotOpenInBslEdit(target);
                std::string encoding;
                const std::string content = read_text_file(target, options_.maxBytes, encoding);
                static const std::map<std::string, std::string> formActions{
                    {"set_properties", "setProperties"}, {"move_element", "moveElement"}, {"remove_element", "removeElement"},
                    {"add_element", "addElement"}, {"set_attribute", "setAttribute"}, {"set_command", "setCommand"},
                };
                std::string action = name == "list_form_elements" ? "list" : name == "validate_form" ? "validate" : std::string();
                if (name == "edit_form") {
                    const auto found = formActions.find(argString(arguments, "operation"));
                    if (found == formActions.end()) throw std::runtime_error("operation must be one of set_properties, add_element, move_element, remove_element, set_attribute, set_command.");
                    if (encoding != "utf8-bom" && encoding != "utf8")
                        throw std::runtime_error("Only UTF-8 forms are edited; this file is " + encoding + ".");
                    action = found->second;
                }
                std::map<std::string, Json> params;
                if (arguments && arguments->kind == Json::Kind::Object) {
                    for (const auto& [key, value] : arguments->object) {
                        if (key == "path" || key == "operation") continue;
                        params.emplace(key, value);
                    }
                }
                const Json payload = transform("form", "{\"action\":" + json_string(action) + ",\"content\":" + json_string(content)
                    + ",\"params\":" + Json::objectValue(std::move(params)).dump() + "}");
                const auto* xml = payload.get("xml");
                const auto* result = payload.get("result");
                if (!xml || xml->kind != Json::Kind::String || !result) throw std::runtime_error("The form module returned no result.");
                const std::string targetPath = utf8_from_wide(target.wstring());
                const bool readOnly = name != "edit_form";
                bool refreshed = false;
                if (!readOnly) {
                    /* read_text_file drops the byte order mark; Designer's forms carry one. */
                    write_file_replacing(target, (encoding == "utf8-bom" ? std::string("\xEF\xBB\xBF") : std::string()) + xml->string);
                    refreshed = refreshIfOpen(target);
                }
                const std::string value = "{\"path\":" + json_string(targetPath) + ",\"result\":" + result->dump()
                    + (!readOnly ? std::string(",\"previewRefreshed\":") + (refreshed ? "true" : "false") : std::string()) + "}";
                return success(idRaw, value);
            }
            if (name == "edit_template" || readActions.count(name)) {
                const fs::path target = resolveAuthoringPath(options_, argString(arguments, "path"), L".xml", true);
                /* Every edit_template operation writes; the read-only tools
                 * that share this branch are welcome to the open file. */
                if (name == "edit_template") requireNotOpenInBslEdit(target);
                std::string encoding;
                const std::string content = read_text_file(target, options_.maxBytes, encoding);
                /* Tool arguments are snake_case, the shared module takes camelCase. */
                std::map<std::string, Json> params;
                if (arguments && arguments->kind == Json::Kind::Object) {
                    for (const auto& [key, value] : arguments->object) {
                        if (key == "path" || key == "operation") continue;
                        std::string camel;
                        for (std::size_t i = 0; i < key.size(); ++i) {
                            if (key[i] == '_' && i + 1 < key.size()) camel += static_cast<char>(std::toupper(static_cast<unsigned char>(key[++i])));
                            else camel += key[i];
                        }
                        params.emplace(camel, value);
                    }
                }
                std::string action;
                if (name == "edit_template") {
                    const auto found = editActions.find(argString(arguments, "operation"));
                    if (found == editActions.end())
                        throw std::runtime_error("operation must be one of set_area, set_parameter, set_format, insert_rows, delete_rows, insert_columns, delete_columns, merge_cells, set_size, set_print_settings, set_header_footer.");
                    action = found->second;
                } else {
                    action = readActions.at(name);
                }
                const bool readOnly = action == "list" || action == "validate";
                const Json payload = transform("markup", "{\"action\":" + json_string(action) + ",\"content\":" + json_string(content)
                    + ",\"params\":" + Json::objectValue(std::move(params)).dump() + "}");
                const auto* xml = payload.get("xml");
                const auto* result = payload.get("result");
                if (!xml || xml->kind != Json::Kind::String || !result) throw std::runtime_error("The markup module returned no result.");
                const std::string targetPath = utf8_from_wide(target.wstring());
                bool refreshed = false;
                if (!readOnly) {
                    write_file_replacing(target, xml->string);
                    refreshed = refreshIfOpen(target);
                }
                const std::string value = "{\"path\":" + json_string(targetPath) + ",\"result\":" + result->dump()
                    + (!readOnly ? std::string(",\"previewRefreshed\":") + (refreshed ? "true" : "false") : std::string()) + "}";
                return success(idRaw, value);
            }
            /* The note of an external save rides on every preview operation,
             * so it cannot be lost because the agent happened to call url or
             * close rather than inspect. */
            const auto answer = [&](bool external, const std::string& value, const std::string& image = {}) {
                if (!external) return success(idRaw, value, image);
                return success(idRaw, withExternalChange(value), image, u8"Файл изменён на диске (сохранён в BSLEdit или другим редактором), превью перечитано.\n" + value);
            };
            if (name == "close_preview") {
                const std::string requested = argString(arguments, "preview_id");
                if (requested.empty()) {
                    /* Taken before the sessions go: closing must not swallow a
                     * save the agent has not been told about. */
                    const bool external = preview_.takeExternalChangeAny();
                    headless_.stop();
                    headlessSession_.clear();
                    preview_.close();
                    inputs_.clear();
                    baseInputs_.clear();
                    return answer(external, "{\"closed\":true}");
                }
                const std::string previewId = preview_.resolve(requested);
                const bool external = preview_.takeExternalChange(previewId);
                if (headlessSession_ == previewId) { headless_.stop(); headlessSession_.clear(); }
                preview_.closeSession(previewId);
                inputs_.erase(previewId);
                baseInputs_.erase(previewId);
                return answer(external, "{\"closed\":true,\"previewId\":" + json_string(previewId) + "}");
            }
            if (name == "get_preview_url") {
                const std::string target = options_.editorPresents ? "bsledit"
                    : options_.openInVsCode ? "vscode-simple-browser"
                    : options_.openBrowser ? "external-browser" : "client";
                const std::string previewId = preview_.resolve(argString(arguments, "preview_id"));
                const bool external = preview_.takeExternalChange(previewId);
                return answer(external, "{\"previewId\":" + json_string(previewId)
                    + ",\"previewUrl\":" + json_string(preview_.url(previewId))
                    + ",\"previews\":" + preview_.listJson()
                    + ",\"externalBrowser\":" + (options_.openBrowser && !options_.openInVsCode ? "true" : "false")
                    + ",\"presentationTarget\":" + json_string(target) + "}");
            }
            /* Every remaining tool drives the page of one preview. */
            const std::string previewId = preview_.resolve(argString(arguments, "preview_id"));
            /* Consumed here so one note is reported once, whichever of the
             * preview tools runs first after the user saved in BSLEdit. */
            const bool external = preview_.takeExternalChange(previewId);
            const auto reply = [&](const std::string& value, const std::string& image = {}) {
                return answer(external, value, image);
            };
            if (name == "get_annotations")
                return reply(preview_.annotationsJson(previewId, !argBool(arguments, "include_resolved")));
            if (name == "resolve_annotation") {
                const std::string annotationId = argString(arguments, "annotation_id");
                if (annotationId.empty()) throw std::runtime_error("annotation_id is required");
                return reply(preview_.resolveAnnotation(previewId, annotationId, argString(arguments, "resolution")));
            }
            if (name == "add_annotation")
                return reply(preview_.agentAddAnnotation(previewId, argString(arguments, "element_id"), argString(arguments, "to_element_id"),
                    argString(arguments, "element_name"), argString(arguments, "text")));
            if (name == "remove_annotation") {
                const std::string annotationId = argString(arguments, "annotation_id");
                if (annotationId.empty()) throw std::runtime_error("annotation_id is required");
                return reply(preview_.agentRemoveAnnotation(previewId, annotationId));
            }
            if (name == "reload_preview") {
                preview_.setDocument(previewId, loadFor(previewId));
                ensurePage(previewId);
                return reply(preview_.command(previewId, "state", "{}"));
            }
            ensurePage(previewId);
            if (name == "inspect_preview") {
                std::string args = "{\"query\":" + json_string(argString(arguments, "query")) + ",\"visibleOnly\":" + ((arguments && arguments->get("visible_only") && arguments->get("visible_only")->asBool()) ? "true" : "false") + "}";
                return reply(preview_.command(previewId, "inspect", args));
            }
            if (name == "switch_tab") return reply(preview_.command(previewId, "switchTab", "{\"pageId\":" + json_string(argString(arguments, "page_id")) + ",\"pagesId\":" + json_string(argString(arguments, "pages_id")) + "}"));
            if (name == "select_element") return reply(preview_.command(previewId, "select", "{\"elementId\":" + json_string(argString(arguments, "element_id")) + "}"));
            if (name == "scroll_preview") {
                /* Rebuild the object to rename the snake_case tool arguments to the
                 * renderer's camelCase names. This used to be a substring replace over
                 * the serialised JSON, which also rewrote any *value* that happened to
                 * spell an argument name, for example element_id "delta_x". */
                static const std::map<std::string, std::string> renames{
                    {"element_id", "elementId"}, {"delta_x", "deltaX"}, {"delta_y", "deltaY"},
                };
                std::map<std::string, Json> scrollArgs;
                if (arguments && arguments->kind == Json::Kind::Object) {
                    for (const auto& [key, value] : arguments->object) {
                        if (key == "preview_id") continue;
                        const auto rename = renames.find(key);
                        scrollArgs.emplace(rename == renames.end() ? key : rename->second, value);
                    }
                }
                return reply(preview_.command(previewId, "scroll", Json::objectValue(std::move(scrollArgs)).dump()));
            }
            if (name == "capture_preview") {
                const std::string scope = argString(arguments, "scope").empty() ? "viewport" : argString(arguments, "scope");
                const std::string result = preview_.command(previewId, "capture", "{\"scope\":" + json_string(scope) + ",\"elementId\":" + json_string(argString(arguments, "element_id")) + "}", true, scope == "document" ? 180 : 30);
                const Json payload = JsonParser(result).parse();
                const auto* data = payload.get("data");
                const auto* mime = payload.get("mimeType");
                if (!data || !mime) throw std::runtime_error("The browser returned no image.");
                return reply("{\"scope\":" + json_string(scope) + "}", data->asString());
            }
            throw std::runtime_error("Unknown tool: " + name);
        } catch (const std::exception& error) {
            return failure(idRaw, error.what());
        }
    }

    /* After a long pause the hidden Edge is the only heavy thing left; the
     * previews stay open, and ensurePage starts the renderer again on the next
     * command that needs a page. */
    void releaseIdle() {
        headless_.stop();
        if (!headlessSession_.empty()) preview_.forgetPoll(headlessSession_);
        headlessSession_.clear();
    }

private:
    Options options_;
    /* Everything the editorLocator callback reads is declared before preview_
     * and so destroyed after it: an HTTP thread answering state-meta.json may
     * still call the callback while ~PreviewServer stops the server. */
    mutable std::mutex editorMutex_;
    mutable fs::path editorPath_;
    mutable std::optional<std::chrono::steady_clock::time_point> editorCheckedAt_;
    PreviewServer preview_;
    /* Declared after preview_: destroyed first, while the server still runs. */
    HeadlessBrowser headless_;
    /* The preview the hidden renderer shows: one page at a time, moved to
     * whichever preview a command targets. */
    std::string headlessSession_;
    std::map<std::string, std::string> inputs_;
    std::map<std::string, std::pair<std::string, std::string>> baseInputs_;  /* base_path, base_revision */

    /* The page asks twice a second whether the editor button has anything to
     * open, so the registry lookup is cached; the window is short enough that
     * installing BSLEdit while a preview is open still lights the button up. */
    fs::path editor() const {
        using namespace std::chrono;
        std::lock_guard lock(editorMutex_);
        const auto now = steady_clock::now();
        if (!editorCheckedAt_ || now - *editorCheckedAt_ > seconds(10)) {
            editorPath_ = locate_bsledit(options_);
            editorCheckedAt_ = now;
        }
        return editorPath_;
    }

    /* BSLEdit holds the file: its window is in front of the user and its buffer
     * wins on the next save, so an agent's write here would be lost. */
    static void requireNotOpenInBslEdit(const fs::path& target) {
        if (!open_in_bsledit(target)) return;
        throw std::runtime_error("The file is open in BSLEdit, which has priority: " + utf8_from_wide(target.wstring())
            + ". Close it there (saving first if needed) and repeat the edit. "
            + u8"Файл открыт в BSLEdit — правка из агента отклонена, чтобы не потерять изменения пользователя.");
    }

    std::string openSession(Document document, const std::string& input, const std::string& interfaceMode = "Any",
                            const std::string& baseInput = {}, const std::string& baseRevision = {}) {
        const std::string previewId = preview_.openSession(std::move(document),
            [options = options_, input, baseInput, baseRevision] { return loadComparison(options, input, baseInput, baseRevision); },
            interfaceMode);
        inputs_[previewId] = input;
        baseInputs_[previewId] = {baseInput, baseRevision};
        return previewId;
    }

    Document loadFor(const std::string& previewId) {
        const auto base = baseInputs_.find(previewId);
        if (base == baseInputs_.end()) return loadDocument(options_, inputs_.at(previewId));
        return loadComparison(options_, inputs_.at(previewId), base->second.first, base->second.second);
    }

    bool clientPresents() const { return !options_.openBrowser && !options_.openInVsCode; }

    /* Run a shared-module transform in the preview page. It needs a page but no
     * open document, so the first authoring call may start the hidden renderer. */
    Json transform(const std::string& op, const std::string& args) {
        preview_.start();
        const std::string previewId = preview_.workSession();
        ensurePage(previewId);
        Json payload = JsonParser(preview_.command(previewId, op, args, false)).parse();
        if (const auto* error = payload.get("error")) throw std::runtime_error(error->asString("Browser command failed"));
        return payload;
    }

    /* Show a freshly written template the way open_preview does by default. */
    std::string openQuietly(const std::string& input) {
        const std::string previewId = openSession(loadDocument(options_, input), input);
        try { ensurePage(previewId); } catch (const std::exception&) {}
        return previewId;
    }

    bool refreshIfOpen(const fs::path& written) {
        bool refreshed = false;
        for (const auto& [previewId, input] : inputs_) {
            try {
                Document document = loadFor(previewId);
                if (lower_wide(document.resolvedPath.wstring()) != lower_wide(written.wstring())) continue;
                preview_.setDocument(previewId, std::move(document));
                refreshed = true;
            } catch (const std::exception&) {}
        }
        return refreshed;
    }

    /* Commands need a page running the preview. Start the hidden renderer when
     * no page of this preview has polled recently: never opened, the user
     * closed the visible window, or the renderer shows another preview. Do not
     * wait for a newly launched editor/browser window here: the command being
     * handled may be the first capture or inspection, and it would otherwise
     * sit pending until its timeout while no page is polling yet. */
    void ensurePage(const std::string& previewId) {
        using namespace std::chrono;
        if (clientPresents() || preview_.pageActive(previewId, seconds(3))) return;
        if (headlessSession_ == previewId && headless_.running()) return;
        headless_.stop();
        if (!headlessSession_.empty()) preview_.forgetPoll(headlessSession_);
        headlessSession_.clear();
        if (!headless_.start(preview_.url(previewId) + "&bare=1"))
            throw std::runtime_error("No preview page is connected and neither Microsoft Edge nor Google Chrome was found "
                                     "for the hidden renderer. Call open_preview with audience=\"user\".");
        headlessSession_ = previewId;
    }
};

/* The process that started this server. Its handle is opened once, so a
 * later process reusing the same id is never mistaken for it. */
HANDLE openParentProcess() {
    const DWORD self = GetCurrentProcessId();
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return nullptr;
    DWORD parent = 0;
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    for (BOOL more = Process32FirstW(snapshot, &entry); more; more = Process32NextW(snapshot, &entry)) {
        if (entry.th32ProcessID == self) { parent = entry.th32ParentProcessID; break; }
    }
    CloseHandle(snapshot);
    return parent ? OpenProcess(SYNCHRONIZE, FALSE, parent) : nullptr;
}

std::chrono::milliseconds idleReleaseDelay() {
    wchar_t buffer[32]{};
    const DWORD length = GetEnvironmentVariableW(L"ONE_C_FORM_VIEWER_IDLE_MS", buffer, 32);
    if (length && length < 32) {
        try { if (const auto value = std::stoull(buffer); value) return std::chrono::milliseconds(value); }
        catch (const std::exception&) {}
    }
    return std::chrono::minutes(15);
}

fs::path executableDirectory() {
    std::vector<wchar_t> buffer(MAX_PATH);
    for (;;) {
        const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (!length) return {};
        if (length < buffer.size() - 1) return fs::path(std::wstring(buffer.data(), length)).parent_path();
        buffer.resize(buffer.size() * 2);
    }
}

} // namespace

/* gitquery.cpp decodes through this (git-shim.cpp). */
std::wstring mcp_decode_text_bytes(const unsigned char* bytes, std::size_t size, std::string& encoding) {
    return decode_text_bytes(bytes, size, encoding);
}

int wmain(int argc, wchar_t** argv) {
    Options options;
    options.base = executableDirectory();
    std::string firstInput;
    for (int index = 1; index < argc; ++index) {
        const std::wstring argument = argv[index];
        if (argument == L"--root" && index + 1 < argc) options.roots.push_back(fs::weakly_canonical(argv[++index]));
        else if (argument == L"--allow-any-path") options.allowAnyPath = true;
        else if (argument == L"--no-template-edit-tools") options.templateEditTools = false;
        else if (argument == L"--no-form-edit-tools") options.formEditTools = false;
        else if (argument == L"--editor" && index + 1 < argc) options.editor = fs::weakly_canonical(argv[++index]);
        else if (argument == L"--assets" && index + 1 < argc) options.assets = fs::weakly_canonical(argv[++index]);
        else if (argument == L"--no-open-browser") options.openBrowser = false;
        else if (argument == L"--open-vscode-browser") options.openInVsCode = true;
        else if (argument == L"--vscode-uri-scheme" && index + 1 < argc) {
            options.vscodeUriScheme = argv[++index];
            if (!validUriScheme(options.vscodeUriScheme)) { std::wcerr << L"Invalid VS Code URI scheme\n"; return 2; }
        }
        else if (argument == L"--max-bytes" && index + 1 < argc) {
            const std::wstring value = argv[++index];
            try {
                size_t consumed = 0;
                const auto parsed = std::stoull(value, &consumed);
                if (value.empty() || value.front() == L'-' || consumed != value.size() || !parsed
                        || parsed > static_cast<unsigned long long>(SIZE_MAX))
                    throw std::invalid_argument("out of range");
                options.maxBytes = static_cast<std::size_t>(parsed);
            } catch (const std::exception&) {
                std::wcerr << L"Invalid --max-bytes value: " << value << L"\n";
                return 2;
            }
        }
        else if (argument == L"--stdio") continue;
        else if (argument == L"--help" || argument == L"-h") {
            std::wcout << L"1c-form-viewer-native --stdio [--root PATH ... | --allow-any-path] [--no-open-browser | --open-vscode-browser [--vscode-uri-scheme SCHEME]] [--no-template-edit-tools] [--no-form-edit-tools] [--editor PATH] [--assets DIR]\n"
                          L"Previews render in a hidden headless Edge/Chrome; open_preview show=true opens a visible window.\n"
                          L"--editor PATH also opens a preview meant for the user in that editor instead of a browser window.\n";
            return 0;
        } else if (argument == L"--version" || argument == L"-v") { std::wcout << ONE_C_FORM_VIEWER_VERSION_W << std::endl; return 0; }
        else if (argument.rfind(L"--", 0) == 0) { std::wcerr << L"Unknown option: " << argument << L"\n"; return 2; }
    }
    // Match the Node CLI: cwd is only the fallback when the caller supplied
    // no explicit root. Otherwise an extension-provided allowlist must remain
    // exact and must not be widened by the process launch directory.
    if (options.roots.empty()) options.roots.push_back(fs::current_path());

    /* A path that is not there is a mistake worth naming, not a reason to
     * refuse to start: the preview still opens, in the browser. */
    if (!options.editor.empty()) {
        std::error_code editorError;
        const auto extension = lower_wide(options.editor.extension().wstring());
        options.editorPresents = (extension == L".exe" || extension == L".com"
                || extension == L".cmd" || extension == L".bat")
            && fs::is_regular_file(options.editor, editorError);
        if (!options.editorPresents)
            std::wcerr << L"--editor is not a launchable file, previews for the user open in a browser: "
                       << options.editor.wstring() << L"\n";
    }

    /* Without the interface nothing can be previewed, and the failure is a
     * sentence the user can act on rather than a terminated process. */
    std::optional<McpApp> app;
    try {
        app.emplace(options);
    } catch (const std::exception& error) {
        std::cerr << "1c-form-viewer-native: " << error.what() << '\n';
        return 1;
    }
    /* The client normally closes stdin and the loop below ends. A client that
     * crashed or was killed may leave the pipe open, so the parent is watched
     * too; the hidden Edge dies with its job object when the process exits. */
    if (HANDLE parent = openParentProcess()) {
        std::thread([parent] {
            WaitForSingleObject(parent, INFINITE);
            ExitProcess(0);
        }).detach();
    }

    /* An idle session (a client window left open for hours) keeps its
     * previews but gives the hidden browser back. The process itself stays:
     * the client does not restart a stdio server that went away. */
    std::mutex requestMutex;
    std::condition_variable idleWake;
    auto lastActivity = std::chrono::steady_clock::now();
    bool released = true;
    bool finished = false;
    std::thread idleThread([&] {
        const auto delay = idleReleaseDelay();
        std::unique_lock lock(requestMutex);
        while (!finished) {
            if (released) { idleWake.wait(lock); continue; }
            if (idleWake.wait_until(lock, lastActivity + delay) == std::cv_status::timeout
                    && !released && std::chrono::steady_clock::now() - lastActivity >= delay) {
                app->releaseIdle();
                released = true;
            }
        }
    });

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;
        try {
            Json request = JsonParser(line).parse();
            std::string response;
            {
                std::lock_guard lock(requestMutex);
                response = app->request(request);
                lastActivity = std::chrono::steady_clock::now();
                released = false;
            }
            idleWake.notify_one();
            if (!response.empty()) std::cout << response << std::endl;
        } catch (const std::exception& error) {
            std::cerr << "1c-form-viewer-native: " << error.what() << '\n';
        }
    }
    {
        std::lock_guard lock(requestMutex);
        finished = true;
    }
    idleWake.notify_one();
    idleThread.join();
    return 0;
}
