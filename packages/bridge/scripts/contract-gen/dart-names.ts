/** Words a Dart identifier may never be. */
const RESERVED_WORDS = new Set([
	"assert",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"default",
	"do",
	"else",
	"enum",
	"extends",
	"false",
	"final",
	"finally",
	"for",
	"if",
	"in",
	"is",
	"new",
	"null",
	"rethrow",
	"return",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"var",
	"void",
	"while",
	"with",
]);

/** Members every generated class has, or names its generated code uses for something else. */
const CLASS_MEMBERS = new Set(["hashCode", "runtimeType", "toString", "noSuchMethod", "toJson", "fromJson", "other"]);

/** Members every Dart enum or generated enum already has. */
const ENUM_MEMBERS = new Set(["values", "index", "name", "wire", "toJson", "fromJson", "hashCode", "runtimeType"]);

/** Type names that would collide with `dart:core` or the Flutter widgets an app file imports alongside. */
const TAKEN_TYPE_NAMES = new Set([
	"Object",
	"String",
	"List",
	"Map",
	"Set",
	"Iterable",
	"Error",
	"Exception",
	"Type",
	"Function",
	"Record",
	"Enum",
	"Symbol",
	"Null",
	"Never",
	"Duration",
	"Uri",
	"Pattern",
	"Match",
	"Future",
	"Stream",
	"Form",
	"FormField",
	"Text",
	"Image",
	"Icon",
	"Page",
	"Route",
	"Notification",
	"Action",
	"Intent",
	"Badge",
	"Chip",
	"Card",
	"Dialog",
	"Checkbox",
	"Radio",
	"Switch",
	"Slider",
	"Tooltip",
	"Theme",
	"State",
	"Key",
	"Size",
]);

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;

export function typeName(name: string): string {
	if (!IDENTIFIER.test(name) || TAKEN_TYPE_NAMES.has(name)) throw new Error(`${name} cannot be a Dart type name`);
	return name;
}

export function fieldName(owner: string, name: string): string {
	if (!IDENTIFIER.test(name) || RESERVED_WORDS.has(name) || CLASS_MEMBERS.has(name)) {
		throw new Error(`${owner}.${name} cannot be a Dart field`);
	}
	return name;
}

/** `claude-code` → `claudeCode`, `in_progress` → `inProgress`. */
export function enumMemberName(owner: string, wire: string): string {
	const name = wire
		.split(/[-_.]/)
		.map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
		.join("");
	if (!IDENTIFIER.test(name) || RESERVED_WORDS.has(name) || ENUM_MEMBERS.has(name)) {
		throw new Error(`${owner}: "${wire}" cannot be a Dart enum member`);
	}
	return name;
}

export function partFileName(module: string): string {
	return `${module.replaceAll("-", "_")}.dart`;
}

export function dartString(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("$", "\\$")}'`;
}
