# BP+ Data Capture

A REDCap external module that records a blood-pressure measurement from a
**Uscom BP+** straight into a record, and keeps the device's own result file
alongside it.

The operator connects the device once and presses one button per measurement.
Nothing is typed by hand and nothing is transcribed from the device screen.

---

## How it works

The BP+ is on the **operator's** cable, not on the server, so the whole
measurement happens in the browser. The module puts the BP+ JavaScript SDK on
the page; the SDK owns the device — framing, checksums, result codes, timeouts,
transports — and `js/bpplus-capture.js` owns what a study owns: which fields to
fill, and what the operator is told.

No part of a measurement passes through PHP unless the raw XML is being stored
as a file.

---

## Requirements

| | |
|---|---|
| REDCap | External Modules framework version 15 |
| Browser | **Chrome or Edge.** Firefox, Safari and everything on iOS implement none of the device APIs |
| Page | **HTTPS** — the browser refuses device access on an insecure origin |
| Device | A Uscom BP+ on a USB cable |

---

## Installing

1. Copy this folder into REDCap's `modules/` directory as
   `bpplus_data_capture_v<version>` — REDCap takes the version from the
   directory name. Where a release has been published, the same folder is
   available as a ZIP from the
   [releases page](https://github.com/uscom/bpplus-redcap/releases).
2. Enable it on the project.
3. Add the instrument, if the project does not have one: see
   [`instruments/bpplus_measurement/`](../../instruments/bpplus_measurement/).
4. Set the project settings below.

[docs/installing.md](../../docs/installing.md) has the longer version, including
which of these an administrator has to do and which a project owner can.

---

## Project settings

| Setting | Default | What it does |
|---|---|---|
| Instrument that carries the BP+ controls | `bpplus_measurement` | Where the buttons live |
| Field-name prefix | `bpplus_` | Every field name is built from it |
| Store the raw measurement XML as a file | off | Needs a File Upload field. See below |
| Set the device clock when it is out by more than *n* minutes | 5 | See **The device clock** |
| Require the device to be in a particular measurement mode | any | Refuses to measure otherwise |
| Refuse a measurement started on the device itself | off | See below |
| Log every serial line to the browser console | off | Troubleshooting only |

---

## The instrument

The module finds its controls by id, and does nothing at all when they are
absent — so a renamed id is a page with dead buttons and no error anywhere.
Three are required:

| Element | | Purpose |
|---|---|---|
| `#bpplus-connect` | required | Opens the browser's device picker |
| `#bpplus-measure` | required | Takes one measurement |
| `#bpplus-status` | required | The single large status line |
| `#bpplus-cancel` | optional | Live only while the cuff is inflating |
| `#bpplus-ping` | optional | Confirms the link is live and the device still usable |
| `#bpplus-results` | optional | The reading, shown large to the operator |
| `#bpplus-alerts` | optional | What the device said was wrong, in its own words |
| `#bpplus-device-info` | optional | Versions and mode, for a technical instrument |

The markup that provides them is
[`instruments/bpplus_measurement/instrument.html`](../../instruments/bpplus_measurement/instrument.html).

### The fields

Every name is `<prefix>` plus a fixed suffix, so renaming them is a setting
rather than an edit to this module.

| Value | Field | Notes |
|---|---|---|
| Brachial systolic | `<p>sys` | |
| Brachial diastolic | `<p>dia` | |
| Mean arterial pressure | `<p>map` | |
| Pulse rate | `<p>hr` | |
| Central systolic | `<p>csys` | What a BP+ is for |
| Central diastolic | `<p>cdia` | |
| Augmentation index | `<p>ai` | `sAI`; legitimately negative in a young participant |
| Signal-to-noise ratio | `<p>snr` | The raw dB, not its band label |
| Irregular rhythm | `<p>irregular` | A radio, `1`/`0` |
| Measurement time | `<p>datetime` | The device clock, reformatted — see below |
| Measurement GUID | `<p>guid` | |
| Device ID | `<p>device_id` | Which physical device took the reading |
| Capture status | `<p>status` | Set to `complete` when a reading is stored |
| Raw XML | `<p>xml` | File Upload; written by the server |

A field the module writes and the instrument does not have is reported once per
measurement in the browser console, and the measurement continues. Silence there
would mean a study discarding a value for its whole run.

`<p>irregular` is a radio, so the module **clicks** the option
(`opt-<field>_1` / `_0`) rather than setting a value. That is the only way REDCap
records the choice.

---

## The measurement

### Patient ID

The record ID is sent to the device as the patient ID, so the measurement
identifies itself in its own XML. The device accepts letters, digits and
hyphens; anything else becomes a hyphen rather than costing an `F 14` at the
start of a measurement.

### The device clock

The measurement timestamp in the result XML comes from the **device's** clock,
not the browser's, and a BP+ that has been off charge drifts. Nothing else in the
record says when a measurement was really taken, so a wrong clock mislabels data
in a way that cannot be corrected afterwards.

Before every measurement the module reads the device clock, compares it with the
computer's, and sets it when the difference is beyond the threshold. A device
that is close enough is left alone, so the check costs one line on the wire.

It is silent. The operator is mid-visit and the clock is not their problem, so
it goes to the console:

```
[BP+] clock: The device clock was out by 1799 s, so it was set.
[BP+] clock: The device clock is within tolerance.
```

A failure there is swallowed deliberately. A device that will not accept a time
is still a device that can measure, and refusing to measure over it is the worse
outcome for a participant who is already seated.

### The timestamp in the field

The device writes ISO 8601 with no zone into its XML:

```xml
<MeasDataLogger ... datetime="2026-03-20T03:10:52" ...>
```

REDCap's `datetime_seconds_ymd` wants the same instant with a space where the
`T` is, and rejects the `T` outright — so a field storing the device's string
unchanged is flagged invalid on every single measurement.

Only the separator changes. Nothing is parsed into a `Date` and formatted back,
because that would put the browser's timezone between the device and the record:
the device holds local time and records nothing about where it is, so
reinterpreting it can only introduce an offset that was never there.

### A measurement started on the device

A BP+ has its own Start button, and a measurement begun there carries no patient
ID and belongs to no record. The device stores it all the same, so it is not
harmless: it leaves an unattributed reading in the device's file list, taken
outside the protocol.

**Refuse a measurement started on the device itself** makes the module watch for
that and cancel it. Off by default — a general-purpose module should not
interfere with a device it is only attached to — and worth turning on for any
study where every reading has to belong to a participant.

### Failures

Every device failure arrives as a `BpPlusError` carrying the result code, its
firmware name, and a sentence written for a person. The status line shows it and
the buttons re-enable, so a cancelled or failed measurement can simply be
repeated.

A result block is **not** the same as a measurement. When the cuff cannot be
inflated — a kinked hose is the ordinary way to meet this — the device ends the
request and returns a result with no blood pressure in it. That arrives looking
like an answer, and stored unchecked it writes empty readings into the record and
reports success. Whether a result is a reading at all is the SDK's judgement,
made against the device's own declared ranges, and an unusable one is rejected
before it reaches the fields.

### A warning on a measurement that worked

The NIBP module inside the device retries a determination it could not finish.
When a later attempt succeeds it records the good values and **leaves the failed
attempt's `<Alert>` in place**, so a perfectly good reading can carry what looks
like an error.

Severity is therefore contextual rather than lexical. The same alert text means:

| On a determination that | Shown as |
|---|---|
| produced values inside the device's `<bpRange>` | amber — recovered |
| produced nothing usable | red — a real failure |

The alerts are **shown, not stored**. An alert needs the determination it sits on
to mean anything, and a field holding one without that context asks a researcher
to invent rules for reading it. The retained XML holds both properly.

---

## The raw XML

A result runs to about **80 kB** for a single measurement, and past **120 kB**
for a three-determination AOBP one, because of the base64 cuff-pressure
recordings the device keeps. Either is more than a REDCap text field holds, so
the place for it is a file:

1. Add a **File Upload** field named `<prefix>xml` to the instrument. The
   supplied data dictionary already has it.
2. Tick **Store the raw measurement XML as a file**.

Keeping it is worth the trouble. It holds every value in the record, the device's
own account of the measurement, the firmware that produced it, and the raw
cuff-pressure trace — the only thing that can settle a question about a reading
years afterwards.

### When it is filed — after the save, never before

**Nothing is filed during the measurement.** `save-xml` writes the XML to a
holding file on the server; `redcap_save_record()` turns that into an edoc and
attaches it once the form has been submitted.

That ordering is not a preference. Filing during the measurement destroys the
file:

The file field is on the instrument being filled in. A submit saves **every**
field on that page, and the file input is empty — nobody chose a file, the module
attached one behind it — so REDCap writes that emptiness over the doc id. And
clearing a file field is how REDCap *deletes* an edoc: it sets `delete_date` on
the metadata row.

Re-attaching the doc id after the save is not a way round it: the link then
points at a row REDCap considers deleted, and downloads as *"Either this file
does not exist OR you do not have permission to download it."*

So: one edoc per recording, created after the only thing that would destroy it.

Two consequences worth knowing:

- **The operator must save the form.** The status line says so — *"Measurement
  recorded. Save the form to file the recording."* Leaving the page without
  saving loses the recording, and the module cannot help that; the server is
  holding bytes that nothing has asked it to file.
- **A failed filing leaves the held file in place**, so the next save of that
  instance tries again. A recording is not thrown away because one attempt
  failed — by then there is nothing left in the browser to send again.

### How it is filed

The page reaches the module through the framework's own JavaScript module
object, published by `initializeJavascriptModuleObject()` and found at
`window.BPPLUS_MODULE`. That object carries the module prefix and the survey's
CSRF token, and the framework authenticates the call and scopes it to the
calling project — so unlike a bare POST endpoint it cannot be aimed at another
one.

There is **no global `ExternalModules.ajax()`**. A page that calls one throws
`ExternalModules is not defined` at the moment a measurement finishes.

On the server the file takes two calls, and both are required:

```php
$docId  = \REDCap::storeFile($tmpFile, $project_id, $filename);
$linked = \REDCap::addFileToField($docId, $project_id, $record, $field,
                                  $event_id, $repeat_instance);
```

Both calls happen inside `redcap_save_record()`, not in the ajax handler.

**Note the leading backslash.** `REDCap` is a global class and a module's class
file is in a namespace, so an unqualified `REDCap::` names a class in *your*
namespace, which does not exist. PHP raises an `Error` — not an `Exception`, so
a `catch (Exception ...)` does not see it — the framework absorbs it, and the
page finishes normally with the recording never filed. The same applies to
`Throwable`, `DateTime` and anything else global: qualify it, or `use` it.
`php -l` will not tell you; `node tools/check-modules.mjs` will.

`storeFile()` copies the bytes into REDCap's edoc store and returns a doc id, or
0. That gets the file onto the server and nowhere near the record — nothing yet
says which record, event, instance or field it belongs to. `addFileToField()` is
what puts it on the record and makes it visible on the form. **The instance is
not optional**: an instrument that repeats will otherwise file every measurement
against instance 1.

`save-xml` is declared in `config.json` under **both** `no-auth-ajax-actions` and
`auth-ajax-actions`. An action must be declared for the context it is called
from, and a survey respondent is not a logged-in user; undeclared, the framework
refuses the call and the recording is never filed.

### What the text field holds

`<prefix>xml_text` is optional, and it is **not** a second copy of the XML. Three
cases:

| | `<prefix>xml_text` gets |
|---|---|
| The server is holding it | `held bytes=79884 sha256=… field=… at=…` |
| It could not be held | `not-held field=… bytes=… reason=… at=…` |
| File storage is off | the recording itself, **reduced** |

It says **held**, not stored, because that is what is true at the moment the page
writes it — the filing happens later, on the save, with no JavaScript running.
**The project log is the authoritative record of the filing**, and carries the
doc id or the failure.

The middle row is why the field exists. Without it, a record whose recording was
lost reads exactly like one where none was ever taken — and the byte count and
hash are what identify the file if it is recovered from somewhere else.

The last row uses the SDK's `minimalXml()`. A REDCap text field holds 65,535
bytes and a result is larger, so the choice was never whole-or-reduced but
**reduced-or-truncated**, and a document cut off mid-element is worth nothing.
The reduction drops the derived `<Results>`, which recompute, and each
determination's `<RawPressureWave>` and `<NibpDetailedData>`; what stays is the
suprasystolic and cuff recordings and every determination's readings, timestamp,
alert and motion flag. Measured on a simulated result: 79,884 bytes to 16,854,
still parsing as a measurement.

Leave the field off the instrument and none of this happens — the module says so
once per measurement in the console rather than warning about it.

### Reconnecting across a multi-page survey

A survey submit ends the JavaScript holding the port; the browser's **grant**
outlives it. So on every page load the module tries to pick a granted device back
up, using the SDK's `silent` transport option — no picker, no user gesture.

Without it, an operator who connected on one page reconnects on the next, with
the participant already waiting. On a repeating instrument that is every single
measurement.

**A failed resume is quiet.** It is attempted on every page load including the
first, where there is normally nothing to resume, so "no port has been granted
yet" is the ordinary state rather than a fault. The Connect button is left
exactly where it was, and the operator's click supplies the gesture the picker
needs. Only the console mentions it:

```
[BP+] nothing to resume (no serial port has been granted to this page yet)
```

It resumes only when the choice is unambiguous. More than one granted port and
the SDK refuses, because the right one is not knowable from a list.

#### Testing it, and the trap underneath

`window.BPPLUS_TRANSPORT` takes **`(api, options)`** and must pass
`options.silent` into every transport it constructs. A hook that takes only
`(api)` sends the resume to the picker, the browser refuses it for want of a user
gesture, and the feature looks broken on the bench while working in REDCap —
which is the worst way for a test rig to be wrong. `test/smoke.mjs` reads both
the hook and the module and fails if the flag is dropped, or if it reaches the
function that builds a transport but not the constructor.

To see it work you need a real device: choose **Real BP+**, connect once, then
reload the page. The simulator deliberately **refuses** a silent resume, because
it has no grant to pick back up — left to itself it opens whatever it is asked
and the harness would report a resume that never happened.

### A record that does not exist yet

On a survey the record is created when the first page is submitted, so a
measurement taken before that has nowhere to be filed. The module says so in
words the operator can act on rather than failing obscurely, and the fields are
filled either way.

Both outcomes are written to the project log with the doc id or the message, so
a recording that went missing is still traceable after the browser console is
closed.

---

## Reacting to a measurement

After each measurement, once the fields are filled:

```js
document.addEventListener('bpplus:measurement', e => {
  e.detail.measurement;  // the SDK's BpPlusMeasurement
  e.detail.fields;       // the field names this project is using
});
```

Everything the SDK exposes is on `e.detail.measurement` — the individual
readings, the pulse-wave indices, signal quality, and the decoded cuff-pressure
trace.

---

## Testing without REDCap

`test/harness.html` reproduces the instrument — the same element ids, one input
per field — and loads **`js/bpplus-capture.js` unmodified**. The connect,
feature-read and measure paths it exercises are the ones REDCap runs; only the
surrounding page is different.

```bash
python -m http.server 8080
```

then open `http://localhost:8080/modules/bpplus_data_capture/test/harness.html`.
A server is required: ES modules and the device APIs both refuse to run from
`file://`.

Served from the repository root it fetches the **shipped** instrument markup, so
what you test is what a project gets; served on its own it falls back to a built-in
copy and says so in a banner.

### Seeing where the recording goes

The harness stands in for the REDCap server, and for **both halves** of the
save — because the module hands a recording over during the measurement and
REDCap files it when the form is saved, and a stand-in with only the first half
would show the recording arriving at a moment it never actually arrives.

So there is a **Save the form** button. Take a measurement and the recording
appears as *held, awaiting the save*, under the record, event and instance
REDCap would file it against, with its size and SHA-256. Press Save and it
becomes *filed*, with a doc id.

Two switches make the failures reachable:

| | |
|---|---|
| Make the next **hold** fail | The measurement keeps its numbers; the recording is lost and `<prefix>xml_text` records that it was |
| Make the next **filing** fail | The held recording **stays put**, so saving again retries — the behaviour that is otherwise invisible |

Held recordings live in IndexedDB, so they survive a reload the way the server's
holding file survives a page change. Every recording can be opened or saved from
the table, which is how to check that what the module handed over is the whole
document and not a fragment.

What it cannot prove is that `REDCap::storeFile()` accepts it. That needs a real
project.

Choose **Simulator** to work with no hardware — including the failure paths, which
are hard to produce on purpose with a real device — or **Real BP+** to drive one.
It shows every REDCap field as the module leaves it, conformance checks on each
measurement, the decoded cuff-pressure trace, the serial trace line by line, and
the SDK self-test on a button.

There is also a headless check that needs no browser and no device:

```bash
npm install --no-save jsdom
node test/smoke.mjs
```

`node --check` only parses. This loads the module against a stand-in instrument
and fails if it does not start — a value read before it was assigned leaves a
module that loads and does nothing, with no error to say so. It also checks the
module against the shipped data dictionary, because the two agreeing is the whole
contract: a field renamed in one and not the other is silent in REDCap and costs
a study its data.

The module offers one hook for this and nothing else: if `window.BPPLUS_TRANSPORT`
is a function it is asked for the transport, which is how the harness substitutes
the simulator. REDCap never sets it.

---

## Layout

```
config.json               module manifest
BpPlusDataCapture.php     the page hooks and the save-xml AJAX action
js/bpplus-capture.js      the page controller -- a consumer of the SDK
sdk/                      the BP+ JavaScript SDK, vendored and pinned
sdk/SDK-VERSION.json      which copy it is, and where it came from
test/harness.html         the test harness
test/smoke.mjs            does the module start, and does the instrument match it
```

`sdk/` is carried here because REDCap serves only a module's own directory. **Do
not edit it in place** — run `tools/sync-sdk.ps1` to replace the folder and
rewrite the provenance.
