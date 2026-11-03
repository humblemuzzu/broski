import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/file_change_view.dart';
import 'package:broski/screens/agent/interactions/code_box.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// What the tool would do: a command, file changes, a host, paths.
class PermissionPreviewView extends StatelessWidget {
  const PermissionPreviewView({super.key, required this.preview});

  final PermissionPreview preview;

  @override
  Widget build(BuildContext context) => Padding(
    padding: Insets.bottomMd,
    child: switch (preview) {
      CommandPreview(:final command, :final cwd) => CodeBox(
        text: command,
        footnote: cwd == null ? null : 'in $cwd',
      ),
      FileChangesPreview(:final changes) => Column(
        children: [
          for (final change in changes) FileChangeView(change: change),
        ],
      ),
      NetworkPreview(:final host, :final protocol) => CodeBox(
        title: 'Network',
        text: [?protocol, host].join('://'),
      ),
      PathsPreview(:final paths) => CodeBox(
        title: 'Paths',
        text: paths.join('\n'),
      ),
    },
  );
}
