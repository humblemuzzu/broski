import 'dart:async';
import 'dart:developer' as developer;

import 'package:broski/models/link/machine.dart';
import 'package:broski/services/link/push_key_store.dart';
import 'package:broski/services/link/push_token_source.dart';
import 'package:broski/services/notification_service.dart';

/// The `push_register` control message: which device to seal pushes for, and
/// with which key.
Map<String, Object?> pushRegisterControl({
  required String token,
  required String key,
}) => {'t': 'push_register', 'platform': 'apns', 'token': token, 'key': key};

/// Keeps each machine's push credentials in the shared keychain and tells the
/// machine which APNs device token to seal its pushes for.
///
/// Push rides the relay, so a machine without one is skipped entirely.
class PushRegistration {
  PushRegistration({
    required PushTokens tokens,
    required Future<PushKeyStore?> Function() openStore,
    Future<bool> Function()? requestPermission,
  }) : _tokens = tokens,
       _openStore = openStore,
       _requestPermission = requestPermission ?? _askForPushPermission;

  static const _logName = 'PushRegistration';

  static Future<bool> _askForPushPermission() =>
      NotificationService.instance.requestPermissions();

  final PushTokens _tokens;
  final Future<PushKeyStore?> Function() _openStore;
  final Future<bool> Function() _requestPermission;

  StreamSubscription<String>? _tokenSub;
  ({String key, void Function(Map<String, Object?>) send})? _current;

  /// Runs on every link Connected, so the machine is registered again after it
  /// restarts and re-reads its key.
  Future<void> onConnected(
    Machine machine,
    String deviceId,
    void Function(Map<String, Object?> message) sendControl,
  ) async {
    final relay = machine.relay;
    final relayToken = machine.relayToken;
    if (relay == null || relayToken == null) return;
    final store = await _openStore();
    if (store == null) return;
    final MachinePushKey item;
    try {
      item = await store.write(
        machineId: machine.id,
        machineName: machine.name,
        relay: relay,
        deviceId: deviceId,
        relayToken: relayToken,
      );
    } on Object catch (error, stackTrace) {
      developer.log(
        'push key write failed',
        name: _logName,
        error: error,
        stackTrace: stackTrace,
      );
      return;
    }
    _current = (key: item.key, send: sendControl);
    _tokenSub ??= _tokens.tokenChanges.listen(_onToken);
    final token = await _tokens.apnsToken();
    if (token == null) {
      unawaited(_registerForPush());
      return;
    }
    sendControl(pushRegisterControl(token: token, key: item.key));
  }

  /// The link is gone, so nothing may be registered against it.
  void detach() => _current = null;

  /// Drops the credentials of machines this phone no longer knows.
  Future<void> forget(Iterable<String> machineIds) async {
    try {
      await (await _openStore())?.forget(machineIds);
    } on Object catch (error, stackTrace) {
      developer.log(
        'push key removal failed',
        name: _logName,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  void dispose() {
    _tokenSub?.cancel();
    _tokenSub = null;
    _current = null;
  }

  /// The token iOS hands out only after a permission grant, which is why the
  /// registration waits for the token rather than for the Connected.
  void _onToken(String token) {
    final current = _current;
    if (current == null) return;
    current.send(pushRegisterControl(token: token, key: current.key));
  }

  Future<void> _registerForPush() async {
    if (!await _requestPermission()) return;
    await _tokens.register();
  }
}
