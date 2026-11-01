import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/agent/ui/panels/run_op.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The "More" sheet: [panels], each run on [target] from [context], the
/// screen under the sheet, once the sheet has closed. A backend's own
/// operations name no session: theirs is a [SessionRef] with an empty id.
void showPanelsSheet(
  BuildContext context,
  List<OpPanel> panels,
  OpTarget target, {
  String title = 'More',
}) => DetailSheet.show<void>(
  context: context,
  title: title,
  child: Consumer(
    builder: (sheetContext, ref, _) => Column(
      children: [
        for (final panel in panels)
          ListTile(
            key: ValueKey('panel:${panel.kind.wire}'),
            title: Text(panel.label),
            onTap: () {
              final tools = opToolsOf(ref);
              Navigator.of(sheetContext).pop();
              runOp(context, tools, panel, target);
            },
          ),
      ],
    ),
  ),
);

/// A backend's own operations, the ones that name no session (contract §13).
List<OpPanel> backendPanels(BackendDescriptor backend) =>
    panelsAt(backend.capabilities, OpPlace.backend);

/// A backend's operations on a project directory: its configuration, the
/// settings in effect. They name the directory, not a session, so a screen
/// that lists projects offers them for a row.
List<OpPanel> projectPanels(BackendDescriptor backend) =>
    panelsAt(backend.capabilities, OpPlace.project);

/// The sheet of [projectPanels] for the project at [cwd], titled [name].
void showProjectPanels(
  BuildContext context,
  BackendDescriptor backend, {
  required String cwd,
  required String name,
}) => showPanelsSheet(
  context,
  projectPanels(backend),
  sessionTarget(
    SessionRef(backend: backend.id, sessionId: ''),
    cwd: cwd,
  ),
  title: name,
);

/// What a backend operation runs on: the session that stands for "no session".
OpTarget backendWide(BackendDescriptor backend) =>
    sessionTarget(SessionRef(backend: backend.id, sessionId: ''));
