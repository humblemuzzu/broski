import 'dart:io';

import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../config/app_config.dart';
import '../models/auth_session.dart';
import 'convex_service.dart';
import 'storage_service.dart';

class AuthService {
  AuthService({required StorageService storage, required ConvexService convex})
    : _storage = storage,
      _convex = convex;

  final StorageService _storage;
  final ConvexService _convex;

  bool _googleInitialized = false;

  Future<void> _ensureGoogleInitialized() async {
    if (_googleInitialized) return;
    await GoogleSignIn.instance.initialize(
      clientId: AppConfig.googleIosClientId.isNotEmpty
          ? AppConfig.googleIosClientId
          : null,
      serverClientId: AppConfig.googleServerClientId.isNotEmpty
          ? AppConfig.googleServerClientId
          : null,
    );
    _googleInitialized = true;
  }

  Future<String?> getCachedSessionToken() => _storage.getAppSessionToken();

  Future<void> clearCachedSession() => _storage.clearAppAuth();

  Future<AuthSession> signInWithGoogle() async {
    final device = await _deviceInfo();

    await _ensureGoogleInitialized();

    // In v7.x, use authenticate() instead of signIn()
    // Pass scopeHint for a combined auth+authorization flow
    final account = await GoogleSignIn.instance.authenticate(
      scopeHint: const ['email', 'profile'],
    );

    // In v7.x, authentication tokens are accessed via the authentication getter
    final auth = account.authentication;
    final idToken = auth.idToken;
    if (idToken == null || idToken.isEmpty) {
      throw Exception('Google sign-in failed (missing idToken)');
    }

    final session = await _convex.signInWithGoogle(
      idToken: idToken,
      device: device,
    );
    await _storage.setAppSessionToken(session.sessionToken);
    await _storage.setAppUserId(session.user.appUserId);
    return session;
  }

  Future<AuthSession> signInWithApple() async {
    if (!Platform.isIOS && !Platform.isMacOS) {
      throw Exception('Apple Sign In is only available on Apple devices');
    }

    final device = await _deviceInfo();

    AuthorizationCredentialAppleID credential;
    try {
      credential = await SignInWithApple.getAppleIDCredential(
        scopes: const [
          AppleIDAuthorizationScopes.email,
          AppleIDAuthorizationScopes.fullName,
        ],
      );
    } on SignInWithAppleAuthorizationException catch (e) {
      // Re-throw with clearer message
      if (e.code == AuthorizationErrorCode.canceled) {
        throw Exception('Sign-in cancelled');
      }
      throw Exception('Apple Sign In error (${e.code}): ${e.message}');
    } catch (e) {
      throw Exception('Apple Sign In error: $e');
    }

    final identityToken = credential.identityToken;
    if (identityToken == null || identityToken.isEmpty) {
      throw Exception('Apple sign-in failed (missing identityToken)');
    }

    final given = credential.givenName?.trim();
    final family = credential.familyName?.trim();
    final displayName = [
      given,
      family,
    ].where((p) => p != null && p.isNotEmpty).map((p) => p!).join(' ').trim();

    try {
      final session = await _convex.signInWithApple(
        identityToken: identityToken,
        displayName: displayName.isNotEmpty ? displayName : null,
        device: device,
      );
      await _storage.setAppSessionToken(session.sessionToken);
      await _storage.setAppUserId(session.user.appUserId);
      return session;
    } catch (e) {
      throw Exception('Convex Apple auth failed: $e');
    }
  }

  Future<void> signOut() async {
    final token = await _storage.getAppSessionToken();
    if (token != null) {
      try {
        await _convex.signOut(sessionToken: token);
      } catch (_) {
        // Ignore backend failures during sign-out; local sign-out must succeed.
      }
    }

    try {
      await _ensureGoogleInitialized();
      await GoogleSignIn.instance.signOut();
    } catch (_) {}

    await _storage.clearAppAuth();
  }

  Future<Map<String, dynamic>> _deviceInfo() async {
    final deviceId = await _storage.getOrCreateDeviceId();
    return {'platform': Platform.operatingSystem, 'deviceId': deviceId};
  }
}
