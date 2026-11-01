import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/agent/ui/panels/action_list_view.dart';
import 'package:broski/agent/ui/panels/config_files_view.dart';
import 'package:broski/agent/ui/panels/config_inputs.dart';
import 'package:broski/agent/ui/panels/custom_tools_view.dart';
import 'package:broski/agent/ui/panels/editable_file_view.dart';
import 'package:broski/agent/ui/panels/file_drill_down.dart';
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
    final ConfigFilesListed listed => _files(listed),
    final CustomToolsListed listed => CustomToolsView(
      result: listed,
      actions: actions,
    ),
    ConfigFileRead(:final file) => EditableFileView(
      file: file,
      actions: actions,
      call: configFileCall,
    ),
    CustomToolRead(:final file) => EditableFileView(
      file: file,
      actions: actions,
      call: customToolCall,
    ),
    SettingsOverviewRead(:final list) ||
    McpServersListed(:final list) ||
    PluginsListed(:final list) ||
    TasksListed(:final list) ||
    ContextUsageRead(:final list) => _list(list),
    _ => const SizedBox.shrink(),
  };

  Widget _list(ActionList list) {
    final calls = listCallsOf(result);
    return ActionListView(
      list: list,
      actions: actions,
      change: calls?.change,
      reload: calls?.read,
    );
  }

  Widget _files(ConfigFilesListed listed) => FileDrillDown<ConfigFilesListed>(
    list: listed,
    actions: actions,
    listOf: (answer) => answer is ConfigFilesListed ? answer : null,
    reload: (target) =>
        opCall(target.session, ConfigFilesOp(cwd: projectOf(target))),
    fileCall: configFileCall,
    listBuilder: (context, list, open) => ConfigFilesView(
      listed: list,
      busy: actions.busy,
      onOpen: (file, name) => open(
        (target) => opCall(
          target.session,
          ConfigFileOp(cwd: projectOf(target), fileId: file.id, name: name),
        ),
      ),
    ),
  );
}
