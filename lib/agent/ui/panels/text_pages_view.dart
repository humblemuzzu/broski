import 'package:broski/agent/ui/panels/result_actions.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A long text read a page at a time, read-only. Each page the host receives
/// is appended when it begins where the text shown ends; the foot says how
/// much of the whole is shown, and offers the next page while there is one.
class TextPagesView extends StatefulWidget {
  const TextPagesView({super.key, required this.page, required this.actions});

  final SystemPromptResult page;
  final ResultActions actions;

  @override
  State<TextPagesView> createState() => _TextPagesViewState();
}

class _TextPagesViewState extends State<TextPagesView> {
  late String _shown = widget.page.text;

  @override
  void didUpdateWidget(TextPagesView old) {
    super.didUpdateWidget(old);
    final page = widget.page;
    if (identical(page, old.page)) return;
    _shown = page.offset == _shown.length ? _shown + page.text : page.text;
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final page = widget.page;
    final next = page.nextOffset;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SelectableText(
          _shown,
          key: const ValueKey('text-pages'),
          style: AppTypography.codeSmall(color: theme.text),
        ),
        const SizedBox(height: Spacing.md),
        Text(
          next == null
              ? 'All ${page.totalChars} characters are shown.'
              : 'The first ${_shown.length} of ${page.totalChars} '
                    'characters are shown.',
          key: const ValueKey('text-pages-foot'),
          style: AppTypography.bodySmall(color: theme.textMuted),
        ),
        if (next != null)
          TextButton(
            key: const ValueKey('text-pages-more'),
            onPressed: widget.actions.busy
                ? null
                : () => widget.actions.call(
                    (sessionId) => PiCall(
                      op: SystemPromptOp(sessionId: sessionId, offset: next),
                    ),
                  ),
            child: const Text('Show more'),
          ),
      ],
    );
  }
}
