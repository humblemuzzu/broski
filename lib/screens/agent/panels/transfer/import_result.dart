import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:broski/screens/agent/panels/notice_card.dart';
import 'package:broski/screens/agent/shared/tinted_button.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The session the Mac made of the file, with the way to open it.
class ImportedSession extends StatelessWidget {
  const ImportedSession({super.key, required this.session});

  final SessionRef session;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        NoticeCard(
          key: const ValueKey('import-done'),
          icon: AppIcons.checkCircle,
          color: theme.success,
          text: 'Imported. It is in the list.',
        ),
        const SizedBox(height: Spacing.md),
        TintedButton(
          key: const ValueKey('import-open'),
          icon: AppIcons.forward,
          label: 'Open',
          color: theme.primary,
          onTap: () {
            Navigator.of(context).pop();
            openSession(context, session);
          },
        ),
      ],
    );
  }
}

/// Why the Mac did not take the file.
class ImportRefusedView extends StatelessWidget {
  const ImportRefusedView({super.key, required this.reason});

  final String reason;

  @override
  Widget build(BuildContext context) => NoticeCard(
    key: const ValueKey('import-refused'),
    icon: AppIcons.error,
    color: OpenCodeTheme.of(context).error,
    text: 'Not imported. $reason',
  );
}

/// One line of an import's outcome, tinted in [color].
