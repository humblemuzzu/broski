import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:broski/services/link/discovery/lan_browse_notice.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Tells the user once why the app cannot look for their Mac on this network,
/// instead of retrying silently forever.
final lanBrowseFailureNoticeProvider = Provider<void>((ref) {
  final controller = ref.watch(linkConnectionControllerProvider);
  final subscription = controller.discoveryFailures.listen(
    (_) => showLanBrowseFailure(),
  );
  ref.onDispose(subscription.cancel);
});
