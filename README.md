# Lectern

A local-first text to speech reader for the browser, built to coexist with
locked-down assessment environments. Lectern reads web page content aloud
using the voices already installed on your device. In its default
configuration it makes zero network requests: no account, no cloud, no
telemetry.

Status: pre-release. The de-linking and hardening work is in progress; see
`docs/lectern/00-implementation-plan.md` for the work order and
`docs/lectern/06-build-plan.md` for the phase gates.

## Provenance

Lectern is a fork of the MIT licensed
[Read Aloud](https://github.com/ken107/read-aloud) project by Hai Phan.
Lectern is an independent project and is not affiliated with or endorsed by
the original author. See `FORK.md` for the fork record, `NOTICE` for
attribution, and `LICENSE` for the license text, which retains the original
copyright line.

## Development

This GitHub repository is a read-only mirror published from an internal
repository. Pull requests opened here will be closed.

Before any store upload, both verification gates must pass:

```bash
./scripts/audit-remote-code.sh    # no remote code, no upstream endpoints, no inherited secrets
./scripts/verify-manifest.sh     # no inherited identity, permissions minimized
```

Build, test, and lint tooling arrives with the modernization milestone; see
the implementation plan.

## Author

**Proctorio**

## License

MIT. See `LICENSE` and `NOTICE`.
