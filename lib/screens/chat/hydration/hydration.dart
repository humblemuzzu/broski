import 'package:broski/app/app_messenger.dart';
import 'package:broski/models/message.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

export 'hydrate_claude_code.dart';
export 'hydrate_codex.dart';
export 'hydrate_opencode.dart';

/// What every backend's initial hydrate needs from the chat screen.
final class Hydration {
  const Hydration({
    required this.ref,
    required this.widget,
    required this.chat,
    required this.setPaginationState,
    required this.scrollToBottom,
  });

  final WidgetRef ref;
  final ChatScreen widget;
  final ChatSessionNotifier chat;

  /// Only a page that came back with nothing older may claim the whole
  /// transcript is loaded: a failed read must leave "load earlier" possible.
  final void Function({required bool loadingMore, required bool loadedAll})
  setPaginationState;
  final void Function({bool animate}) scrollToBottom;
}

/// A transcript read that failed never reads as "this chat is empty".
void transcriptUnavailable() =>
    showAppNotice('Could not load this chat from your Mac');

/// Convert ChatMessage to raw format for hydrate.
Map<String, dynamic> messageToRaw(ChatMessage m) {
  return {
    'info': {
      'id': m.id,
      'sessionID': m.sessionId,
      'role': m.role == MessageRole.user ? 'user' : 'assistant',
      'time': {'created': m.createdAt.millisecondsSinceEpoch},
    },
    'parts': [
      if (m.text.isNotEmpty) {'type': 'text', 'text': m.text},
      ...m.toolCalls.map(
        (t) => {
          'type': 'tool',
          'id': t.partId,
          'callID': t.callId,
          'tool': t.name,
          'state': {
            'status': t.status,
            'title': t.title,
            'input': t.input,
            'output': t.output,
            'metadata': t.metadata,
          },
        },
      ),
    ],
  };
}
