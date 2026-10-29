import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:broski/agent/client/frame_lane.dart';
import 'package:broski/agent/client/frame_text.dart';

/// What reading a contract frame costs, on this machine, at the sizes that
/// matter: on the calling isolate (decoding the JSON and building the typed
/// message), and what it costs the calling isolate to have it read on
/// another. `frameOffloadChars` is chosen from this table (app-core README §3).
///
///   dart run tool/measure_frame_reading.dart
///
/// The Dart VM here is a JIT on a desktop; a phone is several times slower, so
/// read the first column as a floor.
Future<void> main() async {
  final cases = <(String, String)>[
    ('text', _frame(1, 500)),
    ('small objects', _frame(30, 0, tool: true)),
    ('small objects', _frame(75, 0, tool: true)),
    ('small objects', _frame(150, 0, tool: true)),
    ('small objects', _frame(300, 0, tool: true)),
    ('small objects', _frame(1200, 0, tool: true)),
    ('small objects', _frame(7600, 0, tool: true)),
    ('text', _frame(100, 5000)),
    ('text', _frame(450, 4500)),
    ('small objects', _frame(60000, 0, tool: true)),
  ];
  for (var warm = 0; warm < 30; warm++) {
    readFrameText(cases[1].$2);
  }
  await Isolate.run(() => readFrameText(cases[1].$2));
  stdout.writeln(
    'frame'.padRight(26) +
        'chars'.padLeft(10) +
        'here ms'.padLeft(10) +
        'call ms'.padLeft(10) +
        'away ms'.padLeft(10),
  );
  for (final (name, text) in cases) {
    final here = _median(15, () => readFrameText(text));
    final call = <double>[];
    final away = <double>[];
    for (var run = 0; run < 9; run++) {
      final clock = Stopwatch()..start();
      final reading = Isolate.run(() => readFrameText(text));
      call.add(_ms(clock));
      await reading;
      away.add(_ms(clock));
    }
    stdout.writeln(
      name.padRight(26) +
          '${text.length}'.padLeft(10) +
          here.toStringAsFixed(2).padLeft(10) +
          _middle(call).toStringAsFixed(2).padLeft(10) +
          _middle(away).toStringAsFixed(2).padLeft(10),
    );
  }
  stdout.writeln(
    '\nthreshold: $frameOffloadChars characters; "call" is what handing '
    'a frame to another isolate costs this one, "away" the whole read.',
  );
}

String _frame(int items, int textChars, {bool tool = false}) {
  final page = [
    for (var index = 0; index < items; index++)
      tool
          ? {
              'kind': 'tool_call',
              'id': 'i$index',
              'at': 1,
              'toolCallId': 't$index',
              'messageId': 'm$index',
              'name': 'bash',
              'title': 'run $index',
              'input': {
                'command': 'x' * 40,
                'list': [1, 2.5, true, null],
                'nested': {'ok': false},
              },
            }
          : {
              'kind': 'block',
              'id': 'i$index',
              'at': 1,
              'messageId': 'm$index',
              'block': 'text',
              'text': 'é' * textChars,
            },
  ];
  return jsonEncode({
    'type': 'contract',
    'message': {
      'type': 'transcript.read.result',
      'requestId': 'r',
      'result': {
        'status': 'accepted',
        'page': {'items': page, 'idStability': 'stable'},
      },
    },
  });
}

double _ms(Stopwatch clock) => clock.elapsedMicroseconds / 1000;

double _median(int runs, void Function() work) {
  final times = <double>[];
  for (var run = 0; run < runs; run++) {
    final clock = Stopwatch()..start();
    work();
    times.add(_ms(clock));
  }
  return _middle(times);
}

double _middle(List<double> times) => (times..sort())[times.length ~/ 2];
