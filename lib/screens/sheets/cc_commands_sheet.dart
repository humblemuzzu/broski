import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/chat_provider.dart';
import '../../providers/claude_code_provider.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';
import 'package:broski/theme/app_icons.dart';

/// Shows the Claude Code commands sheet. Extracted from chat_screen.dart.
///
/// [controller] is the chat input text controller — the selected command is
/// inserted into it.
/// [inputFocusNode] is the chat input focus node — refocused after selection.
void showCcCommandsSheet(
  BuildContext context, {
  required TextEditingController controller,
  required FocusNode inputFocusNode,
}) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Commands',
    initialSize: 0.5,
    child: Consumer(
      builder: (context, ref, _) {
        final chatState = ref.watch(chatSessionProvider);
        final cwd = chatState.ccCwd;
        final builtins = chatState.ccInit?.slashCommands ?? const [];
        final customAsync = ref.watch(ccCommandsProvider(cwd));
        List<String> custom = const [];
        if (customAsync.hasValue) {
          custom = customAsync.value!
              .map((c) => '/${c.name}')
              .toList(growable: false);
        }
        final all = <String>{...builtins, ...custom}.toList()..sort();
        return Padding(
          padding: Insets.screenH,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (all.isEmpty)
                Padding(
                  padding: Insets.topSm,
                  child: Text(
                    'No commands found for this project.',
                    style: AppTypography.bodySmall(color: theme.textMuted),
                  ),
                )
              else
                ...all.map(
                  (cmd) => ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      AppIcons.chevronRight,
                      color: theme.textMuted,
                      size: 18,
                    ),
                    title: Text(
                      cmd,
                      style: AppTypography.bodySmall(color: theme.text),
                    ),
                    onTap: () {
                      final normalized = cmd.startsWith('/') ? cmd : '/$cmd';
                      controller.text = '$normalized ';
                      controller.selection = TextSelection.fromPosition(
                        TextPosition(offset: controller.text.length),
                      );
                      Navigator.pop(context);
                      WidgetsBinding.instance.addPostFrameCallback((_) {
                        if (context.mounted) inputFocusNode.requestFocus();
                      });
                    },
                  ),
                ),
            ],
          ),
        );
      },
    ),
  );
}
