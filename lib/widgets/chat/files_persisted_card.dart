import 'package:broski/models/message.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Compact card for files-persisted events.
/// Extracted from chat_screen.dart `_buildFilesPersistedCard`.
class FilesPersistedCard extends StatelessWidget {
  const FilesPersistedCard({super.key, required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: theme.success.withValues(alpha: 0.25),
          width: 0.5,
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.save_outlined, size: 16, color: theme.success),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message.text.replaceFirst('💾 ', ''),
              style: TextStyle(fontSize: 12, color: theme.text, height: 1.3),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
