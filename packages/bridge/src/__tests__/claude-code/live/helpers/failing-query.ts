import { FakeQuery } from "../../helpers/fake-query";

/** A `FakeQuery` whose stream throws, as the SDK's does when the CLI exits non-zero: after the next frame it reads. */
export class FailingQuery extends FakeQuery {
	private failure: Error | undefined;

	/** The next frame pushed is the last: reading it throws `error`. */
	failAfterNextFrame(error: Error): void {
		this.failure = error;
	}

	override async next(...args: [] | [unknown]) {
		const result = await super.next(...args);
		if (this.failure) {
			const failure = this.failure;
			this.failure = undefined;
			throw failure;
		}
		return result;
	}
}
