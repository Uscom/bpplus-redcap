# Field map

What each field holds, where it comes from in the device's result XML, and why
it is (or is not) stored.

`<p>` is the project's field prefix, `bpplus_` by default.

---

## Brachial pressures

The cuff measurement, as any oscillometric monitor produces it.

| Field | Type | From | |
|---|---|---|---|
| `<p>sys` | integer, 40–300 | `<Sys>` | Systolic, mmHg |
| `<p>dia` | integer, 20–200 | `<Dia>` | Diastolic, mmHg |
| `<p>map` | integer, 25–250 | `<Map>` | Mean arterial pressure, mmHg |
| `<p>hr` | integer, 30–240 | `<Pr>` | Pulse rate, bpm |

The validation ranges are the **device's** declared measurement limits, not
clinical ones. A range narrower than what the device can produce turns a real
reading into a REDCap error the operator has no way to resolve — and the operator
is standing next to a participant, not debugging a data dictionary.

## Central pressures and indices

What distinguishes a BP+ from a cuff. Derived from the suprasystolic capture —
the high-gain pulse channel recorded while the cuff is held above systolic — and
found under `<Result>`.

| Field | Type | From | |
|---|---|---|---|
| `<p>csys` | integer, 40–300 | `<cSys>` | Central systolic, mmHg |
| `<p>cdia` | integer, 20–200 | `<cDia>` | Central diastolic, mmHg |
| `<p>ai` | number, −50–100 | `<sAI>` | Augmentation index, % |
| `<p>snr` | number | `<SNR>` | Signal-to-noise ratio, dB |

`sAI` can legitimately be **negative** in a young participant, which is why the
minimum is not zero. A validation range starting at 0 rejects exactly the
participants a vascular-ageing study is most interested in.

`<p>snr` stores the **raw dB and not the quality band**. The label ("Excellent",
"Poor") is an interpretation of this number and can be recomputed from it at any
time; a band whose thresholds moved later would leave a stored label wrong, with
nothing in the record to check it against.

The SDK exposes more indices than these — `sPP`, `sPPV`, `sSEP`, `sRWTTFoot`,
`sRWTTPeak`, `sDpDtMax` — through `measurement.indices`. They are not in the
example instrument because most studies do not use them, and they are all in the
retained XML for the ones that do. Add fields and extend `storeResult()` if you
need them.

## Rhythm

| Field | Type | From | |
|---|---|---|---|
| `<p>irregular` | radio, `1`/`0` | `<sPRV>` | Irregular rhythm detected |

Derived from pulse-rate variability during the suprasystolic capture, not
reported directly by the device as a yes/no. Left **blank** when the device did
not report `sPRV` — blank means "not assessed", which is different from "no", and
collapsing the two would be a claim the device never made.

This is a radio, so the module *clicks* the option (`opt-<field>_1` / `_0`).
Setting `.value` on a REDCap radio group records nothing.

## Provenance

| Field | Type | From | |
|---|---|---|---|
| `<p>datetime` | `datetime_seconds_ymd` | `MeasDataLogger@datetime` | When the device says it measured |
| `<p>guid` | text | `MeasDataLogger@guid` | Identifies this measurement |
| `<p>device_id` | text | `MeasDataLogger@device_id` | Which physical device |

**`<p>datetime` is the device's clock, and that is the point.** A REDCap survey
timestamp says when the form was saved, which can be minutes or days later.
Nothing else in the record says when the measurement was really taken, which is
why the module checks the device clock against the computer's before every
measurement and sets it when it has drifted.

The device writes ISO 8601 with no zone (`2026-03-20T03:10:52`). REDCap wants a
space where the `T` is and rejects the `T` outright, so the module changes the
separator and nothing else — no reparsing into a `Date`, which would put the
browser's timezone between the device and the record.

**`<p>device_id`** is worth keeping even in a single-device study. It costs one
field and it is what lets a systematic offset be traced to a device rather than
to a cohort.

## Study control

| Field | Type | |
|---|---|---|
| `<p>status` | text | Set to `complete` by the module when a reading is stored |

Useful in branching logic, and in a report of the records still to be measured.
It is a plain text field rather than REDCap's form-completion status because the
two answer different questions: a form can be marked complete by a person who
typed nothing.

## The result file

| Field | Type | |
|---|---|---|
| `<p>xml` | File Upload | The device's own result XML |
| `<p>xml_text` | text | A marker saying the recording is held — or the reduced recording |

Written by the server, not the page. Around 80 kB for a single measurement and
past 120 kB for a three-determination AOBP result, because of the base64 pressure
recordings — either way more than a REDCap text field holds.

**Keep it.** It holds every value above, the device's own account of the
measurement including alerts the module chose not to store, the firmware version
that produced it, and the raw cuff-pressure trace. It is the only artefact that
can answer a question about a reading that nobody thought to ask at the time.

`<p>xml_text` is **not a second copy of it**. With file storage on it holds a
marker — `held bytes=79884 sha256=… field=…`, or `not-held … reason=…` when the
server could not take it. That second case is the reason the field exists:
without it, a record whose recording was lost reads exactly like one where none
was ever taken, and the byte count and hash are what identify the file if it
turns up elsewhere.

It says **held**, not stored, because that is what is true when the page writes
it. The recording is filed onto the record by `redcap_save_record()` when the
form is **saved**, and no JavaScript is running by then — see the module README
for why filing during the measurement destroys the file. The project log is what
records the filing itself.

With file storage **off** the field holds the recording itself, reduced by the
SDK's `minimalXml()`. A text field takes 65,535 bytes and a result is larger, so
the choice was never whole-or-reduced but reduced-or-truncated, and a document
cut off mid-element is worth nothing. The reduction keeps the suprasystolic and
cuff recordings and every determination's readings, timestamp, alert and motion
flag, and drops what recomputes from them.

---

## What is deliberately not stored

**Device alerts.** An alert needs the determination it sits on to mean anything:
the same text is a warning on a reading that succeeded and an error on one that
did not, because the NIBP module retries and leaves the failed attempt's alert in
place. A field holding one without that context asks a researcher to invent rules
for reading it. They are shown to the operator, and the XML holds them properly.

**The signal quality band.** See `<p>snr` above — the number is stored, the
interpretation is not.

**Individual readings of a multi-reading protocol.** An AOBP average is three
determinations; the fields hold the average. Each reading is in the XML, and
`measurement.readings` exposes them if a study wants them in fields of their own.
