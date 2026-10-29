import { type ContractSchemaDocument, refName, type Schema } from "./json-schema";

export type FieldType =
	| { kind: "string" }
	| { kind: "int" }
	| { kind: "double" }
	| { kind: "bool" }
	| { kind: "json" }
	| { kind: "ref"; name: string }
	| { kind: "list"; item: FieldType }
	| { kind: "map"; value: FieldType };

export interface Field {
	readonly name: string;
	readonly type: FieldType;
	readonly required: boolean;
}

export type TypeDef =
	| { kind: "enum"; name: string; module: string; values: string[] }
	| { kind: "class"; name: string; module: string; fields: Field[]; tags: Record<string, string> }
	| { kind: "union"; name: string; module: string; key: string; members: string[] }
	| { kind: "alias"; name: string; module: string; target: FieldType }
	| { kind: "json"; name: string; module: string };

const JSON_TYPE = "JsonValue";

/**
 * The contract as types the Dart emitter understands. Anything outside the supported subset — an
 * anonymous object or enum, `null`, an untagged union — is an error naming its path.
 */
export function typeModel(document: ContractSchemaDocument): Map<string, TypeDef> {
	const types = new Map<string, TypeDef>();
	const unions: [string, Schema][] = [];
	for (const [name, schema] of Object.entries(document.$defs)) {
		if (schema.oneOf) unions.push([name, schema]);
		else types.set(name, typeDef(name, moduleOf(name, schema), schema));
	}
	for (const [name, schema] of unions) types.set(name, unionDef(name, moduleOf(name, schema), schema, types));
	return types;
}

function moduleOf(name: string, schema: Schema): string {
	const module = schema["x-module"];
	if (typeof module !== "string") throw new Error(`${name}: no x-module`);
	return module;
}

function typeDef(name: string, module: string, schema: Schema): TypeDef {
	if (name === JSON_TYPE) return { kind: "json", name, module };
	if (schema.enum) {
		const values = schema.enum.map((value) => {
			if (typeof value !== "string") throw new Error(`${name}: enum values must be strings`);
			return value;
		});
		return { kind: "enum", name, module, values };
	}
	if (schema.type === "object" && schema.properties) return classDef(name, module, schema);
	return { kind: "alias", name, module, target: fieldType(name, schema) };
}

/** A union of named objects that all carry one tag property with a distinct value each. */
function unionDef(name: string, module: string, schema: Schema, types: Map<string, TypeDef>): TypeDef {
	const members = (schema.oneOf ?? []).map((option) => {
		const member = option.$ref ? types.get(refName(option.$ref)) : undefined;
		if (member?.kind !== "class") throw new Error(`${name}: every member must be a named object`);
		return member;
	});
	const [first] = members;
	if (!first) throw new Error(`${name}: a union needs members`);
	const key = Object.keys(first.tags).find(
		(candidate) =>
			members.every((member) => member.tags[candidate] !== undefined) &&
			new Set(members.map((member) => member.tags[candidate])).size === members.length,
	);
	if (key === undefined) throw new Error(`${name}: no tag tells its members apart`);
	return { kind: "union", name, module, key, members: members.map((member) => member.name) };
}

function classDef(name: string, module: string, schema: Schema): TypeDef {
	if (schema.additionalProperties !== false) throw new Error(`${name}: objects must be strict`);
	const required = new Set(schema.required ?? []);
	const fields: Field[] = [];
	const tags: Record<string, string> = {};
	for (const [field, property] of Object.entries(schema.properties ?? {})) {
		const path = `${name}.${field}`;
		const value = asSchema(path, property);
		if (value.const !== undefined) {
			if (typeof value.const !== "string" || !required.has(field))
				throw new Error(`${path}: tags are required strings`);
			tags[field] = value.const;
			continue;
		}
		fields.push({ name: field, type: fieldType(path, value), required: required.has(field) });
	}
	return { kind: "class", name, module, fields, tags };
}

function fieldType(path: string, schema: Schema): FieldType {
	if (schema.$ref) {
		const name = refName(schema.$ref);
		return name === JSON_TYPE ? { kind: "json" } : { kind: "ref", name };
	}
	if (schema.enum || schema.oneOf || schema.anyOf || schema.allOf) throw new Error(`${path}: name this type`);
	switch (schema.type) {
		case "string":
			return { kind: "string" };
		case "integer":
			return { kind: "int" };
		case "number":
			return { kind: "double" };
		case "boolean":
			return { kind: "bool" };
		case "array":
			if (Array.isArray(schema.items)) throw new Error(`${path}: tuples are not supported`);
			return { kind: "list", item: fieldType(`${path}[]`, asSchema(path, schema.items)) };
		case "object":
			if (schema.properties) throw new Error(`${path}: name this object`);
			return { kind: "map", value: fieldType(`${path}{}`, asSchema(path, schema.additionalProperties)) };
		default:
			throw new Error(`${path}: unsupported schema ${JSON.stringify(schema)}`);
	}
}

function asSchema(path: string, value: Schema | boolean | undefined): Schema {
	if (value === undefined || typeof value === "boolean") throw new Error(`${path}: expected a schema`);
	return value;
}

export function tagValue(member: Extract<TypeDef, { kind: "class" }>, key: string): string {
	const value = member.tags[key];
	if (value === undefined) throw new Error(`${member.name} has no ${key} tag`);
	return value;
}
