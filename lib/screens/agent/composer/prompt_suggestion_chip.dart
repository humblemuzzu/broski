import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// What the backend suggests the person send next (the newest
/// `prompt_suggestion`), as a hint above the composer. A tap writes it into
/// the composer for the person to send, change or clear; nothing is sent. It
/// goes when a run starts and when a newer suggestion replaces it, and shows
/// only while the composer is empty and no run is on.
class PromptSuggestionChip extends StatefulWidget {
  const PromptSuggestionChip({
    super.key,
    required this.state,
    required this.text,
  });

  final AgentSessionState state;
  final TextEditingController text;

  @override
  State<PromptSuggestionChip> createState() => _PromptSuggestionChipState();
}

class _PromptSuggestionChipState extends State<PromptSuggestionChip> {
  PromptSuggestion? _spent;

  PromptSuggestion? get _suggestion => newestSuggestion(widget.state);

  @override
  void didUpdateWidget(PromptSuggestionChip old) {
    super.didUpdateWidget(old);
    if (!old.state.running && widget.state.running) _spent = _suggestion;
  }

  @override
  void initState() {
    super.initState();
    if (widget.state.running) _spent = _suggestion;
  }

  void _fill(String suggestion) {
    widget.text.value = TextEditingValue(
      text: suggestion,
      selection: TextSelection.collapsed(offset: suggestion.length),
    );
  }

  @override
  Widget build(BuildContext context) {
    final suggestion = _suggestion;
    if (suggestion == null ||
        identical(suggestion, _spent) ||
        widget.state.running ||
        widget.text.text.isNotEmpty) {
      return const SizedBox.shrink();
    }
    final theme = OpenCodeTheme.of(context);
    return Align(
      alignment: Alignment.centerLeft,
      child: GestureDetector(
        key: const ValueKey('prompt-suggestion'),
        onTap: () => _fill(suggestion.text),
        child: Container(
          margin: const EdgeInsets.fromLTRB(16, 0, 16, Spacing.sm),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: theme.primary.withValues(alpha: 0.1),
            borderRadius: Radii.brSm,
            border: Border.all(color: theme.primary.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(AppIcons.lightbulb, size: 14, color: theme.primary),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  suggestion.text,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.bodySmall(color: theme.text),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The newest prompt suggestion the session holds; a newer one replaces the
/// one before it.
PromptSuggestion? newestSuggestion(AgentSessionState state) =>
    state.extensions.values.whereType<PromptSuggestion>().lastOrNull;
