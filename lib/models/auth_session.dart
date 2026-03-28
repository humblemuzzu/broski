import 'package:broski/models/app_user.dart';

class AuthSession {
  const AuthSession({
    required this.sessionToken,
    required this.sessionExpiresAtMs,
    required this.user,
  });

  final String sessionToken;
  final int sessionExpiresAtMs;
  final AppUser user;

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    return AuthSession(
      sessionToken: json['sessionToken'] as String,
      sessionExpiresAtMs: (json['sessionExpiresAtMs'] as num).toInt(),
      user: AppUser.fromJson(json['user'] as Map<String, dynamic>),
    );
  }
}
