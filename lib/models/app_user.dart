class AppUser {
  const AppUser({
    required this.appUserId,
    required this.provider,
    this.email,
    this.displayName,
    this.photoUrl,
    this.subscription,
  });

  final String appUserId;
  final String provider; // 'google' | 'apple'
  final String? email;
  final String? displayName;
  final String? photoUrl;
  final AppSubscription? subscription;

  factory AppUser.fromJson(Map<String, dynamic> json) {
    return AppUser(
      appUserId: json['appUserId'] as String,
      provider: json['provider'] as String,
      email: json['email'] as String?,
      displayName: json['displayName'] as String?,
      photoUrl: json['photoUrl'] as String?,
      subscription: json['subscription'] is Map<String, dynamic>
          ? AppSubscription.fromJson(
              json['subscription'] as Map<String, dynamic>,
            )
          : null,
    );
  }

  bool get isEntitled => subscription?.entitlementActive ?? false;
}

class AppSubscription {
  const AppSubscription({
    required this.entitlementActive,
    required this.status,
    this.productId,
    this.expiresAtMs,
  });

  final bool entitlementActive;
  final String status;
  final String? productId;
  final int? expiresAtMs;

  factory AppSubscription.fromJson(Map<String, dynamic> json) {
    return AppSubscription(
      entitlementActive: json['entitlementActive'] as bool? ?? false,
      status: json['status'] as String? ?? 'unknown',
      productId: json['productId'] as String?,
      expiresAtMs: (json['expiresAtMs'] as num?)?.toInt(),
    );
  }
}
