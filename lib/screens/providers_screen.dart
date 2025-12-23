import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/provider.dart';
import '../providers/service_providers.dart';
import '../providers/selection_provider.dart';

// Color constants matching chat screen design
const _kBackground = Color(0xFF16161E);
const _kCard = Color(0xFF1F2128);
const _kBorder = Color(0xFF2A2D36);
const _kOnBackground = Color(0xFFE4E4E7);
const _kMuted = Color(0xFF71717A);
const _kAccent = Color(0xFF3B82F6);
const _kSuccess = Color(0xFF10B981);
const _kError = Color(0xFFEF4444);

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
    return Scaffold(
      backgroundColor: _kBackground,
      appBar: AppBar(
        backgroundColor: _kBackground,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: _kOnBackground),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          'Providers',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: _kOnBackground,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: _kOnBackground),
            onPressed: _loadData,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: _kAccent))
          : _error != null
          ? _buildError()
          : _buildContent(),
    );
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 48, color: _kError),
          const SizedBox(height: 16),
          Text(
            'Failed to load providers',
            style: const TextStyle(color: _kOnBackground, fontSize: 16),
          ),
          const SizedBox(height: 8),
          Text(
            _error!,
            style: const TextStyle(color: _kMuted, fontSize: 14),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _loadData,
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

  Widget _buildContent() {
    if (_providerInfo == null || _providerInfo!.all.isEmpty) {
      return const Center(
        child: Text(
          'No providers available',
          style: TextStyle(color: _kMuted, fontSize: 16),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadData,
      color: _kAccent,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Current model section
          if (_currentModel != null) ...[
            _SectionHeader(title: 'Current Model'),
            _CurrentModelCard(model: _currentModel!),
            const SizedBox(height: 24),
          ],

          // Providers section
          _SectionHeader(title: 'Available Providers'),
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

    try {
      await bridge.setModel(model);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Switched to $model'),
            backgroundColor: _kSuccess,
          ),
        );
        _loadData();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to switch model: $e'),
            backgroundColor: _kError,
          ),
        );
      }
    }
  }

  Future<void> _setApiKey(String providerId, String key) async {
    final bridge = ref.read(bridgeServiceProvider);
    final selection = ref.read(selectionProvider);

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
              backgroundColor: _kSuccess,
            ),
          );
          _loadData();
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Failed to set API key'),
              backgroundColor: _kError,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: _kError),
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
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        title.toUpperCase(),
        style: const TextStyle(
          color: _kMuted,
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
    final parts = model.split('/');
    final provider = parts.isNotEmpty ? parts.first : 'Unknown';
    final modelName = parts.length > 1 ? parts.sublist(1).join('/') : model;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _kAccent.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: _kAccent.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.psychology, color: _kAccent, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  modelName,
                  style: const TextStyle(
                    color: _kOnBackground,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  provider,
                  style: const TextStyle(color: _kMuted, fontSize: 13),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: _kSuccess.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Text(
              'Active',
              style: TextStyle(
                color: _kSuccess,
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
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _kBorder),
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
                  ? _kSuccess.withValues(alpha: 0.15)
                  : _kMuted.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              _getProviderIcon(provider.id),
              color: isConnected ? _kSuccess : _kMuted,
              size: 22,
            ),
          ),
          title: Text(
            provider.name,
            style: const TextStyle(
              color: _kOnBackground,
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
                  style: const TextStyle(color: _kMuted, fontSize: 13),
                ),
                if (isConnected) ...[
                  const SizedBox(width: 8),
                  Container(
                    width: 6,
                    height: 6,
                    decoration: const BoxDecoration(
                      color: _kSuccess,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 4),
                  const Text(
                    'Connected',
                    style: TextStyle(color: _kSuccess, fontSize: 12),
                  ),
                ],
              ],
            ),
          ),
          trailing: const Icon(Icons.expand_more, color: _kMuted),
          iconColor: _kMuted,
          collapsedIconColor: _kMuted,
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
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _kBackground,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _kBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'API Key',
            style: TextStyle(
              color: _kOnBackground,
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
                  style: const TextStyle(
                    color: _kOnBackground,
                    fontSize: 14,
                    fontFamily: 'JetBrains Mono',
                  ),
                  decoration: InputDecoration(
                    hintText: 'Enter your API key...',
                    hintStyle: const TextStyle(color: _kMuted),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.zero,
                    suffixIcon: IconButton(
                      icon: Icon(
                        _obscureText ? Icons.visibility : Icons.visibility_off,
                        color: _kMuted,
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
                  backgroundColor: _kAccent,
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
    return InkWell(
      onTap: onSelect,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(12),
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: _kBackground,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: _kBorder),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    modelInfo.name,
                    style: const TextStyle(
                      color: _kOnBackground,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      if (modelInfo.contextWindow != null) ...[
                        Icon(Icons.memory, size: 12, color: _kMuted),
                        const SizedBox(width: 4),
                        Text(
                          modelInfo.displayContextWindow,
                          style: const TextStyle(color: _kMuted, fontSize: 11),
                        ),
                        const SizedBox(width: 12),
                      ],
                      Text(
                        modelId,
                        style: const TextStyle(
                          color: _kMuted,
                          fontSize: 11,
                          fontFamily: 'JetBrains Mono',
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: _kMuted, size: 20),
          ],
        ),
      ),
    );
  }
}
