/**
 * One ACP agent process and its JSON-RPC, opened by `initialize`. The client says who it is and offers no file system
 * and no terminal, so every file the agent touches it touches itself; it offers form elicitation, which is how an agent
 * asks its questions. An exit ends every request still waiting, with what the agent said on stderr.
 */

import { type ChildLaunch, exitText, StdioChild } from "../../../adapter-kit/stdio-child";
import { ACP_PROTOCOL_VERSION, InitializeResult } from "./frames";
import { JsonRpc, type RpcResult } from "./rpc";

export interface AcpLaunch extends ChildLaunch {
	/** How messages name the agent. */
	readonly who: string;
	readonly client: { readonly name: string; readonly version: string };
	readonly onFault?: (message: string) => void;
}

const INITIALIZE_DEADLINE_MS = 30_000;

export class AcpConnection {
	readonly rpc: JsonRpc;
	/** Settles with why the process ended. */
	readonly ended: Promise<string>;
	private readonly child: StdioChild;

	private constructor(launch: AcpLaunch) {
		const onFault = launch.onFault ?? (() => undefined);
		this.rpc = new JsonRpc(launch.who, (record) => this.child.write(record), onFault);
		this.child = new StdioChild(launch, (item) => this.rpc.receive(item));
		this.ended = this.child.exited.then((exit) => {
			const reason = exitText(launch.who, exit, this.child.stderrTail());
			this.rpc.close(reason);
			return reason;
		});
	}

	/** A connection that has agreed on the protocol, with what the agent offers; any failure stops the process. */
	static async open(launch: AcpLaunch): Promise<RpcResult<{ connection: AcpConnection; agent: InitializeResult }>> {
		const connection = new AcpConnection(launch);
		const params = {
			protocolVersion: ACP_PROTOCOL_VERSION,
			clientCapabilities: {
				fs: { readTextFile: false, writeTextFile: false },
				terminal: false,
				elicitation: { form: {} },
			},
			clientInfo: launch.client,
		};
		const answer = await connection.rpc.request("initialize", params, InitializeResult, INITIALIZE_DEADLINE_MS);
		if (answer.ok && answer.result.protocolVersion === ACP_PROTOCOL_VERSION) {
			return { ok: true, result: { connection, agent: answer.result } };
		}
		await connection.stop();
		if (!answer.ok) return answer;
		const version = answer.result.protocolVersion;
		return {
			ok: false,
			failure: { message: `${launch.who} speaks ACP ${version}, and the bridge speaks ${ACP_PROTOCOL_VERSION}` },
		};
	}

	get running(): boolean {
		return this.child.running;
	}

	/** Through the stop ladder: an ACP agent ends on stdin's end, with the sessions it serves. */
	async stop(): Promise<void> {
		await this.child.stop();
		await this.ended;
	}
}
