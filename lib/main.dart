import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers/theme_provider.dart';
import 'screens/root_screen.dart';
import 'services/notification_service.dart';
import 'services/storage_service.dart';
import 'theme/theme.dart';

void main() {
  // REQUIRED: must be called before any plugin or platform channel usage
  WidgetsFlutterBinding.ensureInitialized();

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

  runApp(const ProviderScope(child: BroskiApp()));
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeState = ref.watch(themeProvider);

    // Show loading indicator while theme is loading
    if (themeState.isLoading) {
      return MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BroskiTheme.black(),
        home: const Scaffold(body: Center(child: CircularProgressIndicator())),
      );
    }

    return MaterialApp(
      title: 'Broski',
      debugShowCheckedModeBanner: false,
      theme: BroskiTheme.fromThemeId(themeState.themeId),
      darkTheme: BroskiTheme.fromThemeId(themeState.themeId),
      themeMode: ThemeMode.dark, // Always use dark mode
      home: const RootScreen(),
    );
  }
}
