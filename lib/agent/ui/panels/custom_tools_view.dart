import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/agent/ui/panels/action_list_view.dart';
import 'package:broski/agent/ui/panels/config_inputs.dart';
import 'package:broski/agent/ui/panels/file_drill_down.dart';
import 'package:broski/agent/ui/panels/result_actions.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// The tools the bridge itself serves, as its `custom_tools` list: a row
/// opens the tool's definition in the editor (its row id is the id
/// `custom_tool` takes), *New tool* opens the template for another, and the
/// row's own actions (a test, a delete) work as in any list.
class CustomToolsView extends StatelessWidget {
  const CustomToolsView({
    super.key,
    required this.result,
    required this.actions,
  });

  final CustomToolsListed result;
  final ResultActions actions;

  @override
  Widget build(BuildContext context) {
    final calls = listCallsOf(result);
    return FileDrillDown<CustomToolsListed>(
      list: result,
      actions: actions,
      listOf: (answer) => answer is CustomToolsListed ? answer : null,
      reload: (target) => opCall(target.session, const CustomToolsOp()),
      fileCall: customToolCall,
      listBuilder: (context, list, open) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Padding(
              padding: Insets.bottomSm,
              child: FilledButton.tonalIcon(
                key: const ValueKey('custom-tool-new'),
                onPressed: actions.busy
                    ? null
                    : () => open(
                        (target) =>
                            opCall(target.session, const CustomToolOp()),
                      ),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('New tool'),
              ),
            ),
          ),
          ActionListView(
            list: list.list,
            actions: actions,
            change: calls?.change,
            reload: calls?.read,
            onOpenRow: (row) => open(
              (target) => opCall(target.session, CustomToolOp(toolId: row.id)),
            ),
          ),
        ],
      ),
    );
  }
}
