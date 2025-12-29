import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent.dart';
import '../models/file_attachment.dart';
import '../providers/file_search_provider.dart';
import '../theme/opencode_theme.dart';

void showImagePreview(BuildContext context, FileAttachment attachment) {
  if (!attachment.isImage || attachment.base64Data == null) return;

  final theme = OpenCodeTheme.of(context);
  final imageBytes = base64Decode(attachment.base64Data!);

  showDialog(
    context: context,
    barrierColor: Colors.black87,
    builder: (ctx) => Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(16),
      child: Stack(
        children: [
          Center(
            child: InteractiveViewer(
              minScale: 0.5,
              maxScale: 4.0,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.memory(imageBytes, fit: BoxFit.contain),
              ),
            ),
          ),
          Positioned(
            top: 8,
            right: 8,
            child: IconButton(
              onPressed: () => Navigator.pop(ctx),
              style: IconButton.styleFrom(
                backgroundColor: theme.backgroundPanel.withValues(alpha: 0.8),
              ),
              icon: Icon(Icons.close_rounded, color: theme.text),
            ),
          ),
          Positioned(
            bottom: 16,
            left: 0,
            right: 0,
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: theme.backgroundPanel.withValues(alpha: 0.8),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  attachment.filename,
                  style: TextStyle(color: theme.text, fontSize: 14),
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class FileAutocomplete extends ConsumerWidget {
  const FileAutocomplete({
    super.key,
    required this.onSelect,
    required this.visible,
  });

  final void Function(FileAttachment attachment) onSelect;
  final bool visible;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!visible) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);
    final state = ref.watch(fileSearchProvider);

    if (state.results.isEmpty && !state.isSearching) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: theme.borderSubtle),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.2),
              blurRadius: 8,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        child: Text(
          state.query.isEmpty ? 'No files in project' : 'No matching files',
          style: TextStyle(color: theme.textMuted, fontSize: 13),
        ),
      );
    }

    if (state.isSearching && state.results.isEmpty) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: theme.borderSubtle),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.2),
              blurRadius: 8,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: theme.textMuted,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              'Searching...',
              style: TextStyle(color: theme.textMuted, fontSize: 13),
            ),
          ],
        ),
      );
    }

    return Container(
      constraints: const BoxConstraints(maxHeight: 240),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.borderSubtle),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.2),
            blurRadius: 8,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: ListView.builder(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: state.results.length,
        itemBuilder: (context, index) {
          final path = state.results[index];
          final isSelected = index == state.selectedIndex;
          final isDirectory = path.endsWith('/');
          final attachment = FileAttachment.fromPath(path);

          return _FileAutocompleteItem(
            path: path,
            directory: attachment.directory,
            filename: attachment.filename,
            isDirectory: isDirectory,
            isSelected: isSelected,
            onTap: () => onSelect(attachment),
          );
        },
      ),
    );
  }
}

class _FileAutocompleteItem extends StatelessWidget {
  const _FileAutocompleteItem({
    required this.path,
    required this.directory,
    required this.filename,
    required this.isDirectory,
    required this.isSelected,
    required this.onTap,
  });

  final String path;
  final String directory;
  final String filename;
  final bool isDirectory;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        color: isSelected ? theme.primary.withValues(alpha: 0.15) : null,
        child: Row(
          children: [
            Icon(
              isDirectory ? Icons.folder_rounded : Icons.description_outlined,
              size: 16,
              color: isDirectory ? theme.warning : theme.info,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Row(
                children: [
                  if (directory.isNotEmpty)
                    Flexible(
                      child: Text(
                        directory,
                        style: TextStyle(color: theme.textMuted, fontSize: 13),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  Text(
                    isDirectory ? '$filename/' : filename,
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class AttachedFilesChips extends StatelessWidget {
  const AttachedFilesChips({
    super.key,
    required this.attachments,
    required this.onRemove,
  });

  final List<FileAttachment> attachments;
  final void Function(FileAttachment attachment) onRemove;

  @override
  Widget build(BuildContext context) {
    if (attachments.isEmpty) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);

    int imageIndex = 0;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.only(left: 12, right: 12, bottom: 8),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: attachments.map((attachment) {
          String? imageLabel;
          if (attachment.isImage) {
            imageIndex++;
            imageLabel = 'Image $imageIndex';
          }
          return _AttachedFileChip(
            attachment: attachment,
            imageLabel: imageLabel,
            onRemove: () => onRemove(attachment),
            theme: theme,
          );
        }).toList(),
      ),
    );
  }
}

class _AttachedFileChip extends StatelessWidget {
  const _AttachedFileChip({
    required this.attachment,
    required this.onRemove,
    required this.theme,
    this.imageLabel,
  });

  final FileAttachment attachment;
  final VoidCallback onRemove;
  final OpenCodeTheme theme;
  final String? imageLabel;

  @override
  Widget build(BuildContext context) {
    final isDirectory = attachment.isDirectory;
    final isImage = attachment.isImage;
    final displayText = imageLabel ?? attachment.displayPath;

    return GestureDetector(
      onTap: isImage ? () => showImagePreview(context, attachment) : null,
      child: Container(
        padding: const EdgeInsets.only(left: 4, right: 4, top: 4, bottom: 4),
        decoration: BoxDecoration(
          color: isImage
              ? theme.primary.withValues(alpha: 0.15)
              : theme.info.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: isImage
                ? theme.primary.withValues(alpha: 0.3)
                : theme.info.withValues(alpha: 0.3),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isImage && attachment.thumbnailBytes != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: Image.memory(
                  attachment.thumbnailBytes!,
                  width: 24,
                  height: 24,
                  fit: BoxFit.cover,
                ),
              )
            else if (isImage)
              Padding(
                padding: const EdgeInsets.only(left: 4),
                child: Icon(
                  Icons.image_rounded,
                  size: 14,
                  color: theme.primary,
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.only(left: 4),
                child: Icon(
                  isDirectory
                      ? Icons.folder_rounded
                      : Icons.description_outlined,
                  size: 14,
                  color: isDirectory ? theme.warning : theme.info,
                ),
              ),
            const SizedBox(width: 6),
            Text(
              displayText,
              style: TextStyle(
                color: isImage ? theme.primary : theme.info,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(width: 2),
            InkWell(
              onTap: onRemove,
              borderRadius: BorderRadius.circular(10),
              child: Padding(
                padding: const EdgeInsets.all(2),
                child: Icon(
                  Icons.close_rounded,
                  size: 14,
                  color: theme.textMuted,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// Agent @ mention autocomplete
// =============================================================================

/// Autocomplete dropdown for @agent mentions
class AgentAutocomplete extends StatelessWidget {
  const AgentAutocomplete({
    super.key,
    required this.agents,
    required this.query,
    required this.onSelect,
    required this.visible,
  });

  final List<Agent> agents;
  final String query;
  final void Function(Agent agent) onSelect;
  final bool visible;

  @override
  Widget build(BuildContext context) {
    if (!visible || agents.isEmpty) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);
    final lowerQuery = query.toLowerCase();

    // Filter agents by query (name or description)
    final filtered = agents.where((a) {
      if (lowerQuery.isEmpty) return true;
      return a.name.toLowerCase().contains(lowerQuery) ||
          (a.description?.toLowerCase().contains(lowerQuery) ?? false);
    }).toList();

    if (filtered.isEmpty) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: theme.borderSubtle),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.2),
              blurRadius: 8,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        child: Text(
          'No matching agents',
          style: TextStyle(color: theme.textMuted, fontSize: 13),
        ),
      );
    }

    // Group by primary vs subagent
    final primaryAgents = filtered.where((a) => a.isPrimary).toList();
    final subAgents = filtered
        .where((a) => a.mode == AgentMode.subagent)
        .toList();

    return Container(
      constraints: const BoxConstraints(maxHeight: 280),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.25),
            blurRadius: 12,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.symmetric(vertical: 6),
          children: [
            // Primary agents section
            if (primaryAgents.isNotEmpty) ...[
              _buildSectionHeader(
                'Primary Agents',
                Icons.person_rounded,
                theme.primary,
                theme.textMuted,
                primaryAgents.length,
              ),
              ...primaryAgents.map(
                (agent) => _AgentAutocompleteItem(
                  agent: agent,
                  onTap: () => onSelect(agent),
                ),
              ),
            ],
            // Subagents section
            if (subAgents.isNotEmpty) ...[
              if (primaryAgents.isNotEmpty) const SizedBox(height: 4),
              _buildSectionHeader(
                'Subagents',
                Icons.smart_toy_outlined,
                theme.info,
                theme.textMuted,
                subAgents.length,
              ),
              ...subAgents.map(
                (agent) => _AgentAutocompleteItem(
                  agent: agent,
                  onTap: () => onSelect(agent),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(
    String title,
    IconData icon,
    Color iconColor,
    Color textColor,
    int count,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 13, color: iconColor),
          const SizedBox(width: 6),
          Text(
            title,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: textColor,
              letterSpacing: 0.3,
            ),
          ),
          const SizedBox(width: 4),
          Text(
            '($count)',
            style: TextStyle(
              fontSize: 11,
              color: textColor.withValues(alpha: 0.6),
            ),
          ),
        ],
      ),
    );
  }
}

class _AgentAutocompleteItem extends StatelessWidget {
  const _AgentAutocompleteItem({required this.agent, required this.onTap});

  final Agent agent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final agentColor = agent.displayColor;

    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            // Agent icon with color
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: agentColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Icon(
                agent.isPrimary
                    ? Icons.person_rounded
                    : Icons.smart_toy_outlined,
                size: 14,
                color: agentColor,
              ),
            ),
            const SizedBox(width: 10),
            // Agent name and description
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        '@${agent.name}',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: theme.text,
                        ),
                      ),
                      const SizedBox(width: 6),
                      // Mode badge
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: agentColor.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          agent.mode.displayName,
                          style: TextStyle(
                            fontSize: 9,
                            color: agentColor,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (agent.description != null &&
                      agent.description!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      agent.shortDescription,
                      style: TextStyle(fontSize: 12, color: theme.textMuted),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
