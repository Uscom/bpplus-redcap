# Versioning, and studies that run for years

The concern this page answers: *a study collecting data for five years cannot
have its measurement code change underneath it, and cannot be forced onto a new
version because someone else wanted a feature.*

It doesn't have to be. REDCap already solves this, and the solution is not what
people usually reach for first.

---

## The short version

**Install a version, pin the project to it, and stop.** Versions of an external
module install side by side, and a project uses the one it was pinned to. A
module released next year does not touch a project that was never moved onto it.

That is the whole mechanism. Nothing below is required reading unless you want
to know why the alternatives are worse.

> Confirm the per-project version pin on your own installation before you rely
> on it for a long study — where the control lives has moved between REDCap
> versions, and it is worth an administrator spending five minutes on it once
> rather than a study discovering it later.

---

## Why not a module per firmware version

The instinct is reasonable: BP+ application firmware changes, so surely the
module tied to it should be frozen alongside. It is still the wrong tool, for
three reasons.

**REDCap already pins versions.** Freezing is what the version pin does, and it
does it per project rather than per installation, which is what a site running
two studies at once actually needs.

**A prefix is forever.** REDCap keys every project setting to the module prefix.
`bpplus_data_capture_fw53` and `bpplus_data_capture_fw54` are two different
modules that share no settings, so moving a project between them means
re-entering everything and losing the audit trail that connected them.

**The bugs are shared.** A fault found in one firmware-specific fork is a fault
in all of them, and fixing it *n* times is how *n−1* of them stay broken.

## What replaces it

**Semantic versioning, honestly applied.** A change to which fields are written,
what a setting means, or what the module requires of a device is a major
version. Everything else is not. See the module's own `CHANGELOG.md`.

**A device that says what it can do.** The module reads the feature list at
connect, before any participant is involved, and reports a device that cannot do
what the project asks — rather than discovering it mid-measurement. That is why
`Require the device to be in a particular measurement mode` is a setting and not
a fork.

**A published compatibility matrix.** [compatibility.md](compatibility.md) says
which module version goes with which SDK, Terminal API and firmware series.

**A new transport is not a new module.** WebUSB, and whatever follows it, lives
in the SDK. A module consuming the SDK gets it by taking a new SDK pin, and a
module that never takes one never changes.

---

## What a long study should actually do

1. **Pin the module version, and write the number down** — in the protocol, not
   only in REDCap. Include the SDK version from `sdk/SDK-VERSION.json`; the
   module version alone does not identify the code that talked to the device.
2. **Keep the raw XML.** It is the one artefact that outlives every version
   question: it holds the values, the device's own account of the measurement,
   and the cuff trace. A field parsed by a version you no longer have can still
   be re-derived from it.
3. **Record the device software version.** `<p>device_id` says which device;
   the XML says what firmware it was running. Between them, a reading is
   reproducible.
4. **Take a new version deliberately, at a boundary.** Between waves, between
   sites, at an ethics amendment — not in the middle of recruitment because a
   patch looked harmless.

---

## Version numbers here

Each module carries its own version in its own `config.json`, and they move
independently — the data-capture module reaching 2.0.0 says nothing about the
device-management one.

Releases are tagged `<prefix>-v<version>`:

```
bpplus_data_capture-v1.0.0
bpplus_device_manager-v0.2.0
```

The release workflow refuses a tag whose version does not match the module's
`config.json`, because a ZIP whose contents disagree with its name is the one
mistake that reaches a production REDCap and stays there.

If a module is later split into its own repository, the tag simply becomes
`v1.0.0` and nothing else about it changes. That possibility is why each module
folder is exactly what ships, with `config.json` at its root and no build step
that rearranges anything.
