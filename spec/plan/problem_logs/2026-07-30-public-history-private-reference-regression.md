# Public history private-reference regression

- Date: 2026-07-30
- Project: Calliope
- Status: remediation in progress
- Severity: high
- Affected repository ID: 1295061551
- Integrated source tip: `c1061073d303b61ce5d6446a0871e76960c7f358`

## Symptom

The public Git history audit reported 812 findings across 25 reachable commits before
the pending pull requests were integrated. Findings included commit messages, blob
contents, and historical paths. The affected keyword IDs are:

- `private-reference-002`
- `private-reference-003`
- `private-reference-004`
- `private-reference-006`
- `private-reference-012`

## Cause

Project-specific names were used as code identifiers, integration contracts, test
fixtures, documentation, commit messages, and file paths before the repository's
public/private data boundary was formalized. A snapshot-only edit cannot remove
those values from reachable Git objects.

## Remediation

1. Integrate the three open pull requests with merge commits so their commit graph is
   retained.
2. Replace the current snapshot's project-specific integration vocabulary with a
   neutral `ProjectHub` vocabulary, including affected paths.
3. Rewrite all reachable commit messages, blobs, and historical paths while retaining
   commit parent topology, authorship, timestamps, and tags.
4. Verify zero findings, commit/merge counts, topology, bundle integrity, `git fsck`,
   and a fresh clone.
5. Make the original GitHub repository private and archived, then create a different
   public repository with the original name and the sanitized history.

## Prevention

- Keep public integration contracts and fixtures label-neutral.
- Add content, commit-message, and path scans to the public-release checklist.
- Treat a replacement repository as a history migration, not a snapshot export.
