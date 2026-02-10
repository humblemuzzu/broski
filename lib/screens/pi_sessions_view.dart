import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/pi.dart';
import '../providers/pi_provider.dart';
import '../theme/design_tokens.dart';
import 'pi_chat_screen.dart';

class PiSessionsView extends ConsumerWidget {
  const PiSessionsView({super.key, required this.onRefresh});

  final Future<void> Function() onRefresh;

  Future<void> _showOpenCwdDialog(BuildContext context) async {
    final controller = TextEditingController();

    final cwd = await showDialog<String>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Open Pi in directory'),
          content: TextField(
            controller: controller,
            autofocus: true,
            decoration: const InputDecoration(
              hintText: '/absolute/path/to/project',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, controller.text.trim()),
              child: const Text('Open'),
            ),
          ],
        );
      },
    );

    controller.dispose();
    final path = (cwd ?? '').trim();
    if (path.isEmpty || !context.mounted) return;

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => PiChatScreen.draft(cwd: path, title: path),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessionsAsync = ref.watch(piSessionsProvider(null));

    return Scaffold(
      appBar: AppBar(title: const Text('Pi Sessions')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showOpenCwdDialog(context),
        icon: const Icon(Icons.add),
        label: const Text('Open CWD'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(piSessionsProvider(null));
          await onRefresh();
        },
        child: sessionsAsync.when(
          data: (sessions) {
            if (sessions.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: Insets.screenAll,
                children: const [
                  SizedBox(height: 80),
                  Icon(Icons.forum_outlined, size: 64),
                  SizedBox(height: 16),
                  Center(
                    child: Text(
                      'No Pi sessions yet',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  SizedBox(height: 8),
                  Center(
                    child: Text(
                      'Use “Open CWD” to start a new Pi session.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ],
              );
            }

            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: Insets.screenAll,
              itemCount: sessions.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final session = sessions[index];
                return _PiSessionTile(session: session);
              },
            );
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: Insets.screenAll,
            children: [
              const SizedBox(height: 80),
              const Icon(Icons.error_outline, size: 56),
              const SizedBox(height: 16),
              Center(
                child: Text(
                  'Failed to load Pi sessions\n$error',
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PiSessionTile extends ConsumerWidget {
  const _PiSessionTile({required this.session});

  final PiSessionInfo session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final title = (session.name ?? '').trim().isNotEmpty
        ? session.name!.trim()
        : session.firstMessage.trim().isNotEmpty
        ? session.firstMessage.trim()
        : 'Session ${session.id}';

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.82),
        borderRadius: BorderRadius.circular(12),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(
          '${session.cwd}\n${session.messageCount} messages • ${session.modified}',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        isThreeLine: true,
        leading: const Icon(Icons.auto_awesome),
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => PiChatScreen.session(
                cwd: session.cwd,
                sessionPath: session.path,
                title: session.name,
              ),
            ),
          );
        },
        trailing: PopupMenuButton<String>(
          onSelected: (value) async {
            if (value == 'delete') {
              final bridge = ref.read(piBridgeServiceProvider);
              await bridge.deleteSession(
                sessionPath: session.path,
                projectPath: session.cwd,
              );
              ref.invalidate(piSessionsProvider(null));
            }
          },
          itemBuilder: (context) => const [
            PopupMenuItem<String>(value: 'delete', child: Text('Delete')),
          ],
        ),
      ),
    );
  }
}
