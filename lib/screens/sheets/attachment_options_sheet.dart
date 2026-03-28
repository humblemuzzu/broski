import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';

/// Shows the attachment options bottom sheet.
/// Extracted from chat_screen.dart `_showAttachmentOptions`.
void showAttachmentOptions(
  BuildContext context, {
  required VoidCallback onPickCamera,
  required VoidCallback onPickGallery,
}) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Add Attachment',
    initialSize: 0.3,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        ListTile(
          leading: Icon(AppIcons.camera, color: theme.primary),
          title: Text('Take Photo', style: TextStyle(color: theme.text)),
          onTap: () {
            Navigator.pop(context);
            onPickCamera();
          },
        ),
        ListTile(
          leading: Icon(AppIcons.photoLibrary, color: theme.primary),
          title: Text(
            'Choose from Gallery',
            style: TextStyle(color: theme.text),
          ),
          onTap: () {
            Navigator.pop(context);
            onPickGallery();
          },
        ),
        ListTile(
          leading: Icon(AppIcons.attach, color: theme.info),
          title: Text('Attach File (@)', style: TextStyle(color: theme.text)),
          subtitle: Text(
            'Type @ in the input to search files',
            style: AppTypography.label(color: theme.textMuted),
          ),
          onTap: () => Navigator.pop(context),
        ),
      ],
    ),
  );
}
