import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/onboarding_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/chat/detail_sheet.dart';
import '../widgets/onboarding_widgets.dart';

class SetupGuideScreen extends ConsumerStatefulWidget {
  const SetupGuideScreen({super.key});

  @override
  ConsumerState<SetupGuideScreen> createState() => _SetupGuideScreenState();
}

class _SetupGuideScreenState extends ConsumerState<SetupGuideScreen> {
  static const _installCommand = 'curl -fsSL broskiapp.com/install | bash';
  bool _copied = false;

  void _copyCommand() {
    Clipboard.setData(const ClipboardData(text: _installCommand));
    setState(() => _copied = true);
    HapticFeedback.lightImpact();

    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return OnboardingScaffold(
      currentStep: 0,
      totalSteps: 3,
      onBack: () => ref.read(onboardingProvider.notifier).goBack(),
      bottomContent: Column(
        children: [
          OnboardingButton(
            label: "I'm Ready",
            onPressed: () {
              ref.read(onboardingProvider.notifier).setHasMacSetup(true);
            },
          ),
          const SizedBox(height: 12),
          OnboardingButton(
            label: 'Need Help?',
            variant: OnboardingButtonVariant.ghost,
            onPressed: () => _showManualSetup(context, theme),
          ),
        ],
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 8),
            Text(
              'Set up your Mac',
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.bold,
                color: theme.text,
                letterSpacing: -0.5,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'One command to install everything you need.',
              style: TextStyle(color: theme.textMuted, fontSize: 16),
            ),
            const SizedBox(height: 32),
            OnboardingStepItem(
              stepNumber: 1,
              title: 'Open Terminal on your Mac',
              subtitle: 'Press Cmd + Space, type "Terminal", hit Enter',
            ),
            const SizedBox(height: 24),
            OnboardingStepItem(
              stepNumber: 2,
              title: 'Run this command',
              content: _buildCommandBox(theme),
            ),
            const SizedBox(height: 24),
            OnboardingStepItem(
              stepNumber: 3,
              title: 'Scan the QR code',
              subtitle:
                  'When setup completes, a QR code will appear. Come back here and tap "I\'m Ready".',
            ),
            const SizedBox(height: 32),
            OnboardingInfoCard(
              icon: Icons.bolt_rounded,
              title: 'What gets installed?',
              content:
                  'Bun (JS runtime), OpenCode CLI, and the Broski bridge server. Takes about 2 minutes.',
              color: theme.warning,
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildCommandBox(OpenCodeTheme theme) {
    return GestureDetector(
      onTap: _copyCommand,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: _copied
              ? theme.success.withValues(alpha: 0.1)
              : theme.backgroundElement,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: _copied ? theme.success : theme.border),
        ),
        child: Row(
          children: [
            Icon(
              Icons.terminal_rounded,
              color: _copied ? theme.success : theme.textMuted,
              size: 18,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                _installCommand,
                style: TextStyle(
                  color: theme.text,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  letterSpacing: -0.3,
                ),
              ),
            ),
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: _copied
                    ? theme.success.withValues(alpha: 0.15)
                    : theme.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    _copied ? Icons.check_rounded : Icons.copy_rounded,
                    color: _copied ? theme.success : theme.primary,
                    size: 16,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    _copied ? 'Copied' : 'Copy',
                    style: TextStyle(
                      color: _copied ? theme.success : theme.primary,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
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

  void _showManualSetup(BuildContext context, OpenCodeTheme theme) {
    DetailSheet.show(
      context: context,
      title: 'Manual Setup',
      initialSize: 0.6,
      maxSize: 0.9,
      minSize: 0.4,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'If the one-liner doesn\'t work, install manually:',
              style: TextStyle(color: theme.textMuted),
            ),
            const SizedBox(height: 24),
            _buildManualStep(
              theme,
              '1',
              'Install Bun',
              'curl -fsSL https://bun.sh/install | bash',
            ),
            const SizedBox(height: 16),
            _buildManualStep(
              theme,
              '2',
              'Install OpenCode',
              'bun install -g opencode',
            ),
            const SizedBox(height: 16),
            _buildManualStep(
              theme,
              '3',
              'Install Broski',
              'bun install -g broski',
            ),
            const SizedBox(height: 16),
            _buildManualStep(theme, '4', 'Start the Bridge', 'broski'),
            const SizedBox(height: 32),
            OnboardingInfoCard(
              icon: Icons.warning_amber_rounded,
              title: 'Troubleshooting',
              content:
                  'Make sure your Mac allows terminal apps in Privacy & Security settings. Restart Terminal after installing Bun.',
              color: theme.warning,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildManualStep(
    OpenCodeTheme theme,
    String number,
    String title,
    String command,
  ) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 24,
                height: 24,
                decoration: BoxDecoration(
                  color: theme.primary.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(
                    number,
                    style: TextStyle(
                      color: theme.primary,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Text(
                title,
                style: TextStyle(
                  color: theme.text,
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: theme.background,
              borderRadius: BorderRadius.circular(8),
            ),
            child: SelectableText(
              command,
              style: TextStyle(
                color: theme.textMuted,
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
