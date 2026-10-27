import 'dart:async';

import 'package:broski_link/broski_link.dart';

/// A link with no isolate behind it: a test reports the statuses a real one
/// would, and reads back what the app asked it to dial.
class FakeLinkSession implements LinkSession {
  final StreamController<String> _bridge = StreamController<String>.broadcast();
  final StreamController<Map<String, Object?>> _control =
      StreamController<Map<String, Object?>>.broadcast();
  final StreamController<LinkStatus> _status =
      StreamController<LinkStatus>.broadcast();
  final StreamController<BridgeLinkStatus> _bridgeStatus =
      StreamController<BridgeLinkStatus>.broadcast();
  final StreamController<LinkSendFailure> _sendFailures =
      StreamController<LinkSendFailure>.broadcast();

  final List<LinkStatus> statuses = <LinkStatus>[];
  final List<MachineEndpoint> endpoints = <MachineEndpoint>[];
  final List<String> sentControls = <String>[];
  var closes = 0;
  var resumed = 0;
  var paused = 0;
  var networkChanges = 0;

  MachineEndpoint? get lastEndpoint =>
      endpoints.isEmpty ? null : endpoints.last;

  void report(LinkStatus status) {
    statuses.add(status);
    _status.add(status);
  }

  void reportControl(Map<String, Object?> message) => _control.add(message);

  @override
  Stream<String> get bridgeMessages => _bridge.stream;

  @override
  Stream<Map<String, Object?>> get control => _control.stream;

  @override
  Stream<LinkStatus> get status => _status.stream;

  @override
  Stream<BridgeLinkStatus> get bridgeStatus => _bridgeStatus.stream;

  @override
  Stream<LinkSendFailure> get sendFailures => _sendFailures.stream;

  @override
  void sendBridge(String text, {String? tag}) {}

  @override
  void sendControl(Map<String, Object?> message) =>
      sentControls.add(message['t'] as String? ?? '');

  @override
  void updateEndpoint(MachineEndpoint endpoint) => endpoints.add(endpoint);

  @override
  void networkChanged() => networkChanges++;

  @override
  void appResumed() => resumed++;

  @override
  void appPaused() => paused++;

  @override
  Future<void> close() async {
    closes++;
    await Future<void>.delayed(Duration.zero);
  }
}
