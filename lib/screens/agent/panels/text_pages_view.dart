import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/result_actions.dart';
import 'package:broski/screens/agent/shared/tinted_button.dart';
import 'package:broski/theme/app_icons.dart';
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
        Container(
          width: double.infinity,
          padding: Insets.cardSm,
          decoration: BoxDecoration(
            color: theme.backgroundElement,
            borderRadius: Radii.brSm,
            border: Border.all(color: theme.borderSubtle),
          ),
          child: SelectableText(
            _shown,
            key: const ValueKey('text-pages'),
            style: AppTypography.codeSmall(color: theme.text),
          ),
        ),
        Padding(
          padding: Insets.topSm,
          child: Text(
            next == null
                ? 'All ${page.totalChars} characters are shown.'
                : 'The first ${_shown.length} of ${page.totalChars} '
                      'characters are shown.',
            key: const ValueKey('text-pages-foot'),
            style: AppTypography.label(color: theme.textMuted),
          ),
        ),
        if (next != null)
          Padding(
            padding: Insets.topSm,
            child: TintedButton(
              key: const ValueKey('text-pages-more'),
              icon: AppIcons.chevronDown,
              label: 'Show more',
              onTap: widget.actions.busy ? null : () => _more(next),
            ),
          ),
      ],
    );
  }

  void _more(int offset) => widget.actions.call(
    (target) => opCall(
      target.session,
      SystemPromptOp(sessionId: target.session.sessionId, offset: offset),
    ),
  );
}
