const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const fs = require('fs');

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

async function run() {
  try {
    // Get inputs
    const token = core.getInput('github-token');
    const changelogPath = core.getInput('changelog-path');
    const autoCategorize = core.getInput('auto-categorize') === 'true';
    const commentTrigger = core.getInput('comment-trigger');

    const octokit = github.getOctokit(token);
    const context = github.context;

    core.info(`Event name: ${context.eventName}`);
    core.info(`Comment trigger: "${commentTrigger}"`);

    // Only run on pull request events
    if (context.eventName !== 'pull_request' && context.eventName !== 'issue_comment') {
      core.info('Action only runs on pull request events or issue comments');
      return;
    }

    const { owner, repo } = context.repo;
    let prNumber;

    // Get PR number based on event type
    if (context.eventName === 'pull_request') {
      prNumber = context.payload.pull_request.number;
      core.info(`PR event - PR number: ${prNumber}`);
    } else if (context.eventName === 'issue_comment') {
      prNumber = context.payload.issue.number;
      core.info(`Comment event - Issue/PR number: ${prNumber}`);
      
      // Check if the comment contains the trigger
      const comment = context.payload.comment.body;
      core.info(`Comment body: "${comment}"`);
      core.info(`Looking for trigger: "${commentTrigger}"`);
      
      if (!comment.includes(commentTrigger)) {
        core.info('Comment does not contain changelog trigger');
        return;
      }
      core.info('Comment contains trigger - proceeding with parsing');
    }

    // Get PR details
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber
    });

    let changelogEntries = [];

    // Parse comments for changelog entries
    if (context.eventName === 'issue_comment') {
      const comment = context.payload.comment.body;
      const entry = parseChangelogComment(comment, commentTrigger, pr, prNumber);
      if (entry) {
        core.info(`Parsed changelog entry: ${JSON.stringify(entry)}`);
        changelogEntries.push(entry);
      } else {
        core.info('Failed to parse changelog entry from comment');
      }
    } else if (autoCategorize) {
      // Auto-categorize based on PR title and conventional commits
      const entry = parseConventionalCommit(pr.title, pr, prNumber);
      if (entry) {
        core.info(`Parsed conventional commit entry: ${JSON.stringify(entry)}`);
        changelogEntries.push(entry);
      } else {
        core.info('Failed to parse conventional commit from PR title');
      }
    }

    if (changelogEntries.length === 0) {
      core.info('No changelog entries to add');
      core.setOutput('changelog-updated', 'false');
      core.setOutput('changes-added', '0');
      return;
    }

    // Update changelog
    if (changelogEntries.length > 0) {
      core.info(`Processing ${changelogEntries.length} changelog entries`);
      const updated = await updateChangelog(changelogPath, changelogEntries);
      
      if (updated) {
        core.info('Changelog updated successfully');
        
        // Commit changes
        await commitChanges(changelogPath, changelogEntries.length);
        
        core.setOutput('changelog-updated', 'true');
        core.setOutput('changes-added', changelogEntries.length.toString());
      } else {
        core.setFailed('Failed to update changelog');
      }
    } else {
      core.info('No changelog entries to process');
      core.setOutput('changelog-updated', 'false');
      core.setOutput('changes-added', '0');
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

function parseChangelogComment(comment, trigger, pr, prNumber) {
  core.info(`Parsing comment: "${comment}"`);
  core.info(`Looking for trigger: "${trigger}"`);
  
  const lines = comment.split('\n');
  core.info(`Comment has ${lines.length} lines`);
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    core.info(`Checking line: "${trimmedLine}"`);
    core.info(`Line starts with trigger: ${trimmedLine.startsWith(trigger)}`);
    
    if (trimmedLine.startsWith(trigger)) {
      const description = trimmedLine.replace(trigger, '').trim();
      core.info(`Found trigger! Description: "${description}"`);
      
      if (description) {
        return {
          type: 'Manual',
          description: description,
          prNumber: prNumber,
          prUrl: pr.html_url,
          section: 'Changes' // Default section for manual entries
        };
      } else {
        core.info('Description is empty after removing trigger');
      }
    }
  }
  core.info('No valid changelog entry found in comment');
  return null;
}

function parseConventionalCommit(title, pr, prNumber) {
  // Parse conventional commit format: type(scope): description
  const conventionalRegex = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\(.+\))?!?:\s*(.+)$/i;
  const match = title.match(conventionalRegex);
  
  if (match) {
    const [, type, scope, description] = match;
    const section = COMMIT_TYPE_MAPPING[type.toLowerCase()] || 'Changes';
    
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

async function updateChangelog(changelogPath, entries) {
  try {
    let changelogContent = '';
    
    // Read existing changelog or create new one
    if (fs.existsSync(changelogPath)) {
      changelogContent = fs.readFileSync(changelogPath, 'utf8');
      core.info(`Read existing changelog from ${changelogPath}`);
    } else {
      changelogContent = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

`;
      core.info(`Created new changelog content`);
    }

    // Group entries by section
    const entriesBySection = {};
    entries.forEach(entry => {
      if (!entriesBySection[entry.section]) {
        entriesBySection[entry.section] = [];
      }
      entriesBySection[entry.section].push(entry);
    });

    core.info(`Grouped entries by section: ${Object.keys(entriesBySection).join(', ')}`);

    // Find or create Unreleased section
    let unreleasedIndex = changelogContent.indexOf('## [Unreleased]');
    if (unreleasedIndex === -1) {
      // Add Unreleased section after the header
      const headerEnd = changelogContent.indexOf('\n## ');
      if (headerEnd === -1) {
        changelogContent += '\n## [Unreleased]\n\n';
        unreleasedIndex = changelogContent.indexOf('## [Unreleased]');
      } else {
        changelogContent = changelogContent.slice(0, headerEnd) + 
                          '\n## [Unreleased]\n\n' + 
                          changelogContent.slice(headerEnd);
        unreleasedIndex = changelogContent.indexOf('## [Unreleased]');
      }
      core.info(`Added Unreleased section at index ${unreleasedIndex}`);
    } else {
      core.info(`Found existing Unreleased section at index ${unreleasedIndex}`);
    }

    // Find the end of the Unreleased section
    let nextSectionIndex = changelogContent.indexOf('\n## ', unreleasedIndex + 1);
    if (nextSectionIndex === -1) {
      nextSectionIndex = changelogContent.length;
    }

    let unreleasedContent = changelogContent.slice(unreleasedIndex, nextSectionIndex);
    const restContent = changelogContent.slice(nextSectionIndex);

    // Add new entries to appropriate sections
    Object.keys(entriesBySection).forEach(sectionName => {
      let sectionIndex = unreleasedContent.indexOf(`### ${sectionName}`);
      
      if (sectionIndex === -1) {
        // Add new section
        const sectionHeader = `\n### ${sectionName}\n\n`;
        unreleasedContent += sectionHeader;
        sectionIndex = unreleasedContent.indexOf(`### ${sectionName}`);
        core.info(`Added new section: ${sectionName}`);
      } else {
        core.info(`Found existing section: ${sectionName}`);
      }

      // Find end of this section
      let sectionEndIndex = unreleasedContent.indexOf('\n### ', sectionIndex + 1);
      if (sectionEndIndex === -1) {
        sectionEndIndex = unreleasedContent.length;
      }

      // Get existing entries in this section to check for duplicates
      const sectionContent = unreleasedContent.slice(sectionIndex, sectionEndIndex);
      const existingEntries = sectionContent.split('\n').filter(line => 
        line.trim().startsWith('- ') && line.includes('([#')
      );

      // Create new entries, checking for duplicates
      const sectionEntries = entriesBySection[sectionName];
      const newEntries = [];
      
      sectionEntries.forEach(entry => {
        const scopeText = entry.scope ? `**${entry.scope}**: ` : '';
        const newEntryText = `${scopeText}${entry.description} ([#${entry.prNumber}](${entry.prUrl}))`;
        const newEntryLine = `- ${newEntryText}`;
        
        // Check if this entry already exists (by PR number)
        const existingEntryIndex = existingEntries.findIndex(existingLine => {
          return existingLine.includes(`[#${entry.prNumber}](`);
        });
        
        if (existingEntryIndex === -1) {
          // New entry, add it
          newEntries.push(newEntryLine);
          core.info(`Adding new entry: ${newEntryText}`);
        } else {
          // Entry exists, update it
          const existingLine = existingEntries[existingEntryIndex];
          const existingText = existingLine.replace(/^- /, '').replace(/ \(\[#\d+\]\([^)]+\)\)$/, '');
          const newText = newEntryText.replace(/ \(\[#\d+\]\([^)]+\)\)$/, '');
          
          if (existingText !== newText) {
            // Description changed, update the entry
            core.info(`Updating existing entry: "${existingText}" → "${newText}"`);
            // Replace the existing entry in the section content
            const updatedSectionContent = sectionContent.replace(existingLine, newEntryLine);
            unreleasedContent = unreleasedContent.replace(sectionContent, updatedSectionContent);
          } else {
            core.info(`Entry unchanged, skipping: ${newEntryText}`);
          }
        }
      });

      if (newEntries.length > 0) {
        const newEntriesText = newEntries.join('\n') + '\n';
        
        unreleasedContent = unreleasedContent.slice(0, sectionEndIndex) + 
                            newEntriesText + 
                            unreleasedContent.slice(sectionEndIndex);
        
        core.info(`Added ${newEntries.length} new entries to section: ${sectionName}`);
      } else {
        core.info(`No new entries to add to section: ${sectionName}`);
      }
    });

    // Reconstruct full changelog
    const newChangelogContent = changelogContent.slice(0, unreleasedIndex) + 
                                unreleasedContent + 
                                restContent;

    // Write updated changelog
    fs.writeFileSync(changelogPath, newChangelogContent);
    core.info(`Updated ${changelogPath} with new entries (duplicates filtered out)`);
    
    return true;
  } catch (error) {
    core.error(`Failed to update changelog: ${error.message}`);
    return false;
  }
}

async function commitChanges(changelogPath, entriesCount) {
  try {
    // Configure git
    await exec.exec('git', ['config', 'user.name', 'github-actions[bot]']);
    await exec.exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
    
    // Get the current branch name from the PR
    const context = github.context;
    let branchName;
    
    if (context.eventName === 'pull_request') {
      branchName = context.payload.pull_request.head.ref;
    } else if (context.eventName === 'issue_comment') {
      // For comments, we need to get the PR details to find the branch
      const { owner, repo } = context.repo;
      const prNumber = context.payload.issue.number;
      
      const octokit = github.getOctokit(core.getInput('github-token'));
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      });
      
      branchName = pr.head.ref;
    }
    
    core.info(`Using branch: ${branchName}`);
    
    // Checkout the PR branch if we're in detached HEAD
    try {
      await exec.exec('git', ['checkout', branchName]);
      core.info(`Successfully checked out branch: ${branchName}`);
    } catch (error) {
      core.warning(`Could not checkout branch ${branchName}, trying to create it: ${error.message}`);
      // Try to create the branch if it doesn't exist
      await exec.exec('git', ['checkout', '-b', branchName]);
    }
    
    // Check if there are any changes to commit
    const { stdout: status } = await exec.exec('git', ['status', '--porcelain'], [], { silent: true });
    
    if (!status.trim()) {
      core.info('No changes to commit - changelog is already up to date');
      return;
    }
    
    // Add and commit changes
    await exec.exec('git', ['add', changelogPath]);
    
    // Try to commit, but don't fail if there's nothing to commit
    try {
      await exec.exec('git', ['commit', '-m', `chore: update changelog with ${entriesCount} new entries`]);
      core.info('Successfully committed changelog changes');
    } catch (error) {
      if (error.message.includes('nothing to commit') || error.message.includes('no changes added to commit')) {
        core.info('No changes to commit - changelog is already up to date');
        return;
      }
      throw error;
    }
    
    // Push changes
    await exec.exec('git', ['push', 'origin', branchName]);
    
    core.info('Successfully committed and pushed changelog changes');
  } catch (error) {
    core.error(`Failed to commit changes: ${error.message}`);
    throw error;
  }
}

run();

// Export functions for testing
module.exports = {
  parseConventionalCommit,
  parseChangelogComment
};
