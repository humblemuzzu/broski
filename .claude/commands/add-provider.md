---
description: Generate a new Riverpod provider with state and notifier
allowed-tools: Write, Read, Glob
argument-hint: <ProviderName> [state fields...]
---

# Add Provider

Create a new Riverpod provider with:
- State class with fields
- StateNotifier with common methods
- Provider declaration
- Proper exports

## Structure

```
lib/providers/
  <name>_provider.dart
```

## Generated Code Includes
- State class with `copyWith`
- Notifier with `init()`, `reset()`, and custom methods
- `StateNotifierProvider` declaration

$ARGUMENTS
