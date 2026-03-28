import 'package:broski/models/claude_code.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the Claude Code model picker sheet. Extracted from chat_screen.dart.
///
/// [ccSessionCwd], [ccSessionModel], [ccDraftCwd], [ccDraftModel] correspond
/// to `widget.ccSession?.cwd`, `widget.ccSession?.model`,
/// `widget.ccDraftCwd`, `widget.ccDraftModel` from the ChatScreen widget.
void showCcModelSheet(
  BuildContext context, {
  String? ccSessionCwd,
  String? ccSessionModel,
  String? ccDraftCwd,
  String? ccDraftModel,
}) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Claude Code Model',
    initialSize: 0.5,
    child: Consumer(
      builder: (context, ref, _) {
        final chatState = ref.watch(chatSessionProvider);
        final init = chatState.ccInit;
        final cwd = chatState.ccCwd ?? ccSessionCwd ?? ccDraftCwd;
        final supportedModelsAsync = ref.watch(ccSupportedModelsProvider(cwd));
        final configAsync = ref.watch(ccConfigProvider);
        final config =
            configAsync.valueOrNull ??
            ClaudeCodeConfig(
              permissionMode: ClaudeCodePermissionMode.defaultMode,
              allowedTools: init?.tools ?? const [],
              disallowedTools: const [],
              model: init?.model,
            );
        // null = default/recommended (SDK picks latest)
        final current =
            config.model ??
            chatState.ccModel ??
            init?.model ??
            ccSessionModel ??
            ccDraftModel;
        final isDefaultModel = current == null;
        final currentBetas = <String>{...(config.betas ?? const <String>[])};
        const oneMillionBeta = 'context-1m-2025-08-07';
        final oneMillionEnabled = currentBetas.contains(oneMillionBeta);
        Future<void> setModel(String? model) async {
          await ref.read(ccConfigProvider.notifier).setModel(model);
          ref.read(chatSessionProvider.notifier).setCCModel(model ?? '');

          final sessionId = chatState.ccSessionId;
          final canApplyLive =
              chatState.ccIsStreaming &&
              sessionId != null &&
              sessionId.isNotEmpty;
          if (!canApplyLive) return;

          final ok = await ref
              .read(bridgeServiceProvider)
              .ccSetModel(sessionId: sessionId, model: model);
          if (!context.mounted) return;
          if (ok) {
            showSuccess(context, 'Model applied to current Claude turn.');
          } else {
            showInfo(context, 'Saved as default. Live turn update failed.');
          }
        }

        Future<void> setOneMillionContext(bool enabled) async {
          final nextBetas = <String>{...currentBetas};
          if (enabled) {
            nextBetas.add(oneMillionBeta);
          } else {
            nextBetas.remove(oneMillionBeta);
          }
          await ref
              .read(ccConfigProvider.notifier)
              .updateConfig(config.copyWith(betas: nextBetas.toList()));
        }

        Widget modelTile(ClaudeCodeSupportedModel model) {
          final selected = current == model.value;
          return ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(
              selected ? AppIcons.radioChecked : AppIcons.radioUnchecked,
              size: 18,
              color: selected ? theme.accent : theme.textMuted,
            ),
            title: Row(
              children: [
                Expanded(
                  child: Text(
                    model.displayName,
                    style: AppTypography.bodySmall(color: theme.text),
                  ),
                ),
                if (model.supportsOneMillionContext)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: theme.accent.withValues(alpha: 0.14),
                      borderRadius: Radii.brFull,
                    ),
                    child: Text(
                      '1M',
                      style: TextStyle(
                        color: theme.accent,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
            subtitle: Text(
              model.value,
              style: AppTypography.label(color: theme.textMuted),
            ),
            onTap: () async {
              await setModel(model.value);
              if (!context.mounted) return;
              Navigator.pop(context);
            },
          );
        }

        return supportedModelsAsync.when(
          data: (models) {
            const fallback = <ClaudeCodeSupportedModel>[
              ClaudeCodeSupportedModel(
                value: 'sonnet',
                displayName: 'Claude Sonnet',
                description: 'Balanced model for coding and reasoning',
              ),
              ClaudeCodeSupportedModel(
                value: 'opus',
                displayName: 'Claude Opus',
                description: 'High-capability model for complex tasks',
              ),
              ClaudeCodeSupportedModel(
                value: 'haiku',
                displayName: 'Claude Haiku',
                description: 'Fast and efficient model for lightweight tasks',
              ),
            ];
            final list = models.isNotEmpty ? models : fallback;
            final supportsOneMillion = list.any(
              (model) => model.supportsOneMillionContext,
            );
            return Padding(
              padding: Insets.screenH,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Select the model used for Claude Code turns.',
                    style: AppTypography.bodySmall(color: theme.textMuted),
                  ),
                  const SizedBox(height: 14),
                  // Default (Recommended) — lets the SDK pick the latest model
                  ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      isDefaultModel
                          ? AppIcons.radioChecked
                          : AppIcons.radioUnchecked,
                      size: 18,
                      color: isDefaultModel ? theme.accent : theme.textMuted,
                    ),
                    title: Text(
                      'Default (Recommended)',
                      style: TextStyle(
                        color: theme.text,
                        fontSize: 13,
                        fontWeight: isDefaultModel
                            ? FontWeight.w600
                            : FontWeight.normal,
                      ),
                    ),
                    subtitle: Text(
                      'Uses the latest recommended model',
                      style: AppTypography.label(color: theme.textMuted),
                    ),
                    onTap: () async {
                      await setModel(null);
                      if (!context.mounted) return;
                      Navigator.pop(context);
                    },
                  ),
                  Divider(
                    color: theme.borderSubtle.withValues(alpha: 0.3),
                    height: 8,
                  ),
                  ...list.map(modelTile),
                  if (supportsOneMillion) ...[
                    const SizedBox(height: Spacing.md),
                    Divider(color: theme.borderSubtle.withValues(alpha: 0.3)),
                    SwitchListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      value: oneMillionEnabled,
                      onChanged: (value) => setOneMillionContext(value),
                      title: Text(
                        'Enable 1M context (beta)',
                        style: TextStyle(
                          color: theme.text,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      subtitle: Text(
                        'Uses beta header for expanded Claude context window.',
                        style: TextStyle(color: theme.textMuted, fontSize: 12),
                      ),
                    ),
                  ],
                ],
              ),
            );
          },
          loading: () => Padding(
            padding: const EdgeInsets.only(top: 20),
            child: Center(
              child: CircularProgressIndicator(color: theme.accent),
            ),
          ),
          error: (_, __) => Padding(
            padding: Insets.topSm,
            child: Text(
              'Unable to load model list.',
              style: AppTypography.bodySmall(color: theme.textMuted),
            ),
          ),
        );
      },
    ),
  );
}
