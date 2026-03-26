import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

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
          SizedBox(height: Spacing.lg),
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
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: const Text('Link copied'),
                        backgroundColor: theme.backgroundPanel,
                        duration: const Duration(seconds: 2),
                      ),
                    );
                  },
                  icon: Icon(AppIcons.copy, color: theme.textMuted, size: 20),
                ),
              ],
            ),
          ),
          SizedBox(height: Spacing.xl),
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
              SizedBox(width: Spacing.md),
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
          SizedBox(height: Spacing.md),
        ],
      ),
    ),
  );
}
