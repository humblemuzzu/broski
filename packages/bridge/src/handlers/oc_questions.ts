import type { ClientMessage, ServerMessage } from "../types";

type Reply = (message: ServerMessage) => void;

type OpenCodeQuestionLike = {
	replyToQuestion: (id: string, answers: string[][], dir?: string) => Promise<boolean>;
	rejectQuestion: (id: string, dir?: string) => Promise<boolean>;
};

export async function handle(
	message: ClientMessage & { requestId?: string },
	reply: Reply,
	requireOpenCode: () => OpenCodeQuestionLike,
): Promise<boolean> {
	switch (message.type) {
		case "oc_question_reply": {
			const oc = requireOpenCode();
			const questionId = message.questionId;
			const answers = message.answers;
			const directory = message.projectPath;

			if (!questionId || typeof questionId !== "string") {
				reply({ type: "oc_question_replied", data: false });
				return true;
			}
			if (!Array.isArray(answers)) {
				reply({ type: "oc_question_replied", data: false });
				return true;
			}

			const ok = await oc.replyToQuestion(questionId, answers, directory);
			reply({ type: "oc_question_replied", data: ok });
			return true;
		}
		case "oc_question_reject": {
			const oc = requireOpenCode();
			const ok = await oc.rejectQuestion(message.questionId, message.projectPath);
			reply({ type: "oc_question_rejected", data: ok });
			return true;
		}
		default:
			return false;
	}
}
