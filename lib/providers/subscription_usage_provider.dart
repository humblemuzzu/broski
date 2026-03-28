import 'package:broski/models/subscription_usage.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// State for subscription usage tracking.
class SubscriptionUsageState {
  final SubscriptionUsage? usage;
  final bool isLoading;
  final String? error;

  const SubscriptionUsageState({
    this.usage,
    this.isLoading = false,
    this.error,
  });

  SubscriptionUsageState copyWith({
    SubscriptionUsage? usage,
    bool? isLoading,
    String? error,
  }) {
    return SubscriptionUsageState(
      usage: usage ?? this.usage,
      isLoading: isLoading ?? this.isLoading,
      error: error,
    );
  }
}

/// Provider for managing subscription usage data.
///
/// This provider is designed to be used on-demand:
/// - Data is NOT fetched automatically on app start
/// - Data is fetched when user opens the Subscription Usage screen
/// - Data is refreshed when user pulls to refresh
class SubscriptionUsageNotifier extends StateNotifier<SubscriptionUsageState> {
  SubscriptionUsageNotifier(this._ref) : super(const SubscriptionUsageState());

  final Ref _ref;

  /// Fetch usage for all providers.
  ///
  /// This should be called when the user opens the Subscription Usage screen.
  Future<void> refresh() async {
    if (state.isLoading) return;

    state = state.copyWith(isLoading: true, error: null);

    try {
      final bridge = _ref.read(bridgeServiceProvider);
      final usage = await bridge.getSubscriptionUsage();

      state = SubscriptionUsageState(usage: usage, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: humanizeError(e));
    }
  }

  /// Refresh a single provider's usage.
  Future<void> refreshProvider(String providerId) async {
    if (state.isLoading) return;

    state = state.copyWith(isLoading: true, error: null);

    try {
      final bridge = _ref.read(bridgeServiceProvider);
      final providerUsage = await bridge.getProviderUsage(providerId);

      // Update just this provider in the list
      if (state.usage != null) {
        final updatedProviders = state.usage!.providers.map((p) {
          if (p.providerId == providerId) return providerUsage;
          return p;
        }).toList();

        // Add if not exists
        final exists = updatedProviders.any((p) => p.providerId == providerId);
        if (!exists) {
          updatedProviders.add(providerUsage);
        }

        state = SubscriptionUsageState(
          usage: SubscriptionUsage(
            providers: updatedProviders,
            fetchedAt: DateTime.now(),
          ),
          isLoading: false,
        );
      } else {
        // First fetch - create new usage object
        state = SubscriptionUsageState(
          usage: SubscriptionUsage(
            providers: [providerUsage],
            fetchedAt: DateTime.now(),
          ),
          isLoading: false,
        );
      }
    } catch (e) {
      state = state.copyWith(isLoading: false, error: humanizeError(e));
    }
  }

  /// Clear cached usage data.
  void clear() {
    state = const SubscriptionUsageState();
  }
}

/// Provider for subscription usage state.
final subscriptionUsageProvider =
    StateNotifierProvider<SubscriptionUsageNotifier, SubscriptionUsageState>(
      (ref) => SubscriptionUsageNotifier(ref),
    );
