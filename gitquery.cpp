#include "gitquery.h"
#include "bslcommon.h"

#include <shlwapi.h>
#include <algorithm>
#include <mutex>
#include <thread>

namespace git {

namespace {

const size_t kMaxBlobBytes = 32u * 1024u * 1024u;
const size_t kMaxInfoBytes = 4u * 1024u * 1024u;
const DWORD  kTimeoutMs = 15000;
// Staging a whole configuration export touches tens of thousands of files.
const DWORD  kAddTimeoutMs = 10u * 60u * 1000u;

// Windows argv quoting: CommandLineToArgvW reads it back as one argument
// whatever the argument contains.
std::wstring QuoteArg(const std::wstring& arg)
{
    if (!arg.empty() && arg.find_first_of(L" \t\"") == std::wstring::npos) return arg;
    std::wstring out = L"\"";
    for (size_t i = 0; i < arg.size(); ++i) {
        size_t slashes = 0;
        while (i < arg.size() && arg[i] == L'\\') { ++slashes; ++i; }
        if (i == arg.size()) {
            out.append(slashes * 2, L'\\');
            break;
        }
        if (arg[i] == L'"') out.append(slashes * 2 + 1, L'\\');
        else                out.append(slashes, L'\\');
        out.push_back(arg[i]);
    }
    out.push_back(L'"');
    return out;
}

/* git must never stop to ask a question and never write to the repository
 * just because we looked at it: the user is editing that working tree in
 * another window, and an index lock taken behind their back is a real bug. */
std::vector<wchar_t> ChildEnvironment()
{
    static const wchar_t* kOurs[] = {
        L"GIT_OPTIONAL_LOCKS=0",
        L"GIT_TERMINAL_PROMPT=0",
        L"GIT_ASKPASS=",
        L"GIT_PAGER=cat"
    };
    /* A GIT_DIR or GIT_WORK_TREE inherited from whoever started Total
     * Commander would point git at a repository other than the file's. */
    static const wchar_t* kDropped[] = {
        L"GIT_OPTIONAL_LOCKS=", L"GIT_TERMINAL_PROMPT=", L"GIT_ASKPASS=",
        L"GIT_PAGER=", L"GIT_DIR=", L"GIT_WORK_TREE=", L"GIT_INDEX_FILE="
    };

    std::vector<wchar_t> block;
    LPWCH env = GetEnvironmentStringsW();
    for (LPWCH p = env; env && *p; ) {
        size_t len = wcslen(p);
        bool drop = false;
        for (size_t i = 0; i < ARRAYSIZE(kDropped) && !drop; ++i)
            if (_wcsnicmp(p, kDropped[i], wcslen(kDropped[i])) == 0) drop = true;
        if (!drop) block.insert(block.end(), p, p + len + 1);
        p += len + 1;
    }
    if (env) FreeEnvironmentStringsW(env);
    for (size_t i = 0; i < ARRAYSIZE(kOurs); ++i)
        block.insert(block.end(), kOurs[i], kOurs[i] + wcslen(kOurs[i]) + 1);
    block.push_back(0);
    return block;
}

void ReadPipe(HANDLE pipe, size_t maxBytes, std::string* out)
{
    char buffer[65536];
    for (;;) {
        DWORD got = 0;
        if (!ReadFile(pipe, buffer, sizeof(buffer), &got, NULL) || got == 0) break;
        if (out->size() < maxBytes)
            out->append(buffer, (std::min)((size_t)got, maxBytes - out->size()));
    }
}

std::wstring TrimEol(const std::wstring& s)
{
    size_t end = s.size();
    while (end && (s[end - 1] == L'\n' || s[end - 1] == L'\r')) --end;
    return s.substr(0, end);
}

std::wstring NormalizeSlashes(const std::wstring& path, wchar_t to)
{
    std::wstring out = path;
    wchar_t from = to == L'\\' ? L'/' : L'\\';
    for (size_t i = 0; i < out.size(); ++i)
        if (out[i] == from) out[i] = to;
    return out;
}

std::wstring FullPath(const std::wstring& path)
{
    if (path.empty()) return path;
    std::vector<wchar_t> buffer(MAX_PATH * 4);
    DWORD len = GetFullPathNameW(path.c_str(), (DWORD)buffer.size(), buffer.data(), NULL);
    if (!len || len >= buffer.size()) return path;
    return std::wstring(buffer.data(), len);
}

/* Путь, каким его видит файловая система: junction и symlink раскрыты, буква
 * диска сохранена. Total Commander отдаёт путь таким, каким его набрал
 * пользователь (C:\Users\...\YandexDisk\...), а `git rev-parse --show-toplevel`
 * всегда отвечает раскрытым путём (C:\Users\...\Yandex.Disk\...). Без этого
 * префиксное сравнение в RelativeTo не совпадает и файл в junction-каталоге
 * выглядит как «не в рабочем дереве git». */
std::wstring ResolvedPath(const std::wstring& path)
{
    if (path.empty()) return path;
    HANDLE h = CreateFileW(path.c_str(), 0,
                           FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                           NULL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL);
    if (h == INVALID_HANDLE_VALUE) return FullPath(path);
    std::vector<wchar_t> buffer(MAX_PATH * 4);
    DWORD len = GetFinalPathNameByHandleW(h, buffer.data(), (DWORD)buffer.size(),
                                          FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    CloseHandle(h);
    if (!len || len >= buffer.size()) return FullPath(path);
    std::wstring out(buffer.data(), len);
    /* GetFinalPathNameByHandleW отдаёт путь с префиксом \\?\ (или \\?\UNC\);
     * git и остальной код работают с обычными путями. */
    if (out.compare(0, 8, L"\\\\?\\UNC\\") == 0) out = L"\\\\" + out.substr(8);
    else if (out.compare(0, 4, L"\\\\?\\") == 0) out = out.substr(4);
    return out;
}

bool RunIn(const std::wstring& dir, const std::vector<std::wstring>& args,
           size_t maxBytes, std::wstring* out)
{
    RunResult r = Run(dir, args, maxBytes, kTimeoutMs);
    if (!r.started || r.timedOut || r.code != 0) return false;
    if (out) *out = Utf8ToWide(r.out.c_str(), (int)r.out.size());
    return true;
}

// Finding the repository starts in the file's own directory, which is what
// makes git answer about the repository the file belongs to and no other.
// Everything after that runs at the root, because a pathspec is relative to
// the current directory: asked from the file's own directory, `git log --
// web/viewer.js` looks for web/web/viewer.js and quietly finds no commits.
bool RunInDirOf(const std::wstring& file, const std::vector<std::wstring>& args,
                size_t maxBytes, std::wstring* out)
{
    std::wstring dir = file;
    size_t slash = dir.find_last_of(L"\\/");
    if (slash == std::wstring::npos) return false;
    dir.erase(slash);
    return RunIn(dir, args, maxBytes, out);
}

} // namespace

std::wstring Executable()
{
    static std::once_flag once;
    static std::wstring path;
    std::call_once(once, []() {
        std::vector<wchar_t> buffer(MAX_PATH * 2);
        DWORD len = SearchPathW(NULL, L"git.exe", NULL, (DWORD)buffer.size(), buffer.data(), NULL);
        if (len && len < buffer.size()) path.assign(buffer.data(), len);
    });
    return path;
}

RunResult Run(const std::wstring& workDir, const std::vector<std::wstring>& args,
              size_t maxBytes, DWORD timeoutMs)
{
    RunResult result;
    std::wstring exe = Executable();
    if (exe.empty()) return result;

    std::wstring cmd = QuoteArg(exe);
    for (size_t i = 0; i < args.size(); ++i) cmd += L" " + QuoteArg(args[i]);
    std::vector<wchar_t> cmdBuf(cmd.begin(), cmd.end());
    cmdBuf.push_back(0);

    SECURITY_ATTRIBUTES sa = { sizeof(sa), NULL, TRUE };
    HANDLE readPipe = NULL, writePipe = NULL;
    if (!CreatePipe(&readPipe, &writePipe, &sa, 0)) return result;
    SetHandleInformation(readPipe, HANDLE_FLAG_INHERIT, 0);
    /* No console and no stdin: a git that decides to ask something reads EOF
     * instead of waiting for a keypress nobody can give it. */
    HANDLE nul = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                             &sa, OPEN_EXISTING, 0, NULL);

    /* Only these handles are inherited: another thread of the host starting a
     * process at the same time must not keep our pipe open, or the read below
     * never ends. */
    HANDLE inherit[2] = { writePipe, nul };
    SIZE_T attrSize = 0;
    InitializeProcThreadAttributeList(NULL, 1, 0, &attrSize);
    std::vector<BYTE> attrBuf(attrSize);
    LPPROC_THREAD_ATTRIBUTE_LIST attrs = (LPPROC_THREAD_ATTRIBUTE_LIST)attrBuf.data();
    bool attrsOk = InitializeProcThreadAttributeList(attrs, 1, 0, &attrSize)
        && UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherit,
                                     nul != INVALID_HANDLE_VALUE ? sizeof(inherit) : sizeof(HANDLE),
                                     NULL, NULL);

    std::vector<wchar_t> env = ChildEnvironment();
    STARTUPINFOEXW si = {};
    si.StartupInfo.cb = sizeof(si);
    si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si.StartupInfo.hStdInput = nul != INVALID_HANDLE_VALUE ? nul : NULL;
    si.StartupInfo.hStdOutput = writePipe;
    /* Diagnostics of a failed query are the exit code; git's own text on
     * stderr is in whatever locale the machine has and of no use to the page. */
    si.StartupInfo.hStdError = nul != INVALID_HANDLE_VALUE ? nul : NULL;
    si.lpAttributeList = attrsOk ? attrs : NULL;
    PROCESS_INFORMATION pi = {};
    /* A job object, so that a git which spawned helpers dies whole on timeout. */
    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (job) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
    }
    BOOL started = CreateProcessW(exe.c_str(), cmdBuf.data(), NULL, NULL, TRUE,
        CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT
            | (attrsOk ? EXTENDED_STARTUPINFO_PRESENT : 0),
        env.data(), workDir.empty() ? NULL : workDir.c_str(), &si.StartupInfo, &pi);
    if (attrsOk) DeleteProcThreadAttributeList(attrs);
    CloseHandle(writePipe);
    if (nul != INVALID_HANDLE_VALUE) CloseHandle(nul);
    if (!started) {
        CloseHandle(readPipe);
        if (job) CloseHandle(job);
        return result;
    }
    if (job) AssignProcessToJobObject(job, pi.hProcess);
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    result.started = true;

    std::string out;
    std::thread reader([&out, readPipe, maxBytes]() { ReadPipe(readPipe, maxBytes, &out); });
    if (WaitForSingleObject(pi.hProcess, timeoutMs) == WAIT_TIMEOUT) {
        result.timedOut = true;
        TerminateProcess(pi.hProcess, 1);
        WaitForSingleObject(pi.hProcess, INFINITE);
    }
    /* git itself has gone; whatever is left in the job is a helper it
     * started. Such a helper holds its own copy of the pipe's write end, and
     * while that copy is open the read below never reaches the end of the
     * stream - so the job dies before the join, not after it. What git
     * already wrote outlives its writer and is still read out. */
    if (job) { TerminateJobObject(job, 1); CloseHandle(job); }
    reader.join();
    CloseHandle(readPipe);
    GetExitCodeProcess(pi.hProcess, &result.code);
    CloseHandle(pi.hProcess);
    result.out.swap(out);
    return result;
}

std::wstring RelativeTo(const std::wstring& root, const std::wstring& file)
{
    if (root.empty() || file.empty()) return std::wstring();
    std::wstring base = NormalizeSlashes(ResolvedPath(root), L'\\');
    std::wstring path = NormalizeSlashes(ResolvedPath(file), L'\\');
    while (!base.empty() && base[base.size() - 1] == L'\\') base.erase(base.size() - 1);
    if (base.empty() || path.size() <= base.size() + 1) return std::wstring();
    if (_wcsnicmp(base.c_str(), path.c_str(), base.size()) != 0) return std::wstring();
    if (path[base.size()] != L'\\') return std::wstring();
    return NormalizeSlashes(path.substr(base.size() + 1), L'/');
}

bool ValidRevision(const std::wstring& rev)
{
    if (rev.empty()) return true;            // the index
    if (rev.size() > 200) return false;
    if (rev[0] == L'-') return false;        // never an option
    for (size_t i = 0; i < rev.size(); ++i) {
        wchar_t c = rev[i];
        if (c < 0x20 || c == 0x7F) return false;
        /* A colon would turn the revision into a revision:path of its own;
         * the rest is punctuation no ref name may contain anyway, and
         * refusing it keeps the argument out of reach of a hook's shell. */
        if (wcschr(L" \t:\\\"'`;&|<>*?[]()$", c)) return false;
    }
    /* `a..b` is a range and `.` is not a ref either. */
    if (rev == L"." || rev.find(L"..") != std::wstring::npos) return false;
    return true;
}

std::wstring ShortRefName(const std::wstring& ref)
{
    static const wchar_t* kPrefixes[] = {
        L"refs/heads/", L"refs/remotes/", L"refs/tags/"
    };
    for (size_t i = 0; i < ARRAYSIZE(kPrefixes); ++i) {
        size_t len = wcslen(kPrefixes[i]);
        if (ref.size() > len && ref.compare(0, len, kPrefixes[i]) == 0)
            return ref.substr(len);
    }
    return ref;
}

std::vector<Revision> ParseLog(const std::wstring& text)
{
    const size_t kFields = 6;
    std::vector<Revision> out;
    size_t pos = 0;
    while (pos < text.size()) {
        size_t eol = text.find(L'\n', pos);
        size_t len = eol == std::wstring::npos ? std::wstring::npos : eol - pos;
        std::wstring line = TrimEol(text.substr(pos, len));
        pos = eol == std::wstring::npos ? text.size() : eol + 1;
        if (line.empty()) continue;

        /* A raw line belongs to the commit above it: `:<mode> <mode> <old sha>
         * <new sha> <status>\t<path>`. The new sha is the content of the file
         * at that commit, and that is what tells a real change from a commit
         * that merely carries the file along. */
        if (line[0] == L':') {
            if (out.empty()) continue;
            std::wstring fields[5];
            size_t at = 1, count = 0;
            for (; count < 5; ++count) {
                size_t sp = line.find(L' ', at);
                if (sp == std::wstring::npos) break;
                fields[count] = line.substr(at, sp - at);
                at = sp + 1;
            }
            if (count >= 4) out.back().blob = fields[3];
            continue;
        }
        /* The format marks a commit line with \x01 so that it cannot be
         * confused with anything git prints between commits. */
        if (line[0] == L'\x01') line.erase(0, 1);

        std::wstring field[kFields];
        size_t at = 0;
        size_t count = 0;
        for (; count < kFields; ++count) {
            if (count == kFields - 1) {
                /* The subject comes last and may hold anything, separator
                 * characters included. */
                field[count] = line.substr(at);
                ++count;
                break;
            }
            size_t sep = line.find(L'\x1f', at);
            if (sep == std::wstring::npos) break;
            field[count] = line.substr(at, sep - at);
            at = sep + 1;
        }
        if (count < kFields || field[0].empty()) continue;
        Revision rev;
        rev.id = field[0];
        rev.shortId = field[1];
        rev.date = field[2];
        rev.ref = ShortRefName(field[3]);
        rev.author = field[4];
        rev.subject = field[5];
        out.push_back(rev);
    }
    return out;
}

// `--all` walks every branch, so the same content shows up under several
// commits: a release commit, a merge or a branch tip that only carried the
// file along. Two neighbours with the same blob are one version of the file,
// and the older of the two is the commit that actually produced it - the
// newer one changed nothing here and has no place in the picker. Only
// neighbours are folded: a file that comes back to an earlier content keeps
// both entries, because the revisions around them differ.
// A commit that deleted the file has the null blob: `git show` has nothing
// to give for it, so the picker must not offer it.
static bool IsNullBlob(const std::wstring& blob)
{
    return !blob.empty() && blob.find_first_not_of(L'0') == std::wstring::npos;
}

std::vector<Revision> DedupeUnchanged(const std::vector<Revision>& revs)
{
    std::vector<Revision> out;
    for (size_t i = 0; i < revs.size(); ++i) {
        if (IsNullBlob(revs[i].blob)) continue;
        bool same = !revs[i].blob.empty() && i + 1 < revs.size()
            && revs[i + 1].blob == revs[i].blob;
        if (same) continue;
        out.push_back(revs[i]);
    }
    return out;
}

/* `100644 <sha> 0\t<path>`: mode, blob, stage, path. A conflicted path has
   stages 1..3 and no content of its own, so only stage 0 answers. */
std::wstring ParseIndexBlob(const std::wstring& text)
{
    size_t end = text.find_first_of(L"\r\n");
    std::wstring line = end == std::wstring::npos ? text : text.substr(0, end);
    size_t mode = line.find(L' ');
    if (mode == std::wstring::npos) return std::wstring();
    size_t blob = line.find(L' ', mode + 1);
    if (blob == std::wstring::npos) return std::wstring();
    std::wstring sha = line.substr(mode + 1, blob - mode - 1);
    if (sha.empty()) return std::wstring();
    size_t stage = line.find_first_not_of(L' ', blob);
    if (stage == std::wstring::npos || line[stage] != L'0') return std::wstring();
    return sha;
}

void MarkCurrent(std::vector<Revision>& revs, const std::wstring& current)
{
    for (size_t i = 0; i < revs.size(); ++i)
        revs[i].same = !current.empty() && revs[i].blob == current;
}

std::wstring ParseStatus(const std::wstring& text)
{
    if (text.size() < 2) return std::wstring();
    std::wstring xy = text.substr(0, 2);
    if (xy == L"  ") return std::wstring();
    return xy;
}

FileInfo Describe(const std::wstring& file, size_t maxRevisions)
{
    FileInfo info;
    if (file.empty() || PathIsRelativeW(file.c_str())) {
        info.error = L"нет пути к файлу";
        return info;
    }
    if (Executable().empty()) {
        info.error = L"git.exe не найден в PATH";
        return info;
    }

    std::wstring root;
    std::vector<std::wstring> args;
    args.push_back(L"rev-parse");
    args.push_back(L"--show-toplevel");
    if (!RunInDirOf(file, args, kMaxInfoBytes, &root) || TrimEol(root).empty()) {
        info.error = L"файл не в рабочем дереве git";
        return info;
    }
    info.root = NormalizeSlashes(TrimEol(root), L'\\');
    info.relative = RelativeTo(info.root, file);
    if (info.relative.empty()) {
        info.error = L"файл не в рабочем дереве git";
        return info;
    }
    info.ok = true;

    std::wstring branch;
    args.clear();
    args.push_back(L"rev-parse");
    args.push_back(L"--abbrev-ref");
    args.push_back(L"HEAD");
    if (RunIn(info.root, args, kMaxInfoBytes, &branch)) info.branch = TrimEol(branch);
    if (info.branch == L"HEAD") {
        /* Detached: the branch name says nothing, the commit does. */
        std::wstring detached;
        args.clear();
        args.push_back(L"rev-parse");
        args.push_back(L"--short");
        args.push_back(L"HEAD");
        if (RunIn(info.root, args, kMaxInfoBytes, &detached)) info.branch = TrimEol(detached);
    }

    std::wstring status;
    args.clear();
    args.push_back(L"status");
    args.push_back(L"--porcelain");
    args.push_back(L"--untracked-files=all");
    args.push_back(L"--");
    args.push_back(info.relative);
    if (RunIn(info.root, args, kMaxInfoBytes, &status)) info.status = ParseStatus(status);

    /* Что лежит в индексе: по нему видно, какие ревизии совпадают с открытым
       файлом. Пока рабочий файл не тронут, индекс и есть его содержимое. */
    std::wstring staged;
    args.clear();
    args.push_back(L"ls-files");
    args.push_back(L"-s");
    args.push_back(L"--");
    args.push_back(info.relative);
    if (RunIn(info.root, args, kMaxInfoBytes, &staged)) info.indexBlob = ParseIndexBlob(staged);

    /* --all, because a revision worth comparing against often sits on another
     * branch; --source, because %S then names the ref each commit was reached
     * from, and that is the only cheap way to put a branch next to a commit.
     * No --follow: a revision the picker offers must name the file under the
     * path we then ask git to show, and a rename breaks that pairing. */
    std::wstring log;
    args.clear();
    args.push_back(L"log");
    args.push_back(L"--all");
    args.push_back(L"--source");
    args.push_back(L"-n");
    args.push_back(std::to_wstring(maxRevisions ? maxRevisions : 50));
    args.push_back(L"--date=short");
    args.push_back(L"--format=%x01%H%x1f%h%x1f%ad%x1f%S%x1f%an%x1f%s");
    /* --raw names the blob of the file at each commit, which is what tells a
     * commit that changed the file from one that only carried it along. Не
     * --diff-merges: он заставляет git показывать все merge-коммиты и ломает
     * упрощение истории; merge остаётся без blob и просто не дедуплицируется. */
    args.push_back(L"--raw");
    args.push_back(L"--no-abbrev");
    args.push_back(L"--");
    args.push_back(info.relative);
    if (RunIn(info.root, args, kMaxInfoBytes, &log))
        info.revisions = DedupeUnchanged(ParseLog(log));
    /* Ревизия, совпадающая с открытым файлом, в сравнении бесполезна. Если
       файл изменён или что-то лежит в индексе отдельно, содержимое на экране
       не равно индексу, и тогда не совпадает ничто. */
    MarkCurrent(info.revisions, info.status.empty() ? info.indexBlob : std::wstring());
    /* Untracked is what git status says; a file with no commits and nothing
     * staged is one git knows nothing about, whatever the status line says. */
    info.tracked = info.status != L"??" && (!info.revisions.empty() || !info.status.empty());
    return info;
}

bool Show(const FileInfo& info, const std::wstring& rev,
          std::wstring* text, std::wstring* error)
{
    if (error) error->clear();
    if (!info.ok || info.relative.empty()) {
        if (error) *error = L"файл не в рабочем дереве git";
        return false;
    }
    if (!ValidRevision(rev)) {
        if (error) *error = L"недопустимое имя ревизии";
        return false;
    }
    if (Executable().empty()) {
        if (error) *error = L"git.exe не найден в PATH";
        return false;
    }

    std::vector<std::wstring> args;
    args.push_back(L"show");
    args.push_back(rev + L":" + info.relative);
    RunResult r = Run(info.root, args, kMaxBlobBytes, kTimeoutMs);
    if (!r.started) {
        if (error) *error = L"не удалось запустить git";
        return false;
    }
    if (r.timedOut) {
        if (error) *error = L"git не ответил вовремя";
        return false;
    }
    if (r.code != 0) {
        if (error) *error = rev.empty() ? L"файла нет в индексе"
                                        : L"в этой ревизии файла нет";
        return false;
    }
    if (r.out.size() >= kMaxBlobBytes) {
        if (error) *error = L"файл слишком велик для сравнения";
        return false;
    }
    if (text) *text = DecodeTextBytes(r.out.data(), r.out.size(), NULL);
    return true;
}

bool AddFiles(const std::wstring& workDir, const std::wstring& initRoot,
              const std::vector<std::wstring>& files, std::wstring* root,
              std::wstring* error)
{
    if (error) error->clear();
    if (root) root->clear();
    if (Executable().empty()) {
        if (error) *error = L"git.exe не найден в PATH";
        return false;
    }
    if (workDir.empty() || initRoot.empty() || files.empty()) {
        if (error) *error = L"не заданы каталог или файлы для git add";
        return false;
    }

    std::wstring repo;
    std::vector<std::wstring> args = { L"rev-parse", L"--show-toplevel" };
    RunResult found = Run(workDir, args, kMaxInfoBytes, kTimeoutMs);
    if (found.started && !found.timedOut && found.code == 0) {
        repo = NormalizeSlashes(TrimEol(Utf8ToWide(found.out.c_str(), (int)found.out.size())), L'\\');
    } else {
        args = { L"init" };
        RunResult initialized = Run(initRoot, args, kMaxInfoBytes, kTimeoutMs);
        if (!initialized.started || initialized.timedOut || initialized.code != 0) {
            if (error) *error = L"не удалось создать git-репозиторий в " + initRoot;
            return false;
        }
        args = { L"rev-parse", L"--show-toplevel" };
        found = Run(initRoot, args, kMaxInfoBytes, kTimeoutMs);
        if (!found.started || found.timedOut || found.code != 0) {
            if (error) *error = L"git init выполнен, но корень репозитория не найден";
            return false;
        }
        repo = NormalizeSlashes(TrimEol(Utf8ToWide(found.out.c_str(), (int)found.out.size())), L'\\');
    }
    if (repo.empty()) {
        if (error) *error = L"git вернул пустой корень репозитория";
        return false;
    }

    std::vector<std::wstring> pathspecs;
    for (const std::wstring& file : files) {
        std::wstring relative = RelativeTo(repo, file);
        if (relative.empty()) {
            if (error) *error = L"файл находится вне git-репозитория: " + file;
            return false;
        }
        pathspecs.push_back(relative);
    }
    args = { L"add", L"--" };
    args.insert(args.end(), pathspecs.begin(), pathspecs.end());
    RunResult added = Run(repo, args, kMaxInfoBytes, kAddTimeoutMs);
    if (!added.started || added.timedOut || added.code != 0) {
        if (error) *error = added.timedOut ? L"git add не уложился в отведённое время"
                                           : L"git add завершился с ошибкой";
        return false;
    }
    if (root) *root = repo;
    return true;
}

namespace {

bool IsDir(const std::wstring& path)
{
    DWORD a = GetFileAttributesW(path.c_str());
    return a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY);
}

bool IsFile(const std::wstring& path)
{
    DWORD a = GetFileAttributesW(path.c_str());
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

} // namespace

std::vector<std::wstring> ObjectPaths(const std::wstring& root, const std::wstring& file)
{
    std::wstring top = NormalizeSlashes(root, L'\\');
    while (!top.empty() && top.back() == L'\\') top.pop_back();
    std::wstring path = NormalizeSlashes(file, L'\\');
    std::vector<std::wstring> found;
    /* The descriptor itself: X.xml opened beside its folder X. */
    if (path.size() > 4 && _wcsicmp(path.c_str() + path.size() - 4, L".xml") == 0
            && IsDir(path.substr(0, path.size() - 4)))
        found = { path, path.substr(0, path.size() - 4) };
    std::wstring dir = path;
    for (;;) {
        size_t slash = dir.find_last_of(L'\\');
        if (slash == std::wstring::npos) break;
        dir = dir.substr(0, slash);
        if (dir.size() <= top.size()) break;
        std::wstring name = dir.substr(dir.find_last_of(L'\\') + 1);
        if (IsFile(dir + L".xml")) found = { dir + L".xml", dir };
        else if (IsFile(dir + L"\\" + name + L".mdo")) found = { dir };
    }
    if (found.empty()) found.push_back(path);
    return found;
}

bool Commit(const std::wstring& root, const std::vector<std::wstring>& paths,
            const std::wstring& message, std::wstring* shortId, std::wstring* error)
{
    if (error) error->clear();
    if (shortId) shortId->clear();
    if (Executable().empty()) { if (error) *error = L"git.exe не найден в PATH"; return false; }
    if (root.empty() || paths.empty()) { if (error) *error = L"файл не в рабочем дереве git"; return false; }
    if (message.find_first_not_of(L" \t\r\n") == std::wstring::npos) {
        if (error) *error = L"пустое сообщение коммита";
        return false;
    }
    std::vector<std::wstring> specs;
    for (const std::wstring& p : paths) {
        std::wstring rel = RelativeTo(root, p);
        if (rel.empty()) { if (error) *error = L"файл вне git-репозитория: " + p; return false; }
        specs.push_back(rel);
    }
    std::vector<std::wstring> args = { L"add", L"-A", L"--" };
    args.insert(args.end(), specs.begin(), specs.end());
    RunResult added = Run(root, args, kMaxInfoBytes, kAddTimeoutMs);
    if (!added.started || added.timedOut || added.code != 0) {
        if (error) *error = L"git add завершился с ошибкой";
        return false;
    }
    args = { L"diff", L"--cached", L"--quiet", L"--" };
    args.insert(args.end(), specs.begin(), specs.end());
    RunResult changed = Run(root, args, kMaxInfoBytes, kTimeoutMs);
    if (changed.started && !changed.timedOut && changed.code == 0) {
        if (error) *error = L"нет изменений для коммита";
        return false;
    }
    args = { L"commit", L"-m", message, L"--" };
    args.insert(args.end(), specs.begin(), specs.end());
    RunResult done = Run(root, args, kMaxInfoBytes, kAddTimeoutMs);
    if (!done.started || done.timedOut || done.code != 0) {
        if (error) *error = done.timedOut ? L"git commit не уложился в отведённое время"
                                          : L"git commit завершился с ошибкой (хук, конфликт или не задан user.name/email)";
        return false;
    }
    args = { L"rev-parse", L"--short", L"HEAD" };
    RunResult head = Run(root, args, kMaxInfoBytes, kTimeoutMs);
    if (shortId && head.started && head.code == 0)
        *shortId = TrimEol(Utf8ToWide(head.out.c_str(), (int)head.out.size()));
    return true;
}

} // namespace git
