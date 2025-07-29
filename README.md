# PR Auto Changelog

Automatically update your project's changelog based on pull request comments and conventional commit formats.

## Quick Start

### 1. Add the Action to Your Workflow

Create `.github/workflows/changelog.yml`:

```yaml
name: Auto Changelog
on:
  pull_request:
    types: [opened, synchronize, edited]
  issue_comment:
    types: [created, edited]

jobs:
  changelog:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request' || (github.event_name == 'issue_comment' && github.event.issue.pull_request)
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 0
          
      - name: Update Changelog
        uses: puneet2019/pr-auto-changelog@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### 2. Use the PR Template

Add this to your PR description to include it in the changelog:

```markdown
- [x] auto-generate changelog
```

## How It Works

### Method 1: PR Title (Recommended)
Use conventional commit format in your PR title:
- `feat: add user authentication` → **Features** section
- `fix: resolve login bug` → **Bug Fixes** section
- `docs: update README` → **Documentation** section

### Method 2: PR Description
Add to your PR description:
```
/changelog: Added user authentication with JWT tokens
```

## Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `changelog-path` | Path to changelog file | `CHANGELOG.md` |
| `auto-categorize` | Use PR title for categorization | `true` |
| `comment-trigger` | Comment trigger phrase | `/changelog:` |
| `skip-dependabot` | Skip dependabot PRs | `true` |

## Examples

### Example 1: Feature PR
**PR Title:** `feat(auth): add two-factor authentication`

**PR Description:**
```markdown
- [x] auto-generate changelog
```

**Result in CHANGELOG.md:**
```markdown
### Features
- **auth**: add two-factor authentication ([#123](https://github.com/owner/repo/pull/123))
```

### Example 2: Manual Entry
**PR Description:** `/changelog: Improved error handling and user feedback`

**Result in CHANGELOG.md:**
```markdown
### Changes
- Improved error handling and user feedback ([#124](https://github.com/owner/repo/pull/124))
```

## Supported Commit Types

| Type | Changelog Section |
|------|------------------|
| `feat`, `feature` | Features |
| `fix` | Bug Fixes |
| `docs` | Documentation |
| `style` | Style |
| `refactor` | Refactoring |
| `perf` | Performance |
| `test` | Tests |
| `chore` | Chores |
| `ci` | CI/CD |
| `build` | Build |
| `revert` | Reverts |

## Behavior

- **✅ Checked** `[x] auto-generate changelog` → Entry is added and auto-committed
- **❌ Unchecked** `[ ] auto-generate changelog` → Auto-generated entries are removed
- **No checkbox** → Entry is skipped (default)

## PR Template

Create `.github/pull_request_template.md`:

```markdown
## What Changed

<!-- Describe what this PR changes -->

## Changelog

<!-- Check this box if you want this PR to be included in the changelog -->
- [ ] auto-generate changelog

<!-- 
PR title should follow conventional commit format: type(scope): description
Examples: feat(auth): add user authentication, fix(api): resolve login bug
-->
```

## Permissions

The action requires these permissions:
```yaml
permissions:
  contents: write
  pull-requests: read
  issues: read
```

## License

MIT License - see [LICENSE](LICENSE) file for details.
