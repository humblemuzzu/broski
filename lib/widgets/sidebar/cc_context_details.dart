import 'package:broski/models/claude_code/cc_context_usage.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Expandable context usage breakdown for Claude Code sessions.
///
/// Shows what's eating context tokens: categories, memory files, MCP tools,
/// and auto-compact status. Fetches data on demand when expanded.
class CCContextDetails extends ConsumerStatefulWidget {
  final String? sessionId;
  const CCContextDetails({super.key, this.sessionId});

  @override
  ConsumerState<CCContextDetails> createState() => _CCContextDetailsState();
}

class _CCContextDetailsState extends ConsumerState<CCContextDetails> {
  bool _expanded = false;
  bool _loading = false;
  CCContextUsage? _usage;
  String? _error;

  Future<void> _fetch() async {
    final sid = widget.sessionId;
    if (sid == null || sid.isEmpty) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final raw = await bridge.ccGetContextUsage(sessionId: sid);
      if (!mounted) return;
      if (raw == null) {
        setState(() {
          _error = 'Could not load context details';
          _loading = false;
        });
        return;
      }
      setState(() {
        _usage = CCContextUsage.fromJson(raw);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load context details';
        _loading = false;
      });
    }
  }

  void _toggle() {
    setState(() => _expanded = !_expanded);
    if (_expanded && _usage == null && !_loading) {
      _fetch();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.sessionId == null || widget.sessionId!.isEmpty) {
      return const SizedBox.shrink();
    }

    final theme = OpenCodeTheme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Expandable header
        GestureDetector(
          onTap: _toggle,
          behavior: HitTestBehavior.opaque,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                Icon(
                  _expanded ? AppIcons.expandLess : AppIcons.expandMore,
                  size: 14,
                  color: theme.textMuted,
                ),
                const SizedBox(width: 6),
                Text(
                  "What's using context?",
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: theme.textMuted,
                    letterSpacing: 0.3,
                  ),
                ),
              ],
            ),
          ),
        ),
        // Expanded content
        if (_expanded) ...[
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          else if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                _error!,
                style: AppTypography.caption(color: theme.textMuted),
              ),
            )
          else if (_usage != null)
            _buildContent(theme),
        ],
      ],
    );
  }

  Widget _buildContent(OpenCodeTheme theme) {
    final usage = _usage!;

    // Filter & sort categories by token count descending
    final cats = usage.categories.where((c) => c.tokens > 0).toList()
      ..sort((a, b) => b.tokens.compareTo(a.tokens));

    final memFiles = usage.memoryFiles.where((m) => m.tokens > 0).toList();
    final mcpTools = usage.mcpTools.where((t) => t.tokens > 0).toList();

    return Container(
      padding: Insets.cardXs,
      decoration: BoxDecoration(
        color: theme.background,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Categories
          if (cats.isNotEmpty)
            for (final cat in cats)
              _CategoryRow(
                theme: theme,
                category: cat,
                total: usage.totalTokens,
              ),

          // Memory Files
          if (memFiles.isNotEmpty) ...[
            const SizedBox(height: Spacing.sm),
            _SubsectionLabel(theme: theme, label: 'Memory Files'),
            for (final mf in memFiles)
              _DetailRow(
                theme: theme,
                icon: AppIcons.fileText,
                label: mf.displayName,
                value: formatTokenCount(mf.tokens),
              ),
          ],

          // MCP Tools
          if (mcpTools.isNotEmpty) ...[
            const SizedBox(height: Spacing.sm),
            _SubsectionLabel(theme: theme, label: 'MCP Tools'),
            for (final tool in mcpTools)
              _DetailRow(
                theme: theme,
                icon: tool.isLoaded == true
                    ? AppIcons.checkCircle
                    : AppIcons.pending,
                label: tool.name,
                value: formatTokenCount(tool.tokens),
                iconColor: tool.isLoaded == true
                    ? theme.success
                    : theme.textMuted,
              ),
          ],

          // Auto-compact info
          if (usage.isAutoCompactEnabled &&
              usage.autoCompactThreshold != null) ...[
            const SizedBox(height: Spacing.sm),
            Row(
              children: [
                Text('⚡', style: TextStyle(fontSize: 11, color: theme.warning)),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    'Auto-compact at ${usage.autoCompactThreshold}%',
                    style: AppTypography.caption(color: theme.textMuted),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// A single category row: colored dot + name + token count + percentage.
class _CategoryRow extends StatelessWidget {
  const _CategoryRow({
    required this.theme,
    required this.category,
    required this.total,
  });
  final OpenCodeTheme theme;
  final CCContextCategory category;
  final int total;

  @override
  Widget build(BuildContext context) {
    final pct = category.percentOf(total);
    final color = _parseColor(category.color);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.7),
              borderRadius: Radii.brXs,
            ),
          ),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Text(
              category.name,
              style: AppTypography.caption(color: theme.textMuted),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text(
            formatTokenCount(category.tokens),
            style: TextStyle(
              color: theme.text,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 6),
          SizedBox(
            width: 36,
            child: Text(
              '${pct.toStringAsFixed(0)}%',
              textAlign: TextAlign.right,
              style: AppTypography.caption(color: theme.textMuted),
            ),
          ),
        ],
      ),
    );
  }

  Color _parseColor(String hex) {
    try {
      final cleaned = hex.replaceFirst('#', '');
      if (cleaned.length == 6) {
        return Color(int.parse('FF$cleaned', radix: 16));
      }
    } catch (_) {}
    return theme.textMuted;
  }
}

/// Subsection label (e.g. "Memory Files", "MCP Tools").
class _SubsectionLabel extends StatelessWidget {
  const _SubsectionLabel({required this.theme, required this.label});
  final OpenCodeTheme theme;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
          fontSize: 9,
          fontWeight: FontWeight.w600,
          color: theme.textMuted.withValues(alpha: 0.7),
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

/// Detail row: icon + label + value (for memory files, MCP tools).
class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.theme,
    required this.icon,
    required this.label,
    required this.value,
    this.iconColor,
  });
  final OpenCodeTheme theme;
  final IconData icon;
  final String label;
  final String value;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Icon(icon, size: 12, color: iconColor ?? theme.textMuted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              label,
              style: AppTypography.caption(color: theme.textMuted),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: theme.text,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
