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
      '        _received++;\n        _onMessage(message);',
      '        _onMessage(message);',
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
      'pattern: U+0000 trusts the u reading',
      "  if (unicode && text.contains('\\u0000')) return _Reading.unknown;\n",
      '',
    ),
    Mutant(
      'pattern: newer syntax does not compile',
      'if (older == null || !older.sameMatches) return _Reading.unknown;',
      'return _Reading.invalid;',
    ),
    Mutant(
      'pattern: a rewrite is never matched',
      'if (older == null || !older.sameMatches) return _Reading.unknown;',
      'return _Reading.unknown;',
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
