# Development and Release Workflow

This document defines the standard workflow for developing, reviewing, tagging, building, and publishing Vditor Desktop releases.

## Branch model

- Version- or feature-specific `dev-*` / `feat-*` branches are active development branches. For example, `dev-0.1.3` carries the 0.1.3 release work.
- `main` is release-oriented and should receive completed work through a GitHub pull request.
- Official version tags must be created on the final commit on `main` after the pull request has been merged.

Do not create an official release tag on a development branch. The commit on a development branch may differ from the commit that is ultimately created on `main` by the merge strategy.

## Preparing a release on a development branch

Before opening a pull request:

1. Complete the implementation and update the relevant tests and documentation.
2. Update `package.json` and `package-lock.json` to the new version when required.
3. Add the new version section to `CHANGELOG.md`.
4. Update product-facing documentation when installation or user-visible behavior has changed.
5. Run the required checks, including formatting, linting, type checking, Vditor consistency checks, unit tests, build, and applicable Electron E2E tests.
6. Project Documentation Management: Update `CHANGELOG.md` and other documents in`docs/` according to the latest code status.
7. Commit the ready release changes on the development branch and push it.

Keep the release preparation changes in the pull request reviewable and avoid changing source files after the release tag has been created.

## Pull request and merge

Create a pull request from the release branch, such as `dev-0.1.3`, to `main` on GitHub. Review the diff and confirm that the required checks pass. Merge the pull request using the project's chosen GitHub merge strategy.

The release commit is the resulting commit on `main`:

- with a merge commit, it is the merge commit;
- with squash merging, it is the squash commit;
- with rebase merging, it is the final rebased commit.

## Creating the GitHub release

After the pull request is merged:

1. Open GitHub's **New release** page.
2. Create a new tag, such as `0.1.3` or `v0.1.3`, using the repository's established tag convention.
3. Set the tag target to the final merged commit on `main`.
4. Enter the release title and copy the corresponding version section from `CHANGELOG.md` into the release notes.
5. Save the release as a draft.

The tag must be created before building the release packages. This allows the build metadata generator to resolve the tag to the exact commit represented by the release.

## Building release artifacts

Synchronize the local repository and tags, then build from the release tag:

```bash
git fetch origin --tags
git switch --detach v0.1.3
npm run release:linux
```

Replace `v0.1.3` with the actual tag name. The command produces the configured Linux release artifacts, including the unpacked application, portable archive, and AppImage. If only one artifact is needed, use the corresponding `release:linux:*` script.

Before uploading, verify that:

- the package version matches the release tag;
- the About page displays the expected version;
- the application starts and the main editing workflows work;
- the artifact names and checksums are correct.

Upload the artifacts to the draft GitHub release. Do not modify the source or move the tag after building; otherwise the artifacts will no longer correspond to the tagged release.

## Publishing and post-release cleanup

After the artifacts and notes have been reviewed, publish the GitHub release. Then return to the normal development flow:

```bash
git switch dev-0.1.3
git pull --ff-only origin dev-0.1.3
```

Start subsequent work on a new version- or feature-specific development branch; keep `main` aligned with published release history. If a post-release fix is needed, develop it on a new branch and use a new version tag rather than moving an existing release tag.
