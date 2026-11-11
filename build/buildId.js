import { execFileSync } from 'node:child_process';

// Resolves the build marker shown in the app and compared by the update check.
//
// The marker has to do two jobs at once: name a release a human can recognise,
// and pin the exact source the bundle came from. `git describe --tags --always
// --dirty` gives both in one string — `v2026.7.3`, `v2026.7.3-5-gd76e17b`, plus a
// `-dirty` suffix when tracked files are modified.
//
// It is deterministic for a given source, which is what keeps the release check
// honest: two builds of unchanged source must produce an identical dist manifest,
// so a wall-clock component must never be reintroduced here.
export const BUILD_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

// Paths that cannot change what a build produces. The marker is what the running
// app compares against the server to decide whether to offer an update, so a
// documentation-only commit must not move it: every user would be prompted to
// update to code that is byte-for-byte what they are already running.
export const NON_SOURCE_PATHSPECS = ['.', ':(exclude)*.md', ':(exclude)docs/'];

const runGit = (args) =>
  execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

// Describes the last commit that could have changed the output, rather than HEAD.
// Still one deterministic string for one source state, so two builds of unchanged
// source stay identical - the release check depends on that.
export function describeSourceBuild({ run = runGit } = {}) {
  const sourceCommit = run(['log', '-1', '--format=%H', '--', ...NON_SOURCE_PATHSPECS]);
  // A tree whose entire history is documentation still deserves a marker.
  const described = run(['describe', '--tags', '--always', sourceCommit || 'HEAD']);
  // The dirty flag reads the same pathspec: an unsaved README edit is not a
  // different build, an unsaved source edit is.
  // `--untracked-files=all` is required here: an untracked public asset or a
  // source file consumed by a glob changes dist even though Git has no index
  // entry for it yet. Listing files individually also lets the Markdown/docs
  // exclusions keep working inside otherwise-untracked directories.
  const dirty = run(['status', '--porcelain', '--untracked-files=all', '--', ...NON_SOURCE_PATHSPECS]);
  return dirty ? `${described}-dirty` : described;
}

export function resolveBuildId({ env = process.env, describe } = {}) {
  const explicit = env.BUILD_ID;
  if (explicit !== undefined) {
    // Falling back to git on a bad value would ship a build labelled differently
    // from what the release lane asked for. Fail the build instead.
    if (!BUILD_ID_PATTERN.test(explicit)) throw new Error('BUILD_ID is invalid');
    return explicit;
  }

  try {
    return describe() || 'nogit';
  } catch (error) {
    // A source export or tarball has no git metadata; label it rather than
    // breaking the build.
    return 'nogit';
  }
}
