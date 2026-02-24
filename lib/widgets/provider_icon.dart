import 'package:flutter/material.dart';

/// Provider icon widget for displaying AI provider brand icons.
///
/// Based on OpenCode SDK v1.1.18 provider-icon component.
/// Displays branded icons for major AI providers like Anthropic, OpenAI, Google, etc.
class ProviderIcon extends StatelessWidget {
  const ProviderIcon({
    super.key,
    required this.providerId,
    this.size = 20,
    this.color,
  });

  /// The provider ID (e.g., 'anthropic', 'openai', 'google')
  final String providerId;

  /// Icon size (default 20)
  final double size;

  /// Custom color (defaults to provider's brand color)
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final providerInfo = _getProviderInfo(providerId);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: (color ?? providerInfo.color).withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(size / 4),
      ),
      child: Center(
        child: Text(
          providerInfo.icon,
          style: TextStyle(fontSize: size * 0.6, height: 1),
        ),
      ),
    );
  }

  /// Get provider info (icon and brand color)
  static _ProviderInfo _getProviderInfo(String providerId) {
    final id = providerId.toLowerCase();

    // Map of provider IDs to their brand info
    // Using emoji/text icons since we don't have SVG sprites in Flutter
    const providers = <String, _ProviderInfo>{
      // Major providers
      'anthropic': _ProviderInfo('A', Color(0xFFD97757)), // Anthropic orange
      'openai': _ProviderInfo('O', Color(0xFF10A37F)), // OpenAI green
      'google': _ProviderInfo('G', Color(0xFF4285F4)), // Google blue
      'google-vertex': _ProviderInfo('V', Color(0xFF4285F4)),
      'google-vertex-anthropic': _ProviderInfo('V', Color(0xFFD97757)),

      // Cloud providers
      'azure': _ProviderInfo('Az', Color(0xFF0078D4)), // Microsoft blue
      'amazon-bedrock': _ProviderInfo('B', Color(0xFFFF9900)), // AWS orange
      'aws': _ProviderInfo('B', Color(0xFFFF9900)),

      // Other AI providers
      'mistral': _ProviderInfo('M', Color(0xFFF7A900)), // Mistral orange
      'cohere': _ProviderInfo('C', Color(0xFF39594D)), // Cohere green
      'deepseek': _ProviderInfo('D', Color(0xFF4B79E4)), // DeepSeek blue
      'groq': _ProviderInfo('G', Color(0xFFF55036)), // Groq red
      'perplexity': _ProviderInfo('P', Color(0xFF20808D)), // Perplexity teal
      'xai': _ProviderInfo('X', Color(0xFF000000)), // xAI black
      // API providers
      'openrouter': _ProviderInfo('R', Color(0xFF6366F1)), // OpenRouter purple
      'togetherai': _ProviderInfo('T', Color(0xFF0EA5E9)), // Together blue
      'fireworks-ai': _ProviderInfo('F', Color(0xFFFF6B35)), // Fireworks orange
      'huggingface': _ProviderInfo(
        'H',
        Color(0xFFFFD21E),
      ), // HuggingFace yellow
      'replicate': _ProviderInfo('R', Color(0xFF000000)),

      // Local/Self-hosted
      'ollama': _ProviderInfo('O', Color(0xFF000000)),
      'ollama-cloud': _ProviderInfo('O', Color(0xFF000000)),
      'lmstudio': _ProviderInfo('L', Color(0xFF2563EB)),

      // Other providers from SDK
      'nvidia': _ProviderInfo('N', Color(0xFF76B900)), // NVIDIA green
      'cerebras': _ProviderInfo('C', Color(0xFFFF6B00)),
      'deepinfra': _ProviderInfo('D', Color(0xFF6366F1)),
      'cloudflare-workers-ai': _ProviderInfo('CF', Color(0xFFF38020)),
      'cloudflare-ai-gateway': _ProviderInfo('CF', Color(0xFFF38020)),
      'github-models': _ProviderInfo('GH', Color(0xFF24292F)),
      'github-copilot': _ProviderInfo('GH', Color(0xFF24292F)),

      // Chinese providers
      'alibaba': _ProviderInfo('Ali', Color(0xFFFF6A00)),
      'alibaba-cn': _ProviderInfo('Ali', Color(0xFFFF6A00)),
      'zhipuai': _ProviderInfo('Z', Color(0xFF2563EB)),
      'moonshotai': _ProviderInfo('M', Color(0xFF6366F1)),
      'minimax': _ProviderInfo('MM', Color(0xFF3B82F6)),

      // Specialty providers
      'gitlab': _ProviderInfo('GL', Color(0xFFFC6D26)), // GitLab orange
      'gitlab-duo': _ProviderInfo('GL', Color(0xFFFC6D26)), // GitLab Duo
      // Agent providers
      'pi': _ProviderInfo('π', Color(0xFF7C3AED)),
    };

    return providers[id] ??
        _ProviderInfo(id[0].toUpperCase(), const Color(0xFF6B7280));
  }
}

class _ProviderInfo {
  const _ProviderInfo(this.icon, this.color);
  final String icon;
  final Color color;
}

/// Extension to get provider icon widget from provider ID
extension ProviderIconExtension on String {
  Widget toProviderIcon({double size = 20, Color? color}) {
    return ProviderIcon(providerId: this, size: size, color: color);
  }
}
