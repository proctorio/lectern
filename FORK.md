# Fork Provenance

Operational record. Not a legal requirement, but keep it current.

## Upstream

| Field | Value |
|---|---|
| Upstream repository | https://github.com/ken107/read-aloud |
| Upstream author | Hai Phan (GitHub: ken107) |
| Upstream license | MIT, Copyright (c) 2016 Hai Phan |
| Upstream Chrome Web Store ID | hdhinadidafjejdhmfkjgnolgimiaplp |
| Fork commit SHA | 7f2764ba5629ddf3dfc6a8db09d552be7b5846b6 |
| Fork date | 2026-08-13 (UTC) |
| Upstream version at fork point | 2.23.0 |

## This fork

| Field | Value |
|---|---|
| Product name | Lectern |
| Repository | https://github.com/proctorio/lectern |
| Publisher | Proctor.io Incorporated, 7340 E Main St, Scottsdale, AZ |
| Chrome Web Store ID | FILL IN AFTER FIRST PUBLISH. Never change this. |
| License | MIT (retains upstream copyright, see LICENSE) |

## Divergence policy

- `upstream` is configured as a git remote for cherry-picking.
- Cherry-pick security and correctness fixes only.
- Never merge upstream branches wholesale. Upstream carries server dependencies that were deliberately removed (see docs/lectern/02-fork-delinking-plan.md).
- GitHub defaults a fork's pull request base to the parent repository. Verify the base on every PR.

## Removed from upstream

Record each removal so nobody reintroduces it by accident.

| Removed | Reason | Commit |
|---|---|---|
| manifest `key` field | Inherited extension identity | FILL IN |
| manifest `oauth2` block | Upstream author's Google client_id | FILL IN |
| Premium voice server synthesis | Routes user text to upstream author's server | FILL IN |
| Account system and purchase flow | Tied to upstream entitlements | FILL IN |
| S3 page-script loader | Remote hosted code, MV3 violation | FILL IN |
| `sync-page-scripts` npm script | References upstream author's S3 bucket | FILL IN |
| webRequest header rewriting | Exam integrity and store review risk | FILL IN |
| Upstream icons and images | Streamline Labs / Freepik assets, not sublicensable | FILL IN |

## Extension ID history

The Chrome Web Store extension ID is the key to every downstream allow-list entry
(Proctorio's own list plus each partner's independent list). Changing it invalidates
all of them. Do not change it. Do not republish under a new listing.

| Date | ID | Note |
|---|---|---|
| FILL IN | FILL IN | Initial publish |
