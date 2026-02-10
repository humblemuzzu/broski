
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/codex_app_info.dart';
import '../../providers/service_providers.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../../theme/design_tokens.dart';
import 'package:broski/theme/app_icons.dart';
/// Bottom sheet to browse Codex apps/connectors marketplace.
class CxAppsSheet extends ConsumerStatefulWidget {
  const CxAppsSheet({super.key});
  static void show(BuildContext context) {
    DetailSheet.show(
      context: context,
      title: 'Apps & Connectors',
      initialSize: 0.55,
      child: const CxAppsSheet(),
    );
  }
  @override
  ConsumerState<CxAppsSheet> createState() => _CxAppsSheetState();
}
class _CxAppsSheetState extends ConsumerState<CxAppsSheet> {
  List<CodexAppInfo>? _apps;
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }
  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final data = await bridge.cxListApps();
      if (!mounted) return;
      setState(() {
        _apps = data.map(CodexAppInfo.fromJson).toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Error: $_error', style: TextStyle(color: theme.colorScheme.error)),
            SizedBox(height: Spacing.md),
            TextButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }
    final apps = _apps ?? [];
    if (apps.isEmpty) {
      return const Center(child: Text('No apps available.'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: Insets.listItemDense,
        itemCount: apps.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final app = apps[index];
          return ListTile(
            dense: true,
            leading: app.logoUrl != null
                ? ClipRRect(
                    borderRadius: Radii.brSm,
                    child: Image.network(
                      app.logoUrl!,
                      width: 28,
                      height: 28,
                      errorBuilder: (_, __, ___) => const Icon(AppIcons.extension_, size: 24),
                    ),
                  )
                : const Icon(AppIcons.extension_, size: 24),
            title: Text(app.name, style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: app.description != null && app.description!.isNotEmpty
                ? Text(app.description!, maxLines: 2, overflow: TextOverflow.ellipsis)
                : null,
            trailing: app.installUrl != null
                ? const Icon(AppIcons.openExternal, size: 18)
                : app.isAccessible
                    ? Icon(AppIcons.checkCircle, size: 18, color: theme.colorScheme.primary)
                    : const Icon(AppIcons.lock, size: 18),
            onTap: app.installUrl != null
                ? () {
                    // Could open URL in browser
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Install: ${app.installUrl}')),
                    );
                  }
                : null,
          );
        },
      ),
    );
  }
}
