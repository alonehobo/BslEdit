#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <winsock2.h>
#include <ws2tcpip.h>

#include <algorithm>
#include <cctype>
#include <chrono>
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
#include <string>
#include <string_view>
#include <thread>

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

    std::wstring wide;
    if (bytes.size() >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf) {
        encoding = "utf8-bom";
        wide = wide_from_utf8(std::string_view(reinterpret_cast<char*>(bytes.data() + 3), bytes.size() - 3));
    } else if (bytes.size() >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe) {
        encoding = "utf16le";
        wide.resize((bytes.size() - 2) / 2);
        std::memcpy(wide.data(), bytes.data() + 2, wide.size() * sizeof(wchar_t));
    } else if (bytes.size() >= 2 && bytes[0] == 0xfe && bytes[1] == 0xff) {
        encoding = "utf16be";
        wide.resize((bytes.size() - 2) / 2);
        for (std::size_t i = 0; i < wide.size(); ++i) wide[i] = static_cast<wchar_t>((bytes[2 + i * 2] << 8) | bytes[3 + i * 2]);
    } else {
        wide = wide_from_utf8(std::string_view(reinterpret_cast<char*>(bytes.data()), bytes.size()));
        if (!wide.empty() || bytes.empty()) encoding = "utf8";
        else {
            encoding = "windows-1251";
            const int size = MultiByteToWideChar(1251, 0, reinterpret_cast<char*>(bytes.data()), static_cast<int>(bytes.size()), nullptr, 0);
            wide.resize(size);
            MultiByteToWideChar(1251, 0, reinterpret_cast<char*>(bytes.data()), static_cast<int>(bytes.size()), wide.data(), size);
        }
    }
    return utf8_from_wide(wide);
}

std::wstring lower_wide(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t c) { return static_cast<wchar_t>(towlower(c)); });
    return value;
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
    const char* reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 400 ? "Bad Request" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : "Internal Server Error";
    std::ostringstream output;
    output << "HTTP/1.1 " << status << ' ' << reason << "\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: " << contentType << "\r\nContent-Length: " << body.size() << "\r\n\r\n";
    output << body;
    return output.str();
}

struct Document {
    fs::path requestedPath;
    fs::path resolvedPath;
    std::string content;
    std::string encoding;
    std::uintmax_t size = 0;
};

class PreviewServer {
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
    }

    /* Every opened file is its own preview with its own page URL
     * (/<token>/<previewId>/index.html), so several previews stay open side by
     * side. Reopening a file reuses its preview and link. */
    std::string url(const std::string& id) const {
        if (!port_) throw std::runtime_error("Preview server is not running");
        return "http://127.0.0.1:" + std::to_string(port_) + "/" + token_ + "/" + id + "/index.html?internal=1";
    }

    /* The reloader lets the page's refresh button re-read the file from disk,
     * so an agent's edit shows without reopening the preview. */
    std::string openSession(Document document, std::function<Document()> reloader) {
        std::lock_guard lock(mutex_);
        const std::wstring key = lower_wide(document.resolvedPath.wstring());
        std::string id;
        for (const auto& [candidate, session] : sessions_) {
            if (session.document && lower_wide(session.document->resolvedPath.wstring()) == key) { id = candidate; break; }
        }
        /* An authoring transform may have started a page before any file was open. */
        if (id.empty()) {
            for (const auto& [candidate, session] : sessions_) {
                if (!session.document) { id = candidate; break; }
            }
        }
        if (id.empty()) id = "p" + std::to_string(++sessionCounter_);
        Session& session = sessions_[id];
        session.document = std::move(document);
        session.reloader = std::move(reloader);
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

    void setDocument(const std::string& id, Document document) {
        std::lock_guard lock(mutex_);
        const auto found = sessions_.find(id);
        if (found == sessions_.end()) return;
        found->second.document = std::move(document);
        ++found->second.revision;
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
        return "{\"revision\":" + std::to_string(session.revision) + ",\"path\":" + json_string(utf8_from_wide(session.document->resolvedPath.wstring())) + ",\"content\":" + json_string(session.document->content) + ",\"resolveContext\":true}";
    }

    /* The shared resolver reads configuration files through this server with
     * exactly the access the MCP session has (--root / --allow-any-path). */
    void setContextAccess(std::function<bool(const fs::path&)> access) {
        std::lock_guard lock(mutex_);
        contextAccess_ = std::move(access);
    }

    std::string metaJson(const std::string& id) const {
        std::lock_guard lock(mutex_);
        const auto found = sessions_.find(id);
        const bool available = found != sessions_.end() && found->second.document;
        return "{\"revision\":" + std::to_string(available ? found->second.revision : 0) + ",\"available\":" + (available ? "true" : "false") + "}";
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
        if (port_) { WSACleanup(); port_ = 0; }
    }

private:
    struct Pending { std::string id; std::string op; std::string args; bool delivered; std::uint64_t revision; };
    struct Result { std::string id; std::string value; };
    struct Session {
        std::optional<Document> document;
        std::function<Document()> reloader;
        std::uint64_t revision = 0;
        std::uint64_t touched = 0;
        std::optional<Pending> pending;
        std::optional<Result> lastResult;
        std::optional<std::chrono::steady_clock::time_point> lastPoll;
    };

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
    std::function<bool(const fs::path&)> contextAccess_;

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
            reply(client, route(method, target, body));
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
};

bool validUriScheme(const std::wstring& value) {
    if (value.empty() || !iswalpha(value.front())) return false;
    return std::all_of(value.begin() + 1, value.end(), [](wchar_t character) {
        return iswalnum(character) || character == L'+' || character == L'-' || character == L'.';
    });
}

void openPreviewUrl(const Options& options, const std::string& url) {
    if (options.openInVsCode) {
        const std::string handler = utf8_from_wide(options.vscodeUriScheme)
            + "://alonehobo.1c-form-viewer-vscode/open-preview?url="
            + url_encode_component(url);
        ShellExecuteW(nullptr, L"open", wide_from_utf8(handler).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    } else if (options.openBrowser) {
        ShellExecuteW(nullptr, L"open", wide_from_utf8(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    }
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
        + ". In VS Code, add its parent directory to the setting "
          "\"1cFormViewer.mcp.additionalRoots\" and restart the MCP server; "
          "for a standalone server, add --root PATH.");
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
    if (lower_wide(requested.extension().wstring()) != L".xml" && lower_wide(requested.extension().wstring()) != L".mxl") throw std::runtime_error("Unsupported file extension.");
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

std::string documentKind(const fs::path& resolvedPath) {
    const auto filename = lower_wide(resolvedPath.filename().wstring());
    if (filename == L"form.xml") return "managed-form";
    if (filename == L"template.xml") return "spreadsheet-template";
    if (lower_wide(resolvedPath.extension().wstring()) == L".mxl") return "mxl";
    return "xml";
}

std::string viewingToolSchemas() {
    return u8R"JSON({"name":"open_preview","description":"Open and render a visual preview of a 1C:Enterprise managed form, form layout, spreadsheet template, or MXL file. Use this when the user asks to show a 1C form visually, open a form layout, inspect the form interface, or see how the form looks. Do not launch 1C:Enterprise or the configurator, and do not show XML source when a visual preview is requested. A metadata descriptor such as Forms/ФормаДокумента.xml is automatically resolved to Forms/ФормаДокумента/Ext/Form.xml. Показывает визуальное представление формы или макета 1С, а не исходный XML. Используйте для запросов «покажи форму», «открой макет формы», «покажи визуально» и «посмотри внешний вид формы». Не запускайте 1С и не открывайте XML-редактор. Decide the audience before calling: audience=\"user\" when the user asks to show, open or see a form or template (\"покажи\", \"открой\", \"хочу посмотреть\") — it opens a window on the user's screen; audience=\"agent\" when you only need the preview yourself (inspect_preview, capture_preview, checking your own edit) — it renders in a hidden browser the user never sees, and your screenshots are not shown to the user either. Each opened file is a separate preview with its own preview_id and URL; opening another file does not replace earlier previews, so several can be shown at once. Reopening the same file reuses its preview. Сначала решите, для кого открываете: audience=\"user\" — пользователь просит показать или открыть (окно на его экране); audience=\"agent\" — превью нужно только вам (скрытый браузер, пользователь ничего не видит). Каждый файл открывается отдельным превью со своей ссылкой.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute or workspace-relative path to Form.xml, a Forms/ИмяФормы.xml descriptor, Template.xml, or an MXL file."},"audience":{"type":"string","enum":["user","agent"],"description":"user: the user asked to see it, open a window on their screen. agent: for your own inspection, render hidden."},"show":{"type":"boolean","description":"Deprecated spelling of audience: true = user, false = agent. Ignored when audience is given."}},"required":["path","audience"]},"outputSchema":{"type":"object","properties":{"requestedPath":{"type":"string"},"resolvedPath":{"type":"string"},"path":{"type":"string"},"previewId":{"type":"string"},"audience":{"type":"string","enum":["user","agent"]},"previewUrl":{"type":"string"},"presentation":{"type":"string","enum":["hidden","window","client","unavailable"]},"kind":{"type":"string","enum":["managed-form","spreadsheet-template","mxl","xml"]},"size":{"type":"integer"},"encoding":{"type":"string"}},"required":["requestedPath","resolvedPath","previewUrl","kind","size","encoding"]},"annotations":{"readOnlyHint":true}},{"name":"preview","description":"Work with an open 1C preview; pass operation and that operation's arguments. Open a file with open_preview first and take screenshots with capture_preview; preview_id picks one of several open previews, the last used one by default. Operations: inspect — element and page ids, captions, visibility, nesting, tabs and scroll areas, narrowed by query and visible_only; use it to discover ids before navigating or capturing; switch_tab — activate a page by page_id (pages_id for a nested set); select — reveal the parent pages of element_id, highlight it and scroll it into view; scroll — move target document, active-page, table or spreadsheet by delta_x/delta_y or to x/y (element_id picks the table or field); reload — re-read the file after it changed, keeping the current view; url — the loopback URL of that preview plus every open preview with its previewId, path and previewUrl; close — end one preview (preview_id) or all of them, leaving every source file alone and their URLs dead. Инспекция, вкладки, выделение, прокрутка, перечитывание и закрытие превью.","inputSchema":{"type":"object","properties":{"operation":{"type":"string","enum":["inspect","switch_tab","select","scroll","reload","url","close"]},"preview_id":{"type":"string","description":"Preview to act on, from open_preview; the last used preview by default."},"query":{"type":"string","description":"inspect: narrow the listing to matching names and captions."},"visible_only":{"type":"boolean","description":"inspect: skip hidden elements."},"page_id":{"type":"string","description":"switch_tab: the page to activate."},"pages_id":{"type":"string","description":"switch_tab: the nested page set that owns page_id."},"element_id":{"type":"string","description":"select: the element to highlight; scroll: the table or spreadsheet field to move."},"target":{"type":"string","enum":["document","active-page","table","spreadsheet"],"description":"scroll: what to move."},"delta_x":{"type":"number"},"delta_y":{"type":"number"},"x":{"type":"number"},"y":{"type":"number"}},"required":["operation"]},"annotations":{"readOnlyHint":true}},{"name":"capture_preview","description":"Capture the opened 1C preview viewport, full document, or one visible element as PNG. Use this for screenshots and visual comparison after navigating to the requested area.","inputSchema":{"type":"object","properties":{"preview_id":{"type":"string","description":"Preview to act on, from open_preview; the last used preview by default."},"scope":{"type":"string","enum":["viewport","document","element"]},"element_id":{"type":"string"}}},"annotations":{"readOnlyHint":true}})JSON";
}

/* Tools that convert and read a spreadsheet template (Template.xml): always on. */
std::string templateToolSchemas() {
    return u8R"JSON({"name":"convert_xlsx_to_template","description":"Convert an Excel workbook (.xlsx) into a 1C spreadsheet template Ext/Template.xml and open it in the preview. Use this when a print form layout is given as xlsx. Text, fonts, colors, fills, borders, alignment, column widths, row heights, merges and headers/footers are kept; Excel defined names become named areas, a cell with exactly [Name] becomes a parameter, text with [Name] inside becomes a template. The result lists areas, parameters and what was not converted. Then check it with capture_preview and list_markup, and refine the markup with edit_template (operations set_area, set_parameter) when that tool is available. Конвертирует макет печатной формы из xlsx в Template.xml 1С и сразу открывает превью.","inputSchema":{"type":"object","properties":{"xlsx_path":{"type":"string","description":"Path to the .xlsx workbook."},"output_path":{"type":"string","description":"Path of the Template.xml to write, for example Templates/ПФ_MXL_Акт/Ext/Template.xml."},"sheet":{"type":"string","description":"Sheet name; the first visible sheet by default."},"overwrite":{"type":"boolean","description":"Replace an existing output file. Default false."}},"required":["xlsx_path","output_path"]},"annotations":{"readOnlyHint":false,"destructiveHint":false}},{"name":"list_markup","description":"List the markup of a 1C spreadsheet template (Template.xml): named areas with their rows/columns, parameter cells and template cells, all with 1-based row and column numbers as the preview shows them. Показывает области, параметры и шаблоны макета.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Path to Template.xml."}},"required":["path"]},"annotations":{"readOnlyHint":true}},{"name":"validate_template","description":"Check a 1C spreadsheet template (Template.xml) for broken structure: format, font and line references, cells and merges outside the document or column set, malformed or duplicate named areas, parameter cells without names. Run it after editing a template. Проверяет макет на ошибки структуры.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Path to Template.xml."}},"required":["path"]},"annotations":{"readOnlyHint":true}})JSON";
}

/* The one tool that changes a template; --no-template-edit-tools leaves it out. */
std::string templateEditToolSchemas() {
    return u8R"JSON({"name":"edit_template","description":"Edit a 1C spreadsheet template (Template.xml) in place; pass path, operation and that operation's arguments. Rows and columns are 1-based as in the preview; an open preview of the file is refreshed, so check it with capture_preview, and run validate_template after a series of edits. Operations: set_area — name, begin_row/end_row and/or begin_column/end_column (rows only → Rows area, columns only → Columns, both → Rectangle), remove=true deletes the area; set_parameter — row, column and one of name (parameter), template (text with [Name]) or text (plain); detail sets the drill-down parameter, alone or together; set_format — row, column, optional to_row/to_column, and any of font{face,size,bold,italic,underline,strikeout}, horizontal_alignment, vertical_alignment, text_placement, indent, text_color, back_color, border_color (#RRGGBB or style:Name), border / left_border / top_border / right_border / bottom_border (a style name or {style,width}), format (e.g. ЧДЦ=2, ДФ=dd.MM.yyyy), protection; null resets a property; insert_rows / delete_rows / insert_columns / delete_columns — at, count, columns_id for column sets; merges, areas and drawings move with the grid; merge_cells — row, column, rows, columns, or unmerge=true; set_size — column (+to_column) with width in template units, or row (+to_row) with height in points (0 = automatic); set_print_settings — orientation, scale, fit_to_page, paper, copies, black_and_white, first_page_number, top/left/bottom/right_margin and header/footer_size in mm, print_area {begin_row,end_row,begin_column,end_column} or null; set_header_footer — kind header|footer, left/center/right texts ([&НомерСтраницы], [&СтраницВсего], [&Дата], [&Время]), font, remove. Правка макета печатной формы: области, параметры, оформление, строки и колонки, объединения, размеры, печать, колонтитулы.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Path to Template.xml."},"operation":{"type":"string","enum":["set_area","set_parameter","set_format","insert_rows","delete_rows","insert_columns","delete_columns","merge_cells","set_size","set_print_settings","set_header_footer"]},"name":{"type":"string","description":"Area name (set_area) or parameter name (set_parameter); a 1C identifier."},"begin_row":{"type":"integer","minimum":1},"end_row":{"type":"integer","minimum":1},"begin_column":{"type":"integer","minimum":1},"end_column":{"type":"integer","minimum":1},"remove":{"type":"boolean","description":"set_area: remove the named area; set_header_footer: remove the header or footer."},"row":{"type":"integer","minimum":1},"column":{"type":"integer","minimum":1},"template":{"type":"string","description":"Text with [Name] parameters, for example «Счёт № [Номер] от [Дата]»."},"text":{"type":"string","description":"Plain text for the cell."},"detail":{"type":"string","description":"Drill-down parameter name; empty string removes it."},"to_row":{"type":"integer","minimum":1},"to_column":{"type":"integer","minimum":1},"font":{"anyOf":[{"type":"object","properties":{"face":{"type":"string"},"size":{"type":"number"},"bold":{"type":"boolean"},"italic":{"type":"boolean"},"underline":{"type":"boolean"},"strikeout":{"type":"boolean"}}},{"type":"null"}],"description":"set_format, set_header_footer: font changes; null (set_format) returns to the inherited font."},"horizontal_alignment":{"anyOf":[{"type":"string","enum":["Left","Center","Right","Justify","Auto"]},{"type":"null"}]},"vertical_alignment":{"anyOf":[{"type":"string","enum":["Top","Center","Bottom"]},{"type":"null"}]},"text_placement":{"anyOf":[{"type":"string","enum":["Auto","Wrap","Cut","Block"]},{"type":"null"}]},"indent":{"anyOf":[{"type":"integer","minimum":0},{"type":"null"}]},"text_color":{"anyOf":[{"type":"string"},{"type":"null"}],"description":"#RRGGBB or style:/web:/win:Name."},"back_color":{"anyOf":[{"type":"string"},{"type":"null"}]},"border_color":{"anyOf":[{"type":"string"},{"type":"null"}]},"border":{"description":"Line: a style name (None, Solid, Dotted, Dashed, DashDotted, DashDottedDotted, ThinDashed, LargeDashed, ThickDashed, Double) or { style, width }.","anyOf":[{"type":"string"},{"type":"object","properties":{"style":{"type":"string"},"width":{"type":"integer","minimum":1}}},{"type":"null"}]},"left_border":{"description":"Line: a style name (None, Solid, Dotted, Dashed, DashDotted, DashDottedDotted, ThinDashed, LargeDashed, ThickDashed, Double) or { style, width }.","anyOf":[{"type":"string"},{"type":"object","properties":{"style":{"type":"string"},"width":{"type":"integer","minimum":1}}},{"type":"null"}]},"top_border":{"description":"Line: a style name (None, Solid, Dotted, Dashed, DashDotted, DashDottedDotted, ThinDashed, LargeDashed, ThickDashed, Double) or { style, width }.","anyOf":[{"type":"string"},{"type":"object","properties":{"style":{"type":"string"},"width":{"type":"integer","minimum":1}}},{"type":"null"}]},"right_border":{"description":"Line: a style name (None, Solid, Dotted, Dashed, DashDotted, DashDottedDotted, ThinDashed, LargeDashed, ThickDashed, Double) or { style, width }.","anyOf":[{"type":"string"},{"type":"object","properties":{"style":{"type":"string"},"width":{"type":"integer","minimum":1}}},{"type":"null"}]},"bottom_border":{"description":"Line: a style name (None, Solid, Dotted, Dashed, DashDotted, DashDottedDotted, ThinDashed, LargeDashed, ThickDashed, Double) or { style, width }.","anyOf":[{"type":"string"},{"type":"object","properties":{"style":{"type":"string"},"width":{"type":"integer","minimum":1}}},{"type":"null"}]},"format":{"anyOf":[{"type":"string"},{"type":"null"}],"description":"1C format string, e.g. ЧДЦ=2 or ДФ=dd.MM.yyyy."},"protection":{"type":"boolean"},"at":{"type":"integer","minimum":1,"description":"Insert before this row/column, or delete starting from it."},"count":{"type":"integer","minimum":1,"description":"Rows or columns to insert or delete; 1 by default."},"columns_id":{"type":"string","description":"Column set id for column edits; the default set when omitted."},"rows":{"type":"integer","minimum":1},"columns":{"type":"integer","minimum":1},"unmerge":{"type":"boolean"},"width":{"type":"number","minimum":0},"height":{"type":"number","minimum":0},"orientation":{"type":"string","enum":["Portrait","Landscape"]},"scale":{"type":"integer","minimum":10,"maximum":400},"fit_to_page":{"type":"boolean"},"paper":{"type":"integer","minimum":0},"copies":{"type":"integer","minimum":0},"black_and_white":{"type":"boolean"},"first_page_number":{"type":"integer","minimum":0},"top_margin":{"type":"number","minimum":0},"left_margin":{"type":"number","minimum":0},"bottom_margin":{"type":"number","minimum":0},"right_margin":{"type":"number","minimum":0},"header_size":{"type":"number","minimum":0},"footer_size":{"type":"number","minimum":0},"print_area":{"anyOf":[{"type":"object","properties":{"begin_row":{"type":"integer","minimum":1},"end_row":{"type":"integer","minimum":1},"begin_column":{"type":"integer","minimum":1},"end_column":{"type":"integer","minimum":1}}},{"type":"null"}]},"kind":{"type":"string","enum":["header","footer"]},"left":{"type":"string"},"center":{"type":"string"},"right":{"type":"string"}},"required":["path","operation"]},"annotations":{"readOnlyHint":false,"destructiveHint":true}})JSON";
}

/* Tools that read a managed form (Ext/Form.xml): always on. */
std::string formToolSchemas() {
    return u8R"JSON({"name":"list_form_elements","description":"List the items of a 1C managed form (Ext/Form.xml, or its Forms/Name.xml descriptor) as a tree: name, kind (InputField, UsualGroup, Page, Table, Button…), parent and data path. Use the names with edit_form. Показывает дерево элементов формы.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Path to Ext/Form.xml or the Forms/Name.xml descriptor."}},"required":["path"]},"annotations":{"readOnlyHint":true}},{"name":"validate_form","description":"Check a 1C managed form (Ext/Form.xml) for broken structure: duplicate ids, missing companion nodes (ContextMenu, ExtendedTooltip…), data paths without a form attribute, buttons without a command, events without a handler, main attribute count, format version. Run it after editing a form. Проверяет форму на ошибки структуры.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Path to Ext/Form.xml or the Forms/Name.xml descriptor."}},"required":["path"]},"annotations":{"readOnlyHint":true}})JSON";
}

/* The tool that changes a form; --no-form-edit-tools leaves it out. */
std::string formEditToolSchemas() {
    return u8R"JSON({"name":"edit_form","description":"Edit a 1C managed form (Ext/Form.xml) in place; pass path, operation and that operation's arguments. Items are addressed by name (see list_form_elements or preview with operation=inspect); only the touched nodes change, the rest of the file stays byte for byte. An open preview of the file is refreshed, so check it with capture_preview, and run validate_form after a series of edits. Operations: set_properties — element (omit or Form for the form itself) and properties {PropertyNode: value}: the XML node name as Designer writes it (Title, ToolTip, Visible, Enabled, ReadOnly, Width, Height, AutoMaxWidth, HorizontalStretch, VerticalStretch, TitleLocation, Group, Representation, ShowTitle…); multilingual properties take a string (ru) or {ru, en}; null returns a property to its default; enum values are checked. A color takes style:Name, web:Name, win:Name or #RRGGBB; a font takes {ref: \"style:Name\"} or {face, height, bold, italic, underline, strikeout, scale}; a picture takes CommonPicture.Name or StdPicture.Name; a choice list and the role tables are not changed. move_element — element and into (group, page, pages, table, command bar or Form) and/or after/before a sibling. add_element — element (the new name), kind (InputField, CheckBoxField, RadioButtonField, LabelField, LabelDecoration, PictureField, PictureDecoration, CalendarField, Table, UsualGroup, ColumnGroup, Pages, Page, Button, ButtonGroup, Popup, CommandBar and the document fields), into and/or after/before, and properties as in set_properties; the companion nodes (ContextMenu, ExtendedTooltip, a table's panels) and the ids are generated. remove_element — element with its companions and nested items; refused while standard commands or conditional appearance refer to it unless force=true; handlers in the form module are not touched. set_attribute — name plus type for a new form attribute, and columns for a table attribute (string, string(100), string(1,fixed), boolean, number(15,2), number(15,2,nonnegative), date, dateTime, time, CatalogRef.Имя, DocumentObject.Имя, EnumRef.Имя, DefinedType.Имя, ValueTable, several types through |, or a ready cfg:/v8:/xs: name), title, main, saved_data, fill_check; remove=true deletes it, refused while a data path uses it unless force=true. set_command — name, action (the handler name in the form module, which is not created), title, tooltip, shortcut, representation, modifies_saved_data, current_row_use; remove=true deletes it, refused while a button uses it unless force=true. Правка управляемой формы: свойства, перенос и удаление элементов.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Path to Ext/Form.xml or the Forms/Name.xml descriptor."},"operation":{"type":"string","enum":["set_properties","add_element","move_element","remove_element","set_attribute","set_command"]},"element":{"type":"string","description":"Item name; for set_properties omit or pass Form to change the form."},"kind":{"type":"string","description":"add_element: the kind of item to create."},"name":{"type":"string","description":"set_attribute, set_command: the attribute or command name."},"type":{"type":"string","description":"set_attribute: the type spelling, for example string(100) or CatalogRef.Организации."},"title":{"description":"set_attribute, set_command: a string (ru) or { ru, en }; null removes it.","anyOf":[{"type":"string"},{"type":"object"},{"type":"null"}]},"tooltip":{"anyOf":[{"type":"string"},{"type":"object"},{"type":"null"}]},"action":{"type":"string","description":"set_command: the handler procedure name."},"shortcut":{"type":"string","description":"set_command: for example Ctrl+Enter or F5."},"representation":{"type":"string","enum":["Auto","Text","Picture","TextPicture"]},"modifies_saved_data":{"type":"boolean"},"current_row_use":{"type":"string","enum":["Auto","Use","DontUse"]},"main":{"type":"boolean","description":"set_attribute: the main attribute of the form."},"saved_data":{"type":"boolean"},"fill_check":{"type":"string","enum":["ShowError","DontCheck"]},"columns":{"type":"array","description":"set_attribute: columns of a ValueTable or ValueTree attribute, [{ name, type, title, remove }]; ids are numbered inside the attribute.","items":{"type":"object"}},"remove":{"type":"boolean","description":"set_attribute, set_command: delete the attribute or command."},"properties":{"type":"object","description":"set_properties: {PropertyNode: value}; null resets to the default.","additionalProperties":true},"into":{"type":"string","description":"move_element: target container name or Form."},"after":{"type":"string","description":"move_element: place after this sibling."},"before":{"type":"string","description":"move_element: place before this sibling."},"force":{"type":"boolean","description":"remove_element: remove even when other nodes refer to the item."}},"required":["path","operation"]},"annotations":{"readOnlyHint":false,"destructiveHint":true}})JSON";
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

std::string failure(std::string_view id, const std::string& message) {
    return "{\"jsonrpc\":\"2.0\",\"id\":" + std::string(id) + ",\"result\":{\"isError\":true,\"content\":[{\"type\":\"text\",\"text\":" + json_string(message) + "}]}}";
}

class McpApp {
public:
    explicit McpApp(Options options) : options_(std::move(options)), preview_(options_.base / L"app" / L"web") {
        preview_.setContextAccess([this](const fs::path& candidate) { return allowed(options_, candidate); });
    }

    std::string request(const Json& request) {
        const auto* id = request.get("id");
        const std::string idRaw = id ? id->dump() : "null";
        const std::string method = request.get("method") ? request.get("method")->asString() : std::string();
        if (!id && method.rfind("notifications/", 0) == 0) return {};
        try {
            if (method == "initialize") {
                const std::string instructions = u8"This server provides visual inspection of 1C form layouts. When a user asks to see, show, inspect, or open a 1C form, call open_preview instead of opening XML source or launching 1C:Enterprise/configurator. Prefer and automatically resolve nested Ext/Form.xml layouts from Forms/ИмяФормы.xml descriptors. Call preview with operation=inspect after opening to discover page and element IDs; the same tool switches tabs, selects, scrolls, reloads and closes, and preview_id picks one of several open previews. Every open_preview call must state its audience: \"user\" when the user asks to show, open or see something (a window appears on the user's screen), \"agent\" when the preview is only for your own inspection (a hidden browser; neither the preview nor your capture_preview images reach the user). Each file opens as its own preview with a preview_id and URL, so several previews stay open at once; pass preview_id to the other tools to target one. Этот сервер предназначен для визуального просмотра макетов форм 1С. Если пользователь просит показать, открыть или осмотреть форму, вызовите open_preview вместо открытия XML или запуска 1С. Для описателей форм используйте вложенный Ext/Form.xml. Инспекция, вкладки, выделение, прокрутка, перечитывание и закрытие — инструмент preview с operation. Для каждого вызова open_preview решите, для кого он: audience=\"user\" — пользователь просит показать (окно на его экране), audience=\"agent\" — только для вас (скрытый браузер, пользователь ничего не видит). Каждый файл — отдельное превью со своей ссылкой и preview_id.";
                const std::string templateNote = std::string(u8" Print form templates: convert_xlsx_to_template turns an xlsx layout into Template.xml; list_markup shows its areas and parameters, validate_template checks it.")
                    + (options_.templateEditTools
                        ? std::string(u8" edit_template changes it (areas, parameters, formats, rows and columns, merges, sizes, print settings, headers and footers); after each change check the refreshed preview with capture_preview.")
                        : std::string())
                    + u8" Макет печатной формы: convert_xlsx_to_template, разметка list_markup, проверка validate_template и capture_preview."
                    + std::string(u8" Managed forms: list_form_elements shows the item tree, validate_form checks Form.xml.")
                    + (options_.formEditTools
                        ? std::string(u8" edit_form changes item and form properties, moves and removes items; after each change check the refreshed preview with capture_preview.")
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
                    {"scroll", "scroll_preview"}, {"reload", "reload_preview"}, {"url", "get_preview_url"},
                    {"close", "close_preview"},
                };
                const auto found = previewOperations.find(argString(arguments, "operation"));
                if (found == previewOperations.end())
                    throw std::runtime_error("operation must be one of inspect, switch_tab, select, scroll, reload, url, close.");
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
                Document document = loadDocument(options_, input);
                const std::string requestedPath = utf8_from_wide(document.requestedPath.wstring());
                const std::string resolvedPath = utf8_from_wide(document.resolvedPath.wstring());
                const std::string kind = documentKind(document.resolvedPath);
                const std::uintmax_t size = document.size;
                const std::string encoding = document.encoding;
                preview_.start();
                const std::string previewId = openSession(std::move(document), input);
                const std::string url = preview_.url(previewId);
                std::string presentation = "client";
                if (clientPresents()) {
                    /* The client shows previewUrl itself (VS Code openNow, tests). */
                } else if (forUser) {
                    if (headlessSession_ == previewId) headless_.stop();
                    openPreviewUrl(options_, url);
                    shownAt_[previewId] = std::chrono::steady_clock::now();
                    presentation = "window";
                } else {
                    presentation = "hidden";
                    try { ensurePage(previewId); } catch (const std::exception&) { presentation = "unavailable"; }
                }
                const std::string value = "{\"requestedPath\":" + json_string(requestedPath)
                    + ",\"resolvedPath\":" + json_string(resolvedPath)
                    + ",\"path\":" + json_string(resolvedPath)
                    + ",\"size\":" + std::to_string(size)
                    + ",\"encoding\":" + json_string(encoding)
                    + ",\"previewId\":" + json_string(previewId)
                    + ",\"previewUrl\":" + json_string(url)
                    + ",\"presentation\":" + json_string(presentation)
                    + ",\"audience\":" + json_string(forUser ? "user" : "agent")
                    + ",\"kind\":" + json_string(kind) + "}";
                const std::string lead = presentation == "hidden"
                    ? u8"Открыто ДЛЯ АГЕНТА в скрытом браузере: пользователь этого не видит, и снимки capture_preview ему тоже не видны. "
                      u8"Если пользователь просил показать или открыть — вызовите open_preview с audience=\"user\"."
                    : presentation == "unavailable"
                    ? u8"Визуальное представление подготовлено, но скрытый браузер (Microsoft Edge или Google Chrome) не найден. "
                      u8"Откройте с audience=\"user\"."
                    : presentation == "window"
                    ? u8"Открыто ДЛЯ ПОЛЬЗОВАТЕЛЯ: отдельное окно браузера на его экране. Другие открытые превью остаются доступны по своим ссылкам."
                    : u8"Визуальное представление открыто в 1C Form Viewer.";
                const std::string message = lead + u8"\nФактический макет: " + resolvedPath + "\npreview_id: " + previewId + "\nPreview URL: " + url;
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
            if (name == "close_preview") {
                const std::string requested = argString(arguments, "preview_id");
                if (requested.empty()) {
                    headless_.stop();
                    headlessSession_.clear();
                    preview_.close();
                    inputs_.clear();
                    shownAt_.clear();
                    return success(idRaw, "{\"closed\":true}");
                }
                const std::string previewId = preview_.resolve(requested);
                if (headlessSession_ == previewId) { headless_.stop(); headlessSession_.clear(); }
                preview_.closeSession(previewId);
                inputs_.erase(previewId);
                shownAt_.erase(previewId);
                return success(idRaw, "{\"closed\":true,\"previewId\":" + json_string(previewId) + "}");
            }
            if (name == "get_preview_url") {
                const std::string target = options_.openInVsCode ? "vscode-simple-browser"
                    : options_.openBrowser ? "external-browser" : "client";
                const std::string previewId = preview_.resolve(argString(arguments, "preview_id"));
                return success(idRaw, "{\"previewId\":" + json_string(previewId)
                    + ",\"previewUrl\":" + json_string(preview_.url(previewId))
                    + ",\"previews\":" + preview_.listJson()
                    + ",\"externalBrowser\":" + (options_.openBrowser && !options_.openInVsCode ? "true" : "false")
                    + ",\"presentationTarget\":" + json_string(target) + "}");
            }
            /* Every remaining tool drives the page of one preview. */
            const std::string previewId = preview_.resolve(argString(arguments, "preview_id"));
            if (name == "reload_preview") {
                preview_.setDocument(previewId, loadDocument(options_, inputs_.at(previewId)));
                ensurePage(previewId);
                return success(idRaw, preview_.command(previewId, "state", "{}"));
            }
            ensurePage(previewId);
            if (name == "inspect_preview") {
                std::string args = "{\"query\":" + json_string(argString(arguments, "query")) + ",\"visibleOnly\":" + ((arguments && arguments->get("visible_only") && arguments->get("visible_only")->asBool()) ? "true" : "false") + "}";
                return success(idRaw, preview_.command(previewId, "inspect", args));
            }
            if (name == "switch_tab") return success(idRaw, preview_.command(previewId, "switchTab", "{\"pageId\":" + json_string(argString(arguments, "page_id")) + ",\"pagesId\":" + json_string(argString(arguments, "pages_id")) + "}"));
            if (name == "select_element") return success(idRaw, preview_.command(previewId, "select", "{\"elementId\":" + json_string(argString(arguments, "element_id")) + "}"));
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
                return success(idRaw, preview_.command(previewId, "scroll", Json::objectValue(std::move(scrollArgs)).dump()));
            }
            if (name == "capture_preview") {
                const std::string scope = argString(arguments, "scope").empty() ? "viewport" : argString(arguments, "scope");
                const std::string result = preview_.command(previewId, "capture", "{\"scope\":" + json_string(scope) + ",\"elementId\":" + json_string(argString(arguments, "element_id")) + "}", true, scope == "document" ? 180 : 30);
                const Json payload = JsonParser(result).parse();
                const auto* data = payload.get("data");
                const auto* mime = payload.get("mimeType");
                if (!data || !mime) throw std::runtime_error("The browser returned no image.");
                return success(idRaw, "{\"scope\":" + json_string(scope) + "}", data->asString());
            }
            throw std::runtime_error("Unknown tool: " + name);
        } catch (const std::exception& error) {
            return failure(idRaw, error.what());
        }
    }

private:
    Options options_;
    PreviewServer preview_;
    /* Declared after preview_: destroyed first, while the server still runs. */
    HeadlessBrowser headless_;
    /* The preview the hidden renderer shows: one page at a time, moved to
     * whichever preview a command targets. */
    std::string headlessSession_;
    std::map<std::string, std::string> inputs_;
    std::map<std::string, std::chrono::steady_clock::time_point> shownAt_;

    std::string openSession(Document document, const std::string& input) {
        const std::string previewId = preview_.openSession(std::move(document),
            [options = options_, input] { return loadDocument(options, input); });
        inputs_[previewId] = input;
        return previewId;
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
                Document document = loadDocument(options_, input);
                if (lower_wide(document.resolvedPath.wstring()) != lower_wide(written.wstring())) continue;
                preview_.setDocument(previewId, std::move(document));
                refreshed = true;
            } catch (const std::exception&) {}
        }
        return refreshed;
    }

    /* Commands need a page running the preview. Start the hidden renderer when
     * no page of this preview has polled recently: never opened, the user
     * closed the visible window, or the renderer shows another preview. A
     * just-requested window gets a grace period to start polling. */
    void ensurePage(const std::string& previewId) {
        using namespace std::chrono;
        if (clientPresents() || preview_.pageActive(previewId, seconds(3))) return;
        if (headlessSession_ == previewId && headless_.running()) return;
        const auto shown = shownAt_.find(previewId);
        if (shown != shownAt_.end() && steady_clock::now() - shown->second < seconds(15)) return;
        headless_.stop();
        if (!headlessSession_.empty()) preview_.forgetPoll(headlessSession_);
        headlessSession_.clear();
        if (!headless_.start(preview_.url(previewId) + "&bare=1"))
            throw std::runtime_error("No preview page is connected and neither Microsoft Edge nor Google Chrome was found "
                                     "for the hidden renderer. Call open_preview with audience=\"user\".");
        headlessSession_ = previewId;
    }
};

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
        else if (argument == L"--no-open-browser") options.openBrowser = false;
        else if (argument == L"--open-vscode-browser") options.openInVsCode = true;
        else if (argument == L"--vscode-uri-scheme" && index + 1 < argc) {
            options.vscodeUriScheme = argv[++index];
            if (!validUriScheme(options.vscodeUriScheme)) { std::wcerr << L"Invalid VS Code URI scheme\n"; return 2; }
        }
        else if (argument == L"--max-bytes" && index + 1 < argc) options.maxBytes = std::stoull(argv[++index]);
        else if (argument == L"--stdio") continue;
        else if (argument == L"--help" || argument == L"-h") {
            std::wcout << L"1c-form-viewer-native --stdio [--root PATH ... | --allow-any-path] [--no-open-browser | --open-vscode-browser [--vscode-uri-scheme SCHEME]] [--no-template-edit-tools] [--no-form-edit-tools]\n"
                          L"Previews render in a hidden headless Edge/Chrome; open_preview show=true opens a visible window.\n";
            return 0;
        } else if (argument == L"--version" || argument == L"-v") { std::wcout << ONE_C_FORM_VIEWER_VERSION_W << std::endl; return 0; }
        else if (argument.rfind(L"--", 0) == 0) { std::wcerr << L"Unknown option: " << argument << L"\n"; return 2; }
    }
    // Match the Node CLI: cwd is only the fallback when the caller supplied
    // no explicit root. Otherwise an extension-provided allowlist must remain
    // exact and must not be widened by the process launch directory.
    if (options.roots.empty()) options.roots.push_back(fs::current_path());

    McpApp app(options);
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;
        try {
            Json request = JsonParser(line).parse();
            const std::string response = app.request(request);
            if (!response.empty()) std::cout << response << std::endl;
        } catch (const std::exception& error) {
            std::cerr << "1c-form-viewer-native: " << error.what() << '\n';
        }
    }
    return 0;
}
