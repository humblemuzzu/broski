import 'package:flutter/material.dart';
import '../models/message.dart';
import '../screens/diff_view_screen.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import '../utils/diff_utils.dart';

class PermissionPrompt extends StatefulWidget {
  const PermissionPrompt({
    super.key,
    required this.request,
    required this.onApprove,
    required this.onDeny,
    required this.onAlwaysAllow,
    this.approveOnceLabel = 'Once',
    this.approveAlwaysLabel = 'Always',
    this.onApproveForSession,
    this.approveForSessionLabel = 'Session',
    this.onApproveWithExecpolicy,
    this.approveWithExecpolicyLabel,
    this.onDenyWithMessage,
  });

  final PermissionRequest request;
  final VoidCallback onApprove;
  final VoidCallback onDeny;
  final VoidCallback onAlwaysAllow;
  final String approveOnceLabel;
  final String approveAlwaysLabel;

  /// Called when user approves for current session only (SDK feature)
  final VoidCallback? onApproveForSession;
  final String approveForSessionLabel;

  final VoidCallback? onApproveWithExecpolicy;
  final String? approveWithExecpolicyLabel;

  /// Called when user wants to deny with a feedback message
  final void Function(String message)? onDenyWithMessage;

  @override
  State<PermissionPrompt> createState() => _PermissionPromptState();
}

class _PermissionPromptState extends State<PermissionPrompt> {
  bool _showRejectFeedback = false;
  final _feedbackController = TextEditingController();
  final _feedbackFocusNode = FocusNode();

  @override
  void dispose() {
    _feedbackController.dispose();
    _feedbackFocusNode.dispose();
    super.dispose();
  }

  IconData _getPermissionIcon() {
    switch (widget.request.permission) {
      case 'edit':
        return Icons.edit_note_rounded;
      case 'bash':
        return Icons.terminal_rounded;
      case 'read':
        return Icons.visibility_rounded;
      case 'write':
        return Icons.save_rounded;
      default:
        return Icons.security_rounded;
    }
  }

  Color _getPermissionColor(OpenCodeTheme theme) {
    switch (widget.request.permission) {
      case 'edit':
        return theme.warning;
      case 'bash':
        return theme.error;
      case 'read':
        return theme.success;
      case 'write':
        return theme.warning;
      default:
        return theme.accent;
    }
  }

  /// Check if this is a doom loop permission request
  bool get _isDoomLoop {
    return widget.request.permission == 'doom_loop' ||
        (widget.request.metadata['type'] as String?) == 'doom_loop' ||
        (widget.request.metadata['doomLoop'] == true);
  }

  void _handleRejectTap() {
    setState(() {
      _showRejectFeedback = true;
    });
    // Focus the text field after expansion animation
    Future.delayed(const Duration(milliseconds: 200), () {
      _feedbackFocusNode.requestFocus();
    });
  }

  void _handleCancelReject() {
    setState(() {
      _showRejectFeedback = false;
      _feedbackController.clear();
    });
  }

  void _handleConfirmReject() {
    final message = _feedbackController.text.trim();
    if (message.isNotEmpty && widget.onDenyWithMessage != null) {
      widget.onDenyWithMessage!(message);
    } else {
      widget.onDeny();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final diffText = widget.request.metadata['diff'] as String?;
    final filePath =
        widget.request.metadata['filePath'] as String? ??
        widget.request.metadata['filepath'] as String? ??
        widget.request.metadata['path'] as String?;

    final permissionColor = _getPermissionColor(theme);

    // Use DraggableScrollableSheet to handle large content that exceeds screen
    return DraggableScrollableSheet(
      initialChildSize: 0.5,
      minChildSize: 0.25,
      maxChildSize: 0.9,
      expand: false,
      builder: (context, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: theme.background,
            borderRadius: Radii.sheetTop,
          ),
          child: Column(
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

              // Scrollable content area
              Expanded(
                child: SingleChildScrollView(
                  controller: scrollController,
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Header with permission type icon
                      Row(
                        children: [
                          Container(
                            padding: Insets.cardXs,
                            decoration: BoxDecoration(
                              color: permissionColor.withValues(alpha: 0.15),
                              borderRadius: Radii.brMd,
                            ),
                            child: Icon(
                              _getPermissionIcon(),
                              color: permissionColor,
                              size: 20,
                            ),
                          ),
                          SizedBox(width: Spacing.md),
                          Expanded(
                            child: Text(
                              widget.request.displayTitle,
                              style: Theme.of(context).textTheme.titleMedium
                                  ?.copyWith(fontWeight: FontWeight.w600),
                            ),
                          ),
                        ],
                      ),
                      SizedBox(height: Spacing.md),

                      // Task 5: Doom loop custom text
                      if (_isDoomLoop) ...[
                        Container(
                          width: double.infinity,
                          padding: Insets.cardSm,
                          decoration: BoxDecoration(
                            color: theme.warning.withValues(alpha: 0.1),
                            borderRadius: Radii.brMd,
                            border: Border.all(
                              color: theme.warning.withValues(alpha: 0.3),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Icon(
                                    Icons.loop_rounded,
                                    color: theme.warning,
                                    size: 18,
                                  ),
                                  SizedBox(width: Spacing.sm),
                                  Text(
                                    'Repeated tool call detected',
                                    style: TextStyle(
                                      color: theme.warning,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                              SizedBox(height: Spacing.sm),
                              Text(
                                'The AI has called the same tool repeatedly with identical inputs. '
                                'Allow it to continue or reject to break the loop.',
                                style: TextStyle(
                                  color: theme.text,
                                  fontSize: 13,
                                  height: 1.4,
                                ),
                              ),
                            ],
                          ),
                        ),
                        SizedBox(height: Spacing.md),
                      ],

                      // Show patterns if available (SDK v1.1.1+)
                      if (widget.request.patterns.isNotEmpty) ...[
                        _PatternsSection(
                          patterns: widget.request.patterns,
                          theme: theme,
                          label: widget.request.isBatchRequest
                              ? 'Files affected'
                              : null,
                        ),
                        SizedBox(height: Spacing.md),
                      ] else if (widget.request.title.isNotEmpty &&
                          widget.request.title !=
                              widget.request.displayTitle) ...[
                        Text(
                          widget.request.title,
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                        SizedBox(height: Spacing.sm),
                      ],

                      // Legacy command display
                      if (widget.request.command != null) ...[
                        Container(
                          width: double.infinity,
                          padding: Insets.cardSm,
                          decoration: BoxDecoration(
                            color: theme.backgroundElement,
                            borderRadius: Radii.brMd,
                            border: Border.all(color: theme.borderSubtle),
                          ),
                          child: Text(
                            widget.request.command!,
                            style: AppTypography.codeSmall(color: theme.text),
                          ),
                        ),
                        SizedBox(height: Spacing.md),
                      ],

                      // Show diff preview if available
                      if (diffText != null && diffText.trim().isNotEmpty) ...[
                        Text(
                          'Proposed changes',
                          style: TextStyle(
                            color: theme.text,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 10),
                        _PermissionDiffPreview(
                          diffText: diffText,
                          filePath: filePath,
                        ),
                        SizedBox(height: Spacing.md),
                      ],

                      // Show "always allow" preview if available (SDK v1.1.1+)
                      if (widget.request.always.isNotEmpty) ...[
                        _AlwaysAllowPreview(
                          always: widget.request.always,
                          theme: theme,
                        ),
                        SizedBox(height: Spacing.md),
                      ],
                    ],
                  ),
                ),
              ),

              // Divider before pinned buttons
              Divider(height: 1, color: theme.borderSubtle),

              // Pinned action buttons at bottom (always visible)
              Container(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                child: SafeArea(
                  top: false,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Expandable rejection feedback field (Phase 3)
                      AnimatedCrossFade(
                        firstChild: const SizedBox.shrink(),
                        secondChild: _RejectFeedbackSection(
                          controller: _feedbackController,
                          focusNode: _feedbackFocusNode,
                          theme: theme,
                          onCancel: _handleCancelReject,
                          onConfirm: _handleConfirmReject,
                        ),
                        crossFadeState: _showRejectFeedback
                            ? CrossFadeState.showSecond
                            : CrossFadeState.showFirst,
                        duration: const Duration(milliseconds: 200),
                      ),

                      // Action buttons (hidden when showing feedback)
                      if (!_showRejectFeedback)
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            // Row 1: Reject | Once
                            Row(
                              children: [
                                Expanded(
                                  child: OutlinedButton(
                                    onPressed: _handleRejectTap,
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: theme.error,
                                      side: BorderSide(
                                        color: theme.error.withValues(
                                          alpha: 0.5,
                                        ),
                                      ),
                                    ),
                                    child: const Text('Reject'),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: OutlinedButton(
                                    onPressed: widget.onApprove,
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: theme.accent,
                                      side: BorderSide(
                                        color: theme.accent.withValues(
                                          alpha: 0.5,
                                        ),
                                      ),
                                    ),
                                    child: Text(widget.approveOnceLabel),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            // Row 2: Session | Always
                            Row(
                              children: [
                                // Session button - only show if callback provided
                                if (widget.onApproveForSession != null) ...[
                                  Expanded(
                                    child: OutlinedButton.icon(
                                      onPressed: widget.onApproveForSession,
                                      icon: const Icon(
                                        Icons.timer_outlined,
                                        size: 16,
                                      ),
                                      label: Text(
                                        widget.approveForSessionLabel,
                                      ),
                                      style: OutlinedButton.styleFrom(
                                        foregroundColor: theme.info,
                                        side: BorderSide(
                                          color: theme.info.withValues(
                                            alpha: 0.5,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                ],
                                Expanded(
                                  child: ElevatedButton(
                                    onPressed: widget.onAlwaysAllow,
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: theme.accent,
                                      foregroundColor: theme.selectedListItemText,
                                    ),
                                    child: Text(widget.approveAlwaysLabel),
                                  ),
                                ),
                              ],
                            ),
                            // Execpolicy prefix learning button
                            if (widget.onApproveWithExecpolicy != null) ...[
                              const SizedBox(height: 10),
                              OutlinedButton.icon(
                                onPressed: widget.onApproveWithExecpolicy,
                                icon: const Icon(
                                  Icons.auto_fix_high_rounded,
                                  size: 18,
                                ),
                                label: Text(
                                  widget.approveWithExecpolicyLabel ??
                                      'Always allow this command prefix',
                                ),
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: theme.info,
                                  side: BorderSide(
                                    color: theme.info.withValues(alpha: 0.4),
                                  ),
                                  padding: const EdgeInsets.symmetric(
                                    vertical: 12,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Expandable rejection feedback section
class _RejectFeedbackSection extends StatelessWidget {
  const _RejectFeedbackSection({
    required this.controller,
    required this.focusNode,
    required this.theme,
    required this.onCancel,
    required this.onConfirm,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final OpenCodeTheme theme;
  final VoidCallback onCancel;
  final VoidCallback onConfirm;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Tell the AI why? (optional)',
          style: TextStyle(
            color: theme.textMuted,
            fontSize: 12,
            fontWeight: FontWeight.w500,
          ),
        ),
        SizedBox(height: Spacing.sm),
        TextField(
          controller: controller,
          focusNode: focusNode,
          maxLines: 2,
          style: AppTypography.labelLarge(color: theme.text),
          decoration: InputDecoration(
            hintText: 'e.g., "Use a different approach..." ',
            hintStyle: AppTypography.labelLarge(color: theme.textMuted),
            filled: true,
            fillColor: theme.backgroundElement,
            border: OutlineInputBorder(
              borderRadius: Radii.brMd,
              borderSide: BorderSide(color: theme.borderSubtle),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: Radii.brMd,
              borderSide: BorderSide(color: theme.borderSubtle),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: Radii.brMd,
              borderSide: BorderSide(color: theme.error),
            ),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 12,
            ),
          ),
        ),
        SizedBox(height: Spacing.md),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: onCancel,
                style: OutlinedButton.styleFrom(
                  foregroundColor: theme.textMuted,
                  side: BorderSide(color: theme.borderSubtle),
                ),
                child: const Text('Cancel'),
              ),
            ),
            SizedBox(width: Spacing.md),
            Expanded(
              child: ElevatedButton(
                onPressed: onConfirm,
                style: ElevatedButton.styleFrom(
                  backgroundColor: theme.error,
                  foregroundColor: theme.selectedListItemText,
                ),
                child: const Text('Send Rejection'),
              ),
            ),
          ],
        ),
        SizedBox(height: Spacing.sm),
      ],
    );
  }
}

/// Shows the file patterns affected by this permission request
class _PatternsSection extends StatelessWidget {
  const _PatternsSection({
    required this.patterns,
    required this.theme,
    this.label,
  });

  final List<String> patterns;
  final OpenCodeTheme theme;
  final String? label;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(
              label!,
              style: TextStyle(
                color: theme.textMuted,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: patterns.map((pattern) {
            return Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: theme.backgroundElement,
                borderRadius: Radii.brSm,
                border: Border.all(color: theme.borderSubtle),
              ),
              child: Text(
                pattern,
                style: AppTypography.codeSmall(color: theme.text),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }
}

/// Shows what "Always Allow" will permit
class _AlwaysAllowPreview extends StatelessWidget {
  const _AlwaysAllowPreview({required this.always, required this.theme});

  final List<String> always;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: theme.success.withValues(alpha: 0.08),
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.success.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.check_circle_outline_rounded,
                size: 14,
                color: theme.success,
              ),
              const SizedBox(width: 6),
              Text(
                '"Always" will also allow:',
                style: TextStyle(
                  color: theme.success,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
          SizedBox(height: Spacing.sm),
          ...always
              .take(5)
              .map(
                (pattern) => Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    children: [
                      Text(
                        '\u2022 ',
                        style: AppTypography.label(color: theme.textMuted),
                      ),
                      Expanded(
                        child: Text(
                          pattern,
                          style: AppTypography.codeSmall(color: theme.text),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          if (always.length > 5)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '...and ${always.length - 5} more',
                style: TextStyle(
                  color: theme.textMuted,
                  fontSize: 11,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _PermissionDiffPreview extends StatelessWidget {
  const _PermissionDiffPreview({required this.diffText, this.filePath});

  final String diffText;
  final String? filePath;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final parsed = UnifiedDiff.parse(diffText);
    final preview = <DiffLine>[];
    for (final line in parsed) {
      if (line.kind == DiffLineKind.header ||
          line.kind == DiffLineKind.hunk ||
          line.kind == DiffLineKind.meta) {
        continue;
      }
      preview.add(line);
      if (preview.length >= 10) break;
    }

    final (adds, dels) = _countAddsDels(parsed);

    return Container(
      width: double.infinity,
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brLg,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (preview.isEmpty)
            Text(
              'No preview available',
              style: AppTypography.codeSmall(color: theme.textMuted),
            )
          else
            Column(
              children: [for (final line in preview) _PreviewRow(line: line)],
            ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => DiffViewScreen(
                      diff: DiffEntry(
                        file: filePath ?? 'file',
                        before: '',
                        after: '',
                        additions: adds,
                        deletions: dels,
                        diff: diffText,
                      ),
                    ),
                  ),
                );
              },
              icon: const Icon(Icons.open_in_full_rounded, size: 16),
              label: const Text('View full'),
            ),
          ),
        ],
      ),
    );
  }

  (int, int) _countAddsDels(List<DiffLine> lines) {
    var adds = 0;
    var dels = 0;
    for (final line in lines) {
      if (line.kind == DiffLineKind.added) adds++;
      if (line.kind == DiffLineKind.removed) dels++;
    }
    return (adds, dels);
  }
}

class _PreviewRow extends StatelessWidget {
  const _PreviewRow({required this.line});

  final DiffLine line;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final bg = switch (line.kind) {
      DiffLineKind.added => theme.success.withValues(alpha: 0.12),
      DiffLineKind.removed => theme.error.withValues(alpha: 0.12),
      _ => Colors.transparent,
    };
    final fg = switch (line.kind) {
      DiffLineKind.added => theme.success,
      DiffLineKind.removed => theme.error,
      _ => theme.text,
    };
    final prefix = switch (line.kind) {
      DiffLineKind.added => '+',
      DiffLineKind.removed => '-',
      _ => ' ',
    };

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 2),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: Radii.brMd,
      ),
      child: Text(
        '$prefix ${line.text.isEmpty ? ' ' : line.text}',
        style: AppTypography.codeSmall(color: fg).copyWith(height: 1.35),
      ),
    );
  }
}
