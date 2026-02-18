---
name: claude-code-learning
description: |
  Claude Code learning and education skill.
  Teaches users how to configure and optimize Claude Code settings.
  Works across any project and any language.

  Triggers: learn claude code, claude code setup, CLAUDE.md, hooks, commands, skills,
  how to configure, 클로드 코드 배우기, 설정 방법, Claude Code 학습
argument-hint: "[learn|setup|upgrade] [level]"
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - AskUserQuestion
---

# Claude Code Learning Skill

> Master Claude Code configuration and optimization

## Actions

| Action | Description | Example |
|--------|-------------|---------|
| `learn` | Start learning guide | `/claude-code-learning learn 1` |
| `setup` | Auto-generate settings | `/claude-code-learning setup` |
| `upgrade` | Latest features guide | `/claude-code-learning upgrade` |

### learn [level]

Learning content by level:
- **Level 1**: Basics - Writing CLAUDE.md, Using Plan Mode
- **Level 2**: Automation - Commands, Hooks, Permission management
- **Level 3**: Specialization - Agents, Skills, MCP integration
- **Level 4**: Team Optimization - GitHub Action, Team rule standardization

### setup

Auto-generate appropriate settings after analyzing current project:
1. Analyze/generate CLAUDE.md
2. Check .claude/ folder structure
3. Suggest required configuration files

### upgrade

Guide to latest Claude Code features and best practices.

## Learning Levels

### Level 1: Basics (15 min)

```markdown
## What is CLAUDE.md?

A shared knowledge repository for the team. When Claude makes mistakes,
add rules to prevent the same mistakes from recurring.

## Example

# Development Workflow

## Package Management
- **Always use `pnpm`** (`npm`, `yarn` prohibited)

## Coding Conventions
- Prefer `type`, avoid `interface`
- **Never use `enum`** → Use string literal unions

## Prohibited
- No console.log (use logger)
- No any type
```

### Level 2: Automation (30 min)

```markdown
## What are Slash Commands?

Execute repetitive daily tasks with `/command-name`.

## Command Location

.claude/commands/{command-name}.md

## PostToolUse Hook

Auto-formatting after code modification:

// .claude/settings.local.json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "pnpm format || true"
      }]
    }]
  }
}
```

### Level 3: Specialization (45 min)

```markdown
## What are Sub-agents?

AI agents specialized for specific tasks.

## What are Skills?

Domain-specific expert context. Claude auto-references when working on related tasks.

## MCP Integration

Connect external tools (Slack, GitHub, Jira, etc.) via .mcp.json.
```

### Level 4: Team Optimization (1 hour)

```markdown
## PR Automation with GitHub Action

Mention @claude in PR comments to auto-update documentation.

## Team Rule Standardization

1. Manage CLAUDE.md with Git
2. Add rules during PR review
3. Gradually accumulate team knowledge
```

## Output Format

```
Claude Code Learning Complete!

**Current Level**: {level}
**Learned**: {summary}

Next Steps:
- Continue learning with /claude-code-learning learn {next_level}
- Auto-generate settings with /claude-code-learning setup
- Check latest trends with /claude-code-learning upgrade
```

## Current Settings Analysis

Files to analyze:
- CLAUDE.md (root)
- .claude/settings.local.json
- .claude/commands/
- .claude/agents/
- .claude/skills/
- .mcp.json
