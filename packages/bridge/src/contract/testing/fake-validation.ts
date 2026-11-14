import type { BackendTraits } from "../backend";
import type { PromptInput } from "../input";
import type { ModelSummary } from "../models";
import type { ModeAxis, ModeSetting } from "../modes";
import type { Rejected, RejectionCode } from "../rejection";
import type { NewSessionOptions } from "../sessions";
import { FAKE_COMMANDS, FAKE_MODELS } from "./fake-data";

export function rejected(code: RejectionCode, message: string): Rejected {
	return { status: "rejected", rejection: { code, message } };
}

/** The models the fake offers under `traits`: without thinking options when thinking cannot be set. */
export function offeredModels(traits: BackendTraits): ModelSummary[] {
	return FAKE_MODELS.map((model) => (traits.thinking ? model : { ...model, thinking: { options: [] } }));
}

/** The model a session starts with when it names none. */
export function defaultModelId(): string {
	const model = FAKE_MODELS.find((candidate) => candidate.isDefault);
	if (!model) throw new Error("the fake has no default model");
	return model.id;
}

export function modelProblem(traits: BackendTraits, modelId: string): Rejected | undefined {
	return offeredModels(traits).some((model) => model.id === modelId)
		? undefined
		: rejected("not_found", `no model ${modelId}`);
}

export function thinkingProblem(
	traits: BackendTraits,
	modelId: string | undefined,
	value: string,
): Rejected | undefined {
	if (!traits.thinking) return rejected("unsupported", "thinking cannot be set");
	const model = offeredModels(traits).find((candidate) => candidate.id === modelId);
	if (!model) return rejected("invalid_input", "no model is selected");
	return model.thinking.options.some((option) => option.value === value)
		? undefined
		: rejected("invalid_input", `${model.id} has no thinking setting ${value}`);
}

export function modeProblem(axes: readonly ModeAxis[], setting: ModeSetting): Rejected | undefined {
	const axis = axes.find((candidate) => candidate.id === setting.axis);
	if (!axis) return rejected("invalid_input", `no mode ${setting.axis}`);
	return axis.options.some((option) => option.value === setting.value)
		? undefined
		: rejected("invalid_input", `${axis.id} has no value ${setting.value}`);
}

/** Every axis at its default, then `requested` on top. */
export function initialModes(axes: readonly ModeAxis[], requested: readonly ModeSetting[]): ModeSetting[] {
	return axes.map((axis) => ({
		axis: axis.id,
		value: requested.find((setting) => setting.axis === axis.id)?.value ?? axis.defaultValue ?? firstOption(axis),
	}));
}

function firstOption(axis: ModeAxis): string {
	const [option] = axis.options;
	if (!option) throw new Error(`mode ${axis.id} has no options`);
	return option.value;
}

export function newSessionProblem(
	options: NewSessionOptions,
	traits: BackendTraits,
	axes: readonly ModeAxis[],
): Rejected | undefined {
	if (options.modelId !== undefined) {
		const unknown = modelProblem(traits, options.modelId);
		if (unknown) return unknown;
	}
	if (options.thinking !== undefined) {
		const problem = thinkingProblem(traits, options.modelId ?? defaultModelId(), options.thinking);
		if (problem) return problem;
	}
	return (options.modes ?? []).map((setting) => modeProblem(axes, setting)).find((problem) => problem !== undefined);
}

/** Why the fake cannot take `input` at all, before any run state is considered. */
export function inputProblem(traits: BackendTraits, input: PromptInput): Rejected | undefined {
	if (!traits.promptModes.includes(input.mode)) return rejected("unsupported", `mode ${input.mode} is not supported`);
	const attachment = input.attachments.find((candidate) => !traits.attachments.includes(candidate.kind));
	if (attachment) return rejected("unsupported", `${attachment.kind} attachments are not supported`);
	if (input.command === undefined) return undefined;
	if (!traits.commands) return rejected("unsupported", "commands are not supported");
	return FAKE_COMMANDS.some((command) => command.id === input.command)
		? undefined
		: rejected("not_found", `no command ${input.command}`);
}
