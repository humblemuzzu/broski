import { rustFieldName, rustTypeName } from "./rust-names";
import type { Field, FieldType, TypeDef } from "./type-model";

export type ClassDef = Extract<TypeDef, { kind: "class" }>;

/**
 * Rust types for the contract's field types, and the serde attributes each field needs. Every type is
 * named by its Rust name, which differs from the schema name only where the schema name is taken
 * (`rust-names.ts`).
 */
export class RustFields {
	private readonly names = new Map<string, string>();

	constructor(private readonly types: Map<string, TypeDef>) {
		const owners = new Map<string, string>();
		for (const name of types.keys()) {
			const rust = rustTypeName(name);
			const owner = owners.get(rust);
			if (owner !== undefined) throw new Error(`${name} and ${owner} are both the Rust type ${rust}`);
			owners.set(rust, name);
			this.names.set(name, rust);
		}
	}

	name(schemaName: string): string {
		const name = this.names.get(schemaName);
		if (name === undefined) throw new Error(`no type ${schemaName}`);
		return name;
	}

	lookup(schemaName: string): TypeDef {
		const type = this.types.get(schemaName);
		if (type === undefined) throw new Error(`no type ${schemaName}`);
		return type;
	}

	type(field: FieldType): string {
		switch (field.kind) {
			case "string":
				return "String";
			case "int":
				// The type model keeps every integer within JavaScript's safe range, which i64 holds exactly.
				return "i64";
			case "double":
				return "f64";
			case "bool":
				return "bool";
			case "json":
				return "crate::JsonValue";
			case "ref":
				return this.name(field.name);
			case "list":
				return `Vec<${this.type(field.item)}>`;
			case "map":
				return `std::collections::HashMap<String, ${this.type(field.value)}>`;
		}
	}

	/** The field's declaration: its serde attributes, then `pub name: Type,`. */
	declaration(owner: string, field: Field): string[] {
		const name = rustFieldName(owner, field.name);
		const type = this.type(field.type);
		this.refuseNestedMember(`${owner}.${field.name}`, field.type);
		const member = this.taggedClass(field.type) !== undefined;
		if (field.required) {
			return [...(member ? ['#[serde(with = "crate::tagged")]'] : []), `pub ${name}: ${type},`];
		}
		return [
			'#[serde(default, skip_serializing_if = "Option::is_none")]',
			member ? '#[serde(with = "crate::tagged::option")]' : '#[serde(deserialize_with = "crate::codec::present")]',
			`pub ${name}: Option<${type}>,`,
		];
	}

	/** An alias's target type; an alias of a union member would lose the member's tag. */
	aliasTarget(alias: string, target: FieldType): string {
		const member = this.taggedClass(target);
		if (member) throw new Error(`${alias}: an alias of ${member.name} loses its tag; refer to it by name`);
		this.refuseNestedMember(alias, target);
		return this.type(target);
	}

	/** The schema names a field type refers to. */
	references(field: FieldType): string[] {
		switch (field.kind) {
			case "ref":
				return [field.name];
			case "list":
				return this.references(field.item);
			case "map":
				return this.references(field.value);
			default:
				return [];
		}
	}

	/** The tagged class a field holds directly; an alias never names one (`aliasTarget`). */
	private taggedClass(field: FieldType): ClassDef | undefined {
		if (field.kind !== "ref") return undefined;
		const target = this.lookup(field.name);
		return target.kind === "class" && Object.keys(target.tags).length > 0 ? target : undefined;
	}

	/**
	 * A union member alone carries its tag through `crate::tagged`, which serde applies to a field and its
	 * option only; a list or map of one member is modelled with the union.
	 */
	private refuseNestedMember(path: string, field: FieldType): void {
		if (field.kind !== "list" && field.kind !== "map") return;
		const inner = field.kind === "list" ? field.item : field.value;
		const member = this.taggedClass(inner);
		if (member) throw new Error(`${path}: a list or map of ${member.name} loses its tag; hold its union instead`);
		this.refuseNestedMember(path, inner);
	}
}
