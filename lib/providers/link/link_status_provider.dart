import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The latest link status, with the machine it was reported for.
class LinkStatusSnapshot {
  const LinkStatusSnapshot({required this.machineId, required this.status});

  final String machineId;
  final LinkStatus status;
}

/// Where the link connection controller publishes the statuses it observes.
final linkStatusSinkProvider =
    StateNotifierProvider<LinkStatusSink, LinkStatusSnapshot?>(
      (ref) => LinkStatusSink(),
    );

class LinkStatusSink extends StateNotifier<LinkStatusSnapshot?> {
  LinkStatusSink() : super(null);

  void publish(String machineId, LinkStatus status) =>
      state = LinkStatusSnapshot(machineId: machineId, status: status);

  void clear() => state = null;
}

/// The selected machine's latest link status, or null while the app is not on a
/// link machine.
///
/// A status for a machine that is no longer the selected one is dropped: the
/// app switch closes the old link, so anything left behind is stale.
final linkStatusProvider = Provider<LinkStatus?>((ref) {
  final snapshot = ref.watch(linkStatusSinkProvider);
  if (snapshot == null) return null;
  final selectedId = ref.watch(
    machinesProvider.select((state) => state.selectedId),
  );
  return snapshot.machineId == selectedId ? snapshot.status : null;
});
