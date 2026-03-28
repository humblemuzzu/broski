import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the Pi skills/commands sheet. Extracted from chat_screen.dart.
void showPiSkillsSheet(BuildContext context) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Pi Skills',
    initialSize: 0.5,
    child: Consumer(
      builder: (context, ref, _) {
        final chatState = ref.watch(chatSessionProvider);
        final cwd = chatState.piCwd;
        final commandsAsync = ref.watch(piCommandsProvider(cwd));
        return commandsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Padding(
            padding: Insets.cardLg,
            child: Text(
              'Failed to load: $e',
              style: TextStyle(color: theme.error),
            ),
          ),
          data: (commands) {
            if (commands.isEmpty) {
              return Padding(
                padding: Insets.cardLg,
                child: Center(
                  child: Text(
                    'No commands found',
                    style: TextStyle(color: theme.textMuted),
                  ),
                ),
              );
            }
            return ListView.builder(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              itemCount: commands.length,
              itemBuilder: (context, index) {
                final cmd = commands[index];
                return ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(AppIcons.bolt, size: 16, color: theme.primary),
                  title: Text(
                    cmd.name,
                    style: AppTypography.bodySmall(color: theme.text),
                  ),
                  subtitle: cmd.description != null
                      ? Text(
                          cmd.description!,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: AppTypography.label(color: theme.textMuted),
                        )
                      : null,
                );
              },
            );
          },
        );
      },
    ),
  );
}
