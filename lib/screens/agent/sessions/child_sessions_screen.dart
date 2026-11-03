import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/sessions/session_list_view.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:flutter/material.dart';

/// One session's children, newest first, paged: the sessions its subagents
/// and forks ran.
class ChildSessionsScreen extends StatelessWidget {
  const ChildSessionsScreen({
    super.key,
    required this.backend,
    required this.parent,
  });

  final BackendDescriptor backend;
  final SessionSummary parent;

  @override
  Widget build(BuildContext context) {
    final SessionListKey key = (
      backend: backend.id,
      query: SessionQuery(archived: false, parent: parent.session),
    );
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: AdaptiveContainer(
          width: ContentWidth.standard,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _ChildHeader(
                title: 'Under ${parent.title?.text ?? 'this session'}',
              ),
              Expanded(
                child: SessionListView(
                  backend: backend,
                  listKey: key,
                  tools: false,
                  bottomPadding: 24,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ChildHeader extends StatelessWidget {
  const _ChildHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 20, 8),
      child: Row(
        children: [
          Tooltip(
            message: 'Back',
            child: InkWell(
              onTap: () => Navigator.of(context).maybePop(),
              borderRadius: Radii.brFull,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Icon(AppIcons.back, size: 22, color: theme.text),
              ),
            ),
          ),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  'The sessions its subagents and forks ran',
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
