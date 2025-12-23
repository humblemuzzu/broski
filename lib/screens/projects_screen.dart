import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/project.dart';
import '../providers/chat_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../widgets/connection_indicator.dart';
import 'chat_screen.dart';

class ProjectsScreen extends ConsumerStatefulWidget {
  const ProjectsScreen({super.key});

  @override
  ConsumerState<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends ConsumerState<ProjectsScreen> {
  late Future<List<ProjectSummary>> _projectsFuture;

  @override
  void initState() {
    super.initState();
    _projectsFuture = _loadProjects();
  }

  Future<List<ProjectSummary>> _loadProjects() {
    final bridge = ref.read(bridgeServiceProvider);
    return bridge.listProjects();
  }

  Future<void> _refresh() async {
    setState(() {
      _projectsFuture = _loadProjects();
    });
    await _projectsFuture;
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Projects'),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: ConnectionIndicator(
              status: connection.status,
              opencodeRunning: connection.opencodeRunning,
              compact: true,
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<ProjectSummary>>(
          future: _projectsFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }

            if (snapshot.hasError) {
              return Center(
                child: Text('Failed to load projects: ${snapshot.error}'),
              );
            }

            final projects = snapshot.data ?? [];
            if (projects.isEmpty) {
              return const Center(child: Text('No projects found'));
            }

            return ListView.separated(
              padding: const EdgeInsets.all(20),
              itemCount: projects.length + (connection.opencodeRunning ? 0 : 1),
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                if (!connection.opencodeRunning && index == 0) {
                  return Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surface,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'OpenCode is not running. You can start it from here or run `opencode serve` on your Mac.',
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            ElevatedButton(
                              onPressed: () => _startOpenCode(context),
                              child: const Text('Start OpenCode'),
                            ),
                            const SizedBox(width: 12),
                            OutlinedButton(
                              onPressed: _refresh,
                              child: const Text('Refresh'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  );
                }

                final projectIndex = connection.opencodeRunning
                    ? index
                    : index - 1;
                final project = projects[projectIndex];
                return ListTile(
                  tileColor: Theme.of(context).colorScheme.surface,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  leading: const Icon(Icons.folder),
                  title: Text(project.name),
                  subtitle: Text(project.path),
                  onTap: () => _openProject(context, project),
                );
              },
            );
          },
        ),
      ),
    );
  }

  Future<void> _openProject(
    BuildContext context,
    ProjectSummary project,
  ) async {
    final bridge = ref.read(bridgeServiceProvider);
    final selection = ref.read(selectionProvider.notifier);
    final chat = ref.read(chatSessionProvider.notifier);

    selection.selectProject(project);

    final session = await bridge.createSession(
      projectPath: project.path,
      title: 'Mobile session',
    );

    selection.selectSession(session);
    chat.setSession(session, projectPath: project.path);

    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatScreen(project: project, session: session),
      ),
    );
  }

  void _startOpenCode(BuildContext context) {
    final bridge = ref.read(bridgeServiceProvider);
    bridge.startOpenCode();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Starting OpenCode on your Mac...')),
    );
  }
}
