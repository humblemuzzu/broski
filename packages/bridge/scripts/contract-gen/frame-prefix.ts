import { CONTRACT_FRAME_PREFIX, encodeFrame } from "../../src/core/frame";
import { protocolError } from "../../src/core/results";

/** Text with one surrogate pair and a lone high and a lone low surrogate, as an agent's malformed output can carry. */
const LONE_SURROGATE_TEXT = "a\ud83db😀\ude00c";

/**
 * How a contract frame begins on the wire, one frame the core itself encoded, and one it encoded around text
 * with lone surrogates, so the app's test holds its reading of the prefix, and of what a strict parser must
 * accept, to what the bridge writes.
 */
export function framePrefix(): { prefix: string; example: string; loneSurrogateExample: string } {
	const example = encodeFrame({ type: "session.detach.result", requestId: "r" }).text;
	if (!example.startsWith(CONTRACT_FRAME_PREFIX)) throw new Error("the core wrote a frame without its prefix");
	const loneSurrogateExample = encodeFrame(protocolError("r", "internal", LONE_SURROGATE_TEXT)).text;
	return { prefix: CONTRACT_FRAME_PREFIX, example, loneSurrogateExample };
}
