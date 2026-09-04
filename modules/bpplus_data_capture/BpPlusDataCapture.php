<?php

namespace Uscom\BpPlusDataCapture;

use ExternalModules\AbstractExternalModule;
use Exception;
use Throwable;

/**
 * BP+ Data Capture.
 *
 * Puts the BP+ JavaScript SDK on a data-entry or survey page and tells it which
 * record it is filling. The device is on the operator's cable, not on the
 * server, so the whole measurement happens in the browser: nothing here touches
 * the wire protocol, and no part of a measurement passes through PHP unless the
 * raw XML is being stored as a file.
 *
 * This module is an example. It is deliberately small, and everything a study is
 * likely to want different — the instrument, the field names, whether the XML is
 * kept — is a project setting rather than an edit.
 *
 * @see README.md
 */
class BpPlusDataCapture extends AbstractExternalModule
{
    /** Used when the matching project setting is blank. */
    private const DEFAULT_INSTRUMENT = 'bpplus_measurement';
    private const DEFAULT_PREFIX     = 'bpplus_';
    private const DEFAULT_CLOCK_MINS = 5.0;

    /**
     * The size limit on one recording, in megabytes.
     *
     * Measured, not guessed. A pressure wave is base64 of 16-bit samples at
     * 200 Hz, so 8/3 of a byte per sample, and that is what sets the size:
     *
     *   single suprasystolic result                          0.08 MB
     *   5-determination AOBP, as recorded                    0.13 MB
     *   5 x 75 s, the longest the device records today       0.25 MB
     *   5 x 180 s with a 30 s suprasystolic, the most the
     *     hardware could ever produce                        0.53 MB
     *
     * So the floor is 0.6 and not lower. A project setting 0.2 would reject a
     * real 5-determination AOBP -- and rejecting a measurement already taken on
     * a participant is far worse than accepting a file that is too big. The
     * floor has to sit above the largest thing a device can produce, not below
     * the smallest.
     *
     * The ceiling is the default: a project may lower the limit a little and
     * never raise it. Nothing a device produces comes near 1 MB, so a project
     * asking for more is not describing a measurement.
     */
    private const DEFAULT_MAX_MB = 1.0;
    private const MIN_MAX_MB     = 0.6;
    private const LIMIT_MAX_MB   = 1.0;

    /**
     * The suffix of the File Upload field the raw XML is stored in.
     *
     * Combined with the project's field prefix, so a project that renamed its
     * fields does not also have to rename this one.
     */
    private const XML_FIELD_SUFFIX = 'xml';

    // -- Hooks ---------------------------------------------------------------

    public function redcap_data_entry_form(
        $project_id,
        $record,
        $instrument,
        $event_id,
        $group_id,
        $repeat_instance
    ) {
        $this->emitFor($instrument, $project_id, $record, $event_id, $repeat_instance);
    }

    public function redcap_survey_page_top(
        $project_id,
        $record,
        $instrument,
        $event_id,
        $group_id,
        $survey_hash,
        $response_id,
        $repeat_instance
    ) {
        $this->emitFor($instrument, $project_id, $record, $event_id, $repeat_instance);
    }

    /**
     * Both entry points, so the same instrument works as a form and as a survey.
     *
     * Which one a study uses is not this module's business, and a module that
     * only worked on a survey would fail silently on the data-entry form that
     * every project has anyway.
     */
    private function emitFor($instrument, $project_id, $record, $event_id, $repeat_instance): void
    {
        if ($instrument !== $this->captureInstrument()) {
            return;
        }

        $this->emitConfig($project_id, $record, $event_id, $repeat_instance);

        // The framework's own JavaScript object, and the only supported way to
        // reach redcap_module_ajax() from a page. It carries the module prefix
        // and the survey's CSRF token, neither of which a bare POST has.
        //
        // There is no global `ExternalModules.ajax()`. A page that calls one
        // gets "ExternalModules is not defined" at the moment a measurement
        // finishes -- which is to say, on the first participant.
        echo $this->initializeJavascriptModuleObject();
        echo '<script>window.BPPLUS_MODULE = '
            . $this->getJavascriptModuleObjectName() . ';</script>' . "\n";

        $src = htmlspecialchars($this->getUrl('js/bpplus-capture.js'), ENT_QUOTES);
        echo '<script src="' . $src . '"></script>' . "\n";
    }

    /**
     * File one measurement's raw XML onto the record, and say which edoc it is.
     *
     * Reached from the page with BPPLUS_MODULE.ajax('save-xml', payload). The
     * framework authenticates the call and supplies $project_id, so unlike a
     * bare POST endpoint this cannot be aimed at another project.
     *
     * The doc id in the reply is not decoration. A REDCap form posts the value
     * its File Upload field held WHEN THE PAGE WAS RENDERED, so a page that
     * rendered with an empty field posts that emptiness back over whatever has
     * been attached since -- and clearing a file field is how REDCap deletes an
     * edoc, by setting delete_date on the metadata row. The page therefore
     * writes this doc id into the form's hidden input, and the submit posts the
     * same value back and changes nothing. That is exactly what REDCap's own
     * upload dialog does with the doc id it gets.
     *
     * Off unless the project turns it on. The measurement itself does not depend
     * on it: by the time this runs the fields are already filled, so a failure
     * here is reported and let go rather than losing a reading already taken on
     * a participant who is still sitting there.
     */
    public function redcap_module_ajax(
        $action,
        $payload,
        $project_id,
        $record,
        $instrument,
        $event_id,
        $repeat_instance,
        $survey_hash,
        $response_id,
        $survey_queue_hash,
        $page,
        $page_full,
        $user_id,
        $group_id
    ) {
        if ($action !== 'save-xml') {
            return ['status' => 'error', 'message' => 'Unknown action.'];
        }

        if (!$this->getProjectSetting('save-xml-file')) {
            return ['status' => 'error', 'message' => 'Storing the XML as a file is not enabled for this project.'];
        }

        // This action is declared in no-auth-ajax-actions, because a survey
        // respondent is not logged in. So everything below assumes the caller
        // is unauthenticated and possibly not the module's own page: the checks
        // are what stands between a survey and an endpoint that writes files.
        //
        // The instrument first. The module only puts its JavaScript on the
        // capture instrument, so a call naming anything else did not come from
        // a page this module wrote. Logged with the value received, because if
        // the framework ever supplies this differently the symptom is that
        // filing stops entirely, and the log is what says why in one look.
        if ($instrument !== $this->captureInstrument()) {
            $this->log('BP+ recording refused', [
                'reason'     => 'not the capture instrument',
                'instrument' => (string) $instrument,
                'record'     => (string) $record,
            ]);
            return ['status' => 'error', 'message' => 'This is not the BP+ capture instrument.'];
        }

        $xml = $payload['xml'] ?? '';

        // A payload is whatever was posted, so it can be an array or a number
        // as easily as a string. strpos() on an array is a TypeError in PHP 8.
        if (!is_string($xml)) {
            return ['status' => 'error', 'message' => 'That does not look like a BP+ measurement.'];
        }

        // Shaped like a result document, not merely containing the word. A
        // substring test alone would accept any payload with "<BPplus" buried
        // anywhere in it, which makes the endpoint a general-purpose place to
        // put a file.
        $trimmed = ltrim($xml);
        $startsRight = strncmp($trimmed, '<?xml', 5) === 0 || strncmp($trimmed, '<BPplus', 7) === 0;

        if (!$startsRight || strpos($xml, '<BPplus') === false || strpos($xml, '</BPplus>') === false) {
            return ['status' => 'error', 'message' => 'That does not look like a BP+ measurement.'];
        }

        // A single suprasystolic result measures about 80 kB, nearly all of it
        // base64 pressure traces, and a multi-reading AOBP result is a multiple
        // of that. The default is far above any of them: the point is to stop
        // the endpoint being used to store arbitrary files, not to fit a result
        // closely, and a cap that rejects a real measurement loses data from a
        // participant who has already been measured.
        $limit = $this->maxRecordingBytes();
        if (strlen($xml) > $limit) {
            $this->log('BP+ recording refused', [
                'reason' => 'over the size limit',
                'record' => (string) $record,
                'bytes'  => strlen($xml),
                'limit'  => $limit,
            ]);
            return ['status' => 'error', 'message' => 'Recording exceeds the maximum supported size.'];
        }

        $field = $this->fieldPrefix() . self::XML_FIELD_SUFFIX;

        // A file cannot be attached to a record that does not exist. A survey
        // reached from a public link has no record until its first submit, so a
        // measurement taken before that has nowhere to go. Said plainly, and
        // recorded in <prefix>xml_text, because the measurement itself is good:
        // the fields are already filled and will save normally.
        //
        // A capture instrument that is the FIRST instrument of a public survey
        // is the only way to reach this. Put it second -- behind a participant
        // form -- and the record always exists by the time anyone measures.
        if ((string) $record === '') {
            return [
                'status'  => 'error',
                'message' => 'This page has no record yet, so the recording cannot be '
                           . 'filed. The measurement itself is unaffected.',
            ];
        }

        $filename = $this->recordingFilename($record, $repeat_instance);

        // storeFile() takes a path, so the bytes have to be on disk for the
        // length of these two calls. Written and removed inside this one
        // request, unlike the edoc it becomes.
        $tmp = tempnam($this->tempDir(), 'bpplus_');
        if ($tmp === false || file_put_contents($tmp, $xml) === false) {
            $this->log('BP+ recording failed', [
                'record' => $record, 'instance' => $repeat_instance, 'field' => $field,
                'message' => 'the server could not write a temporary file',
            ]);
            return ['status' => 'error', 'message' => 'The server could not write the recording.'];
        }

        try {
            // Two calls, and both are required. storeFile() copies the bytes
            // into the edoc store and returns a doc id -- or 0 -- which gets the
            // file onto the server and nowhere near the record.
            // addFileToField() is what puts it on the record. The instance is
            // not optional: an instrument that repeats will otherwise file every
            // measurement against instance 1.
            //
            // Note the method names: storeFile() and addFileToField(). There
            // is no REDCap::saveFile(), however plausible it reads.
            //
            // Note the leading backslash too. REDCap is a global class and this
            // file is in a namespace, so an unqualified REDCap:: names a class
            // in THIS namespace -- which does not exist. PHP raises an Error,
            // not an Exception, so a catch block that names Exception does not
            // see it, and the framework absorbs it: the page finishes normally
            // with the fields saved and the recording never filed.
            $docId = \REDCap::storeFile($tmp, $project_id, $filename);
            if (!$docId) {
                throw new Exception('REDCap::storeFile did not store the file.');
            }

            $linked = \REDCap::addFileToField(
                $docId, $project_id, $record, $field, $event_id, $repeat_instance
            );
            if (!$linked) {
                throw new Exception(
                    'Stored as doc ' . $docId . ' but addFileToField did not attach it to "'
                    . $field . '". Check that the field exists on the instrument and is a '
                    . 'File Upload field.'
                );
            }
        } catch (Throwable $e) {
            $this->log('BP+ recording failed', [
                'record'   => $record,
                'instance' => $repeat_instance,
                'field'    => $field,
                'message'  => $e->getMessage(),
            ]);
            return ['status' => 'error', 'message' => $e->getMessage()];
        } finally {
            @unlink($tmp);
        }

        $this->log('BP+ recording stored', [
            'record'   => $record,
            'instance' => $repeat_instance,
            'field'    => $field,
            'doc_id'   => $docId,
            'bytes'    => strlen($xml),
        ]);

        return [
            'status'   => 'saved',
            'field'    => $field,
            'doc_id'   => (string) $docId,
            'filename' => $filename,
            'bytes'    => strlen($xml),
            'sha256'   => hash('sha256', $xml),
        ];
    }

    /** Somewhere to put the bytes for the length of one request. */
    private function tempDir(): string
    {
        return defined('APP_PATH_TEMP') && is_dir(APP_PATH_TEMP)
            ? rtrim(APP_PATH_TEMP, '/' . DIRECTORY_SEPARATOR)
            : sys_get_temp_dir();
    }

    /** Named so a directory of exported files still says which record and when. */
    private function recordingFilename($record, $repeat_instance): string
    {
        return $this->safeName((string) $record)
            . '_i' . ($repeat_instance ?: 1)
            . '_' . date('Ymd-His')
            . '_bpplus.xml';
    }

    // -- Settings ------------------------------------------------------------

    private function captureInstrument(): string
    {
        $configured = trim((string) $this->getProjectSetting('capture-instrument'));
        return $configured !== '' ? $configured : self::DEFAULT_INSTRUMENT;
    }

    /**
     * The prefix every field name is built from.
     *
     * A trailing underscore is added when it is missing, because "bpplus" and
     * "bpplus_" are the same intention and only one of them matches the fields
     * the supplied data dictionary creates.
     */
    private function fieldPrefix(): string
    {
        $configured = trim((string) $this->getProjectSetting('field-prefix'));
        if ($configured === '') {
            return self::DEFAULT_PREFIX;
        }

        $clean = preg_replace('/[^a-z0-9_]/', '', strtolower($configured));
        if ($clean === '') {
            return self::DEFAULT_PREFIX;
        }

        return substr($clean, -1) === '_' ? $clean : $clean . '_';
    }

    /**
     * How far the device clock may be out before it is set from the browser.
     *
     * The device timestamp is written into the result XML, so a clock that is
     * wrong mislabels data permanently. Blank or nonsense falls back to five
     * minutes rather than to no checking at all.
     */
    private function clockToleranceMinutes(): float
    {
        $configured = trim((string) $this->getProjectSetting('clock-tolerance-minutes'));
        if ($configured === '' || !is_numeric($configured) || (float) $configured < 0) {
            return self::DEFAULT_CLOCK_MINS;
        }
        return (float) $configured;
    }

    /**
     * The largest recording this project will accept, in bytes.
     *
     * Clamped, not merely defaulted. This bounds an endpoint an unauthenticated
     * survey respondent can reach, so a mistyped setting -- 1000 where 10 was
     * meant -- must not turn it into somewhere to put anything at all.
     */
    private function maxRecordingBytes(): int
    {
        $configured = trim((string) $this->getProjectSetting('max-recording-mb'));
        $mb = is_numeric($configured) ? (float) $configured : self::DEFAULT_MAX_MB;

        $mb = max(self::MIN_MAX_MB, min(self::LIMIT_MAX_MB, $mb));

        return (int) round($mb * 1024 * 1024);
    }

    /**
     * Which of the four things to send the device as a patient ID.
     *
     * Blank is the default rather than "off": the device keeps this in its own
     * result file and on its SD card, and it is what reconciles a card full of
     * recordings back to records when REDCap has no copy -- a browser that
     * died, a survey abandoned before its submit. A record number is already a
     * pseudonym, so sending one exposes nothing a card reader could use.
     */
    private function patientIdMode(): string
    {
        $configured = trim((string) $this->getProjectSetting('patient-id-mode'));
        $known = ['record', 'template', 'off'];

        return in_array($configured, $known, true) ? $configured : 'default';
    }

    /** The template, when the mode says to use one. */
    private function patientIdTemplate(): string
    {
        return trim((string) $this->getProjectSetting('patient-id-template'));
    }

    /** The MeasureMode the device must report, or null for "any". */
    private function requiredMode(): ?int
    {
        $configured = trim((string) $this->getProjectSetting('require-mode'));
        return $configured === '' ? null : (int) $configured;
    }

    // -- The page ------------------------------------------------------------

    /**
     * The values the page script needs.
     *
     * sdkUrl is passed explicitly because the script imports the SDK as an ES
     * module at run time. Resolving it here means the import works whatever this
     * installation does with static file URLs.
     */
    private function emitConfig($project_id, $record, $event_id, $repeat_instance): void
    {
        $config = [
            'record'          => (string) $record,
            'event_id'        => (string) $event_id,
            'repeat_instance' => (string) $repeat_instance,
            'pid'             => (string) $project_id,

            'sdkUrl'          => $this->getUrl('sdk/index.js'),
            'fieldPrefix'     => $this->fieldPrefix(),

            // Composed in the browser rather than here, because the record can
            // change on the page between measurements -- the test harness edits
            // it, and a study could too -- and a value fixed at render time
            // would then label a reading with the participant before it.
            'patientIdMode'     => $this->patientIdMode(),
            'patientIdTemplate' => $this->patientIdTemplate(),

            'saveXmlAsFile'         => (bool) $this->getProjectSetting('save-xml-file'),
            'clockToleranceMinutes' => $this->clockToleranceMinutes(),
            'requiredMode'          => $this->requiredMode(),
            'hostStartedOnly'       => (bool) $this->getProjectSetting('host-started-only'),
            'trace'                 => (bool) $this->getProjectSetting('trace'),

            // The device retries a determination it could not measure and still
            // reports the attempt it threw away, so a clean reading arrives
            // carrying a failure nobody can act on. Off by default.
            'detailedWarnings'      => (bool) $this->getProjectSetting('show-recovered-warnings'),

            // Fabricated readings. Everything downstream of the device runs
            // exactly as it does for real, which is the point and also the
            // danger -- see the banner and the device id in the page script.
            'simulator'             => (bool) $this->getProjectSetting('simulator'),
        ];

        // json_encode with the HEX_* flags escapes everything that could close
        // the script element, so no value reaching the page can end it early.
        $json = json_encode(
            $config,
            JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
        );

        echo '<script>window.BPPLUS_CONFIG = ' . $json . ';</script>' . "\n";
    }

    /** A record ID that is safe in a filename, whatever the project allows in one. */
    private function safeName(string $value): string
    {
        $safe = preg_replace('/[^A-Za-z0-9._-]/', '-', $value);
        return $safe === '' ? 'record' : substr($safe, 0, 64);
    }
}
