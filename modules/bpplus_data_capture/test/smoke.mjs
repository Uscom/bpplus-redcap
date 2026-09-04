/**
 * Does the module still start, and does the instrument still match it?
 *
 *   npm install --no-save jsdom      (optional; the DOM half is skipped without it)
 *   node test/smoke.mjs
 *
 * `node --check` only parses. It cannot see a value read before it was
 * assigned, which leaves a module that loads and does nothing, with no error to
 * say so. This loads the module against a stand-in instrument, fires
 * DOMContentLoaded, and fails if window.BPPLUS is missing or anything reached
 * console.error.
 *
 * It also checks the module against the shipped data dictionary, because the two
 * agreeing is the whole contract: a field renamed in one and not the other is
 * silent in REDCap and costs a study its data.
 *
 * No device, no browser, no REDCap.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { unusableReason, parseAlerts, classifyAlert } from '../sdk/device/measurement.js';
import { ResultCode } from '../sdk/constants.js';

/**
 * A hash of the SDK's contents, independent of file order and of line endings.
 *
 * Must stay identical to Get-SdkHash in tools/sync-sdk.ps1: every .js file
 * sorted by its path relative to sdk/, each hashed as UTF-8 with CRLF
 * normalised to LF, joined as "path hash\n" lines, and the whole hashed again.
 *
 * Line endings are normalised rather than hashed as they are because
 * .gitattributes stores and checks out LF, and a checkout on a machine
 * configured otherwise would hash differently while being the same code -- a
 * check that cries wolf on every machine but one is a check people learn to
 * ignore.
 */
function sdkTreeHash(dir) {
  const sha = data => crypto.createHash('sha256').update(data).digest('hex');

  const walk = (d, prefix = '') => fs.readdirSync(d, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory()
      ? walk(new URL(entry.name + '/', d), prefix + entry.name + '/')
      : (entry.name.endsWith('.js') ? [[prefix + entry.name, new URL(entry.name, d)]] : []));

  const lines = walk(dir)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, url]) =>
      `${name} ${sha(Buffer.from(fs.readFileSync(url, 'utf8').replace(/\r\n/g, '\n'), 'utf8'))}\n`)
    .join('');

  return sha(Buffer.from(lines, 'utf8'));
}

let failures = 0;

function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '   ' + detail : ''}`);
}

// -- Does every SDK module parse? --------------------------------------------
// `node --check` does not parse a .js file as ESM, so it passes a module with a
// syntax error in it, which then surfaces only when a page reaches that module.
// Importing each one is the only check that means anything.

console.log('\nSDK modules parse');

{
  const dir = new URL('../sdk/', import.meta.url);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? walk(new URL(entry.name + '/', d))
      : (entry.name.endsWith('.js') ? [new URL(entry.name, d)] : []));

  const modules = walk(dir);
  let broken = 0;

  for (const url of modules) {
    try {
      await import(url);
    } catch (error) {
      // A module that needs a DOM is not a parse failure; a SyntaxError is.
      if (error instanceof SyntaxError) {
        broken++;
        console.log(`  FAIL  ${url.pathname.split('/sdk/')[1]} — ${error.message}`);
      }
    }
  }

  check(`all ${modules.length} SDK modules parse`, broken === 0);
}

// -- Is the vendored SDK the one this module was built against? ---------------
// A sync that half-completed, or an edit made in place, is invisible until a
// measurement behaves differently on one site and not another.

console.log('\nvendored SDK');

{
  const provenance = new URL('../sdk/SDK-VERSION.json', import.meta.url);
  if (!fs.existsSync(provenance)) {
    check('sdk/SDK-VERSION.json is present', false, 'the vendored copy has no provenance');
  } else {
    const declared = JSON.parse(fs.readFileSync(provenance, 'utf8'));
    const { SDK_VERSION, TERMINAL_API_VERSION } = await import('../sdk/index.js');

    check('SDK-VERSION.json matches the SDK it describes',
      declared.sdkVersion === SDK_VERSION,
      `declared ${declared.sdkVersion}, code says ${SDK_VERSION}`);
    check('the Terminal API version agrees too',
      declared.terminalApiVersion === TERMINAL_API_VERSION,
      `declared ${declared.terminalApiVersion}, code says ${TERMINAL_API_VERSION}`);

    // The version numbers agreeing proves only that nobody changed them. This
    // is the check that catches an edit made in sdk/ and nowhere else: two
    // copies can report the same SDK_VERSION and still differ.
    //
    // The algorithm has to match tools/sync-sdk.ps1 exactly, or a green run
    // here and a red one there means nothing. Both normalise line endings, so a
    // checkout on a machine configured for CRLF still hashes the same.
    check('sdk/ has not been edited in place',
      sdkTreeHash(new URL('../sdk/', import.meta.url)) === declared.vendored?.treeSha256,
      `recorded ${declared.vendored?.treeSha256}, actual ${sdkTreeHash(new URL('../sdk/', import.meta.url))}` +
      ' -- re-sync with tools/sync-sdk.ps1 rather than editing sdk/');
  }
}

// -- Does the module initialise? ---------------------------------------------

async function loadJsdom() {
  try {
    return (await import('jsdom')).JSDOM;
  } catch {
    return null;
  }
}

const JSDOM = await loadJsdom();
const PREFIX = 'bpplus_';

// Every field the module writes. Kept here rather than imported, on purpose:
// the point is to fail when js/bpplus-capture.js changes its mind without the
// instrument being changed to match.
const EXPECTED_FIELDS = [
  'sys', 'dia', 'map', 'hr',
  'csys', 'cdia', 'ai', 'snr',
  'irregular', 'datetime', 'guid', 'device_id',
  'status', 'xml', 'xml_text',
].map(suffix => PREFIX + suffix);

if (!JSDOM) {
  console.log('\nmodule start-up: SKIPPED — needs jsdom');
  console.log('  npm install --no-save jsdom');
} else {
  console.log('\nmodule start-up');

  // Every element the module looks for, and one input per field, so the
  // stand-in is what the real instrument has to be.
  const inputs = EXPECTED_FIELDS
    .filter(name => name !== PREFIX + 'irregular')
    .map(name => `<input type="hidden" name="${name}" value="">`)
    .join('');

  const html = `<!doctype html><html><body>
    <div id="bpplus-status"></div>
    <button id="bpplus-connect"></button>
    <button id="bpplus-measure"></button>
    <button id="bpplus-cancel"></button>
    <button id="bpplus-ping"></button>
    <div id="bpplus-results"></div>
    <div id="bpplus-alerts"></div>
    <div id="bpplus-device-info"></div>
    ${inputs}
    <div id="opt-${PREFIX}irregular_1"></div>
    <div id="opt-${PREFIX}irregular_0"></div>
  </body></html>`;

  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.BPPLUS_CONFIG = { record: 'TEST-001', fieldPrefix: PREFIX, sdkUrl: 'about:blank' };

  const errors = [];
  w.console.error = (...args) => errors.push(args.map(String).join(' '));
  w.console.warn = () => {};
  w.console.log = () => {};

  w.eval(fs.readFileSync(new URL('../js/bpplus-capture.js', import.meta.url), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 150));

  const el = id => w.document.getElementById(id);

  check('window.BPPLUS is set', !!w.BPPLUS);
  check('nothing reached console.error', errors.length === 0, errors.join(' | '));
  check('the status line was rendered', !!el('bpplus-status').innerText);

  // Nothing that needs a device may be live before there is one. This is what
  // stops an operator pressing Measure into a port that was never opened.
  check('every device control starts disabled',
    ['bpplus-measure', 'bpplus-cancel', 'bpplus-ping'].every(id => el(id).disabled === true));
  check('Connect is the only thing that is live', el('bpplus-connect').disabled === false);

  check('the module names the fields this test expects',
    w.BPPLUS && EXPECTED_FIELDS.every(name => Object.values(w.BPPLUS.fields).includes(name)),
    w.BPPLUS ? JSON.stringify(w.BPPLUS.fields) : 'module did not start');

  // A prefix without its underscore is the ordinary way to mistype the setting,
  // and the module is meant to survive it.
  {
    const dom2 = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    const w2 = dom2.window;
    w2.BPPLUS_CONFIG = { record: 'X', fieldPrefix: 'study_', sdkUrl: 'about:blank' };
    w2.console.error = () => {}; w2.console.warn = () => {}; w2.console.log = () => {};
    w2.eval(fs.readFileSync(new URL('../js/bpplus-capture.js', import.meta.url), 'utf8'));
    w2.document.dispatchEvent(new w2.Event('DOMContentLoaded'));
    await new Promise(resolve => setTimeout(resolve, 100));
    check('a different prefix reaches every field name',
      w2.BPPLUS?.fields?.sys === 'study_sys' && w2.BPPLUS?.fields?.xml === 'study_xml',
      JSON.stringify(w2.BPPLUS?.fields));
  }
}

// -- Does the shipped instrument still match the module? ----------------------
// The data dictionary lives outside the module, so that a module zipped on its
// own still runs its tests. Absent, this is skipped rather than failed.

console.log('\ninstrument');

{
  const csv = new URL('../../../instruments/bpplus_measurement/DataDictionary.csv', import.meta.url);

  if (!fs.existsSync(csv)) {
    console.log('  SKIPPED — instruments/bpplus_measurement/DataDictionary.csv is not beside this module');
  } else {
    // Splitting on newlines does not work here. The descriptive field holds a
    // page of HTML, and a quoted CSV cell may legally contain the line breaks
    // that markup needs — so a line-based reader sees ten rows where there is
    // one, and reports a field named "<div style=...".
    const names = firstColumn(fs.readFileSync(csv, 'utf8')).slice(1);

    const missing = EXPECTED_FIELDS.filter(f => !names.includes(f));
    check('every field the module writes exists in the data dictionary',
      missing.length === 0, 'missing: ' + missing.join(', '));

    // The second dictionary, for a project with no fields yet, must carry the
    // same fields and must lead with record_id -- REDCap turns whatever comes
    // first into the record ID and forces it to text, which would destroy the
    // descriptive field the buttons live in.
    const newProject = new URL('../../../instruments/bpplus_measurement/DataDictionary-new-project.csv',
                               import.meta.url);
    if (!fs.existsSync(newProject)) {
      check('DataDictionary-new-project.csv exists', false,
        'a blank project has nothing safe to import');
    } else {
      const npNames = firstColumn(fs.readFileSync(newProject, 'utf8')).slice(1);
      check('the new-project dictionary leads with record_id',
        npNames[0] === 'record_id', 'first field is ' + npNames[0]);
      check('and carries every field the module writes',
        EXPECTED_FIELDS.every(f => npNames.includes(f)));
    }

    // The reverse is not an error — an instrument may carry fields of its own —
    // but a field that merely looks like one of ours is worth naming, because
    // that is what a renamed field leaves behind.
    //
    // bpplus_intro is the descriptive field holding the buttons. It is on the
    // instrument and is not a value, so it is named here rather than silently
    // tolerated by a rule about descriptive fields that would also hide a real
    // mistake.
    const NOT_DATA = [PREFIX + 'intro'];
    const strays = names.filter(n =>
      n.startsWith(PREFIX) && !EXPECTED_FIELDS.includes(n) && !NOT_DATA.includes(n));
    check('no unexplained bpplus_ field in the dictionary',
      strays.length === 0, 'unexpected: ' + strays.join(', '));
  }
}

// -- Can the harness still test the resume? -----------------------------------
// The module asks for a silent transport when it picks a granted device back up
// after a page load. The harness builds its own transports, so a hook that takes
// only (api) drops the flag: the resume reaches the picker, the browser refuses
// it for want of a user gesture, and the feature looks broken on the bench while
// working in REDCap. That is the worst way for a test rig to be wrong, so it is
// checked rather than trusted.

console.log('\nthe harness can exercise the resume');

{
  const harness = new URL('../test/harness.html', import.meta.url);
  const html = fs.readFileSync(harness, 'utf8');

  const at = html.indexOf('BPPLUS_TRANSPORT = function');
  if (at < 0) {
    check('the harness has a transport hook', false, 'BPPLUS_TRANSPORT not found');
  } else {
    const hook = html.slice(at);

    // To the closing brace at the start of a line, not to the first "};" in the
    // text. The hook's own `options = options || {};` contains one, so slicing
    // there ends the body two lines in and the transport check below examines
    // nothing at all -- passing whatever the hook actually does.
    const end = hook.indexOf('\n};');
    const body = end < 0 ? hook : hook.slice(0, end);

    check('the hook takes the options, not just the api',
      /function \(api, options\)/.test(body));

    // The simulator is excluded by name: it has no grant to resume and no
    // picker to refuse, so the flag means nothing to it.
    const dropped = body.split('\n').filter(line =>
      line.includes('new api.') && !line.includes('Simulator') && !line.includes('silent'));

    check('every real transport it builds is given silent',
      dropped.length === 0, dropped.map(l => l.trim()).join(' | '));
  }
}

// The module has to thread it into the constructor, not merely into the function
// that calls one. Threading it half way is what makes a resume call
// requestPort() anyway, and it looks correct from the outside.
{
  const module = fs.readFileSync(new URL('../js/bpplus-capture.js', import.meta.url), 'utf8');

  check('the module asks its hook with options',
    /BPPLUS_TRANSPORT\(api, options\)/.test(module));

  const built = module.split('\n').filter(line =>
    /new api\.(WebSerial|UsbSerial)Transport\(/.test(line));

  check('and gives silent to every cable transport it constructs',
    built.length > 0 && built.every(line => line.includes('silent')),
    built.map(l => l.trim()).join(' | '));

  check('the resume is attempted on load, and quiet when there is nothing to resume',
    /resumeConnection\(\)/.test(module) && /nothing to resume/.test(module));
}

// -- Does the harness still simulate the submit? -------------------------------
// The recording is filed during the measurement, and the form is then told the
// document id -- because a REDCap submit posts the value the file field was
// RENDERED with, and an emptied file field is a deletion. A stand-in that only
// answered the ajax call would show the file arriving and never show the thing
// that can take it away again, which is the one behaviour worth demonstrating.

console.log('\nthe harness simulates the whole journey');

{
  const html = fs.readFileSync(new URL('../test/harness.html', import.meta.url), 'utf8');

  check('the ajax stand-in files at once and answers "saved"',
    /status:\s*'saved'/.test(html) && !/status:\s*'held'/.test(html));

  check('it returns a document id for the page to adopt',
    /doc_id:/.test(html));

  check('there is a submit step, separate from the measurement',
    /emSubmitForm/.test(html) && /id="em-save"/.test(html));

  // The whole point. Without a submit that can delete, the write-back looks
  // like decoration rather than the thing standing between a recording and its
  // deletion.
  check('the submit deletes a recording the form was never told about',
    /em-hide-docid/.test(html) && /state = 'deleted'/.test(html));

  check('and leaves one the form posts back untouched',
    /the submit changed nothing/.test(html));

  check('a filing can be made to fail on purpose',
    /em-fail-save/.test(html));

  // Named the way REDCap names its save controls, so the module's locking of
  // them during a measurement is exercised here and not only in a project.
  check('the submit control is named the way the module looks for it',
    /name="submit-btn/.test(html));

  // IndexedDB rather than a variable, so a reload does to the harness what a
  // page change does to the server: the filed recording is still there.
  check('filed recordings outlive a page load',
    /indexedDB\.open/.test(html));

  check('the recording is keyed the way the server keys it',
    /emKey/.test(html) && /repeat_instance/.test(html));

  // A locked form is not a state anyone can reach here by clicking, and it is
  // the one REDCap puts a survey response into for a user without "Edit survey
  // responses".
  check('a read-only form can be asked for on purpose',
    /params\.get\('readonly'\)/.test(html) && /removeAttribute\('name'\)/.test(html));
}

// -- Does the module still write the document id back? -------------------------
// This is the whole of the file-storage design in one line of JavaScript. Lose
// it and every recording is filed correctly and then deleted by the next
// submit, with nothing anywhere saying so.

console.log('\nthe form is told which document to keep');

{
  const module = fs.readFileSync(
    new URL('../js/bpplus-capture.js', import.meta.url), 'utf8');

  check('the reply is adopted into the form', /adoptDocId\(/.test(module));

  // As an input. The hidden input carries the field name and no id, and the
  // download link beside it carries the same NAME -- so getElementsByName()
  // returns the anchor as readily as the input.
  check('and the hidden input is selected as an input, not by name alone',
    /input\[type="hidden"\]\[name="/.test(module));

  check('the save controls are shut while a measurement is in flight',
    /setSubmitEnabled\(/.test(module) && /submit-btn/.test(module));

  check('a read-only form is refused rather than measured on',
    /readOnlyReason\(/.test(module));

  // There is no second attempt any more, so a failure has to leave the
  // recording somewhere rather than trusting a later save to retry.
  check('a failed filing falls back to the reduced recording',
    /minimalXml/.test(module) && /65535/.test(module));
}

// -- Is the patient ID composed the way the device will take it? ---------------
// The device writes this verbatim into its own result file and keeps it on the
// SD card, so it is what reconciles a card full of recordings back to records.
// The rule for what it may contain belongs to the SDK; a copy kept here would
// go on enforcing whatever it said when it was copied.

console.log('\nthe patient ID is composed from the SDK rule');

{
  const module = fs.readFileSync(
    new URL('../js/bpplus-capture.js', import.meta.url), 'utf8');

  check('the module composes rather than sending the record raw',
    /composePatientId\(/.test(module) && /\[record\]/.test(module));

  check('and sanitises with the SDK, not a rule of its own',
    /sdk\.sanitisePatientId\(/.test(module));

  // The specific regression: three consumers each kept /[^A-Za-z0-9-]/ and all
  // three would have gone on refusing values the specification allows.
  check('no copy of the character rule is left in the module',
    !/A-Za-z0-9-/.test(module));

  check('an over-long ID is refused rather than truncated',
    /PATIENT_ID_MAX_LENGTH/.test(module) && !/\.slice\(0,\s*64\)/.test(module));

  check('a measurement still happens when the ID cannot be composed',
    /No patient ID was sent to the device/.test(module));

  const sdk = fs.readFileSync(
    new URL('../sdk/core/commands.js', import.meta.url), 'utf8');

  check('the vendored SDK exports the sanitiser the module calls',
    /export function sanitisePatientId/.test(sdk));

  // The rule itself, checked against the specification rather than against
  // whatever the SDK happens to say: printable ASCII minus four characters.
  check('and enforces printable ASCII minus the four the device cannot take',
    /\\x20-\\x7E/.test(sdk) && /PATIENT_ID_FORBIDDEN/.test(sdk));

  const harness = fs.readFileSync(
    new URL('../test/harness.html', import.meta.url), 'utf8');

  check('the harness can drive every patient ID mode',
    /patientidmode/.test(harness) && /patientIdTemplate/.test(harness));

  check('and checks the ID came back out of the result document',
    /the patient ID came back out of the result document/.test(harness));

  // [record:5] pads to five and never cuts to five: shortening an identifier
  // is how two participants come to share one.
  check('a width may be asked for',
    module.includes('(?::(\\d+))?'));
  check('and it pads rather than truncates',
    /while \(value\.length < pad\)/.test(module) && !/\.slice\(0, pad\)/.test(module));
}

// -- The controls, and the ones that are not there ----------------------------
// One button that says what it will do, rather than a Measure and a Repeat that
// do the same thing; and a Resend that appears only when there is something to
// resend.

console.log('\nthe controls say what they will do');

{
  const module = fs.readFileSync(
    new URL('../js/bpplus-capture.js', import.meta.url), 'utf8');
  const instrument = fs.readFileSync(
    new URL('../../../instruments/bpplus_measurement/instrument.html', import.meta.url), 'utf8');

  check('Measure becomes Cancel and Repeat', /relabel\(/.test(module) &&
    /Cancel/.test(module) && /Repeat/.test(module));

  check('and stays live during a measurement, because then it cancels',
    /connected && !filing && !cancelling/.test(module));

  check('the shipped instrument has no separate Cancel button',
    !/id="bpplus-cancel"/.test(instrument));

  check('but one is still honoured where an instrument has it',
    /ui\.cancel\.addEventListener/.test(module));

  check('the shipped instrument declares the Resend button',
    /id="bpplus-resend"/.test(instrument) && /display:none/.test(instrument));

  // The regression: a button taken from the instrument was returned before the
  // click handler was attached, so pressing Resend did nothing at all -- and
  // the operator believes the recording has been sent.
  check('a Resend button from the instrument gets its handler',
    /bpplusWired/.test(module));

  check('and one is built when the instrument has none',
    /createElement\('button'\)/.test(module));

  check('Resend is hidden unless a filing failed',
    /showResend\(!!pendingXml\)/.test(module));
}

// -- Can a fabricated reading be told apart? ----------------------------------
// The simulator exists so the survey, the file storage and the record can be
// tested with no device. Everything downstream runs exactly as it does for
// real, which is the point and also the danger.

console.log('\na simulated reading cannot pass for a real one');

{
  const module = fs.readFileSync(
    new URL('../js/bpplus-capture.js', import.meta.url), 'utf8');
  const config = JSON.parse(fs.readFileSync(
    new URL('../config.json', import.meta.url), 'utf8'));

  const setting = config['project-settings'].find(s => s.key === 'simulator');
  check('the setting exists and says what it is', Boolean(setting) &&
    /TESTING ONLY/.test(setting.name) && /fabricated/i.test(setting.name));

  // Three marks, because one can be missed. The banner is on screen, the
  // console carries it, and the device id survives into an export -- where
  // whoever reads it was not in the room.
  check('a banner says so on the page', /bpplus-simulator-banner/.test(module));
  check('the console says so', /SIMULATED DEVICE/.test(module));
  check('and the record says so, in the device id',
    /'SIMULATED-' \+ measurement\.deviceId/.test(module));

  // Its own element, not the status line: that is rewritten by every step of
  // every measurement, so a warning put there is gone when it matters.
  check('the banner is not the status line',
    /insertBefore\(banner, ui\.status\)/.test(module));
}

// -- Are recovered retries reported as failures? ------------------------------
// The device retries a determination it could not measure and reports the
// attempt it threw away even when a later one succeeded, so a clean reading
// arrives carrying a warning nobody can act on.

console.log('\na recovered retry is not an error');

{
  const module = fs.readFileSync(
    new URL('../js/bpplus-capture.js', import.meta.url), 'utf8');

  check('a successful measurement shows only good news by default',
    /succeeded && config\(\)\.detailedWarnings !== true/.test(module));

  check('but every alert is logged whatever is shown',
    /Logged in full whatever is shown/.test(module));

  // A failed measurement is the case where every alert is evidence.
  check('a failed measurement still shows everything',
    /showAlerts\(error\.alerts, null, false\)/.test(module));
}

// -- Does the harness test the instrument that ships? -------------------------
// Its banner says it does. A cached copy makes that claim false while looking
// identical, and the harness goes on testing the instrument as it was.

{
  const harness = fs.readFileSync(
    new URL('../test/harness.html', import.meta.url), 'utf8');

  check('the harness fetches the instrument past the cache',
    /cache:\s*'no-store'/.test(harness));
}

// -- Is a result a reading? ---------------------------------------------------
// A result block is not the same as a measurement. When the cuff cannot be
// inflated the device ends the request and returns a result with no blood
// pressure in it — an answer, not a rejection. Stored unchecked, that writes
// empty readings into the record and reports success.
//
// The ranges are a real device's, from the feature list of the BP+ these were
// written against.

console.log('\nresult validation');

const range = {
  sys: { max: 280, min: 40 },
  dia: { max: 200, min: 20 },
  map: { max: 245, min: 25 },
  hr:  { max: 240, min: 30 },
};
const result = (sys, dia, pr = 70) => ({ brachial: { sys, dia, pr } });
const codeOf = (...args) => (unusableReason(...args) || {}).code ?? null;

check('a real reading is usable', codeOf(result(122, 78), range) === null);
check('a reading at the declared limits is usable', codeOf(result(280, 21, 240), range) === null);
check('no pressure at all is refused',
  codeOf(result(null, null), range) === ResultCode.measurementDataInvalid);
check('the zeros an aborted run returns are refused',
  codeOf(result(0, 0, 0), range) === ResultCode.measurementBPOutOfRange);
check('systolic not above diastolic is refused',
  codeOf(result(100, 100), range) === ResultCode.measurementDataInvalid);
check('without a feature list a plausible reading is still usable',
  codeOf(result(122, 78), null) === null);

// -- Signal quality is not a fault --------------------------------------------
// The device reports signal quality through the same <Alert> element it uses for
// faults. Treating every alert as a problem puts a warning on a perfect
// measurement, which is how an operator learns to ignore the warnings.

console.log('\nalert severity');

const sev = m => classifyAlert(m).severity;

check('Excellent is good news', sev('Excellent Signal') === 'good');
check('Poor asks for attention', sev('Poor Signal') === 'caution');
check('Invalid is bad', sev('Invalid Signal') === 'bad');
check('a fault is bad', sev('Unable to measure BP: Over Pressure (C19)') === 'bad');
check('an unrecognised alert is shown, not softened', sev('Something new') === 'bad');

check('the message excludes the module hex',
  parseAlerts('Unable to measure BP: Over Pressure (C19);1B0B68433139;')[0]?.message
    === 'Unable to measure BP: Over Pressure (C19)');
check('the hex is kept separately',
  parseAlerts('Over Pressure;AABB;')[0]?.tm2917_hex_result === 'AABB');

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

/**
 * The first cell of every row of a CSV, quoted cells and embedded newlines
 * included.
 *
 * Enough of a reader for one column, which is all this needs. It walks the file
 * once, tracking whether it is inside quotes, and stops collecting at the first
 * comma of each row — so the HTML in the descriptive field, commas, doubled
 * quotes and line breaks and all, counts as the single cell it is.
 */
function firstColumn(text) {
  // REDCap's own dictionary export begins with a UTF-8 BOM, and so does the
  // generated one so the two are interchangeable. Left in place it becomes part
  // of the first field name.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const out = [];
  let cell = '';
  let inQuotes = false;
  let collecting = true;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { if (collecting) cell += '"'; i++; }
        else inQuotes = false;
      } else if (collecting) {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { collecting = false; continue; }

    if (ch === '\n') {
      out.push(cell.trim());
      cell = '';
      collecting = true;
      continue;
    }

    if (ch !== '\r' && collecting) cell += ch;
  }

  if (cell.trim() !== '') out.push(cell.trim());
  return out.filter(name => name !== '');
}
