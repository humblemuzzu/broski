import 'package:broski/agent/ui/panels/action_list_view.dart';
import 'package:broski/agent/ui/panels/config_files_view.dart';
import 'package:broski/agent/ui/panels/config_inputs.dart';
import 'package:broski/agent/ui/panels/editable_file_view.dart';
import 'package:broski/agent/ui/panels/result_actions.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';

/// What a configuration or list operation answered (contract 1.4), by
/// shape: a list of rows with actions, a list of files, or one file.
class ConfigResultView extends StatelessWidget {
  const ConfigResultView({
    super.key,
    required this.result,
    required this.actions,
  });

  final BackendOpResult result;
  final ResultActions actions;

  @override
  Widget build(BuildContext context) => switch (result) {
    final ConfigFilesListed listed => ConfigFilesView(
      listed: listed,
      actions: actions,
    ),
    ConfigFileRead(:final file) ||
    CustomToolRead(:final file) => EditableFileView(
      file: file,
      actions: actions,
      change: (target, change) => fileCall(target, result, file, change),
    ),
    SettingsOverviewRead(:final list) ||
    McpServersListed(:final list) ||
    PluginsListed(:final list) ||
    TasksListed(:final list) ||
    ContextUsageRead(:final list) ||
    CustomToolsListed(:final list) => ActionListView(
      list: list,
      actions: actions,
      change: listChange(result),
    ),
    _ => const SizedBox.shrink(),
  };
}
