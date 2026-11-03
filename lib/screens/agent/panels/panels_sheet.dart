import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/panel_looks.dart';
import 'package:broski/screens/agent/panels/panel_registry.dart';
import 'package:broski/screens/agent/panels/panel_row.dart';
import 'package:broski/screens/agent/panels/run_op.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:broski/widgets/chat/section_header.dart' show SectionHeader;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A row of the "More" sheet that is not a backend operation: [run] is given
/// the screen under the sheet, once the sheet has closed.
typedef SheetEntry = ({
  String key,
  IconData icon,
  String label,
  String? detail,
  Future<void> Function(BuildContext screen) run,
});

/// The "More" sheet: [entries] first, then [panels], each run on [target]
/// from [context], the screen under the sheet, once the sheet has closed. A
/// backend's own operations name no session: theirs is a [SessionRef] with an
/// empty id.
void showPanelsSheet(
  BuildContext context,
  List<OpPanel> panels,
  OpTarget target, {
  String title = 'More',
  List<SheetEntry> entries = const [],
}) => DetailSheet.show<void>(
  context: context,
  title: title,
  child: Consumer(
    builder: (_, ref, _) => _SheetBody(
      ref: ref,
      screen: context,
      entries: entries,
      panels: panels,
      target: target,
    ),
  ),
);

/// The rows of the sheet, each section under the name of what it holds.
class _SheetBody extends StatelessWidget {
  const _SheetBody({
    required this.ref,
    required this.screen,
    required this.entries,
    required this.panels,
    required this.target,
  });

  /// Read while the sheet is up: once it closes, its `ref` is gone.
  final WidgetRef ref;
  final BuildContext screen;
  final List<SheetEntry> entries;
  final List<OpPanel> panels;
  final OpTarget target;

  @override
  Widget build(BuildContext context) => Padding(
    padding: Insets.screenAll,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (entries.isNotEmpty)
          _Section(
            title: 'SESSION',
            rows: [
              for (final entry in entries)
                PanelRow(
                  key: ValueKey(entry.key),
                  icon: entry.icon,
                  label: entry.label,
                  subtitle: entry.detail,
                  onTap: () {
                    Navigator.of(context).pop();
                    entry.run(screen);
                  },
                ),
            ],
          ),
        if (entries.isNotEmpty && panels.isNotEmpty)
          const SizedBox(height: Spacing.lg),
        if (panels.isNotEmpty)
          _Section(
            title: 'TOOLS',
            rows: [for (final panel in panels) _panelRow(context, panel)],
          ),
      ],
    ),
  );

  Widget _panelRow(BuildContext context, OpPanel panel) => PanelRow(
    key: ValueKey('panel:${panel.kind.wire}'),
    icon: panelLook(panel.kind).icon,
    label: panel.label,
    subtitle: panelLook(panel.kind).blurb,
    onTap: () {
      final tools = opToolsOf(ref);
      Navigator.of(context).pop();
      runOp(screen, tools, panel, target);
    },
  );
}

/// A titled group of the sheet's rows.
class _Section extends StatelessWidget {
  const _Section({required this.title, required this.rows});

  final String title;
  final List<Widget> rows;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    mainAxisSize: MainAxisSize.min,
    children: [
      SectionHeader(title: title, theme: OpenCodeTheme.of(context)),
      const SizedBox(height: Spacing.md),
      for (final row in rows) Padding(padding: Insets.bottomMd, child: row),
    ],
  );
}

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
