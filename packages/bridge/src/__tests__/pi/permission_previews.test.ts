/**
 * What a permission card shows of a bash call (`ui/permission-request.ts`): the command itself, whichever key the bash
 * tool keeps it under. A user's own `bash` tool may replace Pi's and name it `cmd`; the person must still see what runs.
 */

import { describe, expect, test } from "bun:test";
import { permissionRequest } from "../../backends/pi/ui/permission-request";

const cwd = "/work/project";

function previews(input: unknown) {
	return permissionRequest({ toolCallId: "call-1", toolName: "bash", input, cwd }).previews;
}

describe("a bash call's permission preview", () => {
	test("Pi's own bash shows its command", () => {
		expect(previews({ command: "ls apps", timeout: 10 })).toEqual([{ kind: "command", command: "ls apps", cwd }]);
	});

	test("a replacement bash that names it cmd or script shows the command too", () => {
		expect(previews({ cmd: "ls apps", timeout: 10 })).toEqual([{ kind: "command", command: "ls apps", cwd }]);
		expect(previews({ script: "pwd" })).toEqual([{ kind: "command", command: "pwd", cwd }]);
	});

	test("a bash call with no command shows no command preview", () => {
		expect(previews({ timeout: 10 })).toEqual([]);
	});
});
