import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:broski_link/src/connection/link_socket.dart';
import 'package:broski_link/src/connection/link_status.dart';

/// Opens one WebSocket.
Future<LinkSocket> dialSocket({
  required Uri uri,
  required LinkRoute route,
  required Duration timeout,
  Map<String, String>? headers,
}) async {
  final pending = WebSocket.connect(uri.toString(), headers: headers);
  try {
    final socket = await pending.timeout(timeout);
    return WebLinkSocket._(socket, route, uri);
  } on TimeoutException {
    // A socket that only arrives after the timeout must not leak.
    unawaited(
      pending.then<void>((socket) => socket.close(), onError: (Object _) {}),
    );
    rethrow;
  }
}

final class WebLinkSocket implements LinkSocket {
  WebLinkSocket._(this._socket, this.route, this.uri);

  final WebSocket _socket;

  @override
  final LinkRoute route;

  @override
  final Uri uri;

  void Function(SocketFrame frame)? _onFrame;
  void Function()? _onClosed;
  var _open = true;

  @override
  bool get isOpen => _open;

  @override
  void listen(
    void Function(SocketFrame frame) onFrame,
    void Function() onClosed,
  ) {
    _onFrame = onFrame;
    _onClosed = onClosed;
    _socket.listen(
      _dispatch,
      onError: (Object _) => _closed(),
      onDone: _closed,
      cancelOnError: false,
    );
  }

  @override
  void send(Uint8List bytes) {
    if (!_open) {
      return;
    }
    try {
      _socket.add(bytes);
    } on Object {
      _closed();
    }
  }

  @override
  Future<void> close() async {
    if (!_open) {
      return;
    }
    _open = false;
    _onFrame = null;
    _onClosed = null;
    try {
      await _socket.close();
    } on Object {
      // Closing a socket that is already gone must not fail its caller.
    }
  }

  void _dispatch(Object? data) {
    if (!_open) {
      return;
    }
    final SocketFrame? frame;
    if (data is String) {
      frame = route == LinkRoute.relay ? _parsePresence(data) : null;
    } else if (data is Uint8List) {
      frame = SocketBinary(data);
    } else if (data is List<int>) {
      frame = SocketBinary(Uint8List.fromList(data));
    } else {
      frame = null;
    }
    if (frame != null) {
      _onFrame?.call(frame);
    }
  }

  void _closed() {
    if (!_open) {
      return;
    }
    _open = false;
    final onClosed = _onClosed;
    _onClosed = null;
    onClosed?.call();
  }
}

/// The relay's `{"t":"status",...}` frame, or null for anything else.
SocketPresence? _parsePresence(String text) {
  Object? decoded;
  try {
    decoded = jsonDecode(text);
  } on FormatException {
    return null;
  }
  if (decoded is! Map<String, Object?> || decoded['t'] != 'status') {
    return null;
  }
  final presence = switch (decoded['machine']) {
    'online' => MachinePresence.online,
    'offline' => MachinePresence.offline,
    'asleep' => MachinePresence.asleep,
    _ => null,
  };
  if (presence == null) {
    return null;
  }
  final lastSeen = decoded['last_seen'];
  return SocketPresence(
    presence,
    lastSeen is int ? DateTime.fromMillisecondsSinceEpoch(lastSeen) : null,
  );
}
