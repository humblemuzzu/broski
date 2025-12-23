import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/connection_provider.dart';
import '../theme/colors.dart';

class ConnectionLostScreen extends ConsumerWidget {
  const ConnectionLostScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connection = ref.watch(connectionProvider);

    return Scaffold(
      backgroundColor: BroskiColors.midnight,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.wifi_off, size: 48, color: BroskiColors.ember),
              const SizedBox(height: 16),
              Text('Connection lost', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(
                'Unable to reach your Mac. Make sure broski-bridge is running and you are on the same network or Tailscale.',
                style: Theme.of(context).textTheme.bodySmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: connection.connection == null
                    ? null
                    : () => ref.read(connectionProvider.notifier).connect(connection.connection!),
                child: const Text('Retry connection'),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () => ref.read(connectionProvider.notifier).clearConnection(),
                child: const Text('Scan new QR'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
