# Getting started

Four routes in, depending on where you already are. They get progressively more
committed; there is no need to start at the top.

---

## 1. See what it does — 2 minutes, nothing installed

<https://uscom.github.io/bpplus-redcap/>

Open it in Chrome or Edge, choose **Simulator**, press **Connect BP+** and then
**Measure**. The page shows every REDCap field as the module fills it, the
decoded cuff-pressure trace, and the serial conversation line by line.

With a BP+ on the cable, choose **Real BP+** instead and the same page drives it.

This is the module's own code, unmodified — not a mock-up of it.

## 2. A working project — 15 minutes

The project XML imports cleanly on REDCap 15 and arrives with the measurement
instrument repeating and record autonumbering on, so a participant can be
measured more than once without any setup.

You need a REDCap you can create a project on, and an administrator to install
the module once.

1. **Create a New Project → Upload a REDCap project XML file**, and give it
   [`demo-project/BPplusDemo.REDCap.xml`](../demo-project/).
2. Have an administrator install and enable **BP+ Data Capture** on it
   ([installing.md](installing.md)).
3. Open **BP+ measurement** on any record. Press **Connect BP+**, then
   **Measure**.

[`demo-project/README.md`](../demo-project/) has the same list with the things
that go wrong.

## 3. Add it to a project you already have

Your project has a record ID, its own instruments and possibly its own
conventions. What you want is the instrument, not the project:
[`instruments/bpplus_measurement/`](../instruments/bpplus_measurement/).

Read that page before importing anything — REDCap's data dictionary import
**replaces** the whole dictionary rather than adding to it, which is the one
mistake in this whole process that loses work.

## 4. Make it yours

Forking is the expected use, not a fallback. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for what to change and what to leave alone
— chiefly the module prefix, which REDCap keys every project setting to and which
cannot be renamed later without orphaning them.

---

## Before you commit to it

Three things decide whether this can work at your site at all, and all three are
outside the module:

**Is REDCap on HTTPS?** The browser refuses device access on an insecure origin.
There is no flag and no exception.

**Will the machines be Chrome or Edge?** Firefox and Safari implement none of the
device APIs, and neither does anything on iOS.

**Who installs external modules?** At many sites this is a request with a queue
attached. Worth finding out early — it is usually the longest lead time in the
whole exercise, and the harness lets everything else proceed while you wait.

## The one thing worth deciding early

**Keep the raw XML.** It needs a File Upload field and one setting, and it is the
only artefact that outlives every later question about a reading: it holds every
value in the record, the device's own account of the measurement, and the
cuff-pressure trace. Adding it at the start costs nothing; adding it after a year
of data collection leaves that year without it.
