import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/connection_provider.dart';
import 'connect_screen.dart';
import 'connection_lost_screen.dart';
import 'main_shell.dart';
import 'scan_screen.dart';

class RootScreen extends ConsumerWidget {
  const RootScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(connectionProvider);

    if (state.isConnecting) {
      return const ConnectScreen();
    }

    if (!state.isConnected) {
      if (state.connection != null) {
        return const ConnectionLostScreen();
      }
      return const ScanScreen();
    }

    return const MainShell();
  }
}
