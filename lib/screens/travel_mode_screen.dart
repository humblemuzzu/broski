import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/onboarding_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/onboarding_widgets.dart';

class TravelModeScreen extends ConsumerStatefulWidget {
  const TravelModeScreen({super.key});

  @override
  ConsumerState<TravelModeScreen> createState() => _TravelModeScreenState();
}

class _TravelModeScreenState extends ConsumerState<TravelModeScreen> {
  bool _wantsTravel = false;
  bool _copied = false;

  String get _installCommand =>
      _wantsTravel ? 'broski install --travel' : 'broski install';

  void _copyCommand() {
    Clipboard.setData(ClipboardData(text: _installCommand));
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
      currentStep: 1,
      totalSteps: 3,
      onBack: () => ref.read(onboardingProvider.notifier).goBack(),
      bottomContent: Column(
        children: [
          OnboardingButton(
            label: 'Continue',
            onPressed: () {
              ref.read(onboardingProvider.notifier).setTravelMode(_wantsTravel);
            },
          ),
          const SizedBox(height: 12),
          OnboardingButton(
            label: 'Skip for Now',
            variant: OnboardingButtonVariant.ghost,
            onPressed: () {
              ref.read(onboardingProvider.notifier).setTravelMode(false);
            },
          ),
        ],
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 8),
            Text(
              'Background Service',
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.bold,
                color: theme.text,
                letterSpacing: -0.5,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Keep Broski running even when you close your Mac.',
              style: TextStyle(color: theme.textMuted, fontSize: 16),
            ),
            const SizedBox(height: 32),

            // Travel Mode Toggle
            GestureDetector(
              onTap: () {
                HapticFeedback.lightImpact();
                setState(() => _wantsTravel = !_wantsTravel);
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: _wantsTravel
                      ? theme.primary.withValues(alpha: 0.1)
                      : theme.backgroundElement,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: _wantsTravel ? theme.primary : theme.border,
                    width: _wantsTravel ? 2 : 1,
                  ),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: _wantsTravel
                            ? theme.primary.withValues(alpha: 0.15)
                            : theme.backgroundPanel,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(
                        Icons.airplanemode_active_rounded,
                        color: _wantsTravel ? theme.primary : theme.textMuted,
                        size: 24,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Travel Mode',
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 17,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Keep Mac awake with lid closed',
                            style: TextStyle(
                              color: theme.textMuted,
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                    ),
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: _wantsTravel
                            ? theme.primary
                            : theme.backgroundPanel,
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: _wantsTravel ? theme.primary : theme.border,
                          width: 2,
                        ),
                      ),
                      child: _wantsTravel
                          ? Icon(
                              Icons.check_rounded,
                              color: theme.background,
                              size: 18,
                            )
                          : null,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Info cards
            if (_wantsTravel) ...[
              OnboardingInfoCard(
                icon: Icons.battery_charging_full_rounded,
                title: 'Uses More Battery',
                content:
                    'Your Mac will stay awake even with the lid closed. Great for working on the go, but uses more power.',
                color: theme.warning,
              ),
              const SizedBox(height: 16),
            ],
            OnboardingInfoCard(
              icon: Icons.auto_awesome_rounded,
              title: _wantsTravel ? 'Perfect For' : 'Without Travel Mode',
              content: _wantsTravel
                  ? 'Trains, planes, coffee shops - anywhere you want to code with your Mac in your bag and phone in hand.'
                  : 'Your Mac will sleep when you close the lid. Broski will reconnect automatically when you open it again.',
              color: _wantsTravel ? theme.success : theme.textMuted,
            ),
            const SizedBox(height: 32),

            // Command box
            Text(
              'Run this on your Mac:',
              style: TextStyle(
                color: theme.text,
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 12),
            GestureDetector(
              onTap: _copyCommand,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: _copied
                      ? theme.success.withValues(alpha: 0.1)
                      : theme.backgroundElement,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: _copied ? theme.success : theme.border,
                  ),
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
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
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
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}
