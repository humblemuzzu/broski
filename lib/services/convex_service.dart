import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../models/app_user.dart';
import '../models/auth_session.dart';

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

  /// Get list of machines registered to this account
  Future<MachinesResponse> getMachines({required String sessionToken}) async {
    final res = await _client.get(
      _url('/me/machines'),
      headers: {'authorization': 'Bearer $sessionToken'},
    );
    final json = _parseJson(res);
    if (json['ok'] != true) {
      throw Exception(json['error'] ?? 'Failed to load machines');
    }
    return MachinesResponse.fromJson(json);
  }

  /// Revoke a machine from this account
  Future<void> revokeMachine({
    required String sessionToken,
    required String machineId,
  }) async {
    final res = await _client.post(
      _url('/me/machines/revoke'),
      headers: {
        'authorization': 'Bearer $sessionToken',
        'content-type': 'application/json',
      },
      body: jsonEncode({'machineId': machineId}),
    );
    final json = _parseJson(res);
    if (json['ok'] != true) {
      throw Exception(json['error'] ?? 'Failed to revoke machine');
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

/// Response model for /me/machines endpoint
class MachinesResponse {
  MachinesResponse({
    required this.maxMachines,
    required this.machines,
  });

  final int maxMachines;
  final List<MachineInfo> machines;

  factory MachinesResponse.fromJson(Map<String, dynamic> json) {
    final machinesList = (json['machines'] as List?)
            ?.map((m) => MachineInfo.fromJson(m as Map<String, dynamic>))
            .toList() ??
        [];
    return MachinesResponse(
      maxMachines: json['maxMachines'] as int? ?? 3,
      machines: machinesList,
    );
  }
}

/// Model for a registered machine
class MachineInfo {
  MachineInfo({
    required this.id,
    required this.machineIdHash,
    required this.firstSeenAt,
    required this.lastSeenAt,
  });

  final String id;
  final String machineIdHash;
  final DateTime firstSeenAt;
  final DateTime lastSeenAt;

  factory MachineInfo.fromJson(Map<String, dynamic> json) {
    return MachineInfo(
      id: json['id'] as String,
      machineIdHash: json['machineIdHash'] as String,
      firstSeenAt: DateTime.fromMillisecondsSinceEpoch(json['firstSeenAt'] as int),
      lastSeenAt: DateTime.fromMillisecondsSinceEpoch(json['lastSeenAt'] as int),
    );
  }

  /// Returns a human-readable time ago string
  String get lastSeenAgo {
    final now = DateTime.now();
    final diff = now.difference(lastSeenAt);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${(diff.inDays / 7).floor()}w ago';
  }

  /// Returns a shortened machine ID for display
  String get shortId => machineIdHash.length > 8 
      ? '${machineIdHash.substring(0, 8)}...' 
      : machineIdHash;
}
