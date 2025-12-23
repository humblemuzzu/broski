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
    final themeMode = ref.watch(themeProvider);

    return MaterialApp(
      title: 'Broski',
      debugShowCheckedModeBanner: false,
      theme: BroskiTheme.light(),
      darkTheme: themeMode == AppThemeMode.black
          ? BroskiTheme.black()
          : BroskiTheme.dark(),
      themeMode:
          ThemeMode.dark, // Always use dark mode (switches between dark/black)
      home: const RootScreen(),
    );
  }
}
