import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../../tool/agent_core_check/agent_core_rules.dart';
import '../../tool/agent_core_check/import_rules.dart';

const _path = 'lib/agent/session/thing.dart';

List<String> _check(String source, {String path = _path}) =>
    agentCoreViolations(path, source);

void main() {
  test('the app core as it stands keeps every rule', () {
    final files = Directory('lib/agent')
        .listSync(recursive: true)
        .whereType<File>()
        .where((file) => file.path.endsWith('.dart'));
    expect(files, isNotEmpty);
    for (final file in files) {
      expect(_check(file.readAsStringSync(), path: file.path), isEmpty);
    }
  });

  test('the shared screens name no backend, whatever they import', () {
    final files = Directory('lib/screens/agent')
        .listSync(recursive: true)
        .whereType<File>()
        .where((file) => file.path.endsWith('.dart'));
    expect(files, isNotEmpty);
    for (final file in files) {
      expect(
        agentCoreViolations(
          file.path,
          file.readAsStringSync(),
          checkImports: false,
        ),
        isEmpty,
        reason: file.path,
      );
    }
  });

  test('a shared screen may import any app widget, never steer by backend', () {
    const screen = 'lib/screens/agent/chat/thing.dart';
    List<String> check(String source) =>
        agentCoreViolations(screen, source, checkImports: false);
    expect(
      check("import 'package:broski/widgets/message_bubble.dart';"),
      isEmpty,
    );
    expect(check('void f(AgentType type) {}'), hasLength(1));
    expect(check('final x = BackendId.pi;'), hasLength(1));
  });

  group('refuses', () {
    test('an import outside the allowed layers', () {
      expect(_check("import 'package:broski/providers/pi_provider.dart';"), [
        '$_path:1: imports package:broski/providers/pi_provider.dart',
      ]);
      expect(
        _check("export 'package:broski/models/agent_type.dart';"),
        hasLength(1),
      );
      expect(_check("import 'package:http/http.dart';"), hasLength(1));
      expect(
        _check("import '../../providers/pi_provider.dart';"),
        hasLength(1),
      );
      expect(_check("part 'x.dart';"), hasLength(1));
    });

    test('a path that is not the file it names', () {
      for (final uri in [
        'package:broski/agent/../providers/pi_provider.dart',
        'package:broski/agent/./client/outcome.dart',
        'package:broski/agent/%2E%2E/providers/pi_provider.dart',
      ]) {
        expect(_check("import '$uri';"), hasLength(1), reason: uri);
      }
    });

    test('a conditional import outside the allowed layers', () {
      expect(
        _check(
          "import 'package:flutter/material.dart' "
          "if (dart.library.io) 'package:broski/providers/pi_provider.dart';",
        ),
        ['$_path:1: imports package:broski/providers/pi_provider.dart'],
      );
    });

    test('a named app file imported whole, or showing more than it may', () {
      const barrel = 'package:broski/providers/service_providers.dart';
      expect(_check("import '$barrel';"), [
        '$_path:1: imports $barrel without `show`',
      ]);
      expect(_check("import '$barrel' hide Foo;"), hasLength(1));
      expect(_check("import '$barrel' as old;"), hasLength(1));
      expect(
        _check(
          "import '$barrel' show webSocketServiceProvider, BridgeService;",
        ),
        ['$_path:1: imports BridgeService from $barrel'],
      );
    });

    test('the old AgentType', () {
      expect(_check('void f(AgentType type) {}'), hasLength(1));
    });

    test('a backend id spelled as a string, in any quoting', () {
      for (final literal in [
        "'claude-code'",
        '"pi-durable"',
        "r'pi'",
        "'''claude-code'''",
        "'PI'",
        "'Pi Durable'",
      ]) {
        expect(_check('final id = $literal;'), hasLength(1), reason: literal);
      }
      expect(
        _check(r"final s = '${x == 'pi' ? 1 : 2}';"),
        hasLength(1),
        reason: 'a string inside an interpolation is code too',
      );
    });

    test('a backend id put together from pieces', () {
      for (final source in [
        "final id = 'clau' 'de-code';",
        "final id = 'claude' + 'code';",
        "final id = 'p' 'i';",
        r"final id = '${'clau'}decode';",
        "final id = ['p', 'i'].join();",
        "final id = ['claude', '-', 'code'].join();",
        "final x = b.toString().contains('Durable');",
        "final x = BackendId.values.where((b) => b.name == 'pi' 'Durable');",
      ]) {
        expect(_check(source), isNotEmpty, reason: source);
      }
    });

    test('a BackendId member, written out or as a dot shorthand', () {
      expect(_check('if (b == BackendId.pi) {}'), hasLength(1));
      expect(_check('switch (b) { case .piDurable: }'), hasLength(1));
      expect(_check('f(.claudeCode);'), hasLength(1));
      expect(
        _check('String f(BackendId b) => switch (b) { .pi => 1, _ => 0 };'),
        hasLength(1),
      );
    });

    test('any member of BackendId, so no id is picked by number or name', () {
      for (final source in [
        'final b = BackendId.values[3];',
        'final b = BackendId.values.byName(name);',
        'final b = BackendId.fromJson(text);',
        'final n = BackendId.values.length;',
      ]) {
        expect(_check(source), hasLength(1), reason: source);
      }
    });

    test('a backend value read as text or a number', () {
      for (final source in [
        "bool f(SessionRef s) => s.backend.wire.startsWith('c');",
        'final n = ref.backend.index;',
        'final t = ref.backend?.name;',
        r"final t = '${session.backend.toJson()}';",
      ]) {
        expect(_check(source), hasLength(1), reason: source);
      }
    });

    test('a theme file exporting outside the layers', () {
      expect(
        openLayerExportProblems(
          'lib/theme/x.dart',
          "export 'package:broski/services/bridge_service.dart';\n"
              "export 'colors.dart';\n"
              "export '../services/bridge_service.dart';",
        ),
        [
          'lib/theme/x.dart:1: exports package:broski/services/bridge_service.dart',
          'lib/theme/x.dart:3: exports ../services/bridge_service.dart',
        ],
      );
    });
  });

  group('allows', () {
    test('words in comments and documentation', () {
      expect(
        _check(
          "// BackendId.pi and 'pi'\n/* AgentType /* nested */ claudeCode */\n"
          "/// AgentType\nfinal x = 1;",
        ),
        isEmpty,
      );
    });

    test('the contract, the app core and generic infrastructure', () {
      expect(
        _check(
          "import 'dart:async';\n"
          "import 'package:broski/contract/generated/contract.dart';\n"
          "import 'package:broski/agent/client/outcome.dart';\n"
          "import 'package:broski/theme/app_icons.dart';\n"
          "import 'package:flutter/material.dart';\n"
          "import 'package:broski/providers/service_providers.dart'\n"
          '    show webSocketServiceProvider;',
        ),
        isEmpty,
      );
    });

    test('comparing backend values, members of other values, and ordinary '
        'words', () {
      expect(_check('final same = a.backend == b.backend;'), isEmpty);
      expect(_check('final x = state.pi;'), isEmpty);
      expect(_check("final x = 'Pi Durable is fine as words';"), isEmpty);
      expect(_check("final x = 'Open';"), isEmpty);
      expect(_check("final x = 'code';"), isEmpty);
      expect(_check("final x = capabilities(session.backend);"), isEmpty);
    });

    test('naming backends in the one display helper', () {
      expect(
        _check(
          "String l(BackendId b) => switch (b) { BackendId.pi => 'Pi', _ => '' };",
          path: backendLabelFile,
        ),
        isEmpty,
      );
    });
  });
}
