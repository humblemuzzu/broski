# Bridge test suite

`bun test` from `packages/bridge` runs everything (about five minutes). The rules every test keeps are in
[`AGENTS.md`](../../../../AGENTS.md) (test hygiene): no test touches `~/.pi`, `~/.broski` or `~/.claude`
(`setup/test-isolation.ts`, `safety/real-home-guard`), and a real agent is driven with a scripted model, not a mock.

## Where things are

| Path | What it proves |
|---|---|
| `contract_*.test.ts` | The contract: its schemas and generated files (`contract_schema`, `contract_codegen`, `contract_gen_fixtures`), the reducer, the answer checker, the stream rules, the layer check, and the conformance suite against the fake backend (`contract_conformance`). `contract_negative_*` run deliberately broken adapters to show each conformance rule fails when it should. |
| `core_*.test.ts` | The bridge core over the fake backend (`helpers/core-rig.ts`), and end to end over a real bridge and the link socket (`core_e2e_*`, `helpers/core-bridge.ts`). |
| `claude-code/` | The Claude Code adapter: one directory per part, `conformance/` (the rules against the real `claude` and a scripted endpoint), `integration/` and `spike/` (the real CLI's behaviour, the regression suite for SDK pin bumps). |
| `pi/` | The Pi adapter on Pi's faux provider, `conformance.test.ts` and the live matrix. |
| `link*.test.ts`, `link/`, `send_queue.test.ts`, `e2e_transport.test.ts` | The link socket, its key and handshake, the daemon's feed, the send queue and its windows. |
| `service_*`, `lifecycle_*`, `cli`, `config`, `platform`, `wizard-steps`, `onboarding-logic`, `integration`, `troubleshooter`, `doctor*`, `logging*`, `shell_env*`, `tls_*` | The CLI and the service around the bridge: install, start and stop, config, the setup wizard, diagnostics, logs, the login-shell environment, loopback TLS. |
| `workspace_*`, `pty_*`, `native_pty` | The workspace code Phase 3 will serve over the contract: files, git, the PTY. |
| `bench_budget`, `compiled-binary`, `sdk_lazy_imports`, `bounded_state`, `security_temp_roots` | The perf budget checker, the compiled binary, lazy SDK loading, bounded collections, temp roots. |
| `helpers/`, `fixtures/`, `setup/`, `safety/` | Shared kits: scripted Anthropic- and OpenAI-compatible endpoints, the core rig, broken adapters, probes, the real-home guard. |

## Running part of it

```bash
bun test src/__tests__/core_protocol.test.ts      # one file
bun test src/__tests__/pi/                        # one directory
bun run check:layers                              # import rules for contract, core and adapters
bun run contract:check                            # generated contract files are current
bun run mutate:core --check                       # the core's mutants still match their files
```
