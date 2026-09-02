/**
 * Build the instrument artefacts from one description of the fields.
 *
 *   node tools/build-instrument.mjs
 *
 * Writes two things, from the same FIELDS table below:
 *
 *   instruments/bpplus_measurement/DataDictionary.csv   rows to append to a
 *                                                       project's dictionary
 *   demo-project/BPplusDemo.REDCap.xml                  a whole project, for
 *                                                       "Create a new project
 *                                                       from an XML file"
 *
 * One source, because the two artefacts describing the same instrument
 * differently is a bug a researcher discovers halfway through a study. Both are
 * committed: nobody should have to install Node to download a data dictionary.
 *
 * The markup for the buttons lives in instruments/bpplus_measurement/
 * instrument.html rather than in a string here. Editing HTML inside a
 * spreadsheet cell is how element ids get lost, and a lost id is a survey page
 * with dead buttons and no error anywhere.
 *
 * The column list and the XML shape are REDCap's, not ours. An import fails on
 * a header that does not match exactly.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const instrumentDir = path.join(root, 'instruments', 'bpplus_measurement');
const demoDir = path.join(root, 'demo-project');

const FORM = 'bpplus_measurement';
const FORM_LABEL = 'BP+ measurement';
const PREFIX = 'bpplus_';

// -- The instrument ----------------------------------------------------------

/**
 * The markup for the descriptive field, with its own explanation removed.
 *
 * The comments in instrument.html are for whoever edits it. Carried through,
 * they would be served to every participant on every page load, and the first
 * person to view source would read an internal note about dead buttons.
 */
function controlMarkup() {
  return fs.readFileSync(path.join(instrumentDir, 'instrument.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    // One line, which is how REDCap itself stores and exports a descriptive
    // field: its own dictionary export puts the whole of a rich-text label on a
    // single row. Embedded newlines inside a quoted cell are legal CSV and
    // REDCap reads them, but they make every line-based tool -- grep, a diff, a
    // researcher's spreadsheet, and any hand-rolled reader -- see ten rows where
    // there is one.
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * The fields, in the order they appear on the instrument.
 *
 * `note` is what the person entering data reads, so every device-written field
 * says so: an operator who types over one is not doing anything REDCap will
 * stop, and the next measurement overwrites it without comment.
 *
 * The validation ranges are the device's declared measurement limits, not
 * clinical ones. A range narrower than what the device can produce turns a real
 * reading into a REDCap error the operator has no way to resolve.
 */
const FIELDS = [
  { name: 'intro', type: 'descriptive', label: controlMarkup(), note: '',
    section: 'BP+ measurement' },

  { name: 'sys', label: 'Brachial systolic (mmHg)', validation: 'integer', min: 40, max: 300,
    section: 'Brachial pressures' },
  { name: 'dia', label: 'Brachial diastolic (mmHg)', validation: 'integer', min: 20, max: 200 },
  { name: 'map', label: 'Brachial mean arterial pressure (mmHg)', validation: 'integer', min: 25, max: 250 },
  { name: 'hr', label: 'Pulse rate (bpm)', validation: 'integer', min: 30, max: 240 },

  { name: 'csys', label: 'Central systolic (mmHg)', validation: 'integer', min: 40, max: 300,
    section: 'Central pressures and indices',
    note: 'Derived by the BP+ from the suprasystolic capture. Filled by the device -- do not type over it.' },
  { name: 'cdia', label: 'Central diastolic (mmHg)', validation: 'integer', min: 20, max: 200 },
  { name: 'ai', label: 'Augmentation index (%)', validation: 'number', min: -50, max: 100,
    note: 'sAI. Can legitimately be negative in a young participant.' },
  { name: 'snr', label: 'Signal-to-noise ratio (dB)', validation: 'number',
    note: 'The raw number, not its quality band. A band that moved later would leave a stored label wrong with nothing to check it against.' },

  { name: 'irregular', type: 'radio', label: 'Irregular rhythm detected',
    choices: '1, Yes | 0, No',
    note: 'From the pulse-rate variability measured during the suprasystolic capture. Left blank when the device did not report it.' },

  { name: 'datetime', label: 'Measurement time (device clock)', validation: 'datetime_seconds_ymd',
    section: 'Provenance -- written by the device, not by the operator',
    note: 'The clock inside the device, which is what the result XML records. The module checks it against this computer before every measurement and sets it when it has drifted.' },
  { name: 'guid', label: 'Measurement GUID' },
  { name: 'device_id', label: 'BP+ device ID',
    note: 'Which physical device took this reading. Worth keeping when a study runs more than one.' },

  { name: 'status', label: 'Capture status',
    note: 'Set to "complete" by the module once a reading has been stored. Useful in branching logic, and in a report of the records still to be measured.' },

  { name: 'xml_text', label: 'Recording status, or the reduced recording',
    section: 'The result file from the device',
    note: 'With file storage on this holds a marker -- the size and hash of the recording the server is holding, or the reason it could not be held. Never the XML itself. The recording is filed onto the record when this form is SAVED, not when the measurement finishes, so the project log is what records the filing. With file storage off this field holds the recording itself, reduced to fit: a text field takes 65,535 bytes and a full result is larger, so the choice is reduced or truncated, and a document cut off mid-element is worth nothing.' },

  { name: 'xml', type: 'file', label: 'Raw measurement XML',
    note: 'Written by the module when "Store the raw measurement XML as a file" is on. Around 80 kB, and more for a multi-reading protocol, which is why it is a file and not a text field. It holds everything above, and the cuff pressure recordings as well.' },
];

const field = f => ({
  variable: PREFIX + f.name,
  form: FORM,
  section: f.section || '',
  type: f.type || 'text',
  label: f.label,
  choices: f.choices || '',
  note: f.note !== undefined ? f.note : 'Filled by the BP+. Do not type over it.',
  validation: f.validation || '',
  min: f.min !== undefined ? String(f.min) : '',
  max: f.max !== undefined ? String(f.max) : '',
});

const INSTRUMENT = FIELDS.map(field);

// The demo project needs a record ID, and REDCap requires it to be the first
// field of the first instrument. It is not part of the instrument a researcher
// appends to their own project, which already has one -- so it lives here and
// not in FIELDS.
const RECORD_ID = {
  variable: 'record_id', form: 'participant', section: 'Participant',
  type: 'text', label: 'Record ID', choices: '',
  note: 'Sent to the BP+ as the patient ID, so the measurement identifies itself in its own XML.',
  validation: '', min: '', max: '',
};

// -- Data dictionary CSV ------------------------------------------------------

const COLUMNS = [
  'Variable / Field Name',
  'Form Name',
  'Section Header',
  'Field Type',
  'Field Label',
  'Choices, Calculations, OR Slider Labels',
  'Field Note',
  'Text Validation Type OR Show Slider Number',
  'Text Validation Min',
  'Text Validation Max',
  'Identifier?',
  'Branching Logic (Show field only if...)',
  'Required Field?',
  'Custom Alignment',
  'Question Number (surveys only)',
  'Matrix Group Name',
  'Matrix Ranking?',
  'Field Annotation',
];

function csvRow(f) {
  const cells = new Array(COLUMNS.length).fill('');
  cells[0] = f.variable;
  cells[1] = f.form;
  cells[2] = f.section;
  cells[3] = f.type;
  cells[4] = f.label;
  cells[5] = f.choices;
  cells[6] = f.note;
  cells[7] = f.validation;
  cells[8] = f.min;
  cells[9] = f.max;
  return cells;
}

/**
 * CSV as REDCap writes it: every cell quoted, and a quote inside one doubled.
 *
 * Quoting unconditionally rather than only where a cell needs it, because the
 * cells that need it -- a page of HTML, a note with a comma -- are exactly the
 * ones where getting it wrong is hardest to notice.
 */
function toCsv(rows) {
  // LF, matching what REDCap's own "Download the current Data Dictionary"
  // produces -- so a diff against a freshly downloaded dictionary shows the
  // fields that changed and not every line in the file.
  return rows
    .map(cells => cells.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(','))
    .join('\n') + '\n';
}

// -- Project XML --------------------------------------------------------------
//
// Written against a real REDCap export, not against the ODM specification.
// REDCap's project XML follows conventions the specification does not imply,
// and a file that satisfies ODM alone is rejected. What it requires:
//
//   - a classic project has NO <Protocol> and NO <StudyEventDef>. Those belong
//     to a longitudinal project.
//   - validation is redcap:TextValidationType, and the names are internal ones:
//     int, float, datetime_seconds_ymd. Not "integer"/"number", and not the
//     TextValidationTypeOrShowSliderNumber spelling the CSV header uses.
//   - a min or max is a <RangeCheck>, not an attribute.
//   - DataType follows the validation: integer, float, datetime, else text.
//   - every form carries a <form>_complete field of its own, with its own
//     three-value code list. Omitting it leaves a form REDCap thinks is
//     unfinished.
//   - a descriptive field's markup goes in redcap:FormattedTranslatedText, with
//     the tags stripped for TranslatedText.
//   - repeating instruments are declared once in GlobalVariables. FormDef stays
//     Repeating="No", which reads wrong and is what REDCap writes.
//
// The reference export is Uscom_2026-09-02_1328.REDCap.xml, from REDCap 15. The
// file this produces imported cleanly there, with no warnings, giving repeating
// instruments and record autonumbering.
//
// If REDCap changes any of this, take a fresh export and compare against it.
// Reasoning from the ODM specification is what produced a file REDCap refused
// outright, and none of the six differences would have been guessable.

/**
 * The generation timestamp in the XML.
 *
 * A constant, not `new Date()`. ODM wants CreationDateTime, but a real one
 * would make this file differ on every run -- and CI regenerates it and fails
 * when the result differs from what is committed, which is what keeps the
 * committed copy honest. REDCap does not read it.
 */
const GENERATED_AT = '2026-09-02T00:00:00';

const xmlEscape = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const attr = pairs => Object.entries(pairs)
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => ` ${k}="${xmlEscape(v)}"`).join('');

/** "bpplus_measurement" -> "Bpplus Measurement", the way REDCap titles a form. */
const formLabel = name =>
  name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** How REDCap spells a validation internally, and what DataType goes with it. */
const VALIDATION = {
  integer:              { redcap: 'int',                  dataType: 'integer' },
  number:               { redcap: 'float',                dataType: 'float', significantDigits: '1' },
  datetime_seconds_ymd: { redcap: 'datetime_seconds_ymd', dataType: 'datetime' },
};

/**
 * REDCap groups a form's fields by section header, and the grouping is odder
 * than it looks: the field carrying a section header is alone in a group named
 * after that section, and the fields after it -- up to the next section header
 * -- form the next group, named after the form.
 */
function itemGroups(form, fields) {
  const groups = [];
  for (const f of fields) {
    const startsOne = f.section || groups.length === 0;
    if (startsOne) {
      groups.push({ oid: `${form.name}.${f.variable}`, name: f.section || formLabel(form.name), fields: [f] });
      // The section's own field stands alone; anything following it that has no
      // section of its own begins a fresh group.
      groups.push({ oid: null, name: formLabel(form.name), fields: [] });
    } else {
      groups[groups.length - 1].fields.push(f);
    }
  }
  // A trailing group nobody joined, and any group still without an OID because
  // its first member named it.
  return groups
    .filter(g => g.fields.length)
    .map(g => ({ ...g, oid: g.oid || `${form.name}.${g.fields[0].variable}` }));
}

/** The <form>_complete field REDCap adds to every instrument. */
const completeField = form => ({
  variable: `${form.name}_complete`,
  fieldType: 'select',
  label: 'Complete?',
  section: 'Form Status',
  choices: '0, Incomplete | 1, Unverified | 2, Complete',
  note: '',
  validation: '',
  min: '', max: '',
});

function itemDef(f) {
  const v = VALIDATION[f.validation] || null;
  const coded = Boolean(f.choices);
  const isDescriptive = (f.fieldType || f.type) === 'descriptive';

  const head = attr({
    OID: f.variable,
    Name: f.variable,
    DataType: v ? v.dataType : 'text',
    Length: coded ? '1' : '999',
    SignificantDigits: v && v.significantDigits,
    'redcap:Variable': f.variable,
    'redcap:FieldType': f.fieldType || f.type || 'text',
    'redcap:TextValidationType': v && v.redcap,
    'redcap:FieldNote': f.note,
    'redcap:SectionHeader': f.section,
  });

  // A descriptive field keeps its markup in a REDCap-specific element, with the
  // tags stripped for the ODM one. Anything reading plain ODM gets something
  // sensible; REDCap gets the buttons back.
  const question = isDescriptive
    ? `<Question><TranslatedText>${xmlEscape(stripTags(f.label))}</TranslatedText>` +
      `<redcap:FormattedTranslatedText>${xmlEscape(f.label)}</redcap:FormattedTranslatedText></Question>`
    : `<Question><TranslatedText>${xmlEscape(f.label)}</TranslatedText></Question>`;

  const parts = ['\t\t' + question];

  if (coded) {
    parts.push(`\t\t<CodeListRef CodeListOID="${f.variable}.choices"/>`);
  }

  // A min or a max is a soft range check with the message REDCap composes.
  const range = (comparator, value) => {
    const bounds = `(${f.min !== '' ? f.min : ''} - ${f.max !== '' ? f.max : ''})`;
    return `\t\t<RangeCheck Comparator="${comparator}" SoftHard="Soft">\n` +
           `\t\t\t<CheckValue>${xmlEscape(value)}</CheckValue>\n` +
           `\t\t\t<ErrorMessage><TranslatedText>The value you provided is outside the suggested range ` +
           `${bounds}. This value is admissible, but you may wish to double check it.` +
           `</TranslatedText></ErrorMessage>\n\t\t</RangeCheck>`;
  };
  if (f.min !== '' && f.min !== undefined) parts.push(range('GE', f.min));
  if (f.max !== '' && f.max !== undefined) parts.push(range('LE', f.max));

  return `\t<ItemDef${head}>\n${parts.join('\n')}\n\t</ItemDef>`;
}

function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function codeList(f) {
  if (!f.choices) return '';
  const items = f.choices.split('|').map(pair => {
    const at = pair.indexOf(',');
    return `\t\t<CodeListItem CodedValue="${xmlEscape(pair.slice(0, at).trim())}">` +
           `<Decode><TranslatedText>${xmlEscape(pair.slice(at + 1).trim())}</TranslatedText></Decode>` +
           `</CodeListItem>`;
  }).join('\n');

  return `\t<CodeList${attr({
    OID: `${f.variable}.choices`, Name: f.variable, DataType: 'text',
    'redcap:Variable': f.variable,
  })}>\n${items}\n\t</CodeList>`;
}

function projectXml(forms) {
  // Constant, not new Date(). CI regenerates this file and fails when it
  // differs from what is committed; a clock in the output turns that check into
  // noise. REDCap does not read it.
  const now = GENERATED_AT;

  const withComplete = forms.map(form => ({
    ...form,
    fields: [...form.fields, completeField(form)],
  }));

  const formDefs = withComplete.map(form => {
    const refs = itemGroups(form, form.fields)
      .map(g => `\t\t<ItemGroupRef ItemGroupOID="${g.oid}" Mandatory="No"/>`)
      .join('\n');
    return `\t<FormDef${attr({
      OID: `Form.${form.name}`, Name: formLabel(form.name), Repeating: 'No',
      'redcap:FormName': form.name,
    })}>\n${refs}\n\t</FormDef>`;
  }).join('\n');

  const groupDefs = withComplete.flatMap(form => itemGroups(form, form.fields).map(g => {
    const refs = g.fields.map(f =>
      `\t\t<ItemRef${attr({ ItemOID: f.variable, Mandatory: 'No', 'redcap:Variable': f.variable })}/>`
    ).join('\n');
    return `\t<ItemGroupDef${attr({ OID: g.oid, Name: g.name, Repeating: 'No' })}>\n${refs}\n\t</ItemGroupDef>`;
  })).join('\n');

  const all = withComplete.flatMap(form => form.fields);
  const itemDefs = all.map(itemDef).join('\n');
  const codeLists = all.map(codeList).filter(Boolean).join('\n');

  const repeating = withComplete
    .filter(form => form.repeating)
    .map(form => `\t\t\t<redcap:RepeatingInstrument redcap:UniqueEventName="event_1_arm_1" ` +
                 `redcap:RepeatInstrument="${form.name}" redcap:CustomLabel=""/>`)
    .join('\n');

  const notes =
    'A worked example for the BP+ Data Capture external module.\n\n' +
    'Install and enable the module on this project, then open the BP+ measurement ' +
    'instrument on any record and press Connect BP+.\n\n' +
    'The BP+ measurement instrument repeats, so a participant can be measured more ' +
    'than once. To keep the device result file as well, turn on "Store the raw ' +
    'measurement XML as a file" in the module settings -- the bpplus_xml field is ' +
    'already here for it.\n\n' +
    'This project is a starting point and is meant to be edited.';

  return `<?xml version="1.0" encoding="UTF-8" ?>
<ODM${attr({
    xmlns: 'http://www.cdisc.org/ns/odm/v1.3',
    'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xmlns:redcap': 'https://projectredcap.org',
    'xsi:schemaLocation': 'http://www.cdisc.org/ns/odm/v1.3 schema/odm/ODM1-3-1.xsd',
    ODMVersion: '1.3.1',
    FileOID: '000-00-0000',
    FileType: 'Snapshot',
    Description: 'BP+ Data Capture demo',
    AsOfDateTime: now,
    CreationDateTime: now,
    SourceSystem: 'REDCap',
    SourceSystemVersion: '15.0.0',
  })}>
<Study OID="Project.BPplusDataCaptureDemo">
<GlobalVariables>
\t<StudyName>BP+ Data Capture demo</StudyName>
\t<StudyDescription>A worked example instrument for the BP+ Data Capture external module.</StudyDescription>
\t<ProtocolName>BP+ Data Capture demo</ProtocolName>
\t<redcap:RecordAutonumberingEnabled>1</redcap:RecordAutonumberingEnabled>
\t<redcap:CustomRecordLabel></redcap:CustomRecordLabel>
\t<redcap:SecondaryUniqueField></redcap:SecondaryUniqueField>
\t<redcap:SchedulingEnabled>0</redcap:SchedulingEnabled>
\t<redcap:SurveysEnabled>0</redcap:SurveysEnabled>
\t<redcap:SurveyInvitationEmailField></redcap:SurveyInvitationEmailField>
\t<redcap:Purpose>0</redcap:Purpose>
\t<redcap:PurposeOther></redcap:PurposeOther>
\t<redcap:ProjectNotes>${xmlEscape(notes)}</redcap:ProjectNotes>
\t<redcap:MissingDataCodes></redcap:MissingDataCodes>
\t<redcap:RepeatingInstrumentsAndEvents>
\t\t<redcap:RepeatingInstruments>
${repeating}
\t\t</redcap:RepeatingInstruments>
\t</redcap:RepeatingInstrumentsAndEvents>
</GlobalVariables>
<MetaDataVersion${attr({
    OID: 'Metadata.BPplusDataCaptureDemo',
    Name: 'BP+ Data Capture demo',
    'redcap:RecordIdField': 'record_id',
  })}>
${formDefs}
${groupDefs}
${itemDefs}
${codeLists}
</MetaDataVersion>
</Study>
</ODM>
`;
}

// -- Write --------------------------------------------------------------------

/**
 * A data dictionary is a file researchers open in Excel, and Excel guesses the
 * encoding of a CSV with no BOM. One curly apostrophe is enough to turn a field
 * note into mojibake on somebody else's machine, and nothing about that is
 * visible from here -- so the rule is no such characters at all, rather than a
 * BOM only some spreadsheets honour.
 */
function requireAscii(text, what) {
  const offending = [...new Set([...text].filter(ch => ch.charCodeAt(0) > 126))];
  if (offending.length) {
    const shown = offending.map(ch =>
      JSON.stringify(ch) + ' (U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + ')');
    console.error(`Refusing to write ${what}: non-ASCII characters -- ${shown.join(', ')}`);
    console.error('Replace them in instrument.html or in the FIELDS table.');
    process.exit(1);
  }
}

const csv = toCsv([COLUMNS, ...INSTRUMENT.map(csvRow)]);
requireAscii(csv, 'the data dictionary');

const xml = projectXml([
  // record_id first, and on its own form. REDCap makes the FIRST field of the
  // FIRST instrument the record ID whatever it is -- importing the data
  // dictionary into a blank project turned bpplus_intro, the descriptive field
  // carrying the buttons, into a text record ID and destroyed the markup.
  { name: 'participant', fields: [RECORD_ID] },
  { name: FORM, fields: INSTRUMENT, repeating: true },
]);
requireAscii(xml, 'the project XML');

const BOM = String.fromCharCode(0xFEFF);
const csvPath = path.join(instrumentDir, 'DataDictionary.csv');
const newProjectCsvPath = path.join(instrumentDir, 'DataDictionary-new-project.csv');
const xmlPath = path.join(demoDir, 'BPplusDemo.REDCap.xml');

fs.mkdirSync(demoDir, { recursive: true });

// A UTF-8 BOM, because REDCap's own dictionary export starts with one and this
// file should be interchangeable with it. It is also what makes Excel open the
// file as UTF-8 instead of guessing -- belt as well as braces, since the content
// above is already restricted to ASCII.
fs.writeFileSync(csvPath, BOM + csv, 'utf8');

// A second dictionary, for importing into a project that has no fields yet.
//
// REDCap makes the FIRST field of the FIRST instrument the record ID, whatever
// it is, and forces it to a text field. Importing the plain dictionary into a
// blank project therefore turns bpplus_intro -- the descriptive field carrying
// the Connect and Measure buttons -- into a text record ID, and the markup is
// gone. REDCap says so, in amber, and it is easy to read as harmless:
//
//   "The first field must be a 'text' field type. It will automatically be set
//    as a 'text' field in the following cell: D2."
//
// This copy puts record_id in front, so the warning does not arise and the
// buttons survive. The plain one stays as it is: appended to a project that
// already has a record ID, a second one would be a duplicate.
const newProjectCsv = toCsv([COLUMNS, csvRow(RECORD_ID), ...INSTRUMENT.map(csvRow)]);
requireAscii(newProjectCsv, 'the new-project data dictionary');
fs.writeFileSync(newProjectCsvPath, BOM + newProjectCsv, 'utf8');
fs.writeFileSync(xmlPath, xml, 'utf8');

const rel = p => path.relative(root, p).replace(/\\/g, '/');
console.log(`wrote ${rel(csvPath)} -- ${INSTRUMENT.length} fields on form ${FORM}`);
console.log(`wrote ${rel(newProjectCsvPath)} -- the same, with record_id in front`);
console.log(`wrote ${rel(xmlPath)} -- 2 forms, ${INSTRUMENT.length + 1} fields`);
