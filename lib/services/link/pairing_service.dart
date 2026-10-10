import 'dart:async';
import 'dart:typed_data';

import 'package:broski/models/link/link_control_exception.dart';
import 'package:broski/models/link/machine.dart';
import 'package:broski/models/link/pairing_failure.dart';
import 'package:broski/models/link/pending_pairing.dart';
import 'package:broski/providers/app_info_provider.dart';
import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/services/link/device_profile.dart';
import 'package:broski/services/link/link_endpoint.dart';
import 'package:broski/services/link/machine_bundle_fetcher.dart';
import 'package:broski/services/link/pairing_credentials.dart';
import 'package:broski/services/link/pairing_input.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final pairingServiceProvider = Provider<PairingService>(
  (ref) => PairingService(ref, MachineBundleFetcher()),
);

/// Pairs this phone with the machine a scanned v2 offer names.
class PairingService {
  PairingService(this._ref, this._bundles);

  static const _confirmTimeout = Duration(seconds: 20);

  final Ref _ref;
  final MachineBundleFetcher _bundles;

  /// Verifies the machine, pairs in Pair mode and leaves the connection live
  /// and adopted, so nothing reconnects afterwards.
  Future<Machine> pair(PendingPairing pending) async {
    if (!pending.expiresAt.isAfter(DateTime.now())) {
      throw ExpiredPairingException(pending.expiresAt);
    }
    final bundle = await _bundles.fetch(pending);
    final identity = await _ref.read(deviceIdentityProvider.future);
    final controller = _ref.read(linkConnectionControllerProvider);
    controller.beginPairing();
    try {
      return await _handshake(pending, bundle, identity, controller);
    } finally {
      controller.endPairing();
    }
  }

  Future<Machine> _handshake(
    PendingPairing pending,
    Uint8List bundle,
    LinkIdentity identity,
    LinkConnectionController controller,
  ) async {
    final connection = await LinkConnection.start(
      identitySecret: identity.secret,
      endpoint: MachineEndpoint(
        machineId: pending.machineId,
        serverPublicBundle: bundle,
        deviceId: pairingDeviceId(pending.secret),
        lan: pending.lan,
        relay: pending.relay,
        relayToken: pairingToken(pending.secret),
      ),
      pairingSecret: pending.secret,
    );
    try {
      final paired = await _confirmation(connection);
      await _ref
          .read(machinesProvider.notifier)
          .applyPaired(paired, pending, bundle);
      final machine = _storedMachine(pending.machineId);
      connection.sendControl(helloControl(app: _ref.read(appVersionProvider)));
      connection.updateEndpoint(linkEndpoint(machine, deviceId: identity.id));
      await controller.adopt(connection, machine, connected: true);
      return machine;
    } on MachineMismatchException catch (error) {
      unawaited(connection.close());
      throw PairingRejectedFailure(error.message);
    } on Object {
      unawaited(connection.close());
      rethrow;
    }
  }

  /// Waits for the `paired` control message the machine sends once it has
  /// stored this phone.
  Future<Map<String, Object?>> _confirmation(LinkConnection connection) {
    final done = Completer<Map<String, Object?>>();
    var settled = false;
    final control = connection.control.listen((message) {
      if (message['t'] == 'paired' && !settled) {
        settled = true;
        done.complete(message);
      }
    });
    final status = connection.status.listen((update) {
      if (update.state == LinkConnectionState.closed && !settled) {
        settled = true;
        done.completeError(
          const PairingRejectedFailure(
            'The machine closed the connection before confirming the pairing.',
          ),
        );
      }
    });
    return done.future
        .timeout(
          _confirmTimeout,
          onTimeout: () {
            settled = true;
            throw const PairingTimeoutFailure(
              'The machine did not confirm the pairing in time.',
            );
          },
        )
        .whenComplete(() async {
          await control.cancel();
          await status.cancel();
        });
  }

  Machine _storedMachine(String id) {
    final machine = machineWithId(_ref.read(machinesProvider).machines, id);
    if (machine == null) {
      throw StateError('the paired machine $id was not stored');
    }
    return machine;
  }
}
