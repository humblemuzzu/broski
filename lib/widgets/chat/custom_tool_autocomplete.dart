import 'package:broski/models/claude_code/cc_custom_tool.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Custom tool autocomplete popup. Extracted from chat_screen.dart.
class CustomToolAutocomplete extends ConsumerWidget {
  const CustomToolAutocomplete({
    super.key,
    required this.query,
    required this.onSelect,
  });
  final String query;
  final void Function(ClaudeCodeCustomTool tool) onSelect;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final toolsAsync = ref.watch(ccCustomToolsProvider);
    final kCard = theme.backgroundPanel;
    final kBorder = theme.borderSubtle;
    final kText = theme.text;
    final kMuted = theme.textMuted;
    return toolsAsync.when(
      loading: () => Container(
        padding: Insets.card,
        decoration: BoxDecoration(
          color: kCard,
          borderRadius: Radii.brLg,
          border: Border.all(color: kBorder),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2, color: kMuted),
            ),
            const SizedBox(width: 10),
            Text('Loading tools…', style: TextStyle(color: kMuted)),
          ],
        ),
      ),
      error: (e, _) => Container(
        padding: Insets.card,
        decoration: BoxDecoration(
          color: kCard,
          borderRadius: Radii.brLg,
          border: Border.all(color: kBorder),
        ),
        child: Text(
          'Failed to load tools: ${humanizeError(e)}',
          style: TextStyle(color: theme.error),
        ),
      ),
      data: (tools) {
        final enabled = tools.where((t) => t.enabled).toList();
        final q = query.trim().toLowerCase();
        final filtered = q.isEmpty
            ? enabled
            : enabled
                  .where(
                    (t) =>
                        t.name.toLowerCase().contains(q) ||
                        t.description.toLowerCase().contains(q),
                  )
                  .toList();
        if (filtered.isEmpty) {
          return Container(
            padding: Insets.card,
            decoration: BoxDecoration(
              color: kCard,
              borderRadius: Radii.brLg,
              border: Border.all(color: kBorder),
            ),
            child: Text('No matching tools', style: TextStyle(color: kMuted)),
          );
        }
        return Container(
          constraints: const BoxConstraints(maxHeight: 280),
          decoration: BoxDecoration(
            color: kCard,
            borderRadius: Radii.brLg,
            border: Border.all(color: kBorder),
            boxShadow: [
              BoxShadow(
                color: theme.bgDeep.withValues(alpha: 0.4),
                blurRadius: 16,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: Radii.brLg,
            child: ListView.builder(
              padding: Insets.chipV,
              itemCount: filtered.length,
              itemBuilder: (context, index) {
                final tool = filtered[index];
                return InkWell(
                  onTap: () => onSelect(tool),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 10,
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 32,
                          height: 32,
                          decoration: BoxDecoration(
                            color: theme.warning.withValues(alpha: 0.15),
                            borderRadius: Radii.brSm,
                          ),
                          child: Icon(
                            AppIcons.build,
                            size: 16,
                            color: theme.warning,
                          ),
                        ),
                        const SizedBox(width: Spacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                tool.name,
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  color: kText,
                                ),
                              ),
                              const SizedBox(height: Spacing.xxs),
                              Text(
                                tool.mcpToolName,
                                style: TextStyle(fontSize: 11, color: kMuted),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        Icon(
                          AppIcons.chevronRight,
                          color: kMuted.withValues(alpha: 0.7),
                          size: 18,
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        );
      },
    );
  }
}
