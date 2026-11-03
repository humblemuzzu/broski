import 'package:broski/models/claude_code.dart';
import 'package:broski/models/message.dart';
import 'package:broski/models/session_context.dart';
import 'package:broski/models/todo.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/widgets/sidebar/cc_context_details.dart';
import 'package:broski/widgets/sidebar/cc_info_section.dart';
import 'package:broski/widgets/sidebar/cc_mcp_section.dart';
import 'package:broski/widgets/sidebar/cc_skills_section.dart';
import 'package:broski/widgets/sidebar/sidebar_changes_section.dart';
import 'package:broski/widgets/sidebar/sidebar_context_section.dart';
import 'package:broski/widgets/sidebar/sidebar_header.dart';
import 'package:broski/widgets/sidebar/sidebar_modified_files_section.dart';
import 'package:broski/widgets/sidebar/sidebar_plan_section.dart';
import 'package:broski/widgets/sidebar/sidebar_scaffold.dart';
import 'package:flutter/material.dart';

/// The Claude Code chat's end drawer: the shared sections plus what only a
/// Claude Code session reports about itself.
class SessionSidebar extends StatelessWidget {
  const SessionSidebar({
    super.key,
    required this.sessionTitle,
    required this.sessionContext,
    this.todos = const [],
    this.onClose,
    this.sessionDiffs = const [],
    this.onOpenDiff,
    this.ccInit,
  });

  final String sessionTitle;
  final SessionContext sessionContext;
  final List<Todo> todos;
  final VoidCallback? onClose;
  final List<DiffEntry> sessionDiffs;
  final void Function(DiffEntry diff)? onOpenDiff;
  final CCSessionInit? ccInit;

  @override
  Widget build(BuildContext context) {
    final init = ccInit;
    return SidebarScaffold(
      header: SidebarHeader(title: sessionTitle, onClose: onClose),
      children: [
        const SizedBox(height: Spacing.sm),
        ContextUsageSection(sessionContext: sessionContext),
        CCContextDetails(sessionId: init?.sessionId),
        const SizedBox(height: Spacing.xl),
        CCInfoSection(init: init),
        const SizedBox(height: Spacing.xl),
        if (init != null && init.mcpServers.isNotEmpty) ...[
          CCMcpSection(init: init),
          const SizedBox(height: Spacing.xl),
        ],
        if (init != null && init.skills.isNotEmpty) ...[
          CCSkillsSection(init: init),
          const SizedBox(height: Spacing.xl),
        ],
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
