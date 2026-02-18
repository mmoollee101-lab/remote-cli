---
name: pdca
description: |
  Unified skill for managing the entire PDCA cycle.
  Auto-triggered by keywords: "plan", "design", "analyze", "report", "status".

  Use proactively when user mentions PDCA cycle, planning, design documents,
  gap analysis, iteration, or completion reports.

  Triggers: pdca, 계획, 설계, 분석, 검증, 보고서, 반복, 개선, plan, design, analyze,
  check, report, status, next, iterate, gap
argument-hint: "[action] [feature]"
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Task
  - TaskCreate
  - TaskUpdate
  - TaskList
  - AskUserQuestion
---

# PDCA Skill

> Unified Skill for managing PDCA cycle. Supports the entire Plan → Design → Do → Check → Act flow.

## Arguments

| Argument | Description | Example |
|----------|-------------|---------|
| `plan [feature]` | Create Plan document | `/pdca plan user-auth` |
| `design [feature]` | Create Design document | `/pdca design user-auth` |
| `do [feature]` | Do phase guide (start implementation) | `/pdca do user-auth` |
| `analyze [feature]` | Run Gap analysis (Check phase) | `/pdca analyze user-auth` |
| `iterate [feature]` | Auto improvement iteration (Act phase) | `/pdca iterate user-auth` |
| `report [feature]` | Generate completion report | `/pdca report user-auth` |
| `archive [feature]` | Archive completed PDCA documents | `/pdca archive user-auth` |
| `status` | Show current PDCA status | `/pdca status` |
| `next` | Guide to next phase | `/pdca next` |

## State Management

PDCA state is stored in `.pdca-status.json` at the project root:

```json
{
  "currentFeature": "user-auth",
  "phase": "check",
  "matchRate": 85,
  "iterationCount": 2,
  "startedAt": "2026-01-15T10:00:00Z"
}
```

## Action Details

### plan (Plan Phase)

1. Check if `docs/01-plan/{feature}.plan.md` exists
2. If not, create with requirements, goals, and scope
3. If exists, display content and suggest modifications
4. Create Task: `[Plan] {feature}`
5. Update `.pdca-status.json`: phase = "plan"

**Output Path**: `docs/01-plan/{feature}.plan.md`

**Template**:
```markdown
# {Feature} Plan

## Goals
- ...

## Requirements
- ...

## Scope
- In scope: ...
- Out of scope: ...

## Success Criteria
- ...
```

### design (Design Phase)

1. Verify Plan document exists (suggest running plan first if missing)
2. Create `docs/02-design/{feature}.design.md`
3. Reference Plan content for design decisions
4. Create Task: `[Design] {feature}` (blockedBy: Plan task)
5. Update `.pdca-status.json`: phase = "design"

**Output Path**: `docs/02-design/{feature}.design.md`

**Template**:
```markdown
# {Feature} Design

## Architecture
- ...

## Components
- ...

## Data Model
- ...

## Implementation Order
1. ...
```

### do (Do Phase)

1. Verify Design document exists
2. Provide implementation guide based on Design
3. Reference implementation order from Design document
4. Create Task: `[Do] {feature}` (blockedBy: Design task)
5. Update `.pdca-status.json`: phase = "do"

**Guide Provided**:
- Implementation order checklist
- Key files/components list
- Dependency installation commands

### analyze (Check Phase)

1. Verify implementation code exists
2. Compare Design document vs actual implementation
3. Calculate Match Rate and generate Gap list
4. Create Task: `[Check] {feature}` (blockedBy: Do task)
5. Update `.pdca-status.json`: phase = "check", matchRate

**Output Path**: `docs/03-analysis/{feature}.analysis.md`

**Analysis Method**:
1. Read Design document for expected components/features
2. Search codebase for actual implementations
3. Compare and calculate match rate
4. List gaps (missing, partial, or divergent implementations)

### iterate (Act Phase)

1. Check analysis results (when matchRate < 90%)
2. Auto-fix code based on Gap list
3. Re-run analysis after fixes
4. Create Task: `[Act-N] {feature}` (N = iteration count)
5. Stop when >= 90% reached or max iterations (5) hit

**Iteration Rules**:
- Max iterations: 5
- Stop conditions: matchRate >= 90% or maxIterations reached

### report (Completion Report)

1. Verify Check >= 90% (warn if below)
2. Integrated report of Plan, Design, Implementation, Analysis
3. Create Task: `[Report] {feature}`
4. Update `.pdca-status.json`: phase = "completed"

**Output Path**: `docs/04-report/{feature}.report.md`

### archive (Archive Phase)

1. Verify Report completion status
2. Create `docs/archive/YYYY-MM/{feature}/` folder
3. Move documents from original location
4. Update `.pdca-status.json`: phase = "archived"

**Output Path**: `docs/archive/YYYY-MM/{feature}/`

### status (Status Check)

1. Read `.pdca-status.json`
2. Display current feature, PDCA phase, Task status
3. Visualize progress

**Output Example**:
```
PDCA Status
─────────────────────────────
Feature: user-authentication
Phase: Check (Gap Analysis)
Match Rate: 85%
Iteration: 2/5
─────────────────────────────
[Plan] ✅ → [Design] ✅ → [Do] ✅ → [Check] 🔄 → [Act] ⏳
```

### next (Next Phase)

1. Check current PDCA phase
2. Suggest next phase guide and commands
3. Confirm with user via AskUserQuestion

**Phase Guide**:
| Current | Next | Suggestion |
|---------|------|------------|
| None | plan | `/pdca plan [feature]` |
| plan | design | `/pdca design [feature]` |
| design | do | Implementation start guide |
| do | check | `/pdca analyze [feature]` |
| check (<90%) | act | `/pdca iterate [feature]` |
| check (>=90%) | report | `/pdca report [feature]` |
| report | archive | `/pdca archive [feature]` |

## Document Structure

```
docs/
├── 01-plan/          # Plan documents
├── 02-design/        # Design documents
├── 03-analysis/      # Analysis reports
├── 04-report/        # Completion reports
└── archive/          # Archived features
    └── YYYY-MM/
```

## Task Integration

Each PDCA phase automatically integrates with Task System:

```
[Plan] {feature}
  ↓ (blockedBy)
[Design] {feature}
  ↓ (blockedBy)
[Do] {feature}
  ↓ (blockedBy)
[Check] {feature}
  ↓ (blockedBy, Check < 90%)
[Act-1] {feature}
  ↓ (on iteration)
[Act-N] {feature}
  ↓ (Check >= 90%)
[Report] {feature}
  ↓ (after completion)
[Archive] {feature}
```

## Usage Examples

```bash
# Start new feature
/pdca plan user-authentication

# Create design document
/pdca design user-authentication

# Implementation guide
/pdca do user-authentication

# Gap analysis after implementation
/pdca analyze user-authentication

# Auto improvement (if needed)
/pdca iterate user-authentication

# Completion report
/pdca report user-authentication

# Check current status
/pdca status

# Guide to next phase
/pdca next
```

## Auto Triggers

Auto-suggest related action when detecting these keywords:

| Keyword | Suggested Action |
|---------|------------------|
| "plan", "planning", "roadmap" | plan |
| "design", "architecture", "spec" | design |
| "implement", "develop", "build" | do |
| "verify", "analyze", "check" | analyze |
| "improve", "iterate", "fix" | iterate |
| "complete", "report", "summary" | report |
| "archive", "store" | archive |
