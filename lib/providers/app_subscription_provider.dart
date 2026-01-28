import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:purchases_flutter/purchases_flutter.dart';
import 'package:flutter/services.dart';

import '../config/app_config.dart';
import '../services/convex_service.dart';
import '../services/purchase_service.dart';
import '../services/storage_service.dart';
import 'app_auth_provider.dart';
import 'service_providers.dart';

class AppSubscriptionState {
  const AppSubscriptionState({
    this.isLoading = false,
    this.isConfigured = false,
    this.entitled = false,
    this.monthlyPriceText,
    this.managementUrl,
    this.error,
  });

  final bool isLoading;
  final bool isConfigured;
  final bool entitled;
  final String? monthlyPriceText;
  final String? managementUrl;
  final String? error;

  AppSubscriptionState copyWith({
    bool? isLoading,
    bool? isConfigured,
    bool? entitled,
    String? monthlyPriceText,
    String? managementUrl,
    String? error,
  }) {
    return AppSubscriptionState(
      isLoading: isLoading ?? this.isLoading,
      isConfigured: isConfigured ?? this.isConfigured,
      entitled: entitled ?? this.entitled,
      monthlyPriceText: monthlyPriceText ?? this.monthlyPriceText,
      managementUrl: managementUrl ?? this.managementUrl,
      error: error,
    );
  }
}

class AppSubscriptionNotifier extends StateNotifier<AppSubscriptionState> {
  AppSubscriptionNotifier(this._ref) : super(const AppSubscriptionState());

  final Ref _ref;

  PurchaseService get _purchases => _ref.read(purchaseServiceProvider);
  ConvexService get _convex => _ref.read(convexServiceProvider);
  StorageService get _storage => _ref.read(storageServiceProvider);

  Future<void> configureAndRefresh() async {
    final auth = _ref.read(appAuthProvider);
    final user = auth.user;
    if (user == null) return;

    state = state.copyWith(isLoading: true, error: null);
    try {
      await _purchases.configure(appUserId: user.appUserId);
      final info = await _purchases.getCustomerInfo();
      final entitled = _purchases.isEntitled(info);

      final offerings = await _purchases.getOfferings();
      final priceText = _findMonthlyPrice(offerings);

      state = state.copyWith(
        isLoading: false,
        isConfigured: true,
        entitled: entitled,
        monthlyPriceText: priceText,
        managementUrl: info.managementURL,
      );

      await _syncToConvex(info, entitled: entitled);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  Future<void> purchaseMonthly() async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final info = await _purchases.purchaseMonthly();
      final entitled = _purchases.isEntitled(info);
      state = state.copyWith(
        isLoading: false,
        entitled: entitled,
        managementUrl: info.managementURL,
      );
      await _syncToConvex(info, entitled: entitled);
    } on PlatformException catch (e) {
      state = state.copyWith(isLoading: false, error: e.message ?? e.code);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  Future<void> restorePurchases() async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final info = await _purchases.restorePurchases();
      final entitled = _purchases.isEntitled(info);
      state = state.copyWith(
        isLoading: false,
        entitled: entitled,
        managementUrl: info.managementURL,
      );
      await _syncToConvex(info, entitled: entitled);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  Future<void> signOut() async {
    await _purchases.logOut();
    state = const AppSubscriptionState();
  }

  void seedEntitlement(bool entitled) {
    state = state.copyWith(entitled: entitled);
  }

  String? _findMonthlyPrice(Offerings offerings) {
    final current = offerings.current;
    if (current == null) return null;

    for (final pkg in current.availablePackages) {
      if (pkg.storeProduct.identifier == AppConfig.revenueCatProductIdMonthly) {
        return pkg.storeProduct.priceString;
      }
    }
    if (current.availablePackages.isNotEmpty) {
      return current.availablePackages.first.storeProduct.priceString;
    }
    return null;
  }

  Future<void> _syncToConvex(CustomerInfo info, {required bool entitled}) async {
    final token = await _storage.getAppSessionToken();
    if (token == null) return;

    final active = info.entitlements.active[AppConfig.revenueCatEntitlementId];
    final expiresAtMs = active?.expirationDate != null
        ? DateTime.tryParse(active!.expirationDate!)?.millisecondsSinceEpoch
        : null;
    final productId = active?.productIdentifier;
    final originalAppUserId = info.originalAppUserId;

    final status = entitled ? 'active' : 'inactive';

    try {
      await _convex.syncRevenueCatFromClient(
        sessionToken: token,
        entitlementActive: entitled,
        status: status,
        productId: productId,
        expiresAtMs: expiresAtMs,
        originalAppUserId: originalAppUserId,
      );
    } catch (_) {
      // Best effort; webhook is canonical.
    }
  }
}

final appSubscriptionProvider =
    StateNotifierProvider<AppSubscriptionNotifier, AppSubscriptionState>((ref) {
  final notifier = AppSubscriptionNotifier(ref);

  ref.listen(appAuthProvider, (prev, next) {
    if ((prev?.user?.appUserId) != (next.user?.appUserId)) {
      if (next.user == null) {
        notifier.signOut();
      } else {
        notifier.seedEntitlement(next.user!.isEntitled);
        notifier.configureAndRefresh();
      }
    }
  });

  return notifier;
});
