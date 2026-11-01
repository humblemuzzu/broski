import 'package:broski/agent/answers/js_pattern_syntax.dart';
import 'package:broski/agent/answers/js_search.dart';
import 'package:broski/agent/answers/js_unicode_reading.dart';

/// Why [text] fails a form field's [pattern], or null when it passes: it must
/// match under both readings a backend may use, plain ECMAScript
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

_Reading _read(String pattern, bool unicode, String text) {
  var source = pattern;
  var propertiesDecide = false;
  if (unicode) {
    final reading = unicodeReading(
      pattern,
      textHasNul: text.contains('\u0000'),
    );
    source = reading.pattern;
    propertiesDecide =
        reading.usesProperties && text.codeUnits.any((unit) => unit > 0x7f);
  }
  var compiled = _compiled(source, unicode);
  if (compiled == null) {
    final older = withoutNewerSyntax(source);
    final rewritten = older == null ? null : _compiled(older.pattern, unicode);
    if (older == null || rewritten == null) return _Reading.invalid;
    if (!older.sameMatches) return _Reading.unknown;
    compiled = rewritten;
  }
  if (propertiesDecide) return _Reading.unknown;
  return searchesLikeEcmaScript(compiled, text, unicode: unicode)
      ? _Reading.matches
      : _Reading.misses;
}

RegExp? _compiled(String pattern, bool unicode) {
  try {
    return RegExp(pattern, unicode: unicode);
  } on FormatException {
    return null;
  }
}
