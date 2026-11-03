import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/panels_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/op_sheet_rig.dart';
import '../../agent/support/widget_rig.dart';

BackendDescriptor _backend(List<String> ops) =>
    BackendDescriptor(id: BackendId.claudeCode, capabilities: offering(ops));

Future<WidgetRig> _row(WidgetTester tester, BackendDescriptor backend) async {
  final rig = WidgetRig(capabilities: backend.capabilities);
  addTearDown(rig.dispose);
  await rig.pump(
    tester,
    Scaffold(
      body: Builder(
        builder: (context) => TextButton(
          key: const ValueKey('project-row'),
          onPressed: () => showProjectPanels(
            context,
            backend,
            cwd: '/work/api',
            name: 'api',
          ),
          child: const Text('api'),
        ),
      ),
    ),
  );
  return rig;
}

void main() {
  test('only the operations on a project directory are offered for one', () {
    expect(
      [
        for (final p in projectPanels(
          _backend([
            'config_files',
            'settings_overview',
            'plugins',
            'tasks',
            'custom_tools',
          ]),
        ))
          p.kind,
      ],
      [
        BackendOpKind.configFiles,
        BackendOpKind.settingsOverview,
        BackendOpKind.plugins,
      ],
    );
    expect(projectPanels(_backend(['tasks', 'custom_tools'])), isEmpty);
  });

  testWidgets('a project row runs an operation on its directory, with no '
      'session', (tester) async {
    final rig = await _row(tester, _backend(['config_files', 'plugins']));
    rig.bridge.on<BackendCallRequest>(
      (r) => answered(r, const ConfigFilesListed(files: [], omitted: 0)),
    );
    await tapKey(tester, 'project-row');
    expect(find.text('api'), findsWidgets);
    await tapKey(tester, 'panel:config_files');
    expect(lastOp(rig), const ConfigFilesOp(cwd: '/work/api'));
  });

  testWidgets('plugins of a project need no session either', (tester) async {
    final rig = await _row(tester, _backend(['plugins']));
    rig.bridge.on<BackendCallRequest>(
      (r) => answered(
        r,
        const PluginsListed(list: ActionList(rows: [], omitted: 0)),
      ),
    );
    await tapKey(tester, 'project-row');
    await tapKey(tester, 'panel:plugins');
    expect(lastOp(rig), const PluginsOp(cwd: '/work/api'));
  });
}
