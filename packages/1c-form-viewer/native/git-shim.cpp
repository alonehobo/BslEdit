/* gitquery.cpp is shared with BSLEdit and calls two text helpers from
 * bslcommon.cpp. That file also carries BSLEdit's embedded assets and window
 * code, so the MCP server links these two instead of it. */
#include "../../../bslcommon.h"

#include <string>

/* Defined in mcp-server.cpp: the decoder the server reads files with. */
std::wstring mcp_decode_text_bytes(const unsigned char* bytes, std::size_t size, std::string& encoding);

std::wstring Utf8ToWide(const char* s, int len)
{
    if (!s || len <= 0) return std::wstring();
    const int size = MultiByteToWideChar(CP_UTF8, 0, s, len, nullptr, 0);
    std::wstring wide(static_cast<std::size_t>(size), L'\0');
    if (size > 0) MultiByteToWideChar(CP_UTF8, 0, s, len, wide.data(), size);
    return wide;
}

std::wstring DecodeTextBytes(const void* bytes, size_t size, TextEncoding* encoding)
{
    std::string name;
    const std::wstring text = mcp_decode_text_bytes(static_cast<const unsigned char*>(bytes), size, name);
    if (encoding) *encoding = name == "utf8-bom" ? ENC_UTF8_BOM : ENC_UTF8;
    return text;
}
