import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum OnboardingStep {
  welcome,
  auth,
  paywall,
  connectSetup,
  macSetup,
  networkCheck,
  tailscaleCheck,
  scanner,
  complete,
}

class OnboardingState {
  const OnboardingState({
    this.hasCompletedOnboarding = false,
    this.currentStep = OnboardingStep.welcome,
    this.isLoading = true,
    this.hasMacSetup = false,
    this.connectionMode = ConnectionMode.unknown,
  });

  final bool hasCompletedOnboarding;
  final OnboardingStep currentStep;
  final bool isLoading;
  final bool hasMacSetup;
  final ConnectionMode connectionMode;

  OnboardingState copyWith({
    bool? hasCompletedOnboarding,
    OnboardingStep? currentStep,
    bool? isLoading,
    bool? hasMacSetup,
    ConnectionMode? connectionMode,
  }) {
    return OnboardingState(
      hasCompletedOnboarding:
          hasCompletedOnboarding ?? this.hasCompletedOnboarding,
      currentStep: currentStep ?? this.currentStep,
      isLoading: isLoading ?? this.isLoading,
      hasMacSetup: hasMacSetup ?? this.hasMacSetup,
      connectionMode: connectionMode ?? this.connectionMode,
    );
  }
}

enum ConnectionMode { unknown, sameWifi, remote }

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

  /// Called when the intro PageView finishes → advance to auth.
  void finishIntro() {
    state = state.copyWith(currentStep: OnboardingStep.auth);
  }

  /// Called after successful sign-in → advance to paywall.
  void finishAuth() {
    state = state.copyWith(currentStep: OnboardingStep.paywall);
  }

  /// Called after subscription confirmed → advance to connect setup.
  void finishPaywall() {
    state = state.copyWith(currentStep: OnboardingStep.connectSetup);
  }

  void setHasMacSetup(bool value) {
    state = state.copyWith(
      hasMacSetup: value,
      currentStep: value
          ? OnboardingStep.networkCheck
          : OnboardingStep.macSetup,
    );
  }

  void setConnectionMode(ConnectionMode mode) {
    state = state.copyWith(
      connectionMode: mode,
      currentStep: mode == ConnectionMode.remote
          ? OnboardingStep.tailscaleCheck
          : OnboardingStep.scanner,
    );
  }

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
        // Can't meaningfully go back from paywall (already signed in)
        break;
      case OnboardingStep.connectSetup:
        // Can't go back past paywall
        break;
      case OnboardingStep.macSetup:
        state = state.copyWith(currentStep: OnboardingStep.connectSetup);
        break;
      case OnboardingStep.networkCheck:
        state = state.copyWith(currentStep: OnboardingStep.connectSetup);
        break;
      case OnboardingStep.tailscaleCheck:
        state = state.copyWith(currentStep: OnboardingStep.networkCheck);
        break;
      case OnboardingStep.scanner:
        if (state.connectionMode == ConnectionMode.remote) {
          state = state.copyWith(currentStep: OnboardingStep.tailscaleCheck);
        } else {
          state = state.copyWith(currentStep: OnboardingStep.networkCheck);
        }
        break;
      default:
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
