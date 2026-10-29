/**
 * The pieces `format-corpus.ts` builds its strings from: what people type, what parsers trip on, and
 * the Unicode a host name can carry (spaces, dots, full-width forms, ignored and disallowed code
 * points, Punycode that decodes and Punycode that does not).
 */
export const URL_FRAGMENTS: readonly string[] = [
	"http", "https", "file", "ftp", "ws", "wss", "mailto", "javascript", "data", "a", "b", "Z", "1", "0",
	"255", "256", "65535", "65536", "://", ":", "/", "//", "\\", "@", "?", "#", ".", "..", "-", "_", "%",
	"%41", "%zz", "%2e", "%2E%2e", "%00", "%C3%A4", "%ff", "%e2%80%8b", "[", "]", "::", "::1",
	"1:2:3:4:5:6:7:8", "[::1]", "[1::]", "[::ffff:1.2.3.4]", "[fe80::1%25eth0]", "[1:2:3:4:5:6:1.2.3.4]",
	"localhost", "example.com", "exa mple", "münchen", "MÜNCHEN", "ß", "ς", "İ", "xn--", "XN--", "xn--mnchen-3ya",
	"xn--ls8h", "xn--a-ecp", "xn--example", "xn--0x7f", "xn--zca", "xn--nxa", "xn--1ca", "xn--a", "xn--abc-",
	"xn---", "xn--55qx5d", "xn--bcher-kva", "xn--BCHER-KVA", "xn--90a", "日本語", "\u00ad", "\u200b", "\u200c",
	"\u200d", "\u034f", "\u2060", "\ufe0f", "\t", "\n", " ", "  ", "\u0000", "\u0001", "\u001f", "\u007f",
	"\u0085", "\u00a0", "\u1680", "\u2000", "\u2007", "\u200a", "\u2028", "\u202f", "\u205f", "\u3000",
	"\ufeff", "\ufffd", "\ufdd0", "\ue000", "\u{1f600}", "\u{e0001}", "<", ">", "^", "|", "{", "}", "`",
	'"', "'", "~", "!", "$", "&", "(", ")", "*", "+", ",", ";", "=", "0x7f", "0x7f.1", "0X1", "1.2.3",
	"1.2.3.4.5", "999.1.1.1", "4294967296", "4294967295", "0300.0250.1.1", "08", "1e3", "ＡＢ", "ａ", "ｈｔｔｐ",
	"\u3002", "\uff0e", "\uff61", "\ufe52", "\u2024", "\u2025", "\u2474", "\u00bd", "\u2160", "\u0301",
	"\u0627", "\u05d0", "@@", "user:pass@", "u@", "a@b.c", "a@b", "@b.c", "a b@c.d", "x@y.z\n", "x@y\u00a0.z",
	"x@y.z\u2028",
];

export const URL_PREFIXES: readonly string[] = [
	"http://", "https://", "file:///", "file://", "ws://", "wss://", "ftp://", "foo://", "http:", "//",
	"HTTP://", "sc:", "sc://", "web+x:", "a1.-+:", "1a:",
];

export const DATE_YEARS: readonly string[] = ["2026", "2024", "2100", "2000", "1900", "0000", "9999", "202", "20260", "abcd"];
export const DATE_MONTHS: readonly string[] = ["01", "02", "04", "12", "00", "13", "1", "2", "09", "10"];
export const DATE_DAYS: readonly string[] = ["01", "28", "29", "30", "31", "00", "32", "1", "15", "3"];
export const DATE_SEPARATORS: readonly string[] = ["-", "-", "-", "/", "", "--"];
export const TIME_PARTS: readonly string[] = ["00", "12", "23", "59", "60", "24", "61", "5", "99"];
export const TIME_FRACTIONS: readonly string[] = ["", "", ".1", ".123456789", ".", ".a"];
export const TIME_ZONES: readonly string[] = [
	"Z", "z", "+00:00", "-23:59", "+24:00", "+05:60", "+0530", "+05", "", "UTC", "+05:30\n",
];
export const TIME_JOINS: readonly string[] = ["T", "t", " ", "", "TT"];
export const DATE_JUNK: readonly string[] = ["", "", "", "", " ", "\n", "x", "\u0660", "\uff11"];

export const PATTERN_FRAGMENTS: readonly string[] = [
	"^", "$", ".", "a", "b", "é", "\\d", "\\D", "\\w", "\\s", "\\S", "\\b", "\\B", "[a-z]", "[^a]", "[\\s\\S]",
	"[a-", "[]", "[^]", "+", "*", "?", "+?", "{2}", "{2,}", "{1,3}", "{,2}", "{", "}", "(", ")", "(?:", "(?=a)",
	"(?!a)", "(?<=a)", "(?<!a)", "(?<n>a)", "\\k<n>", "\\1", "|", "\\p{L}", "\\p{Lu}", "\\P{L}", "\\u{1F600}",
	"\\u0041", "\\x41", "\\uD83D", "\\uDE00", "\\c", "\\cA", "\\0", "\\/", "\\-", "\\a", "\\e", "😀", "\\.",
	"[\\d-z]", "\\q", "(?i)", "]", "\\", "[^\\d]", "[^\\u0100]", "[^\\p{L}]", "\\é", "[\\Ā]", "\\\u{10004}",
	"[\\\u{1F600}]", "\\p{Cn}", "\\p{Script=Garay}", "(?<é>a)", "(?<n>a)|(?<n>b)", "(?i:a)", "(?:(?<!a))", "(?:(?=a))", "(?:(?!a)|b)",
	"(?<=\\B)", "(?:(?<=a))",
];

export const PATTERN_TEXTS: readonly string[] = [
	"", "a", "b", "aa", "ab", "é", "e\u0301", "1", "12", "x", " ", "\n", "😀", "\ud83d", "\ude00", "A", "Ä",
	"a-b", "/", ".", "\u0000", "\u2028", "\u00a0", "k", "\u212a", "ſ", "\u0100", "Ā\u0000", "\u0000\u0100a",
	"\u{10004}", "\u{1D44E}", "\u088f", "\u0627", "éĀ", "a\u{1F600}A", "\u{1F600}\u{1F600}",
];
