import type { DartCodec } from "./dart-codec";
import { dartString, fieldName, typeName } from "./dart-names";
import type { Field, TypeDef } from "./type-model";

type ClassDef = Extract<TypeDef, { kind: "class" }>;
type UnionDef = Extract<TypeDef, { kind: "union" }>;

/**
 * One contract object as a Dart class: immutable fields, a `fromJson` that refuses unknown fields and
 * wrong tags with a `FormatException`, `toJson`, and value equality.
 */
export function classDeclaration(type: ClassDef, codec: DartCodec, unions: readonly UnionDef[]): string {
	const name = typeName(type.name);
	const fields = type.fields.map((field) => ({ ...field, name: fieldName(name, field.name) }));
	const implementsClause = unions.length > 0 ? ` implements ${unions.map((union) => union.name).join(", ")}` : "";
	const body = [
		fields.length === 0 ? `  const ${name}();\n` : `  const ${name}({${parameters(fields)}});\n`,
		fromJson(name, type, fields, codec),
		fields.map((field) => `  final ${codec.type(field.type)}${field.required ? "" : "?"} ${field.name};\n`).join(""),
		toJson(type, fields, codec, unions.length > 0),
		equality(name, fields),
	];
	return `final class ${name}${implementsClause} {\n${body.filter((part) => part !== "").join("\n")}}\n`;
}

function parameters(fields: readonly Field[]): string {
	return fields.map((field) => `${field.required ? "required " : ""}this.${field.name}`).join(", ");
}

function fromJson(name: string, type: ClassDef, fields: readonly Field[], codec: DartCodec): string {
	const keys = [...Object.keys(type.tags), ...fields.map((field) => field.name)].map(dartString).join(", ");
	const tags = Object.entries(type.tags)
		.map(([key, value]) => `${dartString(key)}: ${dartString(value)}`)
		.join(", ");
	const decoded = fields.map((field) => `      ${field.name}: ${decodedField(name, field, codec)},\n`).join("");
	const construct = fields.length === 0 ? `const ${name}()` : `${name}(\n${decoded}    )`;
	return `  factory ${name}.fromJson(Map<String, Object?> json) {
    _expectShape(json, ${dartString(name)}, const <String>{${keys}}, const <String, String>{${tags}});
    return ${construct};
  }
`;
}

function decodedField(owner: string, field: Field, codec: DartCodec): string {
	const key = dartString(field.name);
	const value = codec.decode(field.type, `json[${key}]`, `${owner}.${field.name}`);
	return field.required ? value : `json.containsKey(${key}) ? ${value} : null`;
}

function toJson(type: ClassDef, fields: readonly Field[], codec: DartCodec, overrides: boolean): string {
	const tags = Object.entries(type.tags).map(([key, value]) => `    ${dartString(key)}: ${dartString(value)},\n`);
	const encoded = fields.map((field) => {
		const key = dartString(field.name);
		if (field.required) return `    ${key}: ${codec.encode(field.type, field.name)},\n`;
		return `    if (${field.name} case final value?) ${key}: ${codec.encode(field.type, "value")},\n`;
	});
	return `${overrides ? "  @override\n" : ""}  Map<String, Object?> toJson() => {\n${[...tags, ...encoded].join("")}  };\n`;
}

function equality(name: string, fields: readonly Field[]): string {
	const same = fields.map((field) => ` && _equal(${field.name}, other.${field.name})`).join("");
	const hash =
		fields.length === 0
			? "runtimeType.hashCode"
			: `Object.hashAll([${fields.map((field) => `_hash(${field.name})`).join(", ")}])`;
	const shown = fields.map((field) => `${field.name}: $${field.name}`).join(", ");
	return `  @override
  bool operator ==(Object other) => other is ${name}${same};

  @override
  int get hashCode => ${hash};

  @override
  String toString() => '${name}(${shown})';
`;
}
