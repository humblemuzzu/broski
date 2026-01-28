import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/app_user.dart';
import '../services/auth_service.dart';
import '../services/convex_service.dart';
import 'service_providers.dart';

class AppAuthState {
  const AppAuthState({
    this.user,
    this.isLoading = true,
    this.error,
  });

  final AppUser? user;
  final bool isLoading;
  final String? error;

  bool get isSignedIn => user != null;

  AppAuthState copyWith({
    AppUser? user,
    bool? isLoading,
    String? error,
    bool clearError = false,
  }) {
    return AppAuthState(
      user: user ?? this.user,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : error,
    );
  }
}

class AppAuthNotifier extends StateNotifier<AppAuthState> {
  AppAuthNotifier(this._ref)
      : super(const AppAuthState(isLoading: true)) {
    _bootstrap();
  }

  final Ref _ref;

  AuthService get _auth => _ref.read(authServiceProvider);
  ConvexService get _convex => _ref.read(convexServiceProvider);

  Future<void> _bootstrap() async {
    try {
      final token = await _auth.getCachedSessionToken();
      if (token == null) {
        state = const AppAuthState(isLoading: false);
        return;
      }

      final me = await _convex.getMe(sessionToken: token);
      state = AppAuthState(user: me, isLoading: false);
    } catch (e) {
      await _auth.clearCachedSession();
      state = AppAuthState(isLoading: false, error: e.toString());
    }
  }

  Future<void> signInWithGoogle() async {
    if (state.isLoading) return;
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final session = await _auth.signInWithGoogle();
      state = AppAuthState(user: session.user, isLoading: false);
    } catch (e) {
      state = AppAuthState(isLoading: false, error: e.toString());
    }
  }

  Future<void> signInWithApple() async {
    if (state.isLoading) return;
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final session = await _auth.signInWithApple();
      state = AppAuthState(user: session.user, isLoading: false);
    } catch (e) {
      state = AppAuthState(isLoading: false, error: e.toString());
    }
  }

  Future<void> signOut() async {
    state = state.copyWith(isLoading: true, clearError: true);
    await _auth.signOut();
    state = const AppAuthState(isLoading: false);
  }
}

final appAuthProvider =
    StateNotifierProvider<AppAuthNotifier, AppAuthState>((ref) {
  return AppAuthNotifier(ref);
});

