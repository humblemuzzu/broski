import 'dart:async';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:broski_link/src/bindings.dart'
    show identitySecretLength, publicBundleLength;
import 'package:broski_link/src/connection/isolate_entry.dart';
import 'package:broski_link/src/connection/isolate_protocol.dart';
import 'package:broski_link/src/connection/link_status.dart';
import 'package:broski_link/src/connection/machine_endpoint.dart';

/// The phone side of one link.
///
/// A background isolate owns the Rust session and every socket, so FFI and
/// crypto stay off the UI thread. The app talks to it through the three streams
/// and the senders below, and must subscribe as soon as [start] returns: they
/// are broadcast streams, so anything sent before a listener attaches is
/// dropped.
final class LinkConnection {
  LinkConnection._() {
    _events.listen(_onEvent);
    _errors.listen(_onFatal);
    _exits.listen((Object? _) => _onExit());
  }

  final ReceivePort _events = ReceivePort();
  final ReceivePort _errors = ReceivePort();
  final ReceivePort _exits = ReceivePort();
  final StreamController<String> _bridge = StreamController<String>.broadcast();
  final StreamController<Map<String, Object?>> _control =
      StreamController<Map<String, Object?>>.broadcast();
  final StreamController<LinkStatus> _status =
      StreamController<LinkStatus>.broadcast();
  final Completer<SendPort> _ready = Completer<SendPort>();
  final Completer<void> _stopped = Completer<void>();
  Isolate? _isolate;
  SendPort? _commands;
  var _closed = false;
  var _portsClosed = false;
  Future<void>? _closing;

  /// Spawns the isolate and returns once it is ready to take commands.
  ///
  /// [pairingSecret] runs the first handshake in Pair mode; every later one
  /// runs in Connect mode.
  static Future<LinkConnection> start({
    required Uint8List identitySecret,
    required MachineEndpoint endpoint,
    Uint8List? pairingSecret,
  }) async {
    if (identitySecret.length != identitySecretLength) {
      throw ArgumentError.value(
        identitySecret.length,
        'identitySecret',
        'an identity secret is $identitySecretLength bytes',
      );
    }
    if (endpoint.serverPublicBundle.length != publicBundleLength) {
      throw ArgumentError.value(
        endpoint.serverPublicBundle.length,
        'serverPublicBundle',
        'a public bundle is $publicBundleLength bytes',
      );
    }
    if (pairingSecret != null && pairingSecret.length != 32) {
      throw ArgumentError.value(
        pairingSecret.length,
        'pairingSecret',
        'a pairing secret is 32 bytes',
      );
    }
    endpoint.relayDevice();
    final connection = LinkConnection._();
    try {
      connection._isolate = await Isolate.spawn(
        linkIsolateEntry,
        LinkStart(
          events: connection._events.sendPort,
          identitySecret: identitySecret,
          endpoint: endpoint,
          pairingSecret: pairingSecret,
        ),
        onError: connection._errors.sendPort,
        onExit: connection._exits.sendPort,
        errorsAreFatal: true,
      );
      connection._commands = await connection._ready.future;
    } on Object {
      await connection.close();
      rethrow;
    }
    return connection;
  }

  /// Bridge messages, stream 1, still sealed until they leave the machine.
  Stream<String> get bridgeMessages => _bridge.stream;

  /// Control JSON, stream 0.
  Stream<Map<String, Object?>> get control => _control.stream;

  /// Every status change, including the ones that arrive before the first
  /// handshake finishes.
  Stream<LinkStatus> get status => _status.stream;

  /// Queued in the session even while disconnected; the machine's session
  /// resends it after a resume.
  void sendBridge(String text) => _send(LinkSendBridge(text));

  void sendControl(Map<String, Object?> message) =>
      _send(LinkSendControl(message));

  /// Replaces the routes, for example after control reported new ones.
  void updateEndpoint(MachineEndpoint endpoint) {
    endpoint.relayDevice();
    _send(LinkSetEndpoint(endpoint));
  }

  void networkChanged() => _send(const LinkNetworkChanged());

  void appResumed() => _send(const LinkAppResumed());

  void appPaused() => _send(const LinkAppPaused());

  /// Closes the sockets and the isolate.
  Future<void> close() => _closing ??= _shutdown();

  Future<void> _shutdown() async {
    _closed = true;
    _commands?.send(const LinkShutdown());
    final isolate = _isolate;
    if (isolate != null) {
      await _stopped.future.timeout(
        const Duration(seconds: 1),
        onTimeout: () {},
      );
      isolate.kill(priority: Isolate.immediate);
    }
    if (!_stopped.isCompleted) {
      _stopped.complete();
    }
    _closePorts();
    await _bridge.close();
    await _control.close();
    await _status.close();
  }

  void _send(LinkCommand command) {
    if (_closed) {
      return;
    }
    _commands?.send(command);
  }

  void _onEvent(Object? message) {
    switch (message) {
      case LinkIsolateReady(:final commands):
        if (!_ready.isCompleted) {
          _ready.complete(commands);
        }
      case LinkIsolateStatus(status: final update):
        if (!_status.isClosed) {
          _status.add(update);
        }
      case LinkIsolateBridge(text: final text):
        if (!_bridge.isClosed) {
          _bridge.add(text);
        }
      case LinkIsolateControl(message: final control):
        if (!_control.isClosed) {
          _control.add(control);
        }
      case LinkIsolateStopped():
        if (!_stopped.isCompleted) {
          _stopped.complete();
        }
    }
  }

  void _onExit() {
    if (_closed) {
      if (!_stopped.isCompleted) {
        _stopped.complete();
      }
      return;
    }
    _onFatal();
  }

  void _onFatal([Object? cause]) {
    if (_closed) {
      return;
    }
    _closed = true;
    if (!_ready.isCompleted) {
      final detail = cause is List && cause.isNotEmpty ? cause.first : cause;
      _ready.completeError(
        StateError(
          'the link isolate stopped before it was ready'
          '${detail == null ? '' : ': $detail'}',
        ),
      );
    }
    if (!_stopped.isCompleted) {
      _stopped.complete();
    }
    if (!_status.isClosed) {
      _status.add(const LinkStatus(state: LinkConnectionState.closed));
    }
    _closePorts();
    unawaited(_bridge.close());
    unawaited(_control.close());
    unawaited(_status.close());
  }

  void _closePorts() {
    if (_portsClosed) {
      return;
    }
    _portsClosed = true;
    _events.close();
    _errors.close();
    _exits.close();
  }
}
