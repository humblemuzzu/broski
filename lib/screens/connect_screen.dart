import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/connection_provider.dart';
import '../theme/opencode_theme.dart';

class ConnectScreen extends ConsumerWidget {
  const ConnectScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(connectionProvider);
    final ocTheme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: ocTheme.background,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const CircularProgressIndicator(),
                const SizedBox(height: 16),
                Text(
                  'Connecting to your Mac...',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                if (state.connection != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    '${state.connection!.localIP}:${state.connection!.port}',
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: ocTheme.textMuted),
                  ),
                ],
                if (state.error != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    state.error!,
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: ocTheme.error),
                  ),
                ],
                // Escape hatch: allow user to scan a new QR if connection is stale
                const SizedBox(height: 32),
                TextButton(
                  onPressed: () =>
                      ref.read(connectionProvider.notifier).clearConnection(),
                  child: Text(
                    'Scan new QR instead',
                    style: TextStyle(color: ocTheme.textMuted),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
