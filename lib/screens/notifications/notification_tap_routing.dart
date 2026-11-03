import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/backends_controller.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/link/machine.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/link/machine_switch_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/notifications/notification_tap_provider.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:broski/services/notifications/notification_tap.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens a session's conversation; a test replaces it with a recorder.
final notificationSessionOpenerProvider =
    Provider<Future<void> Function(BuildContext, SessionRef)>(
      (ref) => openSession,
    );

/// The session a tap opens on the contract core's screens, or null when the
/// bridge does not serve its backend that way: the old protocol's sessions
/// have their own screens. Which backends the core serves is what the bridge
/// listed, not something the app knows. A backend that goes by an old agent's
/// name is both, and a tap names only the name: it opens on the core's
/// screens only while [selected] is the contract one.
SessionRef? contractSessionOf(
  NotificationTap tap,
  BackendsState backends,
  SelectedBackend selected,
) {
  final served = backends.backends
      .where((listed) => listed.id.wire == tap.backend)
      .firstOrNull;
  if (served == null) return null;
  final choice = ContractSelection(served.id);
  if (choice.sharesLegacyName && selected != choice) return null;
  return SessionRef(backend: served.id, sessionId: tap.session);
}

/// Where a tap's session is, as the paired machines stand.
sealed class _Whereabouts {
  const _Whereabouts();
}

/// On the machine the app is on (or the tap does not say).
final class _Here extends _Whereabouts {
  const _Here();
}

/// On another paired machine, which the app moves to first.
final class _Elsewhere extends _Whereabouts {
  const _Elsewhere(this.machine);

  final Machine machine;
}

/// On a machine this phone is no longer paired with.
final class _Unpaired extends _Whereabouts {
  const _Unpaired();
}

_Whereabouts _whereabouts(NotificationTap tap, MachinesState machines) {
  final id = tap.machine;
  if (id == null || id == machines.selectedId) return const _Here();
  final machine = machines.machines.where((paired) => paired.id == id);
  return machine.isEmpty ? const _Unpaired() : _Elsewhere(machine.first);
}

/// Opens the conversation a tapped notification is about, on the machine it
/// came from: the app moves to that machine first, and a tap for a machine no
/// longer paired is dropped. It opens once the backends are known, from the
/// bridge or from the list saved for that machine, so a tap made offline
/// opens what was saved; one that is not a contract session is dropped.
/// Called from a widget's `build`, under the app's navigator.
void routeNotificationTaps(BuildContext context, WidgetRef ref) {
  final tap = ref.watch(pendingNotificationTapProvider);
  if (tap == null) return;
  final machines = ref.watch(machinesProvider);
  if (!machines.loaded) return;
  final pending = ref.read(pendingNotificationTapProvider.notifier);
  switch (_whereabouts(tap, machines)) {
    case _Unpaired():
      _afterFrame(context, () => pending.consume(tap));
    case _Elsewhere(:final machine):
      final move = ref.read(machineSwitchProvider);
      _afterFrame(context, () {
        if (pending.claimSwitch(tap)) move(machine);
      });
    case _Here():
      _openWhenListed(context, ref, tap);
  }
}

void _openWhenListed(BuildContext context, WidgetRef ref, NotificationTap tap) {
  final backends = ref.watch(backendsProvider);
  if (!backends.loaded && backends.savedAt == null) return;
  if (ref.watch(selectedBackendReadyProvider).isLoading) return;
  final session = contractSessionOf(
    tap,
    backends,
    ref.read(selectedBackendProvider),
  );
  final open = ref.read(notificationSessionOpenerProvider);
  final pending = ref.read(pendingNotificationTapProvider.notifier);
  _afterFrame(context, () {
    if (pending.consume(tap) && session != null) open(context, session);
  });
}

void _afterFrame(BuildContext context, void Function() action) =>
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (context.mounted) action();
    });
