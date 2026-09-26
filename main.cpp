#include <windows.h>
#include <ole2.h>
#include <string.h>
#include <string>
#include <vector>

#include "listerplugin.h"
#include "browserhost.h"
#include "bslhighlight.h"
#include "webview2host.h"
#include "bslcommon.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")

static HINSTANCE g_hInst = NULL;
static const wchar_t* WNDCLASS_NAME = L"BSLViewMainWnd";
static const wchar_t* PROP_STATE = L"BSLView_State";
static ATOM g_wndClass = 0;

static std::wstring g_iniPath;
static std::wstring g_webRoot;
static bool g_webRootUsable = false;
static bool g_webRootResolved = false;

// --- Settings --------------------------------------------------------------

struct Settings {
    int          fontSize;
    std::wstring theme;
    bool         useMonaco;
    bool         keepWarm;
    DWORD        maxBytes;
    std::wstring bslExts;
    std::wstring queryExts;
    std::wstring textExts;
    std::wstring epfExts;     // external data processors and reports: the unpacking panel
    bool         loaded;
};

static Settings g_settings = {};

static std::wstring IniStr(const wchar_t* section, const wchar_t* key, const wchar_t* def)
{
    wchar_t buf[512];
    DWORD n = GetPrivateProfileStringW(section, key, def, buf, 512, g_iniPath.c_str());
    return std::wstring(buf, n);
}

static void LoadSettings(bool force)
{
    if (g_settings.loaded && !force) return;
    g_settings.fontSize  = GetPrivateProfileIntW(L"Options", L"FontSize", 14, g_iniPath.c_str());
    g_settings.theme     = IniStr(L"Options", L"Theme", L"auto");
    g_settings.useMonaco = GetPrivateProfileIntW(L"Options", L"UseMonaco", 1, g_iniPath.c_str()) != 0;
    g_settings.keepWarm  = GetPrivateProfileIntW(L"Options", L"KeepWarm", 1, g_iniPath.c_str()) != 0;

    int maxMb = GetPrivateProfileIntW(L"Options", L"MaxFileSizeMB", 64, g_iniPath.c_str());
    if (maxMb < 1) maxMb = 1;
    if (maxMb > 512) maxMb = 512;
    g_settings.maxBytes = (DWORD)maxMb * 1024u * 1024u;

    g_settings.bslExts   = IniStr(L"Extensions", L"BSLExtensions", L"bsl;os");
    g_settings.queryExts = IniStr(L"Extensions", L"QueryExtensions", L"sdbl;query");
    g_settings.textExts  = IniStr(L"Extensions", L"TextExtensions", L"md;markdown;mdc;json;xml;form;ps1;psm1;psd1;html;htm;mxl;sarif");
    g_settings.epfExts   = IniStr(L"Extensions", L"EpfExtensions", L"epf;erf;cf;cfe;dt");
    g_settings.loaded = true;
}

// --- Per-window state ------------------------------------------------------

struct WindowState {
    CWebView2Host* wv;
    CBrowserHost*  ie;
    std::wstring   filePath;
    std::wstring   content;
    TextEncoding   encoding;
    const char*    language;
    bool           dark;
    bool           pendingClose;
    bool           pendingLoad;
    std::wstring   pendingFilePath;
    int            pendingShowFlags;

    WindowState() : wv(NULL), ie(NULL), encoding(ENC_UTF8_BOM), language("plaintext"), dark(false),
                    pendingClose(false), pendingLoad(false), pendingShowFlags(0) {}
};

static int LoadNextNow(HWND pluginWin, const wchar_t* fileToLoadIn, int showFlags);

// --- Extension matching ----------------------------------------------------

static bool HasExtension(const wchar_t* filePath, const std::wstring& list)
{
    const wchar_t* dot = wcsrchr(filePath, L'.');
    if (!dot) return false;

    std::wstring ext(dot + 1);
    for (auto& c : ext) c = (wchar_t)towlower(c);

    size_t pos = 0;
    while (pos <= list.size()) {
        size_t sep = list.find(L';', pos);
        if (sep == std::wstring::npos) sep = list.size();
        if (sep > pos) {
            std::wstring item = list.substr(pos, sep - pos);
            for (auto& c : item) c = (wchar_t)towlower(c);
            if (item == ext) return true;
        }
        pos = sep + 1;
    }
    return false;
}

static bool IsSupported(const wchar_t* filePath)
{
    return HasExtension(filePath, g_settings.bslExts)
        || HasExtension(filePath, g_settings.queryExts)
        || HasExtension(filePath, g_settings.textExts)
        || HasExtension(filePath, g_settings.epfExts);
}

static bool ResolveDarkMode(int showFlags)
{
    if (g_settings.theme == L"light") return false;
    if (g_settings.theme == L"dark") return true;
    return (showFlags & lcp_darkmode) != 0;
}

// --- IE fallback -----------------------------------------------------------

static bool ShowInIE(WindowState* st, HWND hwnd)
{
    bool isBsl   = HasExtension(st->filePath.c_str(), g_settings.bslExts);
    bool isQuery = HasExtension(st->filePath.c_str(), g_settings.queryExts);
    if (!isBsl && !isQuery) return false;   // the C++ highlighter only knows BSL and SDBL

    if (!st->ie) {
        OleInitialize(NULL);
        CBrowserHost* browser = new CBrowserHost();
        browser->mAllowScripts = true;
        if (!browser->CreateBrowser(hwnd)) { browser->Release(); return false; }
        st->ie = browser;
    }

    BSLHighlightOptions opts;
    opts.darkMode = st->dark;
    opts.lineNumbers = GetPrivateProfileIntW(L"Options", L"LineNumbers", 1, g_iniPath.c_str()) != 0;
    std::wstring fontFamilyW = IniStr(L"Options", L"FontFamily", L"Consolas, Courier New, monospace");
    std::string fontFamily;
    fontFamily.reserve(fontFamilyW.size());
    for (wchar_t c : fontFamilyW) fontFamily += (c < 0x80) ? (char)c : '?';
    opts.fontFamily = fontFamily.c_str();
    opts.fontSize = g_settings.fontSize;
    opts.tabSize = GetPrivateProfileIntW(L"Options", L"TabSize", 4, g_iniPath.c_str());

    std::string html = isQuery
        ? HighlightSDBL(st->content.c_str(), st->content.size(), opts)
        : HighlightBSL(st->content.c_str(), st->content.size(), opts);

    st->ie->LoadHTML(html);
    return true;
}

static void FinalizeListClose(HWND hwnd, WindowState* st)
{
    // Hand the browser back to the pool while the Lister child still exists.
    if (st && st->wv) {
        CWebView2Host* wv = st->wv;
        st->wv = NULL;
        wv->Park();
    }
    DestroyWindow(hwnd);
}

// --- Window procedure ------------------------------------------------------

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    WindowState* st = (WindowState*)GetPropW(hwnd, PROP_STATE);

    switch (msg) {
    case WM_SIZE:
        if (st) {
            if (st->wv) st->wv->Resize();
            if (st->ie) st->ie->Resize();
        }
        return 0;

    case WM_BSLVIEW_WEBVIEW_FAILED:
        if (st) {
            if (st->wv) { st->wv->Close(); st->wv->Release(); st->wv = NULL; }
            if (!ShowInIE(st, hwnd)) InvalidateRect(hwnd, NULL, TRUE);
        }
        return 0;

    case WM_BSLVIEW_CLOSE_ACK:
        if (!st) return 0;
        if (!wParam) {
            st->pendingClose = false;
            st->pendingLoad = false;
            st->pendingFilePath.clear();
            return 0;
        }
        if (st->pendingClose) {
            st->pendingClose = false;
            st->pendingLoad = false;
            st->pendingFilePath.clear();
            FinalizeListClose(hwnd, st);
            return 0;
        }
        if (st->pendingLoad) {
            std::wstring path = st->pendingFilePath;
            int flags = st->pendingShowFlags;
            st->pendingLoad = false;
            st->pendingFilePath.clear();
            LoadNextNow(hwnd, path.c_str(), flags);
        }
        return 0;

    case WM_ERASEBKGND:
        // Fill before WebView2 attaches so the client is never an uninitialized
        // black region behind a still-loading page.
        {
            RECT rc;
            GetClientRect(hwnd, &rc);
            FillRect((HDC)wParam, &rc, (HBRUSH)(COLOR_WINDOW + 1));
            return 1;
        }

    case WM_PAINT:
        if (st && !st->wv && !st->ie) {
            PAINTSTRUCT ps;
            HDC hdc = BeginPaint(hwnd, &ps);
            RECT rc;
            GetClientRect(hwnd, &rc);
            FillRect(hdc, &rc, (HBRUSH)(COLOR_WINDOW + 1));
            SetBkMode(hdc, TRANSPARENT);
            const wchar_t* text =
                L"Не удалось запустить WebView2.\n\n"
                L"Установите Microsoft Edge WebView2 Runtime\n"
                L"или укажите UseMonaco=0 в BSLView.ini.";
            DrawTextW(hdc, text, -1, &rc, DT_CENTER | DT_VCENTER | DT_WORDBREAK);
            EndPaint(hwnd, &ps);
            return 0;
        }
        break;

    case WM_DESTROY:
        if (st) {
            RemovePropW(hwnd, PROP_STATE);
            if (st->wv) { st->wv->Close(); st->wv->Release(); }
            if (st->ie) { st->ie->Quit(); st->ie->Release(); }
            delete st;
        }
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

// --- DLL entry -------------------------------------------------------------

static void InitPaths()
{
    g_iniPath = ModuleDirectory(g_hInst) + L"BSLView.ini";
}

// The interface is linked into the plugin and the first run of a build
// unpacks it into a per-user cache, which is far too much work for DllMain
// and its loader lock. Total Commander asks for the detect string and for a
// window well after that, so the first of those calls pays for it instead.
static void EnsureWebRoot()
{
    if (g_webRootResolved) return;
    g_webRootResolved = true;
    g_webRoot = ResolveWebRoot(g_hInst);
    g_webRootUsable = !g_webRoot.empty();
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved)
{
    if (reason == DLL_PROCESS_ATTACH) {
        g_hInst = (HINSTANCE)hModule;
        DisableThreadLibraryCalls(hModule);
        InitPaths();

        WNDCLASSW wc = {};
        wc.lpfnWndProc = WndProc;
        wc.hInstance = g_hInst;
        wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
        wc.lpszClassName = WNDCLASS_NAME;
        g_wndClass = RegisterClassW(&wc);
    } else if (reason == DLL_PROCESS_DETACH) {
        // Total Commander unloads idle plugins. Leaving the class registered
        // would leave a stale WndProc pointer behind for the next load.
        //
        // CWebView2Host pins this module while WebView2 is in use. Therefore a
        // normal FreeLibrary cannot reach this path with live COM callbacks;
        // process exit is the only remaining detach and the OS tears down the
        // browser after DLL code can no longer be called.
        if (!reserved) {
            if (g_wndClass) UnregisterClassW(WNDCLASS_NAME, g_hInst);
        }
    }
    return TRUE;
}

// --- Shared load path ------------------------------------------------------

// Forms/<Name>.xml and Templates/<Name>.xml are descriptors; jump straight to
// the actual layout at Forms/<FormName>/Ext/Form.xml instead of making the
// user dig for it. Ext/Form/Module.bsl opens its whole form on the module tab,
// but only in the WebView2 viewer: the IE fallback has no form preview and
// would show the layout XML instead of the module.
static std::wstring ResolveListFile(const wchar_t* fileToLoadIn, bool webView, bool* openFormModule)
{
    *openFormModule = false;
    std::wstring configuration = FindConfigurationForDumpInfo(fileToLoadIn);
    std::wstring source = configuration.empty() ? std::wstring(fileToLoadIn) : configuration;
    std::wstring layout = FindFormLayoutForMeta(source.c_str());
    if (!layout.empty()) return layout;
    if (webView) {
        layout = FindFormLayoutForModule(source.c_str());
        if (!layout.empty()) {
            *openFormModule = true;
            return layout;
        }
    }
    return source;
}

// The caption Total Commander writes for a Lister window, plus the star of a
// document with changes that are not on disk yet — the mark 1C uses.
static std::wstring ListerTitleFor(const std::wstring& path, bool dirty)
{
    return L"Lister - [" + path + (dirty ? L" *" : L"") + L"]";
}

static HWND DoListLoad(HWND parentWin, const wchar_t* fileToLoadIn, int showFlags)
{
    LoadSettings(false);
    if (!IsSupported(fileToLoadIn)) return NULL;
    EnsureWebRoot();

    bool wantMonaco = g_settings.useMonaco && g_webRootUsable && CWebView2Host::IsRuntimeAvailable();
    // The unpacking panel of an .epf/.erf exists in the WebView2 viewer only.
    bool epfFile = HasExtension(fileToLoadIn, g_settings.epfExts);
    if (epfFile && !wantMonaco) return NULL;
    bool openFormModule = false;
    std::wstring resolved = epfFile ? std::wstring(fileToLoadIn)
        : ResolveListFile(fileToLoadIn, wantMonaco, &openFormModule);
    const wchar_t* fileToLoad = resolved.c_str();

    TextFile file = epfFile ? TextFile() : ReadTextFile(fileToLoad, g_settings.maxBytes);
    if (epfFile) file.ok = true;
    if (!file.ok) return NULL;   // unreadable or over the size limit

    RECT rcParent;
    GetClientRect(parentWin, &rcParent);

    HWND hwnd = CreateWindowExW(0, WNDCLASS_NAME, L"",
                                WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                                0, 0, rcParent.right, rcParent.bottom,
                                parentWin, NULL, g_hInst, NULL);
    if (!hwnd) return NULL;

    WindowState* st = new WindowState();
    st->filePath = fileToLoad;
    st->content  = file.text;
    st->encoding = file.encoding;
    st->language = MonacoLanguageForPath(fileToLoad);
    st->dark     = ResolveDarkMode(showFlags);
    SetPropW(hwnd, PROP_STATE, (HANDLE)st);

    if (wantMonaco) {
        st->wv = CWebView2Host::Acquire(hwnd, g_webRoot);
        st->wv->mFilePath = st->filePath;
        /* A form or template opened from an object window becomes the file
         * this Lister shows: its path goes into the title, as TC writes it. */
        st->wv->mOnFileOpened = [hwnd, parentWin](const std::wstring& path) {
            WindowState* state = (WindowState*)GetPropW(hwnd, PROP_STATE);
            if (state) state->filePath = path;
            bool dirty = state && state->wv ? state->wv->mDirty : false;
            SetWindowTextW(parentWin, ListerTitleFor(path, dirty).c_str());
        };
        /* Unsaved changes carry a star after the file name, the way 1C marks a
         * document that differs from what is on disk. */
        st->wv->mOnDirtyChanged = [hwnd, parentWin](bool dirty) {
            WindowState* state = (WindowState*)GetPropW(hwnd, PROP_STATE);
            if (!state) return;
            SetWindowTextW(parentWin, ListerTitleFor(state->filePath, dirty).c_str());
        };
        st->wv->mEncoding = st->encoding;
        st->wv->mFileRevision = file.revision;

        BslLoadRequest req;
        req.content  = st->content;
        req.language = st->language;
        req.dark     = st->dark;
        req.fontSize = g_settings.fontSize;
        req.readOnly = true;
        req.openFormModule = openFormModule;
        if (epfFile) st->wv->LoadEpf(req.dark, req.fontSize, req.readOnly);
        else st->wv->Load(req);

        // The browser attaches asynchronously; the window is already valid, so
        // Total Commander gets it back without waiting for Chromium to start.
        return hwnd;
    }

    if (ShowInIE(st, hwnd)) return hwnd;

    DestroyWindow(hwnd);
    return NULL;
}

static int LoadNextNow(HWND pluginWin, const wchar_t* fileToLoadIn, int showFlags)
{
    WindowState* st = (WindowState*)GetPropW(pluginWin, PROP_STATE);
    if (!st) return LISTPLUGIN_ERROR;

    bool epfFile = HasExtension(fileToLoadIn, g_settings.epfExts);
    if (epfFile && !st->wv) return LISTPLUGIN_ERROR;
    bool openFormModule = false;
    std::wstring resolved = epfFile ? std::wstring(fileToLoadIn)
        : ResolveListFile(fileToLoadIn, st->wv != NULL, &openFormModule);
    const wchar_t* fileToLoad = resolved.c_str();

    TextFile file = epfFile ? TextFile() : ReadTextFile(fileToLoad, g_settings.maxBytes);
    if (epfFile) file.ok = true;
    if (!file.ok) return LISTPLUGIN_ERROR;

    st->filePath = fileToLoad;
    st->content  = file.text;
    st->encoding = file.encoding;
    st->language = MonacoLanguageForPath(fileToLoad);
    st->dark     = ResolveDarkMode(showFlags);

    if (st->wv) {
        // Reuse the live browser: swapping the model is essentially free
        // compared with tearing the page down and navigating again.
        st->wv->mFilePath = st->filePath;
        st->wv->mEncoding = st->encoding;
        st->wv->mFileRevision = file.revision;

        BslLoadRequest req;
        req.content  = st->content;
        req.language = st->language;
        req.dark     = st->dark;
        req.fontSize = g_settings.fontSize;
        req.readOnly = true;
        req.openFormModule = openFormModule;
        if (epfFile) st->wv->LoadEpf(req.dark, req.fontSize, req.readOnly);
        else st->wv->Load(req);
        return LISTPLUGIN_OK;
    }

    return ShowInIE(st, pluginWin) ? LISTPLUGIN_OK : LISTPLUGIN_ERROR;
}

static int DoListLoadNext(HWND pluginWin, const wchar_t* fileToLoadIn, int showFlags)
{
    LoadSettings(false);
    if (!IsSupported(fileToLoadIn)) return LISTPLUGIN_ERROR;

    WindowState* st = (WindowState*)GetPropW(pluginWin, PROP_STATE);
    if (!st) return LISTPLUGIN_ERROR;

    if (st->wv && st->wv->RequestClose()) {
        st->pendingClose = false;
        st->pendingLoad = true;
        st->pendingFilePath = fileToLoadIn;
        st->pendingShowFlags = showFlags;
        return LISTPLUGIN_OK;
    }
    return LoadNextNow(pluginWin, fileToLoadIn, showFlags);
}

// --- WLX Exports -----------------------------------------------------------

extern "C" {

__declspec(dllexport)
void __stdcall ListSetDefaultParams(ListDefaultParamStruct* dps)
{
    (void)dps;
    InitPaths();
    LoadSettings(true);
    EnsureWebRoot();
    // Total Commander calls this once at startup. Start the WebView2
    // environment early; the first F3 creates the controller on the real
    // Lister HWND (creating it on the off-screen park first caused black).
    if (g_settings.useMonaco && g_webRootUsable)
        CWebView2Host::WarmUp(g_webRoot, g_settings.keepWarm);
}

__declspec(dllexport)
void __stdcall ListGetDetectString(char* DetectString, int maxlen)
{
    LoadSettings(false);

    std::wstring all = g_settings.bslExts + L";" + g_settings.queryExts + L";" + g_settings.textExts
        + L";" + g_settings.epfExts;
    std::string detect;
    size_t pos = 0;
    while (pos <= all.size()) {
        size_t sep = all.find(L';', pos);
        if (sep == std::wstring::npos) sep = all.size();
        if (sep > pos) {
            std::wstring item = all.substr(pos, sep - pos);
            if (!detect.empty()) detect += " | ";
            detect += "EXT=\"";
            for (wchar_t c : item) detect += (char)towupper(c);
            detect += "\"";
        }
        pos = sep + 1;
    }
    strncpy(DetectString, detect.c_str(), maxlen - 1);
    DetectString[maxlen - 1] = 0;
}

__declspec(dllexport)
HWND __stdcall ListLoadW(HWND ParentWin, WCHAR* FileToLoad, int ShowFlags)
{
    return DoListLoad(ParentWin, FileToLoad, ShowFlags);
}

__declspec(dllexport)
HWND __stdcall ListLoad(HWND ParentWin, char* FileToLoad, int ShowFlags)
{
    return DoListLoad(ParentWin, AnsiToWide(FileToLoad).c_str(), ShowFlags);
}

__declspec(dllexport)
int __stdcall ListLoadNextW(HWND ParentWin, HWND PluginWin, WCHAR* FileToLoad, int ShowFlags)
{
    (void)ParentWin;
    return DoListLoadNext(PluginWin, FileToLoad, ShowFlags);
}

__declspec(dllexport)
int __stdcall ListLoadNext(HWND ParentWin, HWND PluginWin, char* FileToLoad, int ShowFlags)
{
    (void)ParentWin;
    return DoListLoadNext(PluginWin, AnsiToWide(FileToLoad).c_str(), ShowFlags);
}

__declspec(dllexport)
void __stdcall ListCloseWindow(HWND ListWin)
{
    WindowState* st = (WindowState*)GetPropW(ListWin, PROP_STATE);
    if (st && st->wv && st->wv->RequestClose()) {
        st->pendingClose = true;
        st->pendingLoad = false;
        st->pendingFilePath.clear();
        return;
    }
    FinalizeListClose(ListWin, st);
}

__declspec(dllexport)
int __stdcall ListSearchTextW(HWND ListWin, WCHAR* SearchString, int SearchParameter)
{
    WindowState* st = (WindowState*)GetPropW(ListWin, PROP_STATE);
    if (!st || !SearchString) return LISTPLUGIN_ERROR;

    if (st->wv) {
        st->wv->Find(SearchString,
                     (SearchParameter & lcs_matchcase) != 0,
                     (SearchParameter & lcs_wholewords) != 0,
                     (SearchParameter & lcs_backwards) != 0,
                     (SearchParameter & lcs_findfirst) != 0);
        // Monaco reports no result back synchronously; treating the search as
        // handled keeps Total Commander from opening its own search box.
        return LISTPLUGIN_OK;
    }

    if (st->ie) return st->ie->FindText(SearchString, SearchParameter) ? LISTPLUGIN_OK : LISTPLUGIN_ERROR;
    return LISTPLUGIN_ERROR;
}

__declspec(dllexport)
int __stdcall ListSearchText(HWND ListWin, char* SearchString, int SearchParameter)
{
    if (!SearchString) return LISTPLUGIN_ERROR;
    std::wstring ws = AnsiToWide(SearchString);
    return ListSearchTextW(ListWin, &ws[0], SearchParameter);
}

__declspec(dllexport)
int __stdcall ListSendCommand(HWND ListWin, int Command, int Parameter)
{
    (void)Parameter;
    WindowState* st = (WindowState*)GetPropW(ListWin, PROP_STATE);
    if (!st) return LISTPLUGIN_ERROR;

    if (Command == lc_newparams) {
        LoadSettings(true);
        return LISTPLUGIN_OK;
    }

    if (st->wv) {
        if (Command == lc_copy) st->wv->SendCommand(L"copy");
        else if (Command == lc_selectall) st->wv->SendCommand(L"selectAll");
        return LISTPLUGIN_OK;
    }

    if (!st->ie || !st->ie->mWebBrowser) return LISTPLUGIN_ERROR;

    IDispatch* pDisp = NULL;
    st->ie->mWebBrowser->get_Document(&pDisp);
    if (!pDisp) return LISTPLUGIN_ERROR;

    IHTMLDocument2* pDoc = NULL;
    pDisp->QueryInterface(IID_IHTMLDocument2, (void**)&pDoc);
    pDisp->Release();
    if (!pDoc) return LISTPLUGIN_ERROR;

    VARIANT_BOOL success;
    VARIANT vIn;
    VariantInit(&vIn);

    if (Command == lc_copy)
        pDoc->execCommand(L"Copy", VARIANT_FALSE, vIn, &success);
    else if (Command == lc_selectall)
        pDoc->execCommand(L"SelectAll", VARIANT_FALSE, vIn, &success);

    pDoc->Release();
    return LISTPLUGIN_OK;
}

} // extern "C"
