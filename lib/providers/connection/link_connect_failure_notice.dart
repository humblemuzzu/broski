import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:broski/services/link/link_connect_failure_notice.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Tells the user why the app is not connected when the link could not even be
/// started, instead of leaving them on a status that never changes.
final linkConnectFailureNoticeProvider = Provider<void>((ref) {
  final controller = ref.watch(linkConnectionControllerProvider);
  final subscription = controller.connectFailures.listen(
    showLinkConnectFailure,
  );
  ref.onDispose(subscription.cancel);
});
