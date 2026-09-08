# Changelog — BP+ Data Capture

Read this before moving a project that is already collecting data. See
[docs/versioning.md](../../docs/versioning.md) for how a long study pins a
version and stays on it.

The version here must match the directory name REDCap installs it as, and the
release tag. The release workflow refuses a tag that disagrees.

## 2.0.1 — 2026-09-08

**If you have set "Require the device to be in a particular measurement mode"
to BP+, set it again.** The dropdown offered `1` for that choice, and 1 is
`Only BP`. A project configured for BP+, with a BP+ in BP+ mode on the desk,
refused to measure: *"This BP+ is in BP+ mode. This project needs Only BP."*
It offers `0` now, so the stored `1` is no longer one of the choices and the
setting has to be picked again. AOBP was always correct at 5.

### A refused device gives its port back

Refusing a device for its mode threw straight out of `connect()`, and the
caller dropped the reference without disconnecting. The transport was left
holding the port and its stream locks, so the next Connect got the same
`SerialPort`, `open()` answered *"The port is already open"*, and nothing could
close it. Unplugging the cable was the only way out -- after a refusal that is
not a fault, and that the operator is meant to act on and try again.

### One port at a time

Connecting while already connected built a second device and left the first
wherever it stood. Two silent resumes did exactly that at page load, because
nothing stopped `start()` running twice: both found no device, both opened a
port, and the first was stranded. `start()` now runs once per page, and a
connection attempt is claimed before its first `await` -- a check on `device`
cannot stop two attempts that begin together, because it is not set until the
transport exists.

### A restart is noticed, and a device that changed underneath is let go

Changing the mode reboots the BP+, and the USB device is the Prolific adapter:
nothing re-enumerates, no disconnect is fired, and the port stays open. A
project requiring AOBP would have kept a live Measure button attached to a
device that had since restarted into something else. `M 00` is read as the
restart it is; the device is checked again and released if it is no longer
acceptable, putting Connect back where the operator can act.

### The test harness

- **Project requires** and **Simulated device is in** dropdowns. `requiredMode`
  was pinned to `null`, so the setting could not be exercised from the harness
  at all -- which is why the refusal above was first met on a real REDCap.
- The module's own version is reported above the SDK's, read from `config.json`.

Nothing in `sdk/` changed: still v1.3.0, verified against its manifest.

## 2.0.0 — 2026-09-07

**The instrument changed incompatibly. Re-import the data dictionary.** Three
fields are gone, seven are new, and four validation ranges are corrected. A
project on 1.x keeps the old fields as orphans until it re-imports, and the
module writes to the new names meanwhile.

Import `instruments/bpplus_measurement/DataDictionary-new-project.csv`, which
carries both forms. A REDCap dictionary import replaces the whole dictionary,
not only the rows in it, and the instrument-only file would remove the
participant form and the record ID with it.

### Field names now match the BP+ XML

A field that holds a measurement is named after the element it comes from,
lowercased. The name is the only thing linking a column in an export to the
element in the device's own result file, and an abbreviation makes whoever
reconciles the two guess.

| Was | Now | From |
|---|---|---|
| `bpplus_hr` | `bpplus_pr` | `<Pr>` |
| `bpplus_ai` | `bpplus_sai` | `<sAI>` |
| `bpplus_irregular` | `bpplus_sprv` | `<sPRV>` |

`bpplus_pr` earns the rename on its own: `<Pr>` is the rate from the cuff
determination and `<sPR>` is the rate from the suprasystolic capture. They are
different measurements and disagreed in the first file tested — 46 against 42.

`bpplus_irregular` held a yes/no derived from `sPRV` against a 100 ms threshold.
The measured number is stored instead. Whether a rhythm counts as irregular is a
screening question, a stored verdict cannot be rechecked if the threshold moves,
and the number can always be judged again. Naming a field for irregular rhythm
is deferred until that screening is implemented properly.

REDCap field names are lowercase-only — it converts silently — so the case does
not survive. The spelling does.

### New fields

`bpplus_cmap`, `bpplus_spr`, `bpplus_sppv`, `bpplus_ssep` from `<cMap>`,
`<sPR>`, `<sPPV>` and `<sSEP>`, and `bpplus_position`, which the **operator**
fills.

### Validation ranges are now the rated ranges

Taken from `bpplus-measures-kb`, one file per measure. That knowledge base
defines four different ranges and records that the **rated** one governs
display: the span the device is validated over, narrower than what the sensor
can physically reach and unrelated to any clinical range.

| Field | Was | Now |
|---|---|---|
| `bpplus_sys` | 40–300 | 40–280 |
| `bpplus_map` | 25–250 | 25–245 |
| `bpplus_csys` | 40–300 | 37–283 |
| `bpplus_cdia` | 20–200 | 17–203 |
| `bpplus_sai` | −50–100 | 0–500 |

The central pressures are the brachial ones widened by 3 mmHg at each end. The
previous values were copied from the brachial fields unwidened, which made
REDCap query readings that were never in doubt.

`bpplus_sai` was wrong at both ends. `sAI` is a ratio against the incident wave
amplitude rather than pulse pressure, and is always positive with no ceiling at
100. `sAIx` is the measure that goes negative; they are not the same quantity.

`bpplus_snr`, `bpplus_sprv`, `bpplus_sppv` and `bpplus_ssep` gain ranges they
did not have. Several are marked provisional in the knowledge base, from a draft
RS:CALCS revision — re-check them when `@p` is released.

### AOBP

When the BP+ reports AOBP mode the module now sends the protocol's parameters
with the start command: rest before the first reading, interval, and number of
readings, configured per body position. In every other mode it sends none of
them, because parameters six to eight are only valid alongside the fifth.

`bpplus_position` is **required** in AOBP mode, and a measurement without one is
refused rather than guessed. Sending no position does not fall back to seated:
the device starts immediately, takes three readings, and writes no position into
the result, leaving nothing afterwards able to say which posture was measured.

All six timing settings are dropdowns. REDCap has no numeric setting type, no
`min`/`max`, and no hook that can refuse a save — its `validation` key applies
only to `field-list` — so a value outside the device's range cannot be
validated. It can only be made impossible to choose.

A blank setting sends nothing and the **device** applies its own default, which
differs between the positions. Substituting those numbers on the server would
send seated timings to a standing measurement the first time somebody copied the
wrong setting.

### Controls

- **Measure becomes Cancel** while the cuff inflates and **Repeat** once a
  reading has been taken. The separate Cancel button is gone from the shipped
  instrument: it did the same thing, leaving two controls for one action.
- **Resend recording** appears only after a filing has failed. It is the only
  retry there is — the recording exists in the page and nowhere else.

### Settings

- **Allow a measurement started on the BP+ itself** replaces *Refuse …*, and
  the refusal is now the default. A measurement begun on the device carries no
  patient ID and never reaches REDCap. The wording is inverted because a REDCap
  checkbox is unticked in every new project and its `default` key is
  unreliable — the safe behaviour has to be the unticked one.
- **Patient ID**: four modes, `REDCAP-[record]-[instance]` by default, with
  `[record:5]` padding. Never truncated; an over-long value is not sent at all.
- **Largest recording**: 1 MB, lowerable to 0.6 and no further. A pressure wave
  is base64 of 16-bit samples at 200 Hz, which puts the largest result the
  hardware can produce — five 180-second determinations — at about 0.53 MB.
- **Show warnings from attempts the device recovered from**, off by default.
- **TESTING ONLY — simulated BP+**, marked three ways: a banner, a console
  warning, and `SIMULATED-` on the device id written into the record.

### Checked rather than reasoned about

- `test/guards.php` runs the shipped class against stubs for the framework and
  REDCap's file API: 34 checks on what `save-xml` refuses.
- `test/settings.html` renders `config.json` the way REDCap renders it. REDCap
  treats a setting's `name` as HTML, and a default written as
  `REDCAP-<record>-<instance>` reaches an administrator as `REDCAP--`. The same
  rules run in `test/smoke.mjs`.
- `config.json` must be plain ASCII. A curly apostrophe is invisible in a diff.

### SDK

1.3.0. The patient ID rule is now the specification's — printable ASCII minus
comma, `<`, `&` and `>` — rather than the reference UI's letters-digits-hyphen.

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
