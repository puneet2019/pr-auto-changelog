const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const fs = require('fs');
const crypto = require('crypto');

// Constants for event types
const EVENT_TYPES = {
  PULL_REQUEST: 'pull_request'
};

// Constants for checkbox states
const CHECKBOX_STATES = {
  CHECKED: '[x] auto-generate changelog',
  UNCHECKED: '[ ] auto-generate changelog'
};

// Constants for dependabot
const DEPENDABOT_USER = 'dependabot[bot]';

// Constants for commit messages
const COMMIT_MESSAGES = {
  AUTO_CHANGELOG_PREFIX: '[AUTO-CHANGELOG]',
  UPDATE_TEMPLATE: '[AUTO-CHANGELOG] chore: update changelog with {count} new entries for PR #{prNumber}',
  REMOVE_TEMPLATE: '[AUTO-CHANGELOG] chore: remove auto-generated changelog entries for PR #{prNumber}'
};

// Constants for git configuration
const GIT_CONFIG = {
  USER_NAME: 'github-actions[bot]',
  USER_EMAIL: 'github-actions[bot]@users.noreply.github.com'
};

// Constants for changelog structure
const CHANGELOG_STRUCTURE = {
  HEADER: '# Changelog',
  UNRELEASED_SECTION: '## [Unreleased]',
  SECTION_PREFIX: '### ',
  ENTRY_PREFIX: '- ',
  PR_LINK_PATTERN: '[#{prNumber}]({prUrl})'
};

// Constants for changelog template
const CHANGELOG_TEMPLATE = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

`;

// Constants for output names
const OUTPUT_NAMES = {
  CHANGELOG_UPDATED: 'changelog-updated',
  CHANGES_ADDED: 'changes-added'
};

// Constants for output values
const OUTPUT_VALUES = {
  CHANGELOG_UPDATED_TRUE: 'true',
  CHANGELOG_UPDATED_FALSE: 'false',
  CHANGES_ADDED_ZERO: '0'
};



// Constants for entry types
const ENTRY_TYPES = {
  MANUAL: 'Manual',
  CONVENTIONAL: 'Conventional'
};

// Constants for default sections
const DEFAULT_SECTIONS = {
  CHANGES: 'Changes'
};

// Entry state enum — tracks the origin/status of a changelog entry for a PR
const ENTRY_STATE = {
  NONE: 'NONE',                 // No entry exists for this PR
  AUTO_UNTOUCHED: 'AUTO_UNTOUCHED', // Entry has marker, hash matches (safe to regenerate)
  AUTO_EDITED: 'AUTO_EDITED',   // Entry has marker, hash doesn't match (user edited)
  MANUAL: 'MANUAL',             // Entry exists but has no marker (user or legacy created)
  SKIPPED: 'SKIPPED'            // Entry was explicitly skipped
};

// Behavior modes
const BEHAVIOR_MODES = {
  AUTO: 'auto',     // Auto-generate for all PRs (opt-out via skip)
  OPT_IN: 'opt-in'  // Legacy checkbox behavior
};

// Hash marker pattern and template for tracking auto-generated entries
const HASH_MARKER = {
  // Matches <!-- ac:HEXHASH:PR# -->
  PATTERN: /<!-- ac:([a-f0-9]+):(\d+) -->/,
  // Template for building a marker
  template: (hash, prNumber) => `<!-- ac:${hash}:${prNumber} -->`
};

// Skip patterns recognized in PR description or comments
const SKIP_PATTERNS = {
  SKIP_CHECKBOX: '[x] skip changelog',
  SKIP_COMMAND_SLASH: '/changelog: skip',
  SKIP_COMMAND: '/changelog skip'
};

// Comment commands
const COMMENT_COMMANDS = {
  SKIP: 'skip',
  REGENERATE: 'regenerate'
};

// Conventional commit types mapping to changelog sections
const COMMIT_TYPE_MAPPING = {
  'feat': 'Features',
  'feature': 'Features', 
  'fix': 'Bug Fixes',
  'docs': 'Documentation',
  'style': 'Style',
  'refactor': 'Refactoring',
  'perf': 'Performance',
  'test': 'Tests',
  'chore': 'Chores',
  'ci': 'CI/CD',
  'build': 'Build',
  'revert': 'Reverts'
};

/**
 * Compute an 8-char hex hash of entry text (stripped of any existing marker).
 * Uses MD5 for speed — this is not security-sensitive.
 */
function computeEntryHash(entryText) {
  const stripped = entryText.replace(HASH_MARKER.PATTERN, '').replace(/\r/g, '').trim();
  return crypto.createHash('md5').update(stripped).digest('hex').slice(0, 8);
}

/**
 * Append an invisible HTML marker to an entry line for tracking.
 */
function buildMarkedEntry(entryText, prNumber) {
  const stripped = entryText.replace(HASH_MARKER.PATTERN, '').replace(/\r/g, '').trim();
  const hash = computeEntryHash(stripped);
  return `${stripped} ${HASH_MARKER.template(hash, prNumber)}`;
}

/**
 * Scan the Unreleased section of a changelog for an entry matching the given PR number.
 * Returns { state, line, storedHash }.
 */
function detectEntryState(changelogContent, prNumber) {
  const result = { state: ENTRY_STATE.NONE, line: null, storedHash: null };

  if (!changelogContent) return result;

  const unreleasedIdx = changelogContent.indexOf(CHANGELOG_STRUCTURE.UNRELEASED_SECTION);
  if (unreleasedIdx === -1) return result;

  // Extract just the Unreleased section
  let nextSectionIdx = changelogContent.indexOf('\n## ', unreleasedIdx + 1);
  if (nextSectionIdx === -1) nextSectionIdx = changelogContent.length;
  const unreleased = changelogContent.slice(unreleasedIdx, nextSectionIdx);

  const lines = unreleased.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(CHANGELOG_STRUCTURE.ENTRY_PREFIX)) continue;

    // Check if this line references our PR number
    const hasPrLink = trimmed.includes(`[#${prNumber}]`);
    const markerMatch = trimmed.match(HASH_MARKER.PATTERN);
    const hasMarkerForPr = markerMatch && markerMatch[2] === String(prNumber);

    if (!hasPrLink && !hasMarkerForPr) continue;

    // Found an entry for this PR
    result.line = trimmed;

    if (hasMarkerForPr) {
      result.storedHash = markerMatch[1];
      // Recompute hash of the visible text (without "- " prefix) to see if user edited it
      const entryWithoutPrefix = trimmed.replace(/^- /, '');
      const currentHash = computeEntryHash(entryWithoutPrefix);
      if (currentHash === result.storedHash) {
        result.state = ENTRY_STATE.AUTO_UNTOUCHED;
      } else {
        result.state = ENTRY_STATE.AUTO_EDITED;
      }
    } else {
      // Entry exists but has no marker — manual or legacy
      result.state = ENTRY_STATE.MANUAL;
    }
    return result;
  }

  return result;
}

/**
 * Parse PR comments for /changelog commands. Returns the latest command found.
 * Returns { command, text } or null.
 * command is one of: 'skip', 'regenerate', 'custom'
 */
function parseCommentCommands(comments, trigger) {
  if (!comments || comments.length === 0) return null;

  // Sort by created_at descending (latest first)
  const sorted = [...comments].sort((a, b) =>
    new Date(b.created_at) - new Date(a.created_at)
  );

  for (const comment of sorted) {
    const body = (comment.body || '').trim();
    const lines = body.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // /changelog skip
      if (trimmed === '/changelog skip' || trimmed === '/changelog: skip') {
        return { command: COMMENT_COMMANDS.SKIP, text: null };
      }

      // /changelog regenerate
      if (trimmed === '/changelog regenerate' || trimmed === '/changelog: regenerate') {
        return { command: COMMENT_COMMANDS.REGENERATE, text: null };
      }

      // /changelog: custom text
      if (trimmed.startsWith(trigger)) {
        const text = trimmed.replace(trigger, '').trim();
        if (text && text !== 'skip' && text !== 'regenerate') {
          return { command: 'custom', text };
        }
      }
    }
  }

  return null;
}

/**
 * Centralized skip logic for both auto and opt-in modes.
 * Returns true if the changelog should be skipped for this PR.
 */
function shouldSkipChangelog(pr, defaultBehavior, skipLabels) {
  const body = pr.body || '';

  if (defaultBehavior === BEHAVIOR_MODES.AUTO) {
    // In auto mode, skip if any skip pattern is found
    if (body.includes(SKIP_PATTERNS.SKIP_CHECKBOX)) return true;
    if (body.includes(SKIP_PATTERNS.SKIP_COMMAND_SLASH)) return true;
    if (body.includes(SKIP_PATTERNS.SKIP_COMMAND)) return true;

    // Check skip labels
    if (skipLabels && skipLabels.length > 0 && pr.labels) {
      const prLabelNames = pr.labels.map(l => (typeof l === 'string' ? l : l.name));
      if (skipLabels.some(sl => prLabelNames.includes(sl))) return true;
    }

    return false;
  }

  // opt-in mode: skip unless the legacy checkbox is checked
  if (defaultBehavior === BEHAVIOR_MODES.OPT_IN) {
    const hasChecked = body.includes(CHECKBOX_STATES.CHECKED);
    return !hasChecked;
  }

  return false;
}

/**
 * Implements the priority chain. Returns { action, reason, mark }.
 * action: 'skip' | 'preserve' | 'generate' | 'custom' | 'regenerate'
 * mark: true if the entry should get a hash marker
 */
function resolveEntryAction(entryState, prDescCommand, commentCommand, preserveEdited) {
  // Priority 1: /changelog skip command (comment or description)
  if (commentCommand && commentCommand.command === COMMENT_COMMANDS.SKIP) {
    return { action: 'skip', reason: 'Comment command: /changelog skip', mark: false };
  }
  if (prDescCommand && prDescCommand.command === COMMENT_COMMANDS.SKIP) {
    return { action: 'skip', reason: 'Description command: /changelog skip', mark: false };
  }

  // Priority 2: /changelog regenerate (comment only)
  if (commentCommand && commentCommand.command === COMMENT_COMMANDS.REGENERATE) {
    return { action: 'regenerate', reason: 'Comment command: /changelog regenerate', mark: true };
  }

  // Priority 3: /changelog: custom text in PR description
  if (prDescCommand && prDescCommand.command === 'custom') {
    return { action: 'custom', reason: 'Custom entry from PR description', mark: false, text: prDescCommand.text };
  }

  // Priority 4: /changelog: custom text in latest PR comment
  if (commentCommand && commentCommand.command === 'custom') {
    return { action: 'custom', reason: 'Custom entry from PR comment', mark: false, text: commentCommand.text };
  }

  // Priority 5 & 6: Based on entry state
  if (entryState === ENTRY_STATE.NONE || entryState === ENTRY_STATE.AUTO_UNTOUCHED) {
    return { action: 'generate', reason: `Entry state: ${entryState}`, mark: true };
  }

  if (entryState === ENTRY_STATE.AUTO_EDITED || entryState === ENTRY_STATE.MANUAL) {
    if (preserveEdited) {
      return { action: 'preserve', reason: `Entry state: ${entryState} (preserved)`, mark: false };
    }
    // If preserve is disabled, regenerate anyway
    return { action: 'generate', reason: `Entry state: ${entryState} (preserve disabled)`, mark: true };
  }

  // Default: generate
  return { action: 'generate', reason: 'Default', mark: true };
}

async function run() {
  try {
    // Get inputs
    const token = core.getInput('github-token');
    const changelogPath = core.getInput('changelog-path');
    const autoCategorize = core.getInput('auto-categorize') === 'true';
    const commentTrigger = core.getInput('comment-trigger');
    const skipDependabot = core.getInput('skip-dependabot') === 'true';
    const defaultBehavior = core.getInput('default-behavior') || BEHAVIOR_MODES.AUTO;
    const preserveEdited = core.getInput('preserve-edited') !== 'false';
    const skipLabelsRaw = core.getInput('skip-labels') || '';
    const skipLabels = skipLabelsRaw.split(',').map(s => s.trim()).filter(Boolean);

    const octokit = github.getOctokit(token);
    const context = github.context;

    core.info(`Event name: ${context.eventName}`);
    core.info(`Default behavior: ${defaultBehavior}`);

    // Determine PR number and details based on event type
    let prNumber, pr;
    const { owner, repo } = context.repo;

    if (context.eventName === 'issue_comment') {
      // Handle issue_comment event — validate it's on a PR
      const issue = context.payload.issue;
      if (!issue || !issue.pull_request) {
        core.info('Comment is not on a pull request, skipping');
        return;
      }
      prNumber = issue.number;

      // Fetch full PR details
      const { data: prData } = await octokit.rest.pulls.get({
        owner, repo, pull_number: prNumber
      });
      pr = prData;
    } else if (context.eventName === EVENT_TYPES.PULL_REQUEST) {
      prNumber = context.payload.pull_request.number;
      const { data: prData } = await octokit.rest.pulls.get({
        owner, repo, pull_number: prNumber
      });
      pr = prData;
    } else {
      core.info('Action only runs on pull_request and issue_comment events');
      return;
    }

    // Check if we should skip dependabot PRs
    if (skipDependabot && pr.user.login === DEPENDABOT_USER) {
      core.info('Skipping dependabot PR');
      return;
    }

    // --- Gather commands from PR description ---
    let prDescCommand = null;
    if (pr.body) {
      // Check for /changelog: skip or /changelog skip in description
      if (pr.body.includes(SKIP_PATTERNS.SKIP_COMMAND_SLASH) || pr.body.includes(SKIP_PATTERNS.SKIP_COMMAND)) {
        prDescCommand = { command: COMMENT_COMMANDS.SKIP };
      } else if (pr.body.includes(commentTrigger)) {
        // Parse /changelog: custom text from description
        const parsed = parseChangelogComment(pr.body, commentTrigger, pr, prNumber);
        if (parsed) {
          prDescCommand = { command: 'custom', text: parsed.description || parsed.scope ? null : null };
          // Store full parsed entry for later use
          prDescCommand._parsedEntry = parsed;
          // Reconstruct the custom text from the parsed entry
          const scopeText = parsed.scope ? `**${parsed.scope}**: ` : '';
          prDescCommand.text = `${scopeText}${parsed.description}`;
        }
      }
    }

    // --- Gather commands from PR comments ---
    let commentCommand = null;
    try {
      const { data: comments } = await octokit.rest.issues.listComments({
        owner, repo, issue_number: prNumber
      });
      commentCommand = parseCommentCommands(comments, commentTrigger);
    } catch (err) {
      core.warning(`Could not fetch PR comments: ${err.message}`);
    }

    // --- Check skip logic ---
    if (defaultBehavior === BEHAVIOR_MODES.AUTO) {
      // In auto mode, check skip patterns (but commands can override)
      const skipRequested = shouldSkipChangelog(pr, defaultBehavior, skipLabels);

      // If skip is requested AND no comment command overrides it, skip
      if (skipRequested && (!commentCommand || commentCommand.command === COMMENT_COMMANDS.SKIP)) {
        core.info('Skipping changelog (auto mode: skip detected)');
        await removeAutoGeneratedEntries(changelogPath, prNumber);
        core.setOutput(OUTPUT_NAMES.CHANGELOG_UPDATED, OUTPUT_VALUES.CHANGELOG_UPDATED_FALSE);
        core.setOutput(OUTPUT_NAMES.CHANGES_ADDED, OUTPUT_VALUES.CHANGES_ADDED_ZERO);
        core.setOutput('entry-state', ENTRY_STATE.SKIPPED);
        return;
      }
    } else if (defaultBehavior === BEHAVIOR_MODES.OPT_IN) {
      // In opt-in mode, use legacy checkbox behavior
      const skipRequested = shouldSkipChangelog(pr, defaultBehavior, skipLabels);
      if (skipRequested && (!commentCommand || commentCommand.command === COMMENT_COMMANDS.SKIP)) {
        core.info('Skipping changelog (opt-in mode: checkbox not checked)');
        const hasUncheckedCheckbox = pr.body && pr.body.includes(CHECKBOX_STATES.UNCHECKED);
        if (hasUncheckedCheckbox) {
          await removeAutoGeneratedEntries(changelogPath, prNumber);
        }
        core.setOutput(OUTPUT_NAMES.CHANGELOG_UPDATED, OUTPUT_VALUES.CHANGELOG_UPDATED_FALSE);
        core.setOutput(OUTPUT_NAMES.CHANGES_ADDED, OUTPUT_VALUES.CHANGES_ADDED_ZERO);
        core.setOutput('entry-state', ENTRY_STATE.SKIPPED);
        return;
      }
    }

    // --- Read CHANGELOG.md and detect entry state ---
    let changelogContent = '';
    if (fs.existsSync(changelogPath)) {
      changelogContent = fs.readFileSync(changelogPath, 'utf8');
    }
    const entryInfo = detectEntryState(changelogContent, prNumber);
    core.info(`Entry state for PR #${prNumber}: ${entryInfo.state}`);

    // --- Resolve what action to take ---
    const decision = resolveEntryAction(entryInfo.state, prDescCommand, commentCommand, preserveEdited);
    core.info(`Action: ${decision.action}, Reason: ${decision.reason}`);
    core.setOutput('entry-state', entryInfo.state);

    // --- Execute the action ---
    if (decision.action === 'skip') {
      // Remove entry and commit
      await removeAutoGeneratedEntries(changelogPath, prNumber);
      core.setOutput(OUTPUT_NAMES.CHANGELOG_UPDATED, OUTPUT_VALUES.CHANGELOG_UPDATED_TRUE);
      core.setOutput(OUTPUT_NAMES.CHANGES_ADDED, OUTPUT_VALUES.CHANGES_ADDED_ZERO);
      return;
    }

    if (decision.action === 'preserve') {
      core.info('Preserving existing entry (user-edited or manual)');
      core.setOutput(OUTPUT_NAMES.CHANGELOG_UPDATED, OUTPUT_VALUES.CHANGELOG_UPDATED_FALSE);
      core.setOutput(OUTPUT_NAMES.CHANGES_ADDED, OUTPUT_VALUES.CHANGES_ADDED_ZERO);
      return;
    }

    // For generate, regenerate, or custom: build the entry
    let changelogEntries = [];

    if (decision.action === 'custom') {
      // Use the custom text — try to parse as conventional commit first
      const customText = decision.text || (prDescCommand && prDescCommand.text);
      if (customText) {
        const conventionalEntry = parseConventionalCommit(customText, pr, prNumber);
        if (conventionalEntry) {
          changelogEntries.push(conventionalEntry);
        } else {
          changelogEntries.push({
            type: ENTRY_TYPES.MANUAL,
            description: customText,
            prNumber: prNumber,
            prUrl: pr.html_url,
            section: DEFAULT_SECTIONS.CHANGES
          });
        }
      }
    } else {
      // generate or regenerate: use PR description command's parsed entry or PR title
      if (prDescCommand && prDescCommand._parsedEntry && decision.action !== 'regenerate') {
        changelogEntries.push(prDescCommand._parsedEntry);
      } else if (autoCategorize) {
        const entry = parseConventionalCommit(pr.title, pr, prNumber);
        if (entry) {
          changelogEntries.push(entry);
        }
      }
    }

    if (changelogEntries.length === 0) {
      core.info('No changelog entries to add');
      core.setOutput(OUTPUT_NAMES.CHANGELOG_UPDATED, OUTPUT_VALUES.CHANGELOG_UPDATED_FALSE);
      core.setOutput(OUTPUT_NAMES.CHANGES_ADDED, OUTPUT_VALUES.CHANGES_ADDED_ZERO);
      return;
    }

    // Update changelog with marker support
    core.info(`Processing ${changelogEntries.length} changelog entries`);
    const updated = await updateChangelog(changelogPath, changelogEntries, { markEntries: decision.mark });

    if (updated) {
      core.info('Changelog updated successfully');

      // In auto mode: always auto-commit. In opt-in mode: only commit if legacy checkbox is checked.
      const shouldCommit = defaultBehavior === BEHAVIOR_MODES.AUTO ||
        (defaultBehavior === BEHAVIOR_MODES.OPT_IN && pr.body && pr.body.includes(CHECKBOX_STATES.CHECKED));

      if (shouldCommit) {
        await commitChanges(changelogPath, changelogEntries.length, prNumber);
      }

      core.setOutput(OUTPUT_NAMES.CHANGELOG_UPDATED, OUTPUT_VALUES.CHANGELOG_UPDATED_TRUE);
      core.setOutput(OUTPUT_NAMES.CHANGES_ADDED, changelogEntries.length.toString());
    } else {
      core.info('No changes needed - changelog is already up to date');
      core.setOutput(OUTPUT_NAMES.CHANGELOG_UPDATED, OUTPUT_VALUES.CHANGELOG_UPDATED_FALSE);
      core.setOutput(OUTPUT_NAMES.CHANGES_ADDED, OUTPUT_VALUES.CHANGES_ADDED_ZERO);
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}



function parseChangelogComment(comment, trigger, pr, prNumber) {
  const lines = comment.split('\n');
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (trimmedLine.startsWith(trigger)) {
      const description = trimmedLine.replace(trigger, '').trim();
      
      if (description) {
        // First, try to parse as conventional commit format
        const conventionalEntry = parseConventionalCommit(description, pr, prNumber);
        if (conventionalEntry) {
          return conventionalEntry;
        }
        
        // Fallback to manual entry
        return {
          type: ENTRY_TYPES.MANUAL,
          description: description,
          prNumber: prNumber,
          prUrl: pr.html_url,
          section: DEFAULT_SECTIONS.CHANGES // Default section for manual entries
        };
      }
    }
  }
  return null;
}

function parseConventionalCommit(title, pr, prNumber) {
  // Parse conventional commit format: type(scope): description
  const conventionalRegex = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\(.+\))?!?:\s*(.+)$/i;
  const match = title.match(conventionalRegex);
  
  if (match) {
    const [, type, scope, description] = match;
    const section = COMMIT_TYPE_MAPPING[type.toLowerCase()] || DEFAULT_SECTIONS.CHANGES;
    
    return {
      type: type,
      scope: scope ? scope.slice(1, -1) : null, // Remove parentheses
      description: description,
      prNumber: prNumber,
      prUrl: pr.html_url,
      section: section
    };
  }
  
  return null;
}

async function updateChangelog(changelogPath, entries, options) {
  const markEntries = options && options.markEntries;
  try {
    let changelogContent = '';

    // Read existing changelog or create new one
    if (fs.existsSync(changelogPath)) {
      changelogContent = fs.readFileSync(changelogPath, 'utf8');
    } else {
      changelogContent = CHANGELOG_TEMPLATE;
    }

    // Group entries by section
    const entriesBySection = {};
    entries.forEach(entry => {
      if (!entriesBySection[entry.section]) {
        entriesBySection[entry.section] = [];
      }
      entriesBySection[entry.section].push(entry);
    });

    // Find or create Unreleased section
    let unreleasedIndex = changelogContent.indexOf(CHANGELOG_STRUCTURE.UNRELEASED_SECTION);
    if (unreleasedIndex === -1) {
      // Add Unreleased section after the header
      const headerEnd = changelogContent.indexOf('\n## ');
      if (headerEnd === -1) {
        changelogContent += '\n## [Unreleased]\n\n';
        unreleasedIndex = changelogContent.indexOf(CHANGELOG_STRUCTURE.UNRELEASED_SECTION);
      } else {
        changelogContent = changelogContent.slice(0, headerEnd) +
                          '\n## [Unreleased]\n\n' +
                          changelogContent.slice(headerEnd);
        unreleasedIndex = changelogContent.indexOf(CHANGELOG_STRUCTURE.UNRELEASED_SECTION);
      }
    }

    // Find the end of the Unreleased section
    let nextSectionIndex = changelogContent.indexOf('\n## ', unreleasedIndex + 1);
    if (nextSectionIndex === -1) {
      nextSectionIndex = changelogContent.length;
    }

    let unreleasedContent = changelogContent.slice(unreleasedIndex, nextSectionIndex);
    const restContent = changelogContent.slice(nextSectionIndex);

    // First, remove any existing entries for the PRs we're updating
    entries.forEach(entry => {
      const prNumber = entry.prNumber;
      const lines = unreleasedContent.split('\n');
      let updatedLines = [];
      let entryRemoved = false;

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith(CHANGELOG_STRUCTURE.ENTRY_PREFIX)) {
          const entryText = trimmedLine.replace(/^- /, '');
          // Remove entries that contain this PR number (by link or by hash marker)
          const markerMatch = entryText.match(HASH_MARKER.PATTERN);
          const hasMarkerForPr = markerMatch && markerMatch[2] === String(prNumber);
          if (entryText.includes(`[#${prNumber}]`) || hasMarkerForPr) {
            entryRemoved = true;
            continue; // Skip this line (remove the entry)
          }
        }
        updatedLines.push(line);
      }

      if (entryRemoved) {
        unreleasedContent = updatedLines.join('\n');
      }
    });

    // Add new entries to appropriate sections
    Object.keys(entriesBySection).forEach(sectionName => {
      let sectionIndex = unreleasedContent.indexOf(`### ${sectionName}`);

      if (sectionIndex === -1) {
        // Add new section
        const sectionHeader = `\n### ${sectionName}\n\n`;
        unreleasedContent += sectionHeader;
        sectionIndex = unreleasedContent.indexOf(`### ${sectionName}`);
      }

      // Find end of this section
      let sectionEndIndex = unreleasedContent.indexOf('\n### ', sectionIndex + 1);
      if (sectionEndIndex === -1) {
        sectionEndIndex = unreleasedContent.length;
      }

      // Create new entries for this section
      const sectionEntries = entriesBySection[sectionName];
      const newEntries = [];

      sectionEntries.forEach(entry => {
        const scopeText = entry.scope ? `**${entry.scope}**: ` : '';
        const newEntryText = `${scopeText}${entry.description} ([#${entry.prNumber}](${entry.prUrl}))`;
        let newEntryLine = `${CHANGELOG_STRUCTURE.ENTRY_PREFIX}${newEntryText}`;
        // Append hash marker if markEntries is enabled
        if (markEntries) {
          newEntryLine = `${CHANGELOG_STRUCTURE.ENTRY_PREFIX}${buildMarkedEntry(newEntryText, entry.prNumber)}`;
        }
        newEntries.push(newEntryLine);
      });

      if (newEntries.length > 0) {
        const newEntriesText = newEntries.join('\n') + '\n';

        unreleasedContent = unreleasedContent.slice(0, sectionEndIndex) +
                            newEntriesText +
                            unreleasedContent.slice(sectionEndIndex);
      }
    });

    // Reconstruct full changelog
    const newChangelogContent = changelogContent.slice(0, unreleasedIndex) +
                                unreleasedContent +
                                restContent;

    // Check if content actually changed
    if (changelogContent === newChangelogContent) {
      return false; // No changes made
    }

    // Write updated changelog
    fs.writeFileSync(changelogPath, newChangelogContent);
    
    return true;
  } catch (error) {
    core.error(`Failed to update changelog: ${error.message}`);
    return false;
  }
}





async function removeAutoGeneratedEntries(changelogPath, prNumber) {
  try {
    if (!fs.existsSync(changelogPath)) {
      return; // No changelog file to remove from
    }

    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    const lines = changelogContent.split('\n');
    let updatedContent = '';
    let entryRemoved = false;

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith(CHANGELOG_STRUCTURE.ENTRY_PREFIX)) {
        const entryText = trimmedLine.replace(/^- /, '');
        // Remove entries that contain the PR number (by link or by hash marker)
        const markerMatch = entryText.match(HASH_MARKER.PATTERN);
        const hasMarkerForPr = markerMatch && markerMatch[2] === String(prNumber);
        if (entryText.includes(`[#${prNumber}]`) || hasMarkerForPr) {
          entryRemoved = true;
          continue; // Skip this line (remove the entry)
        }
      }
      updatedContent += line + '\n';
    }

    if (entryRemoved) {
      fs.writeFileSync(changelogPath, updatedContent.trim());
      core.info(`Auto-generated entry for PR #${prNumber} removed from changelog`);

      // Commit the removal with the same identifiable format
      await commitChanges(changelogPath, 0, prNumber);
    }
  } catch (error) {
    core.error(`Failed to remove auto-generated entry for PR #${prNumber}: ${error.message}`);
  }
}

async function commitChanges(changelogPath, entriesCount, prNumber) {
  try {
    // Configure git
    await exec.exec('git', ['config', 'user.name', GIT_CONFIG.USER_NAME]);
    await exec.exec('git', ['config', 'user.email', GIT_CONFIG.USER_EMAIL]);
    
    // Get the current branch name from the PR
    const context = github.context;
    const branchName = context.payload.pull_request.head.ref;
    
    // Checkout the PR branch if we're in detached HEAD
    try {
      await exec.exec('git', ['checkout', branchName]);
    } catch (error) {
      core.warning(`Could not checkout branch ${branchName}, trying to create it: ${error.message}`);
      // Try to create the branch if it doesn't exist
      await exec.exec('git', ['checkout', '-b', branchName]);
    }
    
    // Check if there are any changes to commit
    const { stdout: status } = await exec.getExecOutput('git', ['status', '--porcelain', changelogPath]);
    
    if (!status.trim()) {
      core.info('No changes to commit - changelog is already up to date');
      return;
    }
    
    // Add and commit changes
    await exec.exec('git', ['add', changelogPath]);
    
    const commitMessage = entriesCount > 0 
      ? COMMIT_MESSAGES.UPDATE_TEMPLATE.replace('{count}', entriesCount).replace('{prNumber}', prNumber)
      : COMMIT_MESSAGES.REMOVE_TEMPLATE.replace('{prNumber}', prNumber);
    
    await exec.exec('git', ['commit', '-m', commitMessage]);
    
    // Push changes
    await exec.exec('git', ['push', 'origin', branchName]);
  } catch (error) {
    core.error(`Failed to commit changes: ${error.message}`);
    throw error;
  }
}

run();

// Export functions for testing
module.exports = {
  parseConventionalCommit,
  parseChangelogComment,
  computeEntryHash,
  buildMarkedEntry,
  detectEntryState,
  parseCommentCommands,
  shouldSkipChangelog,
  resolveEntryAction,
  updateChangelog,
  removeAutoGeneratedEntries,
  ENTRY_STATE,
  BEHAVIOR_MODES,
  HASH_MARKER,
  SKIP_PATTERNS,
  COMMENT_COMMANDS,
  CHECKBOX_STATES,
  CHANGELOG_STRUCTURE,
  CHANGELOG_TEMPLATE,
  DEFAULT_SECTIONS,
  ENTRY_TYPES,
  COMMIT_TYPE_MAPPING
};
