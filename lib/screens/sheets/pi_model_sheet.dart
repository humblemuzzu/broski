import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/pi.dart';
import '../../providers/chat_provider.dart';
import '../../providers/pi_provider.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the Pi model picker sheet. Extracted from chat_screen.dart.
void showPiModelSheet(BuildContext context) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Pi Model',
    initialSize: 0.6,
    child: Consumer(
      builder: (context, ref, _) {
        final chatState = ref.watch(chatSessionProvider);
        final cwd = chatState.piCwd;
        final modelsAsync = ref.watch(piModelsProvider(cwd));
        final currentModel = ref.watch(
          chatSessionProvider.select((s) => s.piModel),
        );
        return modelsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Padding(
            padding: Insets.cardLg,
            child: Text(
              'Failed to load models: $e',
              style: TextStyle(color: theme.error),
            ),
          ),
          data: (models) {
            if (models.isEmpty) {
              return Padding(
                padding: Insets.cardLg,
                child: Text(
                  'No models available',
                  style: TextStyle(color: theme.textMuted),
                ),
              );
            }
            // Group models by provider
            final grouped = <String, List<PiModel>>{};
            for (final model in models) {
              grouped.putIfAbsent(model.provider, () => []).add(model);
            }
            // Use Column (not ListView) — DetailSheet's SingleChildScrollView handles scrolling
            return Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final entry in grouped.entries) ...[
                    Padding(
                      padding: const EdgeInsets.only(top: 12, bottom: 8),
                      child: Text(
                        entry.key.toUpperCase(),
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: theme.textMuted,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ),
                    for (final model in entry.value)
                      _buildPiModelTile(context, ref, model, currentModel, theme),
                  ],
                ],
              ),
            );
          },
        );
      },
    ),
  );
}

Widget _buildPiModelTile(
  BuildContext context,
  WidgetRef ref,
  PiModel model,
  String? currentModel,
  OpenCodeTheme theme,
) {
  final isSelected =
      currentModel == model.id || currentModel == model.modelRef;
  return ListTile(
    dense: true,
    contentPadding: EdgeInsets.zero,
    leading: Icon(
      isSelected ? AppIcons.radioChecked : AppIcons.radioUnchecked,
      size: 18,
      color: isSelected ? theme.accent : theme.textMuted,
    ),
    title: Row(
      children: [
        Expanded(
          child: Text(
            model.name.isNotEmpty ? model.name : model.id,
            style: AppTypography.bodySmall(color: theme.text),
          ),
        ),
        if (model.reasoning)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
            decoration: BoxDecoration(
              color: theme.warning.withValues(alpha: 0.12),
              borderRadius: Radii.brXs,
            ),
            child: Text(
              'Thinking',
              style: TextStyle(
                color: theme.warning,
                fontSize: 9,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        if (model.supportsImages) ...[
          const SizedBox(width: 4),
          Icon(AppIcons.image, size: 12, color: theme.info),
        ],
      ],
    ),
    subtitle: Text(
      '${model.provider} • ${_formatContextWindow(model.contextWindow)}'
      '${model.cost.input > 0 ? ' • \$${model.cost.input.toStringAsFixed(2)}/\$${model.cost.output.toStringAsFixed(2)} per MTok' : ''}',
      style: AppTypography.label(color: theme.textMuted),
    ),
    onTap: () async {
      Navigator.pop(context);
      final piBridge = ref.read(piBridgeServiceProvider);
      final chatState = ref.read(chatSessionProvider);
      try {
        await piBridge.setModel(
          provider: model.provider,
          modelId: model.id,
          projectPath: chatState.piCwd,
        );
        ref
            .read(chatSessionProvider.notifier)
            .setPiModel(model.modelRef, modelData: model);
      } catch (e) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed to set model: $e')));
      }
    },
  );
}

String _formatContextWindow(int tokens) {
  if (tokens >= 1000000) return '${(tokens / 1000000).toStringAsFixed(0)}M';
  if (tokens >= 1000) return '${(tokens / 1000).toStringAsFixed(0)}K';
  return '$tokens';
}
