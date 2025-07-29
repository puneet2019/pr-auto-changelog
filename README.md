# PR Auto Changelog

<p align="center">
  <a href="https://github.com/puneet2019/pr-auto-changelog/actions"><img alt="pr-auto-changelog status" src="https://github.com/puneet2019/pr-auto-changelog/workflows/test/badge.svg"></a>
</p>

Automatically update your project's changelog based on pull request comments and conventional commit formats. This GitHub Action helps maintain a well-organized, up-to-date changelog without manual intervention.

## Features

- 🔧 **Comment-based changelog entries**: Use `/changelog:` comments in PRs to add entries
- 🏷️ **Conventional commit support**: Auto-categorize based on commit types (feat, fix, etc.)
- 📝 **Keep a Changelog format**: Follows the standard changelog format
- 🔗 **PR linking**: Automatically includes PR numbers and links
- 📂 **Section categorization**: Groups changes into Features, Bug Fixes, etc.
- ⚡ **Auto-commit**: Commits changelog updates when checkbox is checked
- 🚫 **Skip options**: Skip dependabot PRs or use `[auto-generate changelog]` checkbox in PR descriptions

## Usage

### Basic Setup

Create a workflow file (e.g., `.github/workflows/changelog.yml`):

```yaml
name: Auto Changelog
on:
  pull_request:
    types: [opened, synchronize]
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
          changelog-path: 'CHANGELOG.md'
          auto-categorize: true
          comment-trigger: '/changelog:'
```

### Input Parameters

| Parameter | Description | Required | Default |
|-----------|-------------|----------|---------|
| `github-token` | GitHub token for API access | Yes | `${{ github.token }}` |
| `changelog-path` | Path to the changelog file | No | `CHANGELOG.md` |
| `auto-categorize` | Auto-categorize based on conventional commits | No | `true` |
| `comment-trigger` | Comment trigger phrase | No | `/changelog:` |
| `skip-dependabot` | Skip processing for dependabot PRs | No | `false` |

### Output Parameters

| Parameter | Description |
|-----------|-------------|
| `changelog-updated` | Whether the changelog was updated (`true`/`false`) |
| `changes-added` | Number of changes added to changelog |

## How It Works

### Method 1: Comment-Based Entries

Add a comment to your PR with the `/changelog:` trigger:

```
/changelog: Added user authentication feature with JWT tokens
```

This will add an entry like:
```markdown
- Added user authentication feature with JWT tokens ([#123](https://github.com/owner/repo/pull/123))
```

**Multiple Comments & Edits:**
- The action captures both `created` and `edited` comment events
- If you edit your comment, the changelog entry will be updated automatically
- Multiple comments from the same user will update the existing entry (latest comment wins)
- Each PR can have only one changelog entry per user

### Method 2: Conventional Commit Auto-Categorization

Use conventional commit format in your PR title:

- `feat: add user authentication` → **Features** section
- `fix: resolve login bug` → **Bug Fixes** section  
- `docs: update README` → **Documentation** section
- `refactor: improve code structure` → **Refactoring** section

### Supported Conventional Commit Types

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

### Changelog Format

The action creates/maintains a changelog in [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Features
- Added user authentication feature with JWT tokens ([#123](https://github.com/owner/repo/pull/123))

### Bug Fixes  
- **auth**: Fixed login validation issue ([#124](https://github.com/owner/repo/pull/124))

### Documentation
- Updated API documentation ([#125](https://github.com/owner/repo/pull/125))

## [1.0.0] - 2023-12-01
...
```

## Examples

### Example 1: Manual Entry via Comment
```
PR Title: "Update login component"
Comment: "/changelog: Improved login form validation and error handling"
```
Result in changelog:
```markdown
### Changes
- Improved login form validation and error handling ([#123](https://github.com/owner/repo/pull/123))
```

### Example 2: Auto-categorization via Conventional Commit
```
PR Title: "feat(auth): add two-factor authentication support"
```
Result in changelog:
```markdown
### Features  
- **auth**: add two-factor authentication support ([#124](https://github.com/owner/repo/pull/124))
```

### Example 3: Bug Fix
```
PR Title: "fix: resolve memory leak in data processing"
```
Result in changelog:
```markdown
### Bug Fixes
- resolve memory leak in data processing ([#125](https://github.com/owner/repo/pull/125))
```

## Permissions

The action requires the following permissions:
- `contents: write` - To commit changelog updates
- `pull-requests: read` - To read PR information
- `issues: read` - To read PR comments

Example with explicit permissions:
```yaml
jobs:
  changelog:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: read
      issues: read
    steps:
      # ... your steps
```

## Advanced Configuration

### Custom Changelog Path
```yaml
- uses: puneet2019/pr-auto-changelog@v1
  with:
    changelog-path: 'docs/HISTORY.md'
```

### Disable Auto-categorization
```yaml
- uses: puneet2019/pr-auto-changelog@v1
  with:
    auto-categorize: false
```

### Custom Comment Trigger
```yaml
- uses: puneet2019/pr-auto-changelog@v1
  with:
    comment-trigger: '/update-changelog:'
```

### Skip Dependabot PRs
```yaml
- uses: puneet2019/pr-auto-changelog@v1
  with:
    skip-dependabot: true
```

### Auto-Generate Changelog Checkbox
By default, PRs are **skipped** from changelog processing. To include a PR in the changelog, add a checked checkbox to the PR description:

```markdown
## Description
This PR adds a new feature.

- [x] auto-generate changelog
```

**Default behavior (skipped):**
```markdown
## Description
This PR updates documentation.

- [ ] auto-generate changelog
```

**Dynamic behavior:**
- ✅ **Checked** `[x] auto-generate changelog` → Entry is **added** to changelog and **auto-committed**
- ❌ **Unchecked** `[ ] auto-generate changelog` → **Auto-generated entries are removed** from changelog
- **No checkbox** → Entry is **skipped** (default behavior)

**Auto-generated commits are identifiable** with the `[AUTO-CHANGELOG]` prefix and can be safely removed when unchecked.

This is useful for:
- Documentation-only changes
- Dependabot dependency updates
- Minor formatting changes
- **Default opt-out behavior** - only explicitly marked PRs get changelog entries
- **Selective auto-commit** - only checked PRs get auto-committed changelog updates

## Contributing

1. Fork this repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes using conventional commits
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have questions:
1. Check the [Issues](https://github.com/puneet2019/pr-auto-changelog/issues) page
2. Create a new issue with detailed information
3. Include your workflow file and any error messages
