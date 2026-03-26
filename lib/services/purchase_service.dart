import 'dart:io';

import 'package:purchases_flutter/purchases_flutter.dart';

import '../config/app_config.dart';

class PurchaseService {
  bool _configured = false;
  String? _configuredAppUserId;

  Future<void> configure({required String appUserId}) async {
    if (_configured && _configuredAppUserId == appUserId) return;

    final apiKey = Platform.isIOS
        ? AppConfig.revenueCatIosApiKey()
        : AppConfig.revenueCatAndroidApiKey();
    if (apiKey.isEmpty) {
      throw Exception('Missing RevenueCat API key for this platform');
    }

    await Purchases.setLogLevel(LogLevel.info);
    await Purchases.configure(
      PurchasesConfiguration(apiKey)..appUserID = appUserId,
    );

    _configured = true;
    _configuredAppUserId = appUserId;
  }

  Future<void> logOut() async {
    if (!_configured) return;
    try {
      await Purchases.logOut();
    } catch (_) {}
    _configured = false;
    _configuredAppUserId = null;
  }

  Future<CustomerInfo> getCustomerInfo() => Purchases.getCustomerInfo();

  Future<Offerings> getOfferings() => Purchases.getOfferings();

  Future<CustomerInfo> purchaseMonthly() async {
    final offerings = await getOfferings();
    final current = offerings.current;
    if (current == null) {
      throw Exception('No RevenueCat offering configured');
    }

    Package? monthly;
    for (final pkg in current.availablePackages) {
      final productId = pkg.storeProduct.identifier;
      if (productId == AppConfig.revenueCatProductIdMonthly) {
        monthly = pkg;
        break;
      }
    }

    monthly ??= current.availablePackages.isNotEmpty
        ? current.availablePackages.first
        : null;

    if (monthly == null) {
      throw Exception('No purchasable package found');
    }

    // In v9.x, purchase(PurchaseParams) returns PurchaseResult which contains customerInfo
    final result = await Purchases.purchase(PurchaseParams.package(monthly));
    return result.customerInfo;
  }

  Future<CustomerInfo> restorePurchases() => Purchases.restorePurchases();

  bool isEntitled(CustomerInfo info) {
    final key = AppConfig.revenueCatEntitlementId;
    return info.entitlements.active.containsKey(key);
  }
}
