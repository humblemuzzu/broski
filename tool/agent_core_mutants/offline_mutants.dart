import 'mutant.dart';

/// Mutants of what the phone keeps for the times the link is down, of what
/// tells the person a run ended, and of what opens a session from a
/// notification.
final offlineMutants = [
  ...mutantsOf('cache/cache_index.dart', const [
    Mutant(
      'cache index: a damaged index stops every write',
      '    } on FormatException {\n      return const CacheIndex([]);\n    }',
      '    } on FormatException {\n      rethrow;\n    }',
    ),
    Mutant(
      'cache index: no bound on the entries',
      'final fits = kept.length < maxEntries && chars + entry.size <= maxChars;',
      'final fits = chars + entry.size <= maxChars;',
    ),
    Mutant(
      'cache index: no bound on the characters',
      'final fits = kept.length < maxEntries && chars + entry.size <= maxChars;',
      'final fits = kept.length < maxEntries;',
    ),
  ]),
  ...mutantsOf('cache/agent_cache.dart', const [
    Mutant(
      'cache: a value too large to keep leaves the older one',
      '        await _store.delete(key);\n        return;',
      '        return;',
    ),
  ]),
  ...mutantsOf('notify/run_completion_watcher.dart', const [
    Mutant(
      'run done: a subagent\'s run is told too',
      '    if (row.parent?.kind == ParentKind.subagent) return;\n',
      '',
    ),
    Mutant(
      'run done: a session on screen is told',
      '    if (watching) return;\n',
      '',
    ),
  ]),
  ...mutantsOf('catalog/directories_controller.dart', const [
    Mutant(
      'directories: a read under way is not joined',
      '    if (reading != null && reading.generation == generation) {\n'
          '      return reading.done;\n'
          '    }\n',
      '',
    ),
  ]),
  ...appMutantsOf(
    'providers/notifications/notification_tap_provider.dart',
    const [
      Mutant(
        'tap: a tap is consumed whatever replaced it',
        '    if (state != tap) return false;\n    _cancelExpiry',
        '    _cancelExpiry',
      ),
      Mutant(
        'tap: a tap waits for ever',
        '    _cancelExpiry = _clock.after(maxWait, () => consume(tap));\n',
        '',
      ),
    ],
  ),
  ...appMutantsOf('screens/notifications/notification_tap_routing.dart', const [
    Mutant(
      'tap: a tap made offline waits for the bridge',
      '  if (!backends.loaded && backends.savedAt == null) return;',
      '  if (!backends.loaded) return;',
    ),
    Mutant(
      'tap: a tap for a machine no longer paired stays',
      '      _afterFrame(context, () => pending.consume(tap));',
      '      break;',
    ),
  ]),
];
