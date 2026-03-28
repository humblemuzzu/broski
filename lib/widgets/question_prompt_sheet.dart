import 'package:broski/models/question.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

class QuestionPromptSheet extends StatefulWidget {
  const QuestionPromptSheet({
    super.key,
    required this.request,
    required this.onReply,
    required this.onReject,
  });
  final QuestionRequest request;
  final void Function(List<List<String>> answers) onReply;
  final VoidCallback onReject;
  @override
  State<QuestionPromptSheet> createState() => _QuestionPromptSheetState();
}

class _QuestionPromptSheetState extends State<QuestionPromptSheet> {
  late final List<List<String>> _answers;
  late final List<String> _custom;
  late int _currentPage;
  bool _submitted = false;
  int get _totalQuestions => widget.request.questions.length;
  bool get _isSingle => _totalQuestions == 1;
  @override
  void initState() {
    super.initState();
    _answers = List.generate(_totalQuestions, (_) => <String>[]);
    _custom = List.generate(_totalQuestions, (_) => '');
    _currentPage = 0;
  }

  bool get _currentAnswered {
    final a = _answers[_currentPage];
    return a.any((s) => s.trim().isNotEmpty);
  }

  bool get _allAnswered {
    for (final a in _answers) {
      if (!a.any((s) => s.trim().isNotEmpty)) return false;
    }
    return true;
  }

  void _submit() {
    if (_submitted) return;
    setState(() => _submitted = true);
    widget.onReply(_answers);
  }

  void _dismiss() {
    if (_submitted) return;
    setState(() => _submitted = true);
    widget.onReject();
  }

  void _pickSingle(int qi, String value) {
    setState(() {
      _answers[qi]
        ..clear()
        ..add(value);
    });
    // Single question with single-select: auto-submit
    if (_isSingle && widget.request.questions.first.multiple != true) {
      _submit();
      return;
    }
    // Multi-question: auto-advance
    if (_currentPage < _totalQuestions - 1) {
      Future.delayed(const Duration(milliseconds: 200), () {
        if (mounted) setState(() => _currentPage++);
      });
    }
  }

  void _toggleMulti(int qi, String value) {
    setState(() {
      final existing = _answers[qi];
      if (existing.contains(value)) {
        existing.remove(value);
      } else {
        existing.add(value);
      }
    });
  }

  Future<void> _editCustom(int qi, {required bool multiple}) async {
    final theme = OpenCodeTheme.of(context);
    final controller = TextEditingController(text: _custom[qi]);
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: theme.bgSheet,
          shape: RoundedRectangleBorder(
            borderRadius: Radii.brLg,
            side: BorderSide(color: theme.borderSubtle.withValues(alpha: 0.3)),
          ),
          title: Text(
            'Custom answer',
            style: TextStyle(
              color: theme.text,
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
          content: TextField(
            controller: controller,
            autofocus: true,
            maxLines: 3,
            style: AppTypography.labelLarge(color: theme.text),
            decoration: InputDecoration(
              hintText: 'Type your answer...',
              hintStyle: TextStyle(
                color: theme.textMuted.withValues(alpha: 0.5),
              ),
              filled: true,
              fillColor: theme.bgRaised,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 12,
              ),
              border: OutlineInputBorder(
                borderRadius: Radii.brMd,
                borderSide: BorderSide(
                  color: theme.borderSubtle.withValues(alpha: 0.3),
                ),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: Radii.brMd,
                borderSide: BorderSide(
                  color: theme.borderSubtle.withValues(alpha: 0.3),
                ),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: Radii.brMd,
                borderSide: BorderSide(color: theme.primary, width: 1.5),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(
                'Cancel',
                style: AppTypography.bodySmall(color: theme.textMuted),
              ),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, controller.text.trim()),
              child: Text(
                'Save',
                style: TextStyle(
                  color: theme.primary,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        );
      },
    );
    if (result == null) return;
    setState(() {
      final prev = _custom[qi];
      _custom[qi] = result;
      if (multiple) {
        if (prev.isNotEmpty) _answers[qi].remove(prev);
        if (result.isNotEmpty && !_answers[qi].contains(result)) {
          _answers[qi].add(result);
        }
      } else {
        _answers[qi]
          ..clear()
          ..add(result);
      }
    });
    // Single question auto-submit for custom answer too
    if (_isSingle && widget.request.questions.first.multiple != true) {
      if (_answers[0].any((s) => s.trim().isNotEmpty)) _submit();
      return;
    }
    if (!multiple && _currentPage < _totalQuestions - 1) {
      Future.delayed(const Duration(milliseconds: 200), () {
        if (mounted) setState(() => _currentPage++);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final question = widget.request.questions[_currentPage];
    return SafeArea(
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        decoration: BoxDecoration(
          color: theme.bgSheet,
          borderRadius: Radii.sheetTop,
          border: Border(
            top: BorderSide(color: theme.borderSubtle.withValues(alpha: 0.2)),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _buildHeader(theme),
            if (!_isSingle) _buildProgressDots(theme),
            Flexible(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
                child: _buildQuestionBody(theme, question, _currentPage),
              ),
            ),
            _buildFooter(theme),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(OpenCodeTheme theme) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 14, 12, 0),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: theme.primary.withValues(alpha: 0.12),
              borderRadius: Radii.brMd,
            ),
            child: Icon(AppIcons.help, size: 17, color: theme.primary),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Agent question',
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.3,
                  ),
                ),
                if (!_isSingle)
                  Text(
                    '${_currentPage + 1} of $_totalQuestions',
                    style: AppTypography.label(color: theme.textMuted),
                  ),
              ],
            ),
          ),
          IconButton(
            onPressed: _submitted ? null : _dismiss,
            icon: Icon(AppIcons.close, size: 20, color: theme.textMuted),
            style: IconButton.styleFrom(
              backgroundColor: theme.bgRaised,
              shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
              minimumSize: const Size(36, 36),
              maximumSize: const Size(36, 36),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProgressDots(OpenCodeTheme theme) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(_totalQuestions, (i) {
          final isActive = i == _currentPage;
          final isDone = _answers[i].any((s) => s.trim().isNotEmpty);
          return AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            width: isActive ? 20 : 6,
            height: 6,
            margin: const EdgeInsets.symmetric(horizontal: 3),
            decoration: BoxDecoration(
              color: isActive
                  ? theme.primary
                  : isDone
                  ? theme.primary.withValues(alpha: 0.4)
                  : theme.borderSubtle.withValues(alpha: 0.4),
              borderRadius: Radii.brXs,
            ),
          );
        }),
      ),
    );
  }

  Widget _buildQuestionBody(
    OpenCodeTheme theme,
    QuestionInfo question,
    int qi,
  ) {
    final opts = question.options;
    final isMultiple = question.multiple;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(height: Spacing.lg),
        // Question text
        Text(
          question.question,
          style: TextStyle(
            color: theme.text,
            fontSize: 14,
            fontWeight: FontWeight.w500,
            height: 1.4,
          ),
        ),
        const SizedBox(height: 14),
        // Options as chips/cards
        Flexible(
          child: ListView(
            shrinkWrap: true,
            padding: EdgeInsets.zero,
            children: [
              for (final opt in opts)
                _OptionTile(
                  label: opt.label,
                  description: opt.description,
                  isSelected: _answers[qi].contains(opt.label),
                  isMultiple: isMultiple,
                  theme: theme,
                  onTap: _submitted
                      ? null
                      : () {
                          if (isMultiple) {
                            _toggleMulti(qi, opt.label);
                          } else {
                            _pickSingle(qi, opt.label);
                          }
                        },
                ),
              // Custom answer option — only shown when question.custom != false
              if (question.custom)
                _OptionTile(
                  label: _custom[qi].trim().isEmpty
                      ? 'Type your own answer'
                      : _custom[qi],
                  description: '',
                  isSelected:
                      _custom[qi].trim().isNotEmpty &&
                      _answers[qi].contains(_custom[qi]),
                  isMultiple: isMultiple,
                  isCustom: true,
                  theme: theme,
                  onTap: _submitted
                      ? null
                      : () => _editCustom(qi, multiple: isMultiple),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildFooter(OpenCodeTheme theme) {
    final showBackNext = !_isSingle;
    final isLast = _currentPage == _totalQuestions - 1;
    final isFirst = _currentPage == 0;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
      child: Row(
        children: [
          if (showBackNext && !isFirst)
            _FooterButton(
              label: 'Back',
              theme: theme,
              onTap: () => setState(() => _currentPage--),
            ),
          const Spacer(),
          if (showBackNext && !isLast)
            _FooterButton(
              label: 'Next',
              theme: theme,
              isPrimary: _currentAnswered,
              onTap: _currentAnswered
                  ? () => setState(() => _currentPage++)
                  : null,
            ),
          if (showBackNext && isLast)
            _FooterButton(
              label: 'Submit',
              theme: theme,
              isPrimary: _allAnswered,
              onTap: (_allAnswered && !_submitted) ? _submit : null,
            ),
          // Single question with multiple: show submit
          if (_isSingle && widget.request.questions.first.multiple == true)
            _FooterButton(
              label: 'Submit',
              theme: theme,
              isPrimary: _currentAnswered,
              onTap: (_currentAnswered && !_submitted) ? _submit : null,
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Option tile - modern card-style option
// ---------------------------------------------------------------------------
class _OptionTile extends StatelessWidget {
  const _OptionTile({
    required this.label,
    required this.description,
    required this.isSelected,
    required this.isMultiple,
    required this.theme,
    this.isCustom = false,
    this.onTap,
  });
  final String label;
  final String description;
  final bool isSelected;
  final bool isMultiple;
  final bool isCustom;
  final OpenCodeTheme theme;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: Insets.bottomSm,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: Radii.brMd,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: isSelected
                  ? theme.primary.withValues(alpha: 0.08)
                  : theme.bgRaised,
              borderRadius: Radii.brMd,
              border: Border.all(
                color: isSelected
                    ? theme.primary.withValues(alpha: 0.5)
                    : theme.borderSubtle.withValues(alpha: 0.2),
                width: isSelected ? 1.5 : 1,
              ),
            ),
            child: Row(
              children: [
                // Selection indicator
                AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  width: 20,
                  height: 20,
                  decoration: BoxDecoration(
                    color: isSelected ? theme.primary : Colors.transparent,
                    shape: isMultiple ? BoxShape.rectangle : BoxShape.circle,
                    borderRadius: isMultiple ? BorderRadius.circular(5) : null,
                    border: Border.all(
                      color: isSelected
                          ? theme.primary
                          : theme.textMuted.withValues(alpha: 0.3),
                      width: 1.5,
                    ),
                  ),
                  child: isSelected
                      ? Icon(AppIcons.check, size: 14, color: theme.bgSheet)
                      : isCustom
                      ? Icon(
                          AppIcons.edit,
                          size: 11,
                          color: theme.textMuted.withValues(alpha: 0.4),
                        )
                      : null,
                ),
                const SizedBox(width: Spacing.md),
                // Label + description
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: TextStyle(
                          color: isSelected
                              ? theme.text
                              : theme.text.withValues(alpha: 0.85),
                          fontSize: 13.5,
                          fontWeight: isSelected
                              ? FontWeight.w600
                              : FontWeight.w400,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (description.isNotEmpty) ...[
                        const SizedBox(height: Spacing.xxs),
                        Text(
                          description,
                          style: TextStyle(
                            color: theme.textMuted.withValues(alpha: 0.7),
                            fontSize: 12,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Footer button
// ---------------------------------------------------------------------------
class _FooterButton extends StatelessWidget {
  const _FooterButton({
    required this.label,
    required this.theme,
    this.isPrimary = false,
    this.onTap,
  });
  final String label;
  final OpenCodeTheme theme;
  final bool isPrimary;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        decoration: BoxDecoration(
          color: isPrimary && enabled ? theme.primary : theme.bgRaised,
          borderRadius: Radii.brMd,
          border: Border.all(
            color: isPrimary && enabled
                ? theme.primary
                : theme.borderSubtle.withValues(alpha: 0.2),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isPrimary && enabled
                ? theme.selectedListItemText
                : enabled
                ? theme.text
                : theme.textMuted.withValues(alpha: 0.4),
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
