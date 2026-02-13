
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/stt_settings.dart';
import '../providers/stt_provider.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
class VoiceSettingsScreen extends ConsumerStatefulWidget {
  const VoiceSettingsScreen({super.key});
  @override
  ConsumerState<VoiceSettingsScreen> createState() =>
      _VoiceSettingsScreenState();
}
class _VoiceSettingsScreenState extends ConsumerState<VoiceSettingsScreen> {
  final _groqKeyController = TextEditingController();
  final _openaiKeyController = TextEditingController();
  bool _showGroqKey = false;
  bool _showOpenaiKey = false;
  bool _testingKey = false;
  String? _testResult;
  @override
  void initState() {
    super.initState();
    // Load existing keys into controllers
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final settings = ref.read(sttProvider).settings;
      _groqKeyController.text = settings.groqApiKey ?? '';
      _openaiKeyController.text = settings.openaiApiKey ?? '';
    });
  }
  @override
  void dispose() {
    _groqKeyController.dispose();
    _openaiKeyController.dispose();
    super.dispose();
  }
  Future<void> _testApiKey(SttProvider provider) async {
    final controller = provider == SttProvider.groq
        ? _groqKeyController
        : _openaiKeyController;
    final key = controller.text.trim();
    if (key.isEmpty) {
      setState(() => _testResult = 'Please enter an API key');
      return;
    }
    setState(() {
      _testingKey = true;
      _testResult = null;
    });
    final notifier = ref.read(sttProvider.notifier);
    final error = await notifier.testSpecificApiKey(provider, key);
    if (!mounted) return;
    setState(() {
      _testingKey = false;
      if (error == null) {
        _testResult = 'API key is valid!';
        // Save the key
        notifier.setApiKey(provider, key);
      } else {
        _testResult = error;
      }
    });
    // Clear result after 3 seconds
    Future.delayed(const Duration(seconds: 3), () {
      if (mounted) setState(() => _testResult = null);
    });
  }
  Future<void> _openProviderDocs(SttProvider provider) async {
    final url = provider == SttProvider.groq
        ? 'https://console.groq.com/keys'
        : 'https://platform.openai.com/api-keys';
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final sttState = ref.watch(sttProvider);
    final settings = sttState.settings;
    final notifier = ref.read(sttProvider.notifier);
    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: ocTheme.background,
        elevation: 0,
        title: Text('Voice Input', style: TextStyle(color: ocTheme.text)),
        iconTheme: IconThemeData(color: ocTheme.text),
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: ListView(
        padding: Insets.card,
        children: [
          // Info box
          Container(
            padding: Insets.cardMd,
            decoration: BoxDecoration(
              color: ocTheme.primary.withValues(alpha: 0.1),
              borderRadius: Radii.brMd,
              border: Border.all(color: ocTheme.primary.withValues(alpha: 0.3)),
            ),
            child: Row(
              children: [
                Icon(AppIcons.mic, color: ocTheme.primary, size: 20),
                SizedBox(width: Spacing.md),
                Expanded(
                  child: Text(
                    'Speak to type messages. Your voice is transcribed using your own API keys (BYOK).',
                    style: TextStyle(
                      color: ocTheme.primary,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(height: Spacing.lg),
          // Provider Selection
          _Section(
            title: 'Provider',
            children: [
              _ProviderTile(
                provider: SttProvider.groq,
                isSelected: settings.provider == SttProvider.groq,
                subtitle: '10x cheaper, 20x faster',
                badge: 'Recommended',
                onTap: () => notifier.setProvider(SttProvider.groq),
              ),
              _ProviderTile(
                provider: SttProvider.openai,
                isSelected: settings.provider == SttProvider.openai,
                subtitle: 'Most familiar, well-documented',
                onTap: () => notifier.setProvider(SttProvider.openai),
              ),
            ],
          ),
          SizedBox(height: Spacing.md),
          // Model Selection
          _Section(
            title: 'Model',
            children: [
              ...SttModels.forProvider(settings.provider).map(
                (model) => _ModelTile(
                  model: model,
                  isSelected: settings.modelId == model.id,
                  onTap: () => notifier.setModel(model.id),
                ),
              ),
            ],
          ),
          SizedBox(height: Spacing.md),
          // API Key Input
          _Section(
            title: '${settings.provider.displayName} API Key',
            children: [
              Padding(
                padding: Insets.card,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Key input field
                    TextField(
                      controller: settings.provider == SttProvider.groq
                          ? _groqKeyController
                          : _openaiKeyController,
                      obscureText: settings.provider == SttProvider.groq
                          ? !_showGroqKey
                          : !_showOpenaiKey,
                      style: TextStyle(color: ocTheme.text, fontSize: 14),
                      decoration: InputDecoration(
                        hintText: 'Enter your API key',
                        hintStyle: TextStyle(color: ocTheme.textMuted),
                        filled: true,
                        fillColor: ocTheme.background,
                        border: OutlineInputBorder(
                          borderRadius: Radii.brMd,
                          borderSide: BorderSide(color: ocTheme.borderSubtle),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: Radii.brMd,
                          borderSide: BorderSide(color: ocTheme.borderSubtle),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: Radii.brMd,
                          borderSide: BorderSide(color: ocTheme.primary),
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 12,
                        ),
                        suffixIcon: IconButton(
                          icon: Icon(
                            settings.provider == SttProvider.groq
                                ? (_showGroqKey
                                      ? AppIcons.visibilityOff
                                      : AppIcons.visibility)
                                : (_showOpenaiKey
                                      ? AppIcons.visibilityOff
                                      : AppIcons.visibility),
                            color: ocTheme.textMuted,
                            size: 20,
                          ),
                          onPressed: () {
                            setState(() {
                              if (settings.provider == SttProvider.groq) {
                                _showGroqKey = !_showGroqKey;
                              } else {
                                _showOpenaiKey = !_showOpenaiKey;
                              }
                            });
                          },
                        ),
                      ),
                      onChanged: (value) {
                        // Auto-save when typing stops
                      },
                    ),
                    SizedBox(height: Spacing.md),
                    // Action buttons
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _testingKey
                                ? null
                                : () => _testApiKey(settings.provider),
                            icon: _testingKey
                                ? SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: ocTheme.primary,
                                    ),
                                  )
                                : Icon(AppIcons.check, size: 18),
                            label: Text(
                              _testingKey ? 'Testing...' : 'Test Key',
                            ),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: ocTheme.primary,
                              side: BorderSide(color: ocTheme.primary),
                              padding: Insets.cardV,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        OutlinedButton.icon(
                          onPressed: () {
                            if (settings.provider == SttProvider.groq) {
                              _groqKeyController.clear();
                              notifier.clearApiKey(SttProvider.groq);
                            } else {
                              _openaiKeyController.clear();
                              notifier.clearApiKey(SttProvider.openai);
                            }
                          },
                          icon: Icon(AppIcons.delete, size: 18),
                          label: const Text('Clear'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: ocTheme.error,
                            side: BorderSide(color: ocTheme.error),
                            padding: const EdgeInsets.symmetric(
                              vertical: 12,
                              horizontal: 16,
                            ),
                          ),
                        ),
                      ],
                    ),
                    // Test result message
                    if (_testResult != null) ...[
                      SizedBox(height: Spacing.md),
                      Container(
                        padding: Insets.cardXs,
                        decoration: BoxDecoration(
                          color: _testResult!.contains('valid')
                              ? ocTheme.success.withValues(alpha: 0.1)
                              : ocTheme.error.withValues(alpha: 0.1),
                          borderRadius: Radii.brSm,
                        ),
                        child: Row(
                          children: [
                            Icon(
                              _testResult!.contains('valid')
                                  ? AppIcons.checkCircle
                                  : AppIcons.error,
                              color: _testResult!.contains('valid')
                                  ? ocTheme.success
                                  : ocTheme.error,
                              size: 18,
                            ),
                            SizedBox(width: Spacing.sm),
                            Expanded(
                              child: Text(
                                _testResult!,
                                style: TextStyle(
                                  color: _testResult!.contains('valid')
                                      ? ocTheme.success
                                      : ocTheme.error,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    SizedBox(height: Spacing.md),
                    // Get key link
                    InkWell(
                      onTap: () => _openProviderDocs(settings.provider),
                      borderRadius: Radii.brSm,
                      child: Padding(
                        padding: Insets.chipV,
                        child: Row(
                          children: [
                            Icon(
                              AppIcons.openExternal,
                              color: ocTheme.primary,
                              size: 16,
                            ),
                            SizedBox(width: Spacing.sm),
                            Text(
                              settings.provider == SttProvider.groq
                                  ? 'Get your Groq API key'
                                  : 'Get your OpenAI API key',
                              style: TextStyle(
                                color: ocTheme.primary,
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: Spacing.md),
          // Configuration status
          _Section(
            title: 'Status',
            children: [
              ListTile(
                leading: Icon(
                  settings.isConfigured ? AppIcons.checkCircle : AppIcons.warning,
                  color: settings.isConfigured
                      ? ocTheme.success
                      : ocTheme.warning,
                ),
                title: Text(
                  settings.isConfigured ? 'Ready to use' : 'Not configured',
                  style: TextStyle(color: ocTheme.text),
                ),
                subtitle: Text(
                  settings.isConfigured
                      ? '${settings.provider.displayName} - ${settings.model.displayName}'
                      : 'Add your ${settings.provider.displayName} API key above',
                  style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
                ),
              ),
            ],
          ),
          SizedBox(height: Spacing.md),
          // Cost comparison
          _Section(
            title: 'Cost Comparison',
            children: [
              Padding(
                padding: Insets.card,
                child: Column(
                  children: [
                    _CostRow(
                      provider: 'Groq',
                      cost: '\$0.04/hour',
                      speed: '216x realtime',
                      isHighlighted: settings.provider == SttProvider.groq,
                    ),
                    SizedBox(height: Spacing.sm),
                    _CostRow(
                      provider: 'OpenAI',
                      cost: '\$0.36/hour',
                      speed: '5-10x realtime',
                      isHighlighted: settings.provider == SttProvider.openai,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      ),
    );
  }
}
class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});
  final String title;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Text(
              title,
              style: TextStyle(
                color: ocTheme.text,
                fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          ...children,
        ],
      ),
    );
  }
}
class _ProviderTile extends StatelessWidget {
  const _ProviderTile({
    required this.provider,
    required this.isSelected,
    required this.subtitle,
    required this.onTap,
    this.badge,
  });
  final SttProvider provider;
  final bool isSelected;
  final String subtitle;
  final String? badge;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: Insets.section,
        child: Row(
          children: [
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: isSelected ? ocTheme.primary : ocTheme.textMuted,
                  width: 2,
                ),
              ),
              child: isSelected
                  ? Center(
                      child: Container(
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: ocTheme.primary,
                        ),
                      ),
                    )
                  : null,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        provider.displayName,
                        style: TextStyle(
                          color: ocTheme.text,
                          fontSize: 15,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      if (badge != null) ...[
                        SizedBox(width: Spacing.sm),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: ocTheme.success.withValues(alpha: 0.15),
                            borderRadius: Radii.brSm,
                          ),
                          child: Text(
                            badge!,
                            style: TextStyle(
                              color: ocTheme.success,
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  SizedBox(height: Spacing.xxs),
                  Text(
                    subtitle,
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
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
class _ModelTile extends StatelessWidget {
  const _ModelTile({
    required this.model,
    required this.isSelected,
    required this.onTap,
  });
  final SttModel model;
  final bool isSelected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: Insets.buttonSm,
        child: Row(
          children: [
            Icon(
              isSelected ? AppIcons.radioChecked : AppIcons.radioUnchecked,
              color: isSelected ? ocTheme.primary : ocTheme.textMuted,
              size: 20,
            ),
            SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        model.displayName,
                        style: TextStyle(
                          color: ocTheme.text,
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      if (model.isDefault) ...[
                        SizedBox(width: Spacing.sm),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: ocTheme.primary.withValues(alpha: 0.15),
                            borderRadius: Radii.brXs,
                          ),
                          child: Text(
                            'Default',
                            style: TextStyle(
                              color: ocTheme.primary,
                              fontSize: 9,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (model.description != null) ...[
                    SizedBox(height: Spacing.xxs),
                    Text(
                      model.description!,
                      style: TextStyle(color: ocTheme.textMuted, fontSize: 11),
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
class _CostRow extends StatelessWidget {
  const _CostRow({
    required this.provider,
    required this.cost,
    required this.speed,
    required this.isHighlighted,
  });
  final String provider;
  final String cost;
  final String speed;
  final bool isHighlighted;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: isHighlighted
            ? ocTheme.primary.withValues(alpha: 0.1)
            : Colors.transparent,
        borderRadius: Radii.brSm,
        border: isHighlighted
            ? Border.all(color: ocTheme.primary.withValues(alpha: 0.3))
            : null,
      ),
      child: Row(
        children: [
          SizedBox(
            width: 60,
            child: Text(
              provider,
              style: TextStyle(
                color: ocTheme.text,
                fontSize: 13,
                fontWeight: isHighlighted ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ),
          Expanded(
            child: Text(
              cost,
              style: TextStyle(
                color: ocTheme.success,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Text(speed, style: TextStyle(color: ocTheme.textMuted, fontSize: 12)),
        ],
      ),
    );
  }
}
