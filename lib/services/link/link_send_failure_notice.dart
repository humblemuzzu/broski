import 'package:broski/app/app_messenger.dart';
import 'package:broski_link/broski_link.dart';

/// What a refused message reads as: the send never left the phone, so the user
/// has to know before they wait for a reply.
String linkSendFailureText(LinkSendFailure failure) => switch (failure.reason) {
  LinkSendFailureReason.tooLarge => 'That message is too large to send',
  LinkSendFailureReason.queueFull =>
    'Your phone is still sending the last messages',
  LinkSendFailureReason.rejected =>
    "Couldn't send — the Mac refused that message",
  LinkSendFailureReason.sessionReset =>
    'The session was replaced · reconnecting',
};

/// Whether the user has to be told: only a message they sent is worth a notice,
/// and its tag is what says they sent it. A frame the app sends on its own
/// carries no tag, and a reset already reports itself on the link status.
bool shouldAnnounceLinkSendFailure(LinkSendFailure failure) =>
    failure.tag != null && failure.reason != LinkSendFailureReason.sessionReset;

void showLinkSendFailure(LinkSendFailure failure) {
  if (!shouldAnnounceLinkSendFailure(failure)) return;
  showAppNotice(linkSendFailureText(failure));
}
