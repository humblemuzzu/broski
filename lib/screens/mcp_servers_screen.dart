import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/mcp.dart';
import '../providers/connection_provider.dart';
import '../providers/service_providers.dart';
import '../providers/selection_provider.dart';
import '../widgets/connection_indicator.dart';

// Color constants matching chat screen design
const _kBackground = Color(0xFF16161E);
const _kCard = Color(0xFF1F2128);
const _kBorder = Color(0xFF2A2D36);
const _kOnBackground = Color(0xFFE4E4E7);
const _kMuted = Color(0xFF71717A);
const _kAccent = Color(0xFF3B82F6);
const _kSuccess = Color(0xFF10B981);
const _kError = Color(0xFFEF4444);
const _kWarning = Color(0xFFFBBF24);

/// MCP (Model Context Protocol) Servers Management Screen
///
/// Allows users to view, connect, and disconnect MCP servers that provide
/// additional tools and resources to the AI.
class McpServersScreen extends ConsumerStatefulWidget {
  const McpServersScreen({super.key});

  @override
  ConsumerState<McpServersScreen> createState() => _McpServersScreenState();
}

class _McpServersScreenState extends ConsumerState<McpServersScreen> {
  Map<String, McpServerStatus> _servers = {};
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadServers();
  }

  Future<void> _loadServers() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final servers = await bridge.getMcpStatus(
        projectPath: selection.project?.path,
      );
      if (mounted) {
        setState(() {
          _servers = servers;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Connected to $name'),
            backgroundColor: _kCard,
          ),
        );
        _loadServers();
      } else if (!success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to connect to $name'),
            backgroundColor: _kError,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: _kError),
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Disconnected from $name'),
            backgroundColor: _kCard,
          ),
        );
        _loadServers();
      } else if (!success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to disconnect from $name'),
            backgroundColor: _kError,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: _kError),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);

    return Scaffold(
      backgroundColor: _kBackground,
      appBar: AppBar(
        backgroundColor: _kBackground,
        elevation: 0,
        title: const Text(
          'MCP Servers',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: _kOnBackground,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: _kOnBackground),
            onPressed: _loadServers,
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: ConnectionIndicator(
              status: connection.status,
              opencodeRunning: connection.opencodeRunning,
              compact: true,
            ),
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: _kAccent));
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: _kError),
            const SizedBox(height: 16),
            const Text(
              'Failed to load MCP servers',
              style: TextStyle(color: _kOnBackground, fontSize: 16),
            ),
            const SizedBox(height: 8),
            Text(
              _error!,
              style: const TextStyle(color: _kMuted, fontSize: 14),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: _loadServers,
              style: ElevatedButton.styleFrom(
                backgroundColor: _kAccent,
                foregroundColor: Colors.white,
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
            const Icon(Icons.extension_off, size: 64, color: _kMuted),
            const SizedBox(height: 20),
            const Text(
              'No MCP Servers',
              style: TextStyle(
                color: _kOnBackground,
                fontSize: 18,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Configure MCP servers in your\nOpenCode configuration file',
              style: TextStyle(color: _kMuted, fontSize: 14),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            OutlinedButton.icon(
              onPressed: _loadServers,
              icon: const Icon(Icons.refresh, size: 20),
              label: const Text('Refresh'),
              style: OutlinedButton.styleFrom(
                foregroundColor: _kOnBackground,
                side: const BorderSide(color: _kBorder),
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
      color: _kAccent,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
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

  void _showServerDetails(String name, McpServerStatus status) {
    showModalBottomSheet(
      context: context,
      backgroundColor: _kCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Container(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: _getStatusColor(
                      status.status,
                    ).withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    Icons.extension,
                    color: _getStatusColor(status.status),
                    size: 24,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: _kOnBackground,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: _getStatusColor(status.status),
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            status.statusDisplay,
                            style: TextStyle(
                              color: _getStatusColor(status.status),
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),

            // Tools
            if (status.tools.isNotEmpty) ...[
              const Text(
                'Tools',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: _kMuted,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: status.tools
                    .map(
                      (tool) => _CapabilityChip(
                        label: tool,
                        icon: Icons.build_outlined,
                      ),
                    )
                    .toList(),
              ),
              const SizedBox(height: 16),
            ],

            // Resources
            if (status.resources.isNotEmpty) ...[
              const Text(
                'Resources',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: _kMuted,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: status.resources
                    .map(
                      (resource) => _CapabilityChip(
                        label: resource,
                        icon: Icons.folder_outlined,
                      ),
                    )
                    .toList(),
              ),
              const SizedBox(height: 16),
            ],

            // Error message
            if (status.error != null && status.error!.isNotEmpty) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: _kError.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: _kError.withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: _kError, size: 20),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        status.error!,
                        style: const TextStyle(color: _kError, fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],

            const SizedBox(height: 8),

            // Action button
            SizedBox(
              width: double.infinity,
              child: status.isConnected
                  ? OutlinedButton.icon(
                      onPressed: () {
                        Navigator.pop(context);
                        _disconnectServer(name);
                      },
                      icon: const Icon(Icons.link_off, size: 18),
                      label: const Text('Disconnect'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: _kError,
                        side: const BorderSide(color: _kError),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    )
                  : ElevatedButton.icon(
                      onPressed: () {
                        Navigator.pop(context);
                        _connectServer(name);
                      },
                      icon: const Icon(Icons.link, size: 18),
                      label: const Text('Connect'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _kAccent,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }

  Color _getStatusColor(McpConnectionStatus status) {
    switch (status) {
      case McpConnectionStatus.connected:
        return _kSuccess;
      case McpConnectionStatus.connecting:
        return _kWarning;
      case McpConnectionStatus.error:
        return _kError;
      case McpConnectionStatus.disconnected:
        return _kMuted;
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
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _kBorder),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                // Server icon with status
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: _getStatusColor(
                      status.status,
                    ).withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Stack(
                    children: [
                      Center(
                        child: Icon(
                          Icons.extension,
                          color: _getStatusColor(status.status),
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
                            color: _getStatusColor(status.status),
                            shape: BoxShape.circle,
                            border: Border.all(color: _kCard, width: 2),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                // Name and info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: _kOnBackground,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Text(
                            status.statusDisplay,
                            style: TextStyle(
                              fontSize: 13,
                              color: _getStatusColor(status.status),
                            ),
                          ),
                          if (status.capabilityCount > 0) ...[
                            const Text(' • ', style: TextStyle(color: _kMuted)),
                            Text(
                              '${status.capabilityCount} capabilities',
                              style: const TextStyle(
                                fontSize: 13,
                                color: _kMuted,
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
                    icon: const Icon(Icons.link_off, color: _kError),
                    tooltip: 'Disconnect',
                  )
                else if (!status.isConnecting)
                  IconButton(
                    onPressed: onConnect,
                    icon: const Icon(Icons.link, color: _kAccent),
                    tooltip: 'Connect',
                  )
                else
                  const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(
                      color: _kWarning,
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

  Color _getStatusColor(McpConnectionStatus status) {
    switch (status) {
      case McpConnectionStatus.connected:
        return _kSuccess;
      case McpConnectionStatus.connecting:
        return _kWarning;
      case McpConnectionStatus.error:
        return _kError;
      case McpConnectionStatus.disconnected:
        return _kMuted;
    }
  }
}

class _CapabilityChip extends StatelessWidget {
  const _CapabilityChip({required this.label, required this.icon});

  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: _kAccent.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: _kAccent.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: _kAccent),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              color: _kAccent,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
