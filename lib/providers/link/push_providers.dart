import 'dart:async';

import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/services/link/push_key_store.dart';
import 'package:broski/services/link/push_registration.dart';
import 'package:broski/services/link/push_token_source.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final pushTokensProvider = Provider<PushTokens>((ref) {
  final tokens = NativePushTokens();
  ref.onDispose(tokens.dispose);
  return tokens;
});

/// The push side of the link: every machine this phone connects to is told
/// which APNs token to seal pushes for.
final pushRegistrationProvider = Provider<PushRegistration>((ref) {
  final tokens = ref.watch(pushTokensProvider);
  final registration = PushRegistration(
    tokens: tokens,
    openStore: () async {
      final group = await tokens.keychainGroup();
      return group == null ? null : PushKeyStore.forKeychainGroup(group);
    },
  );
  ref.onDispose(registration.dispose);
  return registration;
});

/// Drops the push credentials of a machine the app no longer knows.
///
/// Machines are compared across states, never against empty: the notifier
/// publishes an empty list before it has read the stored machines.
final pushKeyPruneProvider = Provider<void>((ref) {
  final registration = ref.watch(pushRegistrationProvider);
  var known = const <String>{};
  ref.listen<MachinesState>(machinesProvider, (_, next) {
    final ids = {for (final machine in next.machines) machine.id};
    final forgotten = known.difference(ids);
    known = ids;
    if (forgotten.isNotEmpty) unawaited(registration.forget(forgotten));
  }, fireImmediately: true);
});
