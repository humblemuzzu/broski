import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/pi.dart';
import '../providers/pi_provider.dart';

class PiCommandsScreen extends ConsumerStatefulWidget {
  const PiCommandsScreen({super.key});

  @override
  ConsumerState<PiCommandsScreen> createState() => _PiCommandsScreenState();
}

class _PiCommandsScreenState extends ConsumerState<PiCommandsScreen> {
  final _cwdController = TextEditingController();

  bool _loading = false;
  String? _error;
  List<PiCommand> _commands = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _cwdController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final bridge = ref.read(piBridgeServiceProvider);
      final cwd = _cwdController.text.trim();
      final commands = await bridge.listCommands(
        projectPath: cwd.isEmpty ? null : cwd,
      );

      if (!mounted) return;
      setState(() {
        _commands = commands;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _commands = const [];
        _error = '$error';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Pi Commands')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _cwdController,
                    decoration: const InputDecoration(
                      labelText: 'Project path (optional)',
                      hintText: '/absolute/path/to/project',
                    ),
                    onSubmitted: (_) => _load(),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(onPressed: _load, child: const Text('Load')),
              ],
            ),
            const SizedBox(height: 12),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                  ? Center(child: Text('Failed to load commands: $_error'))
                  : _commands.isEmpty
                  ? const Center(child: Text('No commands found'))
                  : ListView.separated(
                      itemCount: _commands.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final command = _commands[index];
                        return ListTile(
                          dense: true,
                          title: Text('/${command.name}'),
                          subtitle: Text(
                            '${command.description ?? command.source}\n'
                            '${command.source}${command.path != null ? ' • ${command.path}' : ''}',
                          ),
                          isThreeLine: true,
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
