import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers/theme_provider.dart';
import 'screens/root_screen.dart';
import 'theme/theme.dart';

void main() {
  runApp(const ProviderScope(child: BroskiApp()));
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
