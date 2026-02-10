import 'package:flutter/material.dart';
import '../../theme/app_typography.dart';

import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';

class GitCommitSheet extends StatefulWidget {
  const GitCommitSheet({
    super.key,
    this.initialMessage,
    required this.onCommit,
  });

  final String? initialMessage;
  final Future<void> Function(String message) onCommit;

  static Future<void> show({
    required BuildContext context,
    String? initialMessage,
    required Future<void> Function(String message) onCommit,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(ctx).viewInsets.bottom,
        ),
        child: GitCommitSheet(
          initialMessage: initialMessage,
          onCommit: onCommit,
        ),
      ),
    );
  }

  @override
  State<GitCommitSheet> createState() => _GitCommitSheetState();
}

class _GitCommitSheetState extends State<GitCommitSheet> {
  late final TextEditingController _controller;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialMessage ?? '');
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _commit() async {
    final msg = _controller.text.trim();
    if (msg.isEmpty) return;

    setState(() => _saving = true);
    try {
      await widget.onCommit(msg);
      if (!mounted) return;
      Navigator.pop(context);
    } catch (e) {
      if (!mounted) return;
      String errorMsg = e.toString();
      // Make common git errors more user-friendly
      if (errorMsg.contains('nothing to commit') ||
          errorMsg.contains('no changes added') ||
          errorMsg.contains('Changes not staged')) {
        errorMsg =
            'No files are staged for commit.\n\nGo back and tap files to stage them first, or use "Stage all".';
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(errorMsg),
          duration: const Duration(seconds: 5),
          backgroundColor: Colors.red.shade700,
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return GestureDetector(
      onTap: () => FocusScope.of(context).unfocus(),
      child: Container(
        decoration: BoxDecoration(
          color: theme.bgSheet,
          borderRadius: Radii.sheetTop,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Drag handle
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 8),
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.textMuted.withValues(alpha: 0.3),
                  borderRadius: Radii.brXs,
                ),
              ),
            ),

            // Header
            Padding(
              padding: Insets.listItemDense,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Text(
                    'Commit',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: Icon(Icons.close, color: theme.textMuted, size: 24),
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  ),
                ],
              ),
            ),

            // Content
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: Column(
                children: [
                  TextField(
                    controller: _controller,
                    autofocus: true,
                    maxLines: 5,
                    minLines: 3,
                    style: AppTypography.labelLarge(color: theme.text),
                    decoration: InputDecoration(
                      hintText: 'Type commit message...',
                      hintStyle: TextStyle(color: theme.textMuted),
                      filled: true,
                      fillColor: theme.backgroundElement,
                      border: OutlineInputBorder(
                        borderRadius: Radii.brMd,
                        borderSide: BorderSide.none,
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: Radii.brMd,
                        borderSide: BorderSide(color: theme.borderSubtle),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: Radii.brMd,
                        borderSide: BorderSide(
                          color: theme.primary,
                          width: 1.5,
                        ),
                      ),
                      contentPadding: Insets.input,
                    ),
                  ),
                  SizedBox(height: Spacing.md),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _saving ? null : _commit,
                      style: FilledButton.styleFrom(
                        backgroundColor: theme.primary,
                        foregroundColor: theme.selectedListItemText,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: Radii.brMd,
                        ),
                      ),
                      child: _saving
                          ? SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: theme.selectedListItemText,
                              ),
                            )
                          : const Text('Commit'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
