import 'package:broski/models/message.dart';
import 'package:broski/models/session_context.dart';
import 'package:broski/models/todo.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/widgets/sidebar/sidebar_changes_section.dart';
import 'package:broski/widgets/sidebar/sidebar_context_section.dart';
import 'package:broski/widgets/sidebar/sidebar_header.dart';
import 'package:broski/widgets/sidebar/sidebar_info_section.dart';
import 'package:broski/widgets/sidebar/sidebar_modified_files_section.dart';
import 'package:broski/widgets/sidebar/sidebar_plan_section.dart';
import 'package:broski/widgets/sidebar/sidebar_scaffold.dart';
import 'package:flutter/material.dart';

/// The end drawer of a contract backend's chat: the session's own facts, its
/// context usage, its plan, its changes and the files it wrote.
class SharedSessionSidebar extends StatelessWidget {
  const SharedSessionSidebar({
    super.key,
    required this.sessionTitle,
    required this.sessionContext,
    this.todos = const [],
    this.sessionDiffs = const [],
    this.onOpenDiff,
    this.onClose,
    this.infoRows = const [],
  });

  final String sessionTitle;
  final SessionContext sessionContext;
  final List<Todo> todos;
  final List<DiffEntry> sessionDiffs;
  final void Function(DiffEntry diff)? onOpenDiff;
  final VoidCallback? onClose;
  final List<({IconData icon, String label, String value})> infoRows;

  @override
  Widget build(BuildContext context) {
    return SidebarScaffold(
      header: SidebarHeader(title: sessionTitle, onClose: onClose),
      children: [
        const SizedBox(height: Spacing.sm),
        ContextUsageSection(sessionContext: sessionContext),
        const SizedBox(height: Spacing.xl),
        InfoSection(rows: infoRows),
        const SizedBox(height: Spacing.xl),
        PlanSection(todos: todos),
        const SizedBox(height: Spacing.xl),
        ChangesSection(diffs: sessionDiffs, onOpenDiff: onOpenDiff),
        const SizedBox(height: Spacing.xl),
        ModifiedFilesSection(files: sessionContext.modifiedFiles),
        const SizedBox(height: Spacing.xxl),
      ],
    );
  }
}
