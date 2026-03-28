import 'package:broski/models/agent_type.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the title-exclude-filters management sheet for OpenCode sessions.
///
/// Extracted from `_SessionsScreenState._showSessionsTitleFiltersSheet`
/// in `sessions_screen.dart`.
void showSessionsTitleFiltersSheet(BuildContext context) {
  final controller = TextEditingController();
  DetailSheet.show(
    context: context,
    title: 'Title Filters',
    initialSize: 0.6,
    child: Consumer(
      builder: (context, ref, _) {
        final ocTheme = OpenCodeTheme.of(context);
        final filters = ref.watch(
          sessionsTitleExcludeFiltersProvider(AgentType.opencode),
        );
        final notifier = ref.read(
          sessionsTitleExcludeFiltersProvider(AgentType.opencode).notifier,
        );
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                "Hide sessions whose titles match any filter. Use `/regex/` for regex, otherwise it's a case-insensitive substring match.",
                style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
              ),
              const SizedBox(height: Spacing.md),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: controller,
                      decoration: InputDecoration(
                        hintText: 'e.g. test, tmp, /wip.*/',
                        hintStyle: TextStyle(color: ocTheme.textMuted),
                        filled: true,
                        fillColor: ocTheme.backgroundElement,
                        border: OutlineInputBorder(
                          borderRadius: Radii.brMd,
                          borderSide: BorderSide(color: ocTheme.borderSubtle),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: Radii.brMd,
                          borderSide: BorderSide(color: ocTheme.borderSubtle),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: Radii.brMd,
                          borderSide: BorderSide(color: ocTheme.primary),
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 10,
                        ),
                      ),
                      style: TextStyle(color: ocTheme.text),
                      textInputAction: TextInputAction.done,
                      onSubmitted: (value) async {
                        await notifier.add(value);
                        controller.clear();
                      },
                    ),
                  ),
                  const SizedBox(width: 10),
                  ElevatedButton(
                    onPressed: () async {
                      await notifier.add(controller.text);
                      controller.clear();
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: ocTheme.primary,
                      foregroundColor: ocTheme.selectedListItemText,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
                    ),
                    child: const Text('Add'),
                  ),
                ],
              ),
              const SizedBox(height: Spacing.md),
              if (filters.isNotEmpty)
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () => notifier.clear(),
                    child: Text(
                      'Clear all',
                      style: TextStyle(color: ocTheme.error),
                    ),
                  ),
                ),
              if (filters.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 24),
                  child: Center(
                    child: Text(
                      'No filters yet',
                      style: TextStyle(color: ocTheme.textMuted),
                    ),
                  ),
                )
              else
                ...filters.asMap().entries.map((entry) {
                  final index = entry.key;
                  final f = entry.value;
                  return Column(
                    children: [
                      if (index > 0) Divider(color: ocTheme.borderSubtle),
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(
                          f.startsWith('/') && f.endsWith('/')
                              ? AppIcons.code
                              : AppIcons.textFields,
                          color: ocTheme.textMuted,
                        ),
                        title: Text(f, style: TextStyle(color: ocTheme.text)),
                        trailing: IconButton(
                          onPressed: () => notifier.removeAt(index),
                          icon: Icon(AppIcons.delete, color: ocTheme.error),
                          tooltip: 'Remove',
                        ),
                      ),
                    ],
                  );
                }),
            ],
          ),
        );
      },
    ),
  ).whenComplete(controller.dispose);
}
