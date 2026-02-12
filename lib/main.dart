import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers/theme_provider.dart';
import 'screens/root_screen.dart';
import 'services/notification_service.dart';
import 'services/storage_service.dart';
import 'theme/theme.dart';

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

  /// Max content width on iPad/tablet. Content is centered within this width
  /// with dark side margins. Wider than any iPhone (430pt max) so the phone
  /// code path never triggers. Narrower than any iPad (744pt min) so the
  /// tablet path always triggers on iPad.
  static const double _kTabletMaxWidth = 600.0;

  /// MaterialApp builder that adapts layout for iPad.
  ///
  /// iPhone (width ≤ 600pt): returns [child] UNMODIFIED.
  ///   → Same widget tree, zero wrapper widgets, zero pixel difference.
  ///
  /// iPad (width > 600pt): centers content at 600pt with dark side margins.
  ///   → Overrides MediaQuery.size.width so all descendants (Positioned,
  ///     LayoutBuilder, MediaQuery.of, etc.) see phone-like dimensions.
  ///   → Preserves padding, viewInsets, viewPadding, devicePixelRatio, etc.
  ///   → Clips overflow so nothing bleeds into the side margins.
  static Widget _tabletAwareBuilder(BuildContext context, Widget? child) {
    if (child == null) return const SizedBox.shrink();

    final mq = MediaQuery.of(context);

    // ── iPhone / compact screens: ZERO changes ──
    if (mq.size.width <= _kTabletMaxWidth) return child;

    // ── iPad / wide screens: center content at phone-comfortable width ──
    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: ClipRect(
          child: SizedBox(
            width: _kTabletMaxWidth,
            child: MediaQuery(
              data: mq.copyWith(
                size: Size(_kTabletMaxWidth, mq.size.height),
              ),
              child: child,
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeState = ref.watch(themeProvider);

    // Show loading indicator while theme is loading
    if (themeState.isLoading) {
      return MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BroskiTheme.black(),
        builder: _tabletAwareBuilder,
        home: const Scaffold(body: Center(child: CircularProgressIndicator())),
      );
    }

    return MaterialApp(
      title: 'Broski',
      debugShowCheckedModeBanner: false,
      theme: BroskiTheme.fromThemeId(themeState.themeId),
      darkTheme: BroskiTheme.fromThemeId(themeState.themeId),
      themeMode: ThemeMode.dark, // Always use dark mode
      builder: _tabletAwareBuilder,
      home: const RootScreen(),
    );
  }
}
