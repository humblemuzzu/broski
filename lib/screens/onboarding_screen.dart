import 'package:broski/providers/onboarding_provider.dart'
    show onboardingProvider, kDevBypassOnboarding;
import 'package:broski/screens/onboarding/step_0_code_from_couch.dart';
import 'package:broski/screens/onboarding/step_1_architecture.dart';
import 'package:broski/screens/onboarding/step_2_unified_intelligence.dart';
import 'package:broski/screens/onboarding/step_3_superpowers.dart';
import 'package:broski/screens/onboarding/step_4_full_terminal.dart';
import 'package:broski/screens/onboarding/step_5_safety_net.dart';
import 'package:broski/screens/onboarding/step_6_zero_telemetry.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Premium onboarding experience for Broski.
/// Inspired by modern mobile app onboarding patterns with developer-focused content.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});
  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  int _currentPage = 0;
  final PageController _pageController = PageController();
  // Total pages: Splash(0), Architecture(1), UnifiedIntelligence(2),
  // Superpowers(3), Terminal(4), SafetyNet(5), ZeroTelemetry(6)
  static const int _totalPages = 7;

  void _goToPage(int page) {
    if (page < 0 || page >= _totalPages) return;
    _pageController.animateToPage(
      page,
      duration: const Duration(milliseconds: 400),
      curve: Curves.easeOutCubic,
    );
  }

  void _nextPage() {
    if (_currentPage < _totalPages - 1) {
      _goToPage(_currentPage + 1);
    }
  }

  void _previousPage() {
    if (_currentPage > 0) {
      _goToPage(_currentPage - 1);
    }
  }

  void _finishIntro() {
    ref.read(onboardingProvider.notifier).finishIntro();
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: PageView(
        controller: _pageController,
        // DEV BYPASS: enable swiping through intro pages
        physics: kDevBypassOnboarding
            ? const ClampingScrollPhysics()
            : const NeverScrollableScrollPhysics(),
        onPageChanged: (page) => setState(() => _currentPage = page),
        children: [
          // Page 0: Code From The Couch
          CodeFromCouchPage(onContinue: _nextPage),
          // Page 1: Architecture Diagram
          ArchitecturePage(
            currentPage: _currentPage,
            totalPages: _totalPages,
            onContinue: _nextPage,
            onBack: _previousPage,
          ),
          // Page 2: Unified Intelligence
          UnifiedIntelligencePage(
            currentPage: _currentPage,
            totalPages: _totalPages,
            onContinue: _nextPage,
          ),
          // Page 3: Superpowers (Instant Alerts + Voice to Code)
          SuperpowersPage(
            currentPage: _currentPage,
            totalPages: _totalPages,
            onContinue: _nextPage,
          ),
          // Page 4: Full Terminal
          FullTerminalPage(
            currentPage: _currentPage,
            totalPages: _totalPages,
            onContinue: _nextPage,
          ),
          // Page 5: Safety Net (Rollback / Undo)
          SafetyNetPage(
            currentPage: _currentPage,
            totalPages: _totalPages,
            onContinue: _nextPage,
          ),
          // Page 6: Zero Telemetry (last page — transitions to auth step)
          ZeroTelemetryPage(
            currentPage: _currentPage,
            totalPages: _totalPages,
            onContinue: _finishIntro,
          ),
        ],
      ),
    );
  }
}
