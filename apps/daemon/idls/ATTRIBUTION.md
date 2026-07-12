# Vendored IDL attribution

`txoracle.json` is the TxODDS TxLINE **devnet** oracle program IDL, vendored from the
official sponsor repository:

- Source: https://github.com/txodds/tx-on-chain
- Path: `examples/devnet/idl/txoracle.json`
- Commit: `f37473a` ("Schedule update", 2026-07-12)
- Devnet program: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- License: see the upstream repo LICENSE.

This is a data-oracle + subscription + validation program (`subscribe`, `insert_*_root`,
`validate_odds`, `validate_stat[_v2/_v3]`, `validate_fixture[_batch]`, pricing-matrix +
treasury admin). It contains NO intent-book / order-matching / trade-settlement
instructions — see ../../../GROUND-TRUTH.md and ../../../feedback.md (F-001).
