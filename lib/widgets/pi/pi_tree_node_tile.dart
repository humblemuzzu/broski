import 'package:broski/models/pi.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A single node in the Pi session tree.
///
/// Renders with depth-based indentation, tree connector lines,
/// active path indicator, and type-specific icon/text.
class PiTreeNodeTile extends StatelessWidget {
  final PiTreeNode node;
  final bool isCurrentLeaf;
  final bool isSelected;
  final VoidCallback onTap;

  const PiTreeNodeTile({
    super.key,
    required this.node,
    required this.isCurrentLeaf,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    final bg = isSelected
        ? theme.primary.withValues(alpha: 0.08)
        : isCurrentLeaf
        ? theme.primary.withValues(alpha: 0.04)
        : Colors.transparent;

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        decoration: BoxDecoration(
          color: bg,
          borderRadius: Radii.brSm,
          border: isSelected
              ? Border.all(color: theme.primary.withValues(alpha: 0.25))
              : null,
        ),
        padding: EdgeInsets.only(left: _indentPx, right: 10, top: 6, bottom: 6),
        child: Row(
          children: [
            // Active path dot
            SizedBox(
              width: 10,
              child: node.isOnActivePath
                  ? Container(
                      width: 5,
                      height: 5,
                      decoration: BoxDecoration(
                        color: theme.primary,
                        shape: BoxShape.circle,
                      ),
                    )
                  : null,
            ),
            const SizedBox(width: 4),
            // Node icon
            _NodeIcon(node: node),
            const SizedBox(width: 8),
            // Content
            Expanded(
              child: _NodeContent(node: node, isCurrentLeaf: isCurrentLeaf),
            ),
          ],
        ),
      ),
    );
  }

  /// Indent by 20px per depth level (only fork points increment depth).
  /// Capped at 5 levels to prevent off-screen drift.
  double get _indentPx {
    final level = node.depth.clamp(0, 5);
    return 8.0 + (level * 20.0);
  }
}

// ── Node Icon ─────────────────────────────────────────────────────

class _NodeIcon extends StatelessWidget {
  final PiTreeNode node;
  const _NodeIcon({required this.node});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final (icon, color) = _resolve(theme);

    // Fork indicator: show a small branch badge
    if (node.isFork) {
      return SizedBox(
        width: 18,
        height: 18,
        child: Stack(
          children: [
            Icon(icon, size: 14, color: color),
            Positioned(
              right: 0,
              bottom: 0,
              child: Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: theme.warning,
                  shape: BoxShape.circle,
                  border: Border.all(color: theme.background, width: 1),
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Icon(icon, size: 14, color: color);
  }

  (IconData, Color) _resolve(OpenCodeTheme theme) {
    if (node.isUserMessage) return (AppIcons.chatBubble, theme.info);
    if (node.isAssistantMessage) return (AppIcons.smartToy, theme.primary);
    if (node.isToolResult) return (_toolIcon, theme.toolRead);
    if (node.isBashExecution) return (AppIcons.terminal, theme.toolBash);
    if (node.isCompaction) return (AppIcons.compress, theme.warning);
    if (node.isBranchSummary) return (AppIcons.description, theme.textMuted);
    if (node.isModelChange) return (AppIcons.tune, theme.textMuted);
    if (node.isThinkingChange) return (AppIcons.brain, theme.textMuted);
    if (node.isCustomMessage) return (AppIcons.extension_, theme.accent);
    if (node.isSessionInfo) return (AppIcons.info, theme.textMuted);
    if (node.isLabel) return (AppIcons.star, theme.warning);
    if (node.isCustomEntry) return (AppIcons.code, theme.textMuted);
    return (AppIcons.circleOutlined, theme.textMuted);
  }

  /// Pick icon based on tool name for tool result entries
  IconData get _toolIcon {
    switch (node.toolName) {
      case 'read':
      case 'Read':
        return AppIcons.fileText;
      case 'write':
      case 'Write':
      case 'create_file':
        return AppIcons.filePlus;
      case 'edit':
      case 'Edit':
      case 'edit_file':
        return AppIcons.fileEdit;
      case 'bash':
      case 'Bash':
        return AppIcons.terminal;
      case 'grep':
      case 'Grep':
      case 'find':
      case 'glob':
      case 'finder':
        return AppIcons.search;
      case 'ls':
        return AppIcons.folder;
      case 'web_search':
        return AppIcons.globe;
      default:
        return AppIcons.tools;
    }
  }
}

// ── Node Content ──────────────────────────────────────────────────

class _NodeContent extends StatelessWidget {
  final PiTreeNode node;
  final bool isCurrentLeaf;
  const _NodeContent({required this.node, required this.isCurrentLeaf});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // Main text row
        Row(
          children: [
            Expanded(
              child: Text(
                _displayText,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: _textStyle(theme),
              ),
            ),
            if (isCurrentLeaf) ...[
              const SizedBox(width: 6),
              _HeadBadge(theme: theme),
            ],
          ],
        ),
        // Label
        if (node.label != null) ...[
          const SizedBox(height: 2),
          Row(
            children: [
              Icon(AppIcons.star, size: 10, color: theme.warning),
              const SizedBox(width: 3),
              Flexible(
                child: Text(
                  node.label!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.caption(color: theme.warning),
                ),
              ),
            ],
          ),
        ],
        // Fork info
        if (node.isFork) ...[
          const SizedBox(height: 2),
          Text(
            '${node.childCount} branches',
            style: AppTypography.caption(color: theme.textMuted),
          ),
        ],
      ],
    );
  }

  TextStyle _textStyle(OpenCodeTheme theme) {
    if (node.isUserMessage) {
      return AppTypography.bodySmall(color: theme.info);
    }
    if (node.isAssistantMessage) {
      if (node.stopReason == 'aborted') {
        return AppTypography.bodySmall(color: theme.textMuted);
      }
      if (node.stopReason == 'error') {
        return AppTypography.bodySmall(color: theme.error);
      }
      return AppTypography.bodySmall(color: theme.text);
    }
    if (node.isToolResult || node.isBashExecution) {
      return AppTypography.codeSmall(color: theme.textMuted);
    }
    if (node.isCompaction) {
      return AppTypography.bodySmall(color: theme.warning);
    }
    if (node.isBranchSummary) {
      return AppTypography.bodySmall(color: theme.textMuted);
    }
    return AppTypography.bodySmall(color: theme.textMuted);
  }

  String get _displayText {
    // User message
    if (node.isUserMessage) {
      return _normalizeText(node.text) ?? 'User message';
    }

    // Assistant message
    if (node.isAssistantMessage) {
      if (node.stopReason == 'aborted') return '(aborted)';
      if (node.stopReason == 'error') return '(error)';
      return _normalizeText(node.text) ?? '(tool calls only)';
    }

    // Tool result — show formatted tool call
    if (node.isToolResult) {
      final name = node.toolName ?? 'tool';
      final args = node.toolArgs;
      if (args != null && args.isNotEmpty) return '[$name: $args]';
      return '[$name]';
    }

    // Bash execution
    if (node.isBashExecution) {
      return '[bash: ${node.command ?? ''}]';
    }

    // Compaction
    if (node.isCompaction) return '[compaction]';

    // Branch summary
    if (node.isBranchSummary) {
      return _normalizeText(node.text) ?? '[branch summary]';
    }

    // Model change
    if (node.isModelChange) return '[model: ${node.modelId ?? '?'}]';

    // Thinking level change
    if (node.isThinkingChange) {
      return '[thinking: ${node.thinkingLevel ?? '?'}]';
    }

    // Custom message
    if (node.isCustomMessage) {
      final type = node.customType ?? 'custom';
      final text = _normalizeText(node.text);
      return text != null ? '[$type] $text' : '[$type]';
    }

    // Session info
    if (node.isSessionInfo) return '[title: ${node.text ?? ''}]';

    // Label entry
    if (node.isLabel) return '[label]';

    // Custom entry
    if (node.isCustomEntry) return '[custom: ${node.customType ?? ''}]';

    // Fallback
    return node.type;
  }

  String? _normalizeText(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    final normalized = raw.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (normalized.isEmpty) return null;
    return normalized.length > 120
        ? '${normalized.substring(0, 120)}…'
        : normalized;
  }
}

// ── HEAD Badge ────────────────────────────────────────────────────

class _HeadBadge extends StatelessWidget {
  final OpenCodeTheme theme;
  const _HeadBadge({required this.theme});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: theme.primary.withValues(alpha: 0.15),
        borderRadius: Radii.brXs,
      ),
      child: Text(
        'HEAD',
        style: TextStyle(
          color: theme.primary,
          fontSize: 9,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}
