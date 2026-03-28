import 'package:broski/providers/chat_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/export_session_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the export transcript sheet (copy, share, or advanced options).
/// Extracted from `_ChatScreenState._exportTranscript` in `chat_screen.dart`.
void exportTranscript({
  required BuildContext context,
  required WidgetRef ref,
  required String effectiveTitle,
  required VoidCallback onCopyToClipboard,
  required VoidCallback onShare,
}) {
  final theme = OpenCodeTheme.of(context);
  final chatState = ref.read(chatSessionProvider);
  if (chatState.messages.isEmpty) {
    showInfo(context, 'No messages to export');
    return;
  }
  DetailSheet.show(
    context: context,
    title: 'Export Transcript',
    initialSize: 0.4,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        ListTile(
          leading: Icon(AppIcons.copy, color: theme.primary),
          title: Text('Copy to Clipboard', style: TextStyle(color: theme.text)),
          subtitle: Text(
            'Copy as markdown',
            style: TextStyle(color: theme.textMuted),
          ),
          onTap: () {
            Navigator.pop(context);
            onCopyToClipboard();
          },
        ),
        ListTile(
          leading: Icon(AppIcons.share, color: theme.primary),
          title: Text('Share', style: TextStyle(color: theme.text)),
          subtitle: Text(
            'Share transcript via system share',
            style: TextStyle(color: theme.textMuted),
          ),
          onTap: () {
            Navigator.pop(context);
            onShare();
          },
        ),
        ListTile(
          leading: Icon(AppIcons.tune, color: theme.primary),
          title: Text('Export options…', style: TextStyle(color: theme.text)),
          subtitle: Text(
            'Choose format, include tools, and more',
            style: TextStyle(color: theme.textMuted),
          ),
          onTap: () {
            Navigator.pop(context);
            showModalBottomSheet(
              context: context,
              isScrollControlled: true,
              backgroundColor: Colors.transparent,
              builder: (_) => ExportSessionSheet(
                title: effectiveTitle,
                messages: chatState.messages,
              ),
            );
          },
        ),
      ],
    ),
  );
}
