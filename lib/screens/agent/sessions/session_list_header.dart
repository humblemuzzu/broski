import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/backend_label.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The head of a session list: the list's name in the app's largest type, the
/// line that says whose sessions these are, and the list's own buttons.
class SessionListHeader extends StatelessWidget {
  const SessionListHeader({
    super.key,
    required this.backend,
    required this.title,
    this.actions,
  });

  final BackendId backend;
  final String title;
  final Widget? actions;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 32,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              ?actions,
            ],
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Text(
              '${backendLabel(backend)} sessions on this Mac',
              style: TextStyle(
                color: theme.textMuted,
                fontSize: 15,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
