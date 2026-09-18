#ifndef WEBVIEW2HOST_H
#define WEBVIEW2HOST_H

#include <windows.h>
#include <string>
#include <vector>
#include <functional>

#include "bslcommon.h"

struct ICoreWebView2;
struct ICoreWebView2Controller;
struct ICoreWebView2Environment;
struct ICoreWebView2WebResourceRequestedEventArgs;

// Posted to the host window when WebView2 could not be started, so the caller
// can put up the legacy IE control instead. Delivered asynchronously because
// controller creation does not block.
#define WM_BSLVIEW_WEBVIEW_FAILED (WM_APP + 17)

// Posted to the host window once the page has answered a RequestClose(): the
// wParam is nonzero when it is safe to DestroyWindow now (no unsaved edits,
// or the user chose to discard/save them), zero when the user cancelled.
#define WM_BSLVIEW_CLOSE_ACK (WM_APP + 18)

// Hostname the viewer is served from. Using a virtual host rather than file://
// keeps the document URL stable, which is what lets Chromium reuse its HTTP and
// V8 code caches across openings, and keeps the Monaco workers same-origin.
#define BSLVIEW_VIRTUAL_HOST L"bslview.invalid"

// Read-only endpoint through which the page's shared form-context.js reads the
// configuration files around the opened form (object metadata, common
// commands, pictures, style items). Served by WebResourceRequested and limited
// to FormContextRoots() of the current file.
#define BSLVIEW_CONFIG_HOST L"bslcfg.invalid"

struct BslLoadRequest {
    std::wstring content;
    const char*  language;
    bool         dark;
    int          fontSize;
    bool         readOnly;
    bool         openFormModule;   // a form opened from its Module.bsl starts on the module tab

    BslLoadRequest() : language("plaintext"), dark(false), fontSize(14), readOnly(true),
                       openFormModule(false) {}
};

class CWebView2Host {
public:
    // Cheap registry check; does not start the browser.
    static bool IsRuntimeAvailable();

    // Begins creating the process-wide environment and, when `keepWarm` is set,
    // a parked browser instance with the viewer page already loaded. Returns
    // immediately. Chromium only stays resident while some controller exists,
    // so the parked instance is what makes the next open cheap.
    static void WarmUp(const std::wstring& webRoot, bool keepWarm);
    // Standalone BSLEdit owns one HWND for its lifetime: no surface refresh.
    static void SetStandalone(bool standalone);

    static void Shutdown();

    static HRESULT LastError();

    // Hands back a host bound to `parent`, reusing the parked instance when one
    // is available. Returns immediately; if nothing was parked the browser is
    // attached later. Never returns NULL unless allocation fails.
    static CWebView2Host* Acquire(HWND parent, const std::wstring& webRoot);

    void AddRef();
    void Release();

    // Detaches from the window. The object stays alive until any in-flight
    // creation callback has run.
    void Close();

    // Detaches from the window but keeps the browser and the loaded viewer page
    // alive for the next open. Falls back to Close() when there is nothing
    // worth keeping or a slot is already taken.
    void Park();

    void Resize();

    // Shows `req` in the editor. Safe to call before the page has loaded; the
    // request is held and delivered once the page reports readiness. Calling it
    // again on a live page swaps the model without re-navigating.
    void Load(const BslLoadRequest& req);

    void Find(const std::wstring& text, bool matchCase, bool wholeWords, bool backwards, bool first);
    void SendCommand(const wchar_t* cmd);

    // Asks the page whether it is safe to close (it may put up its own
    // unsaved-changes prompt); the answer arrives asynchronously as
    // WM_BSLVIEW_CLOSE_ACK to mParentWin. Returns false when the page cannot
    // be asked yet, in which case the caller should close immediately instead
    // of waiting for an ack that will never come.
    bool RequestClose();

    HWND         mParentWin;
    std::wstring mFilePath;
    TextEncoding mEncoding;
    FileRevision mFileRevision;
    // Called after the page opened another file in place (the object window's
    // forms, templates and modules, and the way back), so the owner can show
    // the current file in its window title.
    std::function<void(const std::wstring&)> mOnFileOpened;
    // Ext/Form/Module.bsl of a Form.xml, edited and saved alongside the layout.
    std::wstring mFormModulePath;
    TextEncoding mFormModuleEncoding;
    FileRevision mFormModuleRevision;

private:
    CWebView2Host();
    ~CWebView2Host();

    void OnControllerCreated(HRESULT hr, ICoreWebView2Controller* ctrl);
    void OnProcessFailed();
    void OnWebMessage(const std::wstring& msg);
    void OnWebResourceRequested(ICoreWebView2WebResourceRequestedEventArgs* args);
    void OnPageReady();
    void ExportPdf();
    void CaptureScreenshot();
    void PostJson(const std::wstring& json);
    void ConfigureSettings();
    void Reparent(HWND parent, bool visible);

    friend class EnvCompletedHandler;
    friend class CtrlCompletedHandler;
    friend class WebMessageHandler;
    friend class WebResourceHandler;
    friend class NavigationStartingHandler;
    friend class NewWindowHandler;
    friend class ProcessFailedHandler;
    friend class PdfCompletedHandler;
    friend class ScreenshotCompletedHandler;

    long                      mRefCount;
    ICoreWebView2*            mWebView;
    ICoreWebView2Controller*  mController;
    std::wstring              mWebRoot;
    bool                      mClosed;
    bool                      mParked;
    bool                      mFailed;
    bool                      mPageReady;
    bool                      mHasPending;
    bool                      mDark;
    // The display mode of the last load, reused when the page opens a related
    // file (a form of the object window) in place.
    int                       mFontSize;
    bool                      mReadOnly;
    // Context roots of every file reached by in-place navigation since the
    // host last loaded a file of its own: a template's roots do not cover the
    // object it was opened from, and the way back must stay open.
    std::vector<std::wstring> mNavRoots;
    bool                      mNavigating;
    std::wstring              mPendingJson;
    std::vector<std::wstring> mAllowedRoots;
    std::vector<std::wstring> mContextRoots;
};

#endif // WEBVIEW2HOST_H
