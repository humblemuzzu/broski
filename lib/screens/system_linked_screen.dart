import 'package:broski/models/project.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/link/link_status_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/onboarding_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/system_linked/connection_stats_card.dart';
import 'package:broski/services/link/link_endpoint.dart';
import 'package:broski/services/onboarding/linked_machine_counts.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski_link/broski_link.dart' show LinkRoute;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
  LinkedMachineCounts _counts = LinkedMachineCounts.empty;
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
    final bridge = ref.read(bridgeServiceProvider);
    final read = await _readBackend(
      name: 'Claude Code',
      projects: () => bridge.ccListProjects(),
      sessions: (path) async => (await bridge.ccListSessions(cwd: path)).length,
    );
    final agents = await _agentCount(bridge);
    if (!mounted) return;
    setState(() {
      _counts = LinkedMachineCounts.combine([
        BackendRead(
          name: read.name,
          projectPaths: read.projectPaths,
          sessions: read.sessions,
          agents: agents,
          failure: read.failure,
        ),
      ]);
      _loaded = true;
    });
  }

  Future<int> _agentCount(BridgeService bridge) async {
    try {
      return (await bridge.ccListAgents()).length;
    } on Object {
      return 0;
    }
  }

  Future<BackendRead> _readBackend({
    required String name,
    required Future<List<ProjectSummary>> Function() projects,
    required Future<int> Function(String path) sessions,
  }) async {
    final List<ProjectSummary> found;
    try {
      found = await projects();
    } on Object catch (error) {
      return BackendRead(name: name, failure: '$error');
    }
    var total = 0;
    for (final project in found) {
      try {
        total += await sessions(project.path);
      } on Object catch (error) {
        return BackendRead(
          name: name,
          projectPaths: [for (final project in found) project.path],
          sessions: total,
          failure: 'sessions: $error',
        );
      }
    }
    return BackendRead(
      name: name,
      projectPaths: [for (final project in found) project.path],
      sessions: total,
    );
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
    final latency = connectionState.rttMs;
    final machines = ref.watch(machinesProvider);
    final machineName =
        machineWithId(machines.machines, machines.selectedId ?? '')?.name ??
        'your machine';
    final route = switch (ref.watch(linkStatusProvider)?.route) {
      LinkRoute.lan => 'Local network',
      LinkRoute.relay => 'Remote',
      null => '—',
    };
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
              const SizedBox(height: Spacing.xxxl),
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
                        text: machineName,
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
                child: ConnectionStatsCard(
                  stats: (
                    latencyMs: latency,
                    route: route,
                    counts: _loaded ? _counts : null,
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
              const SizedBox(height: Spacing.xxxl),
            ],
          ),
        ),
      ),
    );
  }
}
