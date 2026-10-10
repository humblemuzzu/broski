import 'dart:async';

import 'package:flutter/services.dart';

/// The APNs device token and the shared keychain group: what the native side
/// knows and Dart cannot work out on its own.
abstract interface class PushTokens {
  /// Lowercase hex of the device token, or null while none has arrived.
  Future<String?> apnsToken();

  /// The `<team id>.<group>` the push items are written into, or null on a
  /// platform that has no notification extension.
  Future<String?> keychainGroup();

  /// Asks iOS for a device token; the token itself arrives on [tokenChanges].
  Future<void> register();

  /// Every device token iOS hands out, including a rotated one.
  Stream<String> get tokenChanges;
}

/// The `broski/push` channel AppDelegate serves.
class NativePushTokens implements PushTokens {
  NativePushTokens({MethodChannel channel = const MethodChannel(channelName)})
    : _channel = channel;

  static const channelName = 'broski/push';

  final MethodChannel _channel;
  final StreamController<String> _changes =
      StreamController<String>.broadcast();
  Future<void>? _starting;
  String? _token;
  String? _group;

  @override
  Stream<String> get tokenChanges => _changes.stream;

  @override
  Future<String?> apnsToken() async {
    await _start();
    return _token;
  }

  @override
  Future<String?> keychainGroup() async {
    await _start();
    return _group;
  }

  @override
  Future<void> register() async {
    await _start();
    try {
      await _channel.invokeMethod<void>('register');
    } on PlatformException catch (_) {
      return;
    } on MissingPluginException catch (_) {
      return;
    }
  }

  Future<void> _start() => _starting ??= _begin();

  Future<void> _begin() async {
    _channel.setMethodCallHandler(_onCall);
    try {
      _token = await _channel.invokeMethod<String>('getApnsToken');
      _group = await _channel.invokeMethod<String>('keychainGroup');
    } on PlatformException catch (_) {
      return;
    } on MissingPluginException catch (_) {
      return;
    }
  }

  Future<void> _onCall(MethodCall call) async {
    final arguments = call.arguments;
    if (call.method != 'onToken' || arguments is! String) return;
    _token = arguments;
    if (!_changes.isClosed) _changes.add(arguments);
  }

  void dispose() {
    _channel.setMethodCallHandler(null);
    unawaited(_changes.close());
  }
}
