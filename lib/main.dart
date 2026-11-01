import 'dart:async';
import 'dart:ui';

import 'package:broski/agent/agent_providers.dart';
import 'package:broski/app/app_messenger.dart';
import 'package:broski/providers/font_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/theme_provider.dart';
import 'package:broski/screens/root_screen.dart';
import 'package:broski/services/notification_service.dart';
import 'package:broski/services/notifications/local_run_done_notifier.dart';
import 'package:broski/services/storage/legacy_connection_purge.dart';
import 'package:broski/services/storage_service.dart';
import 'package:broski/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  // REQUIRED: must be called before any plugin or platform channel usage
  WidgetsFlutterBinding.ensureInitialized();

  // Lock orientation to portrait only on all devices.
  // iPad also gets portraitDown (upside-down) since users hold tablets both ways.
  // This is the Flutter-side enforcement — Info.plist has the native-side lock.
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Global error handlers — prevent unhandled exceptions from crashing the app
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    // In release mode, silently log instead of crashing
    debugPrint('FlutterError: ${details.exceptionAsString()}');
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    debugPrint('PlatformError: $error\n$stack');
    return true; // Handled — don't crash
  };

  // Pre-warm caches in the background for instant perceived load
  _prewarmCaches();
  unawaited(purgeLegacyConnectionSecrets());

  runApp(
    ProviderScope(
      overrides: [
        runDoneNotifierProvider.overrideWith(
          (ref) => LocalRunDoneNotifier(
            machine: () => ref.read(machinesProvider).selectedId,
          ),
        ),
      ],
      child: const BroskiApp(),
    ),
  );
}

/// Pre-load cached data from secure storage into memory.
/// This runs in the background so the first cache read is instant.
///
/// NOTE: Notification permissions are NOT requested here — they are deferred
/// until the user interacts with a feature that needs them (Apple requires
/// contextual permission requests).
void _prewarmCaches() {
  Future.microtask(() async {
    final storage = StorageService();

    // Load cached data into memory (L2 → L1 promotion)
    // These calls will populate the in-memory cache
    await Future.wait([
      storage.getCachedProjects(),
      storage.getCachedSessions(),
    ]);

    // Initialize notification plugin (registers channels, etc.)
    // but do NOT request permissions yet — that happens in-context.
    await NotificationService.instance.initialize();
  });
}

class BroskiApp extends ConsumerWidget {
  const BroskiApp({super.key});

  /// MaterialApp builder — iPad layout is now handled per-screen by
  /// [AdaptiveContainer] and [Responsive] utilities. This builder is a
  /// simple pass-through on both iPhone and iPad.
  ///
  /// iPhone: no change (was already a no-op).
  /// iPad: no longer constrains to 600pt — each screen owns its own layout.
  static Widget _tabletAwareBuilder(BuildContext context, Widget? child) {
    if (child == null) return const SizedBox.shrink();
    return child;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeState = ref.watch(themeProvider);
    final fontState = ref.watch(fontProvider);

    // Show loading indicator while theme or fonts are loading
    if (themeState.isLoading || fontState.isLoading) {
      return MaterialApp(
        debugShowCheckedModeBanner: false,
        scaffoldMessengerKey: appMessengerKey,
        theme: BroskiTheme.black(),
        builder: _tabletAwareBuilder,
        home: const Scaffold(body: Center(child: CircularProgressIndicator())),
      );
    }

    // AppTypography statics are synced atomically inside FontNotifier
    // (setUIFont / setCodeFont / _loadFonts) so we don't need to do it here.
    final uiFont = fontState.preference.uiFont;

    // Build once — ThemeMode.dark means only darkTheme is used,
    // but we pass it to both slots for consistency.
    final appTheme = BroskiTheme.fromThemeId(
      themeState.themeId,
      uiFontFamily: uiFont.fontFamily,
      uiFontIsAsset: uiFont.isAsset,
    );

    return MaterialApp(
      title: 'Broski',
      debugShowCheckedModeBanner: false,
      scaffoldMessengerKey: appMessengerKey,
      theme: appTheme,
      darkTheme: appTheme,
      themeMode: ThemeMode.dark, // Always use dark mode
      builder: _tabletAwareBuilder,
      home: const RootScreen(),
    );
  }
}
