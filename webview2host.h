#ifndef WEBVIEW2HOST_H
#define WEBVIEW2HOST_H

#include <windows.h>
#include <string>
#include <vector>
#include <functional>

#include "bslcommon.h"
#include "gitquery.h"

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
    int          initialLine;      // global-search result to reveal after loading
    std::wstring initialSearch;    // also seeds Monaco find-next (F3)
    bool         initialRegexp;
    bool         initialMatchCase;
    /* Base URL of the 1C form viewer MCP preview that launched this window
     * (--preview-session): the form view keeps its annotations there, where
     * the agent reads them. Empty for every other open. */
    std::wstring previewSession;

    BslLoadRequest() : language("plaintext"), dark(false), fontSize(14), readOnly(true),
                       openFormModule(false), initialLine(0), initialRegexp(false),
                       initialMatchCase(false) {}
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

    // Shows the unpacking panel of an external data processor or report
    // (.epf/.erf) instead of a text file; mFilePath must name that file.
    void LoadEpf(bool dark, int fontSize, bool readOnly);
    void LoadPack(bool dark, int fontSize, bool readOnly);
    // Shows the assembly panel of the dump mFilePath belongs to (BSLEdit --pack).
    void OpenPackPanel(bool dark, int fontSize, bool readOnly);
    // Completion and progress of an unpacking, delivered on the UI thread.
    static void OnEpfEvent(LPARAM event);
    // The answer to a git query, delivered on the UI thread.
    static void OnGitEvent(LPARAM event);
    // A file of the open document changed behind the editor's back, delivered
    // on the UI thread.
    static void OnWatchEvent(LPARAM event);

    HWND         mParentWin;
    std::wstring mFilePath;
    TextEncoding mEncoding;
    FileRevision mFileRevision;
    // Called after the page opened another file in place (the object window's
    // forms, templates and modules, and the way back), so the owner can show
    // the current file in its window title.
    std::function<void(const std::wstring&)> mOnFileOpened;
    // True while the page holds changes that are not on disk yet. The callback
    // runs on the UI thread whenever that changes, so the window can mark the
    // file the way 1C does: a star after its name.
    bool         mDirty;
    // The same answer split by file, because the two files of a form are held
    // and protected one by one: an unsaved module must not stop an agent from
    // writing the layout, and the open marker of the one is not the other's.
    bool         mDirtyFile;
    bool         mDirtyModule;
    std::function<void(bool)> mOnDirtyChanged;
    // The settings window of the standalone editor. Set only there: the page
    // shows its settings button when the load message says the host has one.
    std::function<void()> mOnOpenSettings;
    // How templates and modules open: L"edit" or L"view"; empty keeps the
    // page's own default. Set by BSLEdit from its settings.
    std::wstring mOpenTemplates;
    std::wstring mOpenModules;
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
    void CaptureScreenshot();
    void PostJson(const std::wstring& json);
    void ConfigureSettings();
    void Reparent(HWND parent, bool visible);
    void OnEpfMessage(const std::wstring& msg);
    void OnPackMessage(const std::wstring& msg);
    void EnterPackPanel();
    bool StartPackWindow();
    void PostPackInfo(const std::wstring& source);
    void PostEpfInfo(const std::wstring& file, const std::wstring& target,
                     int kind, const std::wstring& cf, const std::wstring& platform);
    void CancelEpf();
    void OnGitMessage(const std::wstring& msg);
    /* Watching the open files for a write made behind the editor's back: an
     * agent editing the form the user is looking at. Publish after every load
     * and every save, so the watcher compares against what is on screen; stop
     * before the host lets go of its document. */
    void PublishWatch();
    void StopWatch();
    void OnExternalChange(bool module, const TextFile& file);
    // The file a git query is about: the form module when the page names it,
    // the opened file otherwise. Which of the two the page asked about is
    // never a path coming from the page.
    const std::wstring& GitPathFor(bool module) const;
    git::FileInfo& GitInfoFor(bool module);

    friend class EnvCompletedHandler;
    friend class CtrlCompletedHandler;
    friend class WebMessageHandler;
    friend class WebResourceHandler;
    friend class NavigationStartingHandler;
    friend class NewWindowHandler;
    friend class ProcessFailedHandler;
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
    bool                      mFocusEditorOnPaint;
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
    // The .epf/.erf whose unpacking panel this host shows (or came from), so
    // the way back from the unpacked object leads to it.
    std::wstring              mEpfPath;
    std::wstring              mPackPath;       // the dump the assembly panel works on
    std::wstring              mPackObject;     // its object to load, relative to the dump
    std::wstring              mPackObjectPath; // and the file to come back to
    struct EpfRun*            mEpfRun;   // the unpacking in progress, if any
    /* Where the opened file and its form module sit in git, as the last
     * "gitInfo" found them. Kept so that showing a revision does not have to
     * locate the repository again, and so that the revision the page names is
     * only ever paired with a path this host resolved itself. */
    git::FileInfo             mGitFileInfo;
    git::FileInfo             mGitModuleInfo;
    /* Which document the git answers in flight are about. Load() bumps it, so
     * a worker started for the previous file cannot write that file's root and
     * relative path back over the state of the one now open. */
    unsigned                  mGitGen;
    /* The worker that watches the open files, and what it compares against.
     * Defined in the implementation: only the watcher touches its innards. */
    struct HostWatch*         mWatch;
    /* Which publish a watcher's answer belongs to. Lives on the host so the
     * numbering survives a watcher being stopped and another one started. */
    unsigned                  mWatchGen;
};

#endif // WEBVIEW2HOST_H
