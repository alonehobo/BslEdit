#include <windows.h>
#include <ole2.h>
#include <string.h>
#include <stdlib.h>
#include <wctype.h>
#include <string>
#include <vector>
#include <shellapi.h>
#include <commdlg.h>
#include <shlobj.h>
#include <commctrl.h>
#include <uxtheme.h>
#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "uxtheme.lib")

#include "webview2host.h"
#include "bslcommon.h"
#include "epfunpack.h"
#include "resource.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "shell32.lib")

static CWebView2Host* g_webView = NULL;
static const wchar_t* WNDCLASS_NAME = L"BSLEditMainWnd";
static const wchar_t* APP_TITLE = L"BSL Editor";
static const DWORD MAX_FILE_BYTES = 256u * 1024u * 1024u;

static int HexValue(wchar_t ch)
{
    if (ch >= L'0' && ch <= L'9') return ch - L'0';
    if (ch >= L'a' && ch <= L'f') return ch - L'a' + 10;
    if (ch >= L'A' && ch <= L'F') return ch - L'A' + 10;
    return -1;
}

static std::wstring DecodePercentUtf8(const std::wstring& value)
{
    std::wstring result;
    for (size_t i = 0; i < value.size();) {
        if (value[i] != L'%' || i + 2 >= value.size() ||
            HexValue(value[i + 1]) < 0 || HexValue(value[i + 2]) < 0) {
            result.push_back(value[i++]);
            continue;
        }

        std::string bytes;
        while (i + 2 < value.size() && value[i] == L'%' &&
               HexValue(value[i + 1]) >= 0 && HexValue(value[i + 2]) >= 0) {
            bytes.push_back((char)((HexValue(value[i + 1]) << 4) | HexValue(value[i + 2])));
            i += 3;
        }
        int chars = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                        bytes.data(), (int)bytes.size(), NULL, 0);
        if (chars > 0) {
            size_t start = result.size();
            result.resize(start + chars);
            MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                bytes.data(), (int)bytes.size(), &result[start], chars);
        } else {
            for (size_t b = 0; b < bytes.size(); b++)
                result.push_back((unsigned char)bytes[b]);
        }
    }
    return result;
}

static std::wstring FilePathFromBsleditUrl(const std::wstring& argument)
{
    if (argument.size() < 8 || _wcsnicmp(argument.c_str(), L"bsledit:", 8) != 0)
        return argument;

    std::wstring path = DecodePercentUtf8(argument.substr(8));
    while (path.size() >= 2 && path[0] == L'/' && path[1] == L'/')
        path.erase(path.begin());
    if (path.size() >= 3 && path[0] == L'/' &&
        ((path[1] >= L'A' && path[1] <= L'Z') || (path[1] >= L'a' && path[1] <= L'z')) &&
        path[2] == L':')
        path.erase(path.begin());
    for (size_t i = 0; i < path.size(); i++)
        if (path[i] == L'/') path[i] = L'\\';
    return path;
}

/* The window's size, position and maximized state from the last session,
 * kept per user. A placement that no longer fits any monitor (a detached
 * display) is ignored and the window opens at the default place. */
static const wchar_t* SETTINGS_KEY = L"Software\\BSLEdit";
static const wchar_t* PLACEMENT_VALUE = L"WindowPlacement";

static void SaveWindowPlacement(HWND hwnd)
{
    WINDOWPLACEMENT wp = {};
    wp.length = sizeof(wp);
    if (!GetWindowPlacement(hwnd, &wp)) return;
    HKEY hKey = NULL;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, SETTINGS_KEY, 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL) != ERROR_SUCCESS)
        return;
    RegSetValueExW(hKey, PLACEMENT_VALUE, 0, REG_BINARY, (const BYTE*)&wp, sizeof(wp));
    RegCloseKey(hKey);
}

static bool LoadWindowPlacement(WINDOWPLACEMENT& wp)
{
    DWORD size = sizeof(wp);
    DWORD type = 0;
    if (RegGetValueW(HKEY_CURRENT_USER, SETTINGS_KEY, PLACEMENT_VALUE, RRF_RT_REG_BINARY, &type, &wp, &size)
            != ERROR_SUCCESS || size != sizeof(wp) || wp.length != sizeof(wp))
        return false;
    const RECT& r = wp.rcNormalPosition;
    if (r.right - r.left < 200 || r.bottom - r.top < 150) return false;
    return MonitorFromRect(&r, MONITOR_DEFAULTTONULL) != NULL;
}

static void OnMainMenuCommand(HWND hwnd, UINT id);

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    switch (msg) {
    case WM_COMMAND:
        if (HIWORD(wParam) == 0 && lParam == 0) { OnMainMenuCommand(hwnd, LOWORD(wParam)); return 0; }
        break;

    case WM_SIZE:
        if (g_webView) g_webView->Resize();
        return 0;

    case WM_BSLVIEW_WEBVIEW_FAILED:
        {
            HRESULT hr = CWebView2Host::LastError();
            if (!hr) hr = (HRESULT)wParam;
            wchar_t text[640];
            wsprintfW(text,
                L"Не удалось запустить WebView2 (0x%08X).\n\n"
                L"Если Runtime уже установлен, закройте Total Commander и откройте редактор снова — "
                L"плагин мог занять профиль браузера.\n\n"
                L"Иначе установите Microsoft Edge WebView2 Runtime:\n"
                L"https://go.microsoft.com/fwlink/p/?LinkId=2124703",
                (unsigned)hr);
            MessageBoxW(hwnd, text, APP_TITLE, MB_OK | MB_ICONERROR);
            DestroyWindow(hwnd);
        }
        return 0;

    case WM_CLOSE:
        // Give the page a chance to warn about unsaved edits before the
        // window actually goes away; it answers asynchronously with
        // WM_BSLVIEW_CLOSE_ACK. Nothing to ask (page not loaded yet, or
        // WebView2 failed) falls through to the default close.
        if (g_webView && g_webView->RequestClose())
            return 0;
        break;

    case WM_BSLVIEW_CLOSE_ACK:
        if (wParam) DestroyWindow(hwnd);
        return 0;

    case WM_DESTROY:
        SaveWindowPlacement(hwnd);
        if (g_webView) {
            g_webView->Close();
            g_webView->Release();
            g_webView = NULL;
        }
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

// While this window holds unsaved changes to a file, the 1C Form Viewer MCP
// server leaves that file alone: its edit_form and edit_template refuse to
// write it, because the editor's own buffer wins on the next save. A file that
// is merely open is not held - the editor re-reads it when it changes on disk,
// which is what lets the user watch an agent work. The marker is a named
// mutex; the server only ever opens it.
//
// The twin of the two functions below is bsledit_open_mutex_name() in
// packages/1c-form-viewer/native/mcp-server.cpp. The two spellings must stay
// identical: a difference does not fail, it silently turns the protection off,
// which is why native-contract.test.ts derives the name a third time.
static std::wstring FinalPathName(const std::wstring& path)
{
    std::wstring result = path;
    HANDLE file = CreateFileW(path.c_str(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              NULL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL);
    if (file != INVALID_HANDLE_VALUE) {
        std::wstring buffer(MAX_PATH, L'\0');
        DWORD length = GetFinalPathNameByHandleW(file, &buffer[0], (DWORD)buffer.size(), VOLUME_NAME_DOS);
        if (length >= buffer.size()) {
            buffer.resize(length + 1);
            length = GetFinalPathNameByHandleW(file, &buffer[0], (DWORD)buffer.size(), VOLUME_NAME_DOS);
        }
        CloseHandle(file);
        if (length && length < buffer.size()) result.assign(buffer.c_str(), length);
    }
    if (result.compare(0, 8, L"\\\\?\\UNC\\") == 0) result = L"\\\\" + result.substr(8);
    else if (result.compare(0, 4, L"\\\\?\\") == 0) result.erase(0, 4);
    return result;
}

static std::wstring BSLEditOpenMutexName(const std::wstring& path)
{
    std::wstring text = FinalPathName(path);
    if (!text.empty()) {
        // The invariant locale, not the process one: the same path must hash
        // the same way here and in the MCP server, whatever either has set.
        std::wstring lowered(text.size(), L'\0');
        int mapped = LCMapStringEx(LOCALE_NAME_INVARIANT, LCMAP_LOWERCASE, text.c_str(), (int)text.size(),
                                   &lowered[0], (int)lowered.size(), NULL, NULL, 0);
        if (mapped > 0) text.assign(lowered.c_str(), (size_t)mapped);
    }
    unsigned long long hash = 14695981039346656037ull;
    for (size_t i = 0; i < text.size(); i++) {
        hash = (hash ^ (unsigned char)(text[i] & 0xff)) * 1099511628211ull;
        hash = (hash ^ (unsigned char)((text[i] >> 8) & 0xff)) * 1099511628211ull;
    }
    wchar_t hex[17] = {};
    swprintf(hex, 17, L"%016llx", hash);
    return std::wstring(L"Local\\BSLEdit.Open.") + hex;
}

/* The marker says which files this window holds unsaved changes for. Looking
 * at a file is not holding it: an agent may write a form the user is only
 * reading, and the editor will show the new file by itself. What must not be
 * overwritten is a buffer the user has typed into, and that is what the marker
 * names - per file, because the layout and the module of a form are edited and
 * saved one by one.
 *
 * The window also moves between files (go-to-definition, a form module, a
 * member of an unpacked epf), so a marker never outlives the document it
 * belonged to: the file left behind would otherwise still look busy while the
 * one on screen went unprotected. */
class BSLEditOpenMarker
{
public:
    ~BSLEditOpenMarker() { Hold(std::wstring(), std::wstring()); }

    // An empty path means "not held". Called on the UI thread only.
    void Hold(const std::wstring& file, const std::wstring& module)
    {
        std::wstring names[kSlots] = {
            file.empty() ? std::wstring() : BSLEditOpenMutexName(file),
            module.empty() ? std::wstring() : BSLEditOpenMutexName(module)
        };
        // A module opened on its own arrives in both slots; one handle is enough.
        if (!names[0].empty() && names[0] == names[1]) names[1].clear();
        for (int slot = 0; slot < kSlots; ++slot) {
            if (names[slot] == mName[slot]) continue;   // keep the handle we hold
            if (mHandle[slot]) { CloseHandle(mHandle[slot]); mHandle[slot] = NULL; }
            mName[slot] = names[slot];
            if (!mName[slot].empty()) mHandle[slot] = CreateMutexW(NULL, FALSE, mName[slot].c_str());
        }
    }

private:
    static const int kSlots = 2;   // the opened file and the form module
    HANDLE mHandle[kSlots] = { NULL, NULL };
    std::wstring mName[kSlots];
};

// --no-register стоит перед именем файла и в него не превращается.
static bool g_suppressRegistration = false;
static int g_initialLine = 0;
static std::wstring g_initialSearch;
static bool g_initialRegexp = false;
static bool g_initialMatchCase = false;
static bool g_initialPack = false;   // --pack: the assembly panel of the file's dump
static std::wstring g_previewSession;

static std::wstring GetFileFromCmdLine()
{
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    std::wstring result;
    int index = 1;
    if (argv && argc > 1 && _wcsicmp(argv[1], L"--no-register") == 0) {
        g_suppressRegistration = true;
        index = 2;
    }
    if (argv && argc > index) result = argv[index];
    if (argv) {
        for (int i = index + 1; i < argc; ++i) {
            if (_wcsicmp(argv[i], L"--line") == 0 && i + 1 < argc) {
                int line = _wtoi(argv[++i]);
                if (line > 0) g_initialLine = line;
            } else if (_wcsicmp(argv[i], L"--find") == 0 && i + 1 < argc) {
                g_initialSearch = argv[++i];
            } else if (_wcsicmp(argv[i], L"--regexp") == 0) {
                g_initialRegexp = true;
            } else if (_wcsicmp(argv[i], L"--match-case") == 0) {
                g_initialMatchCase = true;
            } else if (_wcsicmp(argv[i], L"--pack") == 0) {
                g_initialPack = true;
            } else if (_wcsicmp(argv[i], L"--preview-session") == 0 && i + 1 < argc) {
                /* Only a loopback preview of the form viewer MCP server; the
                 * page talks to nothing else. */
                std::wstring url = argv[++i];
                if (url.rfind(L"http://127.0.0.1:", 0) == 0) g_previewSession = url;
            }
        }
    }
    if (argv) LocalFree(argv);
    // Some launchers leave the quotes in argv[1]. CreateFile then looks for
    // a name that does not exist and the Open-with dialog looks like a loop.
    if (result.size() >= 2 && result.front() == L'"' && result.back() == L'"')
        result = result.substr(1, result.size() - 2);
    return FilePathFromBsleditUrl(result);
}

static std::wstring GetHkcuDefaultSz(const wchar_t* subkey)
{
    HKEY hKey = NULL;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, subkey, 0, KEY_READ, &hKey) != ERROR_SUCCESS)
        return std::wstring();

    wchar_t buf[2048];
    DWORD sz = sizeof(buf);
    DWORD type = 0;
    LONG rc = RegQueryValueExW(hKey, NULL, NULL, &type, (BYTE*)buf, &sz);
    RegCloseKey(hKey);
    if (rc != ERROR_SUCCESS || type != REG_SZ) return std::wstring();

    // RegQueryValueExW does not guarantee NUL-termination when a value fills
    // the buffer exactly; measure explicitly rather than trust one.
    size_t chars = sz / sizeof(wchar_t);
    while (chars > 0 && buf[chars - 1] == L'\0') chars--;
    return std::wstring(buf, chars);
}

static void SetHkcuDefaultSz(const wchar_t* subkey, const wchar_t* value)
{
    HKEY hKey = NULL;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, subkey, 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL) != ERROR_SUCCESS)
        return;
    RegSetValueExW(hKey, NULL, 0, REG_SZ, (const BYTE*)value,
                   (DWORD)((wcslen(value) + 1) * sizeof(wchar_t)));
    RegCloseKey(hKey);
}

static void SetHkcuNamedSz(const wchar_t* subkey, const wchar_t* name, const wchar_t* value)
{
    HKEY hKey = NULL;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, subkey, 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL) != ERROR_SUCCESS)
        return;
    RegSetValueExW(hKey, name, 0, REG_SZ, (const BYTE*)value,
                   (DWORD)((wcslen(value) + 1) * sizeof(wchar_t)));
    RegCloseKey(hKey);
}

/* Кто владеет ассоциациями. Регистрация — не побочный эффект запуска: любая
 * копия, записав в HKCU свой путь, отбирает протокол bsledit: у установленной,
 * а после удаления временной сборки Проводник и MCP указывают на несуществующий
 * exe. Поэтому запись делается только при явном --register-protocol, при
 * отсутствующей или битой регистрации, или когда зарегистрирован этот же путь. */
static const wchar_t* REGISTRATION_KEY = L"Software\\BSLEdit\\Registration";

static std::wstring OwnExePath()
{
    wchar_t exePath[MAX_PATH];
    if (!GetModuleFileNameW(NULL, exePath, MAX_PATH)) return std::wstring();
    return std::wstring(exePath);
}

static std::wstring LowerCopy(const std::wstring& value)
{
    std::wstring result = value;
    for (size_t i = 0; i < result.size(); i++) result[i] = (wchar_t)towlower(result[i]);
    return result;
}

// Первый путь в строке команды: "C:\Tools\BSLEdit.exe" "%1".
static std::wstring ExeFromCommand(const std::wstring& command)
{
    if (command.empty()) return std::wstring();
    if (command.front() == L'"') {
        size_t end = command.find(L'"', 1);
        if (end == std::wstring::npos) return std::wstring();
        return command.substr(1, end - 1);
    }
    return command.substr(0, command.find(L' '));
}

static std::wstring RegisteredProtocolExe()
{
    return ExeFromCommand(GetHkcuDefaultSz(L"Software\\Classes\\bsledit\\shell\\open\\command"));
}

// Сборка из worktree, dist, obj, %TEMP% или помеченная файлом bsledit.dev
// рядом с exe ассоциации не трогает. То же делает BSLEDIT_NO_REGISTER=1.
static bool IsTransientBuild(const std::wstring& exePath)
{
    const wchar_t* suppress = _wgetenv(L"BSLEDIT_NO_REGISTER");
    if (suppress && suppress[0] && wcscmp(suppress, L"0") != 0) return true;

    std::wstring dir = exePath;
    size_t slash = dir.find_last_of(L'\\');
    dir = (slash == std::wstring::npos) ? std::wstring() : dir.substr(0, slash);
    if (!dir.empty() &&
        GetFileAttributesW((dir + L"\\bsledit.dev").c_str()) != INVALID_FILE_ATTRIBUTES)
        return true;

    std::wstring lower = LowerCopy(exePath);
    const wchar_t* markers[] = { L"\\worktrees\\", L"\\dist\\", L"\\obj32\\", L"\\obj64\\",
                                 L"\\objexe\\", L"\\objgen\\", L"\\objtest\\" };
    for (size_t i = 0; i < sizeof(markers) / sizeof(markers[0]); i++)
        if (lower.find(markers[i]) != std::wstring::npos) return true;

    wchar_t tempDir[MAX_PATH];
    DWORD len = GetTempPathW(MAX_PATH, tempDir);
    if (len > 0 && len < MAX_PATH) {
        std::wstring temp = LowerCopy(std::wstring(tempDir, len));
        if (!temp.empty() && lower.size() >= temp.size() &&
            lower.compare(0, temp.size(), temp) == 0) return true;
    }
    return false;
}

static bool g_registrationAllowed = false;

// explicitRequest - запуск с --register-protocol: пользователь сам назначает
// эту копию основной, поэтому она забирает регистрацию у любой другой.
static bool DecideRegistration(bool explicitRequest)
{
    if (explicitRequest) return true;

    std::wstring own = OwnExePath();
    if (own.empty()) return false;
    if (IsTransientBuild(own)) return false;

    std::wstring registered = RegisteredProtocolExe();
    if (registered.empty()) return true;
    // Удалённая временная сборка оставляет мёртвую регистрацию - чиним её.
    if (GetFileAttributesW(registered.c_str()) == INVALID_FILE_ATTRIBUTES) return true;
    return _wcsicmp(registered.c_str(), own.c_str()) == 0;
}

// Журнал регистрации: кто именно захватил ассоциации и когда. Нужен для
// диагностики и чтобы понять, какая копия считается основной.
static void RecordRegistration(bool explicitRequest)
{
    std::wstring own = OwnExePath();
    if (own.empty()) return;

    SYSTEMTIME now = {};
    GetLocalTime(&now);
    wchar_t stamp[32];
    swprintf(stamp, 32, L"%04u-%02u-%02u %02u:%02u:%02u",
             now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond);

    std::wstring version;
    WIN32_FILE_ATTRIBUTE_DATA info = {};
    if (GetFileAttributesExW(own.c_str(), GetFileExInfoStandard, &info)) {
        SYSTEMTIME built = {};
        if (FileTimeToSystemTime(&info.ftLastWriteTime, &built)) {
            wchar_t buildStamp[32];
            swprintf(buildStamp, 32, L"%04u-%02u-%02uT%02u:%02u:%02uZ",
                     built.wYear, built.wMonth, built.wDay,
                     built.wHour, built.wMinute, built.wSecond);
            version = buildStamp;
        }
    }

    SetHkcuNamedSz(REGISTRATION_KEY, L"Path", own.c_str());
    SetHkcuNamedSz(REGISTRATION_KEY, L"Timestamp", stamp);
    SetHkcuNamedSz(REGISTRATION_KEY, L"Version", version.c_str());
    SetHkcuNamedSz(REGISTRATION_KEY, L"Mode", explicitRequest ? L"explicit" : L"auto");
}

struct AssocExt { const wchar_t* ext; const wchar_t* progId; };
static const AssocExt kAssocExts[] = {
    { L".bsl", L"BSLEdit.File" },      { L".os", L"BSLEdit.File" },
    { L".sdbl", L"BSLEdit.File" },     { L".query", L"BSLEdit.File" },
    { L".xml", L"BSLEdit.Container" }, { L".mdo", L"BSLEdit.File" },
    { L".form", L"BSLEdit.File" },     { L".mxl", L"BSLEdit.File" },
    { L".mxlx", L"BSLEdit.File" },     { L".epf", L"BSLEdit.Container" },
    { L".erf", L"BSLEdit.Container" }, { L".cf", L"BSLEdit.Container" },
    { L".cfe", L"BSLEdit.Container" }, { L".dt", L"BSLEdit.Container" },
    { L".md", L"BSLEdit.File" },       { L".markdown", L"BSLEdit.File" },
    { L".mdc", L"BSLEdit.File" },      { L".json", L"BSLEdit.File" },
    { L".sarif", L"BSLEdit.File" },    { L".ps1", L"BSLEdit.File" },
    { L".psm1", L"BSLEdit.File" },     { L".psd1", L"BSLEdit.File" },
    { L".html", L"BSLEdit.File" },     { L".htm", L"BSLEdit.File" },
};
static const int kAssocCount = (int)(sizeof(kAssocExts) / sizeof(kAssocExts[0]));
static const wchar_t* CAPABILITIES_KEY = L"Software\\BSLEdit\\Capabilities";

static bool IsOwnProgId(const std::wstring& progId)
{
    return _wcsicmp(progId.c_str(), L"BSLEdit.File") == 0 ||
           _wcsicmp(progId.c_str(), L"BSLEdit.Container") == 0;
}

// --unregister: снять за собой всё, что пишут функции ниже. Значения .bsl/.os
// сбрасываются только если они всё ещё указывают на BSLEdit.
static void UnregisterAll()
{
    const std::wstring classes = L"Software\\Classes\\";
    RegDeleteTreeW(HKEY_CURRENT_USER, (classes + L"bsledit").c_str());
    RegDeleteTreeW(HKEY_CURRENT_USER, (classes + L"BSLEdit.File").c_str());
    RegDeleteTreeW(HKEY_CURRENT_USER, (classes + L"BSLEdit.Container").c_str());
    RegDeleteTreeW(HKEY_CURRENT_USER, (classes + L"Applications\\BSLEdit.exe").c_str());

    const wchar_t* ownedExts[] = { L".bsl", L".os" };
    for (int i = 0; i < 2; i++) {
        std::wstring key = classes + ownedExts[i];
        if (GetHkcuDefaultSz(key.c_str()) == L"BSLEdit.File")
            SetHkcuDefaultSz(key.c_str(), L"");
    }

    const wchar_t* containerExts[] = { L".epf", L".erf", L".cf", L".cfe", L".dt", L".xml" };
    for (size_t i = 0; i < sizeof(containerExts) / sizeof(containerExts[0]); i++) {
        std::wstring verb = classes + L"SystemFileAssociations\\" + containerExts[i] + L"\\shell\\BSLEdit";
        RegDeleteTreeW(HKEY_CURRENT_USER, verb.c_str());
        HKEY hKey = NULL;
        std::wstring progIds = classes + containerExts[i] + L"\\OpenWithProgids";
        if (RegOpenKeyExW(HKEY_CURRENT_USER, progIds.c_str(), 0, KEY_SET_VALUE, &hKey) == ERROR_SUCCESS) {
            RegDeleteValueW(hKey, L"BSLEdit.Container");
            RegCloseKey(hKey);
        }
    }

    // What the settings window wrote: defaults it took and the entry that
    // lists BSLEdit in «Приложения по умолчанию».
    for (int i = 0; i < kAssocCount; i++) {
        std::wstring key = classes + kAssocExts[i].ext;
        if (IsOwnProgId(GetHkcuDefaultSz(key.c_str()))) SetHkcuDefaultSz(key.c_str(), L"");
    }
    RegDeleteTreeW(HKEY_CURRENT_USER, CAPABILITIES_KEY);
    HKEY apps = NULL;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\RegisteredApplications", 0, KEY_SET_VALUE, &apps) == ERROR_SUCCESS) {
        RegDeleteValueW(apps, L"BSLEdit");
        RegCloseKey(apps);
    }

    RegDeleteTreeW(HKEY_CURRENT_USER, REGISTRATION_KEY);
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);
}

static void RegisterUrlProtocol()
{
    if (!g_registrationAllowed) return;
    wchar_t exePath[MAX_PATH];
    if (!GetModuleFileNameW(NULL, exePath, MAX_PATH)) return;

    std::wstring cmdVal = std::wstring(L"\"") + exePath + L"\" \"%1\"";
    std::wstring iconVal = std::wstring(exePath) + L",0";
    const wchar_t* rootKey = L"Software\\Classes\\bsledit";

    if (GetHkcuDefaultSz(L"Software\\Classes\\bsledit\\shell\\open\\command") == cmdVal)
        return;
    SetHkcuDefaultSz(rootKey, L"URL:BSLEdit Protocol");
    SetHkcuNamedSz(rootKey, L"URL Protocol", L"");
    SetHkcuDefaultSz(L"Software\\Classes\\bsledit\\DefaultIcon", iconVal.c_str());
    SetHkcuDefaultSz(L"Software\\Classes\\bsledit\\shell\\open\\command", cmdVal.c_str());
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);
}

static void RegisterFileAssociation()
{
    if (!g_registrationAllowed) return;
    wchar_t exePath[MAX_PATH];
    if (!GetModuleFileNameW(NULL, exePath, MAX_PATH)) return;

    std::wstring cmdVal = std::wstring(L"\"") + exePath + L"\" \"%1\"";
    std::wstring iconVal = std::wstring(exePath) + L",0";

    const wchar_t* cmdKey = L"Software\\Classes\\BSLEdit.File\\shell\\open\\command";
    const wchar_t* iconKey = L"Software\\Classes\\BSLEdit.File\\DefaultIcon";
    const wchar_t* appCmdKey = L"Software\\Classes\\Applications\\BSLEdit.exe\\shell\\open\\command";
    const wchar_t* consentKey = L"Software\\BSLEdit\\Assoc";

    // Re-write if the ProgId is missing *or* the exe moved. The previous early
    // return on ProgId==BSLEdit.File left Explorer pointing at a stale path,
    // which makes double-click loop the "Open with" dialog.
    if (GetHkcuDefaultSz(L"Software\\Classes\\.bsl") == L"BSLEdit.File" &&
        GetHkcuDefaultSz(cmdKey) == cmdVal &&
        GetHkcuDefaultSz(appCmdKey) == cmdVal)
        return;

    // Changing HKCU\Classes changes what double-clicking a .bsl/.os file does
    // system-wide. Ask once and remember the answer instead of writing it
    // silently on every launch; a later "no" still lets a moved exe fix up
    // its own command path without asking again.
    std::wstring consent = GetHkcuDefaultSz(consentKey);
    if (consent.empty()) {
        int choice = MessageBoxW(NULL,
            L"Открывать файлы .bsl и .os в BSLEdit по умолчанию?\n\n"
            L"Это можно изменить позже в параметрах Windows "
            L"— «Приложения по умолчанию».",
            APP_TITLE, MB_YESNO | MB_ICONQUESTION);
        consent = (choice == IDYES) ? L"1" : L"0";
        SetHkcuDefaultSz(consentKey, consent.c_str());
    }
    if (consent != L"1") return;

    const wchar_t* exts[] = { L".bsl", L".os" };
    for (int i = 0; i < 2; i++) {
        std::wstring key = std::wstring(L"Software\\Classes\\") + exts[i];
        SetHkcuDefaultSz(key.c_str(), L"BSLEdit.File");
    }

    SetHkcuDefaultSz(L"Software\\Classes\\BSLEdit.File", L"1C:Enterprise BSL Module");
    SetHkcuDefaultSz(iconKey, iconVal.c_str());
    SetHkcuDefaultSz(cmdKey, cmdVal.c_str());
    SetHkcuDefaultSz(appCmdKey, cmdVal.c_str());

    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);
}

// 1C containers belong to the platform: double-click on an .epf runs the
// processing in 1C, so BSLEdit never takes the default here. It only adds
// processing in 1C, and .xml has its own owner, so BSLEdit never takes the default here. It only adds
// change nothing until the user picks them, hence no consent prompt.
static void RegisterContainerOpenWith()
{
    if (!g_registrationAllowed) return;
    wchar_t exePath[MAX_PATH];
    if (!GetModuleFileNameW(NULL, exePath, MAX_PATH)) return;

    std::wstring cmdVal = std::wstring(L"\"") + exePath + L"\" \"%1\"";
    std::wstring iconVal = std::wstring(exePath) + L",0";
    const wchar_t* exts[] = { L".epf", L".erf", L".cf", L".cfe", L".dt", L".xml" };
    const wchar_t* progId = L"BSLEdit.Container";
    const std::wstring classes = L"Software\\Classes\\";
    const std::wstring verbCmd = L"\\shell\\BSLEdit\\command";

    // The last key written below doubles as the "already done" marker; a
    // moved exe changes cmdVal and re-registers everything.
    std::wstring lastVerb = classes + L"SystemFileAssociations\\" + exts[sizeof(exts) / sizeof(exts[0]) - 1] + verbCmd;
    if (GetHkcuDefaultSz(lastVerb.c_str()) == cmdVal)
        return;

    std::wstring progKey = classes + progId;
    SetHkcuDefaultSz(progKey.c_str(), L"1C:Enterprise file (BSLEdit)");
    SetHkcuDefaultSz((progKey + L"\\DefaultIcon").c_str(), iconVal.c_str());
    SetHkcuDefaultSz((progKey + L"\\shell\\open\\command").c_str(), cmdVal.c_str());

    std::wstring supported = classes + L"Applications\\BSLEdit.exe\\SupportedTypes";
    for (const wchar_t* ext : exts) {
        SetHkcuNamedSz((classes + ext + L"\\OpenWithProgids").c_str(), progId, L"");
        SetHkcuNamedSz(supported.c_str(), ext, L"");

        std::wstring verb = classes + L"SystemFileAssociations\\" + ext + L"\\shell\\BSLEdit";
        SetHkcuDefaultSz(verb.c_str(), L"Открыть в BSLEdit");
        SetHkcuNamedSz(verb.c_str(), L"Icon", iconVal.c_str());
        SetHkcuDefaultSz((verb + L"\\command").c_str(), cmdVal.c_str());
    }

    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);
}

static std::wstring OpenFileDialog(HWND hParent)
{
    wchar_t filePath[MAX_PATH] = {};
    OPENFILENAMEW ofn = {};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = hParent;
    ofn.lpstrFilter =
        L"Supported files\0*.bsl;*.os;*.sdbl;*.query;*.md;*.markdown;*.mdc;*.json;*.sarif;*.xml;*.mdo;*.form;*.mxl;*.mxlx;*.epf;*.erf;*.cf;*.cfe;*.dt;*.ps1;*.psm1;*.psd1;*.html;*.htm\0"
        L"BSL files (*.bsl;*.os)\0*.bsl;*.os\0"
        L"Внешние обработки и отчёты (*.epf;*.erf)\0*.epf;*.erf\0"
        L"Markdown (*.md)\0*.md;*.markdown;*.mdc\0"
        L"JSON / SARIF (*.json;*.sarif)\0*.json;*.sarif\0"
        L"XML (*.xml)\0*.xml\0"
        L"Project metadata (*.mdo)\0*.mdo\0"
        L"Project forms (*.form)\0*.form\0"
        L"MXL (*.mxl)\0*.mxl\0"
        L"Project spreadsheet layout (*.mxlx)\0*.mxlx\0"
        L"PowerShell (*.ps1)\0*.ps1;*.psm1;*.psd1\0"
        L"HTML (*.html)\0*.html;*.htm\0"
        L"All files (*.*)\0*.*\0";
    ofn.lpstrFile = filePath;
    ofn.nMaxFile = MAX_PATH;
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    ofn.lpstrTitle = L"Открыть файл BSL";
    return GetOpenFileNameW(&ofn) ? std::wstring(filePath) : std::wstring();
}

// ------------------------------------------------------------------ settings
/* «Настройки»: which of the extensions BSLEdit reads it should open by default.
 * The writes go to HKCU\Software\Classes, which is all a program may change.
 * Windows 10/11 keep the user's own choice (FileExts\<ext>\UserChoice) behind
 * a hash that only the system settings can write; for such extensions the
 * window opens «Приложения по умолчанию» on BSLEdit, where BSLEdit is listed
 * through its Capabilities. */
static std::wstring UserChoiceProgId(const wchar_t* ext)
{
    std::wstring key = std::wstring(L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\")
        + ext + L"\\UserChoice";
    wchar_t buf[256] = {};
    DWORD size = sizeof(buf);
    if (RegGetValueW(HKEY_CURRENT_USER, key.c_str(), L"ProgId", RRF_RT_REG_SZ, NULL, buf, &size) != ERROR_SUCCESS)
        return std::wstring();
    return buf;
}

// Whether double-clicking a file of this extension opens BSLEdit now.
static bool OpensInBslEdit(const wchar_t* ext)
{
    std::wstring choice = UserChoiceProgId(ext);
    if (!choice.empty()) return IsOwnProgId(choice) || _wcsicmp(choice.c_str(), L"Applications\\BSLEdit.exe") == 0;
    return IsOwnProgId(GetHkcuDefaultSz((std::wstring(L"Software\\Classes\\") + ext).c_str()));
}

// The ProgIds and the Capabilities entry that «Приложения по умолчанию» lists.
static void WriteProgIds()
{
    std::wstring exe = OwnExePath();
    if (exe.empty()) return;
    std::wstring cmdVal = L"\"" + exe + L"\" \"%1\"";
    std::wstring iconVal = exe + L",0";
    const std::wstring classes = L"Software\\Classes\\";
    const wchar_t* progIds[] = { L"BSLEdit.File", L"BSLEdit.Container" };
    const wchar_t* names[] = { L"1C:Enterprise BSL Module", L"1C:Enterprise file (BSLEdit)" };
    for (int i = 0; i < 2; i++) {
        std::wstring key = classes + progIds[i];
        SetHkcuDefaultSz(key.c_str(), names[i]);
        SetHkcuDefaultSz((key + L"\\DefaultIcon").c_str(), iconVal.c_str());
        SetHkcuDefaultSz((key + L"\\shell\\open\\command").c_str(), cmdVal.c_str());
    }
    SetHkcuDefaultSz((classes + L"Applications\\BSLEdit.exe\\shell\\open\\command").c_str(), cmdVal.c_str());
    SetHkcuNamedSz(CAPABILITIES_KEY, L"ApplicationName", L"BSLEdit");
    SetHkcuNamedSz(CAPABILITIES_KEY, L"ApplicationDescription", L"Редактор и просмотрщик файлов 1С");
    SetHkcuNamedSz(L"Software\\RegisteredApplications", L"BSLEdit", CAPABILITIES_KEY);
}

/* Makes BSLEdit the default for the checked extensions and gives back the
 * unchecked ones it held. Returns the checked extensions Windows keeps for
 * another program - those only the system settings can change. */
static std::vector<std::wstring> ApplyAssociations(const bool* checked)
{
    WriteProgIds();
    const std::wstring classes = L"Software\\Classes\\";
    const std::wstring fileAssoc = std::wstring(CAPABILITIES_KEY) + L"\\FileAssociations";
    std::vector<std::wstring> blocked;
    bool bsl = false;
    for (int i = 0; i < kAssocCount; i++) {
        const AssocExt& a = kAssocExts[i];
        std::wstring extKey = classes + a.ext;
        if (checked[i]) {
            SetHkcuDefaultSz(extKey.c_str(), a.progId);
            SetHkcuNamedSz((extKey + L"\\OpenWithProgids").c_str(), a.progId, L"");
            SetHkcuNamedSz(fileAssoc.c_str(), a.ext, a.progId);
            std::wstring choice = UserChoiceProgId(a.ext);
            if (!choice.empty() && !OpensInBslEdit(a.ext)) blocked.push_back(a.ext);
            if (i < 2) bsl = true;
        } else {
            if (IsOwnProgId(GetHkcuDefaultSz(extKey.c_str()))) SetHkcuDefaultSz(extKey.c_str(), L"");
            HKEY hKey = NULL;
            if (RegOpenKeyExW(HKEY_CURRENT_USER, fileAssoc.c_str(), 0, KEY_SET_VALUE, &hKey) == ERROR_SUCCESS) {
                RegDeleteValueW(hKey, a.ext);
                RegCloseKey(hKey);
            }
        }
    }
    // The answer to the start-up question about .bsl/.os follows this choice,
    // so the next launch neither asks again nor takes them back.
    SetHkcuDefaultSz(L"Software\\BSLEdit\\Assoc", bsl ? L"1" : L"0");
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);
    return blocked;
}

enum { IDC_SET_FIRST = 1000, IDC_SET_APPLY = 1100, IDC_SET_CLOSE, IDC_SET_ALL, IDC_SET_NONE,
       IDC_SET_TEMPLATES, IDC_SET_MODULES };

/* How templates and modules open: L"edit" or L"view". Kept per user and
 * handed to the page with every file it loads. */
static const wchar_t* TEMPLATE_MODE_VALUE = L"TemplateOpenMode";
static const wchar_t* MODULE_MODE_VALUE = L"ModuleOpenMode";

static std::wstring LoadOpenMode(const wchar_t* name, const wchar_t* fallback)
{
    wchar_t buf[16] = {};
    DWORD size = sizeof(buf);
    if (RegGetValueW(HKEY_CURRENT_USER, SETTINGS_KEY, name, RRF_RT_REG_SZ, NULL, buf, &size) == ERROR_SUCCESS &&
        (wcscmp(buf, L"edit") == 0 || wcscmp(buf, L"view") == 0))
        return buf;
    return fallback;
}

static void ApplyOpenModes()
{
    if (!g_webView) return;
    g_webView->mOpenTemplates = LoadOpenMode(TEMPLATE_MODE_VALUE, L"view");
    g_webView->mOpenModules = LoadOpenMode(MODULE_MODE_VALUE, L"edit");
}

static void SettingsApply(HWND hwnd)
{
    bool checked[kAssocCount];
    for (int i = 0; i < kAssocCount; i++)
        checked[i] = IsDlgButtonChecked(hwnd, IDC_SET_FIRST + i) == BST_CHECKED;
    std::vector<std::wstring> blocked = ApplyAssociations(checked);
    if (blocked.empty()) {
        MessageBoxW(hwnd, L"Ассоциации файлов обновлены.", APP_TITLE, MB_OK | MB_ICONINFORMATION);
        return;
    }
    std::wstring list;
    for (size_t i = 0; i < blocked.size(); i++) list += (i ? L", " : L"") + blocked[i];
    std::wstring text = L"Для " + list + L" Windows хранит выбор другой программы, и сменить его "
        L"можно только в параметрах Windows.\n\nОткрыть «Приложения по умолчанию» на BSLEdit?";
    if (MessageBoxW(hwnd, text.c_str(), APP_TITLE, MB_YESNO | MB_ICONINFORMATION) == IDYES)
        ShellExecuteW(hwnd, L"open", L"ms-settings:defaultapps?registeredAppUser=BSLEdit", NULL, NULL, SW_SHOWNORMAL);
}

/* The settings tab of the start window. Returns true when the command was one
 * of its controls. */
static bool SettingsCommand(HWND hwnd, WPARAM wParam, LPARAM lParam)
{
    switch (LOWORD(wParam)) {
    case IDC_SET_APPLY: SettingsApply(hwnd); return true;
    case IDC_SET_ALL:
    case IDC_SET_NONE:
        for (int i = 0; i < kAssocCount; i++)
            CheckDlgButton(hwnd, IDC_SET_FIRST + i, LOWORD(wParam) == IDC_SET_ALL ? BST_CHECKED : BST_UNCHECKED);
        return true;
    case IDC_SET_TEMPLATES:
    case IDC_SET_MODULES:
        if (HIWORD(wParam) == CBN_SELCHANGE) {
            // Takes effect with the next file the window opens.
            bool edit = SendMessageW((HWND)lParam, CB_GETCURSEL, 0, 0) == 1;
            SetHkcuNamedSz(SETTINGS_KEY, LOWORD(wParam) == IDC_SET_TEMPLATES ? TEMPLATE_MODE_VALUE : MODULE_MODE_VALUE,
                           edit ? L"edit" : L"view");
            ApplyOpenModes();
        }
        return true;
    case IDC_SET_CLOSE: DestroyWindow(hwnd); return true;
    }
    return false;
}

/* A font with the Windows icon glyphs: Segoe Fluent Icons on Windows 11,
 * Segoe MDL2 Assets on Windows 10. The code points are the same in both. */
static HFONT CreateIconFont(int height)
{
    const wchar_t* faces[] = { L"Segoe Fluent Icons", L"Segoe MDL2 Assets" };
    HDC dc = GetDC(NULL);
    HFONT result = NULL;
    for (const wchar_t* face : faces) {
        LOGFONTW lf = {};
        lf.lfHeight = height;
        lf.lfCharSet = DEFAULT_CHARSET;
        lf.lfQuality = CLEARTYPE_QUALITY;
        wcscpy_s(lf.lfFaceName, face);
        HFONT font = CreateFontIndirectW(&lf);
        HGDIOBJ old = SelectObject(dc, font);
        wchar_t got[LF_FACESIZE] = {};
        GetTextFaceW(dc, LF_FACESIZE, got);
        SelectObject(dc, old);
        if (_wcsicmp(got, face) == 0) { result = font; break; }
        DeleteObject(font);
    }
    ReleaseDC(NULL, dc);
    return result;
}

/* Builds the settings tab's controls below `top` in the start window. They
 * start hidden; the tab shows them. Returns the height the tab needs. */
static int CreateSettingsControls(HWND hwnd, int top, int clientW, int dpi, HFONT font, HFONT iconFont,
                                  bool dark, std::vector<HWND>& out)
{
    HINSTANCE inst = GetModuleHandleW(NULL);
    auto px = [dpi](int v) { return MulDiv(v, dpi, 96); };
    auto add = [&](const wchar_t* cls, const wchar_t* text, DWORD st, int x, int y, int cw, int ch, int id) {
        HWND c = CreateWindowExW(0, cls, text, WS_CHILD | st, x, y, cw, ch,
                                 hwnd, (HMENU)(INT_PTR)id, inst, NULL);
        SendMessageW(c, WM_SETFONT, (WPARAM)font, TRUE);
        out.push_back(c);
        return c;
    };
    const int cols = 4, rows = (kAssocCount + cols - 1) / cols;
    const int margin = px(16), rowH = px(24), btnH = px(28);
    const int colW = (clientW - margin * 2) / cols;
    const wchar_t* modeLabels[] = { L"Макеты открывать:", L"Модули открывать:" };
    const int modeIds[] = { IDC_SET_TEMPLATES, IDC_SET_MODULES };
    const bool modeEdit[] = { LoadOpenMode(TEMPLATE_MODE_VALUE, L"view") == L"edit",
                              LoadOpenMode(MODULE_MODE_VALUE, L"edit") == L"edit" };
    int y = top + margin;
    for (int m = 0; m < 2; m++) {
        add(L"STATIC", modeLabels[m], SS_CENTERIMAGE, margin, y, px(140), px(24), -1);
        HWND combo = add(L"COMBOBOX", L"", CBS_DROPDOWNLIST | WS_TABSTOP | WS_VSCROLL,
                         margin + px(144), y, px(200), px(120), modeIds[m]);
        if (dark) SetWindowTheme(combo, L"DarkMode_CFD", NULL);
        SendMessageW(combo, CB_ADDSTRING, 0, (LPARAM)L"в режиме просмотра");
        SendMessageW(combo, CB_ADDSTRING, 0, (LPARAM)L"в режиме редактирования");
        SendMessageW(combo, CB_SETCURSEL, modeEdit[m] ? 1 : 0, 0);
        y += px(30);
    }
    y += px(14);
    add(L"STATIC", L"Открывать в BSLEdit по умолчанию:", 0, margin, y, clientW - margin * 2, px(18), -1);
    y += px(22);
    for (int i = 0; i < kAssocCount; i++) {
        int col = i / rows, row = i % rows;
        HWND box = add(L"BUTTON", kAssocExts[i].ext, BS_AUTOCHECKBOX | WS_TABSTOP,
                       margin + col * colW, y + row * rowH, colW - px(8), rowH, IDC_SET_FIRST + i);
        // A themed check box ignores WM_CTLCOLORSTATIC and keeps black text.
        if (dark) SetWindowTheme(box, L"", L"");
        if (OpensInBslEdit(kAssocExts[i].ext)) CheckDlgButton(hwnd, IDC_SET_FIRST + i, BST_CHECKED);
    }
    y += rows * rowH + px(12);

    // «Все» and «Ни одного» are icons with a tooltip: as words they ran into
    // the wide apply button.
    const int iconW = px(32), applyW = px(190), closeW = px(90);
    struct { const wchar_t* glyph; const wchar_t* text; const wchar_t* tip; int id; } icons[] = {
        { L"", L"Все", L"Отметить все", IDC_SET_ALL },
        { L"", L"Ни одного", L"Снять все отметки", IDC_SET_NONE },
    };
    HWND tips = CreateWindowExW(WS_EX_TOPMOST, TOOLTIPS_CLASSW, NULL, WS_POPUP | TTS_ALWAYSTIP,
                                CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT, hwnd, NULL, inst, NULL);
    for (int i = 0; i < 2; i++) {
        HWND b = add(L"BUTTON", iconFont ? icons[i].glyph : icons[i].text, WS_TABSTOP,
                     margin + i * (iconW + px(6)), y, iconFont ? iconW : px(80), btnH, icons[i].id);
        if (iconFont) SendMessageW(b, WM_SETFONT, (WPARAM)iconFont, TRUE);
        if (dark) SetWindowTheme(b, L"DarkMode_Explorer", NULL);
        if (tips) {
            TTTOOLINFOW ti = {};
            ti.cbSize = TTTOOLINFOW_V2_SIZE;
            ti.uFlags = TTF_IDISHWND | TTF_SUBCLASS;
            ti.hwnd = hwnd;
            ti.uId = (UINT_PTR)b;
            ti.lpszText = (LPWSTR)icons[i].tip;
            SendMessageW(tips, TTM_ADDTOOLW, 0, (LPARAM)&ti);
        }
    }
    HWND apply = add(L"BUTTON", L"Назначить по умолчанию", WS_TABSTOP,
                     clientW - margin - closeW - px(8) - applyW, y, applyW, btnH, IDC_SET_APPLY);
    HWND close = add(L"BUTTON", L"Закрыть", WS_TABSTOP, clientW - margin - closeW, y, closeW, btnH, IDC_SET_CLOSE);
    if (dark) {
        SetWindowTheme(apply, L"DarkMode_Explorer", NULL);
        SetWindowTheme(close, L"DarkMode_Explorer", NULL);
    }
    return y + btnH + margin - top;
}

static void ShowStartWindow(HWND owner, bool settingsTab);

enum { IDM_FILE_OPEN = 40001, IDM_FILE_EXIT, IDM_SETTINGS };

static HMENU CreateMainMenu()
{
    HMENU file = CreatePopupMenu();
    AppendMenuW(file, MF_STRING, IDM_FILE_OPEN, L"&Открыть…");
    AppendMenuW(file, MF_SEPARATOR, 0, NULL);
    AppendMenuW(file, MF_STRING, IDM_FILE_EXIT, L"&Выход");
    HMENU bar = CreateMenu();
    AppendMenuW(bar, MF_POPUP, (UINT_PTR)file, L"&Файл");
    AppendMenuW(bar, MF_STRING, IDM_SETTINGS, L"&Настройки");
    return bar;
}

static void OnMainMenuCommand(HWND hwnd, UINT id)
{
    switch (id) {
    case IDM_FILE_OPEN: {
        // Another file opens in its own window, as a double-click would open it.
        std::wstring path = OpenFileDialog(hwnd);
        if (!path.empty()) {
            std::wstring args = L"\"" + path + L"\"";
            ShellExecuteW(hwnd, L"open", OwnExePath().c_str(), args.c_str(), NULL, SW_SHOWNORMAL);
        }
        break;
    }
    case IDM_FILE_EXIT: PostMessageW(hwnd, WM_CLOSE, 0, 0); break;
    case IDM_SETTINGS: ShowStartWindow(hwnd, true); break;
    }
}

static bool SystemUsesDarkTheme()
{
    HKEY hKey;
    if (RegOpenKeyExW(HKEY_CURRENT_USER,
                      L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                      0, KEY_READ, &hKey) != ERROR_SUCCESS)
        return false;

    DWORD val = 1, sz = sizeof(val), type = 0;
    bool dark = false;
    if (RegQueryValueExW(hKey, L"AppsUseLightTheme", NULL, &type, (BYTE*)&val, &sz) == ERROR_SUCCESS && type == REG_DWORD)
        dark = (val == 0);
    RegCloseKey(hKey);
    return dark;
}

/* Recently opened files and the configuration dumps they belong to, kept per
 * user as REG_MULTI_SZ values next to the window placement. A start without a
 * file shows them as links instead of going straight to the file dialog. */
static const wchar_t* RECENT_VALUE = L"RecentFiles";
static const wchar_t* PINNED_VALUE = L"PinnedConfigurations";
static const size_t MAX_RECENT = 12;
static const size_t MAX_PINNED = 8;

static std::vector<std::wstring> LoadPathList(const wchar_t* value)
{
    std::vector<std::wstring> list;
    DWORD size = 0;
    if (RegGetValueW(HKEY_CURRENT_USER, SETTINGS_KEY, value, RRF_RT_REG_MULTI_SZ, NULL, NULL, &size)
            != ERROR_SUCCESS || size == 0)
        return list;
    std::wstring buf(size / sizeof(wchar_t) + 2, L'\0');
    if (RegGetValueW(HKEY_CURRENT_USER, SETTINGS_KEY, value, RRF_RT_REG_MULTI_SZ, NULL, &buf[0], &size)
            != ERROR_SUCCESS)
        return list;
    for (const wchar_t* p = buf.c_str(); *p; p += wcslen(p) + 1)
        list.push_back(p);
    return list;
}

static void SavePathList(const wchar_t* value, const std::vector<std::wstring>& list)
{
    std::wstring data;
    for (const std::wstring& item : list) { data += item; data.push_back(L'\0'); }
    data.push_back(L'\0');
    HKEY hKey = NULL;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, SETTINGS_KEY, 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL) != ERROR_SUCCESS)
        return;
    RegSetValueExW(hKey, value, 0, REG_MULTI_SZ, (const BYTE*)data.data(),
                   (DWORD)(data.size() * sizeof(wchar_t)));
    RegCloseKey(hKey);
}

static void PushRecentPath(const wchar_t* value, const std::wstring& path, size_t limit)
{
    std::vector<std::wstring> list = LoadPathList(value);
    for (size_t i = 0; i < list.size();) {
        if (_wcsicmp(list[i].c_str(), path.c_str()) == 0) list.erase(list.begin() + i);
        else ++i;
    }
    list.insert(list.begin(), path);
    if (list.size() > limit) list.resize(limit);
    SavePathList(value, list);
}

static bool FileExists(const std::wstring& path)
{
    DWORD attrs = GetFileAttributesW(path.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}

// The Configuration.xml of the dump the file lies in, or empty.
static std::wstring FindConfigurationRoot(const std::wstring& path)
{
    std::wstring dir = path;
    for (int depth = 0; depth < 16; ++depth) {
        size_t slash = dir.find_last_of(L"\\/");
        if (slash == std::wstring::npos || slash < 2) break;
        dir.resize(slash);
        std::wstring candidate = dir + L"\\Configuration.xml";
        if (FileExists(candidate)) return candidate;
    }
    return std::wstring();
}

static std::vector<std::wstring> SplitPath(const std::wstring& path)
{
    std::vector<std::wstring> parts;
    std::wstring part;
    for (wchar_t ch : path) {
        if (ch == L'\\' || ch == L'/') { if (!part.empty()) parts.push_back(part); part.clear(); }
        else part.push_back(ch);
    }
    if (!part.empty()) parts.push_back(part);
    return parts;
}

/* "<Project> <dump>": the project is the folder above src, the dump is the
 * folder holding Configuration.xml - <Project>\src\cfe\<Extension> gives
 * "AT РасширениеКонфигурации". The main dump (cf, or a folder right under
 * src) reads "Основная конфигурация". */
static std::wstring ConfigurationDisplayName(const std::wstring& configurationXml)
{
    std::vector<std::wstring> parts = SplitPath(configurationXml);
    if (!parts.empty()) parts.pop_back();   // Configuration.xml
    if (parts.empty()) return configurationXml;
    const std::wstring& dump = parts.back();
    for (size_t i = parts.size(); i-- > 1;) {
        if (_wcsicmp(parts[i].c_str(), L"src") != 0) continue;
        bool main = _wcsicmp(dump.c_str(), L"cf") == 0 || i + 2 == parts.size();
        return parts[i - 1] + L" " + (main ? std::wstring(L"Основная конфигурация") : dump);
    }
    return _wcsicmp(dump.c_str(), L"cf") == 0 && parts.size() > 1
        ? parts[parts.size() - 2] + L" Основная конфигурация" : dump;
}

/* Every template file is called Template.xml, so the recent list names it by
 * its owner: Owner\Templates\Name\Ext\Template.xml reads "Owner - СКД" for a
 * data composition schema and "Owner - Name" for any other template. */
static bool FileStartsWithDcs(const std::wstring& path)
{
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return false;
    char head[4096];
    DWORD got = 0;
    BOOL ok = ReadFile(file, head, sizeof(head), &got, NULL);
    CloseHandle(file);
    return ok && std::string(head, got).find("DataCompositionSchema") != std::string::npos;
}

static std::wstring TemplateDisplayName(const std::wstring& path)
{
    std::vector<std::wstring> parts = SplitPath(path);
    size_t n = parts.size();
    if (n < 5 || _wcsicmp(parts[n - 1].c_str(), L"Template.xml") != 0
        || _wcsicmp(parts[n - 2].c_str(), L"Ext") != 0
        || _wcsicmp(parts[n - 4].c_str(), L"Templates") != 0) return std::wstring();
    return parts[n - 5] + L" - " + (FileStartsWithDcs(path) ? std::wstring(L"СКД") : parts[n - 3]);
}

static void RememberOpenedFile(const std::wstring& path)
{
    if (path.empty()) return;
    PushRecentPath(RECENT_VALUE, path, MAX_RECENT);
    std::wstring root = FindConfigurationRoot(path);
    if (!root.empty()) PushRecentPath(PINNED_VALUE, root, MAX_PINNED);
}

struct StartRow {
    enum Kind { Header, Link, Action, Clear } kind;
    std::wstring text;    // link or header text
    std::wstring note;    // grey text after the link
    std::wstring path;    // what the link opens
    const wchar_t* list = nullptr;   // the history list the link comes from: it can be removed
    bool clipped = false; // the last paint cut the text or the note: the tooltip shows the path
};

/* The start window has two tabs: the history and the settings. The history is
 * painted by the window itself; the settings are ordinary child controls that
 * are shown only on their tab. */
struct StartState {
    std::vector<StartRow> rows;
    int hot = -1;          // row under the mouse or picked by the keyboard
    int rowHeight = 26;
    int margin = 16;
    int tabHeight = 34;    // the tab strip on top
    int tabWidth = 110;
    int tab = 0;           // 0 — history, 1 — settings
    int settingsHeight = 0;
    bool dark = false;
    HFONT font = NULL, bold = NULL, controlFont = NULL, iconFont = NULL;
    HBRUSH background = NULL;
    HWND tip = NULL;       // the full path of a history row that does not fit
    std::vector<HWND> settings;
    std::wstring chosen;
    bool done = false;
};
static StartState* g_start = NULL;

static const wchar_t* kStartTabs[] = { L"История", L"Настройки" };

static int StartRowAt(int y)
{
    y -= g_start->tabHeight;
    int index = (y - g_start->margin) / g_start->rowHeight;
    if (g_start->tab != 0 || y < g_start->margin || index < 0 || index >= (int)g_start->rows.size()) return -1;
    return g_start->rows[index].kind == StartRow::Header ? -1 : index;
}

static int StartTabAt(int x, int y)
{
    if (y < 0 || y >= g_start->tabHeight || x < g_start->margin) return -1;
    int index = (x - g_start->margin) / g_start->tabWidth;
    return index < 2 ? index : -1;
}

/* Pinned configurations on top, then the recent files, then the actions. */
static void BuildStartRows(StartState& state)
{
    state.rows.clear();
    std::vector<std::wstring> pinned = LoadPathList(PINNED_VALUE);
    std::vector<std::wstring> recent = LoadPathList(RECENT_VALUE);
    bool header = false, any = false;
    for (const std::wstring& path : pinned) {
        if (!FileExists(path)) continue;
        if (!header) { state.rows.push_back({ StartRow::Header, L"Конфигурации" }); header = true; }
        std::wstring dir = path.substr(0, path.find_last_of(L"\\/"));
        state.rows.push_back({ StartRow::Link, ConfigurationDisplayName(path), dir, path, PINNED_VALUE });
        any = true;
    }
    header = false;
    for (const std::wstring& path : recent) {
        if (!FileExists(path)) continue;
        if (!header) { state.rows.push_back({ StartRow::Header, L"Недавние файлы" }); header = true; }
        // Inside a dump the path from its root says more than Form.xml does.
        std::wstring root = FindConfigurationRoot(path);
        std::wstring text, note;
        if (!root.empty() && _wcsicmp(root.c_str(), path.c_str()) != 0) {
            size_t rootDir = root.find_last_of(L"\\/");
            text = path.substr(rootDir + 1);
            note = ConfigurationDisplayName(root);
        } else {
            size_t slash = path.find_last_of(L"\\/");
            text = slash == std::wstring::npos ? path : path.substr(slash + 1);
            note = slash == std::wstring::npos ? std::wstring() : path.substr(0, slash);
        }
        std::wstring templateName = TemplateDisplayName(path);
        if (!templateName.empty()) text = templateName;
        state.rows.push_back({ StartRow::Link, text, note, path, RECENT_VALUE });
        any = true;
    }
    if (state.rows.empty())
        state.rows.push_back({ StartRow::Header, L"Недавних файлов пока нет" });
    state.rows.push_back({ StartRow::Header, L"" });
    state.rows.push_back({ StartRow::Action, L"Открыть другой файл…" });
    if (any) state.rows.push_back({ StartRow::Clear, L"Очистить историю" });
}

// The client height that holds both tabs, so switching them does not jump.
static int StartClientHeight(const StartState& state)
{
    int history = state.margin * 2 + (int)state.rows.size() * state.rowHeight;
    return state.tabHeight + (history > state.settingsHeight ? history : state.settingsHeight);
}

static void StartFitWindow(HWND hwnd)
{
    RECT rc = { 0, 0, 0, StartClientHeight(*g_start) };
    RECT client; GetClientRect(hwnd, &client);
    rc.right = client.right;
    AdjustWindowRectEx(&rc, (DWORD)GetWindowLongPtrW(hwnd, GWL_STYLE), FALSE,
                       (DWORD)GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
    SetWindowPos(hwnd, NULL, 0, 0, rc.right - rc.left, rc.bottom - rc.top,
                 SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    InvalidateRect(hwnd, NULL, TRUE);
}

static void StartSetTab(HWND hwnd, int tab)
{
    if (tab < 0 || tab > 1) return;
    g_start->tab = tab;
    g_start->hot = -1;
    for (HWND c : g_start->settings) ShowWindow(c, tab == 1 ? SW_SHOWNA : SW_HIDE);
    if (tab == 1) {
        HWND first = GetNextDlgTabItem(hwnd, NULL, FALSE);
        SetFocus(first ? first : hwnd);
    } else {
        SetFocus(hwnd);
    }
    InvalidateRect(hwnd, NULL, TRUE);
}

// The cross at the right end of a removable row.
static bool StartOnRemove(HWND hwnd, int index, int x)
{
    if (index < 0 || !g_start->rows[index].list) return false;
    RECT client; GetClientRect(hwnd, &client);
    return x >= client.right - g_start->margin - g_start->rowHeight;
}

static void StartRemove(HWND hwnd, int index)
{
    if (index < 0 || !g_start->rows[index].list) return;
    const StartRow& row = g_start->rows[index];
    std::vector<std::wstring> list = LoadPathList(row.list);
    for (size_t i = 0; i < list.size(); ++i)
        if (_wcsicmp(list[i].c_str(), row.path.c_str()) == 0) { list.erase(list.begin() + i); break; }
    SavePathList(row.list, list);
    BuildStartRows(*g_start);
    if (g_start->hot >= (int)g_start->rows.size() || (g_start->hot >= 0 &&
        g_start->rows[g_start->hot].kind == StartRow::Header))
        g_start->hot = -1;
    StartFitWindow(hwnd);
}

static void StartActivate(HWND hwnd, int index)
{
    if (index < 0) return;
    const StartRow& row = g_start->rows[index];
    if (row.kind == StartRow::Clear) {
        if (MessageBoxW(hwnd, L"Очистить список недавних файлов и конфигураций?", APP_TITLE,
                        MB_YESNO | MB_ICONQUESTION) != IDYES) return;
        SavePathList(RECENT_VALUE, std::vector<std::wstring>());
        SavePathList(PINNED_VALUE, std::vector<std::wstring>());
        BuildStartRows(*g_start);
        g_start->hot = -1;
        StartFitWindow(hwnd);
        return;
    }
    if (row.kind == StartRow::Action) {
        std::wstring path = OpenFileDialog(hwnd);
        if (path.empty()) return;
        g_start->chosen = path;
    } else {
        g_start->chosen = row.path;
    }
    DestroyWindow(hwnd);
}

/* One tool over the row under the mouse. An empty text keeps the tooltip
 * hidden, so a row that fits shows nothing. */
static void StartUpdateTip(HWND hwnd)
{
    if (!g_start->tip) return;
    TTTOOLINFOW ti = {};
    ti.cbSize = TTTOOLINFOW_V2_SIZE;
    ti.hwnd = hwnd;
    ti.uId = 1;
    int i = g_start->hot;
    const StartRow* row = i >= 0 && i < (int)g_start->rows.size() ? &g_start->rows[i] : nullptr;
    const bool show = row && row->clipped && !row->path.empty();
    RECT client; GetClientRect(hwnd, &client);
    int top = g_start->tabHeight + g_start->margin + (i < 0 ? 0 : i) * g_start->rowHeight;
    ti.rect = { 0, top, client.right, top + g_start->rowHeight };
    SendMessageW(g_start->tip, TTM_NEWTOOLRECTW, 0, (LPARAM)&ti);
    ti.lpszText = (LPWSTR)(show ? row->path.c_str() : L"");
    SendMessageW(g_start->tip, TTM_UPDATETIPTEXTW, 0, (LPARAM)&ti);
    if (!show) SendMessageW(g_start->tip, TTM_POP, 0, 0);
}

static void StartMoveHot(HWND hwnd, int step)
{
    int count = (int)g_start->rows.size();
    int i = g_start->hot;
    for (int n = 0; n < count; ++n) {
        i = (i + step + count) % count;
        if (g_start->rows[i].kind != StartRow::Header) break;
    }
    g_start->hot = i;
    InvalidateRect(hwnd, NULL, TRUE);
}

static void StartPaintTabs(HDC dc, const RECT& client)
{
    const bool dark = g_start->dark;
    const COLORREF text = dark ? RGB(230, 230, 230) : RGB(30, 30, 30);
    const COLORREF grey = dark ? RGB(150, 150, 150) : RGB(110, 110, 110);
    const COLORREF accent = dark ? RGB(110, 170, 255) : RGB(0, 102, 204);
    const COLORREF line = dark ? RGB(60, 60, 60) : RGB(220, 220, 220);
    RECT base = { 0, g_start->tabHeight - 1, client.right, g_start->tabHeight };
    HBRUSH brush = CreateSolidBrush(line);
    FillRect(dc, &base, brush);
    DeleteObject(brush);
    for (int i = 0; i < 2; ++i) {
        RECT r = { g_start->margin + i * g_start->tabWidth, 0,
                   g_start->margin + (i + 1) * g_start->tabWidth, g_start->tabHeight };
        bool active = i == g_start->tab;
        SelectObject(dc, active ? g_start->bold : g_start->font);
        SetTextColor(dc, active ? text : grey);
        DrawTextW(dc, kStartTabs[i], -1, &r, DT_SINGLELINE | DT_VCENTER | DT_CENTER | DT_NOPREFIX);
        if (active) {
            RECT u = { r.left + 8, g_start->tabHeight - 3, r.right - 8, g_start->tabHeight };
            HBRUSH mark = CreateSolidBrush(accent);
            FillRect(dc, &u, mark);
            DeleteObject(mark);
        }
    }
}

static LRESULT CALLBACK StartWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    switch (msg) {
    case WM_ERASEBKGND:
        {
            RECT rc; GetClientRect(hwnd, &rc);
            FillRect((HDC)wParam, &rc, g_start->background);
        }
        return 1;

    case WM_CTLCOLORSTATIC:
    case WM_CTLCOLORBTN:
    case WM_CTLCOLOREDIT:
    case WM_CTLCOLORLISTBOX:
        {
            HDC dc = (HDC)wParam;
            SetTextColor(dc, g_start->dark ? RGB(230, 230, 230) : GetSysColor(COLOR_WINDOWTEXT));
            SetBkColor(dc, g_start->dark ? RGB(32, 32, 32) : RGB(255, 255, 255));
            return (LRESULT)g_start->background;
        }

    case WM_PAINT:
        {
            PAINTSTRUCT ps;
            HDC dc = BeginPaint(hwnd, &ps);
            RECT client; GetClientRect(hwnd, &client);
            SetBkMode(dc, TRANSPARENT);
            StartPaintTabs(dc, client);
            if (g_start->tab != 0) { EndPaint(hwnd, &ps); return 0; }
            const bool dark = g_start->dark;
            const COLORREF link = dark ? RGB(110, 170, 255) : RGB(0, 102, 204);
            const COLORREF grey = dark ? RGB(150, 150, 150) : RGB(110, 110, 110);
            const COLORREF head = dark ? RGB(230, 230, 230) : RGB(30, 30, 30);
            const int top = g_start->tabHeight + g_start->margin;
            for (size_t i = 0; i < g_start->rows.size(); ++i) {
                StartRow& row = g_start->rows[i];
                row.clipped = false;
                RECT r = { g_start->margin, top + (int)i * g_start->rowHeight,
                           client.right - g_start->margin, top + (int)(i + 1) * g_start->rowHeight };
                if ((int)i == g_start->hot) {
                    HBRUSH brush = CreateSolidBrush(dark ? RGB(50, 55, 65) : RGB(232, 240, 252));
                    RECT h = { r.left - 6, r.top, r.right + 6, r.bottom };
                    FillRect(dc, &h, brush);
                    DeleteObject(brush);
                }
                SelectObject(dc, row.kind == StartRow::Header ? g_start->bold : g_start->font);
                SetTextColor(dc, row.kind == StartRow::Header ? head : link);
                RECT t = r;
                if (row.kind != StartRow::Header) t.left += 8;
                if (row.list) {
                    // Room for the cross, shown on the row under the mouse.
                    t.right -= g_start->rowHeight;
                    if ((int)i == g_start->hot) {
                        RECT x = { r.right - g_start->rowHeight, r.top, r.right, r.bottom };
                        SetTextColor(dc, dark ? RGB(240, 90, 90) : RGB(210, 40, 40));
                        DrawTextW(dc, L"✕", -1, &x, DT_SINGLELINE | DT_VCENTER | DT_CENTER | DT_NOPREFIX);
                        SetTextColor(dc, link);
                    }
                }
                DrawTextW(dc, row.text.c_str(), -1, &t,
                          DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX | DT_END_ELLIPSIS);
                RECT m = t;
                DrawTextW(dc, row.text.c_str(), -1, &m, DT_SINGLELINE | DT_NOPREFIX | DT_CALCRECT);
                if (m.right > t.right) row.clipped = true;
                if (!row.note.empty()) {
                    RECT n = { m.right + 12, r.top, t.right, r.bottom };
                    SelectObject(dc, g_start->font);
                    RECT need = n;
                    DrawTextW(dc, row.note.c_str(), -1, &need, DT_SINGLELINE | DT_NOPREFIX | DT_CALCRECT);
                    if (n.left >= n.right || need.right > n.right) row.clipped = true;
                    if (n.left < n.right) {
                        SetTextColor(dc, grey);
                        DrawTextW(dc, row.note.c_str(), -1, &n,
                                  DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX | DT_PATH_ELLIPSIS);
                    }
                }
            }
            EndPaint(hwnd, &ps);
        }
        return 0;

    case WM_MOUSEMOVE:
        {
            int index = StartRowAt((short)HIWORD(lParam));
            if (index != g_start->hot) {
                g_start->hot = index;
                InvalidateRect(hwnd, NULL, TRUE);
                UpdateWindow(hwnd);   // `clipped` comes from the paint
                StartUpdateTip(hwnd);
            }
        }
        return 0;

    case WM_SETCURSOR:
        if ((HWND)wParam == hwnd && LOWORD(lParam) == HTCLIENT) {
            POINT pt; GetCursorPos(&pt); ScreenToClient(hwnd, &pt);
            int tab = StartTabAt(pt.x, pt.y);
            bool hand = StartRowAt(pt.y) >= 0 || (tab >= 0 && tab != g_start->tab);
            SetCursor(LoadCursorW(NULL, hand ? MAKEINTRESOURCEW(32649) : MAKEINTRESOURCEW(32512)));
            return TRUE;
        }
        break;

    case WM_LBUTTONUP:
        {
            int x = (short)LOWORD(lParam), y = (short)HIWORD(lParam);
            int tab = StartTabAt(x, y);
            if (tab >= 0) { if (tab != g_start->tab) StartSetTab(hwnd, tab); return 0; }
            int index = StartRowAt(y);
            if (StartOnRemove(hwnd, index, x)) StartRemove(hwnd, index);
            else StartActivate(hwnd, index);
        }
        return 0;

    case WM_KEYDOWN:
        if (wParam == VK_ESCAPE) DestroyWindow(hwnd);
        else if (g_start->tab != 0) return 0;
        else if (wParam == VK_DELETE) StartRemove(hwnd, g_start->hot);
        else if (wParam == VK_DOWN) StartMoveHot(hwnd, 1);
        else if (wParam == VK_UP) StartMoveHot(hwnd, -1);
        else if (wParam == VK_RETURN) StartActivate(hwnd, g_start->hot);
        return 0;

    case WM_COMMAND:
        if (LOWORD(wParam) == IDCANCEL) { DestroyWindow(hwnd); return 0; }
        if (SettingsCommand(hwnd, wParam, lParam)) return 0;
        break;

    case WM_CLOSE:
        DestroyWindow(hwnd);
        return 0;

    case WM_DESTROY:
        g_start->done = true;
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

/* The start window: the history tab (pinned configurations, recent files and
 * a link to the file dialog) and the settings tab. Without an owner it is the
 * window BSLEdit starts with; with one it is modal to that editor window.
 * Returns the chosen path, or empty on close. */
static std::wstring RunStartWindow(HWND owner, bool settingsTab)
{
    if (g_start) return std::wstring();
    HINSTANCE hInstance = GetModuleHandleW(NULL);
    StartState state;
    state.dark = SystemUsesDarkTheme();
    BuildStartRows(state);

    int dpi = owner ? (int)GetDpiForWindow(owner) : 0;
    if (!dpi) {
        HDC screen = GetDC(NULL);
        dpi = GetDeviceCaps(screen, LOGPIXELSY);
        ReleaseDC(NULL, screen);
    }
    NONCLIENTMETRICSW metrics = {};
    metrics.cbSize = sizeof(metrics);
    SystemParametersInfoW(SPI_GETNONCLIENTMETRICS, sizeof(metrics), &metrics, 0);
    LOGFONTW lf = metrics.lfMessageFont;
    lf.lfHeight = -MulDiv(10, dpi, 72);
    state.font = CreateFontIndirectW(&lf);
    lf.lfWeight = FW_SEMIBOLD;
    state.bold = CreateFontIndirectW(&lf);
    lf = metrics.lfMessageFont;
    lf.lfHeight = -MulDiv(9, dpi, 72);
    state.controlFont = CreateFontIndirectW(&lf);
    state.iconFont = CreateIconFont(-MulDiv(12, dpi, 72));
    state.background = CreateSolidBrush(state.dark ? RGB(32, 32, 32) : RGB(255, 255, 255));
    state.rowHeight = MulDiv(26, dpi, 96);
    state.margin = MulDiv(16, dpi, 96);
    state.tabHeight = MulDiv(34, dpi, 96);
    state.tabWidth = MulDiv(110, dpi, 96);
    g_start = &state;

    static bool registered = false;
    if (!registered) {
        WNDCLASSEXW wc = {};
        wc.cbSize = sizeof(wc);
        wc.lpfnWndProc = StartWndProc;
        wc.hInstance = hInstance;
        wc.hCursor = LoadCursorW(NULL, MAKEINTRESOURCEW(32512));   // IDC_ARROW
        wc.lpszClassName = L"BSLEditStartWnd";
        wc.hIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(IDI_APP_ICON));
        wc.hIconSm = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(IDI_APP_ICON),
                                        IMAGE_ICON, 16, 16, LR_DEFAULTCOLOR);
        registered = RegisterClassExW(&wc) != 0;
    }

    const DWORD style = owner ? (WS_POPUP | WS_CAPTION | WS_SYSMENU)
                              : (WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX);
    const DWORD exStyle = owner ? WS_EX_DLGMODALFRAME : 0;
    const int clientW = MulDiv(640, dpi, 96);
    HWND hwnd = CreateWindowExW(exStyle, L"BSLEditStartWnd", APP_TITLE, style,
                                0, 0, clientW, clientW, owner, NULL, hInstance, NULL);
    if (hwnd) {
        state.settingsHeight = CreateSettingsControls(hwnd, state.tabHeight, clientW, dpi, state.controlFont,
                                                      state.iconFont, state.dark, state.settings);
        state.tip = CreateWindowExW(WS_EX_TOPMOST, TOOLTIPS_CLASSW, NULL, WS_POPUP | TTS_ALWAYSTIP | TTS_NOPREFIX,
                                    CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT,
                                    hwnd, NULL, hInstance, NULL);
        if (state.tip) {
            TTTOOLINFOW ti = {};
            ti.cbSize = TTTOOLINFOW_V2_SIZE;
            ti.uFlags = TTF_SUBCLASS;
            ti.hwnd = hwnd;
            ti.uId = 1;
            ti.lpszText = (LPWSTR)L"";
            SendMessageW(state.tip, TTM_ADDTOOLW, 0, (LPARAM)&ti);
            SendMessageW(state.tip, TTM_SETMAXTIPWIDTH, 0, clientW);
        }
        RECT rc = { 0, 0, clientW, StartClientHeight(state) };
        AdjustWindowRectEx(&rc, style, FALSE, exStyle);
        int width = rc.right - rc.left, height = rc.bottom - rc.top;
        RECT area;
        if (owner) GetWindowRect(owner, &area);
        else SystemParametersInfoW(SPI_GETWORKAREA, 0, &area, 0);
        SetWindowPos(hwnd, NULL, area.left + (area.right - area.left - width) / 2,
                     area.top + (area.bottom - area.top - height) / 2, width, height,
                     SWP_NOZORDER | SWP_NOACTIVATE);
        if (owner) EnableWindow(owner, FALSE);
        ShowWindow(hwnd, SW_SHOWNORMAL);
        SetForegroundWindow(hwnd);
        StartSetTab(hwnd, settingsTab ? 1 : 0);
        MSG msg = {};
        while (!state.done && GetMessageW(&msg, NULL, 0, 0)) {
            // Ctrl+Tab switches the tabs from anywhere in the window.
            if (msg.message == WM_KEYDOWN && msg.wParam == VK_TAB && (GetKeyState(VK_CONTROL) & 0x8000)) {
                StartSetTab(hwnd, 1 - state.tab);
                continue;
            }
            // The settings tab moves the focus with Tab and closes on Esc.
            if (state.tab == 1 && IsDialogMessageW(hwnd, &msg)) continue;
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        if (owner) {
            EnableWindow(owner, TRUE);
            SetForegroundWindow(owner);
        }
        // WM_QUIT pulled by the loop above belongs to the main loop.
        if (!state.done) PostQuitMessage((int)msg.wParam);
    }
    g_start = NULL;
    DeleteObject(state.font);
    DeleteObject(state.bold);
    DeleteObject(state.controlFont);
    if (state.iconFont) DeleteObject(state.iconFont);
    DeleteObject(state.background);
    return state.chosen;
}

static std::wstring ChooseStartFile(HINSTANCE)
{
    return RunStartWindow(NULL, false);
}

/* From the editor's menu: a file picked in the history opens in its own
 * window, as «Открыть…» does. */
static void ShowStartWindow(HWND owner, bool settingsTab)
{
    std::wstring path = RunStartWindow(owner, settingsTab);
    if (path.empty()) return;
    std::wstring args = L"\"" + path + L"\"";
    ShellExecuteW(owner, L"open", OwnExePath().c_str(), args.c_str(), NULL, SW_SHOWNORMAL);
}

// "BSL Editor - <full path>": the window names the file on disk, as Total
// Commander's Lister does. Every form is an Ext/Form.xml, so the bare file
// name alone would not tell them apart. A document with changes that are not
// on disk yet carries a star after its name, the way 1C marks one.
static std::wstring WindowTitleFor(const std::wstring& filePath, bool dirty)
{
    return std::wstring(APP_TITLE) + L" - " + filePath + (dirty ? L" *" : L"");
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE, LPWSTR, int nCmdShow)
{
    OleInitialize(NULL);

    std::wstring filePath = GetFileFromCmdLine();
    if (filePath == L"--register-protocol") {
        g_registrationAllowed = DecideRegistration(true);
        RegisterUrlProtocol();
        RecordRegistration(true);
        OleUninitialize();
        return 0;
    }
    // --ensure-protocol: зарегистрировать только если регистрация свободна,
    // битая или уже наша. Для скриптов, которым нужна рабочая ссылка bsledit:.
    if (filePath == L"--ensure-protocol") {
        g_registrationAllowed = DecideRegistration(false);
        RegisterUrlProtocol();
        if (g_registrationAllowed) RecordRegistration(false);
        OleUninitialize();
        return 0;
    }
    if (filePath == L"--unregister") {
        UnregisterAll();
        OleUninitialize();
        return 0;
    }

    // Getting Chromium up is the slowest part of startup, so start it before
    // touching the registry, the file dialog or the disk. Nothing is parked:
    // a single-window app has no second open to speed up.
    CWebView2Host::SetStandalone(true);
    // The interface is linked into this executable; the first run of a build
    // unpacks it into a per-user cache. A web\ directory beside the binary,
    // or %BSLVIEW_WEB_ROOT%, still wins - see ResolveWebRoot.
    std::wstring webRootError;
    const std::wstring webRoot = ResolveWebRoot(GetModuleHandleW(NULL), &webRootError);
    if (!webRoot.empty()) CWebView2Host::WarmUp(webRoot, false);

    g_registrationAllowed = !g_suppressRegistration && DecideRegistration(false);
    RegisterFileAssociation();
    RegisterContainerOpenWith();
    RegisterUrlProtocol();
    if (g_registrationAllowed) RecordRegistration(false);

    if (filePath.empty()) {
        filePath = ChooseStartFile(hInstance);
        if (filePath.empty()) return 0;
    }

    std::wstring configuration = FindConfigurationForDumpInfo(filePath.c_str());
    if (!configuration.empty()) filePath = configuration;

    // Forms/<FormName>.xml is just the form's descriptor; the actual layout
    // one would otherwise have to dig for lives at Forms/<FormName>/Ext/Form.xml.
    std::wstring formLayout = FindFormLayoutForMeta(filePath.c_str());
    if (!formLayout.empty()) filePath = formLayout;
    // Ext/Form/Module.bsl opens the whole form too, on its module tab.
    std::wstring moduleForm = FindFormLayoutForModule(filePath.c_str());
    bool openFormModule = !moduleForm.empty();
    if (openFormModule) filePath = moduleForm;

    // An external data processor or report opens on its unpacking panel.
    bool epfFile = epf::IsEpfPath(filePath);
    TextFile file = epfFile ? TextFile() : ReadTextFile(filePath.c_str(), MAX_FILE_BYTES);
    if (epfFile) file.ok = GetFileAttributesW(filePath.c_str()) != INVALID_FILE_ATTRIBUTES;
    if (!file.ok) {
        MessageBoxW(NULL, L"Не удалось прочитать файл (отсутствует, недоступен или слишком большой).",
                    APP_TITLE, MB_OK | MB_ICONERROR);
        return 1;
    }

    RememberOpenedFile(filePath);

    if (webRoot.empty()) {
        MessageBoxW(NULL,
            (L"Не удалось подготовить интерфейс BSLEdit.\n\n" + webRootError +
             L".\n\nИнтерфейс распаковывается в %LOCALAPPDATA%\\BSLView; "
             L"проверьте права на эту папку и свободное место на диске.").c_str(),
            APP_TITLE, MB_OK | MB_ICONERROR);
        return 1;
    }

    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.hCursor = LoadCursorW(NULL, MAKEINTRESOURCEW(32512));   // IDC_ARROW
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = WNDCLASS_NAME;
    wc.hIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(IDI_APP_ICON));
    wc.hIconSm = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(IDI_APP_ICON),
                                    IMAGE_ICON, 16, 16, LR_DEFAULTCOLOR);
    RegisterClassExW(&wc);

    std::wstring title = WindowTitleFor(filePath, false);

    HWND hwnd = CreateWindowExW(0, WNDCLASS_NAME, title.c_str(),
                                WS_OVERLAPPEDWINDOW,
                                CW_USEDEFAULT, CW_USEDEFAULT, 1200, 800,
                                NULL, CreateMainMenu(), hInstance, NULL);
    if (!hwnd) {
        MessageBoxW(NULL, L"Failed to create window.", APP_TITLE, MB_OK | MB_ICONERROR);
        return 1;
    }

    WINDOWPLACEMENT placement = {};
    if (LoadWindowPlacement(placement)) {
        /* A shortcut or caller asking for a minimized start still gets it;
         * otherwise the window comes back as it was left, maximized or not. */
        if (nCmdShow == SW_SHOWMINIMIZED || nCmdShow == SW_MINIMIZE || nCmdShow == SW_SHOWMINNOACTIVE)
            placement.showCmd = nCmdShow;
        else if (placement.showCmd != SW_SHOWMAXIMIZED)
            placement.showCmd = SW_SHOWNORMAL;
        placement.flags = 0;
        SetWindowPlacement(hwnd, &placement);
    } else {
        ShowWindow(hwnd, nCmdShow);
    }
    UpdateWindow(hwnd);

    // Published for the document the window currently shows; Windows releases
    // it when the process ends, including a crash, so no marker outlives the
    // editor.
    BSLEditOpenMarker openMarker;   // nothing is held until something is edited

    g_webView = CWebView2Host::Acquire(hwnd, webRoot);
    g_webView->mFilePath = filePath;
    /* Called on the UI thread whenever the window opens another file. The new
     * document starts clean, so whatever the previous one held is dropped. */
    g_webView->mOnFileOpened = [hwnd, &openMarker](const std::wstring& path) {
        openMarker.Hold(std::wstring(), std::wstring());
        RememberOpenedFile(path);
        SetWindowTextW(hwnd, WindowTitleFor(path, g_webView->mDirty).c_str());
    };
    /* The star follows the document, so an edit, a save and an undo back to
     * the saved text all show in the title - and so does the marker: the
     * files with unsaved changes are exactly the ones an agent must not
     * write. */
    g_webView->mOnDirtyChanged = [hwnd, &openMarker](bool dirty) {
        openMarker.Hold(g_webView->mDirtyFile ? g_webView->mFilePath : std::wstring(),
                        g_webView->mDirtyModule ? g_webView->mFormModulePath : std::wstring());
        SetWindowTextW(hwnd, WindowTitleFor(g_webView->mFilePath, dirty).c_str());
    };
    /* Posted, not called: the settings window runs its own modal loop, and
     * WebView2 must not be re-entered from inside its message callback. */
    ApplyOpenModes();
    g_webView->mOnOpenSettings = [hwnd]() { PostMessageW(hwnd, WM_COMMAND, IDM_SETTINGS, 0); };
    g_webView->mEncoding = file.encoding;
    g_webView->mFileRevision = file.revision;

    BslLoadRequest req;
    req.content  = file.text;
    req.language = MonacoLanguageForPath(filePath.c_str());
    req.dark     = SystemUsesDarkTheme();
    req.fontSize = 14;
    req.readOnly = false;   // standalone editor opens ready to edit
    req.openFormModule = openFormModule;
    req.initialLine = g_initialLine;
    req.initialSearch = g_initialSearch;
    req.initialRegexp = g_initialRegexp;
    req.initialMatchCase = g_initialMatchCase;
    req.previewSession = g_previewSession;
    if (epfFile) g_webView->LoadEpf(req.dark, req.fontSize, req.readOnly);
    else if (g_initialPack) g_webView->OpenPackPanel(req.dark, req.fontSize, req.readOnly);
    else g_webView->Load(req);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    /* Shutdown drops mOnFileOpened, so nothing touches the marker after this
     * point; it is released when openMarker leaves the scope. */
    CWebView2Host::Shutdown();
    OleUninitialize();
    return (int)msg.wParam;
}
