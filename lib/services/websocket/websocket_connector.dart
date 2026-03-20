import 'dart:convert' show base64Url;
import 'dart:io' show HttpClient, X509Certificate;

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

WebSocketChannel createWebSocketChannel(
  Uri uri, {
  String? authToken,
  String? pinnedCertSha256,
}) {
  if (kIsWeb) {
    final protocols = authToken != null
        ? <String>['broski-auth.$authToken']
        : null;
    return WebSocketChannel.connect(uri, protocols: protocols);
  }

  HttpClient? client;
  if (uri.scheme == 'wss') {
    if (pinnedCertSha256 != null) {
      final normalizedPinned = pinnedCertSha256.replaceAll('=', '');
      client = HttpClient()
        ..badCertificateCallback =
            (X509Certificate cert, String host, int port) {
              final digest = sha256.convert(cert.der).bytes;
              final fp = base64Url.encode(digest).replaceAll('=', '');
              return fp == normalizedPinned;
            };
    } else {
      client = HttpClient()
        ..badCertificateCallback =
            (X509Certificate cert, String host, int port) => true;
    }
  }

  final headers = <String, dynamic>{};
  if (authToken != null) {
    headers['Authorization'] = 'Bearer $authToken';
  }

  return IOWebSocketChannel.connect(
    uri,
    headers: headers.isEmpty ? null : headers,
    protocols: null,
    customClient: client,
  );
}
