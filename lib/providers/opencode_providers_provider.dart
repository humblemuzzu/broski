import 'package:broski/models/provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Combined provider + auth data for display in the providers screen.
class OcProviderDisplay {
  final ProviderDetails details;
  final List<ProviderAuthMethod> authMethods;
  final bool isConnected;

  const OcProviderDisplay({
    required this.details,
    this.authMethods = const [],
    this.isConnected = false,
  });

  bool get hasApiKeyMethod => authMethods.any((m) => m.isApiKey);
  bool get hasOAuthMethod => authMethods.any((m) => m.isOAuth);
}

/// Fetches all providers merged with auth methods and connection status.
final ocProvidersDisplayProvider =
    FutureProvider.family<List<OcProviderDisplay>, String?>((
      ref,
      projectPath,
    ) async {
      final bridge = ref.read(bridgeServiceProvider);
      final info = await bridge.listAllProviders(projectPath: projectPath);
      final authMap = await bridge.getProviderAuth(projectPath: projectPath);

      return info.all.map((p) {
        return OcProviderDisplay(
          details: p,
          authMethods: authMap[p.id] ?? const [],
          isConnected: info.isConnected(p.id),
        );
      }).toList();
    });
