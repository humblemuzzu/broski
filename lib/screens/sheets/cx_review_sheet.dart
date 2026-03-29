import 'package:broski/screens/chat/codex_actions.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The three review target types supported by the Codex review API.
enum _ReviewTargetType { uncommittedChanges, baseBranch, commit }

/// Shows a sheet letting the user choose what to review before starting
/// a Codex code review.
void showCxReviewSheet(
  BuildContext context,
  WidgetRef ref, {
  required String? cwd,
}) {
  DetailSheet.show(
    context: context,
    title: 'Code Review',
    initialSize: 0.45,
    child: _CxReviewSheetContent(cwd: cwd),
  );
}

class _CxReviewSheetContent extends ConsumerStatefulWidget {
  final String? cwd;
  const _CxReviewSheetContent({required this.cwd});

  @override
  ConsumerState<_CxReviewSheetContent> createState() =>
      _CxReviewSheetContentState();
}

class _CxReviewSheetContentState extends ConsumerState<_CxReviewSheetContent> {
  _ReviewTargetType _selected = _ReviewTargetType.uncommittedChanges;
  final _branchController = TextEditingController(text: 'main');
  final _commitController = TextEditingController();

  @override
  void dispose() {
    _branchController.dispose();
    _commitController.dispose();
    super.dispose();
  }

  Map<String, dynamic> _buildTarget() {
    return switch (_selected) {
      _ReviewTargetType.uncommittedChanges => const {
        'type': 'uncommittedChanges',
      },
      _ReviewTargetType.baseBranch => {
        'type': 'baseBranch',
        'baseBranch': _branchController.text.trim().isEmpty
            ? 'main'
            : _branchController.text.trim(),
      },
      _ReviewTargetType.commit => {
        'type': 'commit',
        'commit': _commitController.text.trim(),
      },
    };
  }

  bool get _canStart {
    if (_selected == _ReviewTargetType.commit) {
      return _commitController.text.trim().isNotEmpty;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Padding(
      padding: Insets.screenH,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Review target',
            style: TextStyle(
              color: theme.textMuted,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: Spacing.sm),
          _buildOption(
            theme: theme,
            type: _ReviewTargetType.uncommittedChanges,
            title: 'Uncommitted Changes',
            subtitle: 'Review all uncommitted work in the working tree',
          ),
          _buildOption(
            theme: theme,
            type: _ReviewTargetType.baseBranch,
            title: 'Against Branch',
            subtitle: 'Review diff against a base branch',
          ),
          if (_selected == _ReviewTargetType.baseBranch)
            _buildTextField(
              theme: theme,
              controller: _branchController,
              hint: 'Branch name (e.g. main)',
            ),
          _buildOption(
            theme: theme,
            type: _ReviewTargetType.commit,
            title: 'Specific Commit',
            subtitle: 'Review a single commit by SHA',
          ),
          if (_selected == _ReviewTargetType.commit)
            _buildTextField(
              theme: theme,
              controller: _commitController,
              hint: 'Commit SHA (e.g. abc123)',
            ),
          const SizedBox(height: Spacing.lg),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _canStart ? _onStart : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: theme.primary,
                foregroundColor: theme.background,
                disabledBackgroundColor: theme.primary.withValues(alpha: 0.3),
                disabledForegroundColor: theme.background.withValues(
                  alpha: 0.5,
                ),
                shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
                padding: const EdgeInsets.symmetric(vertical: Spacing.md),
              ),
              child: Text(
                'Start Review',
                style: AppTypography.bodySmall(
                  color: theme.background,
                ).copyWith(fontWeight: FontWeight.w600),
              ),
            ),
          ),
          const SizedBox(height: Spacing.md),
        ],
      ),
    );
  }

  Widget _buildOption({
    required OpenCodeTheme theme,
    required _ReviewTargetType type,
    required String title,
    required String subtitle,
  }) {
    final isSelected = _selected == type;
    return InkWell(
      onTap: () => setState(() => _selected = type),
      borderRadius: Radii.brSm,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Spacing.xs),
        child: Row(
          children: [
            Icon(
              isSelected ? AppIcons.radioChecked : AppIcons.radioUnchecked,
              size: 20,
              color: isSelected ? theme.primary : theme.textMuted,
            ),
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: isSelected ? theme.text : theme.textMuted,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: AppTypography.label(color: theme.textMuted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTextField({
    required OpenCodeTheme theme,
    required TextEditingController controller,
    required String hint,
  }) {
    return Padding(
      padding: const EdgeInsets.only(
        left: Spacing.xxxl + Spacing.sm,
        bottom: Spacing.xs,
      ),
      child: TextField(
        controller: controller,
        onChanged: (_) => setState(() {}),
        style: TextStyle(color: theme.text, fontSize: 13),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: TextStyle(color: theme.textMuted, fontSize: 13),
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: Spacing.md,
            vertical: Spacing.sm,
          ),
          filled: true,
          fillColor: theme.bgRaised,
          border: OutlineInputBorder(
            borderRadius: Radii.brSm,
            borderSide: BorderSide(
              color: theme.borderSubtle.withValues(alpha: 0.3),
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: Radii.brSm,
            borderSide: BorderSide(
              color: theme.borderSubtle.withValues(alpha: 0.3),
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: Radii.brSm,
            borderSide: BorderSide(color: theme.primary),
          ),
        ),
      ),
    );
  }

  void _onStart() {
    final target = _buildTarget();
    Navigator.pop(context);
    startCodexReview(ref: ref, cwd: widget.cwd, target: target);
  }
}
