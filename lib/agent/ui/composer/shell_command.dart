import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:uuid/uuid.dart';

/// A line typed as a shell command: `!command` runs it with its output in
/// the model's context, `!!command` with the output kept out of it.
final class ShellCommand {
  const ShellCommand({required this.command, required this.excludeFromContext});

  final String command;
  final bool excludeFromContext;
}

/// Whether the backend runs the person's own shell commands in a session.
bool offersShell(Capabilities capabilities) =>
    capabilities.backendOps.contains(BackendOpKind.runShell);

/// [text] as a terminal reads it: after the first `!` (or `!!`) comes the
/// command, trimmed. A bare `!` is no command; it is sent as a message.
ShellCommand? shellCommandOf(String text) {
  final line = text.trim();
  if (!line.startsWith('!')) return null;
  final excluded = line.startsWith('!!');
  final command = line.substring(excluded ? 2 : 1).trim();
  if (command.isEmpty) return null;
  return ShellCommand(command: command, excludeFromContext: excluded);
}

/// Starts [shell] in [session]; the output arrives as a run of the session.
/// The problem a person reads when it did not start, or null.
Future<String?> startShellCommand(
  ContractClient client,
  SessionRef session,
  ShellCommand shell,
) async => problemOf(
  await client.callBackend(
    PiCall(
      op: RunShellOp(
        sessionId: session.sessionId,
        clientRequestId: const Uuid().v4(),
        command: shell.command,
        excludeFromContext: shell.excludeFromContext,
      ),
    ),
  ),
);
