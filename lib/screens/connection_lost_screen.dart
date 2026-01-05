import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/connection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';

class ConnectionLostScreen extends ConsumerStatefulWidget {
  const ConnectionLostScreen({super.key});

  @override
  ConsumerState<ConnectionLostScreen> createState() =>
      _ConnectionLostScreenState();
}

class _ConnectionLostScreenState extends ConsumerState<ConnectionLostScreen> {
  bool _hasCachedData = false;
  bool _checkingCache = true;

  @override
  void initState() {
    super.initState();
    _checkCachedData();
  }

  Future<void> _checkCachedData() async {
    final storage = ref.read(storageServiceProvider);
    final hasData = await storage.hasCachedData();
    if (mounted) {
      setState(() {
        _hasCachedData = hasData;
        _checkingCache = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: ocTheme.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.wifi_off, size: 48, color: ocTheme.error),
              const SizedBox(height: 16),
              Text('Connection lost', style: theme.textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(
                'Unable to reach your Mac. Make sure broski-bridge is running and you are on the same network or Tailscale.',
                style: theme.textTheme.bodySmall,
                textAlign: TextAlign.center,
              ),
              if (connection.error != null) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: ocTheme.error.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    'Error: ${connection.error}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: ocTheme.error,
                      fontFamily: 'monospace',
                      fontSize: 11,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: connection.connection == null
                    ? null
                    : () => ref
                          .read(connectionProvider.notifier)
                          .connect(connection.connection!),
                child: const Text('Retry connection'),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () =>
                    ref.read(connectionProvider.notifier).clearConnection(),
                child: const Text('Scan new QR'),
              ),
              // Browse Offline button - always visible for UI preview
              const SizedBox(height: 24),
              Divider(color: ocTheme.borderSubtle),
              const SizedBox(height: 16),
              Text(
                _hasCachedData
                    ? 'You can browse cached data offline'
                    : 'Browse the app in read-only mode',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: ocTheme.textMuted,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _checkingCache
                      ? null
                      : () {
                          ref
                              .read(connectionProvider.notifier)
                              .enterOfflineMode();
                        },
                  icon: Icon(
                    _hasCachedData
                        ? Icons.cloud_off_rounded
                        : Icons.visibility_rounded,
                    size: 20,
                  ),
                  label: Text(_hasCachedData ? 'Browse Offline' : 'Preview UI'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: ocTheme.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
