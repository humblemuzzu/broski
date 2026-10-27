import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'link_sandbox.dart';

/// How the bridge encodes a Claude Code project path
/// (`connectors/claude-code/cc-paths.ts`): every separator and space becomes a
/// dash, so `/Users/me/repo` is `-Users-me-repo`.
String encodeProjectPath(String path) =>
    path.replaceAll(r'\', '/').replaceAll('/', '-').replaceAll(' ', '-');

/// The session id the fixture is filed under.
const String fixtureSessionId = '0e2e0000-4000-8000-8000-00000000c1a0';

typedef FixtureMessage = ({String id, String role});

/// A synthetic Claude Code session in the sandbox's own `~/.claude`: big enough
/// that its transcript can never cross the link in one reply, and shaped like a
/// real one — a session that alternates chat turns with tool turns, one in
/// [create]'s `toolEvery` carrying a two-hundred-kilobyte tool result.
///
/// [messages] is what the bridge builds from the file, so a test compares what
/// arrived against the session itself rather than against its own arithmetic.
final class CcTranscriptFixture {
  CcTranscriptFixture._({
    required this.cwd,
    required this.path,
    required this.bytes,
    required this.messages,
    required this.toolOutputs,
  });

  /// The project path the phone names in `cwd`.
  final String cwd;
  final String path;

  /// The file's size on disk.
  final int bytes;

  /// Every transcript message, in file order.
  final List<FixtureMessage> messages;

  /// toolUseId → the length of the output the transcript carries for it.
  final Map<String, int> toolOutputs;

  List<String> get ids => <String>[for (final message in messages) message.id];

  /// The pages `cc_get_session_messages` answers with for [limit], newest
  /// first: each is the last [limit] messages ending at the cursor before it.
  List<List<FixtureMessage>> pages(int limit) {
    final pages = <List<FixtureMessage>>[];
    var end = messages.length;
    while (end > 0) {
      final start = end > limit ? end - limit : 0;
      pages.add(messages.sublist(start, end));
      end = start;
    }
    return pages;
  }

  static Future<CcTranscriptFixture> create(
    LinkSandbox sandbox, {
    int turns = 900,
    int toolEvery = 5,
    int toolResultBytes = 200000,
  }) async {
    final cwd = p.join(sandbox.bridgeHome, 'project');
    final directory = p.join(
      sandbox.bridgeHome,
      '.claude',
      'projects',
      encodeProjectPath(cwd),
    );
    await Directory(cwd).create(recursive: true);
    await Directory(directory).create(recursive: true);
    final path = p.join(directory, '$fixtureSessionId.jsonl');

    final messages = <FixtureMessage>[];
    final toolOutputs = <String, int>{};
    final sink = File(path).openWrite();
    var seconds = 0;
    String stamp() => DateTime.utc(
      2025,
      1,
      1,
    ).add(Duration(seconds: seconds++)).toIso8601String();

    void write(String type, String uuid, Object content) {
      sink.writeln(
        jsonEncode(<String, Object?>{
          'type': type,
          'uuid': uuid,
          'sessionId': fixtureSessionId,
          'timestamp': stamp(),
          'cwd': cwd,
          'message': <String, Object?>{'role': type, 'content': content},
        }),
      );
    }

    void toolTurn(int turn) {
      final toolUseId = 'tool-$turn';
      final output = _toolOutput(turn, toolResultBytes);
      write('user', 'u-tool-$turn', 'run step $turn of the build');
      write('assistant', 'a-tool-$turn', <Map<String, Object?>>[
        <String, Object?>{'type': 'text', 'text': 'Running step $turn.'},
        <String, Object?>{
          'type': 'tool_use',
          'id': toolUseId,
          'name': 'Bash',
          'input': <String, Object?>{'command': 'make step-$turn'},
        },
      ]);
      write('user', 'r-tool-$turn', <Map<String, Object?>>[
        <String, Object?>{
          'type': 'tool_result',
          'tool_use_id': toolUseId,
          'content': output,
        },
      ]);
      messages
        ..add((id: 'u-tool-$turn', role: 'user'))
        ..add((id: 'a-tool-$turn', role: 'assistant'));
      toolOutputs[toolUseId] = output.length;
    }

    void chatTurn(int turn) {
      write(
        'user',
        'u-chat-$turn',
        'question $turn: ${'context for the assistant ' * 20}',
      );
      write('assistant', 'a-chat-$turn', <Map<String, Object?>>[
        <String, Object?>{
          'type': 'text',
          'text': 'answer $turn: ${'done ' * 60}',
        },
      ]);
      messages
        ..add((id: 'u-chat-$turn', role: 'user'))
        ..add((id: 'a-chat-$turn', role: 'assistant'));
    }

    // A snapshot record Claude Code writes itself: not a message, and skipped.
    sink.writeln(
      jsonEncode(<String, Object?>{
        'type': 'summary',
        'uuid': 'summary-0',
        'sessionId': fixtureSessionId,
        'summary': 'a synthetic session of $turns turns',
      }),
    );

    for (var turn = 0; turn < turns; turn++) {
      if (turn % toolEvery == 0) {
        toolTurn(turn);
      } else {
        chatTurn(turn);
      }
    }

    await sink.flush();
    await sink.close();
    return CcTranscriptFixture._(
      cwd: cwd,
      path: path,
      bytes: await File(path).length(),
      messages: messages,
      toolOutputs: toolOutputs,
    );
  }

  /// Tool output of exactly [bytes] characters, line by line like a build log.
  static String _toolOutput(int turn, int bytes) {
    final buffer = StringBuffer();
    var line = 0;
    while (buffer.length < bytes) {
      buffer.writeln('step $turn line ${line++}: compiled ok in 0.04s');
    }
    return buffer.toString().substring(0, bytes);
  }
}
