import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// Provider for app package info (version, build number, etc.)
final appInfoProvider = FutureProvider<PackageInfo>((ref) async {
  return PackageInfo.fromPlatform();
});

/// Convenience provider for just the version string
final appVersionProvider = Provider<String>((ref) {
  final appInfo = ref.watch(appInfoProvider);
  return appInfo.when(
    data: (info) => info.version,
    loading: () => '...',
    error: (_, __) => '1.0.0',
  );
});

/// Convenience provider for version + build number
final appVersionFullProvider = Provider<String>((ref) {
  final appInfo = ref.watch(appInfoProvider);
  return appInfo.when(
    data: (info) => '${info.version} (${info.buildNumber})',
    loading: () => '...',
    error: (_, __) => '1.0.0',
  );
});
