import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/provider.dart';
import '../providers/service_providers.dart';
import '../providers/selection_provider.dart';
import '../theme/opencode_theme.dart';

class ProvidersScreen extends ConsumerStatefulWidget {
  const ProvidersScreen({super.key});

  @override
  ConsumerState<ProvidersScreen> createState() => _ProvidersScreenState();
}

class _ProvidersScreenState extends ConsumerState<ProvidersScreen> {
  ProviderInfo? _providerInfo;
  Map<String, List<ProviderAuthMethod>>? _authMethods;
  String? _currentModel;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);

      final results = await Future.wait([
        bridge.listAllProviders(projectPath: selection.project?.path),
        bridge.getProviderAuth(projectPath: selection.project?.path),
        bridge.getConfig(),
      ]);

      if (mounted) {
        setState(() {
          _providerInfo = results[0] as ProviderInfo;
          _authMethods = results[1] as Map<String, List<ProviderAuthMethod>>;
          final config = results[2] as Map<String, dynamic>;
          _currentModel = config['model'] as String?;
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

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.background,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_rounded, color: theme.text),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'Providers',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: theme.text,
          ),
        ),
        actions: [
          IconButton(
            icon: Icon(Icons.refresh_rounded, color: theme.text),
            onPressed: _loadData,
          ),
        ],
      ),
      body: _isLoading
          ? Center(child: CircularProgressIndicator(color: theme.primary))
          : _error != null
          ? _buildError(theme)
          : _buildContent(theme),
    );
  }

  Widget _buildError(OpenCodeTheme theme) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.error_outline, size: 48, color: theme.error),
          const SizedBox(height: 16),
          Text(
            'Failed to load providers',
            style: TextStyle(color: theme.text, fontSize: 16),
          ),
          const SizedBox(height: 8),
          Text(
            _error!,
            style: TextStyle(color: theme.textMuted, fontSize: 14),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _loadData,
            style: ElevatedButton.styleFrom(
              backgroundColor: theme.primary,
              foregroundColor: Colors.white,
            ),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Widget _buildContent(OpenCodeTheme theme) {
    if (_providerInfo == null || _providerInfo!.all.isEmpty) {
      return Center(
        child: Text(
          'No providers available',
          style: TextStyle(color: theme.textMuted, fontSize: 16),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadData,
      color: theme.primary,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Current model section
          if (_currentModel != null) ...[
            const _SectionHeader(title: 'Current Model'),
            _CurrentModelCard(model: _currentModel!),
            const SizedBox(height: 24),
          ],

          // Providers section
          const _SectionHeader(title: 'Available Providers'),
          ..._providerInfo!.all.map(
            (provider) => _ProviderCard(
              provider: provider,
              isConnected: _providerInfo!.isConnected(provider.id),
              authMethods: _authMethods?[provider.id] ?? [],
              onSelectModel: (modelId) => _selectModel(provider.id, modelId),
              onSetApiKey: (key) => _setApiKey(provider.id, key),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _selectModel(String providerId, String modelId) async {
    final bridge = ref.read(bridgeServiceProvider);
    final model = '$providerId/$modelId';
    final theme = OpenCodeTheme.of(context);

    try {
      await bridge.setModel(model);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Switched to $model'),
            backgroundColor: theme.success,
          ),
        );
        _loadData();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to switch model: $e'),
            backgroundColor: theme.error,
          ),
        );
      }
    }
  }

  Future<void> _setApiKey(String providerId, String key) async {
    final bridge = ref.read(bridgeServiceProvider);
    final selection = ref.read(selectionProvider);
    final theme = OpenCodeTheme.of(context);

    try {
      final success = await bridge.setApiKey(
        providerID: providerId,
        key: key,
        projectPath: selection.project?.path,
      );
      if (mounted) {
        if (success) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('API key set for $providerId'),
              backgroundColor: theme.success,
            ),
          );
          _loadData();
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text('Failed to set API key'),
              backgroundColor: theme.error,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: theme.error),
        );
      }
    }
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          color: theme.textMuted,
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

class _CurrentModelCard extends StatelessWidget {
  const _CurrentModelCard({required this.model});

  final String model;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final parts = model.split('/');
    final provider = parts.isNotEmpty ? parts.first : 'Unknown';
    final modelName = parts.length > 1 ? parts.sublist(1).join('/') : model;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.primary.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: theme.primary.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(Icons.psychology, color: theme.primary, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  modelName,
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  provider,
                  style: TextStyle(color: theme.textMuted, fontSize: 13),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: theme.success.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              'Active',
              style: TextStyle(
                color: theme.success,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProviderCard extends StatelessWidget {
  const _ProviderCard({
    required this.provider,
    required this.isConnected,
    required this.authMethods,
    required this.onSelectModel,
    required this.onSetApiKey,
  });

  final ProviderDetails provider;
  final bool isConnected;
  final List<ProviderAuthMethod> authMethods;
  final void Function(String modelId) onSelectModel;
  final void Function(String key) onSetApiKey;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          leading: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: isConnected
                  ? theme.success.withValues(alpha: 0.15)
                  : theme.textMuted.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              _getProviderIcon(provider.id),
              color: isConnected ? theme.success : theme.textMuted,
              size: 22,
            ),
          ),
          title: Text(
            provider.name,
            style: TextStyle(
              color: theme.text,
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Row(
              children: [
                Text(
                  '${provider.modelCount} models',
                  style: TextStyle(color: theme.textMuted, fontSize: 13),
                ),
                if (isConnected) ...[
                  const SizedBox(width: 8),
                  Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: theme.success,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'Connected',
                    style: TextStyle(color: theme.success, fontSize: 12),
                  ),
                ],
              ],
            ),
          ),
          trailing: Icon(Icons.expand_more, color: theme.textMuted),
          iconColor: theme.textMuted,
          collapsedIconColor: theme.textMuted,
          children: [
            // Auth section (if not connected and has API key auth)
            if (!isConnected && authMethods.any((m) => m.isApiKey)) ...[
              _ApiKeyInput(providerId: provider.id, onSubmit: onSetApiKey),
              const SizedBox(height: 16),
            ],

            // Models list
            ...provider.models.entries.map(
              (entry) => _ModelTile(
                modelId: entry.key,
                modelInfo: entry.value,
                onSelect: () => onSelectModel(entry.key),
              ),
            ),
          ],
        ),
      ),
    );
  }

  IconData _getProviderIcon(String providerId) {
    switch (providerId.toLowerCase()) {
      case 'anthropic':
        return Icons.auto_awesome;
      case 'openai':
        return Icons.smart_toy;
      case 'google':
        return Icons.g_mobiledata;
      case 'aws':
        return Icons.cloud;
      case 'azure':
        return Icons.cloud_queue;
      default:
        return Icons.psychology;
    }
  }
}

class _ApiKeyInput extends StatefulWidget {
  const _ApiKeyInput({required this.providerId, required this.onSubmit});

  final String providerId;
  final void Function(String key) onSubmit;

  @override
  State<_ApiKeyInput> createState() => _ApiKeyInputState();
}

class _ApiKeyInputState extends State<_ApiKeyInput> {
  final _controller = TextEditingController();
  bool _obscureText = true;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'API Key',
            style: TextStyle(
              color: theme.text,
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _controller,
                  obscureText: _obscureText,
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 14,
                    fontFamily: 'JetBrains Mono',
                  ),
                  decoration: InputDecoration(
                    hintText: 'Enter your API key...',
                    hintStyle: TextStyle(color: theme.textMuted),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.zero,
                    suffixIcon: IconButton(
                      icon: Icon(
                        _obscureText ? Icons.visibility : Icons.visibility_off,
                        color: theme.textMuted,
                        size: 20,
                      ),
                      onPressed: () {
                        setState(() => _obscureText = !_obscureText);
                      },
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              TextButton(
                onPressed: _controller.text.isNotEmpty
                    ? () => widget.onSubmit(_controller.text)
                    : null,
                style: TextButton.styleFrom(
                  backgroundColor: theme.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                child: const Text('Save'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ModelTile extends StatelessWidget {
  const _ModelTile({
    required this.modelId,
    required this.modelInfo,
    required this.onSelect,
  });

  final String modelId;
  final ModelInfo modelInfo;
  final VoidCallback onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return InkWell(
      onTap: onSelect,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(12),
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: theme.background,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    modelInfo.name,
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      if (modelInfo.contextWindow != null) ...[
                        Icon(Icons.memory, size: 12, color: theme.textMuted),
                        const SizedBox(width: 4),
                        Text(
                          modelInfo.displayContextWindow,
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 11,
                          ),
                        ),
                        const SizedBox(width: 12),
                      ],
                      Text(
                        modelId,
                        style: TextStyle(
                          color: theme.textMuted,
                          fontSize: 11,
                          fontFamily: 'JetBrains Mono',
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: theme.textMuted, size: 20),
          ],
        ),
      ),
    );
  }
}
