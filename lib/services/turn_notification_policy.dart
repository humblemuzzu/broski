/// When a finished agent turn is worth a notification.
///
/// One notification per finished turn — never per tool call or model round trip, because the session only
/// goes busy to idle once per run — and none while the user is already looking at that chat.
bool shouldNotifyTurnFinished({
  required bool appInForeground,
  required bool chatOpen,
  required String? openChatSessionId,
  required String finishedSessionId,
}) {
  final watching =
      appInForeground && chatOpen && openChatSessionId == finishedSessionId;
  return !watching;
}
