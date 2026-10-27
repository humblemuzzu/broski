import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// One model response: reasoning, then tool calls, or the answer text.
final class ScriptedTurn {
  const ScriptedTurn({
    this.thinking = const [],
    this.text = const [],
    this.toolCalls = const [],
    this.gate,
  });

  final List<String> thinking;
  final List<String> text;
  final List<ScriptedToolCall> toolCalls;

  /// The turn is not streamed until this completes, so a test can hold the
  /// next response back while it checks what the phone already has.
  final Future<void>? gate;
}

final class ScriptedToolCall {
  const ScriptedToolCall(this.name, this.args);

  final String name;
  final Map<String, Object?> args;
}

/// A local OpenAI-compatible `/v1/chat/completions` endpoint that streams a
/// scripted conversation the way DeepSeek does, so a real Pi AgentSession runs
/// against it deterministically.
final class ScriptedOpenAi {
  ScriptedOpenAi._(this._server, this._turns) {
    _server.listen(_serve);
  }

  static const provider = 'scripted';
  static const modelId = 'scripted-1';
  static const _argumentFragmentChars = 7;

  final HttpServer _server;
  final List<ScriptedTurn> _turns;
  var _answered = 0;

  static Future<ScriptedOpenAi> start(List<ScriptedTurn> turns) async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    return ScriptedOpenAi._(server, turns);
  }

  String get baseUrl => 'http://127.0.0.1:${_server.port}/v1';

  Future<void> close() => _server.close(force: true);

  /// The `models.json` that registers this endpoint as a Pi provider.
  String modelsJson() => jsonEncode({
    'providers': {
      provider: {
        'baseUrl': baseUrl,
        'api': 'openai-completions',
        'apiKey': 'scripted-key',
        'compat': {
          'supportsDeveloperRole': false,
          'supportsReasoningEffort': false,
          'supportsStore': false,
        },
        'models': [
          {
            'id': modelId,
            'name': 'Scripted',
            'reasoning': true,
            'input': ['text'],
            'contextWindow': 65536,
            'maxTokens': 8192,
            'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0},
          },
        ],
      },
    },
  });

  Future<void> _serve(HttpRequest request) async {
    await request.drain<void>();
    final index = _answered++;
    final turn = index < _turns.length
        ? _turns[index]
        : const ScriptedTurn(text: ['(script exhausted)']);
    await turn.gate;
    request.response.headers.contentType = ContentType('text', 'event-stream');
    for (final chunk in _chunks(turn, index)) {
      request.response.write('data: ${jsonEncode(chunk)}\n\n');
      await request.response.flush();
      await Future<void>.delayed(const Duration(milliseconds: 4));
    }
    request.response.write('data: [DONE]\n\n');
    await request.response.close();
  }

  List<Map<String, Object?>> _chunks(ScriptedTurn turn, int turnIndex) {
    Map<String, Object?> chunk(
      Map<String, Object?> delta, [
      String? finishReason,
    ]) => {
      'id': 'chatcmpl-scripted',
      'object': 'chat.completion.chunk',
      'created': 0,
      'model': modelId,
      'choices': [
        {'index': 0, 'delta': delta, 'finish_reason': finishReason},
      ],
    };

    final chunks = <Map<String, Object?>>[
      chunk({'role': 'assistant', 'content': ''}),
      for (final piece in turn.thinking) chunk({'reasoning_content': piece}),
      for (final piece in turn.text) chunk({'content': piece}),
    ];
    for (var index = 0; index < turn.toolCalls.length; index++) {
      final call = turn.toolCalls[index];
      final fragments = _fragments(jsonEncode(call.args));
      for (var at = 0; at < fragments.length; at++) {
        chunks.add(
          chunk({
            'tool_calls': [
              {
                'index': index,
                if (at == 0) ...{
                  'id': 'call_${turnIndex}_$index',
                  'type': 'function',
                },
                'function': {
                  if (at == 0) 'name': call.name,
                  'arguments': fragments[at],
                },
              },
            ],
          }),
        );
      }
    }
    chunks
      ..add(chunk({}, turn.toolCalls.isEmpty ? 'stop' : 'tool_calls'))
      ..add({
        'id': 'chatcmpl-scripted',
        'object': 'chat.completion.chunk',
        'created': 0,
        'model': modelId,
        'choices': <Object?>[],
        'usage': {
          'prompt_tokens': 100,
          'completion_tokens': 20,
          'total_tokens': 120,
        },
      });
    return chunks;
  }

  List<String> _fragments(String json) => [
    for (var at = 0; at < json.length; at += _argumentFragmentChars)
      json.substring(
        at,
        at + _argumentFragmentChars > json.length
            ? json.length
            : at + _argumentFragmentChars,
      ),
  ];
}
