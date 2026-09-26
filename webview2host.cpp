#include "webview2host.h"

#include <WebView2.h>
#include <shlwapi.h>
#include <shlobj.h>
#include <shobjidl_core.h>
#include <commdlg.h>
#include <wincrypt.h>
#include <vector>

#include <atomic>
#include <mutex>
#include <thread>

#include "packages/1c-form-viewer/native/context-batch.h"
#include "epfunpack.h"

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "comdlg32.lib")
#pragma comment(lib, "shell32.lib")

static const wchar_t* kViewerOrigin = L"https://" BSLVIEW_VIRTUAL_HOST L"/";

static HRESULT BslCreateController(ICoreWebView2Environment* env, CWebView2Host* host);
static void ConfigureControllerRendering(ICoreWebView2Controller* ctrl, HWND hwnd, bool dark);
static void EnsureEnvironment();

// Minimal ICoreWebView2EnvironmentOptions so we can pass browser flags without
// pulling in WRL. The only one that matters is CalculateNativeWinOcclusion:
// the parked instance lives off-screen, and Chromium would otherwise consider
// it occluded and throttle it, so the first frame after reuse arrives late.
class EnvironmentOptions : public ICoreWebView2EnvironmentOptions {
    long mRef;

    static HRESULT CopyOut(const wchar_t* src, LPWSTR* out) {
        if (!out) return E_POINTER;
        size_t bytes = (wcslen(src) + 1) * sizeof(wchar_t);
        *out = (LPWSTR)CoTaskMemAlloc(bytes);
        if (!*out) return E_OUTOFMEMORY;
        memcpy(*out, src, bytes);
        return S_OK;
    }

public:
    EnvironmentOptions() : mRef(1) {}

    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (IsEqualIID(riid, IID_IUnknown) || IsEqualIID(riid, __uuidof(ICoreWebView2EnvironmentOptions))) {
            *ppv = static_cast<ICoreWebView2EnvironmentOptions*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&mRef); }
    STDMETHODIMP_(ULONG) Release() { long r = InterlockedDecrement(&mRef); if (!r) delete this; return r; }

    STDMETHODIMP get_AdditionalBrowserArguments(LPWSTR* value) {
        // Parked off-screen instance must not be treated as occluded/throttled.
        return CopyOut(L"--disable-features=CalculateNativeWinOcclusion", value);
    }
    STDMETHODIMP put_AdditionalBrowserArguments(LPCWSTR) { return S_OK; }

    STDMETHODIMP get_Language(LPWSTR* value) { return CopyOut(L"", value); }
    STDMETHODIMP put_Language(LPCWSTR) { return S_OK; }

    STDMETHODIMP get_TargetCompatibleBrowserVersion(LPWSTR* value) {
        /* The SDK constant (131.x) is a *minimum*. If the installed Evergreen
         * runtime is older, CreateCoreWebView2Environment fails even though a
         * runtime is present. Prefer the version that is actually installed. */
        LPWSTR ver = NULL;
        if (SUCCEEDED(GetAvailableCoreWebView2BrowserVersionString(NULL, &ver)) && ver && *ver) {
            HRESULT hr = CopyOut(ver, value);
            CoTaskMemFree(ver);
            return hr;
        }
        if (ver) CoTaskMemFree(ver);
        return CopyOut(L"86.0.616.0", value);
    }
    STDMETHODIMP put_TargetCompatibleBrowserVersion(LPCWSTR) { return S_OK; }

    STDMETHODIMP get_AllowSingleSignOnUsingOSPrimaryAccount(BOOL* allow) {
        if (!allow) return E_POINTER;
        *allow = FALSE;
        return S_OK;
    }
    STDMETHODIMP put_AllowSingleSignOnUsingOSPrimaryAccount(BOOL) { return S_OK; }
};

// ---------------------------------------------------------------------------
// Shared environment
//
// Creating an ICoreWebView2Environment is what spawns msedgewebview2.exe. The
// plugin used to build (and tear down) one per opened file, so every F3 paid a
// full browser cold start. One environment is created for the lifetime of the
// module instead, and creation is kicked off as early as possible so it usually
// finishes before the user opens anything.
// ---------------------------------------------------------------------------

namespace {

ICoreWebView2Environment* g_env = NULL;
bool g_envPending = false;
bool g_envFailed  = false;
HRESULT g_lastEnvHr = S_OK;
int g_envAttempts = 0;

// ---------------------------------------------------------------------------
// Batched configuration io (https://bslcfg.invalid/batch)
//
// A batch is a few hundred file reads; doing them inside WebResourceRequested
// would freeze the editor and serialise every request of the page behind the
// UI thread. The request is deferred, served on a worker thread, and the
// response is handed back to the UI thread through a message-only window,
// because WebView2 objects may only be touched there.
// ---------------------------------------------------------------------------

const UINT WM_BSLVIEW_BATCH_DONE = WM_APP + 60;
// Progress and completion of an .epf/.erf unpacking (CWebView2Host::OnEpfEvent).
const UINT WM_BSLVIEW_EPF_EVENT = WM_APP + 61;
// The answer to a git query (CWebView2Host::OnGitEvent). git runs as a
// process of its own, which on a cold or networked repository is not instant,
// so the query goes to a worker exactly like a batch read does.
const UINT WM_BSLVIEW_GIT_EVENT = WM_APP + 62;
// A file of the open document changed on disk behind the editor's back
// (CWebView2Host::OnWatchEvent).
const UINT WM_BSLVIEW_WATCH_EVENT = WM_APP + 63;
std::atomic<long> g_batchJobs(0);
HWND g_batchWnd = NULL;

struct BatchJob {
    ICoreWebView2WebResourceRequestedEventArgs* args;
    ICoreWebView2Deferral* deferral;
    ContextBatchResult result;
};

LRESULT CALLBACK BatchWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);

HWND BatchWindow()
{
    if (g_batchWnd) return g_batchWnd;
    static const wchar_t* kClass = L"BSLViewBatchWnd";
    WNDCLASSW wc = {};
    wc.lpfnWndProc = BatchWndProc;
    wc.hInstance = GetModuleHandleW(NULL);
    wc.lpszClassName = kClass;
    RegisterClassW(&wc);
    g_batchWnd = CreateWindowExW(0, kClass, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, NULL, GetModuleHandleW(NULL), NULL);
    return g_batchWnd;
}

void FinishBatchJob(BatchJob* job)
{
    if (g_env) {
        const char* reason = job->result.status == 200 ? "OK" : job->result.status == 204 ? "No Content"
            : job->result.status == 404 ? "Not Found" : "Bad Request";
        std::wstring headers = L"Access-Control-Allow-Origin: https://" BSLVIEW_VIRTUAL_HOST L"\r\n"
            L"Cache-Control: no-store\r\nContent-Type: ";
        headers += context_batch::Wide(job->result.contentType);
        IStream* body = job->result.body.empty() ? NULL
            : SHCreateMemStream((const BYTE*)job->result.body.data(), (UINT)job->result.body.size());
        ICoreWebView2WebResourceResponse* response = NULL;
        if (SUCCEEDED(g_env->CreateWebResourceResponse(body, job->result.status,
                context_batch::Wide(reason).c_str(), headers.c_str(), &response)) && response) {
            job->args->put_Response(response);
            response->Release();
        }
        if (body) body->Release();
    }
    job->deferral->Complete();
    job->deferral->Release();
    job->args->Release();
    delete job;
    --g_batchJobs;
}

LRESULT CALLBACK BatchWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    if (msg == WM_BSLVIEW_BATCH_DONE) {
        FinishBatchJob((BatchJob*)lParam);
        return 0;
    }
    if (msg == WM_BSLVIEW_EPF_EVENT) {
        CWebView2Host::OnEpfEvent(lParam);
        return 0;
    }
    if (msg == WM_BSLVIEW_GIT_EVENT) {
        CWebView2Host::OnGitEvent(lParam);
        return 0;
    }
    if (msg == WM_BSLVIEW_WATCH_EVENT) {
        CWebView2Host::OnWatchEvent(lParam);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

bool ReadRequestBody(ICoreWebView2WebResourceRequest* request, std::string& body)
{
    IStream* stream = NULL;
    if (FAILED(request->get_Content(&stream)) || !stream) return false;
    char buffer[65536];
    for (;;) {
        ULONG got = 0;
        HRESULT hr = stream->Read(buffer, sizeof(buffer), &got);
        if (got) body.append(buffer, got);
        if (FAILED(hr) || hr == S_FALSE || got == 0 || body.size() > 64u * 1024u * 1024u) break;
    }
    stream->Release();
    return body.size() <= 64u * 1024u * 1024u;
}

std::vector<CWebView2Host*>* g_waiters = NULL;

// A single browser instance is kept alive between openings, parented to an
// off-screen window. Reusing it skips browser startup, page navigation and the
// Monaco parse entirely, which is the bulk of the wait when opening a file.
CWebView2Host* g_parked = NULL;
HWND  g_holder = NULL;
bool  g_keepWarm = false;
bool  g_standalone = false;
std::wstring g_warmWebRoot;

HWND HolderWindow()
{
    if (g_holder) return g_holder;

    static const wchar_t* kClass = L"BSLViewParkingWnd";
    static bool registered = false;
    if (!registered) {
        WNDCLASSW wc = {};
        wc.lpfnWndProc = DefWindowProcW;
        wc.hInstance = GetModuleHandleW(NULL);
        wc.lpszClassName = kClass;
        RegisterClassW(&wc);
        registered = true;
    }
    // Must be WS_VISIBLE: creating / parking WebView2 on a non-visible parent
    // leaves a dead DirectComposition surface that stays solid black after
    // reparent into the Lister. Off-screen coordinates keep it out of the way.
    g_holder = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, kClass, L"",
                               WS_POPUP | WS_VISIBLE, -32000, -32000, 800, 600,
                               NULL, NULL, GetModuleHandleW(NULL), NULL);
    if (g_holder) ShowWindow(g_holder, SW_SHOWNOACTIVATE);
    return g_holder;
}

std::wstring UserDataFolder()
{
    wchar_t buf[MAX_PATH];
    DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", buf, MAX_PATH);
    std::wstring base = (n > 0 && n < MAX_PATH) ? std::wstring(buf) : std::wstring();
    if (base.empty()) {
        wchar_t tmp[MAX_PATH];
        GetTempPathW(MAX_PATH, tmp);
        base = tmp;
        if (!base.empty() && base.back() == L'\\') base.pop_back();
    }
    // Isolate by host process so BSLEdit and the TC plugin do not fight over
    // one Chromium profile (that fails with ERROR_INVALID_STATE).
    wchar_t exe[MAX_PATH] = {};
    GetModuleFileNameW(NULL, exe, MAX_PATH);
    const wchar_t* leaf = PathFindFileNameW(exe);
    wchar_t name[MAX_PATH] = {};
    lstrcpynW(name, leaf ? leaf : L"app", MAX_PATH);
    PathRemoveExtensionW(name);
    std::wstring folderName = name;
    if (g_envAttempts > 1)
        folderName += L"-" + std::to_wstring(GetCurrentProcessId());

    return base + L"\\BSLView\\WebView2-" + folderName;
}

} // namespace

// --- COM callback shims ----------------------------------------------------

/* Every WebView2 callback below is a single-method COM object with the same
 * IUnknown: one ref count, and a QueryInterface answering for IUnknown and for
 * the one interface it implements. The interface type supplies both, so each
 * handler only has to write Invoke. */
template <class I>
class ComCallback : public I {
public:
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (IsEqualIID(riid, IID_IUnknown) || IsEqualIID(riid, __uuidof(I))) {
            *ppv = static_cast<I*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&mRef); }
    STDMETHODIMP_(ULONG) Release() { long r = InterlockedDecrement(&mRef); if (!r) delete this; return r; }

protected:
    ComCallback() : mRef(1) {}
    virtual ~ComCallback() {}

private:
    long mRef;
};

/* Callbacks that act on one host hold it as a raw pointer: the caller AddRefs
 * the host before handing the callback to WebView2 and the Invoke body releases
 * it, so the host outlives the callback by construction. */
template <class I>
class HostCallback : public ComCallback<I> {
public:
    explicit HostCallback(CWebView2Host* host) : mHost(host) {}

protected:
    CWebView2Host* mHost;
};

class EnvCompletedHandler : public ComCallback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler> {
public:
    STDMETHODIMP Invoke(HRESULT hr, ICoreWebView2Environment* env) {
        g_envPending = false;
        if (SUCCEEDED(hr) && env) {
            g_env = env;
            g_env->AddRef();
        } else {
            g_lastEnvHr = FAILED(hr) ? hr : E_FAIL;
            // First failure is often a user-data folder already taken by
            // another BSLView process (TC plugin vs BSLEdit). Retry once
            // with a process-id folder before giving up.
            if (g_envAttempts < 2) {
                EnsureEnvironment();
                if (g_envPending || g_env) return S_OK;
            }
            g_envFailed = true;
        }

        if (g_waiters) {
            std::vector<CWebView2Host*> waiters;
            waiters.swap(*g_waiters);
            for (size_t i = 0; i < waiters.size(); i++) {
                CWebView2Host* host = waiters[i];
                if (g_env && !host->mClosed) {
                    host->AddRef();   // held by the controller callback
                    if (FAILED(BslCreateController(g_env, host))) {
                        host->Release();
                        PostMessageW(host->mParentWin, WM_BSLVIEW_WEBVIEW_FAILED, (WPARAM)g_lastEnvHr, 0);
                    }
                } else if (!host->mClosed) {
                    PostMessageW(host->mParentWin, WM_BSLVIEW_WEBVIEW_FAILED, (WPARAM)g_lastEnvHr, 0);
                }
                host->Release();      // the waiter-list reference
            }
        }
        return S_OK;
    }
};

class CtrlCompletedHandler : public HostCallback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler> {
    typedef HostCallback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler> Base;
public:
    explicit CtrlCompletedHandler(CWebView2Host* host) : Base(host) {}
    STDMETHODIMP Invoke(HRESULT hr, ICoreWebView2Controller* ctrl) {
        mHost->OnControllerCreated(hr, ctrl);
        mHost->Release();   // matches the AddRef taken before creation
        return S_OK;
    }
};

class WebMessageHandler : public HostCallback<ICoreWebView2WebMessageReceivedEventHandler> {
    typedef HostCallback<ICoreWebView2WebMessageReceivedEventHandler> Base;
public:
    explicit WebMessageHandler(CWebView2Host* host) : Base(host) {}
    STDMETHODIMP Invoke(ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) {
        LPWSTR raw = NULL;
        if (FAILED(args->get_WebMessageAsJson(&raw)) || !raw) return S_OK;
        std::wstring msg(raw);
        CoTaskMemFree(raw);
        mHost->OnWebMessage(msg);
        return S_OK;
    }
};

class WebResourceHandler : public HostCallback<ICoreWebView2WebResourceRequestedEventHandler> {
    typedef HostCallback<ICoreWebView2WebResourceRequestedEventHandler> Base;
public:
    explicit WebResourceHandler(CWebView2Host* host) : Base(host) {}
    STDMETHODIMP Invoke(ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) {
        mHost->OnWebResourceRequested(args);
        return S_OK;
    }
};

class NavigationStartingHandler : public ComCallback<ICoreWebView2NavigationStartingEventHandler> {
public:
    STDMETHODIMP Invoke(ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) {
        LPWSTR uri = NULL;
        if (SUCCEEDED(args->get_Uri(&uri)) && uri) {
            // Viewed documents are untrusted input; keep them from navigating
            // the host frame anywhere outside the packaged viewer.
            if (StrCmpNIW(uri, kViewerOrigin, (int)wcslen(kViewerOrigin)) != 0)
                args->put_Cancel(TRUE);
            CoTaskMemFree(uri);
        }
        return S_OK;
    }
};

class NewWindowHandler : public ComCallback<ICoreWebView2NewWindowRequestedEventHandler> {
public:
    STDMETHODIMP Invoke(ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) {
        args->put_Handled(TRUE);
        return S_OK;
    }
};

class ProcessFailedHandler : public HostCallback<ICoreWebView2ProcessFailedEventHandler> {
    typedef HostCallback<ICoreWebView2ProcessFailedEventHandler> Base;
public:
    explicit ProcessFailedHandler(CWebView2Host* host) : Base(host) {}
    STDMETHODIMP Invoke(ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*) {
        mHost->OnProcessFailed();
        return S_OK;
    }
};

class ScreenshotCompletedHandler : public HostCallback<ICoreWebView2CapturePreviewCompletedHandler> {
    typedef HostCallback<ICoreWebView2CapturePreviewCompletedHandler> Base;
public:
    ScreenshotCompletedHandler(CWebView2Host* host, IStream* stream)
        : Base(host), mStream(stream) { if (mStream) mStream->AddRef(); }
    ~ScreenshotCompletedHandler() { if (mStream) mStream->Release(); }

    STDMETHODIMP Invoke(HRESULT hr) {
        if (mStream && SUCCEEDED(hr)) mStream->Commit(STGC_DEFAULT);
        if (!mHost->mClosed) {
            std::wstring json = L"{\"cmd\":\"screenshotDone\",\"ok\":";
            json += SUCCEEDED(hr) ? L"true" : L"false";
            json += L"}";
            mHost->PostJson(json);
        }
        mHost->Release();
        return S_OK;
    }
private:
    IStream* mStream;
};

static HRESULT BslCreateController(ICoreWebView2Environment* env, CWebView2Host* host)
{
    CtrlCompletedHandler* cb = new CtrlCompletedHandler(host);
    HRESULT hr = env->CreateCoreWebView2Controller(host->mParentWin, cb);
    cb->Release();
    return hr;
}

// --- Static environment management -----------------------------------------

bool CWebView2Host::IsRuntimeAvailable()
{
    LPWSTR version = NULL;
    HRESULT hr = GetAvailableCoreWebView2BrowserVersionString(NULL, &version);
    bool available = SUCCEEDED(hr) && version && *version;
    if (version) CoTaskMemFree(version);
    return available;
}

static void EnsureEnvironment()
{
    if (g_env || g_envPending) return;
    if (!CWebView2Host::IsRuntimeAvailable()) {
        g_lastEnvHr = HRESULT_FROM_WIN32(ERROR_PRODUCT_UNINSTALLED);
        g_envFailed = true;
        return;
    }

    g_envFailed = false;
    g_envAttempts++;
    std::wstring folder = UserDataFolder();
    SHCreateDirectoryExW(NULL, folder.c_str(), NULL);

    g_envPending = true;

    EnvironmentOptions* options = new EnvironmentOptions();
    EnvCompletedHandler* cb = new EnvCompletedHandler();
    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(NULL, folder.c_str(), options, cb);
    cb->Release();
    options->Release();

    if (FAILED(hr)) {
        g_envPending = false;
        g_lastEnvHr = hr;
        if (g_envAttempts < 2) {
            EnsureEnvironment();
            return;
        }
        g_envFailed = true;
    }
}

// WebView2 keeps asynchronous COM callbacks alive until the browser has
// released them. Pinning the owning module while WebView2 is in use prevents
// Total Commander from unloading the DLL underneath one of those callbacks.
// The pin is released by the OS at process exit, when DllMain receives the
// reserved=true detach notification and no callback can run afterward.
static void PinModule()
{
    static bool pinned = false;
    if (pinned) return;
    HMODULE module = NULL;
    if (GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                           GET_MODULE_HANDLE_EX_FLAG_PIN,
                           reinterpret_cast<LPCWSTR>(&PinModule), &module)) {
        pinned = true;
    }
}

HRESULT CWebView2Host::LastError()
{
    return g_lastEnvHr;
}

void CWebView2Host::SetStandalone(bool standalone)
{
    g_standalone = standalone;
}

void CWebView2Host::WarmUp(const std::wstring& webRoot, bool keepWarm)
{
    PinModule();
    g_keepWarm = keepWarm;
    if (g_warmWebRoot.empty()) g_warmWebRoot = webRoot;

    // Only spin up the environment here. Creating a parked controller on the
    // off-screen holder *before* the first F3 was the black-screen path: the
    // first ListLoad then reparented a never-on-screen surface into Lister.
    // KeepWarm still parks after ListCloseWindow, so the second F3 stays fast.
    EnsureEnvironment();
}

void CWebView2Host::Shutdown()
{
    if (g_waiters) {
        for (size_t i = 0; i < g_waiters->size(); i++) (*g_waiters)[i]->Release();
        delete g_waiters;
        g_waiters = NULL;
    }
    if (g_parked) {
        CWebView2Host* p = g_parked;
        g_parked = NULL;
        p->mParked = false;
        p->Close();
        p->Release();
    }
    /* Worker threads run code of this module: let them finish before it can
     * be unloaded, completing their deferrals as they report back. */
    for (ULONGLONG deadline = GetTickCount64() + 5000; g_batchJobs > 0 && GetTickCount64() < deadline;) {
        MSG msg;
        while (g_batchWnd && PeekMessageW(&msg, g_batchWnd, WM_BSLVIEW_BATCH_DONE, WM_BSLVIEW_WATCH_EVENT, PM_REMOVE))
            DispatchMessageW(&msg);
        Sleep(10);
    }
    if (g_batchWnd) { DestroyWindow(g_batchWnd); g_batchWnd = NULL; }
    if (g_env) { g_env->Release(); g_env = NULL; }
    if (g_holder) { DestroyWindow(g_holder); g_holder = NULL; }
    g_envPending = false;
    g_envFailed = false;
    g_lastEnvHr = S_OK;
    g_envAttempts = 0;
    g_keepWarm = false;
    g_warmWebRoot.clear();
}

// --- Construction ----------------------------------------------------------

CWebView2Host::CWebView2Host()
    : mParentWin(NULL), mEncoding(ENC_UTF8_BOM), mFormModuleEncoding(ENC_UTF8_BOM),
      mRefCount(1), mWebView(NULL),
      mController(NULL), mClosed(false), mParked(false), mFailed(false),
      mPageReady(false), mHasPending(false), mFocusEditorOnPaint(false), mDark(false),
      mFontSize(14), mReadOnly(true), mNavigating(false),
      mDirty(false), mDirtyFile(false), mDirtyModule(false),
      mEpfRun(NULL), mGitGen(0), mWatch(NULL), mWatchGen(0)
{
}

CWebView2Host::~CWebView2Host()
{
    StopWatch();
    if (mWebView) mWebView->Release();
    if (mController) { mController->Close(); mController->Release(); }
}

CWebView2Host* CWebView2Host::Acquire(HWND parent, const std::wstring& webRoot)
{
    // Reuse the parked instance if there is one: it already has a browser, a
    // loaded page and a warm Monaco, so showing a file is just a postMessage.
    if (g_parked && parent != g_holder) {
        CWebView2Host* host = g_parked;
        g_parked = NULL;
        host->mParked = false;
        host->Reparent(parent, true);
        return host;
    }

    CWebView2Host* host = new CWebView2Host();
    host->mParentWin = parent;
    host->mWebRoot = webRoot;

    EnsureEnvironment();

    if (g_envFailed) {
        PostMessageW(parent, WM_BSLVIEW_WEBVIEW_FAILED, (WPARAM)g_lastEnvHr, 0);
        return host;
    }

    if (g_env) {
        host->AddRef();
        if (FAILED(BslCreateController(g_env, host))) {
            host->Release();
            PostMessageW(parent, WM_BSLVIEW_WEBVIEW_FAILED, (WPARAM)g_lastEnvHr, 0);
        }
        return host;
    }

    // Environment still being created; pick the work up in its callback.
    if (!g_waiters) g_waiters = new std::vector<CWebView2Host*>();
    host->AddRef();
    g_waiters->push_back(host);
    return host;
}

void CWebView2Host::AddRef()
{
    InterlockedIncrement(&mRefCount);
}

void CWebView2Host::Release()
{
    if (InterlockedDecrement(&mRefCount) == 0) delete this;
}

void CWebView2Host::Close()
{
    CancelEpf();
    StopWatch();
    mClosed = true;
    mPageReady = false;
    if (mController) {
        mController->put_IsVisible(FALSE);
        mController->Close();
        mController->Release();
        mController = NULL;
    }
    if (mWebView) { mWebView->Release(); mWebView = NULL; }
}

void CWebView2Host::OnProcessFailed()
{
    mFailed = true;
    mPageReady = false;

    // A dead instance must never go back into the pool, or every later open
    // would be handed the same broken browser.
    if (mParked && g_parked == this) {
        g_parked = NULL;
        mParked = false;
        Close();
        Release();
        return;
    }
    if (!mClosed && mParentWin) PostMessageW(mParentWin, WM_BSLVIEW_WEBVIEW_FAILED, 0, 0);
}

void CWebView2Host::Reparent(HWND parent, bool visible)
{
    mParentWin = parent;
    if (!mController) return;
    // Move first, then size, then reveal: showing before the bounds are right
    // costs an extra composite of the old geometry.
    mController->put_ParentWindow(parent);
    ConfigureControllerRendering(mController, parent, mDark);
    Resize();
    // Required after put_ParentWindow / moving between HWNDs; without it
    // WebView2 can keep compositing into a stale (often black) surface.
    mController->NotifyParentWindowPositionChanged();
    mController->put_IsVisible(visible ? TRUE : FALSE);
}

void CWebView2Host::Park()
{
    CancelEpf();
    // Only a fully-live instance is worth keeping, and only one at a time.
    if (!g_keepWarm || g_parked || mClosed || mFailed || !mController || !mPageReady) {
        Close();
        Release();
        return;
    }

    HWND holder = HolderWindow();
    if (!holder) {
        Close();
        Release();
        return;
    }

    StopWatch();               // no document, nothing to watch
    mFilePath.clear();
    mOnFileOpened = nullptr;   // it points at the window being closed
    mOnDirtyChanged = nullptr;
    mDirty = false;            // the next file this instance shows starts clean
    mDirtyFile = mDirtyModule = false;
    SendCommand(L"park");
    Reparent(holder, true);
    mParked = true;
    g_parked = this;
}

// --- Wiring ----------------------------------------------------------------

void CWebView2Host::ConfigureSettings()
{
    ICoreWebView2Settings* settings = NULL;
    if (SUCCEEDED(mWebView->get_Settings(&settings)) && settings) {
        settings->put_AreDefaultContextMenusEnabled(TRUE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_IsBuiltInErrorPageEnabled(FALSE);

        /* With DevTools disabled, WebView2 still reserves F12 (and other
         * browser accelerators: Ctrl+F, Ctrl+P, F5, F7...) at the host level
         * and never delivers the keydown to the page at all. Monaco's own
         * F12 binding ("Go to Definition") is then silently unreachable.
         * ICoreWebView2Settings3 lets accelerator keys pass through to the
         * page instead of being swallowed. */
        ICoreWebView2Settings3* settings3 = NULL;
        if (SUCCEEDED(settings->QueryInterface(IID_PPV_ARGS(&settings3))) && settings3) {
            settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
            settings3->Release();
        }
        settings->Release();
    }
}

// Total Commander is system-DPI aware (dpiAware=true, not Per-Monitor V2).
// WebView2's default monitor-scale tracking then drifts from the HWND's
// coordinate space — especially on a secondary display — so Monaco's
// scrollTop and painted view-lines disagree: scrolling down leaves a growing
// blank band until the view is empty. Lock rasterization to the host DPI.
static double HostRasterizationScale(HWND hwnd)
{
    HMODULE user32 = GetModuleHandleW(L"user32.dll");
    auto getCtx = (DPI_AWARENESS_CONTEXT (WINAPI*)())GetProcAddress(user32, "GetThreadDpiAwarenessContext");
    auto fromCtx = (DPI_AWARENESS (WINAPI*)(DPI_AWARENESS_CONTEXT))GetProcAddress(user32, "GetAwarenessFromDpiAwarenessContext");
    if (getCtx && fromCtx && fromCtx(getCtx()) == DPI_AWARENESS_UNAWARE)
        return 1.0;

    auto getDpiWnd = (UINT (WINAPI*)(HWND))GetProcAddress(user32, "GetDpiForWindow");
    if (getDpiWnd && hwnd) {
        UINT dpi = getDpiWnd(hwnd);
        if (dpi > 0) return (double)dpi / 96.0;
    }
    auto getDpiSys = (UINT (WINAPI*)())GetProcAddress(user32, "GetDpiForSystem");
    if (getDpiSys) {
        UINT dpi = getDpiSys();
        if (dpi > 0) return (double)dpi / 96.0;
    }
    return 1.0;
}

static void ConfigureControllerRendering(ICoreWebView2Controller* ctrl, HWND hwnd, bool dark)
{
    if (!ctrl) return;
    (void)dark;   // visible colour comes from the page; keep the surface white

    ctrl->put_ZoomFactor(1.0);

    ICoreWebView2Controller2* c2 = NULL;
    if (SUCCEEDED(ctrl->QueryInterface(__uuidof(ICoreWebView2Controller2), (void**)&c2)) && c2) {
        /* A dark DefaultBackgroundColor behind a still-loading document shows
         * up as a solid black first frame. The page sets its own background. */
        COREWEBVIEW2_COLOR bg = { 255, 255, 255, 255 };
        c2->put_DefaultBackgroundColor(bg);
        c2->Release();
    }

    ICoreWebView2Controller3* c3 = NULL;
    if (SUCCEEDED(ctrl->QueryInterface(__uuidof(ICoreWebView2Controller3), (void**)&c3)) && c3) {
        c3->put_ShouldDetectMonitorScaleChanges(FALSE);
        c3->put_RasterizationScale(HostRasterizationScale(hwnd));
        c3->Release();
    }
}

void CWebView2Host::OnControllerCreated(HRESULT hr, ICoreWebView2Controller* ctrl)
{
    if (mClosed) return;

    if (FAILED(hr) || !ctrl) {
        g_lastEnvHr = FAILED(hr) ? hr : E_FAIL;
        PostMessageW(mParentWin, WM_BSLVIEW_WEBVIEW_FAILED, (WPARAM)g_lastEnvHr, 0);
        return;
    }

    mController = ctrl;
    mController->AddRef();
    if (FAILED(mController->get_CoreWebView2(&mWebView)) || !mWebView) {
        PostMessageW(mParentWin, WM_BSLVIEW_WEBVIEW_FAILED, 0, 0);
        return;
    }

    ConfigureSettings();
    ConfigureControllerRendering(mController, mParentWin, mDark);

    ICoreWebView2_3* wv3 = NULL;
    if (SUCCEEDED(mWebView->QueryInterface(__uuidof(ICoreWebView2_3), (void**)&wv3)) && wv3) {
        wv3->SetVirtualHostNameToFolderMapping(
            BSLVIEW_VIRTUAL_HOST, mWebRoot.c_str(),
            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
        wv3->Release();
    }

    EventRegistrationToken token;
    WebMessageHandler* wm = new WebMessageHandler(this);
    mWebView->add_WebMessageReceived(wm, &token);
    wm->Release();

    mWebView->AddWebResourceRequestedFilter(
        L"https://" BSLVIEW_CONFIG_HOST L"/*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
    WebResourceHandler* wr = new WebResourceHandler(this);
    mWebView->add_WebResourceRequested(wr, &token);
    wr->Release();

    NavigationStartingHandler* nav = new NavigationStartingHandler();
    mWebView->add_NavigationStarting(nav, &token);
    nav->Release();

    NewWindowHandler* nw = new NewWindowHandler();
    mWebView->add_NewWindowRequested(nw, &token);
    nw->Release();

    ProcessFailedHandler* pf = new ProcessFailedHandler(this);
    mWebView->add_ProcessFailed(pf, &token);
    pf->Release();

    Resize();
    mController->put_IsVisible(TRUE);

    mWebView->Navigate(L"https://" BSLVIEW_VIRTUAL_HOST L"/viewer.html");
}

void CWebView2Host::Resize()
{
    if (!mController || !mParentWin) return;
    ConfigureControllerRendering(mController, mParentWin, mDark);
    RECT bounds;
    GetClientRect(mParentWin, &bounds);
    mController->put_Bounds(bounds);
}

// --- Messaging -------------------------------------------------------------

void CWebView2Host::PostJson(const std::wstring& json)
{
    if (mWebView) mWebView->PostWebMessageAsJson(json.c_str());
}

#ifndef URL_UNESCAPE_AS_UTF8
#define URL_UNESCAPE_AS_UTF8 0x00040000
#endif

/* https://bslcfg.invalid/file?p=<absolute path>[&exists=1]
 * Serves configuration files to the page's shared form-context.js. Only files
 * below the current form's FormContextRoots() are visible; everything else is
 * a plain 404, exactly like a missing file. */
void CWebView2Host::OnWebResourceRequested(ICoreWebView2WebResourceRequestedEventArgs* args)
{
    if (!args || !g_env) return;
    std::wstring uri;
    std::wstring method;
    std::string batchBody;
    bool batchBodyOk = false;
    const std::wstring batchUri = L"https://" BSLVIEW_CONFIG_HOST L"/batch";
    ICoreWebView2WebResourceRequest* request = NULL;
    if (SUCCEEDED(args->get_Request(&request)) && request) {
        LPWSTR raw = NULL;
        if (SUCCEEDED(request->get_Uri(&raw)) && raw) {
            uri = raw;
            CoTaskMemFree(raw);
        }
        raw = NULL;
        if (SUCCEEDED(request->get_Method(&raw)) && raw) {
            method = raw;
            CoTaskMemFree(raw);
        }
        if (_wcsicmp(uri.c_str(), batchUri.c_str()) == 0 && method == L"POST")
            batchBodyOk = ReadRequestBody(request, batchBody);
        request->Release();
    }

    ICoreWebView2Deferral* deferral = NULL;
    if (batchBodyOk && BatchWindow() && SUCCEEDED(args->GetDeferral(&deferral)) && deferral) {
        BatchJob* job = new BatchJob();
        job->args = args;
        job->args->AddRef();
        job->deferral = deferral;
        std::vector<std::wstring> roots = mContextRoots;
        HWND target = g_batchWnd;
        ++g_batchJobs;
        std::thread([job, roots, target, body = std::move(batchBody)]() {
            ContextBatchAccess access;
            access.file = [&roots](const std::wstring& path) {
                if (PathIsRelativeW(path.c_str())) return false;
                for (size_t i = 0; i < roots.size(); ++i)
                    if (PathIsUnderRoot(roots[i], path)) return true;
                return false;
            };
            access.directory = access.file;
            try {
                job->result = HandleContextBatch(body, access);
            } catch (...) {
                job->result = ContextBatchResult();
                job->result.status = 400;
            }
            if (!PostMessageW(target, WM_BSLVIEW_BATCH_DONE, 0, (LPARAM)job)) {
                /* The UI thread is gone; the page went with it. */
                --g_batchJobs;
            }
        }).detach();
        return;
    }

    int status = 404;
    const wchar_t* reason = L"Not Found";
    IStream* body = NULL;
    const std::wstring prefix = L"https://" BSLVIEW_CONFIG_HOST L"/file?";
    if (uri.size() > prefix.size() && _wcsnicmp(uri.c_str(), prefix.c_str(), prefix.size()) == 0) {
        std::wstring query = uri.substr(prefix.size());
        std::wstring path;
        bool existsOnly = false;
        size_t start = 0;
        while (start < query.size()) {
            size_t amp = query.find(L'&', start);
            std::wstring pair = query.substr(start, amp == std::wstring::npos ? std::wstring::npos : amp - start);
            if (pair.compare(0, 2, L"p=") == 0) {
                std::vector<wchar_t> buffer(pair.begin() + 2, pair.end());
                buffer.push_back(L'\0');
                DWORD length = (DWORD)buffer.size();
                if (SUCCEEDED(UrlUnescapeW(buffer.data(), NULL, &length,
                        URL_UNESCAPE_INPLACE | URL_UNESCAPE_AS_UTF8)))
                    path = buffer.data();
            } else if (pair == L"exists=1") {
                existsOnly = true;
            }
            if (amp == std::wstring::npos) break;
            start = amp + 1;
        }
        bool allowed = false;
        if (!path.empty() && !PathIsRelativeW(path.c_str())) {
            for (size_t i = 0; i < mContextRoots.size() && !allowed; ++i)
                allowed = PathIsUnderRoot(mContextRoots[i], path);
        }
        DWORD attributes = allowed ? GetFileAttributesW(path.c_str()) : INVALID_FILE_ATTRIBUTES;
        bool visible = attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_DIRECTORY);
        if (existsOnly) {
            /* Existence checks answer 200 with "1"/"0": the resolver checks many
             * candidate locations and a 404 per miss floods the page console. */
            status = 200;
            reason = L"OK";
            body = SHCreateMemStream((const BYTE*)(visible ? "1" : "0"), 1);
        } else if (visible && SUCCEEDED(SHCreateStreamOnFileEx(path.c_str(), STGM_READ | STGM_SHARE_DENY_NONE,
                FILE_ATTRIBUTE_NORMAL, FALSE, NULL, &body)) && body) {
            status = 200;
            reason = L"OK";
        }
    }

    const wchar_t* headers = L"Access-Control-Allow-Origin: https://" BSLVIEW_VIRTUAL_HOST L"\r\n"
        L"Cache-Control: no-store\r\n"
        L"Content-Type: application/octet-stream";
    ICoreWebView2WebResourceResponse* response = NULL;
    if (SUCCEEDED(g_env->CreateWebResourceResponse(body, status, reason, headers, &response)) && response) {
        args->put_Response(response);
        response->Release();
    }
    if (body) body->Release();
}

void CWebView2Host::Load(const BslLoadRequest& req)
{
    // Another file of Total Commander replaces the panel an unpacking reports to.
    if (!mNavigating) {
        CancelEpf();
        mEpfPath.clear();
    }
    mDark = req.dark;
    mFontSize = req.fontSize;
    mReadOnly = req.readOnly;
    mFocusEditorOnPaint = req.initialLine > 0 || !req.initialSearch.empty();
    /* Another file sits in another place in git, or in none. What the last
     * one found says nothing about this one. */
    mGitFileInfo = git::FileInfo();
    mGitModuleInfo = git::FileInfo();
    ++mGitGen;
    if (mController) ConfigureControllerRendering(mController, mParentWin, mDark);

    std::wstring json;
    json.reserve(req.content.size() + 256);
    json += L"{\"cmd\":\"load\",\"language\":\"";
    for (const char* p = req.language; *p; p++) json += (wchar_t)*p;
    json += L"\",\"theme\":\"";
    json += req.dark ? L"dark" : L"light";
    json += L"\",\"fontSize\":";
    json += std::to_wstring(req.fontSize > 0 ? req.fontSize : 14);
    json += L",\"readOnly\":";
    json += req.readOnly ? L"true" : L"false";
    if (mOnOpenSettings) json += L",\"settings\":true";
    if (!mOpenTemplates.empty()) json += L",\"openTemplates\":\"" + mOpenTemplates + L"\"";
    if (!mOpenModules.empty()) json += L",\"openModules\":\"" + mOpenModules + L"\"";
    json += L",\"content\":\"";
    json += JsonEscape(req.content);
    json += L"\"";
    json += L",\"path\":\"";
    json += JsonEscape(mFilePath);
    json += L"\"";
    if (req.initialLine > 0) {
        json += L",\"line\":";
        json += std::to_wstring(req.initialLine);
    }
    if (!req.initialSearch.empty()) {
        json += L",\"search\":\"";
        json += JsonEscape(req.initialSearch);
        json += L"\",\"regexp\":";
        json += req.initialRegexp ? L"true" : L"false";
        json += L",\"matchCase\":";
        json += req.initialMatchCase ? L"true" : L"false";
    }
    if (!req.previewSession.empty()) {
        json += L",\"previewSession\":\"";
        json += JsonEscape(req.previewSession);
        json += L"\"";
    }
    json += L",\"formTitle\":\"";
    json += JsonEscape(FormSnapshotBaseName(mFilePath.c_str()));
    json += L"\"";
    std::wstring formModulePath = FindFormModuleFile(mFilePath.c_str());
    TextFile formModule = formModulePath.empty()
        ? TextFile() : ReadTextFile(formModulePath.c_str(), 64 * 1024 * 1024);
    mFormModulePath.clear();
    if (formModule.ok) {
        mFormModulePath = formModulePath;
        mFormModuleEncoding = formModule.encoding;
        mFormModuleRevision = formModule.revision;
        json += L",\"formModule\":\"";
        json += JsonEscape(formModule.text);
        json += L"\",\"formModulePath\":\"";
        json += JsonEscape(formModulePath);
        json += L"\"";
        if (req.openFormModule) json += L",\"formView\":\"module\"";
    }
    mAllowedRoots.clear();
    size_t rootSlash = mFilePath.find_last_of(L"\\/");
    if (rootSlash != std::wstring::npos) mAllowedRoots.push_back(mFilePath.substr(0, rootSlash));
    /* Object metadata, the base cf form, style items, common commands and
     * pictures are resolved in the page by the shared form-context.js - the
     * same code the MCP server runs - reading through BSLVIEW_CONFIG_HOST. */
    mContextRoots = FormContextRoots(mFilePath.c_str());
    if (!mNavigating) mNavRoots.clear();
    mNavigating = false;
    for (const std::wstring& contextRoot : mContextRoots) {
        bool known = false;
        for (const std::wstring& navRoot : mNavRoots)
            known = known || _wcsicmp(navRoot.c_str(), contextRoot.c_str()) == 0;
        if (!known) mNavRoots.push_back(contextRoot);
    }
    json += L",\"resolveContext\":true";
    json += L"}";

    /* A newly loaded document holds nothing the file does not: the page says so
     * too, but only once it has a model, and the marker must not outlive the
     * file it belonged to for even that long. */
    mDirty = mDirtyFile = mDirtyModule = false;

    if (mPageReady) {
        PostJson(json);
    } else {
        mPendingJson.swap(json);
        mHasPending = true;
    }
    PublishWatch();
}

void CWebView2Host::OnPageReady()
{
    mPageReady = true;
    if (mHasPending) {
        mHasPending = false;
        PostJson(mPendingJson);
        mPendingJson.clear();
        mPendingJson.shrink_to_fit();
    }
}

void CWebView2Host::SendCommand(const wchar_t* cmd)
{
    if (!mPageReady) return;
    std::wstring json = L"{\"cmd\":\"";
    json += cmd;
    json += L"\"}";
    PostJson(json);
}

bool CWebView2Host::RequestClose()
{
    if (!mPageReady) return false;
    SendCommand(L"confirmClose");
    return true;
}

void CWebView2Host::Find(const std::wstring& text, bool matchCase, bool wholeWords, bool backwards, bool first)
{
    if (!mPageReady) return;
    std::wstring json = L"{\"cmd\":\"find\",\"text\":\"";
    json += JsonEscape(text);
    json += L"\",\"matchCase\":";  json += matchCase ? L"true" : L"false";
    json += L",\"wholeWords\":";   json += wholeWords ? L"true" : L"false";
    json += L",\"backwards\":";    json += backwards ? L"true" : L"false";
    json += L",\"first\":";        json += first ? L"true" : L"false";
    json += L"}";
    PostJson(json);
}

// Minimal extraction of a JSON string field; the viewer is the only producer of
// these messages, so a full parser would be overkill.
static bool JsonFieldEquals(const std::wstring& json, const wchar_t* key, const wchar_t* value)
{
    std::wstring pat = L"\"";
    pat += key;
    pat += L"\":\"";
    size_t at = json.find(pat);
    if (at == std::wstring::npos) return false;
    at += pat.size();
    size_t end = json.find(L'"', at);
    if (end == std::wstring::npos) return false;
    return json.compare(at, end - at, value) == 0;
}

static bool JsonUnescapeField(const std::wstring& json, const wchar_t* key, std::wstring& out)
{
    std::wstring pat = L"\"";
    pat += key;
    pat += L"\":\"";
    size_t at = json.find(pat);
    if (at == std::wstring::npos) return false;
    at += pat.size();

    out.clear();
    out.reserve(json.size() - at);
    for (size_t i = at; i < json.size(); i++) {
        wchar_t ch = json[i];
        if (ch == L'"') return true;
        if (ch != L'\\') { out += ch; continue; }
        if (++i >= json.size()) return false;
        switch (json[i]) {
        case L'"':  out += L'"';  break;
        case L'\\': out += L'\\'; break;
        case L'/':  out += L'/';  break;
        case L'b':  out += L'\b'; break;
        case L'f':  out += L'\f'; break;
        case L'n':  out += L'\n'; break;
        case L'r':  out += L'\r'; break;
        case L't':  out += L'\t'; break;
        case L'u': {
            if (i + 4 >= json.size()) return false;
            wchar_t code = 0;
            for (int k = 1; k <= 4; k++) {
                wchar_t d = json[i + k];
                code <<= 4;
                if (d >= L'0' && d <= L'9') code |= (d - L'0');
                else if (d >= L'a' && d <= L'f') code |= (d - L'a' + 10);
                else if (d >= L'A' && d <= L'F') code |= (d - L'A' + 10);
                else return false;
            }
            out += code;
            i += 4;
            break;
        }
        default: return false;
        }
    }
    return false;
}

static const wchar_t* EncodingName(TextEncoding enc)
{
    switch (enc) {
    case ENC_UTF8_BOM: return L"utf8bom";
    case ENC_UTF8: return L"utf8";
    case ENC_UTF16LE: return L"utf16le";
    case ENC_UTF16BE: return L"utf16be";
    default: return L"ansi";
    }
}

static std::wstring ChooseFolder(HWND owner, const std::wstring& suggest,
                                 const wchar_t* title = L"Выберите корень конфигурации 1С")
{
    IFileOpenDialog* dialog = NULL;
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, NULL, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&dialog))) || !dialog) return std::wstring();
    DWORD opts = 0;
    dialog->GetOptions(&opts);
    dialog->SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
    dialog->SetTitle(title);
    if (!suggest.empty()) {
        IShellItem* item = NULL;
        if (SUCCEEDED(SHCreateItemFromParsingName(suggest.c_str(), NULL, IID_PPV_ARGS(&item))) && item) {
            dialog->SetFolder(item);
            item->Release();
        }
    }
    std::wstring result;
    if (SUCCEEDED(dialog->Show(owner))) {
        IShellItem* item = NULL;
        if (SUCCEEDED(dialog->GetResult(&item)) && item) {
            PWSTR path = NULL;
            if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) && path) {
                result = path;
                CoTaskMemFree(path);
            }
            item->Release();
        }
    }
    dialog->Release();
    return result;
}

static bool FileExists(const std::wstring& path)
{
    DWORD attrs = GetFileAttributesW(path.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}

/* The BSLEdit that opens an object of the configuration window in a window
 * of its own: BSLEdit itself, a copy next to the plugin, or the one that
 * registered itself for .bsl files. Empty when there is none. */
static std::wstring EditorExecutable(const std::wstring& webRoot)
{
    wchar_t exe[MAX_PATH] = {};
    if (g_standalone && GetModuleFileNameW(NULL, exe, MAX_PATH)) return exe;
    std::wstring dir = webRoot;
    while (!dir.empty() && (dir.back() == L'\\' || dir.back() == L'/')) dir.pop_back();
    size_t slash = dir.find_last_of(L"\\/");
    if (slash != std::wstring::npos) {
        std::wstring nearby = dir.substr(0, slash + 1) + L"BSLEdit.exe";
        if (FileExists(nearby)) return nearby;
    }
    wchar_t cmd[2048] = {};
    DWORD size = sizeof(cmd);
    if (RegGetValueW(HKEY_CURRENT_USER, L"Software\\Classes\\Applications\\BSLEdit.exe\\shell\\open\\command",
                     NULL, RRF_RT_REG_SZ, NULL, cmd, &size) != ERROR_SUCCESS)
        return std::wstring();
    std::wstring line = cmd;   // "C:\...\BSLEdit.exe" "%1"
    if (line.size() < 2 || line[0] != L'"') return std::wstring();
    size_t close = line.find(L'"', 1);
    std::wstring registered = close == std::wstring::npos ? std::wstring() : line.substr(1, close - 1);
    return FileExists(registered) ? registered : std::wstring();
}

static std::wstring QuoteCommandArgument(const std::wstring& value);

static bool StartEditor(const std::wstring& exe, const std::wstring& path, int line,
                        const std::wstring& search, bool regexp, bool matchCase,
                        bool pack = false)
{
    std::wstring cmdLine = QuoteCommandArgument(exe) + L" " + QuoteCommandArgument(path);
    if (line > 0) cmdLine += L" --line " + std::to_wstring(line);
    if (!search.empty()) cmdLine += L" --find " + QuoteCommandArgument(search);
    if (regexp) cmdLine += L" --regexp";
    if (matchCase) cmdLine += L" --match-case";
    if (pack) cmdLine += L" --pack";
    std::vector<wchar_t> buf(cmdLine.begin(), cmdLine.end());
    buf.push_back(0);
    STARTUPINFOW si = {};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi = {};
    if (!CreateProcessW(exe.c_str(), buf.data(), NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi))
        return false;
    // The new window may take the foreground from this one.
    AllowSetForegroundWindow(pi.dwProcessId);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return true;
}

// --- Saving binary templates -------------------------------------------------
//
// A template of binary data, an add-in or an Active document keeps its
// content in Ext/Template.bin, which nothing in the page can show. The page
// asks for it to be saved ("saveTemplate"); the host picks the extension from
// the content, asks where to and writes the file.

static bool ReadWholeFile(const std::wstring& path, std::string& out, size_t limit)
{
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return false;
    LARGE_INTEGER size = {};
    bool ok = GetFileSizeEx(h, &size) && (unsigned long long)size.QuadPart <= limit;
    if (ok) {
        out.resize((size_t)size.QuadPart);
        DWORD read = 0;
        ok = out.empty() || (ReadFile(h, &out[0], (DWORD)out.size(), &read, NULL) && read == out.size());
    }
    CloseHandle(h);
    return ok;
}

static bool WriteWholeFile(const std::wstring& path, const std::string& data)
{
    HANDLE h = CreateFileW(path.c_str(), GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return false;
    DWORD written = 0;
    bool ok = data.empty() || (WriteFile(h, data.data(), (DWORD)data.size(), &written, NULL) && written == data.size());
    CloseHandle(h);
    if (!ok) DeleteFileW(path.c_str());
    return ok;
}

static bool StartsWith(const std::string& data, const char* prefix, size_t at = 0)
{
    size_t n = strlen(prefix);
    return data.size() >= at + n && memcmp(data.data() + at, prefix, n) == 0;
}

/* An Active document is kept as {0,<CLSID>,{#base64:<OLE storage>}}: the
 * storage alone is the Office file. False when it is not laid out so. */
static bool UnwrapActiveDocument(const std::string& data, std::string& out, std::string& clsid)
{
    size_t start = StartsWith(data, "\xEF\xBB\xBF") ? 3 : 0;
    if (!StartsWith(data, "{0,", start)) return false;
    size_t comma = data.find(',', start + 3);
    size_t b64 = data.find("{#base64:", start);
    if (comma == std::string::npos || b64 == std::string::npos || comma > b64) return false;
    clsid = data.substr(start + 3, comma - start - 3);
    size_t from = b64 + 9;
    size_t end = data.find('}', from);
    if (end == std::string::npos) return false;
    std::string text = data.substr(from, end - from);
    DWORD size = 0;
    if (!CryptStringToBinaryA(text.c_str(), (DWORD)text.size(), CRYPT_STRING_BASE64, NULL, &size, NULL, NULL))
        return false;
    out.resize(size);
    if (!size || !CryptStringToBinaryA(text.c_str(), (DWORD)text.size(), CRYPT_STRING_BASE64,
                                       (BYTE*)&out[0], &size, NULL, NULL))
        return false;
    out.resize(size);
    return true;
}

/* The Office application an Active document belongs to, by its CLSID. */
static const wchar_t* ActiveDocumentExtension(const std::string& clsid)
{
    std::string id = clsid;
    for (char& c : id) c = (char)tolower((unsigned char)c);
    if (id.compare(0, 8, "00020820") == 0 || id.compare(0, 8, "00020810") == 0) return L"xls";
    if (id.compare(0, 8, "00020906") == 0 || id.compare(0, 8, "00020900") == 0) return L"doc";
    if (id.compare(0, 8, "64818d10") == 0) return L"ppt";
    return L"bin";
}

/* The extension of a file loaded into a binary data template, guessed from
 * its first bytes; "bin" when nothing is recognised. */
static const wchar_t* BinaryDataExtension(const std::string& data)
{
    if (StartsWith(data, "MZ")) {
        /* A PE image: IMAGE_FILE_DLL in its file header tells a library. */
        if (data.size() >= 0x40) {
            DWORD pe = *(const DWORD*)(data.data() + 0x3C);
            if ((size_t)pe + 24 <= data.size() && memcmp(data.data() + pe, "PE\0\0", 4) == 0) {
                WORD flags = *(const WORD*)(data.data() + pe + 4 + 18);
                return (flags & 0x2000) ? L"dll" : L"exe";
            }
        }
        return L"exe";
    }
    if (StartsWith(data, "PK\x03\x04")) return L"zip";
    if (StartsWith(data, "%PDF")) return L"pdf";
    if (StartsWith(data, "\x89PNG")) return L"png";
    if (StartsWith(data, "\xFF\xD8\xFF")) return L"jpg";
    if (StartsWith(data, "GIF8")) return L"gif";
    if (StartsWith(data, "BM")) return L"bmp";
    if (StartsWith(data, "\xD0\xCF\x11\xE0")) return L"bin";
    /* Text: skip a BOM and leading white space, then look at the first sign. */
    size_t i = StartsWith(data, "\xEF\xBB\xBF") ? 3 : 0;
    size_t limit = data.size() < 4096 ? data.size() : 4096;
    for (size_t k = i; k < limit; ++k) {
        unsigned char c = (unsigned char)data[k];
        if (c < 9 || (c > 13 && c < 32)) return L"bin";
    }
    while (i < data.size() && isspace((unsigned char)data[i])) ++i;
    if (i >= data.size()) return L"txt";
    std::string head = data.substr(i, 256);
    for (char& c : head) c = (char)tolower((unsigned char)c);
    if (head[0] == '{' || head[0] == '[') return L"json";
    if (head.compare(0, 9, "<!doctype") == 0 || head.compare(0, 5, "<html") == 0) return L"html";
    if (head[0] == '<') return L"xml";
    return L"txt";
}

struct InstalledAgent {
    const wchar_t* name;
    enum LaunchKind {
        Cli,
        ProjectUrl,
        CodexProjectUrl,
        CursorPromptUrl,
        DirectoryVerb,
        ProjectExecutable,
        PackagedProjectApplication,
        CodexPackagedProjectApplication
    } kind;
    std::wstring target;
    std::wstring arguments;
};

static bool FindCommandOnPath(const wchar_t* name, std::wstring& found)
{
    static const wchar_t* extensions[] = { L".exe", L".cmd", L".bat" };
    wchar_t path[32768];
    for (size_t i = 0; i < _countof(extensions); ++i) {
        DWORD length = SearchPathW(NULL, name, extensions[i], _countof(path), path, NULL);
        if (length > 0 && length < _countof(path)) {
            found.assign(path, length);
            return true;
        }
    }
    return false;
}

static int JsonPositiveIntField(const std::wstring& json, const wchar_t* key)
{
    std::wstring pat = L"\"";
    pat += key;
    pat += L"\":";
    size_t at = json.find(pat);
    if (at == std::wstring::npos) return 0;
    at += pat.size();
    unsigned long value = 0;
    size_t digits = 0;
    while (at + digits < json.size() && json[at + digits] >= L'0' && json[at + digits] <= L'9') {
        value = value * 10 + (json[at + digits] - L'0');
        if (value > 0x7fffffffUL) return 0;
        ++digits;
    }
    return digits && value ? (int)value : 0;
}

static std::wstring QuoteCommandArgument(const std::wstring& value)
{
    std::wstring out = L"\"";
    size_t slashes = 0;
    for (size_t i = 0; i < value.size(); ++i) {
        wchar_t c = value[i];
        if (c == L'\\') { ++slashes; continue; }
        if (c == L'\"') {
            out.append(slashes * 2 + 1, L'\\');
            out += c;
            slashes = 0;
            continue;
        }
        out.append(slashes, L'\\');
        slashes = 0;
        out += c;
    }
    out.append(slashes * 2, L'\\');
    out += L'\"';
    return out;
}

static bool HasUrlProtocolHandler(const wchar_t* protocol)
{
    DWORD length = 0;
    HRESULT hr = AssocQueryStringW(ASSOCF_IS_PROTOCOL, ASSOCSTR_EXECUTABLE,
                                   protocol, L"open", NULL, &length);
    if (hr != S_FALSE || length < 2) return false;
    std::vector<wchar_t> executable(length);
    return SUCCEEDED(AssocQueryStringW(ASSOCF_IS_PROTOCOL, ASSOCSTR_EXECUTABLE,
                                      protocol, L"open", executable.data(), &length))
        && executable[0] != L'\0';
}

static bool IsPackageFamilyInstalled(const wchar_t* packageFamily)
{
    typedef LONG (WINAPI* GetPackagesByPackageFamilyFn)(PCWSTR, UINT32*, PWSTR*, UINT32*, PWSTR);
    HMODULE kernel = GetModuleHandleW(L"kernel32.dll");
    GetPackagesByPackageFamilyFn getPackages = kernel
        ? reinterpret_cast<GetPackagesByPackageFamilyFn>(
            GetProcAddress(kernel, "GetPackagesByPackageFamily"))
        : NULL;
    if (!getPackages) return false;

    UINT32 count = 0;
    UINT32 bufferLength = 0;
    LONG result = getPackages(packageFamily, &count, NULL, &bufferLength, NULL);
    return result == ERROR_INSUFFICIENT_BUFFER && count > 0;
}

static bool HasDirectoryVerb(const wchar_t* verb)
{
    std::wstring key = L"Software\\Classes\\Directory\\shell\\";
    key += verb;
    key += L"\\command";
    HKEY handle = NULL;
    LONG result = RegOpenKeyExW(HKEY_CURRENT_USER, key.c_str(), 0, KEY_QUERY_VALUE, &handle);
    if (result == ERROR_SUCCESS) RegCloseKey(handle);
    return result == ERROR_SUCCESS;
}

static std::wstring LocalAppExecutable(const wchar_t* relativePath)
{
    wchar_t localAppData[32768];
    DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, _countof(localAppData));
    if (!length || length >= _countof(localAppData)) return L"";
    std::wstring path(localAppData, length);
    path += L"\\";
    path += relativePath;
    DWORD attributes = GetFileAttributesW(path.c_str());
    return attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_DIRECTORY)
        ? path : L"";
}

static std::wstring PercentEncodeQueryValue(const std::wstring& value)
{
    int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS,
                                     value.c_str(), (int)value.size(), NULL, 0, NULL, NULL);
    if (length <= 0) return L"";
    std::string utf8((size_t)length, '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.c_str(), (int)value.size(),
                        &utf8[0], length, NULL, NULL);
    static const wchar_t hex[] = L"0123456789ABCDEF";
    std::wstring encoded;
    encoded.reserve(utf8.size() * 3);
    for (unsigned char c : utf8) {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '-' || c == '.' || c == '_' || c == '~') {
            encoded += (wchar_t)c;
        } else {
            encoded += L'%';
            encoded += hex[c >> 4];
            encoded += hex[c & 15];
        }
    }
    return encoded;
}

static bool ShellLaunch(HWND owner, const wchar_t* verb, const std::wstring& target,
                        const wchar_t* parameters, const wchar_t* workDir, DWORD& error)
{
    HINSTANCE result = ShellExecuteW(owner, verb, target.c_str(), parameters, workDir, SW_SHOWNORMAL);
    INT_PTR code = (INT_PTR)result;
    if (code > 32) {
        error = ERROR_SUCCESS;
        return true;
    }
    error = (DWORD)code;
    return false;
}

static bool ActivatePackagedApplication(const std::wstring& appUserModelId,
                                         const std::wstring& arguments, DWORD& error)
{
    IApplicationActivationManager* manager = NULL;
    HRESULT hr = CoCreateInstance(CLSID_ApplicationActivationManager, NULL,
                                  CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&manager));
    if (SUCCEEDED(hr)) {
        DWORD processId = 0;
        CoAllowSetForegroundWindow(manager, NULL);
        hr = manager->ActivateApplication(appUserModelId.c_str(), arguments.c_str(),
                                          AO_NONE, &processId);
        manager->Release();
    }
    if (SUCCEEDED(hr)) {
        error = ERROR_SUCCESS;
        return true;
    }
    error = HRESULT_FACILITY(hr) == FACILITY_WIN32 ? HRESULT_CODE(hr) : (DWORD)hr;
    return false;
}

static bool LaunchAgentForFile(HWND owner, const InstalledAgent& agent,
                               const std::wstring& filePath, DWORD& error)
{
    wchar_t absolute[32768];
    DWORD length = GetFullPathNameW(filePath.c_str(), _countof(absolute), absolute, NULL);
    if (!length || length >= _countof(absolute)) {
        error = GetLastError();
        return false;
    }

    std::wstring fullPath(absolute, length);
    std::wstring workDir = AgentWorkingDirectoryForPath(fullPath.c_str());

    if (agent.kind == InstalledAgent::CodexProjectUrl ||
        agent.kind == InstalledAgent::CodexPackagedProjectApplication) {
        // Codex treats --open-project's next argument only as the workspace.
        // A new-thread deep link is the supported way to keep that workspace
        // while also pre-filling the composer with the file the user clicked.
        std::wstring url = L"codex://threads/new?path=" + PercentEncodeQueryValue(workDir)
                         + L"&prompt=" + PercentEncodeQueryValue(fullPath);
        if (agent.kind == InstalledAgent::CodexProjectUrl)
            return ShellLaunch(owner, L"open", url, NULL, workDir.c_str(), error);
        return ActivatePackagedApplication(agent.target, QuoteCommandArgument(url), error);
    }
    if (agent.kind == InstalledAgent::ProjectUrl) {
        std::wstring url = agent.target + PercentEncodeQueryValue(workDir);
        return ShellLaunch(owner, L"open", url, NULL, workDir.c_str(), error);
    }
    if (agent.kind == InstalledAgent::CursorPromptUrl) {
        // Cursor's prompt deep link routes to an existing workspace by name
        // and pre-fills the Agent composer without submitting the request.
        const wchar_t* workspaceName = PathFindFileNameW(workDir.c_str());
        std::wstring url = L"cursor://anysphere.cursor-deeplink/prompt?text="
                         + PercentEncodeQueryValue(fullPath)
                         + L"&workspace=" + PercentEncodeQueryValue(workspaceName)
                         + L"&mode=agent";
        return ShellLaunch(owner, L"open", url, NULL, workDir.c_str(), error);
    }
    if (agent.kind == InstalledAgent::DirectoryVerb)
        return ShellLaunch(owner, agent.target.c_str(), workDir, NULL, workDir.c_str(), error);
    if (agent.kind == InstalledAgent::ProjectExecutable) {
        std::wstring parameters = L"--open-workspace " + QuoteCommandArgument(workDir);
        return ShellLaunch(owner, L"open", agent.target, parameters.c_str(), workDir.c_str(), error);
    }
    if (agent.kind == InstalledAgent::PackagedProjectApplication) {
        std::wstring arguments = agent.arguments;
        if (!arguments.empty()) arguments += L" ";
        arguments += QuoteCommandArgument(workDir);
        return ActivatePackagedApplication(agent.target, arguments, error);
    }

    std::wstring invocation = QuoteCommandArgument(agent.target);
    if (!agent.arguments.empty()) {
        invocation += L" ";
        invocation += agent.arguments;
    }
    invocation += L" ";
    invocation += QuoteCommandArgument(fullPath);

    std::wstring command;
    const wchar_t* ext = PathFindExtensionW(agent.target.c_str());
    if (_wcsicmp(ext, L".cmd") == 0 || _wcsicmp(ext, L".bat") == 0) {
        wchar_t comspec[32768];
        DWORD shellLength = GetEnvironmentVariableW(L"ComSpec", comspec, _countof(comspec));
        std::wstring shell = shellLength > 0 && shellLength < _countof(comspec)
            ? std::wstring(comspec, shellLength) : L"cmd.exe";
        command = QuoteCommandArgument(shell) + L" /D /S /K \"" + invocation + L"\"";
    } else {
        command = invocation;
    }

    std::vector<wchar_t> mutableCommand(command.begin(), command.end());
    mutableCommand.push_back(L'\0');
    STARTUPINFOW startup = {};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process = {};
    BOOL ok = CreateProcessW(NULL, mutableCommand.data(), NULL, NULL, FALSE,
                             CREATE_NEW_CONSOLE, NULL,
                             workDir.empty() ? NULL : workDir.c_str(), &startup, &process);
    if (!ok) {
        error = GetLastError();
        return false;
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    error = ERROR_SUCCESS;
    return true;
}

static bool CopyFilePathToClipboard(HWND owner, const std::wstring& filePath)
{
    wchar_t absolute[32768];
    DWORD length = GetFullPathNameW(filePath.c_str(), _countof(absolute), absolute, NULL);
    if (!length || length >= _countof(absolute)) return false;

    size_t bytes = (static_cast<size_t>(length) + 1) * sizeof(wchar_t);
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (!memory) return false;
    void* data = GlobalLock(memory);
    if (!data) {
        GlobalFree(memory);
        return false;
    }
    memcpy(data, absolute, bytes);
    GlobalUnlock(memory);

    if (!OpenClipboard(owner)) {
        GlobalFree(memory);
        return false;
    }
    bool copied = EmptyClipboard() && SetClipboardData(CF_UNICODETEXT, memory) != NULL;
    CloseClipboard();
    if (!copied) GlobalFree(memory);
    return copied;
}

static void ChooseAndLaunchAgent(HWND owner, const std::wstring& filePath)
{
    static const wchar_t* names[] = { L"Claude CLI", L"Codex CLI", L"Cursor CLI", L"ZCode CLI", L"Hermes CLI" };
    static const wchar_t* commands[] = { L"claude", L"codex", L"cursor", L"zcode", L"hermes" };
    static const wchar_t* arguments[] = { L"", L"", L"agent", L"", L"" };
    std::vector<InstalledAgent> installed;

    if (IsPackageFamilyInstalled(L"OpenAI.Codex_2p2nqsd0c76g0"))
        installed.push_back({ L"Codex App", InstalledAgent::CodexPackagedProjectApplication,
                              L"OpenAI.Codex_2p2nqsd0c76g0!App", L"" });
    else if (HasUrlProtocolHandler(L"codex"))
        installed.push_back({ L"Codex App", InstalledAgent::CodexProjectUrl, L"", L"" });

    if (IsPackageFamilyInstalled(L"Claude_pzs8sxrjxfjjc"))
        installed.push_back({ L"Claude App", InstalledAgent::PackagedProjectApplication,
                              L"Claude_pzs8sxrjxfjjc!Claude", L"--os-entry=folder_verb" });
    else if (HasDirectoryVerb(L"ClaudeCode"))
        installed.push_back({ L"Claude App", InstalledAgent::DirectoryVerb, L"ClaudeCode", L"" });

    std::wstring zcodeApp = LocalAppExecutable(L"Programs\\ZCode\\ZCode.exe");
    if (HasUrlProtocolHandler(L"zcode"))
        installed.push_back({ L"ZCode App", InstalledAgent::ProjectUrl,
                              L"zcode://workspace/open?path=", L"" });
    else if (!zcodeApp.empty())
        installed.push_back({ L"ZCode App", InstalledAgent::ProjectExecutable, zcodeApp, L"" });

    if (HasUrlProtocolHandler(L"cursor"))
        installed.push_back({ L"Cursor App", InstalledAgent::CursorPromptUrl, L"", L"" });

    for (size_t i = 0; i < _countof(commands); ++i) {
        std::wstring executable;
        if (FindCommandOnPath(commands[i], executable))
            installed.push_back({ names[i], InstalledAgent::Cli, executable, arguments[i] });
    }

    HMENU menu = CreatePopupMenu();
    if (!menu) return;
    for (size_t i = 0; i < installed.size(); ++i)
        AppendMenuW(menu, MF_STRING, (UINT_PTR)(i + 1), installed[i].name);
    if (!installed.empty()) AppendMenuW(menu, MF_SEPARATOR, 0, NULL);
    UINT copyPathCommand = (UINT)(installed.size() + 1);
    AppendMenuW(menu, MF_STRING, copyPathCommand, L"Копировать путь");
    POINT point;
    GetCursorPos(&point);
    UINT choice = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON,
                                 point.x, point.y, 0, owner, NULL);
    DestroyMenu(menu);
    if (!choice) return;
    if (choice == copyPathCommand) {
        if (!CopyFilePathToClipboard(owner, filePath))
            MessageBoxW(owner, L"Не удалось скопировать путь к файлу.",
                        L"AI-агент", MB_OK | MB_ICONERROR);
        return;
    }
    if (choice > installed.size()) return;

    DWORD error = ERROR_SUCCESS;
    size_t selected = choice - 1;
    if (!LaunchAgentForFile(owner, installed[selected], filePath, error)) {
        wchar_t message[256];
        swprintf_s(message, L"Не удалось запустить %s (ошибка Windows %lu).",
                   installed[selected].name, error);
        MessageBoxW(owner, message, L"AI-агент", MB_OK | MB_ICONERROR);
    }
}

void CWebView2Host::OnWebMessage(const std::wstring& msg)
{
    if (mClosed) return;

    if (msg.find(L"\"cmd\":\"epf") != std::wstring::npos) {
        OnEpfMessage(msg);
        return;
    }

    if (msg.find(L"\"cmd\":\"pack") != std::wstring::npos) {
        OnPackMessage(msg);
        return;
    }

    if (msg.find(L"\"cmd\":\"git") != std::wstring::npos) {
        OnGitMessage(msg);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"openSettings")) {
        if (mOnOpenSettings) mOnOpenSettings();
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"ready")) {
        OnPageReady();
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"painted")) {
        // Force a fresh DirectComposition surface after the page has real
        // content: hide → bounds nudge → show. Needed especially after
        // reparent from the parking window into Lister.
        // Only a Lister instance moves between HWNDs. In the standalone
        // editor the hide/show is pure flicker, once per "painted".
        if (!g_standalone && mController && !mParked && mParentWin) {
            RECT bounds;
            GetClientRect(mParentWin, &bounds);
            mController->put_IsVisible(FALSE);
            if (bounds.right > 1 && bounds.bottom > 1) {
                RECT nudge = bounds;
                nudge.right -= 1;
                nudge.bottom -= 1;
                mController->put_Bounds(nudge);
            }
            Resize();
            mController->NotifyParentWindowPositionChanged();
            mController->put_IsVisible(TRUE);
        }
        /* A newly launched BSLEdit owns the foreground window, but its child
         * WebView does not accept keyboard input until it is activated. Do
         * that only for a global-search jump, then focus Monaco after the
         * loading overlay and the native surface transition are finished. */
        if (mFocusEditorOnPaint && mController && !mParked) {
            mFocusEditorOnPaint = false;
            mController->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            PostJson(L"{\"cmd\":\"focusEditor\"}");
        } else if (g_standalone && mController && !mParked && mParentWin &&
                   GetForegroundWindow() == GetAncestor(mParentWin, GA_ROOT)) {
            /* Otherwise the page's own shortcuts (Ctrl+Shift+F in the
             * configuration view) wait for a first click into the window. */
            mController->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        }
        return;
    }

    // The page reports whether the document still differs from the file on
    // disk, so the window title can say so.
    if (JsonFieldEquals(msg, L"cmd", L"dirty")) {
        bool dirty = msg.find(L"\"dirty\":true") != std::wstring::npos;
        /* Which of the two files is unsaved, not just whether either is: the
         * open marker is published per file, and so is the decision to replace
         * a document that changed on disk. An older page that does not say
         * falls back to blaming both. */
        bool saysFile = msg.find(L"\"file\":") != std::wstring::npos;
        bool file = saysFile ? msg.find(L"\"file\":true") != std::wstring::npos : dirty;
        bool module = saysFile ? msg.find(L"\"module\":true") != std::wstring::npos : dirty;
        if (dirty != mDirty || file != mDirtyFile || module != mDirtyModule) {
            mDirty = dirty;
            mDirtyFile = file;
            mDirtyModule = module;
            if (mOnDirtyChanged) mOnDirtyChanged(dirty);
        }
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"theme")) {
        mDark = msg.find(L"\"dark\":true") != std::wstring::npos;
        if (mController) ConfigureControllerRendering(mController, mParentWin, mDark);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"launchAgent")) {
        if (!mFilePath.empty()) ChooseAndLaunchAgent(mParentWin, mFilePath);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"showInExplorer")) {
        bool module = JsonFieldEquals(msg, L"target", L"module");
        const std::wstring& path = module && !mFormModulePath.empty()
            ? mFormModulePath : mFilePath;
        if (!path.empty()) {
            std::wstring arg = L"/select,\"" + path + L"\"";
            ShellExecuteW(mParentWin, L"open", L"explorer.exe", arg.c_str(), NULL, SW_SHOWNORMAL);
        }
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"readSource")) {
        std::wstring path, reqId;
        bool fields = JsonUnescapeField(msg, L"path", path) && JsonUnescapeField(msg, L"reqId", reqId);
        /* Absolute BSL paths are the normal BSL Analyzer contract and may be
         * on any drive, independently of the report location.  Keep arbitrary
         * file types behind the explicit-root boundary. */
        bool allowed = fields && !PathIsRelativeW(path.c_str()) && IsSarifSourcePath(path);
        for (size_t i = 0; fields && i < mAllowedRoots.size(); ++i)
            if (PathIsUnderRoot(mAllowedRoots[i], path)) { allowed = true; break; }
        TextFile file;
        if (allowed) file = ReadTextFile(path.c_str(), 64u * 1024u * 1024u);
        std::wstring reply = L"{\"cmd\":\"sourceContent\",\"reqId\":\"";
        reply += JsonEscape(reqId);
        reply += L"\",\"ok\":";
        reply += (allowed && file.ok) ? L"true" : L"false";
        reply += L",\"path\":\"";
        reply += JsonEscape(path);
        reply += L"\"";
        if (allowed && file.ok) {
            reply += L",\"content\":\"";
            reply += JsonEscape(file.text);
            reply += L"\",\"encoding\":\"";
            reply += EncodingName(file.encoding);
            reply += L"\"";
        } else {
            reply += L",\"error\":\"";
            reply += allowed ? L"missing-or-too-big" : L"denied";
            reply += L"\"";
        }
        reply += L"}";
        PostJson(reply);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"chooseRoot")) {
        std::wstring suggest;
        JsonUnescapeField(msg, L"suggest", suggest);
        std::wstring chosen = ChooseFolder(mParentWin, suggest);
        std::wstring reply = L"{\"cmd\":\"rootChosen\",\"ok\":";
        reply += chosen.empty() ? L"false" : L"true";
        if (!chosen.empty()) {
            mAllowedRoots.push_back(chosen);
            reply += L",\"path\":\"";
            reply += JsonEscape(chosen);
            reply += L"\"";
        }
        reply += L"}";
        PostJson(reply);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"save")) {
        std::wstring content;
        std::wstring saveId;
        TextFileWriteResult saveResult = TEXT_FILE_WRITE_IO_ERROR;
        /* The page names the form module explicitly; the file it goes to is
         * the one this host found for the form, never a path from the page. */
        bool toModule = JsonFieldEquals(msg, L"target", L"module");
        const std::wstring& target = toModule ? mFormModulePath : mFilePath;
        TextEncoding& encoding = toModule ? mFormModuleEncoding : mEncoding;
        FileRevision& revision = toModule ? mFormModuleRevision : mFileRevision;
        const wchar_t* ext = PathFindExtensionW(target.c_str());
        if (!target.empty() && _wcsicmp(ext, L".sarif") != 0
                && _wcsicmp(ext, L".form") != 0
                && _wcsicmp(ext, L".mdo") != 0
                && JsonUnescapeField(msg, L"content", content)) {
            FileRevision savedRevision;
            /* "force" is the answer to the page's own conflict prompt: the user
             * has been told the file changed under the buffer and chose the
             * buffer. Without it a changed file is never overwritten. */
            bool force = msg.find(L"\"force\":true") != std::wstring::npos;
            saveResult = WriteTextFileIfUnchanged(target.c_str(), content, encoding,
                                                  force ? NULL : &revision, &savedRevision);
            if (saveResult == TEXT_FILE_WRITE_OK) {
                revision = savedRevision;
                PublishWatch();
            }
        }
        std::wstring reply = L"{\"cmd\":\"saved\",\"ok\":";
        reply += saveResult == TEXT_FILE_WRITE_OK ? L"true" : L"false";
        if (toModule)
            reply += L",\"target\":\"module\"";
        if (saveResult == TEXT_FILE_WRITE_CONFLICT)
            reply += L",\"conflict\":true";
        if (JsonUnescapeField(msg, L"saveId", saveId)) {
            reply += L",\"saveId\":\"";
            reply += JsonEscape(saveId);
            reply += L"\"";
        }
        reply += L"}";
        PostJson(reply);
        return;
    }

    /* A binary template of the object window saved to a file. The same
     * boundary as for "open"; only a template's Ext/Template.bin qualifies. */
    if (JsonFieldEquals(msg, L"cmd", L"saveTemplate")) {
        std::wstring path;
        std::wstring type;
        JsonUnescapeField(msg, L"type", type);
        bool allowed = JsonUnescapeField(msg, L"path", path) && !path.empty()
            && !PathIsRelativeW(path.c_str()) && _wcsicmp(PathFindFileNameW(path.c_str()), L"Template.bin") == 0;
        bool under = false;
        for (size_t i = 0; allowed && i < mNavRoots.size() && !under; ++i)
            under = PathIsUnderRoot(mNavRoots[i], path);
        std::string data;
        bool ok = allowed && under && ReadWholeFile(path, data, 256u * 1024 * 1024);
        const wchar_t* ext = L"bin";
        if (ok && type == L"ActiveDocument") {
            std::string unwrapped;
            std::string clsid;
            if (UnwrapActiveDocument(data, unwrapped, clsid)) {
                data.swap(unwrapped);
                ext = ActiveDocumentExtension(clsid);
            }
        } else if (ok && type == L"AddIn") {
            ext = L"zip";
        } else if (ok) {
            ext = BinaryDataExtension(data);
        }
        bool cancelled = false;
        if (ok) {
            /* <Имя>/Ext/Template.bin: the template's name is two folders up. */
            std::wstring name = path;
            for (int up = 0; up < 3; ++up) {
                size_t slash = name.find_last_of(L"\\/");
                if (slash == std::wstring::npos) break;
                if (up < 2) name.erase(slash); else name.erase(0, slash + 1);
            }
            std::wstring defName = name + L"." + ext;
            wchar_t filePath[MAX_PATH] = {};
            wcsncpy_s(filePath, defName.c_str(), _TRUNCATE);
            std::wstring filter = std::wstring(ext) + L" (*." + ext + L")" + L'\0' + L"*." + ext + L'\0'
                + L"Все файлы (*.*)" + L'\0' + L"*.*" + L'\0' + L'\0';
            OPENFILENAMEW ofn = {};
            ofn.lStructSize = sizeof(ofn);
            ofn.hwndOwner = mParentWin;
            ofn.lpstrFilter = filter.c_str();
            ofn.lpstrFile = filePath;
            ofn.nMaxFile = MAX_PATH;
            ofn.lpstrDefExt = ext;
            ofn.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
            ofn.lpstrTitle = L"Сохранить макет";
            if (!GetSaveFileNameW(&ofn)) cancelled = true;
            else ok = WriteWholeFile(filePath, data);
        }
        std::wstring reply = L"{\"cmd\":\"templateSaved\",\"ok\":";
        reply += ok && !cancelled ? L"true" : L"false";
        if (cancelled) reply += L",\"cancelled\":true";
        reply += L",\"path\":\"";
        reply += JsonEscape(path);
        reply += L"\"}";
        PostJson(reply);
        return;
    }

    /* The object window opens its forms, templates and modules in place. Only
     * files below the context roots of the files navigated through qualify -
     * the boundary the page's own reads are held to - and the page is loaded
     * exactly as the host would load that file, including a form's module. */
    /* The configuration window opens objects in a separate BSLEdit: closing
     * the object must not close the window it was opened from. The same
     * boundary as for "open"; without an editor to start the page opens the
     * file in place. */
    if (JsonFieldEquals(msg, L"cmd", L"openWindow")) {
        std::wstring path;
        std::wstring search;
        JsonUnescapeField(msg, L"search", search);
        int line = JsonPositiveIntField(msg, L"line");
        bool regexp = msg.find(L"\"regexp\":true") != std::wstring::npos;
        bool matchCase = msg.find(L"\"matchCase\":true") != std::wstring::npos;
        bool allowed = JsonUnescapeField(msg, L"path", path) && !path.empty()
            && !PathIsRelativeW(path.c_str());
        if (allowed) {
            const wchar_t* ext = PathFindExtensionW(path.c_str());
            allowed = _wcsicmp(ext, L".xml") == 0 || _wcsicmp(ext, L".mdo") == 0 || _wcsicmp(ext, L".form") == 0 || _wcsicmp(ext, L".bsl") == 0;
        }
        bool under = false;
        for (size_t i = 0; allowed && i < mNavRoots.size() && !under; ++i)
            under = PathIsUnderRoot(mNavRoots[i], path);
        std::wstring exe = (allowed && under && FileExists(path)) ? EditorExecutable(mWebRoot) : std::wstring();
        if (exe.empty() || !StartEditor(exe, path, line, search, regexp, matchCase)) {
            std::wstring reply = L"{\"cmd\":\"openWindowFailed\",\"path\":\"";
            reply += JsonEscape(path);
            reply += L"\"";
            if (line > 0) reply += L",\"line\":" + std::to_wstring(line);
            if (!search.empty()) {
                reply += L",\"search\":\"" + JsonEscape(search) + L"\"";
                reply += regexp ? L",\"regexp\":true" : L",\"regexp\":false";
                reply += matchCase ? L",\"matchCase\":true" : L",\"matchCase\":false";
            }
            reply += L"}";
            PostJson(reply);
        }
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"open")) {
        std::wstring path;
        std::wstring search;
        JsonUnescapeField(msg, L"search", search);
        int line = JsonPositiveIntField(msg, L"line");
        bool allowed = JsonUnescapeField(msg, L"path", path) && !path.empty()
            && !PathIsRelativeW(path.c_str());
        std::wstring configuration = allowed ? FindConfigurationForDumpInfo(path.c_str()) : std::wstring();
        if (!configuration.empty()) path = configuration;
        /* The way back from an unpacked object to the panel it was opened from. */
        if (allowed && !mEpfPath.empty() && _wcsicmp(path.c_str(), mEpfPath.c_str()) == 0) {
            mFilePath = path;
            mNavigating = true;
            LoadEpf(mDark, mFontSize, mReadOnly);
            if (mOnFileOpened) mOnFileOpened(mFilePath);
            return;
        }
        if (allowed) {
            const wchar_t* ext = PathFindExtensionW(path.c_str());
            allowed = _wcsicmp(ext, L".xml") == 0 || _wcsicmp(ext, L".mdo") == 0 || _wcsicmp(ext, L".form") == 0 || _wcsicmp(ext, L".bsl") == 0
                || _wcsicmp(ext, L".txt") == 0;   // a text document template
        }
        bool under = false;
        for (size_t i = 0; allowed && i < mNavRoots.size() && !under; ++i)
            under = PathIsUnderRoot(mNavRoots[i], path);
        TextFile file = (allowed && under) ? ReadTextFile(path.c_str(), 64 * 1024 * 1024) : TextFile();
        if (!file.ok) {
            std::wstring reply = L"{\"cmd\":\"openFailed\",\"path\":\"";
            reply += JsonEscape(path);
            reply += L"\"}";
            PostJson(reply);
            return;
        }
        mFilePath = path;
        mEncoding = file.encoding;
        mFileRevision = file.revision;
        BslLoadRequest req;
        req.content = file.text;
        req.language = MonacoLanguageForPath(path.c_str());
        req.dark = mDark;
        req.fontSize = mFontSize;
        req.readOnly = mReadOnly;
        req.initialLine = line;
        req.initialSearch = search;
        req.initialRegexp = msg.find(L"\"regexp\":true") != std::wstring::npos;
        req.initialMatchCase = msg.find(L"\"matchCase\":true") != std::wstring::npos;
        req.openFormModule = msg.find(L"\"formView\":\"module\"") != std::wstring::npos;
        mNavigating = true;
        Load(req);
        if (mOnFileOpened) mOnFileOpened(mFilePath);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"reload")) {
        if (mFilePath.empty()) {
            PostJson(L"{\"cmd\":\"reverted\",\"ok\":false}");
            return;
        }
        TextFile file = ReadTextFile(mFilePath.c_str(), 0);
        if (!file.ok) {
            PostJson(L"{\"cmd\":\"reverted\",\"ok\":false}");
            return;
        }
        mEncoding = file.encoding;
        mFileRevision = file.revision;
        std::wstring json = L"{\"cmd\":\"reverted\",\"ok\":true,\"content\":\"";
        json += JsonEscape(file.text);
        json += L"\"";
        if (!mFormModulePath.empty()) {
            TextFile module = ReadTextFile(mFormModulePath.c_str(), 64 * 1024 * 1024);
            if (module.ok) {
                mFormModuleEncoding = module.encoding;
                mFormModuleRevision = module.revision;
                json += L",\"formModule\":\"";
                json += JsonEscape(module.text);
                json += L"\"";
            }
        }
        json += L"}";
        PostJson(json);
        PublishWatch();
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"screenshot")) {
        CaptureScreenshot();
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"closeAck")) {
        bool allow = msg.find(L"\"allow\":true") != std::wstring::npos;
        if (mParentWin) PostMessageW(mParentWin, WM_BSLVIEW_CLOSE_ACK, allow ? 1 : 0, 0);
        return;
    }
}

void CWebView2Host::CaptureScreenshot()
{
    if (!mWebView) {
        PostJson(L"{\"cmd\":\"screenshotDone\",\"ok\":false}");
        return;
    }

    std::wstring defName = FormSnapshotBaseName(mFilePath.c_str());
    if (defName.empty()) defName = L"form";
    defName += L".png";

    wchar_t filePath[MAX_PATH] = {};
    wcsncpy_s(filePath, defName.c_str(), _TRUNCATE);
    OPENFILENAMEW ofn = {};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = mParentWin;
    ofn.lpstrFilter = L"PNG files (*.png)\0*.png\0All files (*.*)\0*.*\0";
    ofn.lpstrFile = filePath;
    ofn.nMaxFile = MAX_PATH;
    ofn.lpstrDefExt = L"png";
    ofn.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    ofn.lpstrTitle = L"Сохранить снимок формы";
    if (!GetSaveFileNameW(&ofn)) {
        PostJson(L"{\"cmd\":\"screenshotDone\",\"ok\":false}");
        return;
    }

    IStream* stream = NULL;
    HRESULT hr = SHCreateStreamOnFileEx(filePath, STGM_CREATE | STGM_WRITE | STGM_SHARE_DENY_WRITE,
                                        FILE_ATTRIBUTE_NORMAL, TRUE, NULL, &stream);
    if (FAILED(hr) || !stream) {
        PostJson(L"{\"cmd\":\"screenshotDone\",\"ok\":false}");
        return;
    }

    AddRef();
    ScreenshotCompletedHandler* cb = new ScreenshotCompletedHandler(this, stream);
    hr = mWebView->CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, stream, cb);
    cb->Release();
    stream->Release();
    if (FAILED(hr)) {
        Release();
        PostJson(L"{\"cmd\":\"screenshotDone\",\"ok\":false}");
    }
}

// --- Unpacking of external data processors and reports ----------------------
//
// The page shows the panel (web/epf-unpack.js) and sends "epf*" commands; the
// unpacking itself runs ibcmd on a worker thread and reports every line of its
// output back through the message-only batch window, because WebView2 may only
// be touched on the UI thread. "Открыть" loads the object's root XML in place.

struct EpfRun {
    epf::Job job;
    CWebView2Host* host;
    std::wstring target;
    std::wstring rootXml;
};

namespace {

struct EpfEvent {
    EpfRun* run;
    std::wstring json;
    bool final;
    bool ok;
};

std::wstring JsonStr(const std::wstring& s)
{
    return L"\"" + JsonEscape(s) + L"\"";
}

const wchar_t* EpfKindName(int kind)
{
    return kind == epf::CTX_BASE ? L"base" : kind == epf::CTX_CF ? L"cf" : L"empty";
}

const wchar_t* EpfFileKindName(epf::FileKind kind)
{
    return kind == epf::FILE_CF ? L"cf" : kind == epf::FILE_CFE ? L"cfe" : kind == epf::FILE_DT ? L"dt" : L"external";
}

int EpfKindFrom(const std::wstring& name)
{
    return name == L"base" ? epf::CTX_BASE : name == L"cf" ? epf::CTX_CF : epf::CTX_EMPTY;
}

std::wstring StripQuotes(const std::wstring& s)
{
    size_t b = s.find_first_not_of(L" \t\"");
    if (b == std::wstring::npos) return std::wstring();
    size_t e = s.find_last_not_of(L" \t\"");
    return s.substr(b, e - b + 1);
}

std::wstring ChooseFile(HWND owner, const std::wstring& current, const wchar_t* filter, const wchar_t* title)
{
    wchar_t path[MAX_PATH * 2] = {};
    wcsncpy_s(path, current.c_str(), _TRUNCATE);
    OPENFILENAMEW ofn = {};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = owner;
    ofn.lpstrFilter = filter;
    ofn.lpstrFile = path;
    ofn.nMaxFile = MAX_PATH * 2;
    ofn.lpstrTitle = title;
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    return GetOpenFileNameW(&ofn) ? std::wstring(path) : std::wstring();
}

bool PostEpfEvent(HWND target, EpfEvent* e)
{
    if (target && PostMessageW(target, WM_BSLVIEW_EPF_EVENT, 0, (LPARAM)e)) return true;
    delete e;
    return false;
}

} // namespace

void CWebView2Host::LoadEpf(bool dark, int fontSize, bool readOnly)
{
    if (!mNavigating) CancelEpf();
    mDark = dark;
    mFontSize = fontSize;
    mReadOnly = readOnly;
    if (mController) ConfigureControllerRendering(mController, mParentWin, mDark);
    mEpfPath = mFilePath;
    mFormModulePath.clear();
    mAllowedRoots.clear();
    mContextRoots.clear();
    if (!mNavigating) mNavRoots.clear();
    mNavigating = false;

    std::wstring json = L"{\"cmd\":\"load\",\"language\":\"epf\",\"theme\":\"";
    json += dark ? L"dark" : L"light";
    json += L"\",\"fontSize\":" + std::to_wstring(fontSize > 0 ? fontSize : 14);
    json += L",\"readOnly\":";
    json += readOnly ? L"true" : L"false";
    if (mOnOpenSettings) json += L",\"settings\":true";
    json += L",\"content\":\"\",\"path\":" + JsonStr(mFilePath) + L"}";
    if (mPageReady) {
        PostJson(json);
    } else {
        mPendingJson.swap(json);
        mHasPending = true;
    }
}

void CWebView2Host::CancelEpf()
{
    if (!mEpfRun) return;
    // The run finishes on its own thread and cleans up after itself.
    mEpfRun->job.Cancel();
    mEpfRun = NULL;
}

void CWebView2Host::OnEpfEvent(LPARAM lParam)
{
    EpfEvent* e = (EpfEvent*)lParam;
    EpfRun* run = e->run;
    CWebView2Host* host = run->host;
    bool current = host->mEpfRun == run && !host->mClosed;
    if (current && e->final) {
        host->mEpfRun = NULL;
        /* The unpacked object may now be opened in place: its folder is one
         * of the roots this host navigates within. */
        if (e->ok && !run->target.empty()) host->mNavRoots.push_back(run->target);
    }
    if (current) host->PostJson(e->json);
    if (e->final) {
        delete run;
        --g_batchJobs;
        host->Release();
    }
    delete e;
}

void CWebView2Host::PostEpfInfo(const std::wstring& file, const std::wstring& target,
                                int kind, const std::wstring& cf, const std::wstring& platform)
{
    std::wstring rootXml = epf::RootXmlPath(file, target);
    bool rootExists = !rootXml.empty() && FileExists(rootXml);
    std::wstring cacheInfo;
    if (kind == epf::CTX_CF && !cf.empty() && FileExists(cf) && !platform.empty()) {
        std::wstring built = epf::CacheBuilt(epf::CacheKey(epf::CTX_CF, cf, platform));
        cacheInfo = built.empty()
            ? L"Служебная база ещё не создана — первая распаковка займёт больше времени."
            : L"Служебная база в кэше: собрана " + built + L".";
    }
    std::wstring json = L"{\"cmd\":\"epfInfo\",\"rootExists\":";
    json += rootExists ? L"true" : L"false";
    json += L",\"rootXml\":" + JsonStr(rootXml);
    json += L",\"cacheInfo\":" + JsonStr(cacheInfo);
    json += L",\"cacheSize\":" + std::to_wstring(epf::CacheSize());
    json += L"}";
    PostJson(json);
}

void CWebView2Host::OnEpfMessage(const std::wstring& msg)
{
    std::wstring file, target, kindName, cf, platform;
    JsonUnescapeField(msg, L"file", file);
    JsonUnescapeField(msg, L"target", target);
    JsonUnescapeField(msg, L"kind", kindName);
    JsonUnescapeField(msg, L"cf", cf);
    JsonUnescapeField(msg, L"platform", platform);
    file = StripQuotes(file);
    target = StripQuotes(target);
    cf = StripQuotes(cf);
    int kind = EpfKindFrom(kindName);

    if (JsonFieldEquals(msg, L"cmd", L"epfSetGitAdd")) {
        epf::Settings settings = epf::Settings::Load();
        settings.gitAdd = msg.find(L"\"on\":true") != std::wstring::npos;
        settings.Save();
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"epfInit")) {
        epf::Settings settings = epf::Settings::Load();
        std::vector<epf::Platform> platforms = epf::FindPlatforms();
        std::vector<epf::InfoBase> bases = epf::LoadIbases();
        std::wstring json = L"{\"cmd\":\"epfState\",\"file\":" + JsonStr(mEpfPath);
        json += L",\"target\":" + JsonStr(epf::DefaultTarget(mEpfPath));
        json += L",\"platforms\":[";
        for (size_t i = 0; i < platforms.size(); i++)
            json += (i ? L"," : L"") + JsonStr(platforms[i].version);
        json += L"],\"platform\":" + JsonStr(settings.platform);
        json += L",\"bases\":[";
        for (size_t i = 0; i < bases.size(); i++) {
            auto user = settings.userByBase.find(bases[i].id);
            json += i ? L"," : L"";
            json += L"{\"name\":" + JsonStr(bases[i].name) + L",\"id\":" + JsonStr(bases[i].id);
            json += L",\"display\":" + JsonStr(epf::ConnectDisplay(bases[i].connect));
            json += L",\"user\":" + JsonStr(user == settings.userByBase.end() ? std::wstring() : user->second);
            /* Whether a password is saved, never the password itself. */
            json += L",\"savedAuth\":";
            json += settings.HasSavedAuth(bases[i].id) ? L"true" : L"false";
            json += L",\"server\":";
            json += epf::FileBasePath(bases[i].connect).empty() ? L"true" : L"false";
            json += L",\"supported\":";
            json += epf::DesignerConnectArgs(bases[i].connect).empty() ? L"false" : L"true";
            json += L"}";
        }
        json += L"],\"kind\":\"";
        json += EpfKindName(settings.kind);
        json += L"\",\"baseId\":" + JsonStr(settings.baseId);
        json += L",\"cf\":" + JsonStr(settings.cfPath);
        json += L",\"openAfter\":";
        json += settings.openAfter ? L"true" : L"false";
        json += L",\"fileKind\":\"";
        json += EpfFileKindName(epf::KindOfFile(mEpfPath));
        json += L"\",\"cfgLoad\":";
        json += settings.cfgLoad ? L"true" : L"false";
        json += L",\"cfgUnpack\":";
        json += settings.cfgUnpack ? L"true" : L"false";
        json += L",\"cfgNewBase\":";
        json += settings.cfgNewBase ? L"true" : L"false";
        json += L",\"cfgExtUnsafe\":";
        json += settings.cfgExtUnsafe ? L"true" : L"false";
        json += L",\"gitAdd\":";
        json += settings.gitAdd ? L"true" : L"false";
        json += L",\"running\":";
        json += mEpfRun ? L"true" : L"false";
        json += L"}";
        PostJson(json);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"epfCheck")) {
        PostEpfInfo(file, target, kind, cf, platform);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"epfBrowse")) {
        std::wstring what, current, chosen;
        JsonUnescapeField(msg, L"what", what);
        JsonUnescapeField(msg, L"current", current);
        current = StripQuotes(current);
        if (what == L"file") {
            chosen = ChooseFile(mParentWin, current,
                L"Обработки, отчёты, конфигурации, расширения, выгрузки (*.epf;*.erf;*.cf;*.cfe;*.dt)\0*.epf;*.erf;*.cf;*.cfe;*.dt\0"
                L"Внешние обработки и отчёты (*.epf;*.erf)\0*.epf;*.erf\0"
                L"Конфигурации и расширения (*.cf;*.cfe)\0*.cf;*.cfe\0"
                L"Выгрузки информационных баз (*.dt)\0*.dt\0Все файлы (*.*)\0*.*\0",
                L"Файл для распаковки или загрузки");
        } else if (what == L"cf") {
            chosen = ChooseFile(mParentWin, current,
                L"Файлы конфигурации (*.cf)\0*.cf\0Все файлы (*.*)\0*.*\0", L"Файл конфигурации");
        } else if (what == L"target" || what == L"newDir") {
            /* The folder may not exist yet: start from the nearest one that does. */
            std::wstring start = current;
            while (!start.empty() && !PathIsDirectoryW(start.c_str())) {
                size_t slash = start.find_last_of(L"\\/");
                start = slash == std::wstring::npos ? std::wstring() : start.substr(0, slash);
            }
            chosen = ChooseFolder(mParentWin, start, what == L"newDir" ? L"Каталог новой базы" : L"Каталог распаковки");
        }
        std::wstring json = L"{\"cmd\":\"epfBrowsed\",\"what\":" + JsonStr(what);
        json += L",\"path\":" + JsonStr(chosen) + L"}";
        PostJson(json);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"epfExplore")) {
        if (!target.empty() && PathIsDirectoryW(target.c_str())) {
            std::wstring arg = L"\"" + target + L"\"";
            ShellExecuteW(mParentWin, L"open", L"explorer.exe", arg.c_str(), NULL, SW_SHOWNORMAL);
        } else {
            PostJson(L"{\"cmd\":\"epfNotice\",\"text\":" + JsonStr(L"Каталог ещё не создан:\n" + target) + L"}");
        }
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"epfClearCache")) {
        std::wstring error;
        bool ok = false;
        if (mEpfRun) error = L"Идёт распаковка — очистите кэш после её завершения.";
        else ok = epf::ClearCache(&error);
        std::wstring json = L"{\"cmd\":\"epfCacheCleared\",\"ok\":";
        json += ok ? L"true" : L"false";
        json += L",\"error\":" + JsonStr(error) + L"}";
        PostJson(json);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"epfSetOpenAfter")) {
        epf::Settings settings = epf::Settings::Load();
        settings.openAfter = msg.find(L"\"on\":true") != std::wstring::npos;
        settings.Save();
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"epfCancel")) {
        if (mEpfRun) mEpfRun->job.Cancel();
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"epfOpen")) {
        std::wstring rootXml = epf::RootXmlPath(file, target);
        TextFile xml = rootXml.empty() || PathIsRelativeW(rootXml.c_str())
            ? TextFile() : ReadTextFile(rootXml.c_str(), 64 * 1024 * 1024);
        if (!xml.ok) {
            PostJson(L"{\"cmd\":\"openFailed\",\"path\":" + JsonStr(rootXml) + L"}");
            return;
        }
        mNavRoots.push_back(rootXml.substr(0, rootXml.find_last_of(L"\\/")));
        mFilePath = rootXml;
        mEncoding = xml.encoding;
        mFileRevision = xml.revision;
        BslLoadRequest req;
        req.content = xml.text;
        req.language = MonacoLanguageForPath(rootXml.c_str());
        req.dark = mDark;
        req.fontSize = mFontSize;
        req.readOnly = mReadOnly;
        mNavigating = true;
        Load(req);
        if (mOnFileOpened) mOnFileOpened(mFilePath);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"epfUnpack")) {
        if (mEpfRun) return;
        std::wstring error;
        epf::UnpackRequest req;
        req.file = file;
        req.target = target;
        req.kind = (epf::ContextKind)kind;
        bool requestedGitAdd = msg.find(L"\"gitAdd\":true") != std::wstring::npos;
        std::wstring baseId;
        JsonUnescapeField(msg, L"baseId", baseId);
        JsonUnescapeField(msg, L"user", req.user);
        JsonUnescapeField(msg, L"password", req.password);
        req.user = StripQuotes(req.user);
        bool saveAuth = msg.find(L"\"saveAuth\":true") != std::wstring::npos;
        epf::FileKind fileKind = epf::KindOfFile(file);
        bool config = fileKind != epf::FILE_EXTERNAL && fileKind != epf::FILE_OTHER;
        if (config) {
            req.load = msg.find(L"\"load\":true") != std::wstring::npos;
            req.unpack = msg.find(L"\"unpack\":true") != std::wstring::npos;
            req.newBase = msg.find(L"\"newBase\":true") != std::wstring::npos;
            req.extUnsafe = fileKind == epf::FILE_CFE && msg.find(L"\"extUnsafe\":true") != std::wstring::npos;
            JsonUnescapeField(msg, L"newName", req.newName);
            JsonUnescapeField(msg, L"newDir", req.newDir);
            req.newName = StripQuotes(req.newName);
            req.newDir = StripQuotes(req.newDir);
            /* The configuration context of an external file means nothing here. */
            req.kind = req.load && !req.newBase ? epf::CTX_BASE : epf::CTX_EMPTY;
            kind = req.kind;
        }
        req.gitAdd = requestedGitAdd && (fileKind == epf::FILE_EXTERNAL
            || ((fileKind == epf::FILE_CF || fileKind == epf::FILE_CFE) && req.unpack));
        std::vector<epf::Platform> platforms = epf::FindPlatforms();
        bool platformFound = false;
        for (const auto& p : platforms)
            if (!platformFound && p.version == platform) { req.platform = p; platformFound = true; }

        if (file.empty() || PathIsRelativeW(file.c_str()) || !FileExists(file)) error = L"Файл не найден.";
        else if (fileKind == epf::FILE_OTHER) error = L"Поддерживаются файлы .epf, .erf, .cf, .cfe и .dt.";
        else if (config && !req.load && !req.unpack) error = L"Выберите действие: загрузить в базу и/или распаковать.";
        else if ((!config || req.unpack) && (target.empty() || PathIsRelativeW(target.c_str())))
            error = L"Укажите полный путь каталога распаковки.";
        else if (config && req.load && req.newBase && req.newName.empty()) error = L"Укажите имя новой базы.";
        else if (config && req.load && req.newBase && req.newName.find_first_of(L"[]") != std::wstring::npos)
            error = L"Имя базы не может содержать квадратные скобки.";
        else if (config && req.load && req.newBase && epf::IbaseNameExists(req.newName))
            error = L"В списке уже есть база «" + req.newName + L"».";
        else if (config && req.load && req.newBase && (req.newDir.empty() || PathIsRelativeW(req.newDir.c_str())))
            error = L"Укажите полный путь каталога новой базы.";
        else if (!platformFound) error = L"Не найдена платформа 1С с ibcmd.exe.";
        else if (kind == epf::CTX_CF && (cf.empty() || !FileExists(cf))) error = L"CF-файл не найден.";
        else if (kind == epf::CTX_BASE) {
            bool found = false;
            for (const auto& b : epf::LoadIbases())
                if (!found && b.id == baseId) { req.base = b; found = true; }
            if (!found) error = L"Выберите базу.";
            else if (epf::DesignerConnectArgs(req.base.connect).empty())
                error = L"Этот тип подключения базы не поддерживается (нужна файловая или серверная база).";
            else if (req.extUnsafe && epf::FileBasePath(req.base.connect).empty())
                error = L"Для серверной базы безопасный режим расширения отключается в конфигураторе.";
        }
        if (!error.empty()) {
            PostJson(L"{\"cmd\":\"epfDone\",\"ok\":false,\"started\":false,\"error\":" + JsonStr(error) + L"}");
            return;
        }
        if (kind == epf::CTX_CF) {
            wchar_t full[MAX_PATH * 2] = {};
            GetFullPathNameW(cf.c_str(), MAX_PATH * 2, full, NULL);
            req.cfPath = full;
        }

        epf::Settings settings = epf::Settings::Load();
        if (config) {
            settings.cfgLoad = req.load;
            settings.cfgUnpack = req.unpack;
            settings.cfgNewBase = req.newBase;
            if (fileKind == epf::FILE_CFE) settings.cfgExtUnsafe = req.extUnsafe;
        } else {
            settings.kind = req.kind;
        }
        if (kind == epf::CTX_BASE) {
            settings.baseId = req.base.id;
            settings.userByBase[req.base.id] = req.user;
            /* The page shows a saved password as a stand-in and never has it:
             * an untouched field means the saved one. */
            if (msg.find(L"\"useSaved\":true") != std::wstring::npos)
                settings.SavedPassword(req.base.id, req.password);
            if (saveAuth) settings.SaveAuth(req.base.id, req.user, req.password);
            else settings.ForgetAuth(req.base.id);
        }
        if (kind == epf::CTX_CF && !config) settings.cfPath = req.cfPath;
        // The newest platform is the default; a version is pinned only when another one is chosen.
        settings.platform = req.platform.version == platforms[0].version ? std::wstring() : req.platform.version;
        settings.Save();

        HWND events = BatchWindow();
        if (!events) {
            PostJson(L"{\"cmd\":\"epfDone\",\"ok\":false,\"started\":false,\"error\":\"Не удалось начать распаковку.\"}");
            return;
        }
        EpfRun* run = new EpfRun();
        run->host = this;
        run->target = req.unpack || !config ? target : std::wstring();
        run->rootXml = epf::RootXmlPath(file, target);
        mEpfRun = run;
        AddRef();
        ++g_batchJobs;
        PostJson(L"{\"cmd\":\"epfStarted\"}");
        std::thread([run, req, events]() {
            std::function<void(const std::wstring&)> log = [run, events](const std::wstring& line) {
                PostEpfEvent(events, new EpfEvent{ run, L"{\"cmd\":\"epfLog\",\"line\":" + JsonStr(line) + L"}", false, false });
            };
            std::wstring error;
            bool ok = false;
            try {
                ok = run->job.Run(req, log, error);
            } catch (...) {
                error = L"Внутренняя ошибка распаковки.";
            }
            bool canceled = run->job.Canceled();
            std::wstring json = L"{\"cmd\":\"epfDone\",\"started\":true,\"ok\":";
            json += ok ? L"true" : L"false";
            json += L",\"canceled\":";
            json += canceled ? L"true" : L"false";
            json += L",\"error\":" + JsonStr(error);
            json += L",\"rootXml\":" + JsonStr(run->rootXml) + L"}";
            /* Without the window the page is gone too; only the count matters then. */
            if (!PostEpfEvent(events, new EpfEvent{ run, json, true, ok })) --g_batchJobs;
        }).detach();
        return;
    }
}

// --- Assembly and loading: the other direction of the panel above -----------
//
// The page shows web/epf-pack.js and sends "pack*" commands. The work is the
// same kind as unpacking — ibcmd and the Designer on a worker thread, every
// line of their output relayed through the batch window — so it runs through
// the same EpfRun machinery and the same cancel.

namespace {

const wchar_t* PackDumpName(epf::DumpKind kind)
{
    return kind == epf::DUMP_EXTERNAL ? L"external" : kind == epf::DUMP_CONFIG ? L"config" : L"none";
}

/* The strings of a JSON array field: "files":["a.xml","b.xml"]. Only what
 * this host itself sent to the page comes back here. */
void JsonStringArray(const std::wstring& msg, const wchar_t* field, std::vector<std::wstring>& out)
{
    std::wstring key = std::wstring(L"\"") + field + L"\":[";
    size_t at = msg.find(key);
    if (at == std::wstring::npos) return;
    at += key.size();
    while (at < msg.size() && msg[at] != L']') {
        if (msg[at] != L'"') { at++; continue; }
        std::wstring item;
        at++;
        while (at < msg.size() && msg[at] != L'"') {
            if (msg[at] == L'\\' && at + 1 < msg.size()) at++;
            item += msg[at++];
        }
        if (at < msg.size()) at++;
        if (!item.empty()) out.push_back(item);
    }
}

} // namespace

void CWebView2Host::LoadPack(bool dark, int fontSize, bool readOnly)
{
    if (!mNavigating) CancelEpf();
    mDark = dark;
    mFontSize = fontSize;
    mReadOnly = readOnly;
    if (mController) ConfigureControllerRendering(mController, mParentWin, mDark);
    mFormModulePath.clear();
    mAllowedRoots.clear();
    mContextRoots.clear();
    if (!mNavigating) mNavRoots.clear();
    mNavigating = false;

    std::wstring json = L"{\"cmd\":\"load\",\"language\":\"pack\",\"theme\":\"";
    json += dark ? L"dark" : L"light";
    json += L"\",\"fontSize\":" + std::to_wstring(fontSize > 0 ? fontSize : 14);
    json += L",\"readOnly\":";
    json += readOnly ? L"true" : L"false";
    if (mOnOpenSettings) json += L",\"settings\":true";
    json += L",\"content\":\"\",\"path\":" + JsonStr(mPackPath) + L"}";
    if (mPageReady) {
        PostJson(json);
    } else {
        mPendingJson.swap(json);
        mHasPending = true;
    }
}

void CWebView2Host::PostPackInfo(const std::wstring& source)
{
    std::wstring rootXml, dumpDir, extension;
    bool report = false;
    epf::DumpKind kind = epf::KindOfDump(source, &rootXml, &dumpDir, &extension, &report);
    std::wstring json = L"{\"cmd\":\"packInfo\",\"dump\":\"";
    json += PackDumpName(kind);
    json += L"\",\"rootXml\":" + JsonStr(rootXml);
    json += L",\"dumpDir\":" + JsonStr(dumpDir);
    json += L",\"extension\":" + JsonStr(extension);
    json += L",\"report\":";
    json += report ? L"true" : L"false";
    json += L",\"out\":" + JsonStr(epf::DefaultOutFile(rootXml, kind, epf::OutSuffix(kind, report, !extension.empty())));
    json += L",\"current\":" + JsonStr(kind == epf::DUMP_CONFIG && !mPackObject.empty()
                                       ? mPackObject : std::wstring());
    json += L"}";
    PostJson(json);
}

/* The dump the object now open belongs to. An external object is a dump of
 * one file, so its own root XML is the source; an object of a configuration
 * export is one file of a folder, found by walking up to Configuration.xml,
 * and stays remembered as the object to load and to come back to. */
/* The assembly panel opens in a window of its own: it looks nothing like the
 * object, and closing it must not take the object with it. Only when no
 * BSLEdit can be started does it replace the object in this window. */
bool CWebView2Host::StartPackWindow()
{
    if (mFilePath.empty() || PathIsRelativeW(mFilePath.c_str()) || !FileExists(mFilePath)) return false;
    std::wstring exe = EditorExecutable(mWebRoot);
    return !exe.empty() && StartEditor(exe, mFilePath, 0, std::wstring(), false, false, true);
}

void CWebView2Host::OpenPackPanel(bool dark, int fontSize, bool readOnly)
{
    mDark = dark;
    mFontSize = fontSize;
    mReadOnly = readOnly;
    EnterPackPanel();
}

void CWebView2Host::EnterPackPanel()
{
    std::wstring object = mFilePath;
    mPackObjectPath = object;
    mPackObject.clear();
    mPackPath.clear();

    std::wstring rootXml, dumpDir, extension;
    if (epf::KindOfDump(object, &rootXml, &dumpDir, &extension, NULL) != epf::DUMP_NONE) {
        mPackPath = rootXml;
    } else {
        size_t slash = object.find_last_of(L"\\/");
        std::wstring dir = slash == std::wstring::npos ? std::wstring() : object.substr(0, slash);
        for (int depth = 0; depth < 16 && !dir.empty(); depth++) {
            if (FileExists(dir + L"\\Configuration.xml")) {
                mPackPath = dir;
                if (object.size() > dir.size() + 1) mPackObject = object.substr(dir.size() + 1);
                break;
            }
            slash = dir.find_last_of(L"\\/");
            dir = slash == std::wstring::npos ? std::wstring() : dir.substr(0, slash);
        }
    }
    mNavigating = true;
    LoadPack(mDark, mFontSize, mReadOnly);
}

void CWebView2Host::OnPackMessage(const std::wstring& msg)
{
    if (JsonFieldEquals(msg, L"cmd", L"packPanel")) {
        if (!StartPackWindow()) EnterPackPanel();
        return;
    }

    std::wstring source, out, cf;
    JsonUnescapeField(msg, L"source", source);
    JsonUnescapeField(msg, L"out", out);
    JsonUnescapeField(msg, L"cf", cf);
    source = StripQuotes(source);
    out = StripQuotes(out);
    cf = StripQuotes(cf);

    if (JsonFieldEquals(msg, L"cmd", L"packInit")) {
        epf::BuildSettings settings = epf::BuildSettings::Load();
        epf::Settings auth = epf::Settings::Load();
        std::vector<epf::Platform> platforms = epf::FindPlatforms();
        std::vector<epf::InfoBase> bases = epf::LoadIbases();
        std::wstring json = L"{\"cmd\":\"packState\",\"source\":" + JsonStr(mPackPath);
        json += L",\"assemble\":";
        json += settings.assemble ? L"true" : L"false";
        json += L",\"load\":";
        json += settings.load ? L"true" : L"false";
        json += L",\"updateDb\":";
        json += settings.updateDb ? L"true" : L"false";
        json += L",\"kind\":\"";
        json += EpfKindName(settings.kind);
        json += L"\",\"cf\":" + JsonStr(settings.cfPath);
        json += L",\"baseId\":" + JsonStr(settings.baseId);
        json += L",\"platform\":" + JsonStr(settings.platform);
        json += L",\"platforms\":[";
        for (size_t i = 0; i < platforms.size(); i++) {
            if (i) json += L",";
            json += L"{\"version\":" + JsonStr(platforms[i].version) + L"}";
        }
        json += L"],\"bases\":[";
        for (size_t i = 0; i < bases.size(); i++) {
            if (i) json += L",";
            json += L"{\"name\":" + JsonStr(bases[i].name);
            json += L",\"id\":" + JsonStr(bases[i].id);
            json += L",\"display\":" + JsonStr(epf::ConnectDisplay(bases[i].connect));
            auto user = auth.userByBase.find(bases[i].id);
            json += L",\"user\":" + JsonStr(user == auth.userByBase.end() ? std::wstring() : user->second);
            json += L",\"savedAuth\":";
            json += auth.HasSavedAuth(bases[i].id) ? L"true" : L"false";
            json += L",\"supported\":";
            json += epf::DesignerConnectArgs(bases[i].connect).empty() ? L"false" : L"true";
            json += L"}";
        }
        json += L"]}";
        PostJson(json);
        PostPackInfo(mPackPath);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"packCheck")) {
        PostPackInfo(source);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"packBrowse")) {
        std::wstring what;
        JsonUnescapeField(msg, L"what", what);
        what = StripQuotes(what);
        std::wstring current;
        JsonUnescapeField(msg, L"current", current);
        current = StripQuotes(current);
        std::wstring picked;
        if (what == L"source") {
            std::wstring start = current;
            while (!start.empty() && !PathIsDirectoryW(start.c_str())) {
                size_t slash = start.find_last_of(L"\\/");
                start = slash == std::wstring::npos ? std::wstring() : start.substr(0, slash);
            }
            picked = ChooseFolder(mParentWin, start, L"Каталог выгрузки");
        } else if (what == L"out") {
            wchar_t filePath[MAX_PATH] = {};
            wcsncpy_s(filePath, PathFindFileNameW(current.c_str()), _TRUNCATE);
            /* Open where the field points, not where the dialog was last used:
             * the nearest existing folder of the current path. */
            size_t cut = current.find_last_of(L"\\/");
            std::wstring startDir = cut == std::wstring::npos ? std::wstring() : current.substr(0, cut);
            while (!startDir.empty() && !PathIsDirectoryW(startDir.c_str())) {
                size_t slash = startDir.find_last_of(L"\\/");
                startDir = slash == std::wstring::npos ? std::wstring() : startDir.substr(0, slash);
            }
            /* Since Windows 7 the dialog's own history beats lpstrInitialDir;
             * only a folder inside lpstrFile itself is always honoured. */
            if (!startDir.empty())
                wcsncpy_s(filePath, (startDir + L"\\" + PathFindFileNameW(current.c_str())).c_str(), _TRUNCATE);
            OPENFILENAMEW ofn = {};
            ofn.lStructSize = sizeof(ofn);
            ofn.hwndOwner = mParentWin;
            ofn.lpstrFilter = L"Внешние обработки и отчёты (*.epf;*.erf)\0*.epf;*.erf\0"
                              L"Конфигурации и расширения (*.cf;*.cfe)\0*.cf;*.cfe\0"
                              L"Все файлы (*.*)\0*.*\0";
            ofn.lpstrFile = filePath;
            ofn.nMaxFile = MAX_PATH;
            ofn.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
            ofn.lpstrTitle = L"Собрать в файл";
            if (GetSaveFileNameW(&ofn)) picked = filePath;
        } else if (what == L"cf") {
            picked = ChooseFile(mParentWin, current,
                L"Файлы конфигурации (*.cf)\0*.cf\0Все файлы (*.*)\0*.*\0", L"Файл конфигурации");
        }
        if (picked.empty()) return;
        std::wstring json = L"{\"cmd\":\"packBrowsed\",\"what\":" + JsonStr(what);
        json += L",\"path\":" + JsonStr(picked) + L"}";
        PostJson(json);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"packExplore")) {
        if (!out.empty()) ShellExecuteW(NULL, L"open", L"explorer.exe",
                                        (L"/select,\"" + out + L"\"").c_str(), NULL, SW_SHOWNORMAL);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"packCancel")) {
        if (mEpfRun) mEpfRun->job.Cancel();
        return;
    }

    /* Back to the object the panel was opened from. */
    if (JsonFieldEquals(msg, L"cmd", L"packBack")) {
        std::wstring path = mPackObjectPath;
        TextFile xml = path.empty() || PathIsRelativeW(path.c_str())
            ? TextFile() : ReadTextFile(path.c_str(), 64 * 1024 * 1024);
        if (!xml.ok) {
            PostJson(L"{\"cmd\":\"openFailed\",\"path\":" + JsonStr(path) + L"}");
            return;
        }
        mFilePath = path;
        mEncoding = xml.encoding;
        mFileRevision = xml.revision;
        BslLoadRequest req;
        req.content = xml.text;
        req.language = MonacoLanguageForPath(path.c_str());
        req.dark = mDark;
        req.fontSize = mFontSize;
        req.readOnly = mReadOnly;
        mNavigating = true;
        Load(req);
        if (mOnFileOpened) mOnFileOpened(mFilePath);
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"packBuild")) {
        if (mEpfRun) return;
        std::wstring error;
        epf::BuildRequest req;
        req.dump = epf::KindOfDump(source, &req.source, &req.dumpDir, &req.extension, NULL);
        req.outFile = out;
        req.cfPath = cf;
        req.assemble = msg.find(L"\"assemble\":true") != std::wstring::npos;
        req.load = msg.find(L"\"load\":true") != std::wstring::npos;
        req.updateDb = msg.find(L"\"updateDb\":true") != std::wstring::npos;
        std::wstring kindName, baseId, platform;
        JsonUnescapeField(msg, L"kind", kindName);
        JsonUnescapeField(msg, L"baseId", baseId);
        JsonUnescapeField(msg, L"platform", platform);
        req.kind = (epf::ContextKind)EpfKindFrom(StripQuotes(kindName));
        JsonUnescapeField(msg, L"user", req.user);
        JsonUnescapeField(msg, L"password", req.password);
        req.user = StripQuotes(req.user);
        req.password = StripQuotes(req.password);
        JsonStringArray(msg, L"files", req.files);

        std::vector<epf::Platform> platforms = epf::FindPlatforms();
        platform = StripQuotes(platform);
        for (const auto& p : platforms)
            if (p.version == platform) req.platform = p;
        if (req.platform.ibcmd.empty() && !platforms.empty()) req.platform = platforms[0];

        /* An external object is never loaded into an infobase: it does not
         * live in one. A configuration dump may be both assembled and loaded. */
        if (req.dump == epf::DUMP_EXTERNAL) req.load = false;
        /* The infobase is needed both for loading and as the context an
         * external object's references resolve against. */
        bool needBase = req.load || (req.dump == epf::DUMP_EXTERNAL && req.kind == epf::CTX_BASE);
        baseId = StripQuotes(baseId);
        if (needBase) {
            for (const auto& b : epf::LoadIbases())
                if (b.id == baseId) req.base = b;
        }

        if (platforms.empty()) error = L"Не найдена установленная платформа 1С с ibcmd.exe.";
        else if (req.dump == epf::DUMP_NONE) error = L"Это не выгрузка: не найден корневой XML.";
        else if (!req.assemble && !req.load) error = L"Отметьте хотя бы одно действие.";
        else if (req.assemble && req.outFile.empty()) error = L"Укажите файл, в который собирать.";
        else if (needBase && req.base.name.empty()) error = L"Выберите информационную базу.";
        else if (needBase && epf::DesignerConnectArgs(req.base.connect).empty())
            error = L"Тип подключения базы не поддерживается.";
        else if (req.dump == epf::DUMP_EXTERNAL && req.kind == epf::CTX_CF
                 && (cf.empty() || !FileExists(cf)))
            error = L"CF-файл не найден.";
        if (!error.empty()) {
            PostJson(L"{\"cmd\":\"packDone\",\"ok\":false,\"started\":false,\"error\":" + JsonStr(error) + L"}");
            return;
        }

        epf::BuildSettings settings = epf::BuildSettings::Load();
        settings.assemble = req.assemble;
        settings.load = req.load;
        settings.updateDb = req.updateDb;
        settings.kind = req.kind;
        settings.cfPath = req.cfPath;
        if (!req.base.id.empty()) settings.baseId = req.base.id;
        settings.platform = req.platform.version == platforms[0].version ? std::wstring() : req.platform.version;
        settings.Save();
        if (needBase && !req.base.id.empty()) {
            epf::Settings auth = epf::Settings::Load();
            bool saveAuth = msg.find(L"\"saveAuth\":true") != std::wstring::npos;
            if (msg.find(L"\"useSaved\":true") != std::wstring::npos)
                auth.SavedPassword(req.base.id, req.password);
            if (saveAuth) auth.SaveAuth(req.base.id, req.user, req.password);
            auth.Save();
        }

        HWND events = BatchWindow();
        if (!events) {
            PostJson(L"{\"cmd\":\"packDone\",\"ok\":false,\"started\":false,\"error\":\"Не удалось начать сборку.\"}");
            return;
        }
        EpfRun* run = new EpfRun();
        run->host = this;
        mEpfRun = run;
        AddRef();
        ++g_batchJobs;
        PostJson(L"{\"cmd\":\"packStarted\"}");
        std::thread([run, req, events]() {
            std::function<void(const std::wstring&)> log = [run, events](const std::wstring& line) {
                PostEpfEvent(events, new EpfEvent{ run, L"{\"cmd\":\"packLog\",\"line\":" + JsonStr(line) + L"}", false, false });
            };
            std::wstring error;
            bool ok = false;
            try {
                ok = run->job.Build(req, log, error);
            } catch (...) {
                error = L"Внутренняя ошибка сборки.";
            }
            bool canceled = run->job.Canceled();
            std::wstring json = L"{\"cmd\":\"packDone\",\"started\":true,\"ok\":";
            json += ok ? L"true" : L"false";
            json += L",\"canceled\":";
            json += canceled ? L"true" : L"false";
            json += L",\"error\":" + JsonStr(error);
            json += L",\"out\":" + JsonStr(req.outFile) + L"}";
            if (!PostEpfEvent(events, new EpfEvent{ run, json, true, ok })) --g_batchJobs;
        }).detach();
        return;
    }
}

// --- Watching the open files for a write from outside -----------------------
//
// An agent edits the form the user has open, and the editor must show the new
// file without being reopened. The files are polled, not watched through
// ReadDirectoryChangesW: on Yandex.Disk and on network shares those
// notifications arrive late, arrive twice, or not at all, while looking at the
// size and the write time of two files costs nothing. Only when something has
// moved is the file read and its revision compared, so a touch that did not
// change the bytes goes no further.
//
// A clean document is replaced silently. A document with unsaved changes is
// only told about the change: its buffer wins, and the revision this host will
// check when it saves stays the one the page was loaded from, so that the save
// asks instead of overwriting.

/* Named in the header as an opaque member of the host, so it cannot live in
 * the anonymous namespace: the two HostWatch would be different types. */
struct HostWatch {
    std::mutex   mutex;
    std::wstring path[2];       // 0: the opened file, 1: its form module
    FileRevision known[2];      // the revision the page is showing
    FileRevision reported[2];   // the revision the page was last told about
    unsigned     gen;           // bumped by every publish; an older answer is dropped
    HANDLE       stop;
    bool         stopping;

    HostWatch() : gen(0), stop(NULL), stopping(false) {}
};

namespace {

const DWORD kWatchIntervalMs = 500;

struct WatchEvent {
    CWebView2Host* host;
    bool           module;
    unsigned       gen;
    TextFile       file;
};

// The bytes, not the metadata: a copy tool can move the write time of a file
// whose content is exactly what the page already holds.
bool SameContent(const FileRevision& left, const FileRevision& right)
{
    return left.valid && right.valid
        && left.contentHash == right.contentHash
        && left.sizeHigh == right.sizeHigh
        && left.sizeLow == right.sizeLow;
}

void WatchLoop(CWebView2Host* host, HostWatch* watch, HWND events)
{
    for (;;) {
        if (WaitForSingleObject(watch->stop, kWatchIntervalMs) == WAIT_OBJECT_0) break;
        for (int slot = 0; slot < 2; ++slot) {
            std::wstring path;
            FileRevision known, reported;
            unsigned gen = 0;
            {
                std::lock_guard<std::mutex> lock(watch->mutex);
                if (watch->stopping) break;
                path = watch->path[slot];
                known = watch->known[slot];
                reported = watch->reported[slot];
                gen = watch->gen;
            }
            if (path.empty() || !known.valid) continue;
            if (!FileChangedSince(path.c_str(), known)) continue;
            // Being written right now: the next tick reads it whole.
            TextFile file = ReadTextFile(path.c_str(), 64u * 1024u * 1024u);
            if (!file.ok) continue;
            if (SameContent(file.revision, known)) continue;
            if (SameContent(file.revision, reported)) continue;   // already reported
            {
                std::lock_guard<std::mutex> lock(watch->mutex);
                if (watch->stopping || watch->gen != gen) break;
                watch->reported[slot] = file.revision;
            }
            WatchEvent* e = new WatchEvent{ host, slot == 1, gen, file };
            host->AddRef();
            if (!PostMessageW(events, WM_BSLVIEW_WATCH_EVENT, 0, (LPARAM)e)) {
                host->Release();
                delete e;
            }
        }
    }
    if (watch->stop) CloseHandle(watch->stop);
    delete watch;
    host->Release();
    --g_batchJobs;
}

} // namespace

void CWebView2Host::PublishWatch()
{
    if (mClosed || mParked || (mFilePath.empty() && mFormModulePath.empty())) {
        StopWatch();
        return;
    }
    if (!mWatch) {
        HostWatch* watch = new HostWatch();
        watch->stop = CreateEventW(NULL, TRUE, FALSE, NULL);
        HWND events = BatchWindow();
        if (!watch->stop || !events) {
            if (watch->stop) CloseHandle(watch->stop);
            delete watch;
            return;
        }
        mWatch = watch;
        CWebView2Host* self = this;
        AddRef();
        ++g_batchJobs;   // Shutdown waits for it, the module may not unload under it
        std::thread([self, watch, events]() { WatchLoop(self, watch, events); }).detach();
    }
    std::lock_guard<std::mutex> lock(mWatch->mutex);
    /* The counter belongs to the host, not to the watcher: a stopped watcher
     * may still have an answer in flight while a new one is already running,
     * and restarting the numbering would make that answer look current. */
    mWatch->gen = ++mWatchGen;
    mWatch->path[0] = mFilePath;
    mWatch->known[0] = mFileRevision;
    mWatch->path[1] = mFormModulePath;
    mWatch->known[1] = mFormModuleRevision;
    // A new baseline: what was reported against the old one says nothing.
    mWatch->reported[0] = FileRevision();
    mWatch->reported[1] = FileRevision();
}

void CWebView2Host::StopWatch()
{
    HostWatch* watch = mWatch;
    if (!watch) return;
    mWatch = NULL;   // the thread owns it from here and frees it on its way out
    std::lock_guard<std::mutex> lock(watch->mutex);
    watch->stopping = true;
    SetEvent(watch->stop);
}

void CWebView2Host::OnWatchEvent(LPARAM lParam)
{
    WatchEvent* e = (WatchEvent*)lParam;
    CWebView2Host* host = e->host;
    /* A report about the document that was open when the tick started. The
     * host shows another one since, so neither its path nor its content has
     * anything to do with what is on screen. */
    const bool current = !host->mClosed && !host->mParked && host->mWatch
        && e->gen == host->mWatchGen;
    if (current) host->OnExternalChange(e->module, e->file);
    host->Release();
    delete e;
}

void CWebView2Host::OnExternalChange(bool module, const TextFile& file)
{
    std::wstring json = L"{\"cmd\":\"externalChange\",\"target\":";
    json += module ? L"\"module\"" : L"\"file\"";
    if (module ? mDirtyModule : mDirtyFile) {
        /* Nothing is thrown away behind the user's back, and the revision a
         * save will be checked against stays the one the buffer came from. */
        json += L",\"apply\":false}";
        PostJson(json);
        return;
    }
    if (module) {
        mFormModuleEncoding = file.encoding;
        mFormModuleRevision = file.revision;
    } else {
        mEncoding = file.encoding;
        mFileRevision = file.revision;
    }
    json += L",\"apply\":true,\"content\":" + JsonStr(file.text) + L"}";
    PostJson(json);
    PublishWatch();
}

// --- Comparing the document against a revision in git -----------------------
//
// The page's diff panel offers, besides the file on disk, the index and the
// commits that touched the file. Reading them means running git, so a query
// goes to a worker thread and comes back through the same message-only window
// the batch reads use. Only the revision name crosses over from the page; the
// path is always the one this host opened.

namespace {

// Enough history for the picker to be useful without making `git log` walk a
// long repository on every file that opens.
const size_t kGitLogLimit = 100;

struct GitEvent {
    CWebView2Host* host;
    std::wstring   json;
    bool           module;
    bool           haveInfo;   // an answer to "gitInfo": remember what it found
    git::FileInfo  info;
    unsigned       gen;        // the document the query was about (mGitGen)
};

std::wstring GitInfoJson(const std::wstring& reqId, bool module, const git::FileInfo& info)
{
    std::wstring json = L"{\"cmd\":\"gitInfo\",\"reqId\":" + JsonStr(reqId);
    json += L",\"target\":";
    json += module ? L"\"module\"" : L"\"file\"";
    json += L",\"ok\":";
    json += info.ok ? L"true" : L"false";
    if (!info.ok) {
        json += L",\"error\":" + JsonStr(info.error) + L"}";
        return json;
    }
    json += L",\"root\":" + JsonStr(info.root);
    json += L",\"relative\":" + JsonStr(info.relative);
    json += L",\"branch\":" + JsonStr(info.branch);
    json += L",\"status\":" + JsonStr(info.status);
    json += L",\"tracked\":";
    json += info.tracked ? L"true" : L"false";
    json += L",\"revisions\":[";
    for (size_t i = 0; i < info.revisions.size(); ++i) {
        const git::Revision& rev = info.revisions[i];
        if (i) json += L",";
        json += L"{\"id\":" + JsonStr(rev.id);
        json += L",\"short\":" + JsonStr(rev.shortId);
        json += L",\"date\":" + JsonStr(rev.date);
        json += L",\"ref\":" + JsonStr(rev.ref);
        json += L",\"author\":" + JsonStr(rev.author);
        json += L",\"subject\":" + JsonStr(rev.subject);
        json += L",\"same\":";
        json += rev.same ? L"true" : L"false";
        json += L"}";
    }
    json += L"]}";
    return json;
}

bool PostGitEvent(HWND target, GitEvent* e)
{
    if (target && PostMessageW(target, WM_BSLVIEW_GIT_EVENT, 0, (LPARAM)e)) return true;
    delete e;
    return false;
}

} // namespace

const std::wstring& CWebView2Host::GitPathFor(bool module) const
{
    return module ? mFormModulePath : mFilePath;
}

git::FileInfo& CWebView2Host::GitInfoFor(bool module)
{
    return module ? mGitModuleInfo : mGitFileInfo;
}

void CWebView2Host::OnGitEvent(LPARAM lParam)
{
    GitEvent* e = (GitEvent*)lParam;
    CWebView2Host* host = e->host;
    /* A query about the file that was open when it started. Another document
     * has been loaded since, so its answer describes neither the path nor the
     * history of the one on screen: drop it rather than cache it. */
    if (!host->mClosed && e->gen == host->mGitGen) {
        if (e->haveInfo) host->GitInfoFor(e->module) = e->info;
        host->PostJson(e->json);
    }
    --g_batchJobs;
    host->Release();
    delete e;
}

void CWebView2Host::OnGitMessage(const std::wstring& msg)
{
    std::wstring reqId;
    JsonUnescapeField(msg, L"reqId", reqId);
    bool module = JsonFieldEquals(msg, L"target", L"module");
    std::wstring path = GitPathFor(module);

    if (JsonFieldEquals(msg, L"cmd", L"gitInfo")) {
        if (path.empty()) {
            git::FileInfo empty;
            empty.error = L"нет открытого файла";
            GitInfoFor(module) = empty;
            PostJson(GitInfoJson(reqId, module, empty));
            return;
        }
        HWND events = BatchWindow();
        AddRef();
        ++g_batchJobs;
        CWebView2Host* self = this;
        unsigned gen = mGitGen;
        std::thread([self, events, reqId, module, path, gen]() {
            git::FileInfo info;
            try {
                info = git::Describe(path, kGitLogLimit);
            } catch (...) {
                info = git::FileInfo();
                info.error = L"внутренняя ошибка запроса к git";
            }
            GitEvent* e = new GitEvent{ self, GitInfoJson(reqId, module, info), module, true, info, gen };
            if (!PostGitEvent(events, e)) { --g_batchJobs; self->Release(); }
        }).detach();
        return;
    }

    /* What a commit from the page would take: the open file, or the whole
     * 1C object it belongs to. The plan and the commit both go by the path
     * this host opened; the page only picks the scope and the message. */
    bool plan = JsonFieldEquals(msg, L"cmd", L"gitCommitPlan");
    if (plan || JsonFieldEquals(msg, L"cmd", L"gitCommit")) {
        bool object = JsonFieldEquals(msg, L"scope", L"object");
        std::wstring message;
        JsonUnescapeField(msg, L"message", message);
        std::wstring answer = plan ? L"gitCommitPlan" : L"gitCommitted";
        if (path.empty()) {
            PostJson(L"{\"cmd\":\"" + answer + L"\",\"reqId\":" + JsonStr(reqId)
                + L",\"ok\":false,\"error\":" + JsonStr(L"нет открытого файла") + L"}");
            return;
        }
        HWND events = BatchWindow();
        AddRef();
        ++g_batchJobs;
        CWebView2Host* self = this;
        git::FileInfo known = GitInfoFor(module);
        unsigned gen = mGitGen;
        std::thread([self, events, reqId, module, path, known, gen, plan, object, message, answer]() {
            git::FileInfo info = known;
            std::wstring error, shortId;
            bool ok = false, fresh = false;
            std::vector<std::wstring> filePaths(1, path), objectPaths;
            try {
                if (!plan || !info.ok) { info = git::Describe(path, kGitLogLimit); fresh = true; }
                if (!info.ok) error = info.error.empty() ? L"файл не в рабочем дереве git" : info.error;
                else {
                    objectPaths = git::ObjectPaths(info.root, path);
                    ok = plan || git::Commit(info.root, object ? objectPaths : filePaths, message, &shortId, &error);
                    if (ok && !plan) { info = git::Describe(path, kGitLogLimit); fresh = true; }
                }
            } catch (...) {
                ok = false;
                error = L"внутренняя ошибка запроса к git";
            }
            std::wstring json = L"{\"cmd\":\"" + answer + L"\",\"reqId\":" + JsonStr(reqId);
            json += L",\"ok\":";
            json += ok ? L"true" : L"false";
            if (!ok) json += L",\"error\":" + JsonStr(error);
            if (ok && plan) {
                json += L",\"branch\":" + JsonStr(info.branch);
                json += L",\"file\":" + JsonStr(git::RelativeTo(info.root, path));
                json += L",\"object\":[";
                for (size_t i = 0; i < objectPaths.size(); ++i) {
                    if (i) json += L",";
                    json += JsonStr(git::RelativeTo(info.root, objectPaths[i]));
                }
                json += L"]";
            }
            if (ok && !plan) json += L",\"id\":" + JsonStr(shortId);
            json += L"}";
            GitEvent* e = new GitEvent{ self, json, module, fresh && info.ok, info, gen };
            if (!PostGitEvent(events, e)) { --g_batchJobs; self->Release(); }
        }).detach();
        return;
    }

    if (JsonFieldEquals(msg, L"cmd", L"gitShow")) {
        std::wstring rev;
        JsonUnescapeField(msg, L"rev", rev);
        /* A revision that is not a revision never reaches git: the check is
         * here as well as in git::Show so that a bad name costs no process. */
        if (!git::ValidRevision(rev) || path.empty()) {
            std::wstring json = L"{\"cmd\":\"gitContent\",\"reqId\":" + JsonStr(reqId);
            json += L",\"target\":";
            json += module ? L"\"module\"" : L"\"file\"";
            json += L",\"rev\":" + JsonStr(rev);
            json += L",\"ok\":false,\"error\":";
            json += path.empty() ? JsonStr(L"нет открытого файла")
                                 : JsonStr(L"недопустимое имя ревизии");
            json += L"}";
            PostJson(json);
            return;
        }
        HWND events = BatchWindow();
        AddRef();
        ++g_batchJobs;
        CWebView2Host* self = this;
        git::FileInfo known = GitInfoFor(module);
        unsigned gen = mGitGen;
        std::thread([self, events, reqId, module, path, rev, known, gen]() {
            git::FileInfo info = known;
            std::wstring text, error;
            bool ok = false;
            bool fresh = false;
            try {
                if (!info.ok) { info = git::Describe(path, kGitLogLimit); fresh = true; }
                ok = git::Show(info, rev, &text, &error);
            } catch (...) {
                ok = false;
                error = L"внутренняя ошибка запроса к git";
            }
            std::wstring json = L"{\"cmd\":\"gitContent\",\"reqId\":" + JsonStr(reqId);
            json += L",\"target\":";
            json += module ? L"\"module\"" : L"\"file\"";
            json += L",\"rev\":" + JsonStr(rev);
            json += L",\"ok\":";
            json += ok ? L"true" : L"false";
            json += ok ? L",\"content\":" + JsonStr(text)
                       : L",\"error\":" + JsonStr(error);
            json += L"}";
            GitEvent* e = new GitEvent{ self, json, module, fresh, info, gen };
            if (!PostGitEvent(events, e)) { --g_batchJobs; self->Release(); }
        }).detach();
        return;
    }
}
