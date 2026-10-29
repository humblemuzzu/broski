import { DartCodec } from "./dart-codec";
import { GENERATED_HEADER, LIBRARY_FILE } from "./dart-emit";
import { dartString } from "./dart-names";
import { DART_AS } from "./dart-runtime";
import { byCodeUnits } from "./order";
import type { TypeDef } from "./type-model";

/**
 * Test-only maps from every type name to a function that decodes JSON as that type, and to one that
 * decodes it and encodes it back.
 */
export function dartRoundTrips(types: Map<string, TypeDef>): string {
	const codec = new DartCodec(types);
	const names = [...types.keys()].sort(byCodeUnits);
	const decoders = names
		.map((name) => `  ${dartString(name)}: (json) => ${codec.decode({ kind: "ref", name }, "json", name)},\n`)
		.join("");
	const roundTrips = names
		.map((name) => {
			const field = { kind: "ref", name } as const;
			return `  ${dartString(name)}: (json) => ${codec.encode(field, `(${codec.decode(field, "json", name)})`)},\n`;
		})
		.join("");
	return `${GENERATED_HEADER}
import 'package:broski/contract/generated/${LIBRARY_FILE}';

final Map<String, Object? Function(Object? json)> contractDecoders = {
${decoders}};

final Map<String, Object? Function(Object? json)> contractRoundTrips = {
${roundTrips}};

${DART_AS}`;
}
