import 'package:broski/providers/pi_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the navigate-to-node dialog with summarize options.
///
/// Returns `true` if navigation succeeded, `false`/`null` if cancelled.
Future<bool?> showPiTreeNavigateDialog({
  required BuildContext context,
  required String nodeId,
  String? cwd,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    backgroundColor: Colors.transparent,
    builder: (_) => _NavigateSheet(nodeId: nodeId, cwd: cwd),
  );
}

class _NavigateSheet extends ConsumerStatefulWidget {
  final String nodeId;
  final String? cwd;
  const _NavigateSheet({required this.nodeId, this.cwd});

  @override
  ConsumerState<_NavigateSheet> createState() => _NavigateSheetState();
}

class _NavigateSheetState extends ConsumerState<_NavigateSheet> {
  bool _loading = false;
  bool _summarizing = false;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Container(
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.sheetTop,
      ),
      child: SafeArea(
        top: false,
        child: _loading
            ? _LoadingView(theme: theme, summarizing: _summarizing)
            : _ChoicesView(theme: theme, onChoice: _handleChoice),
      ),
    );
  }

  Future<void> _handleChoice(_SummarizeChoice choice) async {
    String? customInstructions;

    if (choice == _SummarizeChoice.custom) {
      customInstructions = await _showCustomPromptDialog();
      if (customInstructions == null) return; // cancelled
    }

    final summarize = choice != _SummarizeChoice.none;
    setState(() {
      _loading = true;
      _summarizing = summarize;
    });

    final bridge = ref.read(piBridgeServiceProvider);
    try {
      final result = await bridge.navigateTree(
        targetId: widget.nodeId,
        summarize: summarize,
        customInstructions: customInstructions,
        projectPath: widget.cwd,
      );

      if (!mounted) return;

      if (result.cancelled || result.aborted) {
        setState(() => _loading = false);
        if (mounted) showInfo(context, 'Navigation cancelled');
        return;
      }

      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _loading = false);
        showError(context, 'Navigate failed: $e');
      }
    }
  }

  Future<String?> _showCustomPromptDialog() async {
    final theme = OpenCodeTheme.of(context);
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: theme.backgroundPanel,
        title: Text(
          'Custom Summarization Prompt',
          style: TextStyle(color: theme.text),
        ),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLines: 3,
          style: TextStyle(color: theme.text),
          decoration: InputDecoration(
            hintText: 'Instructions for branch summary…',
            hintStyle: TextStyle(color: theme.textMuted),
            filled: true,
            fillColor: theme.backgroundElement,
            border: OutlineInputBorder(
              borderRadius: Radii.brSm,
              borderSide: BorderSide.none,
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Cancel', style: TextStyle(color: theme.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            child: Text('Summarize', style: TextStyle(color: theme.primary)),
          ),
        ],
      ),
    );
    controller.dispose();
    if (result == null || result.trim().isEmpty) return null;
    return result.trim();
  }
}

// ── Choice Types ──────────────────────────────────────────────────

enum _SummarizeChoice { none, summarize, custom }

// ── Choices View ──────────────────────────────────────────────────

class _ChoicesView extends StatelessWidget {
  final OpenCodeTheme theme;
  final ValueChanged<_SummarizeChoice> onChoice;

  const _ChoicesView({required this.theme, required this.onChoice});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Handle bar
          Center(
            child: Container(
              width: 32,
              height: 4,
              decoration: BoxDecoration(
                color: theme.borderSubtle,
                borderRadius: Radii.brFull,
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text('Summarize branch?', style: AppTypography.h3(color: theme.text)),
          const SizedBox(height: 4),
          Text(
            'Optionally summarize the branch you\'re leaving.',
            style: AppTypography.bodySmall(color: theme.textMuted),
          ),
          const SizedBox(height: 16),
          _ChoiceTile(
            icon: AppIcons.forward,
            label: 'No summary',
            subtitle: 'Navigate directly',
            color: theme.primary,
            theme: theme,
            onTap: () => onChoice(_SummarizeChoice.none),
          ),
          const SizedBox(height: 8),
          _ChoiceTile(
            icon: AppIcons.compress,
            label: 'Summarize',
            subtitle: 'AI summarizes the abandoned branch',
            color: theme.info,
            theme: theme,
            onTap: () => onChoice(_SummarizeChoice.summarize),
          ),
          const SizedBox(height: 8),
          _ChoiceTile(
            icon: AppIcons.edit,
            label: 'Summarize with custom prompt',
            subtitle: 'Provide your own instructions',
            color: theme.accent,
            theme: theme,
            onTap: () => onChoice(_SummarizeChoice.custom),
          ),
        ],
      ),
    );
  }
}

class _ChoiceTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String subtitle;
  final Color color;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  const _ChoiceTile({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.color,
    required this.theme,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: theme.backgroundElement,
      borderRadius: Radii.brSm,
      child: InkWell(
        borderRadius: Radii.brSm,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Icon(icon, size: 18, color: color),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: AppTypography.labelLarge(color: theme.text),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      subtitle,
                      style: AppTypography.caption(color: theme.textMuted),
                    ),
                  ],
                ),
              ),
              Icon(AppIcons.chevronRight, size: 14, color: theme.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Loading View ──────────────────────────────────────────────────

class _LoadingView extends StatelessWidget {
  final OpenCodeTheme theme;
  final bool summarizing;
  const _LoadingView({required this.theme, required this.summarizing});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(height: 16),
          Text(
            'Navigating…',
            style: AppTypography.labelLarge(color: theme.text),
          ),
          const SizedBox(height: 4),
          Text(
            summarizing
                ? 'Summarizing branch and switching context'
                : 'Switching context…',
            style: AppTypography.caption(color: theme.textMuted),
          ),
        ],
      ),
    );
  }
}
