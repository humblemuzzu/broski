import 'dart_tokens.dart';
import 'import_rules.dart';

/// The one file that may name a backend, for display (see its doc comment).
const backendLabelFile = 'lib/agent/ui/backend_label.dart';

/// The backend ids, lowercased with everything but letters and digits gone,
/// so `'Pi-Durable'`, `'pi durable'` and `'pi' 'Durable'` all read as one.
const _backendIds = {'claudecode', 'codex', 'opencode', 'pi', 'pidurable'};

const _backendMembers = {'claudeCode', 'codex', 'opencode', 'pi', 'piDurable'};

/// What reads a backend value as text or as a number.
const _backendReadings = {'wire', 'name', 'index', 'toString', 'toJson'};

/// A literal piece this long that is part of a backend id is a fragment of
/// one being put together (`'Durable'`, `'claude'`). Shorter pieces are
/// ordinary words (`'Open'`, `'code'`); a list of short pieces joined into an
/// id is caught as a join instead.
const _fragmentLength = 5;

/// Words after which a `.` starts a value rather than reading a member.
const _keywordsBeforeAValue = {
  'case',
  'return',
  'when',
  'yield',
  'await',
  'else',
  'in',
  'throw',
};

/// Every way [source], the file at [path] under `lib/agent/`, breaks the
/// rules of the app core (app-core README §1): an import outside the allowed
/// layers, the old `AgentType`, a backend named by `BackendId`, by dot
/// shorthand, by a string or by reading a backend value as text. Each problem
/// reads `path:line: what`. The check is lexical: it catches the ways code
/// steers by backend by accident, not every way a determined author could.
List<String> agentCoreViolations(String path, String source) {
  final tokens = dartTokens(source);
  final labels = path == backendLabelFile;
  final problems = <String>[];
  void report(DartToken token, String what) =>
      problems.add('$path:${token.line}: $what');
  for (var index = 0; index < tokens.length; index++) {
    final token = tokens[index];
    switch (token) {
      case WordToken(word: 'import' || 'export' || 'part'):
        directiveProblems(tokens, index).forEach((what) => report(token, what));
      case WordToken(word: 'AgentType'):
        report(
          token,
          'names AgentType; the core keys nothing on the old backend type',
        );
      case WordToken(word: 'BackendId') when !labels:
        final member = _memberAfter(tokens, index);
        if (member != null) {
          report(token, 'reads BackendId.$member; branch on capabilities');
        }
      case WordToken(word: 'backend') when !labels:
        final member = _memberAfter(tokens, index);
        if (_backendReadings.contains(member)) {
          report(token, 'reads backend.$member; branch on capabilities');
        }
      case PunctToken(char: '.') when !labels && _isShorthand(tokens, index):
        report(token, 'names a backend by dot shorthand');
      case StringToken() when !labels:
        _stringProblems(tokens, index).forEach((what) => report(token, what));
      default:
        break;
    }
  }
  return problems;
}

/// A string spelling a backend id: whole, in a literal piece, joined from
/// adjacent or `+`-joined literals, or as a fragment of one.
List<String> _stringProblems(List<DartToken> tokens, int index) {
  final token = tokens[index];
  if (token is! StringToken) return const [];
  final problems = <String>[
    for (final piece in token.pieces)
      if (_backendIds.contains(_letters(piece)))
        "spells the backend id '$piece'"
      else if (_isFragment(_letters(piece)))
        "spells '$piece', a piece of a backend id",
  ];
  if (_startsAJoin(tokens, index)) {
    final joined = _joinedFrom(tokens, index) ?? _listJoinedFrom(tokens, index);
    if (joined != null && _backendIds.contains(_letters(joined))) {
      problems.add("joins strings into the backend id '$joined'");
    }
  }
  return problems;
}

bool _isFragment(String letters) =>
    letters.length >= _fragmentLength &&
    _backendIds.any((id) => id != letters && id.contains(letters));

String _letters(String text) =>
    text.toLowerCase().replaceAll(RegExp('[^a-z0-9]'), '');

/// Whether the string at [index] begins a chain of joined literals: the
/// token before it neither is a string nor joins one with `+`.
bool _startsAJoin(List<DartToken> tokens, int index) {
  final before = index > 0 ? tokens[index - 1] : null;
  final joinsBefore =
      before is StringToken ||
      (before is PunctToken &&
          before.char == '+' &&
          index > 1 &&
          tokens[index - 2] is StringToken);
  return !joinsBefore;
}

/// The text of the chain of literals starting at [index], joined as Dart
/// joins adjacent literals or as `+` joins strings; null for a chain of one,
/// or one whose text is not all literal.
String? _joinedFrom(List<DartToken> tokens, int index) {
  final parts = <String>[];
  var at = index;
  while (at < tokens.length) {
    final token = tokens[at];
    if (token is! StringToken) break;
    final value = token.value;
    if (value == null) return null;
    parts.add(value);
    final next = at + 1 < tokens.length ? tokens[at + 1] : null;
    at += next is PunctToken && next.char == '+' ? 2 : 1;
  }
  return parts.length > 1 ? parts.join() : null;
}

/// The text of `['c', 'odex'].join()` when [index] is its first string: a
/// list of literals only, joined with no separator.
String? _listJoinedFrom(List<DartToken> tokens, int index) {
  final open = index > 0 ? tokens[index - 1] : null;
  if (open is! PunctToken || open.char != '[') return null;
  final parts = <String>[];
  var at = index;
  while (at < tokens.length) {
    final token = tokens[at];
    if (token is! StringToken) return null;
    final value = token.value;
    if (value == null) return null;
    parts.add(value);
    final next = at + 1 < tokens.length ? tokens[at + 1] : null;
    if (next is PunctToken && next.char == ']') break;
    if (next is! PunctToken || next.char != ',') return null;
    at += 2;
  }
  final join = tokens.skip(at + 2).take(3).toList();
  final joined = switch (join) {
    [PunctToken(char: '.'), WordToken(word: 'join'), PunctToken(char: '(')] =>
      true,
    _ => false,
  };
  return joined ? parts.join() : null;
}

/// `.codex` where a `BackendId` is expected: a dot that follows no value.
bool _isShorthand(List<DartToken> tokens, int index) {
  final member = index + 1 < tokens.length ? tokens[index + 1] : null;
  if (member is! WordToken || !_backendMembers.contains(member.word)) {
    return false;
  }
  final before = index > 0 ? tokens[index - 1] : null;
  return switch (before) {
    WordToken(:final word) => _keywordsBeforeAValue.contains(word),
    StringToken() => false,
    PunctToken(:final char) => char != ')' && char != ']' && char != '?',
    null => true,
  };
}

/// The member read right after the word at [index], through `?.` and `!.`.
String? _memberAfter(List<DartToken> tokens, int index) {
  var at = index + 1;
  final next = at < tokens.length ? tokens[at] : null;
  if (next case PunctToken(char: '?' || '!')) at++;
  if (at + 1 >= tokens.length) return null;
  final dot = tokens[at];
  final member = tokens[at + 1];
  if (dot is PunctToken && dot.char == '.' && member is WordToken) {
    return member.word;
  }
  return null;
}
