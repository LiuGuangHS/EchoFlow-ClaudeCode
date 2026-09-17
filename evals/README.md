# EchoFlow Code Evaluation Suite

This directory contains evaluation tests for critical flows and behaviors in EchoFlow Code.

## Structure

```
evals/
├── README.md           # This file
├── scenarios/          # Test scenarios
│   ├── upstream-sync/  # Upstream merge scenarios
│   ├── provider-api/   # Provider API integration
│   └── identity/       # Fork identity preservation
└── fixtures/           # Test fixtures and data
```

## Evaluation Categories

### 1. Upstream Sync Evaluation
Tests for safe upstream merge workflow:
- Conflict detection and resolution
- Brand identity preservation
- Provider policy enforcement
- Persistence compatibility

### 2. Provider API Evaluation
Tests for provider integration:
- Official API endpoints only
- Reject third-party relays
- Custom provider configuration
- API key validation

### 3. Identity Preservation
Tests for fork identity:
- EchoFlow branding in public surfaces
- Upstream compatibility markers preserved
- No upstream maintainer attribution in fork releases
- Package metadata correctness

### 4. Quality Gates
Tests for development workflow:
- ECC command integration
- Verification script completeness
- Impact-aware routing
- Coverage blind spot awareness

## Running Evaluations

```bash
# Run all evaluations
bun run eval

# Run specific category
bun run eval:upstream-sync
bun run eval:provider-api
bun run eval:identity
bun run eval:quality-gates

# Run with coverage
bun run eval:coverage
```

## Adding New Evaluations

1. Create scenario file in `scenarios/<category>/`
2. Add fixtures in `fixtures/` if needed
3. Follow AAA pattern (Arrange-Act-Assert)
4. Document expected behavior and rationale
5. Link to relevant AGENTS.md sections

## Evaluation Principles

From AGENTS.md testing guidelines:

- **Drive transitions**: Use real actions, not hand-written state
- **Assert invariants**: Test what must be true, not current output
- **Cover both directions**: Test inclusion AND exclusion
- **Test the join**: Cross module boundaries
- **Never retune inputs**: If test needs input changes to pass, it's wrong
- **Don't mock module under test**: Use real implementations
- **Forward identity**: Don't dedupe by content comparison

## Critical Flows to Evaluate

### High Priority
1. Upstream merge with conflicts (preserve fork identity)
2. Provider preset validation (reject third-party relays)
3. Public identity audit (no upstream maintainer in fork releases)
4. ECC workflow integration (plan → review → gate)

### Medium Priority
5. Persistence migration (backward compatibility)
6. Desktop release flow (signing, updates)
7. Verification script routing (import-aware)
8. Coverage reporting (aware of blind spots)

### Low Priority
9. Configuration override precedence
10. CLI flag compatibility
11. Documentation consistency

## Status

- [ ] Upstream sync scenarios
- [ ] Provider API validation
- [ ] Identity preservation tests
- [ ] Quality gate workflows
- [ ] Coverage reporting
- [ ] Integration test harness

## References

- [AGENTS.md](../AGENTS.md) - Repository contract
- [CLAUDE.md](../CLAUDE.md) - Session-loaded summary
- `.claude/memory.md` - Project memory and decisions
