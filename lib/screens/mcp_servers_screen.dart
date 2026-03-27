import 'package:flutter/material.dart';
import '../theme/app_typography.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent_type.dart';
import '../models/mcp.dart';
import '../providers/agent_type_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/service_providers.dart';
import '../providers/selection_provider.dart';
import '../services/storage_service.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import '../widgets/chat/detail_sheet.dart';
import '../widgets/connection_indicator.dart';
import 'opencode_mcp_config_screen.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
import '../utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// MCP (Model Context Protocol) Servers Management Screen
///
/// Allows users to view, connect, and disconnect MCP servers that provide
/// additional tools and resources to the AI. Now includes a Resources tab
/// to browse MCP resources (SDK v1.1.1+).
class McpServersScreen extends ConsumerStatefulWidget {
  const McpServersScreen({super.key});
  @override
  ConsumerState<McpServersScreen> createState() => _McpServersScreenState();
}

class _McpServersScreenState extends ConsumerState<McpServersScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  Map<String, McpServerStatus> _servers = {};
  Map<String, McpResource> _resources = {};
  bool _isLoading = true;
  bool _isLoadingResources = false;
  String? _error;
  String? _resourcesError;
  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(_onTabChanged);
    _loadServers();
  }

  @override
  void dispose() {
    _tabController.removeListener(_onTabChanged);
    _tabController.dispose();
    super.dispose();
  }

  void _onTabChanged() {
    if (_tabController.index == 1 &&
        _resources.isEmpty &&
        !_isLoadingResources) {
      _loadResources();
    }
  }

  Future<void> _loadServers() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    final storage = StorageService();
    final connection = ref.read(connectionProvider);
    // If offline, use cached data
    if (connection.isOfflineMode) {
      final cached = await storage.getCachedMcpServers();
      if (mounted) {
        setState(() {
          _servers = cached;
          _isLoading = false;
          if (cached.isEmpty) {
            _error = 'No cached MCP servers available offline';
          }
        });
      }
      return;
    }
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final servers = await bridge.getMcpStatus(
        projectPath: selection.project?.path,
      );
      // Cache for offline use
      if (servers.isNotEmpty) {
        await storage.cacheMcpServers(servers);
      }
      if (mounted) {
        setState(() {
          _servers = servers;
          _isLoading = false;
        });
      }
    } catch (e) {
      // On error, try to use cached data
      final cached = await storage.getCachedMcpServers();
      if (mounted) {
        if (cached.isNotEmpty) {
          setState(() {
            _servers = cached;
            _isLoading = false;
          });
        } else {
          setState(() {
            _error = humanizeError(e);
            _isLoading = false;
          });
        }
      }
    }
  }

  Future<void> _loadResources() async {
    setState(() {
      _isLoadingResources = true;
      _resourcesError = null;
    });
    final connection = ref.read(connectionProvider);
    // Resources not available offline
    if (connection.isOfflineMode) {
      if (mounted) {
        setState(() {
          _isLoadingResources = false;
          _resourcesError = 'Resources not available offline';
        });
      }
      return;
    }
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final resources = await bridge.getMcpResources(
        projectPath: selection.project?.path,
      );
      if (mounted) {
        setState(() {
          _resources = resources;
          _isLoadingResources = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _resourcesError = humanizeError(e);
          _isLoadingResources = false;
        });
      }
    }
  }

  Future<void> _connectServer(String name) async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final success = await bridge.connectMcp(
        name,
        projectPath: selection.project?.path,
      );
      if (success && mounted) {
        showSuccess(context, 'Connected to $name');
        _loadServers();
      } else if (!success && mounted) {
        showError(context, 'Failed to connect to $name');
      }
    } catch (e) {
      if (mounted) {
        final theme = OpenCodeTheme.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(humanizeError(e)),
            backgroundColor: theme.error,
          ),
        );
      }
    }
  }

  Future<void> _disconnectServer(String name) async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final success = await bridge.disconnectMcp(
        name,
        projectPath: selection.project?.path,
      );
      if (success && mounted) {
        showSuccess(context, 'Disconnected from $name');
        _loadServers();
      } else if (!success && mounted) {
        showError(context, 'Failed to disconnect from $name');
      }
    } catch (e) {
      if (mounted) {
        final theme = OpenCodeTheme.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(humanizeError(e)),
            backgroundColor: theme.error,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final connection = ref.watch(connectionProvider);
    final agentType = ref.watch(agentTypeProvider);
    final agentAvailable =
        connection.backends?.forType(agentType).available ??
        (agentType == AgentType.opencode ? connection.opencodeRunning : true);
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.background,
        elevation: 0,
        title: Text(
          'MCP',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: theme.text,
          ),
        ),
        bottom: TabBar(
          controller: _tabController,
          labelColor: theme.primary,
          unselectedLabelColor: theme.textMuted,
          indicatorColor: theme.primary,
          tabs: const [
            Tab(text: 'Servers', icon: Icon(AppIcons.extension_, size: 18)),
            Tab(text: 'Resources', icon: Icon(AppIcons.folder, size: 18)),
          ],
        ),
        actions: [
          IconButton(
            icon: Icon(AppIcons.settings, color: theme.text),
            tooltip: 'Edit MCP config',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const OpenCodeMcpConfigScreen(),
              ),
            ),
          ),
          IconButton(
            icon: Icon(AppIcons.refresh, color: theme.text),
            onPressed: () {
              if (_tabController.index == 0) {
                _loadServers();
              } else {
                _loadResources();
              }
            },
          ),
          Padding(
            padding: Insets.chipH,
            child: ConnectionIndicator(
              status: connection.status,
              agentAvailable: agentAvailable,
              isReconnecting: connection.isReconnecting,
              rttMs: connection.rttMs,
              compact: true,
            ),
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: TabBarView(
          controller: _tabController,
          children: [_buildServersTab(theme), _buildResourcesTab(theme)],
        ),
      ),
    );
  }

  Widget _buildServersTab(OpenCodeTheme theme) {
    if (_isLoading) {
      return Center(child: CircularProgressIndicator(color: theme.primary));
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(AppIcons.error, size: 48, color: theme.error),
            SizedBox(height: Spacing.lg),
            Text(
              'Failed to load MCP servers',
              style: TextStyle(color: theme.text, fontSize: 16),
            ),
            SizedBox(height: Spacing.sm),
            Text(
              _error!,
              style: AppTypography.labelLarge(color: theme.textMuted),
              textAlign: TextAlign.center,
            ),
            SizedBox(height: Spacing.xl),
            ElevatedButton(
              onPressed: _loadServers,
              style: ElevatedButton.styleFrom(
                backgroundColor: theme.primary,
                foregroundColor: theme.selectedListItemText,
              ),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }
    if (_servers.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(AppIcons.extensionOff, size: 64, color: theme.textMuted),
            SizedBox(height: Spacing.xl),
            Text(
              'No MCP Servers',
              style: TextStyle(
                color: theme.text,
                fontSize: 18,
                fontWeight: FontWeight.w600,
              ),
            ),
            SizedBox(height: Spacing.sm),
            Text(
              'Configure MCP servers in your\nOpenCode configuration file',
              style: AppTypography.labelLarge(color: theme.textMuted),
              textAlign: TextAlign.center,
            ),
            SizedBox(height: Spacing.xxl),
            OutlinedButton.icon(
              onPressed: _loadServers,
              icon: const Icon(AppIcons.refresh, size: 20),
              label: const Text('Refresh'),
              style: OutlinedButton.styleFrom(
                foregroundColor: theme.text,
                side: BorderSide(color: theme.borderSubtle),
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 12,
                ),
              ),
            ),
          ],
        ),
      );
    }
    final serverList = _servers.entries.toList();
    serverList.sort((a, b) {
      // Sort by connection status (connected first)
      if (a.value.isConnected != b.value.isConnected) {
        return a.value.isConnected ? -1 : 1;
      }
      return a.key.compareTo(b.key);
    });
    return RefreshIndicator(
      onRefresh: _loadServers,
      color: theme.primary,
      child: ListView.builder(
        padding: Insets.card,
        itemCount: serverList.length,
        itemBuilder: (context, index) {
          final entry = serverList[index];
          return _McpServerTile(
            name: entry.key,
            status: entry.value,
            onConnect: () => _connectServer(entry.key),
            onDisconnect: () => _disconnectServer(entry.key),
            onTap: () => _showServerDetails(entry.key, entry.value),
          );
        },
      ),
    );
  }

  Widget _buildResourcesTab(OpenCodeTheme theme) {
    if (_isLoadingResources) {
      return Center(child: CircularProgressIndicator(color: theme.primary));
    }
    if (_resourcesError != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(AppIcons.error, size: 48, color: theme.error),
            SizedBox(height: Spacing.lg),
            Text(
              'Failed to load MCP resources',
              style: TextStyle(color: theme.text, fontSize: 16),
            ),
            SizedBox(height: Spacing.sm),
            Text(
              _resourcesError!,
              style: AppTypography.labelLarge(color: theme.textMuted),
              textAlign: TextAlign.center,
            ),
            SizedBox(height: Spacing.xl),
            ElevatedButton(
              onPressed: _loadResources,
              style: ElevatedButton.styleFrom(
                backgroundColor: theme.primary,
                foregroundColor: theme.selectedListItemText,
              ),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }
    if (_resources.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(AppIcons.folderOff, size: 64, color: theme.textMuted),
            SizedBox(height: Spacing.xl),
            Text(
              'No MCP Resources',
              style: TextStyle(
                color: theme.text,
                fontSize: 18,
                fontWeight: FontWeight.w600,
              ),
            ),
            SizedBox(height: Spacing.sm),
            Text(
              'Resources will appear here when\nMCP servers provide them',
              style: AppTypography.labelLarge(color: theme.textMuted),
              textAlign: TextAlign.center,
            ),
            SizedBox(height: Spacing.xxl),
            OutlinedButton.icon(
              onPressed: _loadResources,
              icon: const Icon(AppIcons.refresh, size: 20),
              label: const Text('Refresh'),
              style: OutlinedButton.styleFrom(
                foregroundColor: theme.text,
                side: BorderSide(color: theme.borderSubtle),
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 12,
                ),
              ),
            ),
          ],
        ),
      );
    }
    // Group resources by client (MCP server)
    final resourcesByClient = <String, List<MapEntry<String, McpResource>>>{};
    for (final entry in _resources.entries) {
      final client = entry.value.client;
      resourcesByClient.putIfAbsent(client, () => []).add(entry);
    }
    return RefreshIndicator(
      onRefresh: _loadResources,
      color: theme.primary,
      child: ListView.builder(
        padding: Insets.card,
        itemCount: resourcesByClient.length,
        itemBuilder: (context, index) {
          final clientEntry = resourcesByClient.entries.elementAt(index);
          return _McpResourceGroup(
            clientName: clientEntry.key,
            resources: clientEntry.value,
            onResourceTap: (resource) => _showResourceDetails(resource),
          );
        },
      ),
    );
  }

  void _showResourceDetails(McpResource resource) {
    final sheetTheme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: resource.name,
      initialSize: 0.5,
      child: Padding(
        padding: Insets.screenAll,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: Insets.cardSm,
                  decoration: BoxDecoration(
                    color: sheetTheme.primary.withValues(alpha: 0.15),
                    borderRadius: Radii.brMd,
                  ),
                  child: Icon(
                    _getResourceIcon(resource.mimeType),
                    color: sheetTheme.primary,
                    size: 24,
                  ),
                ),
                SizedBox(width: Spacing.lg),
                Expanded(
                  child: Text(
                    'from ${resource.client}',
                    style: TextStyle(color: sheetTheme.textMuted, fontSize: 14),
                  ),
                ),
              ],
            ),
            SizedBox(height: Spacing.xl),
            // URI
            _DetailRow(label: 'URI', value: resource.uri),
            // MIME Type
            if (resource.mimeType != null)
              _DetailRow(label: 'Type', value: resource.mimeType!),
            // Description
            if (resource.description != null &&
                resource.description!.isNotEmpty) ...[
              SizedBox(height: Spacing.md),
              Text(
                'Description',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: sheetTheme.textMuted,
                ),
              ),
              SizedBox(height: Spacing.sm),
              Text(
                resource.description!,
                style: TextStyle(color: sheetTheme.text, fontSize: 14),
              ),
            ],
          ],
        ),
      ),
    );
  }

  IconData _getResourceIcon(String? mimeType) {
    if (mimeType == null) return AppIcons.folder;
    if (mimeType.startsWith('text/')) return AppIcons.description;
    if (mimeType.startsWith('image/')) return AppIcons.image;
    if (mimeType.startsWith('application/json')) return AppIcons.dataObject;
    if (mimeType.contains('directory')) return AppIcons.folder;
    return AppIcons.file;
  }

  void _showServerDetails(String name, McpServerStatus status) {
    final sheetTheme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: name,
      initialSize: 0.5,
      child: Padding(
        padding: Insets.screenAll,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: Insets.cardSm,
                  decoration: BoxDecoration(
                    color: _getStatusColor(
                      status.status,
                      sheetTheme,
                    ).withValues(alpha: 0.15),
                    borderRadius: Radii.brMd,
                  ),
                  child: Icon(
                    AppIcons.extension_,
                    color: _getStatusColor(status.status, sheetTheme),
                    size: 24,
                  ),
                ),
                SizedBox(width: Spacing.lg),
                Expanded(
                  child: Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: _getStatusColor(status.status, sheetTheme),
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        status.statusDisplay,
                        style: TextStyle(
                          color: _getStatusColor(status.status, sheetTheme),
                          fontSize: 14,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            SizedBox(height: Spacing.xxl),
            // Tools
            if (status.tools.isNotEmpty) ...[
              Text(
                'Tools',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: sheetTheme.textMuted,
                ),
              ),
              SizedBox(height: Spacing.sm),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: status.tools
                    .map(
                      (tool) =>
                          _CapabilityChip(label: tool, icon: AppIcons.build),
                    )
                    .toList(),
              ),
              SizedBox(height: Spacing.lg),
            ],
            // Resources
            if (status.resources.isNotEmpty) ...[
              Text(
                'Resources',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: sheetTheme.textMuted,
                ),
              ),
              SizedBox(height: Spacing.sm),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: status.resources
                    .map(
                      (resource) => _CapabilityChip(
                        label: resource,
                        icon: AppIcons.folder,
                      ),
                    )
                    .toList(),
              ),
              SizedBox(height: Spacing.lg),
            ],
            // Error message
            if (status.error != null && status.error!.isNotEmpty) ...[
              Container(
                padding: Insets.cardSm,
                decoration: BoxDecoration(
                  color: sheetTheme.error.withValues(alpha: 0.1),
                  borderRadius: Radii.brMd,
                  border: Border.all(
                    color: sheetTheme.error.withValues(alpha: 0.3),
                  ),
                ),
                child: Row(
                  children: [
                    Icon(AppIcons.error, color: sheetTheme.error, size: 20),
                    SizedBox(width: Spacing.md),
                    Expanded(
                      child: Text(
                        status.error!,
                        style: TextStyle(color: sheetTheme.error, fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(height: Spacing.lg),
            ],
            SizedBox(height: Spacing.sm),
            // Action button
            SizedBox(
              width: double.infinity,
              child: status.isConnected
                  ? OutlinedButton.icon(
                      onPressed: () {
                        Navigator.pop(context);
                        _disconnectServer(name);
                      },
                      icon: const Icon(AppIcons.unlink, size: 18),
                      label: const Text('Disconnect'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: sheetTheme.error,
                        side: BorderSide(color: sheetTheme.error),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    )
                  : ElevatedButton.icon(
                      onPressed: () {
                        Navigator.pop(context);
                        _connectServer(name);
                      },
                      icon: const Icon(AppIcons.link, size: 18),
                      label: const Text('Connect'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: sheetTheme.primary,
                        foregroundColor: sheetTheme.selectedListItemText,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Color _getStatusColor(McpConnectionStatus status, OpenCodeTheme theme) {
    switch (status) {
      case McpConnectionStatus.connected:
        return theme.success;
      case McpConnectionStatus.connecting:
        return theme.warning;
      case McpConnectionStatus.error:
        return theme.error;
      case McpConnectionStatus.disconnected:
      case McpConnectionStatus.disabled:
        return theme.textMuted;
      case McpConnectionStatus.needsAuth:
      case McpConnectionStatus.needsClientRegistration:
        return theme.warning;
    }
  }
}

class _McpServerTile extends StatelessWidget {
  const _McpServerTile({
    required this.name,
    required this.status,
    required this.onConnect,
    required this.onDisconnect,
    required this.onTap,
  });
  final String name;
  final McpServerStatus status;
  final VoidCallback onConnect;
  final VoidCallback onDisconnect;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: Insets.bottomMd,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: Radii.brLg,
          child: Padding(
            padding: Insets.card,
            child: Row(
              children: [
                // Server icon with status
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: _getStatusColor(
                      status.status,
                      theme,
                    ).withValues(alpha: 0.15),
                    borderRadius: Radii.brMd,
                  ),
                  child: Stack(
                    children: [
                      Center(
                        child: Icon(
                          AppIcons.extension_,
                          color: _getStatusColor(status.status, theme),
                          size: 24,
                        ),
                      ),
                      Positioned(
                        right: 4,
                        bottom: 4,
                        child: Container(
                          width: 10,
                          height: 10,
                          decoration: BoxDecoration(
                            color: _getStatusColor(status.status, theme),
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: theme.backgroundPanel,
                              width: 2,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(width: Spacing.lg),
                // Name and info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: theme.text,
                        ),
                      ),
                      SizedBox(height: Spacing.xs),
                      Row(
                        children: [
                          Text(
                            status.statusDisplay,
                            style: TextStyle(
                              fontSize: 13,
                              color: _getStatusColor(status.status, theme),
                            ),
                          ),
                          if (status.capabilityCount > 0) ...[
                            Text(
                              ' • ',
                              style: TextStyle(color: theme.textMuted),
                            ),
                            Text(
                              '${status.capabilityCount} capabilities',
                              style: TextStyle(
                                fontSize: 13,
                                color: theme.textMuted,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
                // Connect/Disconnect button
                if (status.isConnected)
                  IconButton(
                    onPressed: onDisconnect,
                    icon: Icon(AppIcons.unlink, color: theme.error),
                    tooltip: 'Disconnect',
                  )
                else if (!status.isConnecting)
                  IconButton(
                    onPressed: onConnect,
                    icon: Icon(AppIcons.link, color: theme.primary),
                    tooltip: 'Connect',
                  )
                else
                  SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(
                      color: theme.warning,
                      strokeWidth: 2,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Color _getStatusColor(McpConnectionStatus status, OpenCodeTheme theme) {
    switch (status) {
      case McpConnectionStatus.connected:
        return theme.success;
      case McpConnectionStatus.connecting:
        return theme.warning;
      case McpConnectionStatus.error:
        return theme.error;
      case McpConnectionStatus.disconnected:
      case McpConnectionStatus.disabled:
        return theme.textMuted;
      case McpConnectionStatus.needsAuth:
      case McpConnectionStatus.needsClientRegistration:
        return theme.warning;
    }
  }
}

class _CapabilityChip extends StatelessWidget {
  const _CapabilityChip({required this.label, required this.icon});
  final String label;
  final IconData icon;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: theme.primary.withValues(alpha: 0.1),
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.primary.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: theme.primary),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: theme.primary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

/// Widget to display a group of MCP resources from a single server
class _McpResourceGroup extends StatelessWidget {
  const _McpResourceGroup({
    required this.clientName,
    required this.resources,
    required this.onResourceTap,
  });
  final String clientName;
  final List<MapEntry<String, McpResource>> resources;
  final void Function(McpResource) onResourceTap;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: Spacing.lg),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Padding(
            padding: Insets.card,
            child: Row(
              children: [
                Icon(AppIcons.extension_, color: theme.primary, size: 20),
                SizedBox(width: Spacing.sm),
                Text(
                  clientName,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: theme.text,
                  ),
                ),
                SizedBox(width: Spacing.sm),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: theme.primary.withValues(alpha: 0.1),
                    borderRadius: Radii.brMd,
                  ),
                  child: Text(
                    '${resources.length}',
                    style: TextStyle(
                      fontSize: 12,
                      color: theme.primary,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          // Resources
          ...resources.map(
            (entry) => _McpResourceTile(
              resource: entry.value,
              onTap: () => onResourceTap(entry.value),
            ),
          ),
        ],
      ),
    );
  }
}

/// Widget to display a single MCP resource
class _McpResourceTile extends StatelessWidget {
  const _McpResourceTile({required this.resource, required this.onTap});
  final McpResource resource;
  final VoidCallback onTap;
  IconData _getIcon() {
    final mimeType = resource.mimeType;
    if (mimeType == null) return AppIcons.folder;
    if (mimeType.startsWith('text/')) return AppIcons.description;
    if (mimeType.startsWith('image/')) return AppIcons.image;
    if (mimeType.startsWith('application/json')) return AppIcons.dataObject;
    if (mimeType.contains('directory')) return AppIcons.folder;
    return AppIcons.file;
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: Insets.section,
          child: Row(
            children: [
              Icon(_getIcon(), color: theme.textMuted, size: 20),
              SizedBox(width: Spacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      resource.name,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        color: theme.text,
                      ),
                    ),
                    if (resource.description != null &&
                        resource.description!.isNotEmpty)
                      Text(
                        resource.description!,
                        style: AppTypography.label(color: theme.textMuted),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                ),
              ),
              Icon(AppIcons.chevronRight, color: theme.textMuted, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

/// Widget to display a detail row in the resource details sheet
class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.bottomSm,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 60,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                color: theme.textMuted,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: AppTypography.bodySmall(color: theme.text),
            ),
          ),
        ],
      ),
    );
  }
}
