import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/option_card.dart';
import 'package:broski/screens/agent/interactions/reply_draft.dart';
import 'package:flutter/material.dart';

/// One of the offered values (contract §9, `choice`), marked when chosen.
class ChoiceView extends StatefulWidget {
  const ChoiceView({super.key, required this.request, required this.onDraft});

  final ChoiceRequest request;
  final ValueChanged<ReplyDraft> onDraft;

  @override
  State<ChoiceView> createState() => _ChoiceViewState();
}

class _ChoiceViewState extends State<ChoiceView> {
  String? _value;

  void _choose(Option option) {
    setState(() => _value = option.value);
    widget.onDraft(DraftReply(ChoiceReply(value: option.value)));
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final option in widget.request.options)
        OptionCard(
          key: ValueKey('choice:${option.value}'),
          label: option.label,
          detail: switch (option.description) {
            null => null,
            final description => Text(description),
          },
          selected: option.value == _value,
          onTap: () => _choose(option),
        ),
    ],
  );
}
