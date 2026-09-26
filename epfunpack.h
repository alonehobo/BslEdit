#ifndef EPFUNPACK_H
#define EPFUNPACK_H

// Unpacking of external data processors and reports (.epf/.erf) into the
// Designer XML layout, the same way the standalone EpfUnpacker tool does it:
// ibcmd exports the file against a service file infobase kept in a cache
// (empty, or with a configuration loaded from a .cf so references resolve),
// or against an infobase from the user's list; a server infobase is reached
// through the Designer, because ibcmd cannot connect through a cluster.

#include <windows.h>
#include <atomic>
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace epf {

// An installed 1C:Enterprise platform that has ibcmd.exe.
struct Platform {
    std::wstring version;
    std::wstring ibcmd;
};

// Every platform found under Program Files, newest first.
std::vector<Platform> FindPlatforms();
// Dotted version comparison: <0, 0, >0.
int CompareVersions(const std::wstring& a, const std::wstring& b);

// An infobase of the user's list (%APPDATA%\1C\1CEStart\ibases.v8i).
struct InfoBase {
    std::wstring name;
    std::wstring id;
    std::wstring connect;
};

std::vector<InfoBase> ParseIbases(const std::wstring& text);   // sorted by name
std::vector<InfoBase> LoadIbases();
// File="C:\db";Srvr="x";Ref="y"; -> lower-case keys.
std::map<std::wstring, std::wstring> ParseConnect(const std::wstring& connect);
// /F <dir> or /S <server>\<ref>; empty when the connection kind is unsupported.
std::vector<std::wstring> DesignerConnectArgs(const std::wstring& connect);
// Directory of a file infobase, or empty for a server one.
std::wstring FileBasePath(const std::wstring& connect);
std::wstring ConnectDisplay(const std::wstring& connect);

// Quoting of one argument by the CommandLineToArgvW rules.
std::wstring QuoteArg(const std::wstring& arg);
// <dir of file>\<file name without extension>.
std::wstring DefaultTarget(const std::wstring& file);
// What the panel was opened for: an external data processor or report is
// unpacked alone; a configuration, an extension or an infobase dump may also
// be loaded into an infobase of the list or a new file one.
enum FileKind { FILE_OTHER, FILE_EXTERNAL, FILE_CF, FILE_CFE, FILE_DT };
FileKind KindOfFile(const std::wstring& path);
// The root XML of the unpacked result: <target>\<file name>.xml for an
// external file, <target>\Configuration.xml for a configuration/extension.
std::wstring RootXmlPath(const std::wstring& file, const std::wstring& target);
// The files the panel opens on: .epf .erf .cf .cfe .dt.
bool IsEpfPath(const std::wstring& path);
// Whether the user's list already has an infobase of this name.
bool IbaseNameExists(const std::wstring& name);
// Appends a file infobase to %APPDATA%/1C/1CEStart/ibases.v8i.
bool AddFileIbase(const std::wstring& name, const std::wstring& dir, std::wstring* error);

enum ContextKind { CTX_EMPTY, CTX_BASE, CTX_CF };

// Remembered between runs. A password only when the user asks to save the
// authorization of that infobase, and then encrypted with DPAPI for the
// current Windows user.
struct Settings {
    ContextKind kind;
    std::wstring baseId;
    std::wstring cfPath;
    std::wstring platform;   // empty: the newest installed one
    bool openAfter;
    // A .cf/.cfe/.dt: load into a base, unpack to XML, into a new file base.
    bool cfgLoad;
    bool cfgUnpack;
    bool cfgNewBase;
    bool cfgExtUnsafe;
    bool gitAdd;
    std::map<std::wstring, std::wstring> userByBase;
    std::map<std::wstring, std::wstring> passByBase;   // DPAPI, base64

    bool HasSavedAuth(const std::wstring& baseId) const { return passByBase.count(baseId) != 0; }
    bool SavedPassword(const std::wstring& baseId, std::wstring& password) const;
    void SaveAuth(const std::wstring& baseId, const std::wstring& user, const std::wstring& password);
    void ForgetAuth(const std::wstring& baseId) { passByBase.erase(baseId); }

    Settings() : kind(CTX_EMPTY), openAfter(false), cfgLoad(false), cfgUnpack(true), cfgNewBase(false), cfgExtUnsafe(false), gitAdd(false) {}
    static Settings Load();
    void Save() const;
};

// %LOCALAPPDATA%\BSLView\epf and its cache of service infobases.
std::wstring AppDataDir();
std::wstring CacheRoot();
unsigned long long CacheSize();
bool ClearCache(std::wstring* error);
// Cache key of a service infobase; empty for an infobase of the list, which
// is used as it is.
std::wstring CacheKey(ContextKind kind, const std::wstring& cfPath, const std::wstring& version);
// When the cached service infobase was built ("dd.MM.yyyy HH:mm"), or empty.
std::wstring CacheBuilt(const std::wstring& key);

struct UnpackRequest {
    std::wstring file;
    std::wstring target;
    Platform platform;
    ContextKind kind;
    InfoBase base;
    std::wstring user;
    std::wstring password;
    std::wstring cfPath;
    // A .cf/.cfe/.dt: what to do with it and, when loading, into which base.
    bool load;
    bool unpack;
    bool newBase;              // a new file infobase instead of `base`
    std::wstring newName;      // its name in the list
    std::wstring newDir;       // its directory
    bool extUnsafe;            // .cfe: switch off safe mode and unsafe-action protection
    bool gitAdd;               // add unpacked .epf/.erf/.cf/.cfe files to Git
    UnpackRequest() : kind(CTX_EMPTY), load(false), unpack(true), newBase(false), extUnsafe(false), gitAdd(false) {}
};

// --- The reverse direction: XML back into a file or an infobase --------------
//
// What the Designer's "Загрузить конфигурацию из файлов" and
// "Загрузить внешнюю обработку из файлов" do: an unpacked object is built
// back into an .epf/.erf/.cf/.cfe, or loaded into an infobase whole or by
// the files the user picked.

// What an unpacked source holds.
enum DumpKind { DUMP_NONE, DUMP_EXTERNAL, DUMP_CONFIG };
// Reads the root XML of a dump. `path` is the root XML itself or the folder
// holding it; `rootXml` comes back as that file and `dumpDir` as the folder
// relative paths count from. `extension` is the name of the extension a
// configuration dump belongs to, empty for the configuration itself, and
// `report` says an external dump is a report (.erf) rather than a data
// processor (.epf).
DumpKind KindOfDump(const std::wstring& path, std::wstring* rootXml,
                    std::wstring* dumpDir, std::wstring* extension, bool* report);
// Catalogs\X\Forms\F\Ext\Form.xml -> Catalogs\X.xml. The Designer loads
// objects, not the files inside them, so every changed file names its object.
std::wstring ObjectFileOf(const std::wstring& relative);
// The file an assembly writes by default: named after the dump and one level
// above the folder it fills, because a dump lives in a folder of its own and
// the file it was built from sits beside that folder. `suffix` is the file's
// own extension, .epf .erf .cf or .cfe.
std::wstring DefaultOutFile(const std::wstring& rootXml, DumpKind kind, const std::wstring& suffix);
// .epf/.erf for an external object, .cf/.cfe for a configuration.
std::wstring OutSuffix(DumpKind kind, bool report, bool extension);

/* 1C prints durations in milliseconds; these turn them into seconds,
 * minutes and hours for the log. */
std::wstring HumanDuration(long long ms);
std::wstring HumanizeMilliseconds(const std::wstring& line);

struct BuildRequest {
    std::wstring source;        // the dump's root XML
    std::wstring dumpDir;       // the folder relative paths count from
    DumpKind dump;
    Platform platform;
    // Building the object back into a file.
    bool assemble;
    std::wstring outFile;       // .epf/.erf, or .cf/.cfe for a configuration
    // Loading the dump into an infobase of the user's list.
    bool load;
    InfoBase base;
    std::wstring user;
    std::wstring password;
    std::vector<std::wstring> files;   // relative; empty: the whole dump
    bool updateDb;              // update the database configuration afterwards
    std::wstring extension;     // the extension the dump belongs to
    // The configuration an external object's references resolve against,
    // exactly as when unpacking it.
    ContextKind kind;
    std::wstring cfPath;
    BuildRequest() : dump(DUMP_NONE), assemble(true), load(false), updateDb(true), kind(CTX_EMPTY) {}
};

// Remembered between runs of the assembly panel.
struct BuildSettings {
    bool assemble;
    bool load;
    bool updateDb;
    std::wstring baseId;
    std::wstring platform;
    ContextKind kind;
    std::wstring cfPath;
    BuildSettings() : assemble(true), load(false), updateDb(true), kind(CTX_EMPTY) {}
    static BuildSettings Load();
    void Save() const;
};

// One unpacking. Run() blocks (call it on a worker thread) and reports
// progress through `log` on that thread; Cancel() may be called from any
// thread and kills the processes started so far.
class Job {
public:
    Job();
    ~Job();
    bool Run(const UnpackRequest& req, const std::function<void(const std::wstring&)>& log,
             std::wstring& error);
    // The other direction: assemble the dump into a file, load it into an
    // infobase, or both. Blocks and cancels the same way Run() does.
    bool Build(const BuildRequest& req, const std::function<void(const std::wstring&)>& log,
               std::wstring& error);
    void Cancel();
    bool Canceled() const { return mCanceled; }

private:
    struct RunResult { bool started; DWORD code; };
    RunResult RunProcess(const std::wstring& exe, const std::vector<std::wstring>& args,
                         const std::function<void(const std::wstring&)>* onLine);
    RunResult Ibcmd(const std::vector<std::wstring>& args,
                    const std::function<void(const std::wstring&)>* onLine);
    bool UnpackWithBase(const std::wstring& outDir, const std::wstring& rootXml, std::wstring& error);
    bool Assemble(std::wstring& error);
    bool AssembleExternal(std::wstring& error);
    bool AssembleConfig(std::wstring& error);
    bool LoadDump(std::wstring& error);
    bool DesignerDump(const std::wstring& rootXml, std::wstring& error);
    bool RunDesigner(const std::vector<std::wstring>& action, const std::wstring& what, std::wstring& error);
    bool RunConfig(std::wstring& error);
    bool ScratchBase(std::wstring& dir, std::wstring& error);
    bool ExtensionName(std::wstring& name, std::wstring& error);
    bool UnsafeExtension(const std::wstring& dbPath, const std::vector<std::wstring>& auth,
                         const std::wstring& name, std::wstring& error);
    bool IbcmdStep(const std::vector<std::wstring>& args, const std::wstring& failText, std::wstring& error);
    bool EnsureInfoBase(const std::wstring& cacheDir, std::wstring& ibDir, std::wstring& error);
    HANDLE AcquireLock(const std::wstring& path);
    void EvictOldCaches(const std::wstring& keep);
    void Log(const std::wstring& line);

    UnpackRequest mReq;
    BuildRequest mBuild;
    const std::function<void(const std::wstring&)>* mLog;
    std::atomic<bool> mCanceled;
    std::mutex mJobLock;
    HANDLE mJobObject;
};

} // namespace epf

#endif // EPFUNPACK_H
