import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/connection_quality.dart';
import '../models/project.dart';
import '../providers/connection_provider.dart';
import '../providers/onboarding_provider.dart';
import '../providers/service_providers.dart';
import '../theme/design_tokens.dart';
import '../utils/responsive.dart';
import 'package:broski/theme/app_icons.dart';

/// "System Linked" screen shown after successful QR scan connection.
/// Displays connection stats and detected projects/sessions/agents.
class SystemLinkedScreen extends ConsumerStatefulWidget {
  const SystemLinkedScreen({super.key});
  @override
  ConsumerState<SystemLinkedScreen> createState() => _SystemLinkedScreenState();
}

class _SystemLinkedScreenState extends ConsumerState<SystemLinkedScreen>
    with TickerProviderStateMixin {
  late AnimationController _entryController;
  late AnimationController _checkController;
  late AnimationController _pulseController;
  // Detected counts
  int _projectCount = 0;
  int _sessionCount = 0;
  int _agentCount = 0;
  bool _loaded = false;
  @override
  void initState() {
    super.initState();
    _entryController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..forward();
    _checkController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    // Subtle pulse on the check circle
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    )..repeat(reverse: true);
    // Delay check animation for dramatic effect
    Future.delayed(const Duration(milliseconds: 300), () {
      if (mounted) _checkController.forward();
    });
    _loadStats();
  }

  Future<void> _loadStats() async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      // Load projects from all backends
      var ocProjects = <ProjectSummary>[];
      var ccProjects = <ProjectSummary>[];
      var cxProjects = <ProjectSummary>[];
      try {
        ocProjects = await bridge.listProjects();
      } catch (_) {}
      try {
        ccProjects = await bridge.ccListProjects();
      } catch (_) {}
      try {
        cxProjects = await bridge.cxListProjects();
      } catch (_) {}
      // Deduplicate projects by path
      final allProjectPaths = <String>{};
      for (final p in ocProjects) {
        allProjectPaths.add(p.path);
      }
      for (final p in ccProjects) {
        allProjectPaths.add(p.path);
      }
      for (final p in cxProjects) {
        allProjectPaths.add(p.path);
      }
      // Load sessions from all backends
      int totalSessions = 0;
      for (final p in ocProjects) {
        try {
          final sessions = await bridge.listSessions(projectPath: p.path);
          totalSessions += sessions.length;
        } catch (_) {}
      }
      for (final p in ccProjects) {
        try {
          final sessions = await bridge.ccListSessions(cwd: p.path);
          totalSessions += sessions.length;
        } catch (_) {}
      }
      for (final p in cxProjects) {
        try {
          final threads = await bridge.cxListThreads(cwd: p.path);
          totalSessions += threads.length;
        } catch (_) {}
      }
      // Load agents (OpenCode only)
      int agentCount = 0;
      for (final p in ocProjects) {
        try {
          final agents = await bridge.listAgents(projectPath: p.path);
          agentCount += agents.length;
          break; // Only need one project's agents
        } catch (_) {}
      }
      if (mounted) {
        setState(() {
          _projectCount = allProjectPaths.length;
          _sessionCount = totalSessions;
          _agentCount = agentCount;
          _loaded = true;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _loaded = true);
      }
    }
  }

  @override
  void dispose() {
    _entryController.dispose();
    _checkController.dispose();
    _pulseController.dispose();
    super.dispose();
  }

  void _enterWorkspace() {
    HapticFeedback.mediumImpact();
    ref.read(onboardingProvider.notifier).completeOnboarding();
  }

  @override
  Widget build(BuildContext context) {
    final connectionState = ref.watch(connectionProvider);
    final entryAnim = CurvedAnimation(
      parent: _entryController,
      curve: Curves.easeOutCubic,
    );
    final checkAnim = CurvedAnimation(
      parent: _checkController,
      curve: Curves.elasticOut,
    );
    final ipAddress =
        connectionState.connectedHost ??
        connectionState.connection?.localIP ??
        '—';
    final latency = connectionState.rttMs;
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: Responsive.onboardingHPadding(context, 32),
          ),
          child: Column(
            children: [
              const Spacer(flex: 2),
              // Green check circle
              FadeTransition(
                opacity: entryAnim,
                child: AnimatedBuilder(
                  animation: _pulseController,
                  builder: (context, child) {
                    final scale = 1.0 + 0.03 * _pulseController.value;
                    return Transform.scale(scale: scale, child: child);
                  },
                  child: ScaleTransition(
                    scale: checkAnim,
                    child: Container(
                      width: 96,
                      height: 96,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: const Color(0xFF2ECB71).withValues(alpha: 0.12),
                        border: Border.all(
                          color: const Color(
                            0xFF2ECB71,
                          ).withValues(alpha: 0.25),
                          width: 2,
                        ),
                      ),
                      child: const Center(
                        child: Icon(
                          AppIcons.check,
                          color: Color(0xFF2ECB71),
                          size: 44,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              SizedBox(height: Spacing.xxxl),
              // Title
              FadeTransition(
                opacity: entryAnim,
                child: const Text(
                  'System Linked',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.5,
                  ),
                ),
              ),
              const SizedBox(height: 10),
              // Subtitle
              FadeTransition(
                opacity: entryAnim,
                child: RichText(
                  textAlign: TextAlign.center,
                  text: TextSpan(
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.45),
                      fontSize: 15,
                      height: 1.4,
                    ),
                    children: [
                      const TextSpan(
                        text: 'Secure connection established with\n',
                      ),
                      TextSpan(
                        text: _getDeviceName(connectionState),
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.85),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 40),
              // Stats card
              FadeTransition(
                opacity: entryAnim,
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    vertical: 20,
                    horizontal: 24,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.04),
                    borderRadius: Radii.brLg,
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.08),
                    ),
                  ),
                  child: Column(
                    children: [
                      _StatRow(
                        label: 'STATUS',
                        value: 'CONNECTED',
                        valueColor: const Color(0xFF2ECB71),
                      ),
                      _divider(),
                      _StatRow(
                        label: 'LATENCY',
                        value: latency != null ? '${latency}ms' : '—',
                      ),
                      _divider(),
                      _StatRow(label: 'IP ADDRESS', value: ipAddress),
                      if (_loaded && _projectCount > 0) ...[
                        _divider(),
                        _StatRow(
                          label: 'PROJECTS',
                          value: '$_projectCount  Detected',
                        ),
                      ],
                      if (_loaded && _sessionCount > 0) ...[
                        _divider(),
                        _StatRow(
                          label: 'SESSIONS',
                          value: '$_sessionCount  Detected',
                        ),
                      ],
                      if (_loaded && _agentCount > 0) ...[
                        _divider(),
                        _StatRow(
                          label: 'SUBAGENTS',
                          value: '$_agentCount  Detected',
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const Spacer(flex: 3),
              // Enter Workspace button
              FadeTransition(
                opacity: entryAnim,
                child: GestureDetector(
                  onTap: _enterWorkspace,
                  child: Container(
                    width: double.infinity,
                    height: 58,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: Radii.brFull,
                    ),
                    child: const Center(
                      child: Text(
                        'Enter Workspace',
                        style: TextStyle(
                          color: Colors.black,
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.2,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              SizedBox(height: Spacing.xxxl),
            ],
          ),
        ),
      ),
    );
  }

  String _getDeviceName(BridgeConnectionState state) {
    if (state.connectionType == ConnectionType.tailscale ||
        state.connectionType == ConnectionType.magicDNS) {
      return 'Remote Mac (Tailscale)';
    }
    return 'MacBook Pro';
  }

  Widget _divider() {
    return Padding(
      padding: Insets.cardV,
      child: Container(height: 1, color: Colors.white.withValues(alpha: 0.06)),
    );
  }
}

class _StatRow extends StatelessWidget {
  const _StatRow({required this.label, required this.value, this.valueColor});
  final String label;
  final String value;
  final Color? valueColor;
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.4),
            fontSize: 13,
            fontWeight: FontWeight.w500,
            letterSpacing: 1.2,
          ),
        ),
        Text(
          value,
          style: TextStyle(
            color: valueColor ?? Colors.white,
            fontSize: 14,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
