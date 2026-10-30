import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Footer shown at the bottom of the chat screen when viewing a finished
/// subagent transcript in read-only mode. Replaces the input bar.
///
/// Subagents that cannot be resumed by their SDK (Claude Code subagents —
/// SDK has no continue API) open with this footer so the user sees the full transcript but can't type.
class ChatReadOnlyFooter extends StatelessWidget {
  const ChatReadOnlyFooter({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return SafeArea(
      top: false,
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: theme.backgroundPanel.withValues(alpha: 0.85),
          borderRadius: Radii.brLg,
          border: Border.all(
            color: theme.border.withValues(alpha: 0.3),
            width: 0.5,
          ),
        ),
        child: Row(
          children: [
            Icon(AppIcons.lock, size: 16, color: theme.textMuted),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'Read-only — finished subagent transcript',
                style: TextStyle(
                  color: theme.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
