import { HOLDER_SUBCOMMAND } from "../backends/pi/holder/protocol";
import { isCompiledBinary } from "../compiled-binary";

/**
 * The bridge started again as the holder of a hosted session's `pi` (`backends/pi/holder/`): the compiled binary, or
 * from source the entry this bridge was started from, both of which hand `HOLDER_SUBCOMMAND` to `runHolder`.
 */
export function holderCommand(): readonly string[] {
	return isCompiledBinary() ? [process.execPath, HOLDER_SUBCOMMAND] : [process.execPath, Bun.main, HOLDER_SUBCOMMAND];
}
