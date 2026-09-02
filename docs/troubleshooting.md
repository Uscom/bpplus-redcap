# When it doesn't work

Open the browser console first (**F12 → Console**). The module reports the device
it found, the transport it chose, and every field the instrument is missing.
Most of what follows is faster to read there than to deduce from a page that
quietly did nothing.

---

## The buttons do nothing, and there is no error

The module finds its controls by id and returns silently when they are absent —
because REDCap runs every enabled module's hook on every page, and a module that
complained about not being on its own instrument would complain constantly.

Check, in order:

1. **Is the instrument name right?** The **Instrument that carries the BP+
   controls** setting must be the *unique instrument name* (`bpplus_measurement`),
   not its label ("BP+ measurement").
2. **Are the element ids intact?** Open the descriptive field in the Online
   Designer and confirm `id="bpplus-connect"` and the rest survived editing.
   REDCap's rich-text editor will strip attributes it does not recognise —
   [`instrument.html`](../instruments/bpplus_measurement/instrument.html) is the
   reference copy.
3. **Is the module enabled on *this* project?**

## The port picker never appears

Almost always the secure-context rule. The device APIs are unavailable on
anything but HTTPS or `localhost`, and the failure mode is nothing happening
rather than an error.

The harness prints what the browser actually has:

```
This browser: Web Serial yes - WebUSB yes - Bluetooth yes
```

If that line says **not a secure context**, no amount of module configuration
will help.

Firefox and Safari implement none of these APIs. Neither does anything on iOS,
Chrome for iOS included — it is Safari underneath.

## The picker appears but is empty

**On a desktop**, the cable is not enumerating. Check Device Manager for a COM
port; if there isn't one, it is a driver or cable problem, not a REDCap one.

**On an Android tablet**, see below — the picker you are looking at is probably
the wrong one.

---

## Android: WebSerial is there, and is not the cable

Chrome on Android reports `navigator.serial`, so feature detection alone
concludes Web Serial is available. It is — but **its port list is not the USB
cable.** It enumerates Bluetooth SPP devices. Measured on Chrome
`151.0.7922.173`, same build on both:

| Device | The WebSerial picker shows | Actually works over |
|---|---|---|
| Galaxy S23 Ultra | paired Bluetooth devices — car kits, headsets — no cable | WebUSB only |
| Galaxy Tab S10 FE | the cable, but with no USB vendor id | WebUSB, and unfiltered WebSerial |

The SDK handles this: `recommendedTransport()` checks Android **before**
WebSerial rather than after it, so on Android the cable goes through WebUSB
whatever WebSerial claims. No module carries platform logic of its own — they
call `recommendedTransport()` and follow the answer.

Two consequences worth knowing before changing anything:

**Desktop-site mode.** Chrome's "Desktop site" — the default on some Samsung
tablets — reports `platform: "Linux"`, so a check on `userAgentData.platform`
alone concludes a tablet is a desktop. `uaData.mobile` is `false` on both
tablets above and is *not* a bug: UA-CH `mobile` means phone-shaped, and a tablet
is correctly not mobile. Any rule built on it fails on exactly the device that
has to work. The last resort is a touch test — a touch screen with no fine
pointer — which is why a touch laptop, reporting a fine pointer as well,
correctly stays on WebSerial.

**Port filters are `null`, deliberately.** A `requestPort()` filter on the
Prolific vendor id matches nothing on Android even with a genuine PL2303GT
(`0x067B:0x23A3`) attached and working, because the ports on offer are not USB
ports and carry no USB ids. The picker then says "No compatible device found",
which reads as a broken cable. **Do not "tighten" this.**

Because WebUSB drives the adapter chip directly, the cable on Android must be a
**Prolific PL2303** — that is the only driver the SDK ships. On a desktop the
operating system supplies the driver, so any adapter works.

---

## "The device is not in the mode this project needs"

The device's measurement mode decides what it will accept. The module reads it at
connect, before a participant is involved, and refuses rather than discovering it
mid-measurement.

Change the mode on the device, or clear the **Require the device to be in a
particular measurement mode** setting if the protocol does not actually depend on
it.

## A warning on a measurement that plainly worked

Expected, and not a fault. The NIBP module inside the device retries a
determination it could not finish, and when a later attempt succeeds it records
the good values while leaving the failed attempt's alert in place. The module
shows that as amber — recovered — rather than red.

It is worth noticing over time: a participant needing two attempts every visit,
or a cuff failing intermittently, is a real signal.

## The measurement "succeeded" but the fields are empty

It didn't succeed. A result block is not the same as a measurement: when the cuff
cannot be inflated the device ends the request and returns a result with no blood
pressure in it, which arrives looking like an answer.

The SDK rejects that against the device's own declared ranges before it reaches
the fields, and the status line says what went wrong. **Check the hose for a
kink** — that is the ordinary cause.

## The XML was not stored

Console will say which of these it was:

- **"Storing the XML as a file is not enabled for this project"** — tick the
  setting.
- **"REDCap::saveFile did not store the file"** — the `<prefix>xml` field does
  not exist, or is not a **File Upload** field.
- **"the External Modules AJAX helper is not on this page"** — the page is the
  harness, or something has replaced REDCap's own JavaScript.

The measurement itself is unaffected either way: the fields are filled before
the file is attempted.

## The timestamp field is flagged invalid

The module reformats the device's ISO timestamp for REDCap. If the field is
rejecting the value, check that `<p>datetime` has validation
**`datetime_seconds_ymd`** — a field validated as `datetime_ymd` (no seconds)
will reject a value that has them.

---

## Getting help

Include, in this order: the browser console output, the module version, the SDK
version from `sdk/SDK-VERSION.json`, the device's software version (the
`#bpplus-device-info` panel, or the harness, shows it), and what the harness says
about the browser. Between them they identify every moving part.
