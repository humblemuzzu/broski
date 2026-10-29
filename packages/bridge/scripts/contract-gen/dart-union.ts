import type { DartCodec } from "./dart-codec";
import { fieldName, typeName } from "./dart-names";
import type { TypeDef } from "./type-model";

type UnionDef = Extract<TypeDef, { kind: "union" }>;

export interface SharedField {
	readonly name: string;
	/** The Dart type, `?` included when the field is optional. */
	readonly type: string;
}

/**
 * The fields every member of `union` has with the same Dart type, in the first member's order. The
 * union declares them as getters, so code holding the union reads them without a switch, as a
 * `TranscriptItem`'s `id` or a `FormFieldSpec`'s `key`.
 */
export function sharedFields(union: UnionDef, types: Map<string, TypeDef>, codec: DartCodec): SharedField[] {
	const members = union.members.map((member) => {
		const type = types.get(member);
		if (type?.kind !== "class") throw new Error(`${union.name}: member ${member} is not a class`);
		const name = typeName(type.name);
		return new Map(
			type.fields.map((field) => [
				fieldName(name, field.name),
				`${codec.type(field.type)}${field.required ? "" : "?"}`,
			]),
		);
	});
	const [first, ...rest] = members;
	if (!first) return [];
	return [...first.entries()]
		.filter(([name, type]) => rest.every((member) => member.get(name) === type))
		.map(([name, type]) => ({ name, type }));
}
