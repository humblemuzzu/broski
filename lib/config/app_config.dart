class AppConfig {
  static String get convexHttpBaseUrl {
    const fromEnv = String.fromEnvironment('CONVEX_HTTP_BASE_URL');
    if (fromEnv.isNotEmpty) return fromEnv;
    // Default to production Convex URL
    return 'https://neat-gerbil-813.convex.site';
  }

  static const String revenueCatEntitlementId = String.fromEnvironment(
    'REVENUECAT_ENTITLEMENT_ID',
    defaultValue: 'Pro',
  );

  static const String revenueCatProductIdMonthly = String.fromEnvironment(
    'REVENUECAT_PRODUCT_ID_MONTHLY',
    defaultValue: 'broski_pro_monthly',
  );

  static const String _revenueCatIosApiKeyFromEnv = String.fromEnvironment(
    'REVENUECAT_IOS_API_KEY',
  );
  static const String _revenueCatAndroidApiKeyFromEnv = String.fromEnvironment(
    'REVENUECAT_ANDROID_API_KEY',
  );

  static const String googleIosClientId = String.fromEnvironment(
    'GOOGLE_IOS_CLIENT_ID',
    defaultValue:
        '301002948584-3lpgq673v734fs4206f976uslh3btn6d.apps.googleusercontent.com',
  );

  static const String googleServerClientId = String.fromEnvironment(
    'GOOGLE_SERVER_CLIENT_ID',
    defaultValue:
        '301002948584-s7u5tj35c1f50eik5feqernd2j3ddk8h.apps.googleusercontent.com',
  );

  static String revenueCatIosApiKey() {
    if (_revenueCatIosApiKeyFromEnv.isNotEmpty) {
      return _revenueCatIosApiKeyFromEnv;
    }
    // Production RevenueCat public API key (safe to embed - it's public)
    return 'appl_oLMOZAgKCsHdjSJdVbkrUZHNnkl';
  }

  static String revenueCatAndroidApiKey() {
    if (_revenueCatAndroidApiKeyFromEnv.isNotEmpty) {
      return _revenueCatAndroidApiKeyFromEnv;
    }
    // Android is shipped later; keep empty until release config is set.
    return '';
  }
}
