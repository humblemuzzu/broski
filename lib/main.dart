import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'screens/root_screen.dart';
import 'theme/theme.dart';

void main() {
  runApp(const ProviderScope(child: BroskiApp()));
}

class BroskiApp extends StatelessWidget {
  const BroskiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Broski',
      debugShowCheckedModeBanner: false,
      theme: BroskiTheme.light(),
      darkTheme: BroskiTheme.dark(),
      themeMode: ThemeMode.system,
      home: const RootScreen(),
    );
  }
}
