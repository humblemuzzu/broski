import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/chat_provider.dart';
import '../../providers/codex_provider.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Bottom sheet that shows available Codex models via a cache-first provider.
///
/// First open with no cache: brief loading spinner, then list.
/// Subsequent opens: instant from cache, background refresh picks up new models.
class CxModelSheet extends ConsumerWidget {
  const CxModelSheet({super.key});

  static void show(BuildContext context) {
    DetailSheet.show(
      context: context,
      title: 'Codex Model',
      initialSize: 0.5,
      child: const CxModelSheet(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final modelsAsync = ref.watch(codexModelsProvider);
    final chatState = ref.watch(chatSessionProvider);
    final current = chatState.cxModel ?? '';
    final isUsingDefault = current.isEmpty;

    return modelsAsync.when(
      data: (models) {
        if (models.isEmpty) {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Center(
              child: Text(
                'No models available',
                style: TextStyle(color: theme.textMuted, fontSize: 13),
              ),
            ),
          );
        }

        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Select the model used for Codex turns.',
                style: TextStyle(color: theme.textMuted, fontSize: 13),
              ),
              const SizedBox(height: 14),
              ...models.map((model) {
                final selected = isUsingDefault
                    ? model.isDefault
                    : (current == model.id || current == model.model);
                return ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    selected
                        ? Icons.radio_button_checked_rounded
                        : Icons.radio_button_off_rounded,
                    size: 18,
                    color: selected ? theme.primary : theme.textMuted,
                  ),
                  title: Row(
                    children: [
                      Flexible(
                        child: Text(
                          model.displayName,
                          style: TextStyle(color: theme.text, fontSize: 13),
                        ),
                      ),
                      if (model.isDefault) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color: theme.primary.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            'default',
                            style: TextStyle(
                              color: theme.primary,
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  subtitle: model.description.isNotEmpty
                      ? Text(
                          model.description,
                          style:
                              TextStyle(color: theme.textMuted, fontSize: 12),
                        )
                      : null,
                  onTap: () {
                    ref
                        .read(chatSessionProvider.notifier)
                        .setCodexModel(model.id);
                    Navigator.pop(context);
                  },
                );
              }),
            ],
          ),
        );
      },
      loading: () => const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (e, _) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline_rounded, color: theme.error, size: 32),
            const SizedBox(height: 8),
            Text(
              'Failed to load models',
              style: TextStyle(color: theme.text, fontSize: 14),
            ),
            const SizedBox(height: 4),
            Text(
              e.toString(),
              style: TextStyle(color: theme.textMuted, fontSize: 12),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: () =>
                  ref.read(codexModelsProvider.notifier).refresh(),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
