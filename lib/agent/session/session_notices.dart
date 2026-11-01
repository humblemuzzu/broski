import 'package:broski/contract/generated/contract.dart';

/// Something shown beside the conversation rather than in it: a backend
/// `notice` or `error` event, or an action of this phone that failed.
final class SessionNotice {
  const SessionNotice({
    required this.id,
    required this.level,
    required this.text,
    required this.at,
  });

  final int id;
  final NoticeLevel level;
  final String text;
  final DateTime at;
}

/// The newest notices, oldest first, bounded so a chatty backend cannot grow
/// the phone's memory.
const maxSessionNotices = 50;

List<SessionNotice> withNotice(
  List<SessionNotice> notices,
  SessionNotice notice,
) {
  final next = [...notices, notice];
  return next.length <= maxSessionNotices
      ? next
      : next.sublist(next.length - maxSessionNotices);
}

/// The newest extension of each kind and window (contract §13): each
/// rate-limit window keeps its own, and a prompt suggestion replaces the last.
Map<String, BackendExtension> withExtension(
  Map<String, BackendExtension> extensions,
  BackendExtension extension,
) => {...extensions, extensionKey(extension): extension};

String extensionKey(BackendExtension extension) => switch (extension) {
  RateLimitUpdate(:final window) => 'rate_limit:$window',
  PromptSuggestion() => 'prompt_suggestion',
};
