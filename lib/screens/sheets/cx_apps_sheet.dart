import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/codex_app_info.dart';
import '../../providers/service_providers.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'package:broski/theme/app_icons.dart';
import '../../utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';

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
  StreamSubscription<List<Map<String, dynamic>>>? _appsUpdatedSub;

  @override
  void initState() {
    super.initState();
    _appsUpdatedSub = ref
        .read(bridgeServiceProvider)
        .codexAppsUpdatedMessages
        .listen((_) {
          if (!mounted) return;
          _load(forceRefetch: true);
        });
    _load();
  }

  @override
  void dispose() {
    _appsUpdatedSub?.cancel();
    super.dispose();
  }

  Future<void> _load({bool forceRefetch = false}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final data = await bridge.cxListApps(forceRefetch: forceRefetch);
      if (!mounted) return;
      setState(() {
        _apps = data.map(CodexAppInfo.fromJson).toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = humanizeError(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Error: $_error', style: TextStyle(color: ocTheme.error)),
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
          final subtitleLines = <String>[];
          final description = app.description?.trim() ?? '';
          if (description.isNotEmpty) {
            subtitleLines.add(description);
          }
          final developer = app.branding?['developer']?.toString().trim() ?? '';
          final category = app.branding?['category']?.toString().trim() ?? '';
          final version = app.appMetadata?['version']?.toString().trim() ?? '';
          final metaLine = [
            developer,
            category,
            version,
          ].where((v) => v.isNotEmpty).join(' · ');
          if (metaLine.isNotEmpty) {
            subtitleLines.add(metaLine);
          }

          return ListTile(
            dense: true,
            leading: app.logoUrl != null
                ? ClipRRect(
                    borderRadius: Radii.brSm,
                    child: Image.network(
                      app.logoUrl!,
                      width: 28,
                      height: 28,
                      errorBuilder: (_, __, ___) =>
                          const Icon(AppIcons.extension_, size: 24),
                    ),
                  )
                : const Icon(AppIcons.extension_, size: 24),
            title: Text(
              app.name,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: subtitleLines.isEmpty
                ? null
                : Text(
                    subtitleLines.join('\n'),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
            trailing: app.installUrl != null
                ? const Icon(AppIcons.openExternal, size: 18)
                : app.isAccessible
                ? Icon(AppIcons.checkCircle, size: 18, color: ocTheme.primary)
                : const Icon(AppIcons.lock, size: 18),
            onTap: app.installUrl != null
                ? () {
                    // Could open URL in browser
                    showInfo(context, 'Install: ${app.installUrl}');
                  }
                : null,
          );
        },
      ),
    );
  }
}
