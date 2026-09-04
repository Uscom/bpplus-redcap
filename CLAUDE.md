# Working in this repository

REDCap external modules and supporting artefacts for the Uscom BP+. Everything
here is an example meant to be copied and edited by researchers, which shapes
most of the decisions below.

## Layout, and why

```
modules/<prefix>/        each folder is EXACTLY what ships to a REDCap server
instruments/             data dictionary + the descriptive-field markup
demo-project/            a whole REDCap project as an ODM XML file
docs/                    installing, versioning, compatibility, troubleshooting
tools/                   generators; the SDK sync
index.html               GitHub Pages landing -> links into each module's harness
```

A module folder is never rearranged on the way into a release ZIP. `config.json`
sits at its root, and the ZIP contains one top-level folder named
`<prefix>_v<version>`, which is what REDCap requires. That property is also what
would make splitting a module into its own repository a `git subtree split` and
nothing else — do not break it with a build step.

## Things that will bite

**The module prefix is permanent.** REDCap keys every project setting to it.
Renaming orphans them all. Three things must agree: the directory name,
`config.json`'s `namespace`, and `<LastNamespaceSegment>.php` containing a class
of the same name. CI checks this.

**`sdk/` is vendored, never edited in place.** REDCap serves only a module's own
directory, so the copy must be physically present. `tools/sync-sdk.ps1` replaces
it and writes `sdk/SDK-VERSION.json`; `-Verify` and `test/smoke.mjs` both fail
when it has been edited. The hash algorithm is duplicated in PowerShell and in
JavaScript and **must stay identical** — ordinal path sort, LF-normalised
content, `"path hash\n"` lines. Culture-aware sorting orders
`usb-serial.js` before `usb-serial-drivers.js`; ordinal does the opposite.

**Generated files are committed, and CI checks they are current.**
`instruments/bpplus_measurement/DataDictionary.csv` and
`demo-project/BPplusDemo.REDCap.xml` both come from `tools/build-instrument.mjs`.
Edit the tool, not the output.

**A REDCap data dictionary is ASCII, LF, with a UTF-8 BOM, and its HTML is on
one line.** All four match REDCap's own export, checked against a real one. The
generator refuses to write a non-ASCII character; a curly apostrophe becomes
mojibake in someone else's Excel and nothing about that is visible from here.

**The device timestamp is ISO 8601 with no zone** (`2026-03-20T03:10:52`) in the
result XML — confirmed against a real device file, not the simulator. REDCap
wants a space where the `T` is. Change the separator and nothing else: reparsing
through a `Date` would put the browser's timezone between the device and the
record. `parseTimestamp()` in the SDK is for the 14-digit **clock** format, which
is a different thing.

## Testing

```bash
npm install --no-save jsdom
node modules/bpplus_data_capture/test/smoke.mjs   # module starts; instrument matches; SDK unedited
node tools/build-instrument.mjs                   # then git diff must be empty
php -l modules/bpplus_data_capture/*.php
php modules/bpplus_data_capture/test/guards.php   # what save-xml refuses
```

For anything touching the page controller, run the harness rather than reasoning
about it:

```bash
python -m http.server 8080
# http://localhost:8080/modules/bpplus_data_capture/test/harness.html
```

Served from the repository root it fetches the shipped instrument markup, so what
runs is what a project gets. The simulator covers the failure paths — a result
with no blood pressure in it, a device error, a cancel — which are hard to
produce on purpose with real hardware and are exactly where the interesting bugs
are.

## House style

Comments explain **why**, especially where the obvious thing is wrong: the `null`
port filter (a vendor-id filter matches nothing on Android with a working
cable), the Android transport order (Web Serial there enumerates Bluetooth, not
the cable), the timestamp separator. Those are load-bearing — each records a
measurement or a failure that cost something to find. Do not compress them away.

Prose in documentation and in commit messages is plain and direct. No
exclamation marks, no "simply", no marketing.
