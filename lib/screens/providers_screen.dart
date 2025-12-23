import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/service_providers.dart';

class ProvidersScreen extends ConsumerStatefulWidget {
  const ProvidersScreen({super.key});

  @override
  ConsumerState<ProvidersScreen> createState() => _ProvidersScreenState();
}

class _ProvidersScreenState extends ConsumerState<ProvidersScreen> {
  late Future<List<Map<String, dynamic>>> _dataFuture;

  @override
  void initState() {
    super.initState();
    _dataFuture = _loadData();
  }

  Future<List<Map<String, dynamic>>> _loadData() async {
    final bridge = ref.read(bridgeServiceProvider);
    final results = await Future.wait([
      bridge.listProviders(),
      bridge.getConfig(),
    ]);
    return results.cast<Map<String, dynamic>>();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Providers')),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: _dataFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(
              child: Text('Failed to load providers: ${snapshot.error}'),
            );
          }

          final data = snapshot.data ?? const [{}, {}];
          final providersData = data.isNotEmpty ? data[0] : const {};
          final config = data.length > 1 ? data[1] : const {};
          final currentModel = config['model'] as String? ?? 'Unknown';

          final providers = providersData['providers'] as List<dynamic>? ?? [];

          if (providers.isEmpty) {
            return const Center(child: Text('No providers configured yet.'));
          }

          return ListView.separated(
            padding: const EdgeInsets.all(20),
            itemCount: providers.length + 1,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              if (index == 0) {
                return ListTile(
                  tileColor: Theme.of(context).colorScheme.surface,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  title: const Text('Current model'),
                  subtitle: Text(currentModel),
                );
              }

              final provider = providers[index - 1] as Map<String, dynamic>;
              final id = provider['id'] as String? ?? 'provider';
              final name = provider['name'] as String? ?? id;
              final models =
                  provider['models'] as Map<String, dynamic>? ?? const {};

              return ListTile(
                tileColor: Theme.of(context).colorScheme.surface,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                title: Text(name),
                subtitle: Text('${models.length} models available'),
                trailing: IconButton(
                  icon: const Icon(Icons.tune),
                  onPressed: () => _showModels(context, id, name, models),
                ),
              );
            },
          );
        },
      ),
    );
  }

  void _showModels(
    BuildContext context,
    String providerId,
    String providerName,
    Map<String, dynamic> models,
  ) {
    showModalBottomSheet(
      context: context,
      builder: (_) {
        return ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(providerName, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            for (final entry in models.entries)
              ListTile(
                title: Text(entry.value['name'] as String? ?? entry.key),
                subtitle: Text(entry.key),
                onTap: () => _selectModel(context, providerId, entry.key),
              ),
          ],
        );
      },
    );
  }

  Future<void> _selectModel(
    BuildContext context,
    String providerId,
    String modelId,
  ) async {
    final bridge = ref.read(bridgeServiceProvider);
    final model = '$providerId/$modelId';
    await bridge.setModel(model);

    if (!mounted) return;
    Navigator.pop(context);
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('Switched to $model')));

    setState(() {
      _dataFuture = _loadData();
    });
  }
}
