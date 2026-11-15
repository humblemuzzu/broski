/**
 * Rust names for the contract's types, fields and variants. UniFFI exports every type to Swift and Kotlin
 * under the same name, so a name must also be free in the Swift and Kotlin files UniFFI generates and in
 * the app code that imports them (UniFFI 0.32.2, `bindings/{swift,kotlin}/templates`).
 */

/** Rust's strict and reserved keywords (the Reference, "Keywords"). */
const RUST_KEYWORDS = new Set([
	"abstract",
	"as",
	"async",
	"await",
	"become",
	"box",
	"break",
	"const",
	"continue",
	"crate",
	"do",
	"dyn",
	"else",
	"enum",
	"extern",
	"false",
	"final",
	"fn",
	"for",
	"gen",
	"if",
	"impl",
	"in",
	"let",
	"loop",
	"macro",
	"match",
	"mod",
	"move",
	"mut",
	"override",
	"priv",
	"pub",
	"ref",
	"return",
	"self",
	"Self",
	"static",
	"struct",
	"super",
	"trait",
	"true",
	"try",
	"type",
	"typeof",
	"unsafe",
	"unsized",
	"use",
	"virtual",
	"where",
	"while",
	"yield",
]);

/** Keywords Rust refuses even as raw identifiers. */
const NOT_RAW = new Set(["crate", "self", "Self", "super"]);

/**
 * Type names already taken where a generated type lands: the Rust prelude and what the generated Rust
 * names; Swift's standard library and Foundation (the bindings import it); Kotlin's default imports and
 * the JNA and java.nio names the bindings import; UniFFI's own declarations.
 */
const TAKEN_TYPE_NAMES = new Set([
	// Rust
	"AsMut",
	"AsRef",
	"Box",
	"Clone",
	"Copy",
	"Default",
	"Deserialize",
	"DoubleEndedIterator",
	"Drop",
	"Eq",
	"Err",
	"ExactSizeIterator",
	"Extend",
	"Fn",
	"FnMut",
	"FnOnce",
	"From",
	"FromIterator",
	"Into",
	"IntoIterator",
	"Iterator",
	"JsonMember",
	"JsonValue",
	"None",
	"Ok",
	"Option",
	"Ord",
	"PartialEq",
	"PartialOrd",
	"Result",
	"Send",
	"Serialize",
	"Sized",
	"Some",
	"String",
	"Sync",
	"Tagged",
	"ToOwned",
	"ToString",
	"TryFrom",
	"TryInto",
	"Unpin",
	"Vec",
	// Swift
	"Any",
	"AnyObject",
	"Array",
	"Bool",
	"Character",
	"Codable",
	"Collection",
	"Data",
	"Date",
	"Decimal",
	"Decodable",
	"Dictionary",
	"Double",
	"Encodable",
	"Equatable",
	"Error",
	"Float",
	"Hashable",
	"Identifiable",
	"Int",
	"Int16",
	"Int32",
	"Int64",
	"Int8",
	"Never",
	"Optional",
	"Protocol",
	"Range",
	"Sendable",
	"Sequence",
	"Set",
	"Type",
	"TimeInterval",
	"UInt",
	"UInt16",
	"UInt32",
	"UInt64",
	"UInt8",
	"URL",
	"UUID",
	"Void",
	// Kotlin
	"Boolean",
	"Byte",
	"ByteArray",
	"ByteBuffer",
	"ByteOrder",
	"ByReference",
	"Callback",
	"Char",
	"CharBuffer",
	"CodingErrorAction",
	"Comparable",
	"ConcurrentHashMap",
	"AtomicLong",
	"Enum",
	"Exception",
	"IntByReference",
	"IntegerType",
	"Iterable",
	"Lazy",
	"Library",
	"List",
	"Long",
	"Map",
	"MutableList",
	"MutableMap",
	"Native",
	"Nothing",
	"Number",
	"Pair",
	"Pointer",
	"PointerByReference",
	"RuntimeException",
	"Short",
	"Structure",
	"Throwable",
	"Triple",
	"UByte",
	"ULong",
	"UShort",
	"Unit",
	// UniFFI
	"Disposable",
	"ForeignBytes",
	"InternalException",
	"NoPointer",
	"RustBuffer",
	"RustCallStatus",
]);

/** Prefixes UniFFI gives its own generated declarations. */
const TAKEN_TYPE_PREFIXES = ["FfiConverter", "Uniffi"];

/**
 * Variant names an enum cannot hold: `Self` in Rust, and `Companion`, which names the companion object
 * of the Kotlin sealed class a variant is nested in. UniFFI qualifies every payload type in a variant
 * (`kotlin.String`, `uniffi.<crate>.Rejected`), so a variant may share a type's name. Exporting UniFFI
 * traits on an enum would add `String`, `Int`, `Boolean` and `Any` to the names its variant classes use.
 */
const TAKEN_VARIANT_NAMES = new Set(["Companion", "Self"]);

/** Modules a generated module cannot be named, so it never shadows a crate the generated code names. */
const TAKEN_MODULE_NAMES = new Set(["alloc", "core", "serde", "std", "uniffi"]);

const TYPE_IDENTIFIER = /^[A-Z][A-Za-z0-9]*$/;
const FIELD_IDENTIFIER = /^[a-z][A-Za-z0-9]*$/;
const WIRE_WORDS = /^[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*$/;
const MODULE_IDENTIFIER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The schema name, or `Contract<Name>` where the name is taken; a schema name that cannot be a type is an error. */
export function rustTypeName(name: string): string {
	if (!TYPE_IDENTIFIER.test(name)) throw new Error(`${name} cannot be a Rust type name`);
	const taken = TAKEN_TYPE_NAMES.has(name) || TAKEN_TYPE_PREFIXES.some((prefix) => name.startsWith(prefix));
	return taken ? `Contract${name}` : name;
}

/**
 * `toolCallId` → `tool_call_id`; a keyword becomes a raw identifier. Every capital starts a word, which
 * is exactly what serde's `rename_all = "camelCase"` undoes (serde_derive `case.rs`), so no field needs
 * a rename of its own.
 */
export function rustFieldName(owner: string, wire: string): string {
	if (!FIELD_IDENTIFIER.test(wire)) throw new Error(`${owner}.${wire} is not a camelCase field name`);
	const snake = wire.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
	if (NOT_RAW.has(snake)) throw new Error(`${owner}.${wire} cannot be a Rust field`);
	return RUST_KEYWORDS.has(snake) ? `r#${snake}` : snake;
}

/** `claude-code` → `ClaudeCode`, `session.attach.result` → `SessionAttachResult`. */
export function rustVariantName(owner: string, wire: string): string {
	if (!WIRE_WORDS.test(wire)) throw new Error(`${owner}: "${wire}" cannot be a Rust variant`);
	const name = wire
		.split(/[-_.]/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join("");
	if (TAKEN_VARIANT_NAMES.has(name)) throw new Error(`${owner}: "${wire}" makes the variant ${name}, a taken name`);
	return name;
}

/** `interaction-replies` → `interaction_replies`. */
export function rustModuleName(module: string): string {
	if (!MODULE_IDENTIFIER.test(module)) throw new Error(`the module ${module} cannot be a Rust module`);
	const name = module.replaceAll("-", "_");
	if (RUST_KEYWORDS.has(name) || TAKEN_MODULE_NAMES.has(name)) throw new Error(`the module ${module} is a taken name`);
	return name;
}

/** A wire word (a tag, an enum value) as a Rust string literal; the words need no escaping. */
export function rustString(word: string): string {
	if (!WIRE_WORDS.test(word)) throw new Error(`"${word}" is not a wire word`);
	return `"${word}"`;
}
