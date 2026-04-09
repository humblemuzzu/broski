import 'dart:convert';

import 'package:broski/config/app_config.dart';
import 'package:broski/models/app_user.dart';
import 'package:broski/models/auth_session.dart';
import 'package:http/http.dart' as http;

class ConvexService {
  ConvexService({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  Uri _url(String path) {
    final base = AppConfig.convexHttpBaseUrl;
    return Uri.parse(base).resolve(path);
  }

  Future<AuthSession> signInWithGoogle({
    required String idToken,
    required Map<String, dynamic> device,
  }) async {
    final res = await _client.post(
      _url('/auth/google'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'idToken': idToken, 'device': device}),
    );
    return _parseAuthSession(res);
  }

  Future<AuthSession> signInWithApple({
    required String identityToken,
    String? displayName,
    required Map<String, dynamic> device,
  }) async {
    final res = await _client.post(
      _url('/auth/apple'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({
        'identityToken': identityToken,
        if (displayName != null) 'displayName': displayName,
        'device': device,
      }),
    );
    return _parseAuthSession(res);
  }

  Future<AppUser> getMe({required String sessionToken}) async {
    final res = await _client.get(
      _url('/me'),
      headers: {'authorization': 'Bearer $sessionToken'},
    );
    final json = _parseJson(res);
    if (json['ok'] != true) {
      throw Exception(json['error'] ?? 'Failed to load user');
    }
    return AppUser.fromJson(json['user'] as Map<String, dynamic>);
  }

  Future<void> signOut({required String sessionToken}) async {
    await _client.post(
      _url('/auth/signout'),
      headers: {'authorization': 'Bearer $sessionToken'},
    );
  }

  Future<void> syncRevenueCatFromClient({
    required String sessionToken,
    required bool entitlementActive,
    required String status,
    String? productId,
    int? expiresAtMs,
    String? originalAppUserId,
    String? store,
    String? environment,
  }) async {
    final res = await _client.post(
      _url('/me/revenuecat/sync'),
      headers: {
        'authorization': 'Bearer $sessionToken',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'entitlementActive': entitlementActive,
        'status': status,
        if (productId != null) 'productId': productId,
        if (expiresAtMs != null) 'expiresAtMs': expiresAtMs,
        if (originalAppUserId != null) 'originalAppUserId': originalAppUserId,
        if (store != null) 'store': store,
        if (environment != null) 'environment': environment,
      }),
    );
    final json = _parseJson(res);
    if (json['ok'] != true) {
      throw Exception(json['error'] ?? 'Failed to sync subscription');
    }
  }

  Future<void> deleteAccount({
    required String sessionToken,
    String? reason,
    String? feedback,
  }) async {
    final res = await _client.post(
      _url('/me/delete'),
      headers: {
        'authorization': 'Bearer $sessionToken',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        if (reason != null) 'reason': reason,
        if (feedback != null) 'feedback': feedback,
      }),
    );
    final json = _parseJson(res);
    if (json['ok'] != true) {
      throw Exception(json['error'] ?? 'Failed to delete account');
    }
  }

  AuthSession _parseAuthSession(http.Response res) {
    final json = _parseJson(res);
    if (json['ok'] != true) {
      throw Exception(json['error'] ?? 'Sign-in failed');
    }
    return AuthSession.fromJson({
      'sessionToken': json['sessionToken'],
      'sessionExpiresAtMs': json['sessionExpiresAtMs'],
      'user': json['user'],
    });
  }

  Map<String, dynamic> _parseJson(http.Response res) {
    final body = res.body;
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) return decoded;
      if (decoded is Map) return decoded.cast<String, dynamic>();
      throw const FormatException('Non-object JSON response');
    } catch (e) {
      throw Exception(
        'Convex request failed (${res.statusCode}): ${body.isNotEmpty ? body : e}',
      );
    }
  }
}

