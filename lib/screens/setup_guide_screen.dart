import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/onboarding_provider.dart';
import '../theme/opencode_theme.dart';

class SetupGuideScreen extends ConsumerWidget {
  const SetupGuideScreen({super.key});

  static const _installCommand = 'curl -fsSL broskiapp.dev/install | bash';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: ocTheme.text),
          onPressed: () => ref.read(onboardingProvider.notifier).goBack(),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Set up your Mac',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: ocTheme.text,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Run this command in Terminal on your Mac:',
                style: TextStyle(color: ocTheme.textMuted, fontSize: 16),
              ),
              const SizedBox(height: 32),
              _buildStep(context, ocTheme, '1', 'Open Terminal', [
                'Press ',
                _buildKeyboardKey(context, ocTheme, 'Cmd'),
                ' + ',
                _buildKeyboardKey(context, ocTheme, 'Space'),
                ', type "Terminal"',
              ]),
              const SizedBox(height: 24),
              _buildStep(
                context,
                ocTheme,
                '2',
                'Paste this command',
                [],
                commandWidget: _buildCommandBox(context, ocTheme),
              ),
              const SizedBox(height: 24),
              _buildStep(
                context,
                ocTheme,
                '3',
                'Follow the prompts',
                [],
                subtitle:
                    'The installer will set up Bun, OpenCode, and optionally Tailscale.',
              ),
              const SizedBox(height: 24),
              _buildStep(
                context,
                ocTheme,
                '4',
                'Come back here',
                [],
                subtitle:
                    'When you see the QR code on your Mac, tap "I\'m Ready" below.',
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton(
                  onPressed: () {
                    ref.read(onboardingProvider.notifier).setHasMacSetup(true);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: ocTheme.primary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: const Text(
                    "I'm Ready - Show Scanner",
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Center(
                child: TextButton.icon(
                  onPressed: () => _showManualSetup(context, ocTheme),
                  icon: Icon(
                    Icons.help_outline,
                    size: 18,
                    color: ocTheme.textMuted,
                  ),
                  label: Text(
                    'Having trouble?',
                    style: TextStyle(color: ocTheme.textMuted),
                  ),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildKeyboardKey(
    BuildContext context,
    OpenCodeTheme ocTheme,
    String key,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: ocTheme.backgroundElement,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: ocTheme.border),
      ),
      child: Text(
        key,
        style: TextStyle(
          color: ocTheme.text,
          fontWeight: FontWeight.w500,
          fontSize: 12,
        ),
      ),
    );
  }

  Widget _buildStep(
    BuildContext context,
    OpenCodeTheme ocTheme,
    String number,
    String title,
    List<dynamic> content, {
    Widget? commandWidget,
    String? subtitle,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: ocTheme.primary.withValues(alpha: 0.1),
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              number,
              style: TextStyle(
                color: ocTheme.primary,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: ocTheme.text,
                  fontWeight: FontWeight.w600,
                  fontSize: 16,
                ),
              ),
              if (content.isNotEmpty) ...[
                const SizedBox(height: 4),
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: content.map((item) {
                    if (item is String) {
                      return Text(
                        item,
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 14,
                        ),
                      );
                    }
                    return item as Widget;
                  }).toList(),
                ),
              ],
              if (subtitle != null) ...[
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
                ),
              ],
              if (commandWidget != null) ...[
                const SizedBox(height: 12),
                commandWidget,
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildCommandBox(BuildContext context, OpenCodeTheme ocTheme) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ocTheme.backgroundElement,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: ocTheme.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              _installCommand,
              style: TextStyle(
                color: ocTheme.text,
                fontFamily: 'monospace',
                fontSize: 13,
              ),
            ),
          ),
          IconButton(
            icon: Icon(Icons.copy, color: ocTheme.primary, size: 20),
            onPressed: () {
              Clipboard.setData(const ClipboardData(text: _installCommand));
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: const Text('Copied to clipboard!'),
                  backgroundColor: ocTheme.success,
                  duration: const Duration(seconds: 2),
                ),
              );
            },
            tooltip: 'Copy',
          ),
        ],
      ),
    );
  }

  void _showManualSetup(BuildContext context, OpenCodeTheme ocTheme) {
    showModalBottomSheet(
      context: context,
      backgroundColor: ocTheme.backgroundPanel,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Manual Setup',
                style: TextStyle(
                  color: ocTheme.text,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'If the one-liner doesn\'t work, you can install manually:',
                style: TextStyle(color: ocTheme.textMuted),
              ),
              const SizedBox(height: 16),
              _buildManualStep(
                ocTheme,
                '1. Install Bun',
                'curl -fsSL https://bun.sh/install | bash',
              ),
              _buildManualStep(
                ocTheme,
                '2. Install OpenCode',
                'bun install -g opencode',
              ),
              _buildManualStep(
                ocTheme,
                '3. Clone Broski (if not using npm)',
                'git clone https://github.com/your-org/broski && cd broski/packages/bridge && bun install && bun link',
              ),
              _buildManualStep(ocTheme, '4. Start Bridge', 'broski-bridge'),
              const SizedBox(height: 24),
            ],
          ),
        );
      },
    );
  }

  Widget _buildManualStep(OpenCodeTheme ocTheme, String title, String command) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(color: ocTheme.text, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: ocTheme.backgroundElement,
              borderRadius: BorderRadius.circular(4),
            ),
            child: SelectableText(
              command,
              style: TextStyle(
                color: ocTheme.textMuted,
                fontFamily: 'monospace',
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
