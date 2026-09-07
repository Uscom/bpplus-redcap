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
| `<p>pr` | integer, 30–240 | `<Pr>` | Pulse rate, bpm |

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
| `<p>csys` | integer, 37–283 | `<cSys>` | Central systolic, mmHg |
| `<p>cdia` | integer, 17–203 | `<cDia>` | Central diastolic, mmHg |
| `<p>cmap` | integer, 22–248 | `<cMap>` | Central mean arterial pressure, mmHg |
| `<p>sai` | number, 0–500 | `<sAI>` | Suprasystolic augmentation index, % |
| `<p>snr` | number, 0–100 | `<SNR>` | Signal-to-noise ratio, dB |
| `<p>spr` | integer, 30–240 | `<sPR>` | Pulse rate from the suprasystolic capture, bpm |
| `<p>sppv` | number, 0–100 | `<sPPV>` | Pulse pressure variation, % |
| `<p>ssep` | number, 50–1000 | `<sSEP>` | Systolic ejection period, ms |

`sAI` is **always positive and has no ceiling at 100 %**. Its denominator is the
incident wave amplitude, not the pulse pressure, so a small incident wave sends
the ratio up without limit. `sAIx` is the measure that can go negative — a type C
waveform gives an `sAI` below 100 % while `sAIx` is below zero. They are
different quantities and this instrument stores the first.

`<p>spr` and `<p>pr` are different measurements and this is exactly why the
field names follow the XML. `<Pr>` is the pulse rate from the cuff
determination; `<sPR>` is the rate from the suprasystolic capture. They agree
often and not always, and a field called `hr` would have hidden which one it was.

### Where the ranges come from

Every range here is the **rated** range for that measure, from
`bpplus-measures-kb` — one file per measure, under
`D:\BPplus\Specifications\BPplus\bpplus-measures-kb\measures`. The knowledge
base defines four different ranges and says the rated one governs display: it is
the span the device is *validated* over, narrower than the measurement range the
sensor can physically reach and unrelated to any clinical or normal range.

The central pressures are the brachial ones **widened by 3 mmHg at each end** —
37–283 against 40–280, and so on. That is recorded in the knowledge base, not
derived here, and it is why they cannot simply be copied from the brachial
fields.

Do not narrow a range to look sensible. REDCap's check is *soft*, so an
out-of-range value still saves, but the operator is asked to confirm a reading
that was never in doubt — and an operator taught to dismiss that prompt will
dismiss the one that matters.

`sAI`, `SNR`, `sPRV`, `sPPV` and `sSEP` are marked **provisional** in the
knowledge base, from a draft RS:CALCS revision. Re-check them when `@p` is
released.

`<p>snr` stores the **raw dB and not the quality band**. The label ("Excellent",
"Poor") is an interpretation of this number and can be recomputed from it at any
time; a band whose thresholds moved later would leave a stored label wrong, with
nothing in the record to check it against.

The SDK exposes more indices than these — `sPP`, `sRWTTFoot`, `sRWTTPeak`,
`sDpDtMax` — through `measurement.indices`. They are not in the
example instrument because most studies do not use them, and they are all in the
retained XML for the ones that do. Add fields and extend `storeResult()` if you
need them.

## Rhythm

| Field | Type | From | |
|---|---|---|---|
| `<p>sprv` | number, ms | `<sPRV>` | Pulse-rate variability |

`sPRV` is the RMSSD of the beat intervals during the suprasystolic capture. The
**measured number** is stored, and nothing here judges it.

Whether that counts as an irregular rhythm is a screening question with a
threshold in it. A stored yes/no could not be rechecked if the threshold moved,
and the number can always be re-judged — the same reason `<p>snr` holds the raw
dB rather than its quality band.

Left **blank** when the device did not report `sPRV`. Blank means "not measured",
which is different from any value, and collapsing the two would be a claim the
device never made.

There is **no range** on this field. The device declares none for `sPRV`, and a
range narrower than what it can produce turns a real reading into a REDCap error
the operator has no way to resolve.

The result also carries `<IrregularHeartBeat>` and `<MotionDetected>`, which the
SDK does not read and this instrument does not store. Both are in the retained
XML for a study that wants them.

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
marker — `saved bytes=79884 sha256=… field=… doc=11135 …`. The `doc=` is what
ties the row to the document in an export, where the file itself is a separate
download.

The recording is filed the moment the device produces it, and the page then
writes that document id into the form so the next submit cannot clear it — see
the module README for why a submit would otherwise destroy the file it had just
filed.

With file storage **off**, or when filing failed, the field holds the recording
itself, reduced by the SDK's `minimalXml()`. A value beginning with `<` is a
recording; anything else is a marker. The failure case is why the field is worth
having: there is no retry, so a misconfigured file field costs detail rather
than the recording, and the module's own log holds the reason.

A text field takes 65,535 bytes and a result is larger, so the choice was never
whole-or-reduced but reduced-or-truncated, and a document cut off mid-element is
worth nothing. The reduction keeps the suprasystolic and
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
