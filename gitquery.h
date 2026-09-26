#ifndef GITQUERY_H
#define GITQUERY_H

#include <windows.h>
#include <string>
#include <vector>

// Reading a file's history out of a git working tree.
//
// The viewer compares the open document against a revision the user picks;
// besides reading, it only stages (AddFiles) and commits (Commit) the paths
// the user named, and never checks anything out. git.exe is taken from PATH; without Git for Windows the viewer simply
// offers no revisions. Every call runs a fresh process, which is fast enough
// for one file and keeps us out of the business of parsing .git ourselves.

namespace git {

// One commit that touched the file.
struct Revision {
    std::wstring id;       // full object name
    std::wstring shortId;  // what the picker shows
    std::wstring date;     // YYYY-MM-DD, author date
    std::wstring ref;      // the branch or tag this commit was reached from
    std::wstring author;
    std::wstring subject;
    std::wstring blob;     // content of the file at this commit, when known
    bool same;             // this content is what the file holds right now
    Revision() : same(false) {}
};

// What the page needs to fill the revision picker for one file.
struct FileInfo {
    bool ok;                  // the file is inside a git working tree
    std::wstring error;       // why not, when it is not
    std::wstring root;        // working tree root, with backslashes
    std::wstring relative;    // path inside the tree, with forward slashes
    std::wstring branch;      // current branch, or a short sha when detached
    std::wstring status;      // porcelain XY of the file, empty when unchanged
    std::wstring indexBlob;   // what the index holds for this path, when it does
    bool tracked;             // git knows this path at HEAD or in the index
    std::vector<Revision> revisions;
    FileInfo() : ok(false), tracked(false) {}
};

// Full path of git.exe as found on PATH, empty when there is none. The answer
// is cached: PATH does not change while the viewer is open.
std::wstring Executable();

struct RunResult {
    bool  started;
    bool  timedOut;
    DWORD code;
    std::string out;   // stdout, raw bytes; stderr goes nowhere
    RunResult() : started(false), timedOut(false), code((DWORD)-1) {}
};

// Runs git with `args` in `workDir`, capturing at most `maxBytes` of stdout
// and killing the process (and anything it started) after `timeoutMs`.
RunResult Run(const std::wstring& workDir, const std::vector<std::wstring>& args,
              size_t maxBytes, DWORD timeoutMs);

// --- pure helpers, testable without a repository ---------------------------

// `file` as git spells it below `root`: relative, forward slashes. Empty when
// the file is not under the root.
std::wstring RelativeTo(const std::wstring& root, const std::wstring& file);

// A revision name coming from the page is user input. Accepted are the names
// git accepts - a sha, a branch, a tag, HEAD~2, a `refs/...` - and nothing
// that could be read as an option, a second path or a path of its own. The
// empty string is the index and is valid.
bool ValidRevision(const std::wstring& rev);

// Output of `git log --source --raw --format=%x01%H%x1f%h%x1f%ad%x1f%S%x1f%an%x1f%s`.
// A commit line carries six fields and is marked with ; a `:...` raw line
// below it gives that commit's blob. A line short of all six fields is
// skipped rather than half-parsed.
std::vector<Revision> ParseLog(const std::wstring& text);

// Drops the revisions where the file did not change: with `--all` the same
// blob appears under several commits, and only the oldest of a neighbouring
// run of them is the commit that produced that content. A commit with no
// blob of its own - a merge - is left alone.
std::vector<Revision> DedupeUnchanged(const std::vector<Revision>& revs);

// refs/heads/main -> main, refs/remotes/origin/main -> origin/main,
// refs/tags/v2.0 -> v2.0. Anything else is returned unchanged.
std::wstring ShortRefName(const std::wstring& ref);

// The porcelain XY of the first entry of `git status --porcelain` output, or
// an empty string when the file is unchanged.
std::wstring ParseStatus(const std::wstring& text);

// The blob of the first stage-0 entry of `git ls-files -s` output - what the
// index holds for the path. Empty when the path is not in the index or the
// entry is a conflict stage.
std::wstring ParseIndexBlob(const std::wstring& text);

// Marks the revisions whose content is what the file holds right now, so the
// picker can leave them out: comparing against them shows nothing. `current`
// is the blob of the open file, empty when it is not known - then nothing is
// marked, because an unsaved or staged change makes every revision differ.
void MarkCurrent(std::vector<Revision>& revs, const std::wstring& current);

// --- the queries -----------------------------------------------------------

// Where `file` sits in git and what its recent history is. `maxRevisions`
// caps the log; a repository with a long history must not stall the picker.
FileInfo Describe(const std::wstring& file, size_t maxRevisions);

// Content of the file at `rev` (an empty `rev` is the index), decoded the way
// ReadTextFile decodes a file on disk. False when git has no such revision of
// this path, with the reason in `error`.
bool Show(const FileInfo& info, const std::wstring& rev,
          std::wstring* text, std::wstring* error);

// Stage explicit files in the repository containing workDir. If none exists,
// initialize one at initRoot first. Paths may be absolute; they are converted
// to repository-relative pathspecs before invoking `git add`.
bool AddFiles(const std::wstring& workDir, const std::wstring& initRoot,
              const std::vector<std::wstring>& files, std::wstring* root,
              std::wstring* error);

// The files that make up the 1C object `file` belongs to, as absolute paths:
// in an export, the outermost `X.xml` beside a folder `X` below `root` (the
// `<folder name>.mdo`. A file outside any object is the object itself.
std::vector<std::wstring> ObjectPaths(const std::wstring& root, const std::wstring& file);

// Commits exactly `paths` (absolute, below info.root) with `message`: they are
// staged first, so new and deleted files go in, and nothing else that is
// staged is taken along. `shortId` gets the new commit; `error` says why not.
bool Commit(const std::wstring& root, const std::vector<std::wstring>& paths,
            const std::wstring& message, std::wstring* shortId, std::wstring* error);

} // namespace git

#endif // GITQUERY_H
