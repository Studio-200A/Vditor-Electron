# Development and Release Workflow

This document defines the standard workflow for developing, reviewing, tagging,
building, and publishing Vditor Desktop releases.

## Branch model

- `dev` is the active development branch.
- `master` is release-oriented and should receive completed work through a
  GitHub pull request.
- Official version tags must be created on the final commit on `master` after
  the pull request has been merged.

Do not create an official release tag on `dev`. The commit on `dev` may differ
from the commit that is ultimately created on `master` by the merge strategy.

## Preparing a release on `dev`

Before opening a pull request:

1. Complete the implementation and update the relevant tests and documentation.
2. Update `package.json` and `package-lock.json` to the new version when
   required.
3. Add the new version section to `CHANGELOG.md`.
4. Update product-facing documentation when installation or user-visible
   behavior has changed.
5. Run the required checks, including formatting, linting, type checking,
   Vditor consistency checks, unit tests, build, and applicable Electron E2E
   tests.
6. Commit the ready release changes on `dev` and push the branch.

Keep the release preparation changes in the pull request reviewable and avoid
changing source files after the release tag has been created.

## Pull request and merge

Create a pull request from `dev` to `master` on GitHub. Review the diff and
confirm that the required checks pass. Merge the pull request using the
project's chosen GitHub merge strategy.

The release commit is the resulting commit on `master`:

- with a merge commit, it is the merge commit;
- with squash merging, it is the squash commit;
- with rebase merging, it is the final rebased commit.

## Keeping `dev` in sync with `master`

After a pull request is merged, `master` gains a commit (for example a merge
commit) that does not exist on `dev`. GitHub then reports that `dev` is behind
`master`. This is expected and does not mean `dev` has lost any work: the merge
commit only records that `dev`'s changes were integrated, so `dev` already
contains the content.

Development can continue on `dev` without syncing; the behind count only grows
by one per merged pull request and does not affect the next diff. When you want
the count to reset, merge the remote `master` into `dev`:

```bash
git fetch origin
git switch dev
git merge origin/master
git push
```

Fetching `origin` first is required because the merge commit was created on
GitHub, not in the local `master` branch. Merging the stale local `master` (or
pushing without fetching) reports "already up to date" while GitHub still shows
`dev` as behind.

## Creating the GitHub release

After the pull request is merged:

1. Open GitHub's **New release** page.
2. Create a new tag, such as `0.1.3` or `v0.1.3`, using the repository's
   established tag convention.
3. Set the tag target to the final merged commit on `master`.
4. Enter the release title and copy the corresponding version section from
   `CHANGELOG.md` into the release notes.
5. Save the release as a draft.

The tag must be created before building the release packages. This allows the
build metadata generator to resolve the tag to the exact commit represented by
the release.

## Building release artifacts

Synchronize the local repository and tags, then build from the release tag:

```bash
git fetch origin --tags
git switch --detach v0.1.3
npm run release:linux
```

Replace `v0.1.3` with the actual tag name. The command produces the configured
Linux release artifacts, including the unpacked application, portable archive,
and AppImage. If only one artifact is needed, use the corresponding
`release:linux:*` script.

Before uploading, verify that:

- the package version matches the release tag;
- the About page displays the expected version and commit link;
- the application starts and the main editing workflows work;
- the artifact names and checksums are correct.

Upload the artifacts to the draft GitHub release. Do not modify the source or
move the tag after building; otherwise the artifacts and About-page metadata
will no longer describe the same commit.

## About-page commit metadata

The About page obtains the short commit hash and GitHub commit URL from build
metadata generated at build time. The generator resolves the version tag in
the local Git repository, so the hash does not need to be manually edited in
the renderer source and does not create a self-referential follow-up commit.

The required order is therefore:

```text
dev commit → pull request merge → master release commit → version tag → build
```

## Publishing and post-release cleanup

After the artifacts and notes have been reviewed, publish the GitHub release.
Then return to the normal development flow:

```bash
git switch dev
git pull --ff-only origin dev
```

Start subsequent work on `dev`; keep `master` aligned with published release
history. If a post-release fix is needed, develop it on `dev` and use a new
version tag rather than moving an existing release tag.
