import 'package:broski/models/session.dart';
import 'package:broski/providers/highlights_provider.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the session options bottom sheet (stop, highlight, rename, fork,
/// archive, share).
///
/// Uses [Consumer] for reactive provider reads. Action callbacks are passed
/// in for operations that live on the calling screen's state.
///
/// Extracted from `_SessionsScreenState._showSessionOptions`
/// in `sessions_screen.dart`.
Future<void> showSessionOptionsSheet(
  BuildContext context, {
  required SessionSummary session,
  required void Function(SessionSummary) onStop,
  required void Function(SessionSummary) onRename,
  required void Function(SessionSummary) onFork,
  required void Function(SessionSummary, {required bool archive}) onArchive,
  required void Function(SessionSummary) onShare,
  required void Function(SessionSummary) onUnshare,
}) async {
  await DetailSheet.show(
    context: context,
    title: session.title,
    initialSize: 0.35,
    minSize: 0.2,
    maxSize: 0.5,
    child: Consumer(
      builder: (context, ref, _) {
        final highlights = ref.watch(highlightsProvider);
        final isHighlighted = highlights.isSessionHighlighted(session.id);
        final ocTheme = OpenCodeTheme.of(context);
        final highlightColor = highlights.color;
        final sessionStatuses = ref.watch(globalSessionStatusProvider);
        final status = sessionStatuses[session.id];
        final isRunning = status?.isBusy == true || status?.isRetry == true;

        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Stop Session option
            ListTile(
              leading: Icon(
                AppIcons.stop,
                color: isRunning ? ocTheme.error : ocTheme.textMuted,
              ),
              title: Text(
                'Stop Session',
                style: TextStyle(
                  color: isRunning ? ocTheme.error : ocTheme.text,
                ),
              ),
              subtitle: Text(
                isRunning
                    ? 'Session is currently running'
                    : 'Force stop if stuck',
                style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
              ),
              onTap: () {
                Navigator.pop(context);
                onStop(session);
              },
            ),
            // Highlight toggle
            ListTile(
              leading: Icon(
                isHighlighted ? AppIcons.star : AppIcons.starOutline,
                color: isHighlighted
                    ? highlightColor.forBrightness(
                        Theme.of(context).brightness,
                        themePrimary: ocTheme.primary,
                      )
                    : ocTheme.textMuted,
              ),
              title: Text(
                isHighlighted ? 'Remove Highlight' : 'Highlight',
                style: TextStyle(color: ocTheme.text),
              ),
              onTap: () {
                Navigator.pop(context);
                ref.read(highlightsProvider.notifier).toggleSession(session.id);
              },
            ),
            // Rename
            ListTile(
              leading: Icon(AppIcons.edit, color: ocTheme.textMuted),
              title: Text('Rename', style: TextStyle(color: ocTheme.text)),
              onTap: () {
                Navigator.pop(context);
                onRename(session);
              },
            ),
            // Fork
            ListTile(
              leading: Icon(AppIcons.forkRight, color: ocTheme.textMuted),
              title: Text('Fork', style: TextStyle(color: ocTheme.text)),
              subtitle: Text(
                'Create a copy of this session',
                style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
              ),
              onTap: () {
                Navigator.pop(context);
                onFork(session);
              },
            ),
            // Archive / Unarchive
            ListTile(
              leading: Icon(
                session.isArchived ? AppIcons.unarchive : AppIcons.archive,
                color: session.isArchived ? ocTheme.textMuted : ocTheme.error,
              ),
              title: Text(
                session.isArchived ? 'Unarchive' : 'Archive',
                style: TextStyle(
                  color: session.isArchived ? ocTheme.text : ocTheme.error,
                ),
              ),
              onTap: () {
                Navigator.pop(context);
                onArchive(session, archive: !session.isArchived);
              },
            ),
            // Share / Unshare
            ListTile(
              leading: Icon(
                session.isShared ? AppIcons.unlink : AppIcons.share,
                color: ocTheme.textMuted,
              ),
              title: Text(
                session.isShared ? 'Unshare' : 'Share',
                style: TextStyle(color: ocTheme.text),
              ),
              subtitle: session.isShared
                  ? Text(
                      session.share!.url,
                      style: TextStyle(color: ocTheme.textMuted, fontSize: 11),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    )
                  : null,
              onTap: () {
                Navigator.pop(context);
                if (session.isShared) {
                  onUnshare(session);
                } else {
                  onShare(session);
                }
              },
            ),
          ],
        );
      },
    ),
  );
}
