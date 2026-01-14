import 'package:flutter/material.dart';

import '../models/question.dart';
import '../theme/opencode_theme.dart';

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

class _QuestionPromptSheetState extends State<QuestionPromptSheet>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  late final List<List<String>> _answers;
  late final List<String> _custom;

  bool get _isSingleAutoSubmit {
    if (widget.request.questions.length != 1) return false;
    return widget.request.questions.first.multiple != true;
  }

  @override
  void initState() {
    super.initState();
    final qCount = widget.request.questions.length;
    _answers = List.generate(qCount, (_) => <String>[]);
    _custom = List.generate(qCount, (_) => '');
    _tabController = TabController(
      length: _isSingleAutoSubmit ? qCount : qCount + 1,
      vsync: this,
    );
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _editOther(int qIndex, {required bool multiple}) async {
    final theme = OpenCodeTheme.of(context);
    final controller = TextEditingController(text: _custom[qIndex]);
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: theme.backgroundPanel,
          title: Text('Other', style: TextStyle(color: theme.text)),
          content: TextField(
            controller: controller,
            autofocus: true,
            maxLines: 3,
            style: TextStyle(color: theme.text),
            decoration: InputDecoration(
              hintText: 'Type your answer…',
              hintStyle: TextStyle(color: theme.textMuted),
              filled: true,
              fillColor: theme.backgroundElement,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text('Cancel', style: TextStyle(color: theme.textMuted)),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, controller.text.trim()),
              child: Text('Save', style: TextStyle(color: theme.primary)),
            ),
          ],
        );
      },
    );
    if (result == null) return;

    setState(() {
      final prev = _custom[qIndex];
      _custom[qIndex] = result;
      if (multiple) {
        if (prev.isNotEmpty) {
          _answers[qIndex].remove(prev);
        }
        if (result.isNotEmpty && !_answers[qIndex].contains(result)) {
          _answers[qIndex].add(result);
        }
      } else {
        _answers[qIndex]
          ..clear()
          ..add(result);
      }
    });

    if (_isSingleAutoSubmit) {
      final answer = _answers.first.where((a) => a.trim().isNotEmpty).toList();
      widget.onReply([answer]);
      return;
    }

    if (!multiple && _tabController.index < _tabController.length - 1) {
      _tabController.animateTo(_tabController.index + 1);
    }
  }

  void _pickSingle(int qIndex, String value) {
    setState(() {
      _answers[qIndex]
        ..clear()
        ..add(value);
    });

    if (_isSingleAutoSubmit) {
      widget.onReply([<String>[value]]);
      return;
    }

    if (_tabController.index < _tabController.length - 1) {
      _tabController.animateTo(_tabController.index + 1);
    }
  }

  void _toggleMulti(int qIndex, String value) {
    setState(() {
      final existing = _answers[qIndex];
      if (existing.contains(value)) {
        existing.remove(value);
      } else {
        existing.add(value);
      }
    });
  }

  bool _isOtherSelected(int qIndex) {
    final v = _custom[qIndex];
    if (v.trim().isEmpty) return false;
    return _answers[qIndex].contains(v);
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final questions = widget.request.questions;

    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          border: Border(
            top: BorderSide(color: theme.borderSubtle.withValues(alpha: 0.5)),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: theme.textMuted.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(3),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Quick question',
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                TextButton(
                  onPressed: widget.onReject,
                  child: Text('Dismiss', style: TextStyle(color: theme.textMuted)),
                ),
              ],
            ),
            if (!_isSingleAutoSubmit) ...[
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: TabBar(
                  controller: _tabController,
                  isScrollable: true,
                  indicatorColor: theme.primary,
                  labelColor: theme.text,
                  unselectedLabelColor: theme.textMuted,
                  tabs: [
                    for (final q in questions)
                      Tab(text: q.header.isNotEmpty ? q.header : 'Q'),
                    const Tab(text: 'Confirm'),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 12),
            Flexible(
              child: TabBarView(
                controller: _tabController,
                children: [
                  for (var qi = 0; qi < questions.length; qi++)
                    _QuestionTab(
                      question: questions[qi],
                      theme: theme,
                      multiple: questions[qi].multiple,
                      selected: _answers[qi],
                      otherPicked: _isOtherSelected(qi),
                      otherText: _custom[qi],
                      onPickSingle: (v) => _pickSingle(qi, v),
                      onToggleMulti: (v) => _toggleMulti(qi, v),
                      onEditOther: () =>
                          _editOther(qi, multiple: questions[qi].multiple),
                      showNext: !_isSingleAutoSubmit,
                      onNext: () {
                        if (_tabController.index < _tabController.length - 1) {
                          _tabController.animateTo(_tabController.index + 1);
                        }
                      },
                    ),
                  if (!_isSingleAutoSubmit)
                    _ConfirmTab(
                      theme: theme,
                      questions: questions,
                      answers: _answers,
                      onSubmit: () => widget.onReply(_answers),
                      onBack: () {
                        if (_tabController.index > 0) {
                          _tabController.animateTo(_tabController.index - 1);
                        }
                      },
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

class _QuestionTab extends StatelessWidget {
  const _QuestionTab({
    required this.question,
    required this.theme,
    required this.multiple,
    required this.selected,
    required this.otherPicked,
    required this.otherText,
    required this.onPickSingle,
    required this.onToggleMulti,
    required this.onEditOther,
    required this.showNext,
    required this.onNext,
  });

  final QuestionInfo question;
  final OpenCodeTheme theme;
  final bool multiple;
  final List<String> selected;
  final bool otherPicked;
  final String otherText;
  final void Function(String) onPickSingle;
  final void Function(String) onToggleMulti;
  final VoidCallback onEditOther;
  final bool showNext;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    final opts = question.options;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          question.question,
          style: TextStyle(
            color: theme.text,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        Expanded(
          child: ListView(
            children: [
              for (final opt in opts)
                multiple
                    ? CheckboxListTile(
                        value: selected.contains(opt.label),
                        onChanged: (_) => onToggleMulti(opt.label),
                        controlAffinity: ListTileControlAffinity.leading,
                        activeColor: theme.primary,
                        title: Text(opt.label, style: TextStyle(color: theme.text)),
                        subtitle: opt.description.isNotEmpty
                            ? Text(
                                opt.description,
                                style: TextStyle(color: theme.textMuted, fontSize: 12),
                              )
                            : null,
                      )
                    : RadioListTile<String>(
                        value: opt.label,
                        groupValue: selected.isEmpty ? null : selected.first,
                        onChanged: (v) {
                          if (v == null) return;
                          onPickSingle(v);
                        },
                        activeColor: theme.primary,
                        title: Text(opt.label, style: TextStyle(color: theme.text)),
                        subtitle: opt.description.isNotEmpty
                            ? Text(
                                opt.description,
                                style: TextStyle(color: theme.textMuted, fontSize: 12),
                              )
                            : null,
                      ),
              const Divider(height: 16),
              ListTile(
                leading: Icon(
                  multiple ? (otherPicked ? Icons.check_box : Icons.check_box_outline_blank) : Icons.edit_note_rounded,
                  color: theme.textMuted,
                ),
                title: Text(
                  otherText.trim().isEmpty ? 'Other…' : 'Other: $otherText',
                  style: TextStyle(color: theme.text),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  multiple
                      ? 'Add a custom option (toggleable)'
                      : 'Write a custom answer',
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                ),
                onTap: onEditOther,
              ),
            ],
          ),
        ),
        if (showNext)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              children: [
                const Spacer(),
                TextButton(
                  onPressed: onNext,
                  child: Text('Next', style: TextStyle(color: theme.primary)),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _ConfirmTab extends StatelessWidget {
  const _ConfirmTab({
    required this.theme,
    required this.questions,
    required this.answers,
    required this.onSubmit,
    required this.onBack,
  });

  final OpenCodeTheme theme;
  final List<QuestionInfo> questions;
  final List<List<String>> answers;
  final VoidCallback onSubmit;
  final VoidCallback onBack;

  bool get _canSubmit {
    for (final a in answers) {
      if (a.where((x) => x.trim().isNotEmpty).isEmpty) return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Confirm',
          style: TextStyle(
            color: theme.text,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        Expanded(
          child: ListView.builder(
            itemCount: questions.length,
            itemBuilder: (ctx, i) {
              final q = questions[i];
              final a = answers[i].where((x) => x.trim().isNotEmpty).toList();
              return Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: theme.backgroundElement,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: theme.borderSubtle),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      q.header.isNotEmpty ? q.header : 'Question ${i + 1}',
                      style: TextStyle(
                        color: theme.textMuted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      a.isEmpty ? 'No answer' : a.join(', '),
                      style: TextStyle(color: theme.text, fontSize: 13),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
        Row(
          children: [
            TextButton(
              onPressed: onBack,
              child: Text('Back', style: TextStyle(color: theme.textMuted)),
            ),
            const Spacer(),
            ElevatedButton(
              onPressed: _canSubmit ? onSubmit : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: theme.primary,
                foregroundColor: Colors.white,
              ),
              child: const Text('Submit'),
            ),
          ],
        ),
      ],
    );
  }
}

