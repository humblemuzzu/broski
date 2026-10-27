import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:broski/widgets/link/link_send_failure_snackbar.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Tells the user when the link refused a message, instead of leaving them
/// waiting for a reply that will never come.
final linkSendFailureNoticeProvider = Provider<void>((ref) {
  final controller = ref.watch(linkConnectionControllerProvider);
  final subscription = controller.sendFailures.listen(showLinkSendFailure);
  ref.onDispose(subscription.cancel);
});
