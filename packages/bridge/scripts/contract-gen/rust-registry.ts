import { byCodeUnits } from "./order";
import { RUST_GENERATED_HEADER } from "./rust-emit";
import { RustFields } from "./rust-fields";
import type { TypeDef } from "./type-model";

/**
 * The Rust crate's fixture tests reach every contract type and bound through this: `visit_types` hands
 * each type to the visitor under its schema name, the key `contract_samples.json` files its samples
 * under; a tagged struct goes to `tagged`, since alone it carries its tag through
 * `broski_contract::tagged`. `CONSTANTS` names each Rust bound as `constants.json` does.
 */
export function rustTypeRegistry(types: Map<string, TypeDef>, constants: [string, number][]): string {
	const fields = new RustFields(types);
	const visits = [...types.values()]
		.sort((a, b) => byCodeUnits(a.name, b.name))
		.map((type) => {
			const rust = type.kind === "json" ? "JsonValue" : fields.name(type.name);
			const tagged = type.kind === "class" && Object.keys(type.tags).length > 0;
			return `    visitor.${tagged ? "tagged" : "plain"}::<${rust}>("${type.name}");\n`;
		});
	const bounds = constants.map(([name]) => `    ("${name}", ${name}),\n`);
	return `${RUST_GENERATED_HEADER}
use broski_contract::*;
use serde::de::DeserializeOwned;
use serde::Serialize;

pub const CONSTANTS: &[(&str, usize)] = &[
${bounds.join("")}];

pub trait TypeVisitor {
    fn plain<T: Serialize + DeserializeOwned>(&mut self, name: &str);
    fn tagged<T: Tagged + Serialize + DeserializeOwned>(&mut self, name: &str);
}

pub fn visit_types(visitor: &mut impl TypeVisitor) {
${visits.join("")}}
`;
}
