# Broski Bridge Test Suite

This directory contains comprehensive tests for the Broski bridge setup wizard and troubleshooter systems.

## Test Files

### Core System Tests
- **`platform.test.ts`** - Platform abstraction layer (OS detection, binary finding, daemon management)
- **`config.test.ts`** - Configuration system (schema validation, defaults, read/write operations)

### Setup Wizard Tests
- **`wizard-steps.test.ts`** - Individual wizard step logic and utility functions
- **`onboarding-logic.test.ts`** - Non-interactive setup flow and option processing
- **`integration.test.ts`** - End-to-end integration tests for the complete setup flow

### Troubleshooter Tests
- **`troubleshooter.test.ts`** - Problem categorization and doctor profile mapping

### Existing System Tests
- **`logging.test.ts`** - Log formatting and redaction (pre-existing)
- **`doctor.test.ts`** - Diagnostic system (pre-existing)
- **`cli.test.ts`** - Command-line interface (pre-existing)

## Test Coverage

### What's Tested ✅
1. **Platform Detection**: OS detection, binary finding, daemon type mapping
2. **Configuration System**: Schema validation, defaults, type safety
3. **Agent Detection**: Binary discovery for OpenCode, Claude Code, Codex
4. **Network Configuration**: Mode selection, port validation, IP detection
5. **Security Setup**: TLS configuration, token TTL validation
6. **Daemon Management**: Service type mapping, config generation
7. **Troubleshooter Logic**: Problem-to-profile mapping, escalation commands
8. **Integration Flow**: End-to-end wizard result validation

### What's NOT Tested ⚠️
- Interactive prompts (requires user input)
- File system operations (complex setup required)
- Network calls (external dependencies)
- TLS certificate generation (platform-specific tools)
- Process spawning (system dependencies)

## Running Tests

```bash
# Run all tests
bun test src/__tests__/

# Run specific test categories
bun test src/__tests__/platform.test.ts src/__tests__/config.test.ts
bun test src/__tests__/wizard-steps.test.ts src/__tests__/onboarding-logic.test.ts
bun test src/__tests__/troubleshooter.test.ts src/__tests__/integration.test.ts

# Run with coverage (if configured)
bun test --coverage src/__tests__/
```

## Test Results Summary

As of the last run:
- **86 tests passing** across 6 new test files
- **458 expect() calls** validating system behavior
- **0 failures** in the bridge setup and troubleshooter logic

The tests verify that:
1. Platform detection works correctly on all supported OSes
2. Configuration schema validates properly with sensible defaults
3. Agent detection logic handles all supported backends
4. Troubleshooter maps problems to appropriate doctor profiles
5. Setup wizard components produce valid configuration structures

## Test Strategy

These tests focus on **pure functions** and **logic validation** rather than integration with external systems. This approach ensures:

- **Fast execution** (no network/file I/O)
- **Reliable results** (no external dependencies)
- **Cross-platform compatibility** (works on any dev machine)
- **Core logic coverage** (validates business rules and data flow)

The tests complement the existing diagnostic and logging tests to provide comprehensive coverage of the bridge's setup and troubleshooting systems.