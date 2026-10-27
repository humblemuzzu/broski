/// The parameter names a shell tool takes its command under.
///
/// Claude Code, Codex, OpenCode and Pi's built-in bash call it `command`; a user's own Pi tools extension
/// can replace bash with one that calls it `cmd`. The card reads whichever the tool actually used.
const _commandKeys = ['command', 'cmd'];

/// The shell command in a tool's input, or an empty string when it carries none.
String shellCommandOf(Map<String, dynamic> input) {
  for (final key in _commandKeys) {
    final value = input[key];
    if (value is String && value.isNotEmpty) return value;
  }
  return '';
}
