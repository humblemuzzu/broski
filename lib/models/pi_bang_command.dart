class PiBangCommand {
  const PiBangCommand({
    required this.command,
    required this.excludeFromContext,
  });

  final String command;
  final bool excludeFromContext;
}

/// Parses `!cmd` (context included) and `!!cmd` (excluded) inputs, mirroring
/// pi's CLI parser. Returns null when there is no `!` or the body is empty.
PiBangCommand? parsePiBangCommand(String input) {
  if (!input.startsWith('!')) return null;
  final excludeFromContext = input.startsWith('!!');
  final body = input.substring(excludeFromContext ? 2 : 1).trim();
  if (body.isEmpty) return null;
  return PiBangCommand(command: body, excludeFromContext: excludeFromContext);
}
