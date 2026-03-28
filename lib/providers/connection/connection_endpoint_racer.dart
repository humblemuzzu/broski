import 'dart:async';

import 'package:broski/models/connection.dart';
import 'package:broski/models/connection_quality.dart';
import 'package:broski/services/websocket/websocket_connector.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

class ConnectionEndpoint {
  const ConnectionEndpoint({
    required this.type,
    required this.uri,
    required this.host,
    required this.isFunnel,
  });

  final ConnectionType type;
  final Uri uri;
  final String host;
  final bool isFunnel;
}

class ConnectionAttemptResult {
  const ConnectionAttemptResult({
    required this.type,
    required this.uri,
    required this.host,
    required this.success,
    this.error,
  });

  final ConnectionType type;
  final Uri uri;
  final String host;
  final bool success;
  final Object? error;
}

Future<ConnectionAttemptResult?> raceConnectionEndpoints(
  List<ConnectionEndpoint> endpoints,
  ConnectionInfo info, {
  required Duration connectTimeout,
}) async {
  if (endpoints.isEmpty) return null;

  final completer = Completer<ConnectionAttemptResult>();
  var remaining = endpoints.length;
  ConnectionAttemptResult? lastFailure;

  for (final endpoint in endpoints) {
    unawaited(() async {
      final result = await _probeEndpoint(endpoint, info, connectTimeout);
      if (completer.isCompleted) return;

      if (result.success) {
        completer.complete(result);
        return;
      }

      lastFailure = result;
      remaining -= 1;
      if (remaining == 0 && lastFailure != null) {
        completer.complete(lastFailure!);
      }
    }());
  }

  return completer.future;
}

Future<ConnectionAttemptResult> _probeEndpoint(
  ConnectionEndpoint endpoint,
  ConnectionInfo info,
  Duration timeout,
) async {
  final shouldPin =
      info.tlsEnabled &&
      info.certSha256 != null &&
      info.certSha256!.isNotEmpty &&
      !endpoint.isFunnel;

  WebSocketChannel? channel;
  try {
    channel = createWebSocketChannel(
      endpoint.uri,
      authToken: info.authToken,
      pinnedCertSha256: shouldPin ? info.certSha256 : null,
    );
    await channel.ready.timeout(
      timeout,
      onTimeout: () => throw TimeoutException('Connection timeout'),
    );
    return ConnectionAttemptResult(
      type: endpoint.type,
      uri: endpoint.uri,
      host: endpoint.host,
      success: true,
    );
  } catch (error) {
    return ConnectionAttemptResult(
      type: endpoint.type,
      uri: endpoint.uri,
      host: endpoint.host,
      success: false,
      error: error,
    );
  } finally {
    await channel?.sink.close();
  }
}
