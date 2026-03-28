import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

/// Shows the session share dialog. Extracted from chat_screen.dart.
void showShareDialog(BuildContext context, String url) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Session Shared',
    initialSize: 0.35,
    child: Padding(
      padding: Insets.screenH,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Anyone with this link can view your session:',
            style: AppTypography.labelLarge(color: theme.textMuted),
          ),
          const SizedBox(height: Spacing.lg),
          Container(
            padding: Insets.chip,
            decoration: BoxDecoration(
              color: theme.bgDeep,
              borderRadius: Radii.brXs,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    url,
                    style: AppTypography.bodySmall(color: theme.info),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                IconButton(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: url));
                    showSuccess(context, 'Link copied');
                  },
                  icon: Icon(AppIcons.copy, color: theme.textMuted, size: 20),
                ),
              ],
            ),
          ),
          const SizedBox(height: Spacing.xl),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () async {
                    final uri = Uri.parse(url);
                    if (await canLaunchUrl(uri)) {
                      await launchUrl(
                        uri,
                        mode: LaunchMode.externalApplication,
                      );
                    }
                  },
                  icon: const Icon(AppIcons.openExternal, size: 18),
                  label: const Text('Open in Browser'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: theme.text,
                    side: BorderSide(color: theme.borderSubtle),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                ),
              ),
              const SizedBox(width: Spacing.md),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () {
                    Share.share(url, subject: 'Check out my coding session');
                    Navigator.pop(context);
                  },
                  icon: const Icon(AppIcons.share, size: 18),
                  label: const Text('Share'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: theme.primary,
                    foregroundColor: theme.selectedListItemText,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: Spacing.md),
        ],
      ),
    ),
  );
}
