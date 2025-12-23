import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/connection_provider.dart';

class DeviceManagerScreen extends ConsumerWidget {
  const DeviceManagerScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connection = ref.watch(connectionProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Devices')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (connection.connection != null) ...[
            ListTile(
              title: const Text('Local IP'),
              subtitle: Text(connection.connection?.localIP ?? 'Unknown'),
            ),
            ListTile(
              title: const Text('Tailscale IP'),
              subtitle: Text(connection.connection?.tailscaleIP ?? 'Unknown'),
            ),
            ListTile(
              title: const Text('Port'),
              subtitle: Text('${connection.connection?.port ?? '-'}'),
            ),
          ] else ...[
            const Text('No paired device yet.'),
          ],
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: () =>
                ref.read(connectionProvider.notifier).clearConnection(),
            child: const Text('Unpair device'),
          ),
        ],
      ),
    );
  }
}
