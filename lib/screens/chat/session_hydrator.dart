import 'package:broski/providers/chat_provider.dart';
import 'package:broski/screens/chat/hydration/hydration.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Hydrates a chat session by loading messages from bridge or cache.
///
/// Returns `true` if `_loadSessionContext()` should be called by the caller.
Future<bool> hydrateSession({
  required WidgetRef ref,
  required ChatScreen widget,
  required void Function({required bool loadingMore, required bool loadedAll})
  setPaginationState,
  required void Function({bool animate}) scrollToBottom,
}) async {
  setPaginationState(loadingMore: false, loadedAll: false);

  final hydration = Hydration(
    ref: ref,
    widget: widget,
    chat: ref.read(chatSessionProvider.notifier),
    setPaginationState: setPaginationState,
    scrollToBottom: scrollToBottom,
  );
  if (widget.isClaudeCode) return hydrateClaudeCode(hydration);
  if (widget.isCodex) return hydrateCodex(hydration);
  return hydrateOpenCode(hydration);
}
