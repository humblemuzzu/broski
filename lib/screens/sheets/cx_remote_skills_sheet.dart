import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/codex_remote_skill.dart';
import '../../providers/service_providers.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Bottom sheet to browse and install skills from the Codex public skills marketplace.
class CxRemoteSkillsSheet extends ConsumerStatefulWidget {
  const CxRemoteSkillsSheet({super.key});

  static void show(BuildContext context) {
    DetailSheet.show(
      context: context,
      title: 'Browse Remote Skills',
      initialSize: 0.55,
      child: const CxRemoteSkillsSheet(),
    );
  }

  @override
  ConsumerState<CxRemoteSkillsSheet> createState() =>
      _CxRemoteSkillsSheetState();
}

class _CxRemoteSkillsSheetState extends ConsumerState<CxRemoteSkillsSheet> {
  List<CodexRemoteSkill>? _skills;
  bool _loading = true;
  String? _error;
  final Set<String> _installing = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final data = await bridge.cxListRemoteSkills();
      if (!mounted) return;
      setState(() {
        _skills = data.map(CodexRemoteSkill.fromJson).toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _install(CodexRemoteSkill skill) async {
    setState(() => _installing.add(skill.id));
    try {
      final bridge = ref.read(bridgeServiceProvider);
      await bridge.cxInstallRemoteSkill(hazelnutId: skill.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Installed "${skill.name}"')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to install: $e')),
      );
    } finally {
      if (mounted) setState(() => _installing.remove(skill.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Error: $_error', style: TextStyle(color: theme.colorScheme.error)),
            const SizedBox(height: 12),
            TextButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }

    final skills = _skills ?? [];
    if (skills.isEmpty) {
      return const Center(child: Text('No remote skills available.'));
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        itemCount: skills.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final skill = skills[index];
          final isInstalling = _installing.contains(skill.id);
          return ListTile(
            dense: true,
            leading: const Icon(Icons.auto_awesome, size: 20),
            title: Text(skill.name, style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: skill.description.isNotEmpty ? Text(skill.description, maxLines: 2, overflow: TextOverflow.ellipsis) : null,
            trailing: isInstalling
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : IconButton(
                    icon: const Icon(Icons.download, size: 20),
                    onPressed: () => _install(skill),
                    tooltip: 'Install',
                  ),
          );
        },
      ),
    );
  }
}
