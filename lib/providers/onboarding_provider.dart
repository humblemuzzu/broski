import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// !! TEMPORARY DEV FLAG — remove before App Store submission !!
/// When true: swipe through all onboarding screens freely, skip auth/paywall.
const kDevBypassOnboarding = false;

enum OnboardingStep { welcome, auth, paywall, bridgeSetup, scanner, complete }

class OnboardingState {
  const OnboardingState({
    this.hasCompletedOnboarding = false,
    this.currentStep = OnboardingStep.welcome,
    this.isLoading = true,
  });

  final bool hasCompletedOnboarding;
  final OnboardingStep currentStep;
  final bool isLoading;

  OnboardingState copyWith({
    bool? hasCompletedOnboarding,
    OnboardingStep? currentStep,
    bool? isLoading,
  }) {
    return OnboardingState(
      hasCompletedOnboarding:
          hasCompletedOnboarding ?? this.hasCompletedOnboarding,
      currentStep: currentStep ?? this.currentStep,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}

class OnboardingNotifier extends StateNotifier<OnboardingState> {
  OnboardingNotifier() : super(const OnboardingState()) {
    _loadOnboardingState();
  }

  static const _onboardingCompleteKey = 'onboarding_complete_v1';

  Future<void> _loadOnboardingState() async {
    final prefs = await SharedPreferences.getInstance();
    final completed = prefs.getBool(_onboardingCompleteKey) ?? false;

    state = state.copyWith(
      hasCompletedOnboarding: completed,
      isLoading: false,
      currentStep: completed ? OnboardingStep.complete : OnboardingStep.welcome,
    );
  }

  void startOnboarding() {
    state = state.copyWith(currentStep: OnboardingStep.welcome);
  }

  /// Called when the intro PageView finishes -> advance to auth.
  void finishIntro() {
    state = state.copyWith(currentStep: OnboardingStep.auth);
  }

  /// Called after successful sign-in -> advance to paywall.
  void finishAuth() {
    state = state.copyWith(currentStep: OnboardingStep.paywall);
  }

  /// Called after subscription confirmed -> advance to bridge setup.
  void finishPaywall() {
    state = state.copyWith(currentStep: OnboardingStep.bridgeSetup);
  }

  /// Called when user is ready to scan QR -> advance to scanner.
  void goToScanner() {
    state = state.copyWith(currentStep: OnboardingStep.scanner);
  }

  void goToStep(OnboardingStep step) {
    state = state.copyWith(currentStep: step);
  }

  void goBack() {
    switch (state.currentStep) {
      case OnboardingStep.auth:
        state = state.copyWith(currentStep: OnboardingStep.welcome);
        break;
      case OnboardingStep.paywall:
        if (kDevBypassOnboarding) {
          state = state.copyWith(currentStep: OnboardingStep.auth);
        }
        // Can't meaningfully go back from paywall (already signed in)
        break;
      case OnboardingStep.bridgeSetup:
        if (kDevBypassOnboarding) {
          state = state.copyWith(currentStep: OnboardingStep.paywall);
        }
        // Can't go back past paywall
        break;
      case OnboardingStep.scanner:
        state = state.copyWith(currentStep: OnboardingStep.bridgeSetup);
        break;
      default:
        break;
    }
  }

  /// DEV ONLY: Advance to next step regardless of completion status.
  void skipForward() {
    if (!kDevBypassOnboarding) return;
    switch (state.currentStep) {
      case OnboardingStep.welcome:
        state = state.copyWith(currentStep: OnboardingStep.auth);
        break;
      case OnboardingStep.auth:
        state = state.copyWith(currentStep: OnboardingStep.paywall);
        break;
      case OnboardingStep.paywall:
        state = state.copyWith(currentStep: OnboardingStep.bridgeSetup);
        break;
      case OnboardingStep.bridgeSetup:
        state = state.copyWith(currentStep: OnboardingStep.scanner);
        break;
      case OnboardingStep.scanner:
      case OnboardingStep.complete:
        completeOnboarding();
        break;
    }
  }

  Future<void> completeOnboarding() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_onboardingCompleteKey, true);
    state = state.copyWith(
      hasCompletedOnboarding: true,
      currentStep: OnboardingStep.complete,
    );
  }

  Future<void> resetOnboarding() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_onboardingCompleteKey);
    state = const OnboardingState(
      hasCompletedOnboarding: false,
      isLoading: false,
      currentStep: OnboardingStep.welcome,
    );
  }
}

final onboardingProvider =
    StateNotifierProvider<OnboardingNotifier, OnboardingState>((ref) {
      return OnboardingNotifier();
    });
