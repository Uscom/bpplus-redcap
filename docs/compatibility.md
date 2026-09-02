# Compatibility

Which module version goes with which SDK, Terminal API and BP+ firmware.

A long study should record the whole row, not just the module version — the
module version alone does not identify the code that talked to the device.

---

## Modules

| Module | Version | SDK | Terminal API | BP+ software | REDCap framework |
|---|---|---|---|---|---|
| `bpplus_data_capture` | 1.1.0 | 1.2.1 (`v1.2.1`) | 2.4 | 5.3.0.0 series | 15 |

The SDK column names the tag a copy is pinned to. The authoritative statement for
an installed copy is its own `sdk/SDK-VERSION.json`, which records the tag, the
upstream repository and a hash of the folder. This table is a summary and can
fall behind; that file cannot, because the smoke test fails when it disagrees
with the SDK beside it.

## What each layer is

**Module version** — what REDCap installed. Changes when fields, settings or
requirements change.

**SDK version** — the code that speaks to the device, from
[bpplus-js-sdk](https://github.com/uscom/bpplus-js-sdk). A module takes a new SDK
by re-vendoring it, which is a module release; the SDK never changes underneath
an installed module. `sdk/SDK-VERSION.json` names the exact commit, so a
question about a measurement can be taken back to the code that took it.

**Terminal API version** — the command set the device answers, reported by the
device itself in reply to `?`. The SDK declares which version it was written
against as `TERMINAL_API_VERSION`.

**BP+ software version** — the application firmware, reported in the feature
list and recorded in every result XML.

## What actually breaks

Most combinations simply work, because the Terminal API is additive in practice.
The failures that matter:

| Symptom | Cause |
|---|---|
| `F 14` on a parameter the module sends | Device firmware predates that command parameter |
| The device does not report a measurement mode | Feature list older than 3.0 |
| No answer to `?` | Very old firmware; the SDK treats the API version as unknown rather than as too old |

A device that reports a version string the SDK cannot parse is treated as
**cannot tell**, not as too old. Refusing to measure over an unparsable version
string would be the worse failure — it takes a working device out of service on
the strength of a string.

## Browsers

| | Web Serial | WebUSB | Works |
|---|---|---|---|
| Chrome / Edge, desktop | yes | yes | yes, over Web Serial |
| Chrome, Android | reports yes, but see below | yes | yes, over **WebUSB** |
| Firefox, any | no | no | no |
| Safari, any | no | no | no |
| Anything on iOS | no | no | no |

On Android, Web Serial exists but enumerates Bluetooth SPP devices rather than
the cable. The SDK chooses WebUSB there for that reason, and the cable must be a
Prolific PL2303 because that is the only driver the SDK ships. See
[troubleshooting.md](troubleshooting.md) for the measurements.

Every route needs a **secure context** — HTTPS or `localhost`. There is no
exception and no flag.
