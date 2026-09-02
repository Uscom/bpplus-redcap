/**
 * BP+ Data Capture — the page controller.
 *
 * A consumer of the BP+ SDK in `../sdk/`. Everything to do with the wire
 * protocol — framing, checksums, result codes, timeouts — lives there. What is
 * left here is the part a study owns: which REDCap fields to fill, which
 * buttons drive it, and what the operator is told.
 *
 * The DOM contract. Only the first three are required; the module works with
 * whatever else the instrument happens to provide, so one instrument can be
 * plain and another can carry the technical panels without a setting to say so.
 *
 *   #bpplus-connect       opens the browser's device picker
 *   #bpplus-measure       takes one measurement
 *   #bpplus-status        the single large status line
 *   #bpplus-cancel        optional; live only while the cuff is inflating
 *   #bpplus-ping          optional; confirms the link is live
 *   #bpplus-results       optional; the reading, shown to the operator
 *   #bpplus-alerts        optional; what the device said was wrong, in its words
 *   #bpplus-device-info   optional; versions and mode, for a technical reader
 *
 * and the fields it fills, all built from the project's prefix (`bpplus_` by
 * default) so that renaming them is a setting rather than an edit:
 *
 *   <p>sys <p>dia <p>map <p>hr        brachial pressures and pulse rate
 *   <p>csys <p>cdia                   central pressures — what a BP+ is for
 *   <p>ai <p>snr                      augmentation index, signal-to-noise ratio
 *   <p>irregular                      radio: irregular rhythm, 1/0
 *   <p>datetime <p>guid <p>device_id  provenance, from the device
 *   <p>status                         set to `complete` when a reading is stored
 *   <p>xml                            File Upload; written by the server
 *   <p>xml_text                       optional; a marker, or the reduced XML
 *
 * Loaded as a classic script, because REDCap includes it with a plain
 * <script src>. The SDK is ES modules, so it is brought in with a dynamic
 * import() at connect time rather than a top-level one.
 */

(function () {
  'use strict';

  // Captured while the script is being parsed. Inside a DOMContentLoaded
  // handler document.currentScript is null, and the SDK has to be located
  // relative to this file when the server has not said where it is.
  var THIS_SCRIPT = document.currentScript ? document.currentScript.src : '';

  var DEFAULT_PREFIX = 'bpplus_';

  // How far the device clock may be out before it is quietly set to this
  // computer's. The measurement timestamp goes into the result XML, so a device
  // whose clock is wrong mislabels data that cannot be corrected afterwards.
  var DEFAULT_CLOCK_TOLERANCE_MINUTES = 5;

  // A serial cable, not the BP+ itself: the device sits behind a USB-to-serial
  // bridge, so the port carries the bridge's identifiers rather than the
  // device's.
  //
  // No filter, deliberately. A filter of [{ usbVendorId: 0x067B }] reads as the
  // safe thing to do and is not: on a Samsung Galaxy Tab S10 FE, with the
  // supplied Prolific PL2303GT plugged in and working, requestPort() filtered on
  // that vendor id matches nothing and the picker says "No compatible device
  // found". The same port opens fine from an unfiltered picker. Unfiltered also
  // keeps a promise a filter breaks: a site with a different adapter is not
  // locked out. Do not tighten this.
  var PORT_FILTERS = null;

  document.addEventListener('DOMContentLoaded', function () {
    start().catch(function (error) {
      console.error('[BP+] failed to start', error);
    });
  });

  async function start() {
    var ui = {
      connect: document.getElementById('bpplus-connect'),
      measure: document.getElementById('bpplus-measure'),
      cancel:  document.getElementById('bpplus-cancel'),
      ping:    document.getElementById('bpplus-ping'),
      status:  document.getElementById('bpplus-status'),
      results: document.getElementById('bpplus-results'),
      alerts:  document.getElementById('bpplus-alerts'),
      info:    document.getElementById('bpplus-device-info'),
    };

    // Not our instrument. REDCap runs every enabled module's hook on every
    // page, so leaving quietly is the normal case rather than a fault.
    if (!ui.connect && !ui.measure) return;

    var sdk = null;             // the imported module namespace
    var device = null;
    var features = null;        // the reply to `f`, read once at connect
    var apiVersion = null;      // the reply to `?`, or null if unreadable
    var lastMeasurement = null;
    var lastClockSync = null;
    var busy = false;           // a measurement is on the arm right now
    var stored = false;         // at least one reading has reached the record

    var fields = fieldNames(config().fieldPrefix || DEFAULT_PREFIX);

    updateButtons();

    // -- Status line ---------------------------------------------------------

    var STATUS_STYLES = {
      ready:   { background: '#f8f9fa', border: '1px solid #dee2e6', color: '#495057' },
      normal:  { background: '#e8f4fd', border: '1px solid #cfe2ff', color: '#000000' },
      success: { background: '#d8f3dc', border: '1px solid #b7e4c7', color: '#2d6a4f' },
      error:   { background: '#fdecea', border: '1px solid #f5c2c0', color: '#b71c1c' },
    };

    function setStatus(kind, message) {
      console.log('[BP+] ' + kind.toUpperCase() + ':', message);
      if (!ui.status) return;

      var style = STATUS_STYLES[kind] || STATUS_STYLES.normal;
      ui.status.style.background = style.background;
      ui.status.style.border     = style.border;
      ui.status.style.color      = style.color;
      ui.status.style.fontSize   = '22px';
      ui.status.style.fontWeight = '600';
      ui.status.style.textAlign  = 'center';
      ui.status.style.padding    = '16px';
      ui.status.style.borderRadius = '10px';
      ui.status.innerText = message;
    }

    // -- REDCap fields -------------------------------------------------------

    function setFieldValue(name, value) {
      if (!name) return false;

      var field = document.querySelector('[name="' + name + '"]');
      if (!field) {
        // Said out loud, once per measurement, because the alternative is a
        // study that quietly discards a value for its whole run. A field this
        // module writes and the instrument does not have is either a renamed
        // field or one never added, and both look identical from here.
        console.warn('[BP+] no field named "' + name + '" on this page — ' +
                     'that value was not recorded. Check the field prefix ' +
                     'setting, or add the field to the instrument.');
        return false;
      }

      field.value = value === null || value === undefined ? '' : String(value);
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    /**
     * REDCap renders a radio as a set of buttons, and only a click on the right
     * one records the choice — setting .value on the group does nothing.
     */
    function setRadio(name, value) {
      var button = document.getElementById('opt-' + name + '_' + value);
      if (button) { button.click(); return true; }

      var input = document.querySelector('[name="' + name + '"][value="' + value + '"]');
      if (input) { input.click(); return true; }

      console.warn('[BP+] could not set radio', name, '=', value);
      return false;
    }

    // -- The device ----------------------------------------------------------

    async function loadSdk() {
      if (sdk) return sdk;
      sdk = await import(sdkUrl());
      return sdk;
    }

    async function connect(options) {
      options = options || {};
      var api = await loadSdk();
      var cfg = config();

      device = new api.BpPlusDevice(makeTransport(api, options), {
        // A measurement started with the device's own button carries no patient
        // ID and belongs to no record. Off by default here — a general-purpose
        // module should not interfere with a device it is only watching — and a
        // study whose every reading must come from this page turns it on.
        hostStartedOnly: !!cfg.hostStartedOnly,
      });

      device.on('warning', function (w) { console.warn('[BP+]', w.message); });

      device.on('deviceStarted', function (event) {
        console.warn('[BP+] measurement started on the device (' + event.mode.name + '); ' +
                     (event.cancelling ? 'cancelling it' : 'watching'));
        setStatus('error', event.cancelling
          ? 'That measurement was started on the BP+ itself and has been stopped. ' +
            'Use the buttons on this page, so the reading is saved against the ' +
            'right participant.'
          : 'Please start the measurement from this page rather than from the BP+, ' +
            'so the reading is saved against the right participant.');
      });

      device.on('log', function (entry) {
        if (config().trace) {
          console.log('[BP+] ' + (entry.dir === 'tx' ? '>' : '<'), entry.text);
        }
      });

      await device.connect();

      // device.connect() only opens the port — it sends nothing and waits for
      // nothing. The feature list is the first thing the device actually says,
      // so it is what proves a BP+ is on the other end at all.
      //
      // Deliberately not caught. Every BP+ answers `f`; silence means the port
      // opened onto something that is not one — the wrong COM port, or a cable
      // with nothing on the end. Reporting that as a connection would hand the
      // operator a green status line and a live button attached to nothing.
      features = await device.readFeatures();

      apiVersion = await device.readApiVersion().catch(function (error) {
        console.warn('[BP+] no Terminal API version:', error.message);
        return null;
      });

      console.log('[BP+] device ' + features.deviceId +
                  ', software ' + features.softwareVersion +
                  ', feature list ' + features.version +
                  ', Terminal API ' + (apiVersion || 'unknown') +
                  ', mode ' + features.measureModeInfo.label);

      showDeviceInfo();

      var shortfall = modeShortfall();
      if (shortfall) throw new Error(shortfall);
    }

    /**
     * Whether the device is in the mode this project requires, or null when the
     * question does not arise.
     *
     * A project that does not set require-mode gets no check at all, which is
     * the right default for an example module: a BP+ in any measuring mode
     * produces a valid reading, and only a protocol that depends on one — an
     * unattended AOBP average, say — can say which.
     */
    function modeShortfall() {
      var want = config().requiredMode;
      if (want === null || want === undefined || want === '') return null;
      if (!features || features.measureMode === null) return null;

      if (Number(features.measureMode) !== Number(want)) {
        return 'This BP+ is in ' + features.measureModeInfo.label + ' mode. ' +
               'This project needs ' + modeLabel(Number(want)) + '. ' +
               'Change the mode on the device, then reconnect.';
      }
      return null;
    }

    function modeLabel(value) {
      try {
        return sdk.describeMeasureMode(value).label;
      } catch (e) {
        return 'mode ' + value;
      }
    }

    /**
     * The transport to talk over, chosen from what this browser can do.
     *
     * A desktop gets Web Serial. An Android tablet reaches the same USB cable
     * through WebUSB instead — the operator sees no difference, and hard-coding
     * Web Serial here would simply refuse to connect on a tablet even though
     * navigator.serial exists there. No platform logic lives in this file: the
     * SDK decides, and the note at the top of sdk/transports/detect.js carries
     * the measurements behind that decision.
     *
     * The BPPLUS_TRANSPORT hook exists so the test harness can run this same
     * code against the SDK simulator with no device attached. REDCap never sets
     * it.
     */
    function makeTransport(api, options) {
      options = options || {};

      // The hook gets the options too. A harness that takes only (api) builds
      // every transport with the picker, so a silent resume is refused for want
      // of a user gesture and reports "nothing to resume" -- the feature looking
      // broken on the bench while working in REDCap, which is the worst way for
      // a test rig to be wrong.
      if (typeof window.BPPLUS_TRANSPORT === 'function') {
        return window.BPPLUS_TRANSPORT(api, options);
      }

      // Into the constructor. Threading it this far and no further is the
      // mistake that makes a resume call requestPort() anyway.
      var silent = options.silent === true;

      var pick = api.recommendedTransport();
      var env = pick.environment;

      // Logged because "it picked the wrong transport" is the first thing to
      // check when a cable that works on a desktop does not work on a tablet.
      console.log('[BP+] transport: ' + pick.kind + ' — ' + pick.reason +
                  ' (android=' + env.android + ' handheld=' + env.handheld +
                  ' webSerial=' + env.webSerial + ')');

      if (pick.kind === api.TransportKind.serial) {
        return new api.WebSerialTransport({ filters: PORT_FILTERS, silent: silent });
      }
      if (pick.kind === api.TransportKind.usbSerial) {
        return new api.UsbSerialTransport({ silent: silent });
      }

      // Bluetooth needs the separate BP+ Bridge, which this module does not
      // use, so anything else is reported rather than half-attempted.
      throw new Error('This browser cannot reach a BP+ on a cable. ' + pick.reason);
    }

    /**
     * The record ID, sent to the device so the measurement identifies itself in
     * its own XML.
     *
     * The device accepts letters, digits and hyphens; a REDCap record ID can
     * hold characters it will refuse, so anything else becomes a hyphen rather
     * than costing an F 14 at the start of a measurement.
     */
    function patientId() {
      var raw = config().record;
      raw = String(raw === undefined || raw === null ? '' : raw);
      return raw.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 64);
    }

    /**
     * Put the device clock right before a measurement, if it has drifted.
     *
     * Silent by design: the operator is mid-visit and the clock is not their
     * problem. A failure is swallowed — a device that will not take a time is
     * still a device that can measure, and refusing to measure over it is the
     * worse outcome for a participant already seated.
     */
    async function syncClock() {
      var minutes = Number(config().clockToleranceMinutes);
      if (!isFinite(minutes) || minutes < 0) minutes = DEFAULT_CLOCK_TOLERANCE_MINUTES;

      try {
        var result = await device.syncTime({ toleranceMs: minutes * 60 * 1000 });
        lastClockSync = result;
        console.log('[BP+] clock: ' + result.reason +
          (result.driftMs === null ? '' : ' (drift ' + Math.round(result.driftMs / 1000) + ' s)'));
        return result;
      } catch (error) {
        console.warn('[BP+] the device clock could not be checked:', error.message);
        lastClockSync = {
          synced: false, driftMs: null, before: null, after: null,
          reason: 'The clock could not be checked: ' + error.message,
        };
        return lastClockSync;
      }
    }

    // -- Results -------------------------------------------------------------

    function storeResult(measurement) {
      var b = measurement.brachial;
      var c = measurement.central;
      var i = measurement.indices;

      setFieldValue(fields.sys, b.sys);
      setFieldValue(fields.dia, b.dia);
      setFieldValue(fields.map, b.map);
      setFieldValue(fields.hr,  b.pr);

      // Central pressure is what distinguishes a BP+ from a cuff, so it is in
      // the example rather than left as an exercise.
      setFieldValue(fields.csys, c.cSys);
      setFieldValue(fields.cdia, c.cDia);
      setFieldValue(fields.ai,   i.sAI);

      // The raw signal-to-noise ratio rather than its band label. The label is
      // an interpretation of this number and can be recomputed; a band that
      // moved later would leave a stored label wrong with nothing to check it
      // against.
      setFieldValue(fields.snr, measurement.signalQuality.snr);

      setFieldValue(fields.datetime,  redcapTimestamp(measurement.timestamp));
      setFieldValue(fields.guid,      measurement.guid);
      setFieldValue(fields.device_id, measurement.deviceId);

      var rhythm = measurement.rhythm;
      if (rhythm.known) setRadio(fields.irregular, rhythm.irregular ? '1' : '0');
    }

    /**
     * The device's timestamp, in the format REDCap validates and exports.
     *
     * The device writes ISO 8601 with no zone into the result XML:
     *
     *     <MeasDataLogger ... datetime="2026-03-20T03:10:52" ...>
     *
     * REDCap's datetime_seconds_ymd wants the same instant with a space where
     * the T is, and rejects the T outright — so a field storing the device's
     * string unchanged is flagged as invalid on every single measurement, and a
     * researcher meets it as a red box they cannot clear.
     *
     * Only the separator changes. Nothing is parsed into a Date and formatted
     * back, because that would put the browser's timezone between the device
     * and the record: the device holds local time and records nothing about
     * where it is, so reinterpreting it can only introduce an offset that was
     * never there.
     *
     * The 14-digit form is the one the `t` command uses for the clock. A result
     * is not known to carry it, but reading it costs nothing and a device that
     * did would otherwise store an unusable number.
     *
     * Anything else is written through unchanged and warned about. A field
     * holding something odd can be investigated; an empty one cannot.
     */
    function redcapTimestamp(stamp) {
      var text = String(stamp === null || stamp === undefined ? '' : stamp).trim();
      if (text === '') return text;

      var iso = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/.exec(text);
      if (iso) return iso[1] + ' ' + iso[2] + (iso[3] || ':00');

      var when = sdk && sdk.parseTimestamp ? sdk.parseTimestamp(text) : null;
      if (when) {
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        return when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate()) +
               ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes()) + ':' + pad(when.getSeconds());
      }

      console.warn('[BP+] the device timestamp "' + text + '" is in no format this ' +
                   'module recognises. It was stored unchanged, and REDCap will ' +
                   'probably reject it.');
      return text;
    }

    function renderResults(measurement) {
      if (!ui.results) return;

      var b = measurement.brachial;
      var c = measurement.central;
      var q = measurement.signalQuality;
      var rhythm = measurement.rhythm;

      var rhythmText = !rhythm.known ? 'not reported'
        : (rhythm.irregular ? 'yes (sPRV ' + rhythm.sPRV + ' ms)' : 'no');

      ui.results.innerHTML =
        '<div style="background:#f4f9ff;border:1px solid #cfe2ff;border-radius:10px;' +
        'padding:20px;text-align:center;margin-top:15px;">' +
          '<div style="font-size:44px;font-weight:700;color:#222;">' +
            escapeHtml(b.sys) + ' / ' + escapeHtml(b.dia) +
          '</div>' +
          '<div style="font-size:17px;color:#666;margin-bottom:14px;">' +
            'mmHg brachial &nbsp;·&nbsp; ' + escapeHtml(b.pr) + ' bpm' +
          '</div>' +
          '<div style="font-size:26px;font-weight:600;color:#0b5394;">' +
            escapeHtml(c.cSys) + ' / ' + escapeHtml(c.cDia) +
          '</div>' +
          '<div style="font-size:17px;color:#666;">mmHg central</div>' +
          '<div style="font-size:15px;color:#666;margin-top:14px;">' +
            'Irregular rhythm: ' + escapeHtml(rhythmText) +
            (q.known ? ' &nbsp;·&nbsp; signal ' + escapeHtml(q.label) +
                       ' (SNR ' + escapeHtml(q.snr) + ')' : '') +
          '</div>' +
        '</div>';
    }

    // Green when the device is reporting a good measurement, amber when it is
    // reporting one it does not fully trust, red for a fault. The panel takes
    // the worst of what it holds.
    var ALERT_STYLES = {
      good:    { background: '#d8f3dc', border: '1px solid #b7e4c7', color: '#2d6a4f' },
      caution: { background: '#fff8e1', border: '1px solid #ffe082', color: '#8a6100' },
      bad:     { background: '#fdecea', border: '1px solid #f5c2c0', color: '#b71c1c' },
    };

    /**
     * Show what the device said, in its own words.
     *
     * The alerts are shown and not stored. An alert needs the determination it
     * sits on to mean anything, and a field holding one without that context
     * asks a researcher to invent rules for reading it. The retained XML holds
     * both properly.
     *
     * Messages only. Each alert also carries the TM2917 hex result, which is the
     * NIBP module's raw reply: it belongs in the console and in a support
     * report, and means nothing to the person holding the cuff.
     */
    function showAlerts(alerts, quality) {
      if (!ui.alerts) return;

      var list = alerts || [];
      if (!list.length && !(quality && quality.known)) {
        ui.alerts.style.display = 'none';
        ui.alerts.innerText = '';
        return;
      }

      var worst = 'good';
      var trouble = [];

      for (var n = 0; n < list.length; n++) {
        var alert = list[n];

        if (alert.severity === 'bad') worst = 'bad';
        else if (alert.severity === 'caution' && worst !== 'bad') worst = 'caution';

        if (alert.severity !== 'good') {
          trouble.push(alert.readings.length
            ? 'BP' + alert.readings.join(' and BP') + ': ' + alert.message
            : alert.message);
        }

        console.warn('[BP+] device alert (' + alert.severity + ')' +
                     (alert.readings.length ? ' BP' + alert.readings.join('/') : '') +
                     ': ' + alert.message +
                     ' [' + (alert.tm2917_hex_result || 'no hex') + ']');
      }

      var summary;
      if (quality && quality.known) {
        if (!quality.usable && worst === 'good') worst = 'caution';
        summary = 'Measurement: ' + quality.label + ' signal (SNR ' + quality.snr + ')';
      } else {
        summary = list.length === 1 && !trouble.length
          ? 'Measurement: ' + list[0].message
          : 'Device alert';
      }

      if (trouble.length) {
        summary += ' — ' + (trouble.length === 1 ? '1 reading' : trouble.length + ' readings') +
                   ' reported a problem';
      }

      var style = ALERT_STYLES[worst] || ALERT_STYLES.bad;
      ui.alerts.style.display      = '';
      ui.alerts.style.background   = style.background;
      ui.alerts.style.border       = style.border;
      ui.alerts.style.color        = style.color;
      ui.alerts.style.borderRadius = '8px';
      ui.alerts.style.padding      = '10px 14px';
      ui.alerts.style.marginTop    = '10px';
      ui.alerts.style.fontWeight   = '600';

      var newline = String.fromCharCode(10);
      ui.alerts.innerText = trouble.length
        ? summary + newline + '• ' + trouble.join(newline + '• ')
        : summary;
    }

    /**
     * The versions and mode, for a reader who can act on them.
     *
     * Absent from a participant-facing instrument on purpose. Which kind of
     * instrument this is gets decided by whether it provides the element, rather
     * than by a setting nobody would find.
     */
    function showDeviceInfo() {
      if (!ui.info) return;
      if (!features) { ui.info.innerText = ''; return; }

      var newline = String.fromCharCode(10);
      ui.info.style.background   = '#f1f5f9';
      ui.info.style.border       = '1px solid #d8dee6';
      ui.info.style.borderRadius = '8px';
      ui.info.style.padding      = '10px 14px';
      ui.info.style.marginTop    = '10px';
      ui.info.style.fontFamily   = 'ui-monospace, Consolas, monospace';
      ui.info.style.fontSize     = '13px';
      ui.info.innerText = [
        'Device ' + features.deviceId,
        'Software ' + features.softwareVersion + ' · firmware ' + features.firmwareVersion,
        'Feature list ' + features.version + ' · Terminal API ' + (apiVersion || 'unknown'),
        'Mode ' + features.measureModeInfo.label,
        'SDK ' + sdk.SDK_VERSION + ' (written against Terminal API ' + sdk.TERMINAL_API_VERSION + ')',
      ].join(newline);
    }

    // -- Running one measurement ---------------------------------------------

    async function runMeasurement() {
      if (!device) {
        setStatus('error', 'Please connect the BP+ first.');
        return false;
      }

      showAlerts([], null);
      setStatus('normal', 'Measuring — keep the arm still and do not talk.');

      var measurement;
      busy = true;
      updateButtons();
      try {
        await syncClock();
        measurement = await device.measure({ patientId: patientId() });
      } catch (error) {
        setStatus('error', describe(error));
        showAlerts(error.alerts, null);
        console.error('[BP+]', error);
        return false;
      } finally {
        busy = false;
        updateButtons();
      }

      if (measurement.crcOk === false) {
        setStatus('error', 'The result arrived corrupted (checksum mismatch). ' +
                           'Repeat the measurement.');
        return false;
      }

      // Whether the result is a reading at all is the SDK's judgement, made
      // against the device's own declared ranges: device.measure() rejects an
      // unusable result before it reaches here. A result block is not the same
      // as a measurement — a cuff that cannot inflate ends the request and
      // returns a result with no blood pressure in it, and stored unchecked that
      // writes empty readings into the record and reports success.

      lastMeasurement = measurement;
      showAlerts(sdk.alertsOf(measurement, features && features.bpRange),
                 measurement.signalQuality);

      setStatus('normal', 'Saving…');
      storeResult(measurement);
      renderResults(measurement);

      stored = true;
      setFieldValue(fields.status, 'complete');

      // Announced after the fields are filled, so a listener sees the record in
      // the state REDCap will save it. The test harness checks the result this
      // way; a project can use it to drive anything else on the page.
      document.dispatchEvent(new CustomEvent('bpplus:measurement', {
        detail: { measurement: measurement, fields: fields },
      }));

      // Best effort, and deliberately after the fields are filled: the
      // measurement is recorded whether or not the file is stored.
      var saved = await saveXmlAsFile(measurement.xml);

      // Always, whichever way that went. A record that says nothing about a
      // recording it lost is worse than one that says it lost it.
      recordXmlText(measurement.xml, saved);

      // "Save the form" is not politeness. The recording is on the server but
      // not yet on the record, and it is redcap_save_record() -- which only runs
      // on a submit -- that files it. Leaving the page without saving loses it.
      var ok = saved && saved.status === 'held';
      setStatus(ok || !config().saveXmlAsFile ? 'success' : 'error',
        ok ? 'Measurement recorded. Save the form to file the recording.'
           : (config().saveXmlAsFile
               ? 'Measurement recorded, but the recording was NOT held. ' +
                 ((saved && saved.message) || 'See the browser console.')
               : 'Measurement recorded.'));
      return true;
    }

    /**
     * Ask the server to keep the raw XML as a file on the record.
     *
     * A result runs to around 80 kB for a single measurement, and past 120 kB for
     * a three-determination AOBP one, because of the base64 pressure recordings --
     * either way more than a REDCap text field holds. This is the place to put
     * it, but it needs a File Upload field and the project setting turned on, so
     * a failure is reported and then let go rather than failing a measurement
     * that has already been taken.
     *
     * @returns {Promise<string|null>} the stored filename, or null
     */
    async function saveXmlAsFile(xml) {
      if (!config().saveXmlAsFile || !xml) return null;

      // The framework's module object, published by the PHP with
      // initializeJavascriptModuleObject(). It carries the module prefix and the
      // survey's CSRF token.
      //
      // There is no global ExternalModules.ajax(). Calling one throws
      // "ExternalModules is not defined" at the moment a measurement finishes,
      // which is to say on the first participant.
      var em = window.BPPLUS_MODULE;
      if (!em || typeof em.ajax !== 'function') {
        console.warn('[BP+] this page has no module object, so the recording ' +
                     'cannot be filed. The module publishes window.BPPLUS_MODULE; ' +
                     'if this is the test harness, that is expected.');
        return null;
      }

      try {
        var reply = await em.ajax('save-xml', { xml: xml });
        if (reply && reply.status === 'held') {
          console.log('[BP+] recording held on the server (' + reply.bytes +
                      ' bytes); it is filed into ' + reply.field +
                      ' when this page is saved');
          return reply;
        }
        console.warn('[BP+] the recording was not held:', reply && reply.message);
        return { status: 'error', message: (reply && reply.message) || 'unknown' };
      } catch (error) {
        console.warn('[BP+] the recording was not held:', error);
        return { status: 'error', message: String(error && error.message || error) };
      }
    }

    /**
     * What goes in the text field, which is not the XML when there is a file.
     *
     * Three cases, and the middle one is the reason this exists at all:
     *
     *   held             a marker naming the size and hash. It says "held", not
     *                    "stored", because at this moment it is: the file is
     *                    filed by redcap_save_record() once this page has been
     *                    saved, and the browser is not running by then. The
     *                    project log is what records the filing itself.
     *
     *   NOT held         a marker naming the size, hash and reason. Without it a
     *                    record reads as a measurement that produced no
     *                    recording, when in fact one was taken and lost -- and
     *                    the hash is what identifies the file if it is recovered
     *                    from elsewhere.
     *
     *   no file storage  the reduced XML, because then the field is the only
     *                    place the recording can go. Reduced and not truncated:
     *                    a REDCap text field holds 65,535 bytes and a result is
     *                    larger, so the choice was never whole-or-reduced, and a
     *                    document cut off mid-element is worth nothing.
     */
    function recordXmlText(xml, saved) {
      if (!xml) return;

      // Genuinely optional, so its absence is noted and not warned about.
      // setFieldValue() warns, correctly, for the fields a measurement is
      // supposed to fill; an instrument that deliberately left this one out
      // would then be told off once per measurement forever.
      if (!document.querySelector('[name="' + fields.xml_text + '"]')) {
        console.log('[BP+] no ' + fields.xml_text + ' field on this instrument, ' +
                    'so nothing records whether the recording was filed.');
        return;
      }

      var when = new Date().toISOString();

      if (!config().saveXmlAsFile) {
        var compact = sdk && sdk.minimalXml ? sdk.minimalXml(xml) : xml;
        if (compact.length > 65535) {
          console.warn('[BP+] the reduced recording is ' + compact.length +
                       ' characters, which is more than a REDCap text field holds. ' +
                       'Turn on "Store the raw measurement XML as a file".');
        }
        setFieldValue(fields.xml_text, compact);
        return;
      }

      if (saved && saved.status === 'held') {
        setFieldValue(fields.xml_text,
          'held bytes=' + saved.bytes +
          ' sha256=' + String(saved.sha256 || '').slice(0, 16) +
          ' field=' + saved.field + ' at=' + when);
        return;
      }

      setFieldValue(fields.xml_text,
        'not-held field=' + fields.xml + ' bytes=' + xml.length +
        ' reason=' + String((saved && saved.message) || 'not attempted').slice(0, 120) +
        ' at=' + when);
    }

    /** Turn an SDK error into something an operator can act on. */
    function describe(error) {
      if (!error) return 'The measurement failed.';

      // A BpPlusError already carries a sentence written for a person, and a
      // Table 5 code a script can branch on.
      if (error.code !== undefined && error.message) {
        if (sdk && error.code === sdk.ResultCode.cancelled) {
          return 'The measurement was cancelled at the device. Press Measure to try again.';
        }

        // A result the device produced that is not a reading. The cuff and the
        // hose are what the operator can actually do something about; what the
        // device itself said goes to the alerts panel, not into this line.
        if (sdk && (error.code === sdk.ResultCode.measurementDataInvalid ||
                    error.code === sdk.ResultCode.measurementBPOutOfRange ||
                    error.code === sdk.ResultCode.nibpDeviceError)) {
          return error.message +
                 ' Check the cuff and the hose for a kink, then repeat the measurement.';
        }

        return error.message;
      }
      return error.message || String(error);
    }

    // -- Buttons -------------------------------------------------------------

    /**
     * The one place that decides what is live.
     *
     * Every button derives from the same two facts — connected, busy — so no
     * path can leave a control stranded. A finished measurement deliberately
     * does not lock anything: the operator is in the room and the module is not,
     * and a reading that succeeded but is unusable (the participant moved, the
     * cuff slipped) has to be repeatable without reloading the page.
     */
    function updateButtons() {
      var ready = !!device && !busy;
      setEnabled(ui.measure, ready);
      setEnabled(ui.ping,    ready);
      setEnabled(ui.cancel,  !!device && busy);
    }

    if (ui.connect) {
      ui.connect.addEventListener('click', async function () {
        setEnabled(ui.connect, false);
        setStatus('normal', 'Choose the BP+ in the browser picker…');
        try {
          await connect();
          setStatus('success', 'BP+ connected. Press Measure when the cuff is on.');
          ui.connect.style.display = 'none';
          updateButtons();
        } catch (error) {
          device = null;
          setEnabled(ui.connect, true);
          setStatus('error', describe(error));
          console.error('[BP+]', error);
        }
      });
    }

    if (ui.measure) {
      ui.measure.addEventListener('click', function () {
        if (stored) {
          // Said only to the console: the operator asked for it, and the status
          // line is about to be taken over by the measurement itself.
          console.log('[BP+] repeating; the stored reading will be replaced');
        }
        runMeasurement();
      });
    }

    if (ui.cancel) {
      ui.cancel.addEventListener('click', async function () {
        if (!device) return;

        // Disabled immediately: the device answers a cancel with one F 02 and
        // one M 02, and a second `c` arriving between them has nothing left to
        // cancel. The measurement's own promise rejects with F 02, so the status
        // line and the buttons are restored by the handler that started it.
        setEnabled(ui.cancel, false);
        setStatus('normal', 'Cancelling…');
        try {
          await device.cancel();
        } catch (error) {
          // A cancel that cannot be sent is not itself a measurement failure,
          // and the measurement will report whatever actually happened to it.
          console.warn('[BP+] cancel could not be sent:', error.message);
        }
      });
    }

    /**
     * Confirm the link is live, and that the device on it is still usable.
     *
     * Nothing about a serial cable tells the page it has been unplugged: the
     * port stays open and the next command simply times out, which the operator
     * meets in the middle of a measurement. Two commands answer that cheaply.
     */
    if (ui.ping) {
      ui.ping.addEventListener('click', async function () {
        if (!device) { setStatus('error', 'Please connect the BP+ first.'); return; }

        busy = true;
        updateButtons();
        setStatus('normal', 'Checking the BP+…');
        try {
          apiVersion = await device.readApiVersion();
          features   = await device.readFeatures();
          showDeviceInfo();

          var shortfall = modeShortfall();
          setStatus(shortfall ? 'error' : 'success',
                    shortfall || 'BP+ found and ready.');
        } catch (error) {
          setStatus('error', 'No answer from the BP+. Check the cable, then try again.');
          console.error('[BP+] ping failed', error);
        } finally {
          busy = false;
          updateButtons();
        }
      });
    }

    setStatus('ready', 'Connect the BP+ to begin.');

    /**
     * Pick a granted device back up, without asking.
     *
     * A survey is several pages, and a page submit ends the JavaScript that
     * held the port. The browser's grant outlives it. Without this, an operator
     * who connected on one page is asked to connect again on the next, with the
     * participant already waiting -- and on a repeating instrument that is every
     * single measurement.
     *
     * Tried on every page load, including the first, where there is usually
     * nothing to resume. That is why the failure is quiet: "no port has been
     * granted yet" is the ordinary state at the start of a session, not a fault
     * worth a red status line. The Connect button is left exactly where it was,
     * and the operator's click supplies the gesture the picker needs.
     */
    async function resumeConnection() {
      try {
        await connect({ silent: true });
        setStatus('success', 'BP+ reconnected. Press Measure when the cuff is on.');
        if (ui.connect) ui.connect.style.display = 'none';
        updateButtons();
      } catch (error) {
        device = null;
        console.log('[BP+] nothing to resume (' + (error && error.message) + ')');
      }
    }

    resumeConnection();

    // Exposed so the test harness can drive the same code REDCap runs. Nothing
    // in the module reads this back.
    window.BPPLUS = {
      connect: connect,
      runMeasurement: runMeasurement,
      loadSdk: loadSdk,
      fields: fields,
      get device() { return device; },
      get features() { return features; },
      get apiVersion() { return apiVersion; },
      get lastMeasurement() { return lastMeasurement; },
      get lastClockSync() { return lastClockSync; },
      get sdk() { return sdk; },
    };
  }

  // -- Helpers ---------------------------------------------------------------

  function config() {
    return window.BPPLUS_CONFIG || {};
  }

  /**
   * Every field name this module writes, built from one prefix.
   *
   * One place, so that a study renaming its fields changes a setting rather than
   * hunting through the file — and so the harness and the data dictionary can be
   * checked against the same list.
   */
  function fieldNames(prefix) {
    return {
      sys:       prefix + 'sys',
      dia:       prefix + 'dia',
      map:       prefix + 'map',
      hr:        prefix + 'hr',
      csys:      prefix + 'csys',
      cdia:      prefix + 'cdia',
      ai:        prefix + 'ai',
      snr:       prefix + 'snr',
      irregular: prefix + 'irregular',
      datetime:  prefix + 'datetime',
      guid:      prefix + 'guid',
      device_id: prefix + 'device_id',
      status:    prefix + 'status',
      xml:       prefix + 'xml',
      xml_text:  prefix + 'xml_text',
    };
  }

  function setEnabled(button, enabled) {
    if (button) button.disabled = !enabled;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Where to import the SDK from.
   *
   * REDCap serves a module's static files from its own directory, so a path
   * relative to this script is right in the survey. The server can override it
   * (BPPLUS_CONFIG.sdkUrl) for the case where that is not true, and the test
   * harness sets it directly.
   */
  function sdkUrl() {
    var cfg = config();
    if (cfg.sdkUrl) return cfg.sdkUrl;
    if (THIS_SCRIPT) return new URL('../sdk/index.js', THIS_SCRIPT).href;
    return '../sdk/index.js';
  }
})();
