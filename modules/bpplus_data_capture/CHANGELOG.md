# Changelog — BP+ Data Capture

Read this before moving a project that is already collecting data. See
[docs/versioning.md](../../docs/versioning.md) for how a long study pins a
version and stays on it.

The version here must match the directory name REDCap installs it as, and the
release tag. The release workflow refuses a tag that disagrees.

## 1.0.0 — unreleased

First release.

### The measurement

- Takes one measurement from a BP+ into a record: brachial and central
  pressures, augmentation index, signal-to-noise ratio, irregular rhythm, and
  the device's own provenance — timestamp, GUID and device ID.
- Works on a data-entry form and on a survey page, so which one a study uses is
  not the module's business.
- Field names are built from a configurable prefix, so renaming them is a
  setting rather than an edit.
- Checks and sets the device clock before every measurement. The measurement
  timestamp comes from the device, so a clock that has drifted mislabels data
  permanently.
- Reformats the device's ISO timestamp for REDCap — the separator only, never
  reparsed through a `Date`, which would put the browser's timezone between the
  device and the record.
- Optionally refuses a measurement started with the device's own button, which
  carries no patient ID and belongs to no record.
- Optionally requires the device to be in a particular measurement mode, checked
  at connect rather than discovered mid-measurement.

### The recording

- Stores the device's result XML as a file on the record. Off by default; needs
  a File Upload field.
- The recording is held on the server during the measurement and filed onto the
  record when the form is **saved**. Both outcomes are written to the project
  log with the doc id or the message.
- A filing that does not succeed leaves the held recording in place, so the next
  save of that instance files it.
- `<prefix>xml_text` records whether the recording is held, with its size and
  hash — or, where file storage is off, holds the recording itself reduced to
  fit a text field.

### The connection

- Chooses its transport through the SDK: Web Serial on a desktop, WebUSB on
  Android. No platform logic of its own.
- Picks a granted device back up on every page load, so an operator who
  connected on one page of a survey is not asked again on the next. A resume
  with nothing to resume is silent and leaves Connect where it was.

### Testing

- Ships `test/harness.html`, which runs this module's own page code outside
  REDCap against a simulated or a real device, and stands in for the server so
  the whole path — hold, save, file — can be seen without a REDCap.
- `test/smoke.mjs` checks the module against the shipped data dictionary and the
  vendored SDK against its recorded hash.

Vendored SDK 1.2.1 from bpplus-js-sdk, Terminal API 2.4, BP+ software 5.3.0.0
series. REDCap External Modules framework 15. The release and a hash of the
vendored folder are in `sdk/SDK-VERSION.json`.
