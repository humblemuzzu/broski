import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/chat_provider.dart';
import '../../providers/claude_code_provider.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the Claude Code skills sheet. Extracted from chat_screen.dart.
void showCcSkillsSheet(BuildContext context) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Skills',
    initialSize: 0.5,
    child: Consumer(
      builder: (context, ref, _) {
        final cwd = ref.watch(chatSessionProvider).ccCwd;
        final skillsAsync = ref.watch(ccSkillsProvider(cwd));
        return Padding(
          padding: Insets.screenH,
          child: skillsAsync.when(
            data: (skills) {
              if (skills.isEmpty) {
                return Padding(
                  padding: Insets.topSm,
                  child: Text(
                    'No skills found.',
                    style: AppTypography.bodySmall(color: theme.textMuted),
                  ),
                );
              }
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: skills
                    .map(
                      (s) => ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          s.name,
                          style: AppTypography.bodySmall(color: theme.text),
                        ),
                        subtitle: s.description == null
                            ? null
                            : Text(
                                s.description!,
                                style: TextStyle(
                                  color: theme.textMuted,
                                  fontSize: 12,
                                ),
                              ),
                        trailing: s.autoInvoke
                            ? Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: theme.success.withValues(alpha: 0.15),
                                  borderRadius: Radii.brSm,
                                ),
                                child: Text(
                                  'Auto',
                                  style: TextStyle(
                                    color: theme.success,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              )
                            : null,
                      ),
                    )
                    .toList(),
              );
            },
            loading: () => Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Center(
                child: CircularProgressIndicator(color: theme.primary),
              ),
            ),
            error: (e, _) => Padding(
              padding: Insets.topSm,
              child: Text(
                humanizeError(e),
                style: AppTypography.bodySmall(color: theme.error),
              ),
            ),
          ),
        );
      },
    ),
  );
}
