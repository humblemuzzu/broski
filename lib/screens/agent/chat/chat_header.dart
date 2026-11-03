import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/session_context.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/format_utils.dart';
import 'package:flutter/material.dart';

/// The chat's slim header: back, the session title, how full the context
/// is (which opens the sidebar), and the More sheet.
class ChatHeader extends StatelessWidget {
  const ChatHeader({
    super.key,
    required this.title,
    required this.usage,
    required this.onOpenSidebar,
    this.onMore,
  });

  final String title;
  final Usage? usage;
  final VoidCallback onOpenSidebar;
  final VoidCallback? onMore;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final fill = contextFill(usage);
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 6),
      child: Row(
        children: [
          _GlassPill(
            tooltip: 'Back',
            onTap: () => Navigator.of(context).maybePop(),
            child: Icon(AppIcons.back, color: theme.text, size: 20),
          ),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Text(
              title,
              style: TextStyle(
                color: theme.text,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (fill != null) ...[
            const SizedBox(width: Spacing.sm),
            _ContextPill(fill: fill, onTap: onOpenSidebar),
          ],
          if (onMore case final more?) ...[
            const SizedBox(width: Spacing.sm),
            _GlassPill(
              key: const ValueKey('chat-panels'),
              tooltip: 'More',
              onTap: more,
              child: Icon(AppIcons.moreHorizontal, color: theme.text, size: 20),
            ),
          ],
        ],
      ),
    );
  }
}

/// How full the context is, as the header's ring shows it; null while the
/// backend has reported no context size.
typedef ContextFill = ({int used, int window});

ContextFill? contextFill(Usage? usage) {
  final used = usage?.contextTokens;
  if (used == null || used <= 0) return null;
  return (used: used, window: usage?.contextWindow ?? kDefaultContextWindow);
}

class _GlassPill extends StatelessWidget {
  const _GlassPill({
    super.key,
    required this.tooltip,
    required this.onTap,
    required this.child,
  });

  final String tooltip;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Tooltip(
      message: tooltip,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: theme.backgroundPanel.withValues(alpha: 0.85),
            borderRadius: Radii.brLg,
            border: Border.all(
              color: theme.border.withValues(alpha: 0.3),
              width: 0.5,
            ),
          ),
          child: Center(child: child),
        ),
      ),
    );
  }
}

class _ContextPill extends StatelessWidget {
  const _ContextPill({required this.fill, required this.onTap});

  final ContextFill fill;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final percent = fill.window == 0 ? 0.0 : fill.used / fill.window * 100;
    final color = percent > 80
        ? theme.error
        : percent > 50
        ? theme.warning
        : theme.info;
    return GestureDetector(
      key: const ValueKey('chat-context'),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: theme.backgroundPanel.withValues(alpha: 0.85),
          borderRadius: Radii.brXl,
          border: Border.all(
            color: theme.border.withValues(alpha: 0.3),
            width: 0.5,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                value: (percent / 100).clamp(0.0, 1.0),
                strokeWidth: 2,
                backgroundColor: theme.textMuted.withValues(alpha: 0.15),
                valueColor: AlwaysStoppedAnimation<Color>(color),
              ),
            ),
            const SizedBox(width: 6),
            Text(
              '${TokenUsage.formatTokenCount(fill.used)}'
              '/${TokenUsage.formatTokenCount(fill.window)}',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
