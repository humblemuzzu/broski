import 'dart:convert';

import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/storage_service.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Fetches the Codex config with cache-on-success / offline fallback.
Future<Map<String, dynamic>> _fetchCodexConfig(WidgetRef ref) async {
  final storage = ref.read(storageServiceProvider);
  final connection = ref.read(connectionProvider);

  if (connection.isOfflineMode) {
    return await storage.getCachedCodexConfig() ?? const {};
  }

  try {
    final config = await ref.read(bridgeServiceProvider).cxReadConfig();
    if (config.isNotEmpty) {
      await storage.cacheCodexConfig(config);
    }
    return config;
  } catch (_) {
    return await storage.getCachedCodexConfig() ?? const {};
  }
}

/// Shows the Codex config (read-only JSON) sheet. Extracted from chat_screen.dart.
void showCodexConfigSheet(BuildContext context, WidgetRef ref) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Codex Config',
    initialSize: 0.6,
    child: FutureBuilder<Map<String, dynamic>>(
      future: _fetchCodexConfig(ref),
      builder: (context, snapshot) {
        final loading = snapshot.connectionState == ConnectionState.waiting;
        final config = snapshot.data ?? const <String, dynamic>{};
        final configJson = const JsonEncoder.withIndent('  ').convert(config);
        return Padding(
          padding: Insets.screenH,
          child: loading
              ? const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: CircularProgressIndicator()),
                )
              : snapshot.hasError
              ? Padding(
                  padding: Insets.screenV,
                  child: Text(
                    'Failed to read config: ${humanizeError(snapshot.error ?? "Unknown error")}',
                    style: AppTypography.label(color: theme.textMuted),
                  ),
                )
              : SingleChildScrollView(
                  child: SelectableText(
                    configJson,
                    style: AppTypography.codeSmall(color: theme.textMuted),
                  ),
                ),
        );
      },
    ),
  );
}
