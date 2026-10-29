import 'package:broski/agent/answers/js_pattern_syntax.dart';

/// Why [text] fails a form field's [pattern], or null when it passes: it must
/// match under both readings a backend may use, plain ECMAScript (OpenCode)
/// and the `u` flag (JSON Schema); a pattern neither compiles fails every
/// answer. A reading Dart's engine cannot judge is left to the bridge.
String? patternProblem(String pattern, String text) {
  final readings = [
    for (final unicode in const [false, true]) _read(pattern, unicode, text),
  ];
  if (readings.every((reading) => reading == _Reading.invalid)) {
    return "the field's pattern does not compile, so no answer can pass it";
  }
  return readings.contains(_Reading.misses)
      ? 'does not match the pattern'
      : null;
}

enum _Reading { matches, misses, invalid, unknown }

/// Dart 3.10's engine misses U+0000 against a negated class with `unicode`
/// in a string holding a code unit above U+00FF, so that reading is unknown.
_Reading _read(String pattern, bool unicode, String text) {
  var compiled = _compiled(pattern, unicode);
  if (compiled == null) {
    final older = withoutNewerSyntax(pattern);
    compiled = older == null ? null : _compiled(older.pattern, unicode);
    if (compiled == null) return _Reading.invalid;
    if (older == null || !older.sameMatches) return _Reading.unknown;
  }
  if (unicode && text.contains('\u0000')) return _Reading.unknown;
  return compiled.hasMatch(text) ? _Reading.matches : _Reading.misses;
}

RegExp? _compiled(String pattern, bool unicode) {
  try {
    return RegExp(pattern, unicode: unicode);
  } on FormatException {
    return null;
  }
}
