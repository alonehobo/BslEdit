#include "epfunpack.h"

#include <shlobj.h>
#include <wincrypt.h>
#include <shlwapi.h>
#include <stdio.h>
#include <algorithm>
#include <filesystem>

#include "bslcommon.h"
#include "gitquery.h"

namespace fs = std::filesystem;

namespace epf {

namespace {

// Service infobases with a configuration (CF) kept in the cache at once.
const int kMaxConfigCaches = 3;
const wchar_t* kMetaFile = L"meta.ini";

std::wstring Lower(std::wstring s)
{
    if (!s.empty()) CharLowerBuffW(&s[0], (DWORD)s.size());
    return s;
}

bool EqualsNoCase(const std::wstring& a, const std::wstring& b)
{
    return _wcsicmp(a.c_str(), b.c_str()) == 0;
}

std::wstring Trim(const std::wstring& s)
{
    size_t b = s.find_first_not_of(L" \t\r\n");
    if (b == std::wstring::npos) return std::wstring();
    size_t e = s.find_last_not_of(L" \t\r\n");
    return s.substr(b, e - b + 1);
}

std::wstring Join(const std::wstring& dir, const std::wstring& name)
{
    if (dir.empty()) return name;
    wchar_t last = dir[dir.size() - 1];
    return (last == L'\\' || last == L'/') ? dir + name : dir + L"\\" + name;
}

std::wstring FileStem(const std::wstring& path)
{
    std::wstring name = PathFindFileNameW(path.c_str());
    size_t dot = name.rfind(L'.');
    return dot == std::wstring::npos || dot == 0 ? name : name.substr(0, dot);
}

bool FileExists(const std::wstring& path)
{
    DWORD a = GetFileAttributesW(path.c_str());
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

bool DirExists(const std::wstring& path)
{
    DWORD a = GetFileAttributesW(path.c_str());
    return a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY);
}

bool RemoveTree(const std::wstring& path)
{
    std::error_code ec;
    fs::remove_all(fs::path(path), ec);
    return !ec && !DirExists(path) && !FileExists(path);
}

void TryRemove(const std::wstring& path)
{
    RemoveTree(path);
}

bool MakeDirs(const std::wstring& path)
{
    std::error_code ec;
    fs::create_directories(fs::path(path), ec);
    return DirExists(path);
}

std::wstring NowStamp()
{
    SYSTEMTIME st;
    GetLocalTime(&st);
    wchar_t buf[32];
    swprintf(buf, 32, L"%04u-%02u-%02uT%02u:%02u:%02u",
             st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);
    return buf;
}

// yyyy-MM-ddTHH:mm:ss -> dd.MM.yyyy HH:mm
std::wstring DisplayStamp(const std::wstring& s)
{
    if (s.size() < 16) return s;
    return s.substr(8, 2) + L"." + s.substr(5, 2) + L"." + s.substr(0, 4) + L" " + s.substr(11, 5);
}

std::map<std::wstring, std::wstring> ReadKeyValues(const std::wstring& path)
{
    std::map<std::wstring, std::wstring> result;
    TextFile file = ReadTextFile(path.c_str(), 1024 * 1024);
    if (!file.ok) return result;
    size_t pos = 0;
    const std::wstring& t = file.text;
    while (pos < t.size()) {
        size_t nl = t.find(L'\n', pos);
        std::wstring line = t.substr(pos, nl == std::wstring::npos ? std::wstring::npos : nl - pos);
        if (!line.empty() && line[line.size() - 1] == L'\r') line.erase(line.size() - 1);
        size_t eq = line.find(L'=');
        if (eq != std::wstring::npos && eq > 0) result[line.substr(0, eq)] = line.substr(eq + 1);
        if (nl == std::wstring::npos) break;
        pos = nl + 1;
    }
    return result;
}

void WriteKeyValues(const std::wstring& path, const std::vector<std::pair<std::wstring, std::wstring>>& values)
{
    std::wstring text;
    for (const auto& v : values) text += v.first + L"=" + v.second + L"\r\n";
    WriteTextFile(path.c_str(), text, ENC_UTF8);
}

std::wstring ValueOr(const std::map<std::wstring, std::wstring>& m, const wchar_t* key)
{
    auto it = m.find(key);
    return it == m.end() ? std::wstring() : it->second;
}

std::wstring KnownFolder(REFKNOWNFOLDERID id)
{
    PWSTR raw = NULL;
    std::wstring result;
    if (SUCCEEDED(SHGetKnownFolderPath(id, 0, NULL, &raw)) && raw) result = raw;
    if (raw) CoTaskMemFree(raw);
    return result;
}

std::wstring EnvVar(const wchar_t* name)
{
    wchar_t buf[MAX_PATH * 2];
    DWORD n = GetEnvironmentVariableW(name, buf, MAX_PATH * 2);
    return n && n < MAX_PATH * 2 ? std::wstring(buf, n) : std::wstring();
}

std::vector<int> VersionParts(const std::wstring& v)
{
    std::vector<int> parts;
    int cur = -1;
    for (wchar_t c : v) {
        if (c >= L'0' && c <= L'9') {
            cur = (cur < 0 ? 0 : cur) * 10 + (c - L'0');
        } else if (c == L'.' && cur >= 0) {
            parts.push_back(cur);
            cur = -1;
        } else {
            return std::vector<int>();
        }
    }
    if (cur < 0) return std::vector<int>();
    parts.push_back(cur);
    return parts;
}

unsigned long long Fnv64(const std::wstring& s)
{
    unsigned long long h = 1469598103934665603ULL;
    for (wchar_t c : s) {
        h ^= (unsigned long long)(c & 0xFF);
        h *= 1099511628211ULL;
        h ^= (unsigned long long)((c >> 8) & 0xFF);
        h *= 1099511628211ULL;
    }
    return h;
}

std::wstring CfFingerprint(const std::wstring& cfPath, const std::wstring& version)
{
    WIN32_FILE_ATTRIBUTE_DATA data = {};
    wchar_t full[MAX_PATH * 2] = {};
    GetFullPathNameW(cfPath.c_str(), MAX_PATH * 2, full, NULL);
    GetFileAttributesExW(cfPath.c_str(), GetFileExInfoStandard, &data);
    wchar_t buf[128];
    swprintf(buf, 128, L"|%lu|%lu|%lu|%lu|", data.nFileSizeHigh, data.nFileSizeLow,
             data.ftLastWriteTime.dwHighDateTime, data.ftLastWriteTime.dwLowDateTime);
    unsigned long long h = Fnv64(Lower(full) + buf + version);
    swprintf(buf, 128, L"%012llx", h & 0xFFFFFFFFFFFFULL);
    return buf;
}

// ibcmd has one "config export" for configurations and external files alike
// (--file), so its messages speak of a configuration.
std::wstring RewriteExportLine(const std::wstring& line, bool report)
{
    std::wstring out = line;
    const wchar_t* what = report ? L"отчёта" : L"обработки";
    struct { const wchar_t* from; std::wstring to; } rules[] = {
        { L"Экспорт конфигурации в XML успешно завершен", std::wstring(L"Выгрузка ") + what + L" в XML успешно завершена" },
        { L"Экспорт конфигурации в XML", std::wstring(L"Выгрузка ") + what + L" в XML" },
    };
    for (const auto& r : rules) {
        size_t at = out.find(r.from);
        if (at != std::wstring::npos) out.replace(at, wcslen(r.from), r.to);
    }
    return out;
}

std::wstring DecodeLine(const std::string& bytes)
{
    if (bytes.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes.data(), (int)bytes.size(), NULL, 0);
    UINT cp = CP_UTF8;
    DWORD flags = MB_ERR_INVALID_CHARS;
    if (n <= 0) {   // not UTF-8: an older ibcmd writes the OEM code page
        cp = GetOEMCP();
        flags = 0;
        n = MultiByteToWideChar(cp, 0, bytes.data(), (int)bytes.size(), NULL, 0);
    }
    std::wstring out(n > 0 ? n : 0, L'\0');
    if (n > 0) MultiByteToWideChar(cp, flags, bytes.data(), (int)bytes.size(), &out[0], n);
    return out;
}

struct PipeReader {
    HANDLE pipe;
    const std::function<void(const std::wstring&)>* onLine;
};

void EmitLine(const PipeReader* r, std::string& pending)
{
    if (!pending.empty() && pending[pending.size() - 1] == '\r') pending.erase(pending.size() - 1);
    std::wstring line = DecodeLine(pending);
    pending.clear();
    if (r->onLine && !Trim(line).empty()) (*r->onLine)(line);
}

DWORD WINAPI ReaderProc(LPVOID param)
{
    PipeReader* r = (PipeReader*)param;
    std::string pending;
    char buf[4096];
    DWORD got = 0;
    while (ReadFile(r->pipe, buf, sizeof(buf), &got, NULL) && got) {
        for (DWORD i = 0; i < got; i++) {
            if (buf[i] == '\n') EmitLine(r, pending);
            else pending += buf[i];
        }
    }
    if (!pending.empty()) EmitLine(r, pending);
    return 0;
}

struct CacheEntry {
    std::wstring dir;
    std::wstring lastUsed;
};

} // namespace

// --- Platforms and infobases -------------------------------------------------

int CompareVersions(const std::wstring& a, const std::wstring& b)
{
    std::vector<int> x = VersionParts(a), y = VersionParts(b);
    for (size_t i = 0; i < x.size() || i < y.size(); i++) {
        int p = i < x.size() ? x[i] : 0, q = i < y.size() ? y[i] : 0;
        if (p != q) return p < q ? -1 : 1;
    }
    return 0;
}

std::vector<Platform> FindPlatforms()
{
    /* A 32-bit Total Commander sees "Program Files (x86)" as ProgramFiles;
     * ProgramW6432 still names the 64-bit folder. */
    std::vector<std::wstring> roots;
    const wchar_t* vars[] = { L"ProgramW6432", L"ProgramFiles", L"ProgramFiles(x86)" };
    for (const wchar_t* var : vars) {
        std::wstring root = EnvVar(var);
        if (root.empty()) continue;
        bool known = false;
        for (const auto& r : roots) known = known || EqualsNoCase(r, root);
        if (!known) roots.push_back(root);
    }

    std::vector<Platform> result;
    for (const auto& root : roots) {
        std::wstring dir = Join(root, L"1cv8");
        WIN32_FIND_DATAW fd = {};
        HANDLE find = FindFirstFileW(Join(dir, L"*").c_str(), &fd);
        if (find == INVALID_HANDLE_VALUE) continue;
        do {
            if (!(fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
            std::wstring version = fd.cFileName;
            if (VersionParts(version).size() < 2) continue;
            std::wstring ibcmd = Join(Join(Join(dir, version), L"bin"), L"ibcmd.exe");
            if (!FileExists(ibcmd)) continue;
            bool known = false;
            for (const auto& p : result) known = known || CompareVersions(p.version, version) == 0;
            if (!known) result.push_back(Platform{ version, ibcmd });
        } while (FindNextFileW(find, &fd));
        FindClose(find);
    }
    std::sort(result.begin(), result.end(), [](const Platform& a, const Platform& b) {
        return CompareVersions(a.version, b.version) > 0;
    });
    return result;
}

std::map<std::wstring, std::wstring> ParseConnect(const std::wstring& s)
{
    std::map<std::wstring, std::wstring> result;
    size_t i = 0;
    while (i < s.size()) {
        size_t eq = s.find(L'=', i);
        if (eq == std::wstring::npos) break;
        std::wstring key = Trim(s.substr(i, eq - i));
        while (!key.empty() && key[0] == L';') key = Trim(key.substr(1));
        i = eq + 1;
        std::wstring value;
        if (i < s.size() && s[i] == L'"') {
            i++;
            while (i < s.size()) {
                if (s[i] == L'"') {
                    if (i + 1 < s.size() && s[i + 1] == L'"') { value += L'"'; i += 2; continue; }
                    i++;
                    break;
                }
                value += s[i++];
            }
            while (i < s.size() && s[i] != L';') i++;
        } else {
            while (i < s.size() && s[i] != L';') value += s[i++];
        }
        i++;   // ';'
        if (!key.empty()) result[Lower(key)] = value;
    }
    return result;
}

std::vector<std::wstring> DesignerConnectArgs(const std::wstring& connect)
{
    auto p = ParseConnect(connect);
    if (p.count(L"file")) return { L"/F", p[L"file"] };
    if (p.count(L"srvr") && p.count(L"ref")) return { L"/S", p[L"srvr"] + L"\\" + p[L"ref"] };
    return std::vector<std::wstring>();
}

std::wstring FileBasePath(const std::wstring& connect)
{
    auto p = ParseConnect(connect);
    return p.count(L"file") ? p[L"file"] : std::wstring();
}

std::wstring ConnectDisplay(const std::wstring& connect)
{
    auto p = ParseConnect(connect);
    if (p.count(L"file")) return p[L"file"];
    if (p.count(L"srvr") && p.count(L"ref")) return p[L"srvr"] + L"\\" + p[L"ref"];
    return connect;
}

std::vector<InfoBase> ParseIbases(const std::wstring& text)
{
    std::vector<InfoBase> result;
    std::wstring name, id, connect;
    bool inSection = false;
    auto flush = [&]() {
        if (inSection && !connect.empty()) result.push_back(InfoBase{ name, id.empty() ? connect : id, connect });
        name.clear(); id.clear(); connect.clear();
        inSection = false;
    };
    size_t pos = !text.empty() && text[0] == 0xFEFF ? 1 : 0;   // a BOM left in the text
    while (pos <= text.size()) {
        size_t nl = text.find(L'\n', pos);
        std::wstring line = Trim(text.substr(pos, nl == std::wstring::npos ? std::wstring::npos : nl - pos));
        if (line.size() >= 2 && line[0] == L'[' && line[line.size() - 1] == L']') {
            flush();
            name = line.substr(1, line.size() - 2);
            inSection = true;
        } else if (_wcsnicmp(line.c_str(), L"Connect=", 8) == 0) {
            connect = line.substr(8);
        } else if (_wcsnicmp(line.c_str(), L"ID=", 3) == 0) {
            id = line.substr(3);
        }
        if (nl == std::wstring::npos) break;
        pos = nl + 1;
    }
    flush();
    std::sort(result.begin(), result.end(), [](const InfoBase& a, const InfoBase& b) {
        return CompareStringW(LOCALE_USER_DEFAULT, NORM_IGNORECASE, a.name.c_str(), -1, b.name.c_str(), -1) == CSTR_LESS_THAN;
    });
    return result;
}

std::vector<InfoBase> LoadIbases()
{
    std::wstring path = Join(KnownFolder(FOLDERID_RoamingAppData), L"1C\\1CEStart\\ibases.v8i");
    TextFile file = ReadTextFile(path.c_str(), 16 * 1024 * 1024);
    return file.ok ? ParseIbases(file.text) : std::vector<InfoBase>();
}

// --- Paths --------------------------------------------------------------------

std::wstring QuoteArg(const std::wstring& arg)
{
    if (!arg.empty() && arg.find_first_of(L" \t\n\v\"") == std::wstring::npos) return arg;
    std::wstring out = L"\"";
    size_t backslashes = 0;
    for (wchar_t c : arg) {
        if (c == L'\\') { backslashes++; continue; }
        // Backslashes before a quote are doubled, the quote itself escaped.
        out.append(c == L'"' ? backslashes * 2 + 1 : backslashes, L'\\');
        backslashes = 0;
        out += c;
    }
    out.append(backslashes * 2, L'\\');
    out += L'"';
    return out;
}

std::wstring DefaultTarget(const std::wstring& file)
{
    std::wstring f = Trim(file);
    if (f.empty()) return std::wstring();
    wchar_t full[MAX_PATH * 2] = {};
    if (!GetFullPathNameW(f.c_str(), MAX_PATH * 2, full, NULL)) return std::wstring();
    std::wstring dir = full;
    size_t slash = dir.find_last_of(L"\\/");
    dir = slash == std::wstring::npos ? std::wstring() : dir.substr(0, slash);
    /* Project copies often live in <project>\build, while source exports are
     * grouped by object kind below <project>\src. */
    if (_wcsicmp(PathFindFileNameW(dir.c_str()), L"build") == 0) {
        dir = Join(dir.substr(0, dir.find_last_of(L"\\/")), L"src");
        const wchar_t* ext = PathFindExtensionW(f.c_str());
        if (_wcsicmp(ext, L".epf") == 0) dir = Join(dir, L"epf");
        else if (_wcsicmp(ext, L".erf") == 0) dir = Join(dir, L"erf");
        else if (_wcsicmp(ext, L".cf") == 0) dir = Join(dir, L"cf");
        else if (_wcsicmp(ext, L".cfe") == 0) dir = Join(dir, L"cfe");
    }
    return Join(dir, FileStem(f));
}

FileKind KindOfFile(const std::wstring& path)
{
    std::wstring p = Trim(path);
    while (!p.empty() && p[p.size() - 1] == L'"') p.erase(p.size() - 1);
    const wchar_t* ext = PathFindExtensionW(p.c_str());
    if (_wcsicmp(ext, L".epf") == 0 || _wcsicmp(ext, L".erf") == 0) return FILE_EXTERNAL;
    if (_wcsicmp(ext, L".cf") == 0) return FILE_CF;
    if (_wcsicmp(ext, L".cfe") == 0) return FILE_CFE;
    if (_wcsicmp(ext, L".dt") == 0) return FILE_DT;
    return FILE_OTHER;
}

std::wstring RootXmlPath(const std::wstring& file, const std::wstring& target)
{
    if (Trim(file).empty() || Trim(target).empty()) return std::wstring();
    if (KindOfFile(file) != FILE_EXTERNAL) return Join(Trim(target), L"Configuration.xml");
    return Join(Trim(target), FileStem(Trim(file)) + L".xml");
}

bool IsEpfPath(const std::wstring& path)
{
    return KindOfFile(path) != FILE_OTHER;
}

static std::wstring IbasesPath()
{
    return Join(KnownFolder(FOLDERID_RoamingAppData), L"1C\\1CEStart\\ibases.v8i");
}

bool IbaseNameExists(const std::wstring& name)
{
    for (const auto& b : LoadIbases())
        if (EqualsNoCase(b.name, Trim(name))) return true;
    return false;
}

bool AddFileIbase(const std::wstring& name, const std::wstring& dir, std::wstring* error)
{
    std::wstring path = IbasesPath();
    TextFile list = ReadTextFile(path.c_str(), 16 * 1024 * 1024);
    std::wstring text = list.ok ? list.text : std::wstring();
    TextEncoding encoding = list.ok ? list.encoding : ENC_UTF8_BOM;
    GUID g;
    CoCreateGuid(&g);
    wchar_t id[64];
    swprintf(id, 64, L"%08lx-%04x-%04x-%02x%02x-%02x%02x%02x%02x%02x%02x", g.Data1, g.Data2, g.Data3,
             g.Data4[0], g.Data4[1], g.Data4[2], g.Data4[3], g.Data4[4], g.Data4[5], g.Data4[6], g.Data4[7]);
    std::wstring quoted;
    for (wchar_t c : dir) { quoted += c; if (c == L'"') quoted += L'"'; }
    if (!text.empty() && text[text.size() - 1] != L'\n') text += L"\r\n";
    text += L"[" + Trim(name) + L"]\r\n"
            L"Connect=File=\"" + quoted + L"\";\r\n"
            L"ID=" + std::wstring(id) + L"\r\n"
            L"Folder=/\r\n"
            L"External=0\r\n"
            L"ClientConnectionSpeed=Normal\r\n"
            L"App=Auto\r\n"
            L"WA=1\r\n"
            L"Version=8.3\r\n";
    size_t slash = path.find_last_of(L"\\/");
    MakeDirs(path.substr(0, slash));
    if (WriteTextFile(path.c_str(), text, encoding)) return true;
    if (error) *error = L"Не удалось записать список баз: " + path;
    return false;
}

// --- Settings and cache -------------------------------------------------------

std::wstring AppDataDir()
{
    return Join(KnownFolder(FOLDERID_LocalAppData), L"BSLView\\epf");
}

std::wstring CacheRoot()
{
    return Join(AppDataDir(), L"cache");
}

Settings Settings::Load()
{
    Settings s;
    auto v = ReadKeyValues(Join(AppDataDir(), L"settings.ini"));
    std::wstring kind = ValueOr(v, L"Kind");
    s.kind = kind == L"Base" ? CTX_BASE : kind == L"Cf" ? CTX_CF : CTX_EMPTY;
    s.baseId = ValueOr(v, L"BaseId");
    s.cfPath = ValueOr(v, L"CfPath");
    s.platform = ValueOr(v, L"Platform");
    s.openAfter = ValueOr(v, L"OpenAfter") == L"1";
    s.cfgLoad = ValueOr(v, L"CfgLoad") == L"1";
    s.cfgUnpack = ValueOr(v, L"CfgUnpack") != L"0";
    s.cfgNewBase = ValueOr(v, L"CfgNewBase") == L"1";
    s.cfgExtUnsafe = ValueOr(v, L"CfgExtUnsafe") == L"1";
    s.gitAdd = ValueOr(v, L"GitAdd") == L"1";
    for (const auto& kv : v) {
        if (kv.first.compare(0, 5, L"User.") == 0) s.userByBase[kv.first.substr(5)] = kv.second;
        if (kv.first.compare(0, 5, L"Auth.") == 0 && !kv.second.empty()) s.passByBase[kv.first.substr(5)] = kv.second;
    }
    return s;
}

bool Settings::SavedPassword(const std::wstring& id, std::wstring& password) const
{
    auto it = passByBase.find(id);
    if (it == passByBase.end()) return false;
    DWORD size = 0;
    if (!CryptStringToBinaryW(it->second.c_str(), 0, CRYPT_STRING_BASE64, NULL, &size, NULL, NULL)) return false;
    std::vector<BYTE> blob(size);
    if (!CryptStringToBinaryW(it->second.c_str(), 0, CRYPT_STRING_BASE64, blob.data(), &size, NULL, NULL)) return false;
    DATA_BLOB in = { size, blob.data() }, out = {};
    if (!CryptUnprotectData(&in, NULL, NULL, NULL, NULL, CRYPTPROTECT_UI_FORBIDDEN, &out)) return false;
    password.assign((const wchar_t*)out.pbData, out.cbData / sizeof(wchar_t));
    SecureZeroMemory(out.pbData, out.cbData);
    LocalFree(out.pbData);
    return true;
}

void Settings::SaveAuth(const std::wstring& id, const std::wstring& user, const std::wstring& password)
{
    userByBase[id] = user;
    DATA_BLOB in = { (DWORD)(password.size() * sizeof(wchar_t)), (BYTE*)password.data() }, out = {};
    BYTE empty = 0;
    if (!in.cbData) in.pbData = &empty;
    if (!CryptProtectData(&in, L"BSLView epf", NULL, NULL, NULL, CRYPTPROTECT_UI_FORBIDDEN, &out)) return;
    DWORD chars = 0;
    std::wstring encoded;
    if (CryptBinaryToStringW(out.pbData, out.cbData, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, NULL, &chars)) {
        encoded.resize(chars);
        if (CryptBinaryToStringW(out.pbData, out.cbData, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, &encoded[0], &chars))
            encoded.resize(chars);
        else
            encoded.clear();
    }
    LocalFree(out.pbData);
    if (!encoded.empty()) passByBase[id] = encoded;
}

void Settings::Save() const
{
    std::vector<std::pair<std::wstring, std::wstring>> v = {
        { L"Kind", kind == CTX_BASE ? L"Base" : kind == CTX_CF ? L"Cf" : L"Empty" },
        { L"BaseId", baseId },
        { L"CfPath", cfPath },
        { L"Platform", platform },
        { L"OpenAfter", openAfter ? L"1" : L"0" },
        { L"CfgLoad", cfgLoad ? L"1" : L"0" },
        { L"CfgUnpack", cfgUnpack ? L"1" : L"0" },
        { L"CfgNewBase", cfgNewBase ? L"1" : L"0" },
        { L"CfgExtUnsafe", cfgExtUnsafe ? L"1" : L"0" },
        { L"GitAdd", gitAdd ? L"1" : L"0" },
    };
    for (const auto& kv : userByBase) v.push_back({ L"User." + kv.first, kv.second });
    for (const auto& kv : passByBase) v.push_back({ L"Auth." + kv.first, kv.second });
    if (MakeDirs(AppDataDir())) WriteKeyValues(Join(AppDataDir(), L"settings.ini"), v);
}

unsigned long long CacheSize()
{
    unsigned long long total = 0;
    std::error_code ec;
    fs::recursive_directory_iterator it(fs::path(CacheRoot()), fs::directory_options::skip_permission_denied, ec), end;
    for (; !ec && it != end; it.increment(ec)) {
        std::error_code sizeEc;
        if (it->is_regular_file(sizeEc)) {
            uintmax_t size = it->file_size(sizeEc);
            if (!sizeEc) total += size;
        }
    }
    return total;
}

bool ClearCache(std::wstring* error)
{
    if (!DirExists(CacheRoot())) return true;
    if (RemoveTree(CacheRoot())) return true;
    if (error) *error = L"Не удалось удалить кэш служебных баз (возможно, идёт распаковка): " + CacheRoot();
    return false;
}

std::wstring CacheKey(ContextKind kind, const std::wstring& cfPath, const std::wstring& version)
{
    if (kind == CTX_BASE) return std::wstring();
    if (kind == CTX_CF) return L"cf-" + CfFingerprint(cfPath, version);
    return L"empty-" + version;
}

std::wstring CacheBuilt(const std::wstring& key)
{
    if (key.empty()) return std::wstring();
    std::wstring dir = Join(CacheRoot(), key);
    if (!FileExists(Join(Join(dir, L"ib"), L"1Cv8.1CD"))) return std::wstring();
    auto meta = ReadKeyValues(Join(dir, kMetaFile));
    return DisplayStamp(ValueOr(meta, L"Built"));
}

// --- Job ------------------------------------------------------------------------

Job::Job() : mLog(NULL), mCanceled(false), mJobObject(NULL)
{
    mJobObject = CreateJobObjectW(NULL, NULL);
    if (mJobObject) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = {};
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(mJobObject, JobObjectExtendedLimitInformation, &info, sizeof(info));
    }
}

Job::~Job()
{
    if (mJobObject) CloseHandle(mJobObject);
}

void Job::Cancel()
{
    mCanceled = true;
    std::lock_guard<std::mutex> guard(mJobLock);
    if (mJobObject) TerminateJobObject(mJobObject, 1);
}

void Job::Log(const std::wstring& line)
{
    if (mLog && *mLog) (*mLog)(HumanizeMilliseconds(line));
}

Job::RunResult Job::RunProcess(const std::wstring& exe, const std::vector<std::wstring>& args,
                               const std::function<void(const std::wstring&)>* onLine)
{
    RunResult rr = { false, (DWORD)-1 };
    if (mCanceled) return rr;

    std::wstring cmd = QuoteArg(exe);
    for (const auto& a : args) cmd += L" " + QuoteArg(a);
    std::vector<wchar_t> cmdBuf(cmd.begin(), cmd.end());
    cmdBuf.push_back(0);

    SECURITY_ATTRIBUTES sa = { sizeof(sa), NULL, TRUE };
    HANDLE readPipe = NULL, writePipe = NULL;
    if (!CreatePipe(&readPipe, &writePipe, &sa, 0)) return rr;
    SetHandleInformation(readPipe, HANDLE_FLAG_INHERIT, 0);
    // ibcmd must never wait for an answer to a question.
    HANDLE nul = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING, 0, NULL);

    /* Only these two handles are inherited: another thread of the host starting
     * a process at the same time must not keep our pipe open. */
    HANDLE inherit[2] = { writePipe, nul };
    SIZE_T attrSize = 0;
    InitializeProcThreadAttributeList(NULL, 1, 0, &attrSize);
    std::vector<BYTE> attrBuf(attrSize);
    LPPROC_THREAD_ATTRIBUTE_LIST attrs = (LPPROC_THREAD_ATTRIBUTE_LIST)attrBuf.data();
    bool attrsOk = InitializeProcThreadAttributeList(attrs, 1, 0, &attrSize)
        && UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherit,
                                     nul != INVALID_HANDLE_VALUE ? sizeof(inherit) : sizeof(HANDLE), NULL, NULL);

    STARTUPINFOEXW si = {};
    si.StartupInfo.cb = sizeof(si);
    si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si.StartupInfo.hStdInput = nul != INVALID_HANDLE_VALUE ? nul : NULL;
    si.StartupInfo.hStdOutput = writePipe;
    si.StartupInfo.hStdError = writePipe;
    si.lpAttributeList = attrsOk ? attrs : NULL;
    PROCESS_INFORMATION pi = {};
    BOOL started = CreateProcessW(exe.c_str(), cmdBuf.data(), NULL, NULL, TRUE,
        CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | (attrsOk ? EXTENDED_STARTUPINFO_PRESENT : 0),
        NULL, NULL, &si.StartupInfo, &pi);
    if (attrsOk) DeleteProcThreadAttributeList(attrs);
    CloseHandle(writePipe);
    if (nul != INVALID_HANDLE_VALUE) CloseHandle(nul);
    if (!started) {
        CloseHandle(readPipe);
        Log(L"Не удалось запустить " + exe);
        return rr;
    }
    {
        std::lock_guard<std::mutex> guard(mJobLock);
        if (mJobObject) AssignProcessToJobObject(mJobObject, pi.hProcess);
        if (mCanceled) TerminateProcess(pi.hProcess, 1);
    }
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    rr.started = true;

    PipeReader reader = { readPipe, onLine };
    HANDLE thread = CreateThread(NULL, 0, ReaderProc, &reader, 0, NULL);
    WaitForSingleObject(pi.hProcess, INFINITE);
    /* A grandchild that inherited the pipe may keep it open after ibcmd is
     * gone; give the reader a moment and then stop it. */
    if (thread) {
        if (WaitForSingleObject(thread, 3000) == WAIT_TIMEOUT) {
            CancelSynchronousIo(thread);
            WaitForSingleObject(thread, INFINITE);
        }
        CloseHandle(thread);
    }
    CloseHandle(readPipe);
    GetExitCodeProcess(pi.hProcess, &rr.code);
    CloseHandle(pi.hProcess);
    return rr;
}

/* ibcmd with a data directory of its own: the default one is locked by any
 * other ibcmd on the machine ("Ошибка блокировки каталога данных сервера").
 * The directory is thrown away after the run: the standalone server
 * preallocates ~640 MB of session logs there, which are of no use later. */
Job::RunResult Job::Ibcmd(const std::vector<std::wstring>& args,
                          const std::function<void(const std::wstring&)>* onLine)
{
    GUID g;
    CoCreateGuid(&g);
    wchar_t name[64];
    swprintf(name, 64, L"srv-%08lx%04x%04x", g.Data1, g.Data2, g.Data3);
    std::wstring dataDir = Join(CacheRoot(), name);
    std::vector<std::wstring> all;
    for (size_t i = 0; i < args.size() && i < 2; i++) all.push_back(args[i]);
    all.push_back(L"--data=" + dataDir);
    for (size_t i = 2; i < args.size(); i++) all.push_back(args[i]);
    RunResult r = RunProcess(mReq.platform.ibcmd, all, onLine);
    TryRemove(dataDir);
    return r;
}

HANDLE Job::AcquireLock(const std::wstring& path)
{
    bool announced = false;
    for (;;) {
        HANDLE h = CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_ALWAYS,
                               FILE_FLAG_DELETE_ON_CLOSE, NULL);
        if (h != INVALID_HANDLE_VALUE) return h;
        DWORD err = GetLastError();
        if (err != ERROR_SHARING_VIOLATION && err != ERROR_ACCESS_DENIED && err != ERROR_LOCK_VIOLATION)
            return INVALID_HANDLE_VALUE;
        if (!announced) {
            Log(L"Служебная база занята другой распаковкой, ожидание...");
            announced = true;
        }
        for (int i = 0; i < 10; i++) {
            if (mCanceled) return INVALID_HANDLE_VALUE;
            Sleep(100);
        }
    }
}

bool Job::EnsureInfoBase(const std::wstring& cacheDir, std::wstring& ibDir, std::wstring& error)
{
    ibDir = Join(cacheDir, L"ib");
    TryRemove(Join(cacheDir, L"srv"));   // server data of an earlier build, kept by mistake
    std::wstring metaPath = Join(cacheDir, kMetaFile);
    auto meta = ReadKeyValues(metaPath);
    bool ready = FileExists(Join(ibDir, L"1Cv8.1CD")) && FileExists(metaPath);
    if (ready) {
        Log(L"Служебная база из кэша (" + ValueOr(meta, L"Source") + L", собрана "
            + DisplayStamp(ValueOr(meta, L"Built")) + L").");
    } else {
        std::wstring newIb = Join(cacheDir, L"ib.new");
        TryRemove(newIb);
        bool cf = mReq.kind == CTX_CF;
        Log(cf ? L"Создание служебной базы с конфигурацией " + std::wstring(PathFindFileNameW(mReq.cfPath.c_str()))
                 + L" (один раз, дальше из кэша)..."
               : L"Создание служебной пустой базы (один раз, дальше из кэша)...");
        std::function<void(const std::wstring&)> echo = [this](const std::wstring& l) { Log(l); };
        RunResult r = Ibcmd({ L"infobase", L"create", L"--db-path=" + newIb }, &echo);
        if (mCanceled) { TryRemove(newIb); return false; }
        if (r.code != 0 || !FileExists(Join(newIb, L"1Cv8.1CD"))) {
            TryRemove(newIb);
            error = L"Не удалось создать служебную базу (код " + std::to_wstring((long)r.code) + L").";
            return false;
        }
        if (cf) {
            Log(L"Загрузка конфигурации в служебную базу (для больших конфигураций — около минуты)...");
            r = Ibcmd({ L"config", L"load", L"--db-path=" + newIb, L"--force", mReq.cfPath }, &echo);
            if (mCanceled || r.code != 0) {
                TryRemove(newIb);
                if (!mCanceled) error = L"Не удалось загрузить конфигурацию (код " + std::to_wstring((long)r.code) + L").";
                return false;
            }
        }
        TryRemove(ibDir);
        if (!MoveFileW(newIb.c_str(), ibDir.c_str())) {
            TryRemove(newIb);
            error = L"Не удалось сохранить служебную базу в кэше: " + ibDir;
            return false;
        }
        meta.clear();
        meta[L"Source"] = cf ? L"CF " + std::wstring(PathFindFileNameW(mReq.cfPath.c_str())) : L"пустая база";
        meta[L"Built"] = NowStamp();
    }
    WriteKeyValues(metaPath, {
        { L"Source", ValueOr(meta, L"Source") },
        { L"Built", ValueOr(meta, L"Built") },
        { L"LastUsed", NowStamp() },
    });
    if (mReq.kind == CTX_CF) EvictOldCaches(cacheDir);
    return true;
}

void Job::EvictOldCaches(const std::wstring& keep)
{
    std::vector<CacheEntry> entries;
    WIN32_FIND_DATAW fd = {};
    HANDLE find = FindFirstFileW(Join(CacheRoot(), L"cf-*").c_str(), &fd);
    if (find == INVALID_HANDLE_VALUE) return;
    do {
        if (!(fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
        std::wstring dir = Join(CacheRoot(), fd.cFileName);
        if (EqualsNoCase(dir, keep)) continue;
        entries.push_back(CacheEntry{ dir, ValueOr(ReadKeyValues(Join(dir, kMetaFile)), L"LastUsed") });
    } while (FindNextFileW(find, &fd));
    FindClose(find);
    // The stamps sort as text; the newest stay, alongside the one in use.
    std::sort(entries.begin(), entries.end(), [](const CacheEntry& a, const CacheEntry& b) {
        return a.lastUsed > b.lastUsed;
    });
    for (size_t i = kMaxConfigCaches - 1; i < entries.size(); i++) {
        // A cache another unpacking holds is left alone.
        HANDLE h = CreateFileW(Join(entries[i].dir, L".lock").c_str(), GENERIC_READ | GENERIC_WRITE, 0, NULL,
                               OPEN_ALWAYS, FILE_FLAG_DELETE_ON_CLOSE, NULL);
        if (h == INVALID_HANDLE_VALUE) continue;
        CloseHandle(h);
        if (RemoveTree(entries[i].dir))
            Log(L"Удалён старый кэш: " + std::wstring(PathFindFileNameW(entries[i].dir.c_str())));
    }
}

bool Job::UnpackWithBase(const std::wstring& outDir, const std::wstring& rootXml, std::wstring& error)
{
    std::wstring dbPath = FileBasePath(mReq.base.connect);
    if (dbPath.empty()) return DesignerDump(rootXml, error);

    std::vector<std::wstring> args = { L"config", L"export", L"--db-path=" + dbPath };
    if (!mReq.user.empty()) args.push_back(L"--user=" + mReq.user);
    if (!mReq.password.empty()) args.push_back(L"--password=" + mReq.password);
    args.push_back(L"--file=" + mReq.file);
    args.push_back(outDir);

    bool lockError = false;
    bool report = _wcsicmp(PathFindExtensionW(mReq.file.c_str()), L".erf") == 0;
    std::function<void(const std::wstring&)> onLine = [&](const std::wstring& l) {
        if (l.find(L"исключительной блокировки") != std::wstring::npos) lockError = true;
        Log(RewriteExportLine(l, report));
    };
    RunResult r = Ibcmd(args, &onLine);
    if (mCanceled) return false;
    if (lockError) {
        error = L"База «" + mReq.base.name + L"» открыта в конфигураторе — закройте конфигуратор и повторите.";
        return false;
    }
    if (r.code != 0 || !FileExists(rootXml)) {
        error = L"ibcmd завершился с кодом " + std::to_wstring((long)r.code) + L", файл "
            + PathFindFileNameW(rootXml.c_str()) + L" не создан.";
        return false;
    }
    return true;
}

// Server infobases: ibcmd connects to a DBMS directly only, so the Designer does it.
bool Job::DesignerDump(const std::wstring& rootXml, std::wstring& error)
{
    Log(L"Серверная база — распаковка конфигуратором...");
    if (!RunDesigner({ L"/DumpExternalDataProcessorOrReportToFiles", rootXml, mReq.file },
                     L"Конфигуратор не распаковал файл", error))
        return false;
    if (!FileExists(rootXml)) {
        error = L"Конфигуратор не распаковал файл: " + rootXml + L" не создан.";
        return false;
    }
    return true;
}

/* One batch action of the Designer against mReq.base, with its log and result
 * code read back: it sometimes exits with 0 having done nothing. */
bool Job::RunDesigner(const std::vector<std::wstring>& action, const std::wstring& failText, std::wstring& error)
{
    std::vector<std::wstring> connect = DesignerConnectArgs(mReq.base.connect);
    if (connect.empty()) {
        error = L"Тип подключения базы «" + mReq.base.name + L"» не поддерживается: " + mReq.base.connect;
        return false;
    }
    std::wstring bin = mReq.platform.ibcmd;
    size_t slash = bin.find_last_of(L"\\/");
    std::wstring designer = Join(slash == std::wstring::npos ? std::wstring() : bin.substr(0, slash), L"1cv8.exe");
    if (!FileExists(designer)) {
        error = L"Не найден 1cv8.exe рядом с ibcmd.exe: " + designer;
        return false;
    }

    wchar_t temp[MAX_PATH] = {};
    GetTempPathW(MAX_PATH, temp);
    GUID g;
    CoCreateGuid(&g);
    wchar_t name[64];
    swprintf(name, 64, L"BSLView-epf-%08lx%04x%04x.log", g.Data1, g.Data2, g.Data3);
    std::wstring logFile = Join(temp, name);
    std::wstring resFile = logFile + L".result";

    std::vector<std::wstring> args = { L"DESIGNER" };
    args.insert(args.end(), connect.begin(), connect.end());
    if (!mReq.user.empty()) {
        args.push_back(L"/N");
        args.push_back(mReq.user);
        if (!mReq.password.empty()) {
            args.push_back(L"/P");
            args.push_back(mReq.password);
        }
    }
    args.push_back(L"/DisableStartupDialogs");
    args.push_back(L"/DisableStartupMessages");
    args.insert(args.end(), action.begin(), action.end());
    std::vector<std::wstring> tail = { L"/Out", logFile, L"/DumpResult", resFile };
    args.insert(args.end(), tail.begin(), tail.end());

    RunResult r = RunProcess(designer, args, NULL);
    TextFile out = ReadTextFile(logFile.c_str(), 16 * 1024 * 1024);
    TextFile res = ReadTextFile(resFile.c_str(), 1024);
    TryRemove(logFile);
    TryRemove(resFile);
    if (mCanceled) return false;
    std::wstring designerLog = out.ok ? Trim(out.text) : std::wstring();
    if (!designerLog.empty()) Log(designerLog);
    if (r.code != 0 || !res.ok || Trim(res.text) != L"0") {
        error = failText + (designerLog.empty()
            ? L" (код " + std::to_wstring((long)r.code) + L")." : L": " + designerLog);
        return false;
    }
    return true;
}

/* Extension properties the Designer shows as «Безопасный режим» and «Защита
 * от опасных действий». */
bool Job::UnsafeExtension(const std::wstring& dbPath, const std::vector<std::wstring>& auth,
                          const std::wstring& name, std::wstring& error)
{
    std::vector<std::wstring> args = { L"extension", L"update", L"--db-path=" + dbPath };
    args.insert(args.end(), auth.begin(), auth.end());
    args.push_back(L"--name=" + name);
    args.push_back(L"--safe-mode=no");
    args.push_back(L"--unsafe-action-protection=no");
    if (!IbcmdStep(args, L"Не удалось отключить безопасный режим расширения", error)) return false;
    Log(L"Безопасный режим и защита от опасных действий расширения отключены.");
    return true;
}

bool Job::IbcmdStep(const std::vector<std::wstring>& args, const std::wstring& failText, std::wstring& error)
{
    bool extension = KindOfFile(mReq.file) == FILE_CFE;
    bool lockError = false;
    std::function<void(const std::wstring&)> onLine = [&](const std::wstring& l) {
        if (l.find(L"исключительной блокировки") != std::wstring::npos) lockError = true;
        std::wstring line = l;
        const wchar_t* done = L"Экспорт конфигурации в XML успешно завершен";
        size_t at = line.find(done);
        if (at != std::wstring::npos) line.replace(at, wcslen(done), L"Выгрузка конфигурации в XML успешно завершена");
        if (extension) {
            /* ibcmd calls an extension a configuration too. */
            const wchar_t* from[] = { L"Загрузка конфигурации", L"Выгрузка конфигурации", L"Обновление конфигурации" };
            const wchar_t* to[] = { L"Загрузка расширения", L"Выгрузка расширения", L"Обновление расширения" };
            for (int i = 0; i < 3; i++) {
                size_t at = line.find(from[i]);
                if (at != std::wstring::npos) line.replace(at, wcslen(from[i]), to[i]);
            }
        }
        Log(line);
    };
    RunResult r = Ibcmd(args, &onLine);
    if (mCanceled) return false;
    if (lockError) {
        error = L"База занята (открыта в конфигураторе или в режиме предприятия) — закройте её и повторите.";
        return false;
    }
    if (r.code != 0) {
        error = failText + L" (ibcmd, код " + std::to_wstring((long)r.code) + L").";
        return false;
    }
    return true;
}

/* A scratch copy of the cached empty service infobase: unpacking a file that
 * goes into no infobase of the user's must not leave it in the cache. */
bool Job::ScratchBase(std::wstring& dir, std::wstring& error)
{
    std::wstring cacheDir = Join(CacheRoot(), CacheKey(CTX_EMPTY, std::wstring(), mReq.platform.version));
    if (!MakeDirs(cacheDir)) {
        error = L"Не удалось создать каталог кэша " + cacheDir;
        return false;
    }
    HANDLE lock = AcquireLock(Join(cacheDir, L".lock"));
    if (lock == INVALID_HANDLE_VALUE) {
        if (!mCanceled) error = L"Не удалось занять служебную базу " + cacheDir;
        return false;
    }
    ContextKind kind = mReq.kind;
    mReq.kind = CTX_EMPTY;
    std::wstring ibDir;
    bool ok = EnsureInfoBase(cacheDir, ibDir, error);
    mReq.kind = kind;
    if (ok) {
        GUID g;
        CoCreateGuid(&g);
        wchar_t name[64];
        swprintf(name, 64, L"tmp-%08lx%04x%04x", g.Data1, g.Data2, g.Data3);
        dir = Join(CacheRoot(), name);
        ok = MakeDirs(dir) && CopyFileW(Join(ibDir, L"1Cv8.1CD").c_str(), Join(dir, L"1Cv8.1CD").c_str(), FALSE);
        if (!ok) {
            TryRemove(dir);
            error = L"Не удалось подготовить временную базу в " + CacheRoot();
        }
    }
    CloseHandle(lock);
    return ok && !mCanceled;
}

/* The name an extension goes into an infobase under must be its own: ibcmd
 * takes whatever --extension says. The .cfe is loaded into a scratch base
 * under a stand-in name and only its Configuration.xml exported. */
bool Job::ExtensionName(std::wstring& name, std::wstring& error)
{
    std::wstring scratch;
    if (!ScratchBase(scratch, error)) return false;
    std::wstring out = scratch + L"-xml";
    Log(L"Определение имени расширения...");
    bool ok = IbcmdStep({ L"config", L"load", L"--db-path=" + scratch, L"--extension=BSLViewProbe",
                          L"--force", mReq.file }, L"Не удалось прочитать расширение", error)
        && IbcmdStep({ L"config", L"export", L"objects", L"--db-path=" + scratch,
                       L"--extension=BSLViewProbe", L"--out=" + out, L"Configuration" },
                     L"Не удалось прочитать расширение", error);
    if (ok) {
        TextFile xml = ReadTextFile(Join(out, L"Configuration.xml").c_str(), 16 * 1024 * 1024);
        size_t at = xml.ok ? xml.text.find(L"<Name>") : std::wstring::npos;
        size_t end = at == std::wstring::npos ? at : xml.text.find(L"</Name>", at);
        if (end != std::wstring::npos) name = Trim(xml.text.substr(at + 6, end - at - 6));
        if (name.empty()) {
            error = L"Не удалось определить имя расширения.";
            ok = false;
        }
    }
    TryRemove(out);
    TryRemove(scratch);
    return ok && !mCanceled;
}

/* A configuration, an extension or an infobase dump: loaded into an infobase
 * (one of the list or a new file one) and/or unpacked to XML. Unpacking alone
 * goes through a scratch infobase. */
bool Job::RunConfig(std::wstring& error)
{
    FileKind fk = KindOfFile(mReq.file);
    std::wstring fileName = PathFindFileNameW(mReq.file.c_str());
    std::wstring rootXml = Join(mReq.target, L"Configuration.xml");
    Log(L"Платформа " + mReq.platform.version);
    if (!mReq.load && !mReq.unpack) {
        error = L"Выберите действие: загрузить в базу и/или распаковать.";
        return false;
    }

    std::wstring extName;
    if (fk == FILE_CFE && mReq.load) {
        if (!ExtensionName(extName, error)) return false;
        Log(L"Расширение «" + extName + L"».");
    }

    std::wstring dbPath;        // file infobase ibcmd works with; empty for a server one
    std::wstring scratch;       // a scratch infobase to remove at the end
    bool useAuth = false;
    bool server = false;
    bool ok = true;

    auto cleanup = [&]() { if (!scratch.empty()) TryRemove(scratch); };

    if (mReq.load && mReq.newBase) {
        dbPath = mReq.newDir;
        if (FileExists(Join(dbPath, L"1Cv8.1CD"))) {
            error = L"В каталоге уже есть информационная база: " + dbPath;
            return false;
        }
        if (!MakeDirs(dbPath)) {
            error = L"Не удалось создать каталог " + dbPath;
            return false;
        }
        Log(L"Создание файловой базы «" + mReq.newName + L"» в " + dbPath
            + (fk == FILE_DT ? L" с загрузкой " + fileName : fk == FILE_CF ? L" с конфигурацией " + fileName : L"")
            + L"...");
        std::vector<std::wstring> args = { L"infobase", L"create", L"--db-path=" + dbPath };
        if (fk == FILE_DT) args.push_back(L"--restore=" + mReq.file);
        if (fk == FILE_CF) { args.push_back(L"--load=" + mReq.file); args.push_back(L"--apply"); }
        args.push_back(L"--force");
        ok = IbcmdStep(args, L"Не удалось создать базу", error);
        if (ok && !FileExists(Join(dbPath, L"1Cv8.1CD"))) {
            error = L"База не создана: " + dbPath;
            ok = false;
        }
        if (ok && fk == FILE_CFE) {
            ok = IbcmdStep({ L"config", L"load", L"--db-path=" + dbPath, L"--extension=" + extName, L"--force", mReq.file },
                           L"Не удалось загрузить расширение", error)
              && IbcmdStep({ L"config", L"apply", L"--db-path=" + dbPath, L"--extension=" + extName, L"--force" },
                           L"Не удалось обновить расширение", error);
            if (ok && mReq.extUnsafe) ok = UnsafeExtension(dbPath, {}, extName, error);
        }
        if (!ok) return false;
        if (!AddFileIbase(mReq.newName, dbPath, &error)) return false;
        Log(L"База «" + mReq.newName + L"» добавлена в список баз.");
    } else if (mReq.load) {
        dbPath = FileBasePath(mReq.base.connect);
        server = dbPath.empty();
        useAuth = true;
        std::wstring on = L" (база «" + mReq.base.name + L"»)";
        if (server) {
            Log(L"Серверная база — загрузка конфигуратором" + on + L"...");
            if (fk == FILE_DT) ok = RunDesigner({ L"/RestoreIB", mReq.file }, L"Не удалось загрузить информационную базу", error);
            else if (fk == FILE_CF) ok = RunDesigner({ L"/LoadCfg", mReq.file, L"/UpdateDBCfg" }, L"Не удалось загрузить конфигурацию", error);
            else ok = RunDesigner({ L"/LoadCfg", mReq.file, L"-Extension", extName, L"/UpdateDBCfg", L"-Extension", extName },
                                  L"Не удалось загрузить расширение", error);
        } else {
            std::vector<std::wstring> auth;
            if (!mReq.user.empty()) auth.push_back(L"--user=" + mReq.user);
            if (!mReq.password.empty()) auth.push_back(L"--password=" + mReq.password);
            auto with = [&](std::vector<std::wstring> a) { a.insert(a.begin() + 3, auth.begin(), auth.end()); return a; };
            if (fk == FILE_DT) {
                Log(L"Загрузка " + fileName + on + L"...");
                ok = IbcmdStep(with({ L"infobase", L"restore", L"--db-path=" + dbPath, mReq.file }),
                               L"Не удалось загрузить информационную базу", error);
            } else if (fk == FILE_CF) {
                ok = IbcmdStep(with({ L"config", L"load", L"--db-path=" + dbPath, L"--force", mReq.file }),
                               L"Не удалось загрузить конфигурацию", error)
                  && IbcmdStep(with({ L"config", L"apply", L"--db-path=" + dbPath, L"--force" }),
                               L"Не удалось обновить конфигурацию базы данных", error);
            } else {
                ok = IbcmdStep(with({ L"config", L"load", L"--db-path=" + dbPath, L"--extension=" + extName, L"--force", mReq.file }),
                               L"Не удалось загрузить расширение", error)
                  && IbcmdStep(with({ L"config", L"apply", L"--db-path=" + dbPath, L"--extension=" + extName, L"--force" }),
                               L"Не удалось обновить расширение", error);
                if (ok && mReq.extUnsafe) ok = UnsafeExtension(dbPath, auth, extName, error);
            }
        }
        if (!ok) return false;
        Log(L"Загружено" + on + L".");
    } else {
        /* Unpacking alone: into a scratch infobase and out again. */
        if (!ScratchBase(scratch, error)) return false;
        dbPath = scratch;
        extName = L"BSLViewProbe";
        Log(L"Загрузка " + fileName + L" во временную базу...");
        if (fk == FILE_DT) ok = IbcmdStep({ L"infobase", L"restore", L"--db-path=" + dbPath, L"--force", mReq.file },
                                          L"Не удалось загрузить информационную базу", error);
        else if (fk == FILE_CF) ok = IbcmdStep({ L"config", L"load", L"--db-path=" + dbPath, L"--force", mReq.file },
                                               L"Не удалось загрузить конфигурацию", error);
        else ok = IbcmdStep({ L"config", L"load", L"--db-path=" + dbPath, L"--extension=" + extName, L"--force", mReq.file },
                            L"Не удалось загрузить расширение", error);
        if (!ok) { cleanup(); return false; }
    }

    if (mReq.unpack) {
        /* A previous export is replaced; a folder holding anything else is not touched. */
        if (FileExists(rootXml)) {
            if (!RemoveTree(mReq.target)) {
                error = L"Не удалось удалить прежнюю распаковку: " + mReq.target;
                cleanup();
                return false;
            }
        } else if (DirExists(mReq.target) && !PathIsDirectoryEmptyW(mReq.target.c_str())) {
            error = L"Каталог распаковки не пуст: " + mReq.target + L". Выберите пустой каталог.";
            cleanup();
            return false;
        }
        if (!MakeDirs(mReq.target)) {
            error = L"Не удалось создать каталог " + mReq.target;
            cleanup();
            return false;
        }
        Log(L"Распаковка " + std::wstring(fk == FILE_CFE ? L"расширения" : L"конфигурации") + L" → " + mReq.target);
        if (server) {
            std::vector<std::wstring> action = { L"/DumpConfigToFiles", mReq.target };
            if (fk == FILE_CFE) { action.push_back(L"-Extension"); action.push_back(extName); }
            ok = RunDesigner(action, L"Конфигуратор не распаковал конфигурацию", error);
        } else {
            std::vector<std::wstring> args = { L"config", L"export", L"--db-path=" + dbPath };
            if (useAuth && !mReq.user.empty()) args.push_back(L"--user=" + mReq.user);
            if (useAuth && !mReq.password.empty()) args.push_back(L"--password=" + mReq.password);
            if (fk == FILE_CFE) args.push_back(L"--extension=" + extName);
            args.push_back(mReq.target);
            ok = IbcmdStep(args, L"Не удалось распаковать", error);
        }
        if (ok && !FileExists(rootXml)) {
            error = L"Распаковка не создала " + rootXml;
            ok = false;
        }
    }
    cleanup();
    if (!ok || mCanceled) return false;
    Log(L"Готово.");
    return true;
}

bool Job::Run(const UnpackRequest& req, const std::function<void(const std::wstring&)>& log,
              std::wstring& error)
{
    mReq = req;
    mLog = &log;
    auto addPathsToGit = [&](const std::vector<std::wstring>& files) {
        if (!req.gitAdd) return true;
        if (mCanceled) return false;
        std::wstring initRoot = req.target;
        std::wstring srcRoot, typedRoot;
        std::wstring extension = PathFindExtensionW(req.file.c_str());
        if (!extension.empty() && extension[0] == L'.') extension.erase(0, 1);
        std::wstring dir = req.target;
        for (;;) {
            std::wstring leaf = PathFindFileNameW(dir.c_str());
            if (typedRoot.empty() && _wcsicmp(leaf.c_str(), extension.c_str()) == 0) typedRoot = dir;
            if (_wcsicmp(leaf.c_str(), L"src") == 0) { srcRoot = dir; break; }
            size_t slash = dir.find_last_of(L"\\/");
            if (slash == std::wstring::npos || slash == 0) break;
            dir.erase(slash);
        }
        if (!srcRoot.empty()) initRoot = typedRoot.empty() ? srcRoot : typedRoot;

        Log(L"Добавление распакованных файлов в Git...");
        std::wstring repo;
        if (!git::AddFiles(req.target, initRoot, files, &repo, &error)) {
            error = L"Распаковка выполнена, но добавить файлы в Git не удалось: " + error;
            Log(L"ОШИБКА Git: " + error);
            return false;
        }
        Log(L"Git: файлы добавлены в индекс репозитория " + repo);
        return true;
    };

    if (KindOfFile(req.file) != FILE_EXTERNAL) {
        bool ok = RunConfig(error);
        if (!ok || !req.gitAdd || !req.unpack) return ok;
        return addPathsToGit({ req.target });
    }
    std::wstring name = FileStem(req.file);
    std::wstring outDir = Join(req.target, name);
    std::wstring rootXml = outDir + L".xml";
    bool report = _wcsicmp(PathFindExtensionW(req.file.c_str()), L".erf") == 0;

    auto prepareTarget = [&]() {
        DeleteFileW(rootXml.c_str());
        if ((DirExists(outDir) && !RemoveTree(outDir)) || FileExists(rootXml)) {
            error = L"Не удалось удалить прежнюю распаковку: " + outDir;
            return false;
        }
        if (!MakeDirs(req.target)) {
            error = L"Не удалось создать каталог " + req.target;
            return false;
        }
        return true;
    };

    Log(L"Платформа " + req.platform.version);
    if (req.kind == CTX_BASE) {
        // The user's infobase is used as it is: dumping an external file does not change it.
        if (!prepareTarget()) return false;
        Log(L"Распаковка " + std::wstring(PathFindFileNameW(req.file.c_str())) + L" → " + req.target
            + L" (база «" + req.base.name + L"»)");
        if (!UnpackWithBase(outDir, rootXml, error)) return false;
        if (!addPathsToGit({ outDir, rootXml })) return false;
        Log(L"Готово.");
        return true;
    }

    std::wstring cacheDir = Join(CacheRoot(), CacheKey(req.kind, req.cfPath, req.platform.version));
    if (!MakeDirs(cacheDir)) {
        error = L"Не удалось создать каталог кэша " + cacheDir;
        return false;
    }
    // One service infobase cannot serve several ibcmd at once.
    HANDLE lock = AcquireLock(Join(cacheDir, L".lock"));
    if (lock == INVALID_HANDLE_VALUE) {
        if (!mCanceled) error = L"Не удалось занять служебную базу " + cacheDir;
        return false;
    }
    std::wstring ibDir;
    bool ok = EnsureInfoBase(cacheDir, ibDir, error) && prepareTarget();
    if (ok) {
        Log(L"Распаковка " + std::wstring(PathFindFileNameW(req.file.c_str())) + L" → " + req.target);
        std::function<void(const std::wstring&)> onLine = [&](const std::wstring& l) {
            Log(RewriteExportLine(l, report));
        };
        RunResult r = Ibcmd({ L"config", L"export", L"--db-path=" + ibDir,
                                                      L"--file=" + req.file, outDir }, &onLine);
        if (!mCanceled && (r.code != 0 || !FileExists(rootXml))) {
            error = L"ibcmd завершился с кодом " + std::to_wstring((long)r.code) + L", файл "
                + PathFindFileNameW(rootXml.c_str()) + L" не создан.";
            ok = false;
        }
    }
    CloseHandle(lock);
    if (mCanceled) return false;
    if (ok && !addPathsToGit({ outDir, rootXml })) return false;
    if (ok) Log(L"Готово.");
    return ok;
}

// --- The reverse direction: XML back into a file or an infobase --------------

namespace {

/* The first element inside <MetaDataObject> names what a dump holds. Only the
 * head of the file is read: a configuration's Configuration.xml is large and
 * the root element is always at its start. */
/* The first `bytes` of a file as text. A configuration's Configuration.xml
 * runs into megabytes and ReadTextFile refuses a file over its limit, while
 * everything read here — the root element, the name of an extension — sits at
 * the very start of it. The dump is written in UTF-8 by the platform. */
std::wstring FileHead(const std::wstring& path, DWORD bytes)
{
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                              NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return std::wstring();
    std::string raw(bytes, '\0');
    DWORD got = 0;
    BOOL ok = ReadFile(file, &raw[0], bytes, &got, NULL);
    CloseHandle(file);
    if (!ok || !got) return std::wstring();
    raw.resize(got);
    if (raw.size() >= 3 && (unsigned char)raw[0] == 0xEF && (unsigned char)raw[1] == 0xBB
            && (unsigned char)raw[2] == 0xBF)
        raw.erase(0, 3);
    /* The tail of the buffer may cut a character in half; MB_ERR_INVALID_CHARS
     * would then reject the whole block, so the loss is left to the decoder. */
    int chars = MultiByteToWideChar(CP_UTF8, 0, raw.data(), (int)raw.size(), NULL, 0);
    std::wstring text(chars > 0 ? chars : 0, L'\0');
    if (chars > 0) MultiByteToWideChar(CP_UTF8, 0, raw.data(), (int)raw.size(), &text[0], chars);
    return text;
}

std::wstring DumpRootElement(const std::wstring& xmlPath)
{
    std::wstring text = FileHead(xmlPath, 64 * 1024);
    if (text.empty()) return std::wstring();
    size_t at = text.find(L"<MetaDataObject");
    if (at == std::wstring::npos) return std::wstring();
    at = text.find(L'>', at);
    if (at == std::wstring::npos) return std::wstring();
    while (++at < text.size() && iswspace(text[at])) {}
    if (at >= text.size() || text[at] != L'<') return std::wstring();
    size_t start = ++at;
    while (at < text.size() && (iswalpha(text[at]) || text[at] == L'.')) at++;
    return text.substr(start, at - start);
}

/* <Name> of the first properties block: the name of the extension a dump of
 * one belongs to. An extension's Configuration.xml carries <NamePrefix>,
 * which the configuration's own never does. */
bool ExtensionOfDump(const std::wstring& configXml, std::wstring& name)
{
    std::wstring text = FileHead(configXml, 64 * 1024);
    if (text.find(L"<NamePrefix>") == std::wstring::npos) return false;
    size_t at = text.find(L"<Name>");
    size_t end = at == std::wstring::npos ? at : text.find(L"</Name>", at);
    if (end == std::wstring::npos) return false;
    name = Trim(text.substr(at + 6, end - at - 6));
    return !name.empty();
}

} // namespace

DumpKind KindOfDump(const std::wstring& path, std::wstring* rootXml,
                    std::wstring* dumpDir, std::wstring* extension, bool* report)
{
    if (rootXml) rootXml->clear();
    if (dumpDir) dumpDir->clear();
    if (extension) extension->clear();
    if (report) *report = false;
    if (path.empty()) return DUMP_NONE;

    /* A folder is either a configuration dump (Configuration.xml inside) or
     * the folder an external object was unpacked into (<name>.xml beside it). */
    std::wstring xml = path;
    if (DirExists(path)) {
        std::wstring config = Join(path, L"Configuration.xml");
        if (FileExists(config)) {
            xml = config;
        } else {
            /* An external object's folder holds one XML and the folder of the
             * same name beside it. The folder itself may be called anything,
             * so the single XML in it is what names the object. */
            std::wstring beside = Join(path, FileStem(path) + L".xml");
            if (FileExists(beside)) {
                xml = beside;
            } else {
                std::wstring found;
                WIN32_FIND_DATAW data = {};
                HANDLE find = FindFirstFileW(Join(path, L"*.xml").c_str(), &data);
                int count = 0;
                if (find != INVALID_HANDLE_VALUE) {
                    do {
                        if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
                        if (++count > 1) break;
                        found = Join(path, data.cFileName);
                    } while (FindNextFileW(find, &data));
                    FindClose(find);
                }
                if (count != 1) return DUMP_NONE;
                xml = found;
            }
        }
    }
    if (!FileExists(xml)) return DUMP_NONE;

    std::wstring root = DumpRootElement(xml);
    size_t slash = xml.find_last_of(L"\\/");
    std::wstring dir = slash == std::wstring::npos ? std::wstring() : xml.substr(0, slash);
    if (root == L"ExternalDataProcessor" || root == L"ExternalReport") {
        if (rootXml) *rootXml = xml;
        if (dumpDir) *dumpDir = dir;
        if (report) *report = root == L"ExternalReport";
        return DUMP_EXTERNAL;
    }
    if (root == L"Configuration") {
        if (rootXml) *rootXml = xml;
        if (dumpDir) *dumpDir = dir;
        std::wstring name;
        if (extension && ExtensionOfDump(xml, name)) *extension = name;
        return DUMP_CONFIG;
    }
    return DUMP_NONE;
}

std::wstring ObjectFileOf(const std::wstring& relative)
{
    std::wstring path = relative;
    for (size_t i = 0; i < path.size(); i++) if (path[i] == L'/') path[i] = L'\\';
    /* Everything below <class>\<object>\... belongs to <class>\<object>.xml:
     * forms, templates, commands and modules are loaded with their object. */
    size_t first = path.find(L'\\');
    if (first == std::wstring::npos) return path;
    size_t second = path.find(L'\\', first + 1);
    if (second == std::wstring::npos) return path;
    return path.substr(0, second) + L".xml";
}

/* 1C reports how long an operation took in milliseconds ("Суммарное время
 * выполнения операции: 24210 миллисекунд."), which nobody reads as a duration.
 * Every such number in a line of its output is rewritten as seconds, and as
 * minutes and seconds once it passes a minute. */
std::wstring HumanDuration(long long ms)
{
    if (ms < 1000) return std::to_wstring(ms) + L" мс";
    long long tenths = (ms + 50) / 100;          // seconds, one decimal place
    if (tenths < 600) {
        std::wstring s = std::to_wstring(tenths / 10);
        long long frac = tenths % 10;
        if (frac) s += L"," + std::to_wstring(frac);
        return s + L" с";
    }
    long long seconds = (ms + 500) / 1000;
    if (seconds < 3600) {
        std::wstring s = std::to_wstring(seconds / 60) + L" мин";
        if (seconds % 60) s += L" " + std::to_wstring(seconds % 60) + L" с";
        return s;
    }
    std::wstring s = std::to_wstring(seconds / 3600) + L" ч";
    long long rest = seconds % 3600;
    if (rest / 60) s += L" " + std::to_wstring(rest / 60) + L" мин";
    if (rest % 60) s += L" " + std::to_wstring(rest % 60) + L" с";
    return s;
}

std::wstring HumanizeMilliseconds(const std::wstring& line)
{
    static const wchar_t* kWords[] = { L"миллисекунд", L"миллисекунды", L"миллисекунда", L"мс" };
    std::wstring out;
    size_t i = 0;
    while (i < line.size()) {
        if (!iswdigit(line[i])) { out += line[i++]; continue; }
        size_t start = i;
        while (i < line.size() && iswdigit(line[i])) i++;
        size_t after = i;
        while (after < line.size() && line[after] == L' ') after++;
        size_t word = 0;
        for (; word < sizeof(kWords) / sizeof(kWords[0]); word++)
            if (line.compare(after, wcslen(kWords[word]), kWords[word]) == 0) break;
        bool matched = word < sizeof(kWords) / sizeof(kWords[0]) && after > i;
        /* «миллисекунд» must end the word: «миллисекундах» is not this. */
        size_t end = matched ? after + wcslen(kWords[word]) : 0;
        if (matched && end < line.size() && (iswalpha(line[end]) || line[end] == L'-')) matched = false;
        if (!matched) { out += line.substr(start, i - start); continue; }
        long long ms = 0;
        bool overflow = i - start > 15;
        if (!overflow) ms = _wtoi64(line.substr(start, i - start).c_str());
        if (overflow) { out += line.substr(start, end - start); i = end; continue; }
        out += HumanDuration(ms);
        i = end;
    }
    return out;
}

std::wstring OutSuffix(DumpKind kind, bool report, bool extension)
{
    if (kind == DUMP_CONFIG) return extension ? L".cfe" : L".cf";
    return report ? L".erf" : L".epf";
}

/* A dump fills a folder of its own — an external object its <name> folder
 * beside its root XML, a configuration the whole folder — and the file it was
 * built from lies beside that folder, not inside it. So the assembled file is
 * offered one level above the folder the root XML sits in. */
std::wstring DefaultOutFile(const std::wstring& rootXml, DumpKind kind, const std::wstring& suffix)
{
    if (rootXml.empty() || kind == DUMP_NONE) return std::wstring();
    size_t slash = rootXml.find_last_of(L"\\/");
    std::wstring dir = slash == std::wstring::npos ? std::wstring() : rootXml.substr(0, slash);
    size_t up = dir.find_last_of(L"\\/");
    std::wstring parent = up == std::wstring::npos ? std::wstring() : dir.substr(0, up);
    /* An external object is named by its own XML, a configuration by the
     * folder it was exported into. */
    std::wstring name = kind == DUMP_EXTERNAL ? FileStem(rootXml)
                                              : std::wstring(PathFindFileNameW(dir.c_str()));
    if (name.empty()) name = L"Конфигурация";
    /* No level above (a dump right at the root of a drive): keep it beside
     * the root XML rather than climbing out of the path. */
    std::wstring outDir = parent.empty() ? dir : parent;
    /* An external object exported under a «src» folder — directly, in its own
     * folder or in a kind bucket (src\erf\<name>), as DefaultTarget unpacks
     * it — belongs to a project that usually keeps its build output beside
     * the sources: offer «bin» or «build» when such a folder is already there. */
    if (kind == DUMP_EXTERNAL) {
        std::wstring probe = dir;
        for (int level = 0; level < 3; ++level) {
            size_t cut = probe.find_last_of(L"\\/");
            if (cut == std::wstring::npos) break;
            if (EqualsNoCase(PathFindFileNameW(probe.c_str()), L"src")) {
                std::wstring project = probe.substr(0, cut);
                const wchar_t* kOut[] = { L"bin", L"build" };
                for (const wchar_t* candidate : kOut) {
                    std::wstring out = Join(project, candidate);
                    if (DirExists(out)) { outDir = out; break; }
                }
                break;
            }
            /* Only a kind bucket may stand between «src» and the object's own folder. */
            if (level == 1 && !EqualsNoCase(PathFindFileNameW(probe.c_str()), L"epf")
                && !EqualsNoCase(PathFindFileNameW(probe.c_str()), L"erf")) break;
            probe = probe.substr(0, cut);
        }
    }
    return Join(outDir, name + suffix);
}

BuildSettings BuildSettings::Load()
{
    BuildSettings s;
    auto v = ReadKeyValues(Join(AppDataDir(), L"pack.ini"));
    s.assemble = ValueOr(v, L"Assemble") != L"0";
    s.load = ValueOr(v, L"Load") == L"1";
    s.updateDb = ValueOr(v, L"UpdateDb") != L"0";
    s.baseId = ValueOr(v, L"BaseId");
    s.platform = ValueOr(v, L"Platform");
    std::wstring kind = ValueOr(v, L"Kind");
    s.kind = kind == L"Base" ? CTX_BASE : kind == L"Cf" ? CTX_CF : CTX_EMPTY;
    s.cfPath = ValueOr(v, L"CfPath");
    return s;
}

void BuildSettings::Save() const
{
    std::vector<std::pair<std::wstring, std::wstring>> v = {
        { L"Assemble", assemble ? L"1" : L"0" },
        { L"Load", load ? L"1" : L"0" },
        { L"UpdateDb", updateDb ? L"1" : L"0" },
        { L"BaseId", baseId },
        { L"Platform", platform },
        { L"Kind", kind == CTX_BASE ? L"Base" : kind == CTX_CF ? L"Cf" : L"Empty" },
        { L"CfPath", cfPath },
    };
    if (MakeDirs(AppDataDir())) WriteKeyValues(Join(AppDataDir(), L"pack.ini"), v);
}

/* An external object goes back into its file through a service infobase, the
 * same one its unpacking used: ibcmd reads the XML against that configuration
 * and writes the .epf/.erf with --out. An infobase of the user's list is
 * reached through the Designer instead, because ibcmd cannot connect through
 * a cluster and must not be let near a working base's own configuration. */
bool Job::AssembleExternal(std::wstring& error)
{
    if (mBuild.kind == CTX_BASE) {
        Log(L"Сборка конфигуратором (база «" + mBuild.base.name + L"»)...");
        if (!RunDesigner({ L"/LoadExternalDataProcessorOrReportFromFiles", mBuild.source, mBuild.outFile },
                         L"Конфигуратор не собрал файл", error))
            return false;
    } else {
        std::wstring cacheDir = Join(CacheRoot(), CacheKey(mBuild.kind, mBuild.cfPath, mBuild.platform.version));
        if (!MakeDirs(cacheDir)) {
            error = L"Не удалось создать каталог кэша " + cacheDir;
            return false;
        }
        HANDLE lock = AcquireLock(Join(cacheDir, L".lock"));
        if (lock == INVALID_HANDLE_VALUE) {
            if (!mCanceled) error = L"Не удалось занять служебную базу " + cacheDir;
            return false;
        }
        std::wstring ibDir;
        bool ok = EnsureInfoBase(cacheDir, ibDir, error);
        if (ok) {
            Log(L"Сборка " + std::wstring(PathFindFileNameW(mBuild.outFile.c_str())) + L"...");
            ok = IbcmdStep({ L"config", L"import", L"--db-path=" + ibDir,
                             L"--out=" + mBuild.outFile, mBuild.source },
                           L"Не удалось собрать файл", error);
        }
        CloseHandle(lock);
        if (!ok || mCanceled) return false;
    }
    if (!FileExists(mBuild.outFile)) {
        error = L"Сборка не создала " + mBuild.outFile;
        return false;
    }
    return true;
}

/* A configuration or an extension is assembled in a scratch infobase, so no
 * base of the user's is touched: the XML is imported there and written out as
 * a .cf/.cfe in one ibcmd step. */
bool Job::AssembleConfig(std::wstring& error)
{
    std::wstring scratch;
    if (!ScratchBase(scratch, error)) return false;
    std::vector<std::wstring> args = { L"config", L"import", L"--db-path=" + scratch };
    if (!mBuild.extension.empty()) {
        Log(L"Расширение " + mBuild.extension);
        if (!IbcmdStep({ L"extension", L"create", L"--db-path=" + scratch,
                         L"--name=" + mBuild.extension, L"--name-prefix=" + mBuild.extension },
                       L"Не удалось создать расширение в служебной базе", error)) {
            TryRemove(scratch);
            return false;
        }
        args.push_back(L"--extension=" + mBuild.extension);
    }
    args.push_back(L"--out=" + mBuild.outFile);
    args.push_back(mBuild.dumpDir);
    Log(L"Сборка " + std::wstring(PathFindFileNameW(mBuild.outFile.c_str())) + L"...");
    bool ok = IbcmdStep(args, L"Не удалось собрать файл", error);
    TryRemove(scratch);
    if (!ok || mCanceled) return false;
    if (!FileExists(mBuild.outFile)) {
        error = L"Сборка не создала " + mBuild.outFile;
        return false;
    }
    return true;
}

bool Job::Assemble(std::wstring& error)
{
    size_t slash = mBuild.outFile.find_last_of(L"\\/");
    std::wstring dir = slash == std::wstring::npos ? std::wstring() : mBuild.outFile.substr(0, slash);
    if (!dir.empty() && !MakeDirs(dir)) {
        error = L"Не удалось создать каталог " + dir;
        return false;
    }
    return mBuild.dump == DUMP_EXTERNAL ? AssembleExternal(error) : AssembleConfig(error);
}

/* The dump into an infobase: the Designer does it for file and server bases
 * alike, whole or by the object files the user picked. A partial load changes
 * the objects named and leaves the rest of the configuration as it is. */
bool Job::LoadDump(std::wstring& error)
{
    std::vector<std::wstring> action = { L"/LoadConfigFromFiles", mBuild.dumpDir };
    if (!mBuild.extension.empty()) {
        action.push_back(L"-Extension");
        action.push_back(mBuild.extension);
    }
    std::wstring listFile;
    if (!mBuild.files.empty()) {
        wchar_t temp[MAX_PATH] = {};
        GetTempPathW(MAX_PATH, temp);
        GUID g;
        CoCreateGuid(&g);
        wchar_t name[64];
        swprintf(name, 64, L"BSLView-pack-%08lx%04x%04x.txt", g.Data1, g.Data2, g.Data3);
        listFile = Join(temp, name);
        std::wstring text;
        for (size_t i = 0; i < mBuild.files.size(); i++) text += mBuild.files[i] + L"\r\n";
        if (!WriteTextFile(listFile.c_str(), text, ENC_UTF8)) {
            error = L"Не удалось записать список объектов " + listFile;
            return false;
        }
        action.push_back(L"-listFile");
        action.push_back(listFile);
        action.push_back(L"-updateConfigDumpInfo");
        Log(L"Загрузка выбранных объектов (" + std::to_wstring((long)mBuild.files.size()) + L")...");
        for (size_t i = 0; i < mBuild.files.size() && i < 50; i++) Log(L"  " + mBuild.files[i]);
    } else {
        Log(L"Загрузка всей выгрузки...");
    }
    if (mBuild.updateDb) {
        action.push_back(L"/UpdateDBCfg");
        if (!mBuild.extension.empty()) {
            action.push_back(L"-Extension");
            action.push_back(mBuild.extension);
        }
    }
    bool ok = RunDesigner(action, L"Конфигуратор не загрузил выгрузку", error);
    if (!listFile.empty()) TryRemove(listFile);
    return ok && !mCanceled;
}

bool Job::Build(const BuildRequest& req, const std::function<void(const std::wstring&)>& log,
                std::wstring& error)
{
    mBuild = req;
    mLog = &log;
    /* The helpers shared with unpacking read the platform, the infobase and
     * the authorization from mReq. */
    mReq = UnpackRequest();
    mReq.platform = req.platform;
    mReq.base = req.base;
    mReq.user = req.user;
    mReq.password = req.password;
    mReq.kind = req.kind;
    mReq.cfPath = req.cfPath;

    if (req.dump == DUMP_NONE) {
        error = L"Это не выгрузка объекта: нет корневого XML.";
        return false;
    }
    if (!req.assemble && !req.load) {
        error = L"Не выбрано ни одного действия.";
        return false;
    }
    Log(L"Платформа " + req.platform.version);
    if (req.assemble && !Assemble(error)) return false;
    if (mCanceled) return false;
    if (req.load && !LoadDump(error)) return false;
    if (mCanceled) return false;
    Log(L"Готово.");
    return true;
}

} // namespace epf
