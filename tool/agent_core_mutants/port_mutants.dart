import 'mutant.dart';

/// Mutants of the client and of the ports held equal to the contract.
final portMutants = [
  ...mutantsOf('client/contract_client.dart', const [
    Mutant(
      'client: rate_limited is sent again once',
      'attempt < rateLimitWaits.length',
      'attempt < 1',
    ),
    Mutant(
      'client: a newer major is spoken',
      'when protocol.major == contractProtocolMajor',
      'when protocol.major >= contractProtocolMajor',
    ),
    Mutant(
      'client: an overtaken hello settles',
      'if (negotiation != _negotiation || _closed) return;',
      'if (_closed) return;',
    ),
    Mutant(
      'client: an answer is numbered as nothing',
      'arrival: _received',
      'arrival: 0',
    ),
    Mutant(
      'client: an event is not counted',
      '    _received++;\n    switch (frame) {',
      '    switch (frame) {',
    ),
  ]),
  ...mutantsOf('reducer/newest_text.dart', const [
    Mutant(
      'reducer: the cut keeps U+DC00',
      'first >= 0xdc00',
      'first > 0xdc00',
    ),
    Mutant(
      'reducer: the cut keeps U+DFFF',
      'first <= 0xdfff',
      'first < 0xdfff',
    ),
    Mutant(
      'reducer: the cut drops a high surrogate',
      'first >= 0xdc00',
      'first >= 0xdbff',
    ),
    Mutant(
      'reducer: text at the cap is cut',
      'text.length <= contractMaxTextChars',
      'text.length < contractMaxTextChars',
      equivalent:
          'a text exactly at the cap cut to the cap is the same text; its '
          'first unit cannot be a low surrogate the cut created',
    ),
  ]),
  ...mutantsOf('reducer/run_items.dart', const [
    Mutant(
      'reducer: a run at its bound drops',
      'if (excess <= 0)',
      'if (excess < 0)',
      equivalent: 'with no excess, dropping zero items changes nothing',
    ),
    Mutant(
      'reducer: dropped items miscounted',
      'droppedItems: run.droppedItems + excess',
      'droppedItems: run.droppedItems + excess - 1',
    ),
    Mutant(
      'reducer: a finished call keeps its first input',
      'tool.input ?? item.input',
      'item.input',
    ),
    Mutant(
      'reducer: a finished call loses its child',
      'tool.childSession ?? item.childSession',
      'item.childSession',
    ),
  ]),
  ...mutantsOf('reducer/live_state.dart', const [
    Mutant(
      'reducer: a new mode axis is dropped',
      'if (!known) return [...modes, setting];',
      'if (!known) return modes;',
    ),
    Mutant(
      'reducer: model_changed keeps an absent field',
      'clearing(s, model: true),',
      's,',
    ),
  ]),
  ...mutantsOf('reducer/session_reducer.dart', const [
    Mutant(
      'reducer: an ask that does not block waits',
      'snapshot.interactions.any((interaction) => interaction.blocksRun)',
      'snapshot.interactions.isNotEmpty',
    ),
    Mutant(
      'reducer: suspended only without a run',
      'if (snapshot.lastOutcome is RunSuspended) return',
      'if (snapshot.lastOutcome is RunSuspended && snapshot.run == null) return',
      equivalent: 'the line before returns for every snapshot with a run',
    ),
  ]),
  ...mutantsOf('answers/answer_check.dart', const [
    Mutant(
      'answers: a deny with one grant passes',
      'if (!allows && reply.grantIds.isNotEmpty)',
      'if (!allows && reply.grantIds.length > 1)',
    ),
    Mutant(
      'answers: two picks pass a single choice',
      'if (!question.multiSelect && picks > 1)',
      'if (!question.multiSelect && picks > 2)',
    ),
    Mutant(
      'answers: a hidden field with a default is required',
      '_isRequired(field) && !(_isHidden(field) && _hasDefault(field))',
      '_isRequired(field)',
    ),
  ]),
  ...mutantsOf('answers/js_pattern.dart', const [
    Mutant(
      'pattern: newer syntax does not compile',
      'if (!older.sameMatches) return _Reading.unknown;',
      'return _Reading.invalid;',
    ),
    Mutant(
      'pattern: a rewrite is never matched',
      'if (!older.sameMatches) return _Reading.unknown;',
      'return _Reading.unknown;',
    ),
    Mutant(
      'pattern: a property escape is judged beyond ASCII',
      'if (propertiesDecide) return _Reading.unknown;\n',
      '',
    ),
    Mutant(
      'pattern: a property escape is left to the bridge for ASCII too',
      'reading.usesProperties && text.codeUnits.any((unit) => unit > 0x7f);',
      'reading.usesProperties;',
    ),
    Mutant(
      'pattern: U+0000 is not noticed',
      "textHasNul: text.contains('\\u0000'),",
      'textHasNul: false,',
    ),
  ]),
  ...mutantsOf('answers/js_unicode_reading.dart', const [
    Mutant(
      'pattern: a non-ASCII escape keeps its backslash',
      'if (next > 0x7f && (next < 0xd800 || next > 0xdfff)) {',
      'if (false) {',
    ),
    Mutant(
      'pattern: a property escape is not noticed',
      'usesProperties = true;\n    }\n    into.write',
      '}\n    into.write',
    ),
    Mutant(
      'pattern: a negated class is kept with U+0000 in the text',
      'final lookahead = negated && closed && _textHasNul;',
      'final lookahead = false;',
    ),
    Mutant(
      'pattern: every class becomes a lookahead',
      'final lookahead = negated && closed && _textHasNul;',
      'final lookahead = closed && _textHasNul;',
    ),
    Mutant(
      'pattern: an empty negated class is kept',
      "out.write(r'[\\s\\S]');",
      "out.write(r'[^]');",
    ),
  ]),
  ...mutantsOf('answers/js_search.dart', const [
    Mutant(
      'pattern: a match between a pair\'s halves counts',
      'if (!unicode || !_insidePair(text, first.start)) return true;',
      'return true;',
    ),
    Mutant(
      'pattern: no start after a bogus one is tried',
      'if (pattern.matchAsPrefix(text, at) != null) return true;',
      '',
    ),
    Mutant(
      'pattern: a plain reading is searched by code point',
      'if (!unicode || !_insidePair(text, first.start)) return true;',
      'if (!_insidePair(text, first.start)) return true;',
    ),
  ]),
  ...mutantsOf('answers/js_pattern_syntax.dart', const [
    Mutant(
      'pattern: groups in one alternative are exclusive',
      'if (disjunctionA != disjunctionB) return false;',
      'if (disjunctionA != disjunctionB) return true;',
    ),
    Mutant(
      'pattern: any modifiers are valid',
      'return all.isNotEmpty && all.split',
      'return true || all.split',
    ),
    Mutant(
      'pattern: a renamed back reference keeps its name',
      'final given = _known[name] ?? name;',
      'final given = name;',
    ),
    Mutant(
      'pattern: a group of one lookaround is not closed by an alternative',
      "if (_closesNeedingAlternative.contains(_i)) out.write('|(?!)');",
      '',
    ),
    Mutant(
      'pattern: a group of a lookaround and more is closed by one too',
      "if (close == null || !_s.startsWith(')', close + 1)) return;",
      'if (close == null) return;',
    ),
    Mutant(
      'pattern: a non-ASCII name repeated in a group is renamed apart',
      r"given = renamed[name] ?? _known[name] ?? 'named_$_i';",
      r"given = 'named_$_i';",
    ),
  ]),
  ...mutantsOf('answers/url/punycode.dart', const [
    Mutant(
      'uri: Punycode need not round trip',
      'return _encoded(decoded) == encoded && decoded.every',
      'return decoded.every',
    ),
  ]),
  ...mutantsOf('answers/url/idna_lite.dart', const [
    Mutant(
      'uri: Cherokee capitals are mapped',
      '(_isCherokeeCapital(point) || !_lowercases(point))',
      '!_lowercases(point)',
      equivalent:
          "Dart 3.10's toLowerCase leaves Cherokee as it is; the exemption "
          'keeps a Dart that lowercases it from refusing hosts Bun accepts '
          '(the idnaHosts case xn--58dc fails then)',
    ),
    Mutant(
      'uri: a capital is valid in a decoded label',
      '(_isCherokeeCapital(point) || !_lowercases(point))',
      'true',
    ),
    Mutant(
      'uri: a space is kept',
      'if (isIdnaDisallowed(point) || _mapsToSpace(point)) return null;',
      'if (isIdnaDisallowed(point)) return null;',
    ),
  ]),
  ...mutantsOf('answers/url/url_host.dart', const [
    Mutant(
      'uri: a label with unmapped code points is decoded',
      "final decodable = label.startsWith('xn--') && _isAscii(label);",
      "final decodable = label.startsWith('xn--');",
    ),
  ]),
];
