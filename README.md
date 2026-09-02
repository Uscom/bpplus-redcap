# BP+ in REDCap

REDCap external modules and supporting artefacts for the **Uscom BP+**, a
suprasystolic blood-pressure device that reports central as well as brachial
pressures.

Everything here is an **example**. It is written to be copied, edited and made
your own — a study that forks it and changes the field names is using it
correctly. Nothing in it is specific to one site.

---

## Try it before installing anything

The measurement happens entirely in the browser, so the module's own page code
runs outside REDCap. The test harness reproduces the instrument, loads the
module unmodified, and shows every field as REDCap would save it:

**<https://uscom.github.io/bpplus-redcap/>**

Choose **Simulator** and it needs no device at all. Choose **Real BP+** and it
drives one over the cable, from Chrome or Edge on a desktop or an Android
tablet.

That page is the honest way to answer "will this work for my study" before
asking a REDCap administrator for anything.

---

## What is here

| | |
|---|---|
| [`modules/bpplus_data_capture/`](modules/bpplus_data_capture/) | Takes a measurement from the device into a record, and keeps the device's result XML as a file |
| [`instruments/bpplus_measurement/`](instruments/bpplus_measurement/) | The data dictionary for the instrument the module drives |
| [`demo-project/`](demo-project/) | A whole REDCap project as an XML file — a working example from nothing |
| [`docs/`](docs/) | Installing, versioning, the compatibility matrix, and what goes wrong |
| [`tools/`](tools/) | Regenerates the instrument artefacts; syncs the vendored SDK |

More modules will follow. Device management — checking and setting a device's
operating mode, updating firmware, technical diagnostics — is deliberately *not*
part of the data-capture module: it is a different audience, a different set of
REDCap hooks, and firmware-update code has no business loading on a page a
participant can see.

---

## How a measurement reaches a record

The BP+ is on the **operator's** cable, not on the server. Nothing about the
measurement can happen in PHP.

```
  BP+  ──cable──▶  browser                        REDCap server
                   │                                    │
                   │  sdk/          the wire protocol    │
                   │  js/           which fields to fill │
                   ▼                                     │
              the instrument's fields ────on save───────▶│
                   │                                     │
                   └──── the result XML, as a file ─────▶│
```

The **SDK owns the device** — framing, checksums, result codes, timeouts,
transports. The **module owns REDCap** — which fields, which buttons, what the
operator is told. That line is why a new transport (WebUSB today, whatever
follows) lands in the SDK and changes no module, and why a study that wants
different fields edits one file.

---

## Requirements

| | |
|---|---|
| REDCap | External Modules framework version 15 |
| Browser | **Chrome or Edge.** Firefox and Safari implement none of the device APIs, and neither does anything on iOS |
| Page | **HTTPS.** The browser refuses device access on an insecure origin |
| Device | A Uscom BP+ on a USB cable |

Desktop and Android tablets both work, by different routes — WebSerial on the
desktop, WebUSB on Android, chosen by the SDK rather than by the module. On
Android the cable must be a Prolific PL2303, because that is the only driver the
SDK ships; on a desktop the operating system supplies the driver and any adapter
works. See [docs/troubleshooting.md](docs/troubleshooting.md), which has the
measurements behind that.

---

## Getting started

- **I want to see what it does** — [the harness](https://uscom.github.io/bpplus-redcap/), no installation.
- **I want a working project** — [demo-project/](demo-project/), one XML upload.
- **I have a project already** — [instruments/bpplus_measurement/](instruments/bpplus_measurement/).
- **I am the REDCap administrator** — [docs/installing.md](docs/installing.md).
- **My study runs for years** — [docs/versioning.md](docs/versioning.md). Short
  version: install a version and pin the project to it. Nothing forces you
  forward.

---

## The SDK

`modules/*/sdk/` is a **vendored copy** of
[bpplus-js-sdk](https://github.com/uscom/bpplus-js-sdk), pinned by
`sdk/SDK-VERSION.json` — which records the upstream commit and a hash of the
folder. REDCap serves only a module's own directory, so the copy has to be
physically there; a submodule or an npm dependency changes where it comes from,
not whether it is present.

Do not edit `sdk/` in place. `tools/sync-sdk.ps1` replaces the folder and
rewrites the provenance. An edit made in one copy and nowhere else is invisible
until it is expensive: two copies of this SDK have already drifted that way
while both reported `SDK_VERSION 1.0.0`.

---

## Contributing, and forking

Forking is the expected use. See [CONTRIBUTING.md](CONTRIBUTING.md) for what to
change when you do, and what to leave alone — chiefly the module prefix, which
REDCap keys every project setting to and which cannot be renamed later without
orphaning them.

## Licence

MIT — see [LICENSE](LICENSE). Copy it, change it, ship it.

## Acknowledgement

The instrument design and operator flow this work follows began with **Oliver
Stanesby**, Menzies Institute for Medical Research, University of Tasmania, who
first brought the BP+ into a REDCap survey.
