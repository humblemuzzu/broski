import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/pi.dart';
import '../../providers/highlights_provider.dart';
import '../../providers/pi_provider.dart';
import '../../theme/app_icons.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the Pi session options sheet (stop, rename, highlight, fork, delete).
/// Extracted from sessions_screen.dart to match CC/CX patterns.
void showPiSessionOptionsSheet({
  required BuildContext context,
  required WidgetRef ref,
  required PiSessionInfo session,
  required String displayTitle,
  required VoidCallback onDeleted,
  required VoidCallback onRenamed,
}) {
  final highlights = ref.read(highlightsProvider);
  final isHighlighted = highlights.isSessionHighlighted(session.id);
  final highlightColor = highlights.color;
  final ocTheme = OpenCodeTheme.of(context);

  DetailSheet.show(
    context: context,
    title: displayTitle,
    initialSize: 0.4,
    minSize: 0.2,
    maxSize: 0.5,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Stop Session
        ListTile(
          leading: Icon(AppIcons.stop, color: ocTheme.textMuted),
          title: Text('Stop Session', style: TextStyle(color: ocTheme.text)),
          subtitle: Text(
            'Force stop if stuck',
            style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
          ),
          onTap: () {
            Navigator.pop(context);
            _stopPiSession(context, ref, session);
          },
        ),
        // Rename
        ListTile(
          leading: Icon(AppIcons.edit, color: ocTheme.textMuted),
          title: Text('Rename', style: TextStyle(color: ocTheme.text)),
          subtitle: Text(
            'Set a custom session name',
            style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
          ),
          onTap: () {
            Navigator.pop(context);
            _renamePiSession(context, ref, session, onRenamed);
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
        // Fork
        ListTile(
          leading: Icon(AppIcons.forkRight, color: ocTheme.textMuted),
          title: Text('Fork', style: TextStyle(color: ocTheme.text)),
          subtitle: Text(
            'Branch from the latest message',
            style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
          ),
          onTap: () {
            Navigator.pop(context);
            _forkPiSession(context, ref, session, onDeleted);
          },
        ),
        // Delete
        ListTile(
          leading: Icon(AppIcons.delete, color: ocTheme.error),
          title: Text('Delete', style: TextStyle(color: ocTheme.error)),
          onTap: () {
            Navigator.pop(context);
            _deletePiSession(context, ref, session, onDeleted);
          },
        ),
      ],
    ),
  );
}

Future<void> _stopPiSession(
  BuildContext context,
  WidgetRef ref,
  PiSessionInfo session,
) async {
  try {
    await ref.read(piBridgeServiceProvider).abort(projectPath: session.cwd);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Stop signal sent'),
        backgroundColor: OpenCodeTheme.of(context).backgroundPanel,
      ),
    );
  } catch (e) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Failed to stop session: $e'),
        backgroundColor: OpenCodeTheme.of(context).error,
      ),
    );
  }
}

Future<void> _renamePiSession(
  BuildContext context,
  WidgetRef ref,
  PiSessionInfo session,
  VoidCallback onRenamed,
) async {
  final controller = TextEditingController(text: session.name ?? '');
  final name = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: Theme.of(context).colorScheme.surface,
      title: const Text('Rename Session'),
      content: TextField(
        controller: controller,
        autofocus: true,
        decoration: const InputDecoration(hintText: 'Session name'),
        onSubmitted: (value) => Navigator.pop(context, value.trim()),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, controller.text.trim()),
          child: const Text('Rename'),
        ),
      ],
    ),
  );
  if (name == null || name.isEmpty) return;
  try {
    await ref
        .read(piBridgeServiceProvider)
        .setSessionName(name: name, projectPath: session.cwd);
    onRenamed();
  } catch (e) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Failed to rename session: $e'),
        backgroundColor: OpenCodeTheme.of(context).error,
      ),
    );
  }
}

Future<void> _deletePiSession(
  BuildContext context,
  WidgetRef ref,
  PiSessionInfo session,
  VoidCallback onDeleted,
) async {
  final confirm = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: Theme.of(context).colorScheme.surface,
      title: const Text('Delete Session?'),
      content: const Text(
        'Are you sure you want to delete this Pi session? '
        'This action cannot be undone.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, true),
          child: Text(
            'Delete',
            style: TextStyle(color: OpenCodeTheme.of(context).error),
          ),
        ),
      ],
    ),
  );
  if (confirm != true) return;
  try {
    await ref
        .read(piBridgeServiceProvider)
        .deleteSession(sessionPath: session.path, projectPath: session.cwd);
    ref.invalidate(piSessionsProvider(null));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Session deleted'),
        backgroundColor: OpenCodeTheme.of(context).backgroundPanel,
      ),
    );
    onDeleted();
  } catch (e) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Failed to delete session: $e'),
        backgroundColor: OpenCodeTheme.of(context).error,
      ),
    );
  }
}

Future<void> _forkPiSession(
  BuildContext context,
  WidgetRef ref,
  PiSessionInfo session,
  VoidCallback onDeleted,
) async {
  try {
    final bridge = ref.read(piBridgeServiceProvider);
    // Get forkable messages to find the latest user message
    final messages = await bridge.getForkMessages(projectPath: session.cwd);
    if (messages.isEmpty) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('No messages to fork from'),
          backgroundColor: OpenCodeTheme.of(context).backgroundPanel,
        ),
      );
      return;
    }
    // Fork at the latest user message
    final lastMessage = messages.last;
    final result = await bridge.fork(
      entryId: lastMessage.entryId,
      projectPath: session.cwd,
    );
    if (result.cancelled) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Fork was cancelled'),
          backgroundColor: OpenCodeTheme.of(context).backgroundPanel,
        ),
      );
      return;
    }
    ref.invalidate(piSessionsProvider(null));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Session forked'),
        backgroundColor: OpenCodeTheme.of(context).backgroundPanel,
      ),
    );
  } catch (e) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Failed to fork session: $e'),
        backgroundColor: OpenCodeTheme.of(context).error,
      ),
    );
  }
}
