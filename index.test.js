// Mock the modules before requiring the main module
jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('@actions/exec');
jest.mock('fs');

const core = require('@actions/core');

describe('PR Auto Changelog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseConventionalCommit', () => {
    test('parses conventional commit format correctly', () => {
      // Import inline to avoid module loading issues
      const { parseConventionalCommit } = require('./index');
      
      const pr = { html_url: 'https://github.com/owner/repo/pull/123' };
      const result = parseConventionalCommit('feat(auth): add user authentication', pr, 123);
      
      expect(result).toEqual({
        type: 'feat',
        scope: 'auth',
        description: 'add user authentication',
        prNumber: 123,
        prUrl: 'https://github.com/owner/repo/pull/123',
        section: 'Features'
      });
    });

    test('parses conventional commit without scope', () => {
      const { parseConventionalCommit } = require('./index');
      
      const pr = { html_url: 'https://github.com/owner/repo/pull/124' };
      const result = parseConventionalCommit('fix: resolve login bug', pr, 124);
      
      expect(result).toEqual({
        type: 'fix',
        scope: null,
        description: 'resolve login bug',
        prNumber: 124,
        prUrl: 'https://github.com/owner/repo/pull/124',
        section: 'Bug Fixes'
      });
    });

    test('returns null for invalid format', () => {
      const { parseConventionalCommit } = require('./index');
      
      const pr = { html_url: 'https://github.com/owner/repo/pull/125' };
      const result = parseConventionalCommit('invalid title format', pr, 125);
      
      expect(result).toBeNull();
    });
  });

  describe('parseChangelogComment', () => {
    test('parses changelog comment correctly', () => {
      const { parseChangelogComment } = require('./index');
      
      const pr = { html_url: 'https://github.com/owner/repo/pull/126' };
      const comment = '/changelog: Added new feature for user management';
      const result = parseChangelogComment(comment, '/changelog:', pr, 126);
      
      expect(result).toEqual({
        type: 'Manual',
        description: 'Added new feature for user management',
        prNumber: 126,
        prUrl: 'https://github.com/owner/repo/pull/126',
        section: 'Changes'
      });
    });

    test('returns null when trigger not found', () => {
      const { parseChangelogComment } = require('./index');
      
      const pr = { html_url: 'https://github.com/owner/repo/pull/127' };
      const comment = 'This is just a regular comment';
      const result = parseChangelogComment(comment, '/changelog:', pr, 127);
      
      expect(result).toBeNull();
    });

    test('returns null when description is empty', () => {
      const { parseChangelogComment } = require('./index');
      
      const pr = { html_url: 'https://github.com/owner/repo/pull/128' };
      const comment = '/changelog:';
      const result = parseChangelogComment(comment, '/changelog:', pr, 128);
      
      expect(result).toBeNull();
    });
  });
});
