import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/config_result_view.dart';
import 'package:broski/screens/agent/panels/notice_card.dart';
import 'package:broski/screens/agent/panels/panel_card.dart';
import 'package:broski/screens/agent/panels/result_actions.dart';
import 'package:broski/screens/agent/panels/settings_view.dart';
import 'package:broski/screens/agent/panels/text_pages_view.dart';
import 'package:broski/screens/agent/panels/tools_view.dart';
import 'package:broski/screens/agent/panels/transfer/changed_files_view.dart';
import 'package:broski/screens/agent/panels/transfer/export_share_view.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// What a backend operation answered, by the shape of the answer.
class OpResultView extends StatelessWidget {
  const OpResultView({
    super.key,
    required this.result,
    required this.actions,
    required this.session,
  });

  final BackendOpResult result;
  final ResultActions actions;

  final SessionRef session;

  @override
  Widget build(BuildContext context) => switch (result) {
    final RewindFilesResult rewind => _RewindView(result: rewind),
    TreeNavigated() => const _Done('Done. The conversation reloads.'),
    TakenOver() => const _Done('This session now runs from your phone.'),
    TreeRead() ||
    EntryLabelled() ||
    BranchSummaryAborted() ||
    ShellStarted() => const _Done('Done.'),
    SessionSettingsResult(:final settings) => SessionSettingsView(
      settings: settings,
      actions: actions,
    ),
    final SessionToolsResult tools => SessionToolsView(
      result: tools,
      actions: actions,
    ),
    final SystemPromptResult page => TextPagesView(
      page: page,
      actions: actions,
    ),
    final SessionExported exported => ExportShareView(
      session: session,
      exported: exported,
    ),
    ExportPartRead() => const SizedBox.shrink(),
    SessionImported() => const _Done('Imported. It is in the list.'),
    final ChangedFilesListed changed => ChangedFilesView(changed: changed),
    ModelsRefreshed(:final problems) => _RefreshedView(problems: problems),
    ConfigFilesListed() ||
    ConfigFileRead() ||
    SettingsOverviewRead() ||
    McpServersListed() ||
    PluginsListed() ||
    TasksListed() ||
    ContextUsageRead() ||
    CustomToolsListed() ||
    CustomToolRead() => ConfigResultView(result: result, actions: actions),
  };
}

/// An operation that has nothing to show but that it happened.
class _Done extends StatelessWidget {
  const _Done(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => NoticeCard(
    icon: AppIcons.checkCircle,
    color: OpenCodeTheme.of(context).success,
    text: text,
  );
}

class _RewindView extends StatelessWidget {
  const _RewindView({required this.result});

  final RewindFilesResult result;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final RewindFilesResult(
      :canRewind,
      :filesChanged,
      :insertions,
      :deletions,
      :skippedLinks,
      :error,
    ) = result;
    final paths = filesChanged ?? const <String>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        NoticeCard(
          icon: canRewind ? AppIcons.checkCircle : AppIcons.block,
          color: canRewind ? theme.success : theme.warning,
          text: canRewind
              ? 'The files can be rewound.'
              : 'The files cannot be rewound.',
        ),
        if (error != null)
          Padding(
            padding: Insets.topSm,
            child: NoticeCard(
              icon: AppIcons.error,
              color: theme.error,
              text: error,
            ),
          ),
        if (paths.isNotEmpty)
          Padding(
            padding: Insets.topSm,
            child: _RewindPaths(paths: paths),
          ),
        if (insertions != null || deletions != null)
          _RewindCounts(insertions: insertions, deletions: deletions),
        if (skippedLinks != null && skippedLinks > 0)
          Padding(
            padding: Insets.topSm,
            child: _RewindSkipped(count: skippedLinks),
          ),
      ],
    );
  }
}

class _RewindSkipped extends StatelessWidget {
  const _RewindSkipped({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => NoticeCard(
    icon: AppIcons.warning,
    color: OpenCodeTheme.of(context).warning,
    text: '$count files were left alone: a link sat at their path.',
  );
}

class _RewindPaths extends StatelessWidget {
  const _RewindPaths({required this.paths});

  final List<String> paths;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return PanelCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final path in paths)
            Padding(
              padding: Insets.chipV,
              child: Text(
                path,
                style: AppTypography.codeSmall(color: theme.text),
              ),
            ),
        ],
      ),
    );
  }
}

class _RewindCounts extends StatelessWidget {
  const _RewindCounts({required this.insertions, required this.deletions});

  final int? insertions;
  final int? deletions;

  @override
  Widget build(BuildContext context) => Padding(
    padding: Insets.topSm,
    child: Text(
      '+${insertions ?? 0} −${deletions ?? 0}',
      style: AppTypography.codeSmall(
        color: OpenCodeTheme.of(context).textMuted,
      ),
    ),
  );
}

class _RefreshedView extends StatelessWidget {
  const _RefreshedView({required this.problems});

  final List<String> problems;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    if (problems.isEmpty) {
      return NoticeCard(
        icon: AppIcons.checkCircle,
        color: theme.success,
        text: 'The model lists are up to date.',
      );
    }
    return Container(
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: theme.warning.withValues(alpha: 0.08),
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.warning.withValues(alpha: 0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(AppIcons.warning, size: 16, color: theme.warning),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Some catalogues could not be refreshed:',
                  style: AppTypography.bodySmall(color: theme.warning),
                ),
                for (final problem in problems)
                  Padding(
                    padding: Insets.topSm,
                    child: Text(
                      problem,
                      style: AppTypography.codeSmall(color: theme.textMuted),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
