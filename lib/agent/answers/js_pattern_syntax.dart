/// [pattern] with the syntax newer ECMAScript takes and Dart's engine (Dart
/// 3.10) refuses rewritten in older syntax that compiles exactly when the
/// original does, or null when it has none:
///
/// - modifiers, `(?i:…)` and `(?m-s:…)`, become `(?:…)`;
/// - a group name used again where both groups cannot take part in one match
///   (another alternative) gets a name of its own;
/// - a group name outside ASCII gets an ASCII one, with its back references.
///
/// [sameMatches] says the rewrite also matches what the original matches:
/// nothing but names changed, and no back reference names a group twice.
({String pattern, bool sameMatches})? withoutNewerSyntax(String pattern) {
  final names = _Scan(pattern, const {})..run();
  final scan = _Scan(pattern, names.renamed)..run();
  if (!scan.changed) return null;
  final twice = scan.references.any(
    (name) => (scan.named[name]?.length ?? 0) > 1,
  );
  return (pattern: scan.out.toString(), sameMatches: !scan.modifiers && !twice);
}

/// Where a named group stands: for each disjunction around it, which one and
/// which of its alternatives.
typedef _Path = List<(int disjunction, int alternative)>;

/// One pass over a pattern. A back reference may come before its group, so
/// the names a first pass gives are handed to the second as [_known].
final class _Scan {
  _Scan(this._s, this._known);

  final String _s;
  final Map<String, String> _known;
  final out = StringBuffer();
  final Map<String, List<_Path>> named = {};
  final Map<String, String> renamed = {};
  final Set<String> references = {};
  var changed = false;
  var modifiers = false;
  var _i = 0;
  var _disjunctions = 0;
  final List<(int disjunction, int alternative)> _stack = [(0, 0)];

  void run() {
    while (_i < _s.length) {
      switch (_s[_i]) {
        case r'\':
          _escape();
        case '[':
          _characterClass();
        case '(':
          _group();
        case ')':
          if (_stack.length > 1) _stack.removeLast();
          _copy(1);
        case '|':
          final (disjunction, alternative) = _stack.removeLast();
          _stack.add((disjunction, alternative + 1));
          _copy(1);
        default:
          _copy(1);
      }
    }
  }

  void _copy(int count) {
    final end = _i + count > _s.length ? _s.length : _i + count;
    out.write(_s.substring(_i, end));
    _i = end;
  }

  void _escape() {
    final close = _s.startsWith(r'\k<', _i) ? _s.indexOf('>', _i + 3) : -1;
    if (close < 0) return _copy(2);
    final name = _s.substring(_i + 3, close);
    references.add(name);
    final given = _known[name] ?? name;
    changed |= given != name;
    out.write('\\k<$given>');
    _i = close + 1;
  }

  void _characterClass() {
    _copy(1);
    while (_i < _s.length && _s[_i] != ']') {
      _copy(_s[_i] == r'\' ? 2 : 1);
    }
    _copy(1);
  }

  void _group() {
    final flags = _modifiers.matchAsPrefix(_s, _i);
    if (flags != null && _validModifiers(flags[1], flags[2])) {
      out.write('(?:');
      _i = flags.end;
      changed = true;
      modifiers = true;
    } else if (_namedStart.matchAsPrefix(_s, _i) != null) {
      _namedGroup();
    } else {
      _copy(1);
    }
    _stack.add((++_disjunctions, 0));
  }

  void _namedGroup() {
    final close = _s.indexOf('>', _i + 3);
    if (close < 0) return _copy(1);
    final name = _s.substring(_i + 3, close);
    final path = List.of(_stack);
    final earlier = named.putIfAbsent(name, () => []);
    var given = name;
    if (earlier.isNotEmpty &&
        earlier.every((other) => _exclusive(other, path))) {
      given = 'dup${earlier.length}_$_i';
    } else if (name.codeUnits.any((unit) => unit > 0x7f) ||
        name.contains(r'\')) {
      given = 'named_$_i';
      renamed[name] = given;
    }
    earlier.add(path);
    changed |= given != name;
    out.write('(?<$given>');
    _i = close + 1;
  }
}

final _modifiers = RegExp(r'\(\?([ims]*)(?:-([ims]*))?:');
final _namedStart = RegExp(r'\(\?<[^=!]');

/// ES2025 `RegularExpressionModifiers`: some flag, none twice, none both
/// added and removed.
bool _validModifiers(String? add, String? remove) {
  final all = (add ?? '') + (remove ?? '');
  return all.isNotEmpty && all.split('').toSet().length == all.length;
}

/// Whether two groups can never take part in one match: in some disjunction
/// around both, they stand in different alternatives.
bool _exclusive(_Path a, _Path b) {
  for (var index = 0; index < a.length && index < b.length; index++) {
    final (disjunctionA, alternativeA) = a[index];
    final (disjunctionB, alternativeB) = b[index];
    if (disjunctionA != disjunctionB) return false;
    if (alternativeA != alternativeB) return true;
  }
  return false;
}
