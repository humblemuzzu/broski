import type { FieldCondition, FormFieldSpec, FormValue, StringField, StringFormat } from "./forms";

/** Whether `field` is shown and answerable given the answers so far (its `when` conditions all hold). */
export function fieldIsActive(field: FormFieldSpec, values: Record<string, FormValue>): boolean {
	if (field.kind === "external") return true;
	return field.when.every((condition) => holds(condition, values[condition.key]));
}

function holds(condition: FieldCondition, answer: FormValue | undefined): boolean {
	if (answer === undefined) return false;
	const expected = condition.value;
	const matches =
		answer.kind === "choices"
			? expected.kind === "text" && answer.values.includes(expected.value)
			: answer.kind === expected.kind && answer.value === expected.value;
	return condition.op === "eq" ? matches : !matches;
}

/**
 * Why `value` does not fit `field`, or undefined when it does. Where backends validate differently
 * this is the strictest of them, so no backend refuses a value it passes (OpenCode's validator,
 * oc §8.2, is the strictest on emails, lengths and empty required answers).
 */
export function fieldProblem(field: FormFieldSpec, value: FormValue): string | undefined {
	switch (field.kind) {
		case "string":
			return value.kind === "text" ? stringProblem(field, value.value) : "expects text";
		case "number":
		case "integer":
			if (value.kind !== "number") return "expects a number";
			if (field.kind === "integer" && !Number.isInteger(value.value)) return "expects an integer";
			if (field.minimum !== undefined && value.value < field.minimum) return "below the minimum";
			if (field.maximum !== undefined && value.value > field.maximum) return "above the maximum";
			return undefined;
		case "boolean":
			return value.kind === "boolean" ? undefined : "expects true or false";
		case "multiselect": {
			if (value.kind !== "choices") return "expects choices";
			if (field.required && value.values.length === 0) return "needs a choice";
			if (new Set(value.values).size !== value.values.length) return "a choice twice";
			if (field.minItems !== undefined && value.values.length < field.minItems) return "too few choices";
			if (field.maxItems !== undefined && value.values.length > field.maxItems) return "too many choices";
			const options = new Set(field.options.map((option) => option.value));
			return field.allowCustom || value.values.every((choice) => options.has(choice)) ? undefined : "not an option";
		}
		case "external":
			return value.kind === "boolean" && value.value ? undefined : "must be acknowledged with true";
	}
}

/** Lengths count code points against `minLength` and UTF-16 units against `maxLength`, so both readings pass. */
function stringProblem(field: StringField, text: string): string | undefined {
	if (field.required && text === "") return "needs an answer";
	if (field.minLength !== undefined && [...text].length < field.minLength) return "too short";
	if (field.maxLength !== undefined && text.length > field.maxLength) return "too long";
	if (field.pattern !== undefined) {
		const problem = patternProblem(field.pattern, text);
		if (problem !== undefined) return problem;
	}
	if (field.format !== undefined && !matchesFormat(field.format, text)) return `not a valid ${field.format}`;
	const allowed = field.options.length === 0 || field.allowCustom;
	return allowed || field.options.some((option) => option.value === text) ? undefined : "not an option";
}

/**
 * The text must match under every reading of the pattern a backend may use: plain ECMAScript, as
 * OpenCode compiles it (oc §8.2), and with the `u` flag, as JSON Schema means it.
 */
function patternProblem(pattern: string, text: string): string | undefined {
	const readings = ["", "u"].flatMap((flags) => compiled(pattern, flags));
	if (readings.length === 0) return "the field's pattern does not compile, so no answer can pass it";
	return readings.every((reading) => reading.test(text)) ? undefined : "does not match the pattern";
}

function compiled(pattern: string, flags: string): RegExp[] {
	try {
		return [new RegExp(pattern, flags)];
	} catch {
		return [];
	}
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/i;

function matchesFormat(format: StringFormat, text: string): boolean {
	switch (format) {
		case "email":
			return EMAIL.test(text);
		case "uri":
			return URL.canParse(text);
		case "date": {
			const date = DATE.exec(text);
			return date !== null && isCalendarDate(date[1], date[2], date[3]);
		}
		case "date-time": {
			const time = DATE_TIME.exec(text);
			return (
				time !== null &&
				isCalendarDate(time[1], time[2], time[3]) &&
				within(time[4], 23) &&
				within(time[5], 59) &&
				within(time[6], 60) &&
				within(time[7], 23) &&
				within(time[8], 59)
			);
		}
	}
}

/** A real day of the Gregorian calendar: "2026-02-30" is not one. */
function isCalendarDate(year: string | undefined, month: string | undefined, day: string | undefined): boolean {
	const [y, m, d] = [Number(year), Number(month) - 1, Number(day)];
	const date = new Date(0);
	date.setUTCFullYear(y, m, d);
	return date.getUTCFullYear() === y && date.getUTCMonth() === m && date.getUTCDate() === d;
}

/** An absent group, as the offset is for `Z`, is within any bound. */
function within(group: string | undefined, max: number): boolean {
	return group === undefined || Number(group) <= max;
}
