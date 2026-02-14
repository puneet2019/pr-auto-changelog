# PR Auto Changelog

Automatically update your project's changelog based on pull request descriptions and conventional commit formats.

## What's New in v2

- **Auto-generate by default** — no checkbox needed. Every PR gets a changelog entry from its title.
- **Hash markers** — invisible HTML comments track auto-generated entries so user edits are never overwritten.
- **Comment commands** — `/changelog skip`, `/changelog regenerate`, `/changelog: custom text` from any PR comment.
- **Label-based skip** — skip changelog for PRs with specific labels (e.g. `dependencies`, `skip-changelog`).
- **Full backward compatibility** — set `default-behavior: 'opt-in'` to restore v1 checkbox behavior.

## Quick Start

### 1. Add the Action to Your Workflow

Create `.github/workflows/changelog.yml`:

```yaml
name: Auto Changelog
on:
  pull_request:
    types: [opened, synchronize, edited]
  issue_comment:
    types: [created]

jobs:
  changelog:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request' || (github.event_name == 'issue_comment' && github.event.issue.pull_request)
    permissions:
      contents: write
      pull-requests: read
      issues: read
    steps:
      - uses: actions/checkout@v6
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 0
          ref: ${{ github.event.pull_request.head.ref || github.head_ref || github.ref }}

      - name: Update Changelog
        uses: puneet2019/pr-auto-changelog@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### 2. Use the PR Template (Optional)

Add `.github/pull_request_template.md`:

```markdown
## What Changed
<!-- Describe what this PR changes -->

## Changelog
<!-- Auto-generated from PR title. To customize: -->
<!-- /changelog: your custom entry here -->
<!-- To skip: check the box below -->
- [ ] skip changelog
```

## How It Works

### Default Behavior (`auto` mode)

Every PR automatically gets a changelog entry generated from its title. No checkbox needed.

1. **PR is opened** → entry auto-generated from PR title and committed
2. **PR is updated** → entry regenerated (if untouched) or preserved (if user-edited)
3. **PR comment** `/changelog skip` → entry removed
4. **PR comment** `/changelog: custom text` → entry replaced with custom text
5. **PR comment** `/changelog regenerate` → entry force-regenerated from title

### Entry States

| State | How Detected | Behavior |
|-------|-------------|----------|
| **NONE** | No entry for this PR exists | Generate + commit |
| **AUTO_UNTOUCHED** | Entry has marker, hash matches | Safe to regenerate |
| **AUTO_EDITED** | Entry has marker, hash doesn't match | Preserved |
| **MANUAL** | Entry exists but has no marker | Preserved |

Auto-generated entries include an invisible HTML comment:
```markdown
- **auth**: add JWT tokens ([#123](url)) <!-- ac:a1b2c3d4:123 -->
```
This marker is invisible in rendered markdown. If a user edits the entry text, the hash won't match on the next run, and the entry is protected from overwriting.

### Priority Chain

When the action runs, it resolves what to do in this order:

1. `/changelog skip` (comment or description) → Remove entry
2. `/changelog regenerate` (comment) → Force regenerate from PR title
3. `/changelog: custom text` in PR description → Use custom text (no marker)
4. `/changelog: custom text` in latest PR comment → Use custom text (no marker)
5. Entry state is NONE or AUTO_UNTOUCHED → Auto-generate from PR title (with marker)
6. Entry state is AUTO_EDITED or MANUAL → Preserve (don't touch)

### PR Title Format (Recommended)

Use conventional commit format in your PR title:
- `feat: add user authentication` → **Features** section
- `fix: resolve login bug` → **Bug Fixes** section
- `feat(auth): add JWT tokens` → **Features** section with scope
- `docs: update README` → **Documentation** section

### Comment Commands

From any PR comment:

| Command | Effect |
|---------|--------|
| `/changelog skip` | Remove the changelog entry for this PR |
| `/changelog regenerate` | Force regenerate from PR title (overrides user edits) |
| `/changelog: your text here` | Set a custom changelog entry |

## Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `github-token` | GitHub token for API access | `${{ github.token }}` |
| `changelog-path` | Path to changelog file | `CHANGELOG.md` |
| `auto-categorize` | Use PR title for categorization | `true` |
| `comment-trigger` | Trigger phrase in PR description | `/changelog:` |
| `skip-dependabot` | Skip dependabot PRs | `true` |
| `default-behavior` | `auto` (default) or `opt-in` (legacy checkbox) | `auto` |
| `preserve-edited` | Preserve entries that were auto-generated then manually edited | `true` |
| `skip-labels` | Comma-separated PR labels that skip changelog | `''` |

### Outputs

| Output | Description |
|--------|-------------|
| `changelog-updated` | Whether the changelog was updated (`true`/`false`) |
| `changes-added` | Number of changes added to changelog |
| `entry-state` | Detected state: `NONE`, `AUTO_UNTOUCHED`, `AUTO_EDITED`, `MANUAL`, `SKIPPED` |

## Examples

### Example 1: Zero-Friction Auto-Generate

**PR Title:** `feat(auth): add two-factor authentication`

**Result in CHANGELOG.md:**
```markdown
### Features
- **auth**: add two-factor authentication ([#123](url)) <!-- ac:a1b2c3d4:123 -->
```

### Example 2: Custom Entry via Comment

**PR Comment:** `/changelog: Improved error handling and user feedback`

**Result in CHANGELOG.md:**
```markdown
### Changes
- Improved error handling and user feedback ([#124](url))
```

### Example 3: Skip via Label

```yaml
- name: Update Changelog
  uses: puneet2019/pr-auto-changelog@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    skip-labels: 'skip-changelog,dependencies'
```

PRs with the `skip-changelog` or `dependencies` label will not get changelog entries.

### Example 4: Edit Protection

1. Action auto-generates: `- **auth**: add JWT tokens ([#1](url)) <!-- ac:abc123:1 -->`
2. User edits to: `- **auth**: add JWT and OAuth tokens ([#1](url)) <!-- ac:abc123:1 -->`
3. Next run detects hash mismatch → `AUTO_EDITED` → entry preserved

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

## Migrating from v1

Set `default-behavior: 'opt-in'` to restore exact v1 behavior:

```yaml
- name: Update Changelog
  uses: puneet2019/pr-auto-changelog@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    default-behavior: 'opt-in'
```

- Legacy entries (without markers) are treated as `MANUAL` and never overwritten.
- The `[x] auto-generate changelog` checkbox still works in `opt-in` mode.

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
