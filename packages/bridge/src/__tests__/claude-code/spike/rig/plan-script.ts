import type { ScriptedRoute, ScriptedTurn } from "../../../helpers/scripted-anthropic-server";

const PLAN_PATH = /\/[^"\s\\]*\/plans\/[a-z0-9-]+\.md/;

/** The plan file the CLI told the model to write (its plan-mode reminder names it), from the request body. */
export function planPathIn(body: unknown): string | null {
	return JSON.stringify(body).match(PLAN_PATH)?.[0] ?? null;
}

/**
 * The model side of plan mode, as the CLI expects it: write the plan to the plan file the reminder names,
 * then call ExitPlanMode with no input (the CLI reads the plan from that file), then whatever `after` says.
 */
export function planRoute(plan: string, after: ScriptedTurn[]): ScriptedRoute {
	return {
		name: "plan",
		when: () => true,
		turns: (request, index) => {
			if (index === 0) {
				const path = planPathIn(request.body) ?? "plan.md";
				return { toolCalls: [{ name: "Write", args: { file_path: path, content: plan } }] };
			}
			if (index === 1) return { toolCalls: [{ name: "ExitPlanMode", args: {} }] };
			return after[index - 2] ?? { text: ["(plan script exhausted)"] };
		},
	};
}
