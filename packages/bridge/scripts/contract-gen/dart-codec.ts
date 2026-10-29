import { dartString } from "./dart-names";
import type { FieldType, TypeDef } from "./type-model";

/**
 * Dart expressions that convert between a field's JSON form and its Dart type. Decoding goes
 * through `_as` (see dart-runtime.ts), so a value of the wrong shape is a `FormatException` naming
 * its path, never a `TypeError`.
 */
export class DartCodec {
	constructor(private readonly types: Map<string, TypeDef>) {}

	type(field: FieldType): string {
		switch (field.kind) {
			case "string":
				return "String";
			case "int":
				return "int";
			case "double":
				return "double";
			case "bool":
				return "bool";
			case "json":
				return "JsonValue";
			case "ref":
				return field.name;
			case "list":
				return `List<${this.type(field.item)}>`;
			case "map":
				return `Map<String, ${this.type(field.value)}>`;
		}
	}

	/** `json` is an `Object?` expression holding the JSON form; `path` names it in errors. */
	decode(field: FieldType, json: string, path: string, depth = 0): string {
		const at = dartString(path);
		switch (field.kind) {
			case "string":
				return `_as<String>(${json}, ${at})`;
			case "int":
				return `_as<int>(${json}, ${at})`;
			case "double":
				return `_as<num>(${json}, ${at}).toDouble()`;
			case "bool":
				return `_as<bool>(${json}, ${at})`;
			case "json":
				return `JsonValue.fromJson(${json})`;
			case "ref":
				return this.decodeRef(field.name, json, path, depth);
			case "list": {
				const item = `e${depth}`;
				const decoded = this.decode(field.item, item, `${path}[]`, depth + 1);
				return `[for (final ${item} in _as<List<Object?>>(${json}, ${at})) ${decoded}]`;
			}
			case "map": {
				const entry = `e${depth}`;
				const value = this.decode(field.value, `${entry}.value`, `${path}{}`, depth + 1);
				return `{for (final ${entry} in _as<Map<String, Object?>>(${json}, ${at}).entries) ${entry}.key: ${value}}`;
			}
		}
	}

	/** `value` is a Dart expression of the field's type; the result is its JSON form. */
	encode(field: FieldType, value: string, depth = 0): string {
		switch (field.kind) {
			case "string":
			case "int":
			case "double":
			case "bool":
				return value;
			case "json":
				return `${value}.toJson()`;
			case "ref":
				return this.encodeRef(field.name, value, depth);
			case "list": {
				const item = `e${depth}`;
				const encoded = this.encode(field.item, item, depth + 1);
				return encoded === item ? value : `[for (final ${item} in ${value}) ${encoded}]`;
			}
			case "map": {
				const entry = `e${depth}`;
				const encoded = this.encode(field.value, `${entry}.value`, depth + 1);
				return encoded === `${entry}.value`
					? value
					: `{for (final ${entry} in ${value}.entries) ${entry}.key: ${encoded}}`;
			}
		}
	}

	private decodeRef(name: string, json: string, path: string, depth: number): string {
		const target = this.lookup(name);
		switch (target.kind) {
			case "enum":
				return `${name}.fromJson(_as<String>(${json}, ${dartString(path)}))`;
			case "class":
			case "union":
				return `${name}.fromJson(_as<Map<String, Object?>>(${json}, ${dartString(path)}))`;
			case "alias":
				return this.decode(target.target, json, path, depth);
			case "json":
				return `JsonValue.fromJson(${json})`;
		}
	}

	private encodeRef(name: string, value: string, depth: number): string {
		const target = this.lookup(name);
		return target.kind === "alias" ? this.encode(target.target, value, depth) : `${value}.toJson()`;
	}

	private lookup(name: string): TypeDef {
		const target = this.types.get(name);
		if (!target) throw new Error(`no type ${name}`);
		return target;
	}
}
