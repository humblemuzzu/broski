import 'package:broski/providers/chat_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Tells the user when the Mac picked interrupted work back up on attach.
class PiDurableStatusBanner extends ConsumerWidget {
  const PiDurableStatusBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notice = ref.watch(
      chatSessionProvider.select((state) => state.pdResumeNotice),
    );
    if (notice == null || notice.isEmpty) return const SizedBox.shrink();
    final theme = OpenCodeTheme.of(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Container(
        padding: Insets.cardSm,
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: Radii.brMd,
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Row(
          children: [
            Icon(AppIcons.history, size: 16, color: theme.primary),
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: Text(
                notice,
                style: TextStyle(color: theme.text, fontSize: 13),
              ),
            ),
            SizedBox(
              width: 28,
              height: 28,
              child: IconButton(
                onPressed: () => ref
                    .read(chatSessionProvider.notifier)
                    .setPiDurableResumeNotice(null),
                icon: Icon(AppIcons.close, size: 16, color: theme.textMuted),
                padding: EdgeInsets.zero,
                tooltip: 'Dismiss',
              ),
            ),
          ],
        ),
      ),
    );
  }
}
