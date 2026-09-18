// Round-trip and escaping checks for bslcommon.cpp.
// Build with tools\run-tests.bat.

#include <windows.h>
#include <stdio.h>
#include <string>
#include <vector>

#include "../bslcommon.h"
#include "../packages/1c-form-viewer/native/context-batch.h"

static int g_failures = 0;

static void Check(bool cond, const char* what)
{
    printf("%s  %s\n", cond ? "[ ok ]" : "[FAIL]", what);
    if (!cond) g_failures++;
}

static std::wstring TempFilePath(const wchar_t* name)
{
    wchar_t dir[MAX_PATH];
    GetTempPathW(MAX_PATH, dir);
    return std::wstring(dir) + name;
}

static std::vector<BYTE> RawBytes(const std::wstring& path)
{
    std::vector<BYTE> out;
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (h == INVALID_HANDLE_VALUE) return out;
    DWORD size = GetFileSize(h, NULL);
    out.resize(size);
    DWORD got = 0;
    if (size) ReadFile(h, out.data(), size, &got, NULL);
    out.resize(got);
    CloseHandle(h);
    return out;
}

static void WriteRaw(const std::wstring& path, const void* data, size_t len)
{
    HANDLE h = CreateFileW(path.c_str(), GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    DWORD written = 0;
    if (len) WriteFile(h, data, (DWORD)len, &written, NULL);
    CloseHandle(h);
}

static bool HasSaveTemp(const std::wstring& path)
{
    WIN32_FIND_DATAW data = {};
    HANDLE find = FindFirstFileW((path + L".bslview-save-*.tmp").c_str(), &data);
    if (find == INVALID_HANDLE_VALUE) return false;
    FindClose(find);
    return true;
}

static void SetLastWriteTime(const std::wstring& path, const FILETIME& time)
{
    HANDLE h = CreateFileW(path.c_str(), FILE_WRITE_ATTRIBUTES,
                           FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                           NULL, OPEN_EXISTING, 0, NULL);
    if (h != INVALID_HANDLE_VALUE) {
        SetFileTime(h, NULL, NULL, &time);
        CloseHandle(h);
    }
}

// Reading a file, then saving it unchanged, must reproduce the original bytes.
static void TestRoundTrip(const char* label, const void* bytes, size_t len, TextEncoding expected)
{
    std::wstring path = TempFilePath(L"bslview_test_rt.tmp");
    WriteRaw(path, bytes, len);

    TextFile f = ReadTextFile(path.c_str(), 0);
    char msg[256];

    sprintf_s(msg, "%s: read succeeds", label);
    Check(f.ok, msg);

    sprintf_s(msg, "%s: encoding detected as %d", label, (int)expected);
    Check(f.encoding == expected, msg);

    Check(WriteTextFile(path.c_str(), f.text, f.encoding), "  write back succeeds");

    std::vector<BYTE> after = RawBytes(path);
    bool identical = (after.size() == len) && (len == 0 || memcmp(after.data(), bytes, len) == 0);
    sprintf_s(msg, "%s: bytes unchanged after save (%zu -> %zu)", label, len, after.size());
    Check(identical, msg);

    DeleteFileW(path.c_str());
}

int main()
{
    printf("== encoding round-trip ==\n");

    const char utf8Bom[] = "\xEF\xBB\xBF" "\xD0\x9F\xD1\x80\xD0\xBE\xD1\x86\xD0\xB5\xD0\xB4\xD1\x83\xD1\x80\xD0\xB0\r\n";
    TestRoundTrip("utf-8 bom", utf8Bom, sizeof(utf8Bom) - 1, ENC_UTF8_BOM);

    const char utf8[] = "\xD0\x9F\xD1\x80\xD0\xBE\xD1\x86\xD0\xB5\xD0\xB4\xD1\x83\xD1\x80\xD0\xB0\r\n";
    TestRoundTrip("utf-8 no bom", utf8, sizeof(utf8) - 1, ENC_UTF8);

    // "Процедура" in Windows-1251, which is what 1C Designer writes by default.
    const char cp1251[] = "\xCF\xF0\xEE\xF6\xE5\xE4\xF3\xF0\xE0\r\n";
    TestRoundTrip("windows-1251", cp1251, sizeof(cp1251) - 1, ENC_ANSI);

    {
        std::wstring path = TempFilePath(L"bslview_test_cp1251_loss.tmp");
        const char original[] = "unchanged";
        WriteRaw(path, original, sizeof(original) - 1);
        Check(!WriteTextFile(path.c_str(), L"Сообщить(\"漢字\");", ENC_ANSI),
              "windows-1251 rejects characters that require replacement");
        std::vector<BYTE> after = RawBytes(path);
        Check(after.size() == sizeof(original) - 1
              && memcmp(after.data(), original, sizeof(original) - 1) == 0,
              "rejected windows-1251 save leaves the original file intact");
        DeleteFileW(path.c_str());
    }

    printf("\n== atomic and conflict-safe save ==\n");
    {
        std::wstring path = TempFilePath(L"bslview_test_atomic.tmp");
        const char original[] = "original";
        WriteRaw(path, original, sizeof(original) - 1);
        TextFile loaded = ReadTextFile(path.c_str(), 0);
        Check(loaded.ok && loaded.revision.valid, "read returns a valid file revision");

        FileRevision saved;
        TextFileWriteResult first = WriteTextFileIfUnchanged(
            path.c_str(), L"first save", ENC_UTF8, &loaded.revision, &saved);
        Check(first == TEXT_FILE_WRITE_OK, "matching revision saves atomically");
        Check(saved.valid, "successful conditional save returns the new revision");
        std::vector<BYTE> afterFirst = RawBytes(path);
        Check(std::string(afterFirst.begin(), afterFirst.end()) == "first save",
              "atomic save publishes complete new content");

        TextFileWriteResult second = WriteTextFileIfUnchanged(
            path.c_str(), L"second save", ENC_UTF8, &saved, NULL);
        Check(second == TEXT_FILE_WRITE_OK, "returned revision permits the next save");

        TextFile beforeExternal = ReadTextFile(path.c_str(), 0);
        // Keep both size and timestamp unchanged: the byte hash must still
        // distinguish this in-place external edit.
        const char external[] = "outsideedit";
        WriteRaw(path, external, sizeof(external) - 1);
        SetLastWriteTime(path, beforeExternal.revision.lastWriteTime);
        TextFileWriteResult conflict = WriteTextFileIfUnchanged(
            path.c_str(), L"must not win", ENC_UTF8, &beforeExternal.revision, NULL);
        Check(conflict == TEXT_FILE_WRITE_CONFLICT, "external edit is reported as a conflict");
        std::vector<BYTE> afterConflict = RawBytes(path);
        Check(std::string(afterConflict.begin(), afterConflict.end()) == "outsideedit",
              "conflict leaves the external content intact");
        Check(!HasSaveTemp(path), "conflict removes its unpublished temporary file");

        DeleteFileW(path.c_str());
    }

    const char utf16le[] = "\xFF\xFE" "\x1F\x04\x40\x04\x3E\x04";
    TestRoundTrip("utf-16 le", utf16le, sizeof(utf16le) - 1, ENC_UTF16LE);

    const char utf16be[] = "\xFE\xFF" "\x04\x1F\x04\x40\x04\x3E";
    TestRoundTrip("utf-16 be", utf16be, sizeof(utf16be) - 1, ENC_UTF16BE);

    printf("\n== lossless content ==\n");
    {
        // Form feed and vertical tab used to be silently dropped on the way to
        // the editor, which meant editing a file deleted them permanently.
        const char withControls[] = "\xEF\xBB\xBF" "A\x0C" "B\x0B" "C\r\n";
        TestRoundTrip("control characters", withControls, sizeof(withControls) - 1, ENC_UTF8_BOM);

        // U+1F600, a surrogate pair in UTF-16, used to be re-encoded as CESU-8.
        const char emoji[] = "\xEF\xBB\xBF" "x\xF0\x9F\x98\x80y";
        TestRoundTrip("astral plane (surrogate pair)", emoji, sizeof(emoji) - 1, ENC_UTF8_BOM);
    }

    printf("\n== empty file ==\n");
    {
        std::wstring path = TempFilePath(L"bslview_test_empty.tmp");
        WriteRaw(path, "", 0);
        TextFile f = ReadTextFile(path.c_str(), 0);
        Check(f.ok, "empty file reads as ok (not an error)");
        Check(f.text.empty(), "empty file yields empty text");
        DeleteFileW(path.c_str());
    }

    printf("\n== size limit ==\n");
    {
        std::wstring path = TempFilePath(L"bslview_test_big.tmp");
        std::string big(200000, 'x');
        WriteRaw(path, big.data(), big.size());
        Check(!ReadTextFile(path.c_str(), 1000).ok, "file over the limit is rejected");
        Check(ReadTextFile(path.c_str(), 0).ok, "no limit means no rejection");
        DeleteFileW(path.c_str());
    }

    printf("\n== json escaping ==\n");
    {
        Check(JsonEscape(L"a\"b") == L"a\\\"b", "quote escaped");
        Check(JsonEscape(L"a\\b") == L"a\\\\b", "backslash escaped");
        Check(JsonEscape(L"a\nb") == L"a\\nb", "newline escaped");
        Check(JsonEscape(L"a\tb") == L"a\\tb", "tab escaped");
        Check(JsonEscape(L"a\x0C" L"b") == L"a\\fb", "form feed escaped, not dropped");
        Check(JsonEscape(L"a\x01" L"b") == L"a\\u0001b", "other control chars escaped as \\u");

        std::wstring astral;
        astral += (wchar_t)0xD83D;
        astral += (wchar_t)0xDE00;
        Check(JsonEscape(astral) == astral, "surrogate pair passes through untouched");
    }

    printf("\n== object meta path for Form.xml ==\n");
    {
        ObjectMetaPaths cat = ObjectMetaCandidates(
            L"E:\\cf\\Catalogs\\Partners\\Forms\\ItemForm\\Ext\\Form.xml");
        Check(cat.sibling == L"E:\\cf\\Catalogs\\Partners.xml",
              "catalog form -> sibling Partners.xml");
        Check(cat.nested == L"E:\\cf\\Catalogs\\Partners\\Partners.xml",
              "catalog form -> nested Partners/Partners.xml");

        ObjectMetaPaths ext = ObjectMetaCandidates(
            L"C:/src/CostReport2025/Forms/ReportForm/Ext/Form.xml");
        Check(ext.sibling == L"C:\\src\\CostReport2025.xml"
              || ext.sibling == L"C:/src/CostReport2025.xml",
              "external report form -> sibling xml (slash-preserving)");
        Check(ext.nested.find(L"CostReport2025") != std::wstring::npos
              && ext.nested.find(L"CostReport2025.xml") != std::wstring::npos,
              "external report form -> nested xml");

        ObjectMetaPaths bare = ObjectMetaCandidates(L"Form.xml");
        Check(bare.sibling.empty() && bare.nested.empty(),
              "bare Form.xml is not a dump path");

        ObjectMetaPaths notForm = ObjectMetaCandidates(
            L"E:\\cf\\Catalogs\\Partners.xml");
        Check(notForm.sibling.empty(), "object xml itself is not a form path");

        ObjectMetaPaths formMeta = ObjectMetaCandidates(
            L"E:\\cf\\Catalogs\\Partners\\Forms\\ItemForm.xml");
        Check(formMeta.sibling.empty(), "Forms\\ItemForm.xml is not Ext\\Form.xml");
    }

    printf("\n== object meta file lookup ==\n");
    {
        std::wstring root = TempFilePath(L"bslview_meta_lookup");
        std::wstring objDir = root + L"\\ExtReport";
        std::wstring formDir = objDir + L"\\Forms\\ReportForm\\Ext";
        std::wstring formXml = formDir + L"\\Form.xml";
        std::wstring sibling = root + L"\\ExtReport.xml";

        CreateDirectoryW(root.c_str(), NULL);
        CreateDirectoryW(objDir.c_str(), NULL);
        CreateDirectoryW((objDir + L"\\Forms").c_str(), NULL);
        CreateDirectoryW((objDir + L"\\Forms\\ReportForm").c_str(), NULL);
        CreateDirectoryW(formDir.c_str(), NULL);

        WriteRaw(formXml, "<Form/>", 7);
        Check(FindObjectMetaFile(formXml.c_str()).empty(),
              "no companion xml -> empty");

        const char meta[] = "<?xml version=\"1.0\"?><MetaDataObject><ExternalReport/></MetaDataObject>";
        WriteRaw(sibling, meta, sizeof(meta) - 1);
        Check(FindObjectMetaFile(formXml.c_str()) == sibling,
              "finds sibling ExtReport.xml for external object");


        DeleteFileW(sibling.c_str());
        DeleteFileW(formXml.c_str());
        RemoveDirectoryW(formDir.c_str());
        RemoveDirectoryW((objDir + L"\\Forms\\ReportForm").c_str());
        RemoveDirectoryW((objDir + L"\\Forms").c_str());
        RemoveDirectoryW(objDir.c_str());
        RemoveDirectoryW(root.c_str());
    }

    printf("\n== form context roots ==\n");
    {
        std::wstring root = TempFilePath(L"bslview_context_roots");
        std::wstring cf = root + L"\\cf";
        std::wstring cfe = root + L"\\cfe";
        std::wstring ext = cfe + L"\\Ext1";
        std::wstring form = ext + L"\\Documents\\Order\\Forms\\Main\\Ext\\Form.xml";
        CreateDirectoryW(root.c_str(), NULL);
        CreateDirectoryW(cf.c_str(), NULL);
        CreateDirectoryW(cfe.c_str(), NULL);
        CreateDirectoryW(ext.c_str(), NULL);
        WriteRaw(ext + L"\\Configuration.xml", "<MetaDataObject/>", 17);
        std::vector<std::wstring> roots = FormContextRoots(form.c_str());
        Check(roots.size() == 2 && roots[0] == ext && roots[1] == cf,
              "extension form reads its extension root and the base cf");
        DeleteFileW((ext + L"\\Configuration.xml").c_str());
        std::vector<std::wstring> loose = FormContextRoots(form.c_str());
        Check(!loose.empty() && loose[0] == ext + L"\\Documents",
              "without a configuration index only the object owner is exposed");
        RemoveDirectoryW(ext.c_str());
        RemoveDirectoryW(cfe.c_str());
        RemoveDirectoryW(cf.c_str());
        RemoveDirectoryW(root.c_str());
    }

    printf("\n== base configuration of an extension in any layout ==\n");
    {
        const char extensionXml[] = "<MetaDataObject><Configuration><Properties>"
            "<ConfigurationExtensionPurpose>Customization</ConfigurationExtensionPurpose>"
            "</Properties><ChildObjects/></Configuration></MetaDataObject>";
        const char baseXml[] = "<MetaDataObject><Configuration><Properties/><ChildObjects>"
            "<ConfigurationExtensionPurpose>ignored</ConfigurationExtensionPurpose>"
            "</ChildObjects></Configuration></MetaDataObject>";
        std::wstring root = TempFilePath(L"bslview_base_layout");
        std::wstring extensions = root + L"\\extensions";
        std::wstring ext = extensions + L"\\Ext1";
        std::wstring other = extensions + L"\\Ext2";
        std::wstring vendor = root + L"\\vendor";
        std::wstring main = vendor + L"\\main";
        std::wstring form = ext + L"\\Documents\\Order\\Forms\\Main\\Ext\\Form.xml";
        for (const std::wstring& directory : { root, extensions, ext, other, vendor, main })
            CreateDirectoryW(directory.c_str(), NULL);
        WriteRaw(ext + L"\\Configuration.xml", extensionXml, sizeof(extensionXml) - 1);
        WriteRaw(other + L"\\Configuration.xml", extensionXml, sizeof(extensionXml) - 1);
        WriteRaw(main + L"\\Configuration.xml", baseXml, sizeof(baseXml) - 1);
        std::vector<std::wstring> bases = context_batch::FindBaseConfigurations(ext);
        Check(bases.size() == 1 && bases[0] == main, "finds the configuration two levels away, skips extensions");
        std::vector<std::wstring> roots = FormContextRoots(form.c_str());
        Check(roots.size() == 2 && roots[0] == ext && roots[1] == main,
              "extension form reads the configuration found by Configuration.xml");
        ContextBatchAccess access;
        access.directory = [&roots](const std::wstring& path) {
            for (size_t i = 0; i < roots.size(); ++i)
                if (PathIsUnderRoot(roots[i], path)) return true;
            return false;
        };
        ContextBatchResult answer = HandleContextBatch("base-configurations\n" + context_batch::Utf8(ext), access);
        Check(answer.status == 200 && answer.body == context_batch::Utf8(main), "batch verb answers the allowed base");
        DeleteFileW((ext + L"\\Configuration.xml").c_str());
        DeleteFileW((other + L"\\Configuration.xml").c_str());
        DeleteFileW((main + L"\\Configuration.xml").c_str());
        for (const std::wstring& directory : { main, vendor, other, ext, extensions, root })
            RemoveDirectoryW(directory.c_str());
    }

    printf("\n== form layout lookup for a form descriptor ==\n");
    {
        std::wstring root = TempFilePath(L"bslview_form_layout");
        std::wstring formsDir = root + L"\\Forms";
        std::wstring layoutDir = formsDir + L"\\ФормаОтчета\\Ext";
        std::wstring layout = layoutDir + L"\\Form.xml";
        std::wstring meta = formsDir + L"\\ФормаОтчета.xml";

        CreateDirectoryW(root.c_str(), NULL);
        CreateDirectoryW(formsDir.c_str(), NULL);
        CreateDirectoryW((formsDir + L"\\ФормаОтчета").c_str(), NULL);
        CreateDirectoryW(layoutDir.c_str(), NULL);

        Check(FindFormLayoutForMeta(meta.c_str()).empty(),
              "no layout on disk yet -> empty");

        WriteRaw(layout, "<Form/>", 7);
        Check(FindFormLayoutForMeta(meta.c_str()) == layout,
              "descriptor -> sibling folder's Ext/Form.xml");

        Check(FindFormLayoutForMeta(layout.c_str()).empty(),
              "Ext/Form.xml itself is not a descriptor");

        std::wstring notInForms = root + L"\\ФормаОтчета.xml";
        Check(FindFormLayoutForMeta(notInForms.c_str()).empty(),
              "xml outside a Forms/ folder is not a descriptor");

        DeleteFileW(layout.c_str());
        RemoveDirectoryW(layoutDir.c_str());
        RemoveDirectoryW((formsDir + L"\\ФормаОтчета").c_str());
        RemoveDirectoryW(formsDir.c_str());
        RemoveDirectoryW(root.c_str());
    }

    printf("\n== template layout lookup for a template descriptor ==\n");
    {
        std::wstring root = TempFilePath(L"bslview_tpl_layout");
        std::wstring dir = root + L"\\Templates";
        std::wstring layoutDir = dir + L"\\ПФ_MXL_Счет\\Ext";
        std::wstring layout = layoutDir + L"\\Template.xml";
        std::wstring meta = dir + L"\\ПФ_MXL_Счет.xml";

        CreateDirectoryW(root.c_str(), NULL);
        CreateDirectoryW(dir.c_str(), NULL);
        CreateDirectoryW((dir + L"\\ПФ_MXL_Счет").c_str(), NULL);
        CreateDirectoryW(layoutDir.c_str(), NULL);

        Check(FindFormLayoutForMeta(meta.c_str()).empty(),
              "no template on disk yet -> empty");
        WriteRaw(layout, "<document/>", 11);
        Check(FindFormLayoutForMeta(meta.c_str()) == layout,
              "template descriptor -> sibling folder's Ext/Template.xml");
        Check(FindFormLayoutForMeta(layout.c_str()).empty(),
              "Ext/Template.xml itself is not a descriptor");

        DeleteFileW(layout.c_str());
        RemoveDirectoryW(layoutDir.c_str());
        RemoveDirectoryW((dir + L"\\ПФ_MXL_Счет").c_str());
        RemoveDirectoryW(dir.c_str());
        RemoveDirectoryW(root.c_str());
    }

    printf("\n== managed form display name ==\n");
    {
        Check(FormSnapshotBaseName(
            L"E:\\cf\\Documents\\Order\\Forms\\Main\\Ext\\Form.xml")
              == L"Документ.Order.Main",
              "configuration form uses the same stable stem as its snapshot");
        Check(FormSnapshotBaseName(L"C:\\tmp\\SimpleForm.xml") == L"SimpleForm",
              "ordinary xml uses its filename stem");
    }

    printf("\n== managed form module lookup ==\n");
    {
        std::wstring root = TempFilePath(L"bslview_form_module");
        std::wstring extDir = root + L"\\Forms\\Card\\Ext";
        std::wstring moduleDir = extDir + L"\\Form";
        std::wstring layout = extDir + L"\\Form.xml";
        std::wstring module = moduleDir + L"\\Module.bsl";
        CreateDirectoryW(root.c_str(), NULL);
        CreateDirectoryW((root + L"\\Forms").c_str(), NULL);
        CreateDirectoryW((root + L"\\Forms\\Card").c_str(), NULL);
        CreateDirectoryW(extDir.c_str(), NULL);
        CreateDirectoryW(moduleDir.c_str(), NULL);
        WriteRaw(layout, "<Form/>", 7);
        const char source[] = "Procedure Test()\r\nEndProcedure";
        WriteRaw(module, source, sizeof(source) - 1);
        Check(FindFormModuleFile(layout.c_str()) == module,
              "Ext/Form.xml -> Ext/Form/Module.bsl");
        Check(LoadFormModuleForForm(layout.c_str(), 0).ok,
              "loads the managed form module");
        Check(FindFormModuleFile((root + L"\\Forms\\Card.xml").c_str()).empty(),
              "form descriptor is not mistaken for a layout");
        Check(FindFormLayoutForModule(module.c_str()) == layout,
              "Ext/Form/Module.bsl -> Ext/Form.xml");
        Check(FindFormLayoutForModule((root + L"\\Module.bsl").c_str()).empty(),
              "a module outside Ext/Form has no form");
        DeleteFileW(layout.c_str());
        Check(FindFormLayoutForModule(module.c_str()).empty(),
              "no layout on disk -> the module opens on its own");
        DeleteFileW(module.c_str());
        DeleteFileW(layout.c_str());
        RemoveDirectoryW(moduleDir.c_str());
        RemoveDirectoryW(extDir.c_str());
        RemoveDirectoryW((root + L"\\Forms\\Card").c_str());
        RemoveDirectoryW((root + L"\\Forms").c_str());
        RemoveDirectoryW(root.c_str());
    }

    printf("\n== language mapping ==\n");
    {
        Check(!strcmp(MonacoLanguageForPath(L"a\\b\\Module.bsl"), "bsl"), ".bsl -> bsl");
        Check(!strcmp(MonacoLanguageForPath(L"Module.OS"), "bsl"), ".OS is case-insensitive");
        Check(!strcmp(MonacoLanguageForPath(L"query.sdbl"), "bsl_query"), ".sdbl -> bsl_query");
        Check(!strcmp(MonacoLanguageForPath(L"q.QUERY"), "bsl_query"), ".query -> bsl_query");
        Check(!strcmp(MonacoLanguageForPath(L"readme.md"), "markdown"), ".md -> markdown");
        Check(!strcmp(MonacoLanguageForPath(L"data.json"), "json"), ".json -> json");
        Check(!strcmp(MonacoLanguageForPath(L"report.SARIF"), "json"), ".sarif -> json");
        Check(!strcmp(MonacoLanguageForPath(L"meta.XML"), "xml"), ".xml is case-insensitive");
        Check(!strcmp(MonacoLanguageForPath(L"print.mxl"), "plaintext"), ".mxl is plaintext source");
        Check(!strcmp(MonacoLanguageForPath(L"noext"), "plaintext"), "no extension -> plaintext");
        Check(!strcmp(MonacoLanguageForPath(L"weird.zzz"), "plaintext"), "unknown -> plaintext");
    }

    {
        Check(PathIsUnderRoot(L"C:\\Src", L"C:\\Src\\CommonModules\\M.bsl"), "path is under root");
        Check(!PathIsUnderRoot(L"C:\\Src", L"C:\\Src2\\M.bsl"), "sibling prefix is denied");
        Check(!PathIsUnderRoot(L"C:\\Src", L"C:\\Src\\..\\Secret\\M.bsl"), "parent traversal is denied");
        Check(PathIsUnderRoot(L"c:\\src\\", L"C:\\SRC\\M.bsl"), "root comparison is case insensitive");
        Check(!PathIsUnderRoot(L"", L"C:\\Src\\M.bsl"), "empty root is denied");
        Check(IsSarifSourcePath(L"Z:\\Any Layout\\Module.BSL"), "absolute BSL source is eligible on any drive");
        Check(IsSarifSourcePath(L"Z:\\Any Layout\\Query.sdbl"), "query source is eligible for SARIF navigation");
        Check(!IsSarifSourcePath(L"Z:\\Any Layout\\secret.txt"), "arbitrary files are not SARIF sources");
        Check(!IsSarifSourcePath(L"Z:\\Any Layout\\data.json"), "SARIF cannot directly read another report");
    }

    printf("== md-links filter ==\n");
    {
        /* Same input and output as the md-links case of tests/metadata-relations.test.mjs. */
        const std::string text = "<A><Properties><Name>X</Name><Owners/><BasedOn><xr:Item>Document.B</xr:Item></BasedOn>"
            "<RegisterRecords><xr:Item>AccumulationRegister.R</xr:Item></RegisterRecords></Properties>"
            "<ChildObjects><Attribute><Type><v8:Type>xs:string</v8:Type></Type></Attribute><Subsystem>S</Subsystem></ChildObjects></A>";
        Check(context_batch::Filter(text, "md-links") ==
            "<BasedOn><xr:Item>Document.B</xr:Item></BasedOn>\n"
            "<RegisterRecords><xr:Item>AccumulationRegister.R</xr:Item></RegisterRecords>\n"
            "<Subsystem>S</Subsystem>", "md-links keeps the property link lists and child subsystems in file order");
        Check(context_batch::Filter("\xEF\xBB\xBF<A/>", "md-links") == "\xEF\xBB\xBF", "md-links keeps the BOM");
        /* Same as the rights-summary case of tests/metadata-relations.test.mjs. */
        const std::string rights = "<Rights><setForNewObjects>false</setForNewObjects>"
            "<object><name>Document.P</name>"
            "<right><name>Read</name><value>true</value><restrictionByCondition><condition>#X</condition></restrictionByCondition></right>"
            "<right><name>Delete</name><value>false</value></right>"
            "<right><name>Posting</name><value>true</value></right></object>"
            "<object><name>Catalog.S</name><right><name>Read</name><value>false</value></right></object>"
            "<restrictionTemplate><name>T</name><condition>...</condition></restrictionTemplate></Rights>";
        Check(context_batch::Filter(rights, "rights-summary") == "Document.P\tRead*,Posting",
            "rights-summary keeps granted rights and marks RLS");
    }

    printf("\n%s (%d failure%s)\n", g_failures ? "FAILED" : "PASSED", g_failures, g_failures == 1 ? "" : "s");
    return g_failures ? 1 : 0;
}
