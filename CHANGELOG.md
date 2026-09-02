# Changelog

Repository-level changes: structure, shared artefacts, tooling. Each module
keeps its own changelog, because module versions move independently and a study
pinned to one should not have to read about the others.

- [`modules/bpplus_data_capture/CHANGELOG.md`](modules/bpplus_data_capture/CHANGELOG.md)

## Unreleased

Initial structure.

- `modules/bpplus_data_capture` -- the first module, derived from the AOBP
  integration written for the University of Tasmania and generalised: one
  measurement rather than a seated/standing visit, and field names built from a
  configurable prefix rather than fixed.
- `instruments/bpplus_measurement` -- data dictionary and the button markup.
- `demo-project` -- a whole REDCap project as an XML file.
- `docs` -- getting started, installing, versioning, compatibility,
  troubleshooting.
- `tools/build-instrument.mjs` -- generates the data dictionary and the project
  XML from one field table, so the two cannot disagree.
- `tools/sync-sdk.ps1` -- replaces a vendored SDK copy and records which copy it
  is. `-Verify` reports one that has been edited in place.
- The SDK now has a repository of its own, `bpplus-js-sdk`, and
  `modules/bpplus_data_capture/sdk/` is pinned to a commit of it rather than to a
  copy lifted out of another module. The vendored bytes did not change: the
  folder hash before and after the extraction is the same.
- GitHub Pages landing page, so the test harness can be opened over HTTPS
  without installing anything -- which is the secure context the device APIs
  require.
