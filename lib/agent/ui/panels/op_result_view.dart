import 'package:broski/agent/ui/panels/config_result_view.dart';
import 'package:broski/agent/ui/panels/result_actions.dart';
import 'package:broski/agent/ui/panels/settings_view.dart';
import 'package:broski/agent/ui/panels/text_pages_view.dart';
import 'package:broski/agent/ui/panels/tools_view.dart';
import 'package:broski/agent/ui/panels/transfer/changed_files_view.dart';
import 'package:broski/agent/ui/panels/transfer/export_share_view.dart';
import 'package:broski/contract/generated/contract.dart';
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
    TreeNavigated() => const Text('Done. The conversation reloads.'),
    TakenOver() => const Text('This session now runs from your phone.'),
    TreeRead() ||
    EntryLabelled() ||
    BranchSummaryAborted() ||
    ShellStarted() => const Text('Done.'),
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
    SessionImported() => const Text('Imported. It is in the list.'),
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

class _RewindView extends StatelessWidget {
  const _RewindView({required this.result});

  final RewindFilesResult result;

  @override
  Widget build(BuildContext context) {
    final RewindFilesResult(
      :canRewind,
      :filesChanged,
      :insertions,
      :deletions,
      :skippedLinks,
      :error,
    ) = result;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          canRewind
              ? 'The files can be rewound.'
              : 'The files cannot be rewound.',
        ),
        if (error != null) Text(error),
        if (filesChanged != null)
          for (final path in filesChanged) Text(path),
        if (insertions != null || deletions != null)
          Text('+${insertions ?? 0} −${deletions ?? 0}'),
        if (skippedLinks != null && skippedLinks > 0)
          Text(
            '$skippedLinks files were left alone: a link sat at their path.',
          ),
      ],
    );
  }
}

class _RefreshedView extends StatelessWidget {
  const _RefreshedView({required this.problems});

  final List<String> problems;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        problems.isEmpty
            ? 'The model lists are up to date.'
            : 'Some catalogues could not be refreshed:',
      ),
      for (final problem in problems) Text(problem),
    ],
  );
}
