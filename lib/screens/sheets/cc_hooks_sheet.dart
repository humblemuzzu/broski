import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/chat_provider.dart';
import '../../providers/claude_code_provider.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the Claude Code hooks sheet. Extracted from chat_screen.dart.
void showCcHooksSheet(BuildContext context) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Hooks',
    initialSize: 0.5,
    child: Consumer(
      builder: (context, ref, _) {
        final cwd = ref.watch(chatSessionProvider).ccCwd;
        final hooksAsync = ref.watch(ccHooksProvider(cwd));
        return Padding(
          padding: Insets.screenH,
          child: hooksAsync.when(
            data: (hooks) {
              if (hooks.isEmpty) {
                return Padding(
                  padding: Insets.topSm,
                  child: Text(
                    'No hooks found.',
                    style: AppTypography.bodySmall(color: theme.textMuted),
                  ),
                );
              }
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: hooks
                    .map(
                      (h) => ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          h.event,
                          style: AppTypography.bodySmall(color: theme.text),
                        ),
                        subtitle: Text(
                          h.matcher == null
                              ? 'All tools'
                              : 'Matcher: ${h.matcher}',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        ),
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
