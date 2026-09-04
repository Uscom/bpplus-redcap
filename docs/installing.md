# Installing

Two people are usually involved. The split matters, because a project owner
waiting on an administrator for something they could do themselves is the most
common way this stalls.

| | Who |
|---|---|
| Putting the module on the server | REDCap administrator |
| Enabling it for a project | Administrator, or a project owner where the site allows it |
| Adding the instrument | Project owner |
| The module's project settings | Project owner |

---

## 1. Put the module on the server

Copy `modules/bpplus_data_capture/` into REDCap's `modules/` directory, renamed
to include the version:

```
redcap/modules/bpplus_data_capture_v1.3.1/
    config.json
    BpPlusDataCapture.php
    js/
    sdk/
```

REDCap takes the version from the directory name, so the folder name and
`config.json`'s `version` must agree. Nothing warns you when they don't.

The whole folder is needed, `sdk/` included. REDCap serves only a module's own
directory, so an SDK left behind is a Connect button that does nothing.

Where a release has been published, the same folder is available as
`bpplus_data_capture_v<version>.zip` on the
[releases page](https://github.com/uscom/bpplus-redcap/releases), for
**Control Center → External Modules → Upload module ZIP**. The ZIP contains one
folder, already named correctly.

## 2. Enable it on the project

**Control Center → External Modules**, or the project's own **External Modules**
page. Enable the version you intend to use and leave it there — see
[versioning.md](versioning.md).

## 3. Add the instrument

If the project has no BP+ instrument yet, see
[`instruments/bpplus_measurement/`](../instruments/bpplus_measurement/), or
start from [`demo-project/`](../demo-project/) if the project itself does not
exist yet.

## 4. Set the project settings

At minimum, the instrument name if it is not `bpplus_measurement`. To keep the
device's result file, add a **File Upload** field named `<prefix>xml` and tick
**Store the raw measurement XML as a file**.

---

## Before the first participant

**Check HTTPS.** The browser refuses `navigator.serial` and `navigator.usb` on
an insecure origin, and the failure is a picker that never appears rather than an
error message. A REDCap on plain HTTP cannot run this module at all.

**Check the browser.** Chrome or Edge. Firefox and Safari implement none of the
device APIs, and neither does anything on iOS — including Chrome on iOS, which is
Safari underneath.

**Take a measurement on a test record.** Watch the browser console (F12). The
module reports the device it found, the transport it chose, and any field the
instrument is missing. Every one of those is easier to read there than to deduce
from a page that quietly did nothing.

**Try the harness first if any of this is uncertain.** It runs the same code
outside REDCap and needs no installation:
<https://uscom.github.io/bpplus-redcap/>

---

## Upgrading

Install the new version alongside the old one and move projects onto it
deliberately. Do not delete the old version while any project still uses it: the
directory *is* the installed module, and removing it breaks every project pinned
to it.

Read the module's `CHANGELOG.md` before moving a project that is collecting data.

---

## Uninstalling

Disable the module on the project first, then remove the directory. The data
stays: every value the module wrote is an ordinary REDCap field, and the XML
files are ordinary uploaded files. Nothing about the record depends on the module
still being installed, which is deliberate — a study's data should not need the
tool that collected it.
